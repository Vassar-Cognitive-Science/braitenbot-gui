import { getOutputPorts, TYPE_BY_ID } from '../types/diagram';
import type { NodeTypeId, PinFieldId } from '../types/diagram';
import type { WiringGraph, GraphNode, GraphEdge } from './graph';

// C identifier conventions (built from readableId, which sanitizes the
// node label and disambiguates duplicates with _1/_2/… suffixes):
//   sig_<id>          — value emitted by a single-output node.
//   sig_<id>_<port>   — one per port on a multi-output source (color sensor).
//   input_<id>        — aggregated incoming-edge value at a consumer.
// Pin constants follow per-type rules in pinConstantName().

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * Build a mapping from node id → human-readable C identifier based on labels.
 * Duplicate labels get a numeric suffix (_2, _3, …).
 */
function buildLabelMap(graph: WiringGraph): Map<string, string> {
  const map = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const node of graph.nodes) {
    const base = sanitizeId(node.label || node.id);
    const prev = counts.get(base) ?? 0;
    counts.set(base, prev + 1);
    map.set(node.id, prev === 0 ? base : `${base}_${prev + 1}`);
  }
  // Go back and suffix the first occurrence if there were duplicates
  for (const node of graph.nodes) {
    const base = sanitizeId(node.label || node.id);
    if ((counts.get(base) ?? 0) > 1 && map.get(node.id) === base) {
      map.set(node.id, `${base}_1`);
    }
  }
  return map;
}

let _labelMap: Map<string, string> = new Map();

function setLabelMap(m: Map<string, string>) {
  _labelMap = m;
}

/** Readable C identifier for a node or raw node id. */
function readableId(arg: GraphNode | string): string {
  const id = typeof arg === 'string' ? arg : arg.id;
  return _labelMap.get(id) ?? sanitizeId(id);
}

/** `sig_<id>` — the canonical output variable for a single-output node. */
function varName(node: GraphNode): string {
  return `sig_${readableId(node)}`;
}

/**
 * Resolve a port suffix for a multi-output source node. Returns undefined for
 * single-output nodes. An unknown/stale `fromPort` falls back to the first
 * declared port so codegen stays compilable (the validator flags this case
 * separately as a warning).
 */
function srcPortSuffix(node: GraphNode, fromPort?: string): string | undefined {
  const ports = getOutputPorts(node.typeId);
  if (!ports) return undefined;
  if (fromPort && (ports as string[]).includes(fromPort)) return fromPort;
  return ports[0];
}

/** The `sig_…` variable a downstream consumer reads from a source node + port. */
function srcVarName(node: GraphNode, fromPort?: string): string {
  const suffix = srcPortSuffix(node, fromPort);
  if (suffix !== undefined) return `sig_${readableId(node)}_${suffix}`;
  return varName(node);
}

/** `input_<id>` — the aggregated-incoming-edge variable for a consumer node. */
function inputVar(node: GraphNode): string {
  return `input_${readableId(node)}`;
}

function incomingEdges(graph: WiringGraph, nodeId: string): GraphEdge[] {
  return graph.edges.filter((e) => e.to === nodeId);
}

function nodeById(graph: WiringGraph, id: string): GraphNode | undefined {
  return graph.nodes.find((n) => n.id === id);
}

/**
 * Emit a piecewise-linear lookup function for a non-linear edge.
 * Input and output: -100 to 100.
 */
function emitTransferFunction(edge: GraphEdge, idx: number): string {
  const fname = `transfer_${readableId(edge.from)}_${readableId(edge.to)}_${idx}`;
  const pts = [...edge.transferPoints].sort((a, b) => a.x - b.x);
  const lines: string[] = [];
  lines.push(`float ${fname}(float x) {`);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const slope = (p1.y - p0.y) / (p1.x - p0.x || 1);
    const cond = i === 0
      ? `if (x <= ${p1.x.toFixed(4)})`
      : i === pts.length - 2
        ? `else`
        : `else if (x <= ${p1.x.toFixed(4)})`;
    lines.push(`  ${cond} return ${p0.y.toFixed(4)} + ${slope.toFixed(8)} * (x - ${p0.x.toFixed(4)});`);
  }
  if (pts.length <= 1) {
    lines.push(`  return ${pts[0]?.y.toFixed(4) ?? '0.0'};`);
  }
  lines.push('}');
  return lines.join('\n');
}

/** Produce a C expression for a single edge's contribution. */
function emitEdgeTerm(graph: WiringGraph, edge: GraphEdge, src: GraphNode): string {
  const sv = srcVarName(src, edge.fromPort);
  if (edge.transferMode === 'nonlinear' && edge.transferPoints.length >= 2) {
    const fnIdx = graph.edges.indexOf(edge);
    const fname = `transfer_${readableId(edge.from)}_${readableId(edge.to)}_${fnIdx}`;
    return `${fname}(${sv})`;
  }
  return `${sv} * ${edge.weight.toFixed(4)}`;
}

function emitInputAggregation(
  graph: WiringGraph,
  node: GraphNode,
  indent: string,
): string {
  const edges = incomingEdges(graph, node.id);
  const lines: string[] = [];
  lines.push(`${indent}float ${inputVar(node)} = 0.0;`);
  for (const edge of edges) {
    const src = nodeById(graph, edge.from);
    if (!src) continue;
    lines.push(`${indent}${inputVar(node)} += ${emitEdgeTerm(graph, edge, src)};`);
  }
  return lines.join('\n');
}

function emitProductAggregation(
  graph: WiringGraph,
  node: GraphNode,
  indent: string,
): string {
  const edges = incomingEdges(graph, node.id);
  const lines: string[] = [];
  if (edges.length === 0) {
    lines.push(`${indent}float ${inputVar(node)} = 0.0;`);
    return lines.join('\n');
  }
  lines.push(`${indent}float ${inputVar(node)} = 1.0;`);
  for (const edge of edges) {
    const src = nodeById(graph, edge.from);
    if (!src) continue;
    lines.push(`${indent}${inputVar(node)} *= (${emitEdgeTerm(graph, edge, src)});`);
  }
  return lines.join('\n');
}

/**
 * C constant name used to refer to the pin a given node-type+field is wired
 * to. Centralized so new node types only have to register their naming
 * convention here (and existing types preserve their historical names).
 */
function pinConstantName(typeId: NodeTypeId, field: PinFieldId, sid: string): string {
  if (typeId === 'sensor-analog' || typeId === 'sensor-digital') return `SENSOR_${sid}`;
  if (typeId === 'display-tm1637') {
    return field === 'clkPin' ? `TM1637_${sid}_CLK` : `TM1637_${sid}_DIO`;
  }
  if (typeId === 'digital-out') return `OUTPUT_${sid}_PIN`;
  return `SERVO_${sid}_PIN`;
}

function emitPinDeclarations(graph: WiringGraph): string {
  const lines: string[] = [];
  for (const node of graph.nodes) {
    const fields = TYPE_BY_ID[node.typeId].pinFields ?? [];
    const sid = readableId(node);
    for (const field of fields) {
      const value = node[field]?.trim();
      if (!value) continue;
      lines.push(`const int ${pinConstantName(node.typeId, field, sid)} = ${value};`);
    }
  }
  return lines.join('\n');
}

// ============================================================================
// Per-node-type emit registry
// ----------------------------------------------------------------------------
// Adding a new node type is two steps:
//   1. Add it to NODE_TYPES in src/types/diagram.ts with the relevant
//      metadata (pinFields, hasInputs, breaksCycles).
//   2. Add an entry to NODE_EMITTERS below describing how to emit it.
//
// Each entry can provide any subset of:
//   declareGlobal — file-scope declarations (Servo objects, display instances).
//   setup         — per-instance lines inside setup().
//   loop          — per-instance lines at the node's execution-order position.
//   deferredLoop  — per-instance lines emitted at the bottom of loop(), after
//                   the main pass. Used by cycle-breakers (delay) so they can
//                   read the loop's final state in the same iteration.
// ============================================================================

interface EmitCtx {
  graph: WiringGraph;
  indent: string;
  loopPeriodMs: number;
}

interface NodeEmitter {
  declareGlobal?(node: GraphNode, ctx: EmitCtx): string | undefined;
  setup?(node: GraphNode, ctx: EmitCtx): string | undefined;
  loop?(node: GraphNode, ctx: EmitCtx): string | undefined;
  deferredLoop?(node: GraphNode, ctx: EmitCtx): string | undefined;
}

// Compound and port-anchor types never reach codegen — the flattener
// expands them away before buildGraph runs. They appear here as empty
// entries so this map stays exhaustive over NodeTypeId.
const NODE_EMITTERS: Record<NodeTypeId, NodeEmitter> = {
  compound: {},
  'compound-input': {},
  'compound-output': {},
  // --- Sensors ---
  'sensor-analog': {
    loop: (node, { indent }) =>
      `${indent}float ${varName(node)} = analogRead(SENSOR_${readableId(node)}) * (100.0 / 1023.0);`,
  },
  'sensor-digital': {
    setup: (node, { indent }) => {
      const mode = node.pullup ? 'INPUT_PULLUP' : 'INPUT';
      return `${indent}pinMode(SENSOR_${readableId(node)}, ${mode});`;
    },
    loop: (node, { indent }) => {
      // With INPUT_PULLUP the switch shorts the pin to GND when pressed,
      // so the raw read is inverted relative to "active = signal".
      const read = node.pullup
        ? `(1 - digitalRead(SENSOR_${readableId(node)}))`
        : `digitalRead(SENSOR_${readableId(node)})`;
      return `${indent}float ${varName(node)} = ${read} * 100.0;`;
    },
  },
  'sensor-color': {
    // One bulk I2C read per loop; each channel is exposed as its own
    // variable so downstream edges can pick via their fromPort.
    loop: (node, { indent }) => {
      const rid = readableId(node);
      return [
        `${indent}TCS34725Sample sample_${rid} = tcs34725_read_all();`,
        `${indent}float sig_${rid}_clear = sample_${rid}.c * (100.0 / 65535.0);`,
        `${indent}float sig_${rid}_red   = sample_${rid}.r * (100.0 / 65535.0);`,
        `${indent}float sig_${rid}_green = sample_${rid}.g * (100.0 / 65535.0);`,
        `${indent}float sig_${rid}_blue  = sample_${rid}.b * (100.0 / 65535.0);`,
      ].join('\n');
    },
  },

  // --- Constants ---
  constant: {
    loop: (node, { indent }) =>
      `${indent}float ${varName(node)} = ${(node.constantValue ?? 0).toFixed(4)};`,
  },

  // --- Compute ---
  'compute-threshold': {
    loop: (node, { graph, indent }) => {
      const thresh = node.threshold ?? 50;
      return [
        emitInputAggregation(graph, node, indent),
        `${indent}float ${varName(node)} = (${inputVar(node)} > ${thresh.toFixed(4)}) ? 100.0 : 0.0;`,
      ].join('\n');
    },
  },
  'compute-summation': {
    loop: (node, { graph, indent }) =>
      [
        emitInputAggregation(graph, node, indent),
        `${indent}float ${varName(node)} = ${inputVar(node)};`,
      ].join('\n'),
  },
  'compute-multiply': {
    loop: (node, { graph, indent }) =>
      [
        emitProductAggregation(graph, node, indent),
        `${indent}float ${varName(node)} = ${inputVar(node)};`,
      ].join('\n'),
  },
  'compute-delay': {
    // Two-phase emission. The "read" half (loop) exposes the buffered
    // value from a previous iteration as sig_<name>. The "write" half
    // (deferredLoop) aggregates inputs and advances the ring buffer at
    // the bottom of loop(). That ordering is what lets feedback cycles
    // broken by a delay work — by the time we capture, every other
    // signal has been computed for this tick.
    loop: (node, { indent, loopPeriodMs }) => {
      const name = varName(node);
      const delayMs = node.delayMs ?? 100;
      const bufSize = Math.max(1, Math.round(delayMs / loopPeriodMs));
      return [
        `${indent}static const int ${name}_BUF_SIZE = ${bufSize};`,
        `${indent}static float ${name}_buf[${bufSize}] = {0};`,
        `${indent}static int ${name}_idx = 0;`,
        `${indent}float ${name} = ${name}_buf[${name}_idx];`,
      ].join('\n');
    },
    deferredLoop: (node, { graph, indent }) => {
      const name = varName(node);
      return [
        emitInputAggregation(graph, node, indent),
        `${indent}${name}_buf[${name}_idx] = ${inputVar(node)};`,
        `${indent}${name}_idx = (${name}_idx + 1) % ${name}_BUF_SIZE;`,
      ].join('\n');
    },
  },
  'compute-oscillator': {
    loop: (node, { indent }) => {
      const freq = node.frequencyHz ?? 1.0;
      const amp = node.amplitude ?? 100;
      return `${indent}float ${varName(node)} = ${amp.toFixed(4)} * sin(2.0 * PI * ${freq.toFixed(4)} * (millis() / 1000.0));`;
    },
  },
  'compute-noise': {
    loop: (node, { indent }) => {
      const amp = node.amplitude ?? 50;
      return `${indent}float ${varName(node)} = ${amp.toFixed(4)} * ((float)random(-10000, 10001) / 10000.0);`;
    },
  },

  // --- Outputs ---
  'servo-cr': {
    declareGlobal: (node) => `Servo servo_${readableId(node)};`,
    setup: (node, { indent }) =>
      `${indent}servo_${readableId(node)}.attach(SERVO_${readableId(node)}_PIN);`,
    // Wheels (paired CR servos that drive the robot body) just aggregate
    // inputs — drive() consumes both wheels once per loop and handles
    // right-side inversion. Standalone CR servos write microseconds here.
    loop: (node, ctx) => {
      if (node.wheelRole) return emitInputAggregation(ctx.graph, node, ctx.indent);
      const sid = readableId(node);
      return [
        emitInputAggregation(ctx.graph, node, ctx.indent),
        `${ctx.indent}int us_${sid} = 1500 + (int)(constrain(${inputVar(node)}, -100.0, 100.0) * 5.0);`,
        `${ctx.indent}servo_${sid}.writeMicroseconds(us_${sid});`,
      ].join('\n');
    },
  },
  'servo-positional': {
    declareGlobal: (node) => `Servo servo_${readableId(node)};`,
    setup: (node, { indent }) =>
      `${indent}servo_${readableId(node)}.attach(SERVO_${readableId(node)}_PIN);`,
    loop: (node, { graph, indent }) => {
      const sid = readableId(node);
      return [
        emitInputAggregation(graph, node, indent),
        `${indent}int angle_${sid} = constrain((int)((${inputVar(node)} + 100.0) * 0.9), 0, 180);`,
        `${indent}servo_${sid}.write(angle_${sid});`,
      ].join('\n');
    },
  },
  'digital-out': {
    setup: (node, { indent }) =>
      `${indent}pinMode(OUTPUT_${readableId(node)}_PIN, OUTPUT);`,
    loop: (node, { graph, indent }) => {
      const sid = readableId(node);
      const thresh = node.threshold ?? 50;
      return [
        emitInputAggregation(graph, node, indent),
        `${indent}digitalWrite(OUTPUT_${sid}_PIN, ${inputVar(node)} > ${thresh.toFixed(4)} ? HIGH : LOW);`,
      ].join('\n');
    },
  },
  'display-tm1637': {
    declareGlobal: (node) => {
      const sid = readableId(node);
      return `TM1637Display display_${sid}(TM1637_${sid}_CLK, TM1637_${sid}_DIO);`;
    },
    setup: (node, { indent }) => {
      const sid = readableId(node);
      const b = Math.max(0, Math.min(7, Math.round(node.brightness ?? 3)));
      return [
        `${indent}display_${sid}.setBrightness(${b});`,
        `${indent}display_${sid}.clear();`,
      ].join('\n');
    },
    loop: (node, { graph, indent }) => {
      const sid = readableId(node);
      return [
        emitInputAggregation(graph, node, indent),
        `${indent}int value_${sid} = constrain((int)lround(${inputVar(node)}), -999, 9999);`,
        `${indent}display_${sid}.showNumberDec(value_${sid}, false);`,
      ].join('\n');
    },
  },
};

function emitSetup(graph: WiringGraph, ctx: EmitCtx): string {
  const lines: string[] = ['void setup() {', '  Serial.begin(115200);'];
  const i2cTypes = i2cTypesIn(graph);
  if (i2cTypes.length) lines.push('  Wire.begin();');
  for (const typeId of i2cTypes) {
    const init = I2C_DRIVERS[typeId]?.setupInit;
    if (init) lines.push(`  ${init}`);
  }
  for (const node of graph.nodes) {
    const fragment = NODE_EMITTERS[node.typeId].setup?.(node, ctx);
    if (fragment) lines.push(fragment);
  }
  lines.push('}');
  return lines.join('\n');
}

// ============================================================================
// I2C driver registry
// ----------------------------------------------------------------------------
// Each entry pairs an I2C-protocol sensor type with the C driver code it
// needs at file scope and an optional setup() init call. Wire.begin() is
// emitted once globally; per-device init goes here.
//
// Adding a new I2C device: declare its sensor type in NODE_TYPES with
// `protocol: 'i2c'`, then add a matching entry below.
// ============================================================================

interface I2cDriver {
  /** File-scope C: address constant, struct, read/write helpers, begin(). */
  decl: string;
  /** Optional one-shot init call placed inside setup(), after Wire.begin(). */
  setupInit?: string;
}

const I2C_DRIVERS: Partial<Record<NodeTypeId, I2cDriver>> = {
  'sensor-color': {
    setupInit: 'tcs34725_begin();',
    decl: [
      '// --- TCS34725 color sensor driver (I2C, address 0x29) ---',
      'const uint8_t TCS34725_ADDR = 0x29;',
      '',
      'struct TCS34725Sample { uint16_t c, r, g, b; };',
      '',
      'void tcs34725_write8(uint8_t reg, uint8_t value) {',
      '  Wire.beginTransmission(TCS34725_ADDR);',
      '  Wire.write(0x80 | reg); // command bit + register',
      '  Wire.write(value);',
      '  Wire.endTransmission();',
      '}',
      '',
      '// Read CDATA/RDATA/GDATA/BDATA (8 bytes starting at 0x14) in a single',
      '// I2C transaction using the command register\'s auto-increment bit (0x20).',
      'TCS34725Sample tcs34725_read_all() {',
      '  TCS34725Sample s = {0, 0, 0, 0};',
      '  Wire.beginTransmission(TCS34725_ADDR);',
      '  Wire.write(0xA0 | 0x14); // command + auto-increment, starting at CDATAL',
      '  if (Wire.endTransmission() != 0) {',
      '    return s;',
      '  }',
      '  uint8_t bytesRead = Wire.requestFrom(TCS34725_ADDR, (uint8_t)8);',
      '  if (bytesRead != 8) {',
      '    return s;',
      '  }',
      '  uint8_t cl = Wire.read(); uint8_t ch = Wire.read();',
      '  uint8_t rl = Wire.read(); uint8_t rh = Wire.read();',
      '  uint8_t gl = Wire.read(); uint8_t gh = Wire.read();',
      '  uint8_t bl = Wire.read(); uint8_t bh = Wire.read();',
      '  s.c = ((uint16_t)ch << 8) | cl;',
      '  s.r = ((uint16_t)rh << 8) | rl;',
      '  s.g = ((uint16_t)gh << 8) | gl;',
      '  s.b = ((uint16_t)bh << 8) | bl;',
      '  return s;',
      '}',
      '',
      'void tcs34725_begin() {',
      '  tcs34725_write8(0x01, 0xD5); // ATIME: ~101 ms integration',
      '  tcs34725_write8(0x0F, 0x01); // CONTROL: gain = 4x',
      '  tcs34725_write8(0x00, 0x01); // ENABLE: PON',
      '  delay(3);',
      '  tcs34725_write8(0x00, 0x03); // ENABLE: PON | AEN (RGBC enable)',
      '}',
    ].join('\n'),
  },
};

/** Distinct I2C-device types present in this graph (preserves first-occurrence order). */
function i2cTypesIn(graph: WiringGraph): NodeTypeId[] {
  const seen = new Set<NodeTypeId>();
  for (const node of graph.nodes) {
    if (node.protocol === 'i2c') seen.add(node.typeId);
  }
  return [...seen];
}

function emitDriveHelper(leftWheel: GraphNode, rightWheel: GraphNode): string {
  const left = readableId(leftWheel);
  const right = readableId(rightWheel);
  return [
    '// Drive both wheel continuous servos. left/right are -100..100 (signed speed).',
    '// The right servo is mounted mirrored, so its direction is inverted.',
    'void drive(float left, float right) {',
    '  left  = constrain(left,  -100.0, 100.0);',
    '  right = constrain(right, -100.0, 100.0);',
    '#if defined(ARDUINO_ARCH_RENESAS)',
    '  // Safety: when a USB host is actively configured (e.g. for upload or',
    '  // tethered debugging), hold the wheels neutral so the bot can\'t drive',
    '  // off the bench. Other behaviors (servos, displays, sensor reads) still',
    '  // run normally. The built-in LED blinks while the safeguard is active',
    '  // so it\'s obvious at a glance that the bot is "disarmed".',
    '  //',
    '  // We read DVSQ (Device State, bits 6:4 of INTSTS0). 0b011 = Configured,',
    '  // i.e. host has enumerated and is talking. When the cable is removed',
    '  // DVSQ transitions to a Suspended state (0b1xx) and we re-arm.',
    '  // (Note: VBSTS is stuck high on the R4 Minima because the chip\'s VBUS',
    '  // sense pin is tied to the 5V rail, so we can\'t use it for this.)',
    '  static bool drive_led_inited = false;',
    '  if (!drive_led_inited) { pinMode(LED_BUILTIN, OUTPUT); drive_led_inited = true; }',
    '  uint8_t dvsq = (R_USB_FS0->INTSTS0 >> 4) & 0x7;',
    '  if (dvsq == 0b011) {',
    '    left = 0.0;',
    '    right = 0.0;',
    '    static bool drive_led_state = false;',
    '    drive_led_state = !drive_led_state;',
    '    digitalWrite(LED_BUILTIN, drive_led_state ? HIGH : LOW);',
    '  } else {',
    '    digitalWrite(LED_BUILTIN, LOW);',
    '  }',
    '#endif',
    `  servo_${left}.writeMicroseconds(1500 + (int)(left  * 5.0));`,
    `  servo_${right}.writeMicroseconds(1500 - (int)(right * 5.0));`,
    '}',
  ].join('\n');
}

export function generateSketch(graph: WiringGraph): string {
  setLabelMap(buildLabelMap(graph));
  const sections: string[] = [];
  const ctx: EmitCtx = { graph, indent: '  ', loopPeriodMs: graph.loopPeriodMs };

  const i2cTypes = i2cTypesIn(graph);
  const hasI2C = i2cTypes.length > 0;
  const hasServo = graph.nodes.some(
    (n) => n.typeId === 'servo-cr' || n.typeId === 'servo-positional',
  );
  const hasTm1637 = graph.nodes.some((n) => n.typeId === 'display-tm1637');
  const leftWheel = graph.nodes.find((n) => n.wheelRole === 'left');
  const rightWheel = graph.nodes.find((n) => n.wheelRole === 'right');
  const hasDrive = !!(leftWheel && rightWheel);

  // Header
  sections.push('// --- Auto-generated by BraitenBot GUI ---');
  sections.push('// Signal convention: sensors output 0.0–100.0, internal signals -100.0–100.0');
  if (hasI2C) sections.push('#include <Wire.h>');
  if (hasServo) sections.push('#include <Servo.h>');
  if (hasTm1637) sections.push('#include <TM1637Display.h>');
  sections.push('');

  // Pin declarations
  const pins = emitPinDeclarations(graph);
  if (pins) {
    sections.push(pins);
    sections.push('');
  }

  // I2C device drivers — one block per distinct I2C-protocol type in use.
  for (const typeId of i2cTypes) {
    const driver = I2C_DRIVERS[typeId];
    if (driver) {
      sections.push(driver.decl);
      sections.push('');
    }
  }

  // File-scope declarations contributed by each node (Servo objects,
  // TM1637 display instances, etc.) — driven by the registry.
  const globals: string[] = [];
  for (const node of graph.nodes) {
    const decl = NODE_EMITTERS[node.typeId].declareGlobal?.(node, ctx);
    if (decl) globals.push(decl);
  }
  if (globals.length) {
    sections.push(globals.join('\n'));
    sections.push('');
  }

  // drive() helper — only emitted when both wheel nodes are present.
  if (hasDrive) {
    sections.push(emitDriveHelper(leftWheel!, rightWheel!));
    sections.push('');
  }

  // Transfer functions for non-linear edges
  const nlEdges = graph.edges.filter(
    (e) => e.transferMode === 'nonlinear' && e.transferPoints.length >= 2,
  );
  for (const edge of nlEdges) {
    const idx = graph.edges.indexOf(edge);
    sections.push(emitTransferFunction(edge, idx));
    sections.push('');
  }

  // setup()
  sections.push(emitSetup(graph, ctx));
  sections.push('');

  // loop()
  const loopLines: string[] = ['void loop() {'];
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const nodeId of graph.executionOrder) {
    const node = nodeMap.get(nodeId);
    if (!node) continue;
    const body = NODE_EMITTERS[node.typeId].loop?.(node, ctx);
    if (!body) continue;
    // Compute and output nodes get a leading blank line; sources don't.
    if (node.kind === 'compute' || node.kind === 'output') loopLines.push('');
    loopLines.push(body);
  }

  // Deferred lines for cycle-breaking nodes — emitted after the main pass
  // so they observe every other signal's final value in this iteration.
  for (const node of graph.nodes) {
    if (!TYPE_BY_ID[node.typeId].breaksCycles) continue;
    const body = NODE_EMITTERS[node.typeId].deferredLoop?.(node, ctx);
    if (!body) continue;
    loopLines.push('');
    loopLines.push(body);
  }

  if (hasDrive) {
    loopLines.push('');
    loopLines.push(`  drive(${inputVar(leftWheel!)}, ${inputVar(rightWheel!)});`);
  }

  loopLines.push('');
  loopLines.push(`  delay(${graph.loopPeriodMs});`);
  loopLines.push('}');

  sections.push(loopLines.join('\n'));
  sections.push('');

  return sections.join('\n');
}
