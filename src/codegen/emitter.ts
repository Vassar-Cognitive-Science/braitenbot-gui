import { getOutputPorts, TYPE_BY_ID, DEFAULT_COLOR_GAIN, DEFAULT_TOF_MAX_MM } from '../types/diagram';
import type { NodeTypeId, PinFieldId } from '../types/diagram';
import type { WiringGraph, GraphNode, GraphEdge } from './graph';

// TCS34725 RGBC gain multiplier → CONTROL-register (0x0F) value.
const COLOR_GAIN_REGISTER: Record<number, string> = {
  1: '0x00',
  4: '0x01',
  16: '0x02',
  60: '0x03',
};

function colorGainRegister(gain?: number): string {
  return COLOR_GAIN_REGISTER[gain ?? DEFAULT_COLOR_GAIN] ?? COLOR_GAIN_REGISTER[DEFAULT_COLOR_GAIN];
}

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
 * Duplicate labels get a numeric suffix (_1, _2, …). Suffixing tracks the set
 * of names already handed out and bumps the numeric suffix until it finds a
 * free one, so a generated `foo_2` can never collide with a literal label
 * "foo_2" — which would otherwise emit two identical C identifiers and fail to
 * compile.
 */
function buildLabelMap(graph: WiringGraph): Map<string, string> {
  const map = new Map<string, string>();
  const used = new Set<string>();
  const baseCounts = new Map<string, number>();
  for (const node of graph.nodes) {
    const base = sanitizeId(node.label || node.id);
    baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1);
  }
  const nextSuffix = new Map<string, number>();
  const claim = (candidate: string): string => {
    let name = candidate;
    let i = 2;
    while (used.has(name)) {
      name = `${candidate}_${i}`;
      i++;
    }
    used.add(name);
    return name;
  };
  for (const node of graph.nodes) {
    const base = sanitizeId(node.label || node.id);
    let name: string;
    if ((baseCounts.get(base) ?? 0) <= 1) {
      // Sole use of this label — keep the bare name unless a suffixed name
      // from a duplicate group already claimed it.
      name = claim(base);
    } else {
      // Duplicate label — always suffix, skipping any name already taken.
      let i = nextSuffix.get(base) ?? 1;
      let candidate = `${base}_${i}`;
      while (used.has(candidate)) {
        i++;
        candidate = `${base}_${i}`;
      }
      nextSuffix.set(base, i + 1);
      used.add(candidate);
      name = candidate;
    }
    map.set(node.id, name);
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
 *
 * Endpoint clamp guards are emitted first so that every x outside the
 * declared knot domain saturates to the nearest endpoint y — matching the
 * JS simulation's clamp semantics (useTraceSimulation.ts, interpolateTransfer)
 * and ensuring there is no code path in the C function that falls off the end
 * without an explicit return.
 */
function emitTransferFunction(edge: GraphEdge, idx: number): string {
  const fname = `transfer_${readableId(edge.from)}_${readableId(edge.to)}_${idx}`;
  const pts = [...edge.transferPoints].sort((a, b) => a.x - b.x);
  const lines: string[] = [];
  lines.push(`float ${fname}(float x) {`);
  if (pts.length <= 1) {
    lines.push(`  return ${pts[0]?.y.toFixed(4) ?? '0.0000'};`);
    lines.push('}');
    return lines.join('\n');
  }
  // Endpoint clamps — saturate inputs outside [first.x, last.x] to the
  // nearest endpoint y. This matches the trace simulator and guarantees
  // every code path returns (no undefined-return UB from falling off the end).
  const first = pts[0];
  const last = pts[pts.length - 1];
  lines.push(`  if (x <= ${first.x.toFixed(4)}) return ${first.y.toFixed(4)};`);
  lines.push(`  if (x >= ${last.x.toFixed(4)}) return ${last.y.toFixed(4)};`);
  // Interior piecewise-linear segments. All but the final segment test their
  // upper boundary with an if guard; the final segment is a bare return
  // (x < last.x is already guaranteed by the clamp guard above).
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const slope = (p1.y - p0.y) / (p1.x - p0.x || 1);
    const isLast = i === pts.length - 2;
    if (isLast) {
      lines.push(`  return ${p0.y.toFixed(4)} + ${slope.toFixed(8)} * (x - ${p0.x.toFixed(4)});`);
    } else {
      lines.push(`  if (x <= ${p1.x.toFixed(4)}) return ${p0.y.toFixed(4)} + ${slope.toFixed(8)} * (x - ${p0.x.toFixed(4)});`);
    }
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
 * Emit a min/max reduction over a node's incoming edge terms. Seeds the
 * accumulator with the first term, then folds the rest with a single
 * comparison per term into a temporary — this avoids the double-argument
 * evaluation of the Arduino min()/max() macros (a transfer-function edge would
 * otherwise be called twice) and doesn't depend on fmin/fmax being available
 * in avr-libc. With no incoming edges the value is 0.0, matching the trace
 * simulator (which reports such a node as disconnected → 0).
 */
function emitReduceAggregation(
  graph: WiringGraph,
  node: GraphNode,
  indent: string,
  op: 'min' | 'max',
): string {
  const iv = inputVar(node);
  const terms: string[] = [];
  for (const edge of incomingEdges(graph, node.id)) {
    const src = nodeById(graph, edge.from);
    if (!src) continue;
    terms.push(emitEdgeTerm(graph, edge, src));
  }
  if (terms.length === 0) {
    return `${indent}float ${iv} = 0.0;`;
  }
  const cmp = op === 'max' ? '>' : '<';
  const lines: string[] = [`${indent}float ${iv} = ${terms[0]};`];
  if (terms.length > 1) {
    lines.push(`${indent}float ${iv}_t;`);
    for (let i = 1; i < terms.length; i++) {
      lines.push(`${indent}${iv}_t = ${terms[i]};`);
      lines.push(`${indent}if (${iv}_t ${cmp} ${iv}) ${iv} = ${iv}_t;`);
    }
  }
  return lines.join('\n');
}

/**
 * C constant name used to refer to the pin a given node-type+field is wired
 * to. Centralized so new node types only have to register their naming
 * convention here (and existing types preserve their historical names).
 */
function pinConstantName(typeId: NodeTypeId, field: PinFieldId, sid: string): string {
  if (field === 'xshutPin') return `XSHUT_${sid}`;
  if (typeId === 'sensor-analog' || typeId === 'sensor-digital') return `SENSOR_${sid}`;
  if (typeId === 'display-tm1637') {
    return field === 'clkPin' ? `TM1637_${sid}_CLK` : `TM1637_${sid}_GPIO`;
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
    loop: (node, { indent }) => {
      const read = `analogRead(SENSOR_${readableId(node)}) * (100.0 / 1023.0)`;
      // Invert so a brighter/closer reading produces a higher signal.
      const expr = node.invert ? `100.0 - (${read})` : read;
      return `${indent}float ${varName(node)} = ${expr};`;
    },
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
  'sensor-tof': {
    // One VL53L4CD object per node; constructed with its XSHUT pin so the
    // library can sequence power-up during setup (see I2C_DRIVERS).
    declareGlobal: (node) =>
      `VL53L4CD tof_${readableId(node)}(&Wire, XSHUT_${readableId(node)});`,
    // Non-blocking read: the main loop runs faster than a ranging cycle, so we
    // poll for new data and hold the last valid distance between iterations.
    loop: (node, { indent }) => {
      const rid = readableId(node);
      const max = node.maxDistanceMm ?? DEFAULT_TOF_MAX_MM;
      const maxLit = max.toFixed(1);
      // Default: near = high signal. Invert flips it so far = high.
      const norm = node.invert
        ? `(dist_${rid} / ${maxLit})`
        : `(1.0 - dist_${rid} / ${maxLit})`;
      return [
        `${indent}uint8_t ready_${rid} = 0;`,
        `${indent}static float dist_${rid} = ${maxLit}; // distance (mm); starts far`,
        `${indent}tof_${rid}.VL53L4CD_CheckForDataReady(&ready_${rid});`,
        `${indent}if (ready_${rid}) {`,
        `${indent}  tof_${rid}.VL53L4CD_ClearInterrupt();`,
        `${indent}  VL53L4CD_Result_t res_${rid};`,
        `${indent}  tof_${rid}.VL53L4CD_GetResult(&res_${rid});`,
        `${indent}  // Resolve every frame to a usable distance so robot logic never`,
        `${indent}  // sees a faulty reading:`,
        `${indent}  //   0-2  valid / low-confidence -> use the measured distance`,
        `${indent}  //   3    target below min range -> 0 mm (closest possible)`,
        `${indent}  //   4-7  wraparound / fault      -> max (nothing detected)`,
        `${indent}  uint8_t status_${rid} = res_${rid}.range_status;`,
        `${indent}  if (status_${rid} <= 2) dist_${rid} = res_${rid}.distance_mm;`,
        `${indent}  else if (status_${rid} == 3) dist_${rid} = 0.0;`,
        `${indent}  else dist_${rid} = ${maxLit};`,
        `${indent}}`,
        `${indent}float ${varName(node)} = constrain(${norm} * 100.0, 0.0, 100.0);`,
      ].join('\n');
    },
  },
  'sensor-color': {
    // One bulk I2C read per loop; each channel is exposed as its own
    // variable so downstream edges can pick via their fromPort.
    loop: (node, { indent }) => {
      const rid = readableId(node);
      // Normalize against the ADC's actual full-scale count at this integration
      // time (TCS34725_FULL_SCALE), so a saturated channel reads 100.
      return [
        `${indent}TCS34725Sample sample_${rid} = tcs34725_read_all();`,
        `${indent}float sig_${rid}_clear = sample_${rid}.c * (100.0 / TCS34725_FULL_SCALE);`,
        `${indent}float sig_${rid}_red   = sample_${rid}.r * (100.0 / TCS34725_FULL_SCALE);`,
        `${indent}float sig_${rid}_green = sample_${rid}.g * (100.0 / TCS34725_FULL_SCALE);`,
        `${indent}float sig_${rid}_blue  = sample_${rid}.b * (100.0 / TCS34725_FULL_SCALE);`,
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
  'compute-min': {
    loop: (node, { graph, indent }) =>
      [
        emitReduceAggregation(graph, node, indent, 'min'),
        `${indent}float ${varName(node)} = ${inputVar(node)};`,
      ].join('\n'),
  },
  'compute-max': {
    loop: (node, { graph, indent }) =>
      [
        emitReduceAggregation(graph, node, indent, 'max'),
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
      return `TM1637Display display_${sid}(TM1637_${sid}_CLK, TM1637_${sid}_GPIO);`;
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
  if (i2cTypes.length) {
    lines.push('  Wire.begin();');
    // Layer 1 — bounded blocking (AVR only): without a timeout the classic-AVR
    // Wire library busy-waits forever if a slave stops clocking (e.g. the color
    // sensor browns out mid-byte), freezing the whole sketch. A 3 ms cap + TWI
    // reset lets us recover instead. The Renesas UNO R4 core lacks
    // setWireTimeout (its Wire returns error codes rather than hanging), so the
    // #ifdef keeps the sketch compiling on both FQBNs.
    lines.push('#ifdef WIRE_HAS_TIMEOUT');
    lines.push('  Wire.setWireTimeout(3000, true); // 3 ms; reset TWI hardware on timeout');
    lines.push('#endif');
  }
  for (const typeId of i2cTypes) {
    const init = I2C_DRIVERS[typeId]?.setupInit;
    if (init) lines.push(`  ${init(graph)}`);
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
  /** File-scope C: address constant, struct, read/write helpers, begin().
   *  Optional — library-backed devices (VL53L4CD) declare nothing here. */
  decl?: string;
  /** Optional one-shot init call placed inside setup(), after Wire.begin().
   *  Receives the graph so it can read device config (e.g. gain) off a node. */
  setupInit?: (graph: WiringGraph) => string;
}

const I2C_DRIVERS: Partial<Record<NodeTypeId, I2cDriver>> = {
  // VL53L4CD ToF sensors (STM32duino VL53L4CD library). Every sensor powers up
  // at the default address 0x52 (= 7-bit 0x29), which collides both with the
  // other ToF sensors and with the TCS34725 at 0x29. The fix is the library's
  // documented multi-sensor trick: begin() drives every XSHUT line low to hold
  // all sensors in reset, then we bring them up one at a time and reassign each
  // to its own address. This runs before the TCS34725 init (see i2cTypesIn
  // ordering), so by the time the color sensor is configured the bus is clean.
  'sensor-tof': {
    setupInit: (graph) => {
      const tofs = graph.nodes.filter((n) => n.typeId === 'sensor-tof');
      const lines: string[] = [
        '// VL53L4CD ToF sensors: hold all in reset, then bring up one at a',
        '// time and assign each a unique I2C address (default 0x52 is shared).',
      ];
      // begin() on every sensor first → all XSHUT low (held in shutdown).
      for (const n of tofs) lines.push(`tof_${readableId(n)}.begin();`);
      // Then power up + readdress each in turn. While one boots at 0x52 the
      // rest are still in reset, so there is never an address clash.
      // Addresses climb 0x2A, 0x2B, … (8-bit 0x54, 0x56, …). This must stay
      // clear of 0x33 — the parking spot the color driver's tcs34725_claim_bus()
      // uses to evict an undiagrammed ToF. 0x2A + i only reaches 0x33 at the
      // 10th ToF (i = 9); the diagram can't hold that many, so they never clash.
      tofs.forEach((n, i) => {
        const rid = readableId(n);
        const addr = `0x${(0x54 + i * 2).toString(16).toUpperCase()}`;
        lines.push(`tof_${rid}.InitSensor(${addr}); // 7-bit 0x${(0x2a + i).toString(16).toUpperCase()}`);
        lines.push(`tof_${rid}.VL53L4CD_SetRangeTiming(50, 0);`);
        lines.push(`tof_${rid}.VL53L4CD_StartRanging();`);
      });
      return lines.join('\n  ');
    },
  },
  'sensor-color': {
    // Gain is a device-wide setting (single sensor at 0x29); read it off the
    // first color-sensor node in the graph.
    setupInit: (graph) => {
      const node = graph.nodes.find((n) => n.typeId === 'sensor-color');
      return `tcs34725_begin(${colorGainRegister(node?.colorGain)});`;
    },
    decl: [
      '// --- TCS34725 color sensor driver (I2C, address 0x29) ---',
      'const uint8_t TCS34725_ADDR = 0x29;',
      '// Max RGBC count at the configured integration time (ATIME=0xD5):',
      '// (256 - 0xD5) * 1024 = 44032. Channels saturate here, not at 65535.',
      'const float TCS34725_FULL_SCALE = 44032.0;',
      '',
      'struct TCS34725Sample { uint16_t c, r, g, b; };',
      '',
      '// Layer 2 (last-good hold) + Layer 3 (recovery) state, at file scope so it',
      '// survives across loop iterations:',
      '//  - tcs34725_last: the most recent *successful* sample. On a failed read',
      '//    we return this instead of zeros, so a brief glitch doesn\'t yank the',
      '//    signal to 0 (the reported symptom).',
      '//  - tcs34725_failures: consecutive failed reads; when it hits a threshold',
      '//    we run bus recovery.',
      '//  - tcs34725_gain_reg: the gain register value, remembered so recovery can',
      '//    re-initialize the sensor with the same configuration.',
      'TCS34725Sample tcs34725_last = {0, 0, 0, 0};',
      'uint8_t tcs34725_failures = 0;',
      'uint8_t tcs34725_gain_reg = 0;',
      '',
      'void tcs34725_write8(uint8_t reg, uint8_t value) {',
      '  Wire.beginTransmission(TCS34725_ADDR);',
      '  Wire.write(0x80 | reg); // command bit + register',
      '  Wire.write(value);',
      '  Wire.endTransmission();',
      '}',
      '',
      '// Defensive bus-claim against a stray VL53L4CD ToF sensor.',
      '// The VL53L4CD powers up at 7-bit address 0x29 — the SAME fixed address as',
      '// this TCS34725 color sensor. If a ToF is physically wired but has no node in',
      '// the diagram, nothing ever readdresses it (that only happens when ToF nodes',
      '// exist), so BOTH chips answer every color-sensor transaction and their',
      '// replies get electrically ANDed into garbage/zeros. The bus still ACKs, so',
      '// the failure counter never trips. To claim the bus we probe the color',
      '// sensor\'s ID register: if it reads back a valid TCS ID the bus is already',
      '// clean and we touch nothing; otherwise we evict any VL53L4CD by writing its',
      '// I2C address register, parking it at 0x33. This readdress is VOLATILE — a',
      '// brown-out reboots the ToF back to 0x29 — so this must also run on recovery',
      '// (which it does: tcs34725_recover() calls tcs34725_begin()).',
      'bool tcs34725_id_ok() {',
      '  Wire.beginTransmission(TCS34725_ADDR);',
      '  Wire.write(0x80 | 0x12); // command bit + ID register',
      '  if (Wire.endTransmission() != 0) return false;',
      '  if (Wire.requestFrom(TCS34725_ADDR, (uint8_t)1) != 1) return false;',
      '  uint8_t id = Wire.read();',
      '  return id == 0x44 || id == 0x4D; // TCS34725 / TCS34727',
      '}',
      '',
      'void tcs34725_claim_bus() {',
      '  if (tcs34725_id_ok()) return; // bus is clean — don\'t touch anything',
      '  // Write the VL53L4CD\'s I2C_SLAVE__DEVICE_ADDRESS register (16-bit',
      '  // index 0x0001). Every VL53 sitting at 0x29 moves to 0x33 in one shot.',
      '  // 0x33 is a fixed "parking spot" and must stay clear of the addresses',
      '  // diagrammed ToF nodes get (0x2A, 0x2B, …); reaching 0x33 would need 9+',
      '  // ToF nodes, which the address assignment can never produce.',
      '  Wire.beginTransmission(TCS34725_ADDR);',
      '  Wire.write(0x00); Wire.write(0x01); // register index 0x0001',
      '  Wire.write(0x33);                   // new 7-bit address (parking spot)',
      '  Wire.endTransmission();',
      '  delay(2);',
      '}',
      '',
      'void tcs34725_begin(uint8_t gain) {',
      '  tcs34725_claim_bus(); // evict any undiagrammed ToF squatting on 0x29 first',
      '  tcs34725_gain_reg = gain; // remember for recovery re-init',
      '  tcs34725_write8(0x01, 0xD5); // ATIME: ~101 ms integration',
      '  tcs34725_write8(0x0F, gain); // CONTROL: RGBC gain (0x00=1x,0x01=4x,0x02=16x,0x03=60x)',
      '  tcs34725_write8(0x00, 0x01); // ENABLE: PON',
      '  delay(3);',
      '  tcs34725_write8(0x00, 0x03); // ENABLE: PON | AEN (RGBC enable)',
      '}',
      '',
      'void tcs34725_recover() {',
      '  // I2C bus-clear: a slave stuck mid-byte holds SDA low; clocking SCL up to',
      '  // 9 times lets it finish its byte and release the bus. Then re-init the',
      '  // bus and the sensor — if the sensor lost power it reboots with RGBC',
      '  // disabled and would otherwise read 0 forever.',
      '  Wire.end();',
      '  pinMode(SDA, INPUT_PULLUP);',
      '  pinMode(SCL, INPUT_PULLUP);',
      '  for (int i = 0; i < 9 && digitalRead(SDA) == LOW; i++) {',
      '    pinMode(SCL, OUTPUT); digitalWrite(SCL, LOW); delayMicroseconds(5);',
      '    pinMode(SCL, INPUT_PULLUP); delayMicroseconds(5);',
      '  }',
      '  Wire.begin();',
      '  #ifdef WIRE_HAS_TIMEOUT',
      '  Wire.setWireTimeout(3000, true);',
      '  Wire.clearWireTimeoutFlag();',
      '  #endif',
      '  // tcs34725_begin() calls tcs34725_claim_bus() first, so recovery also',
      '  // re-evicts any ToF that rebooted back onto 0x29 during the brown-out.',
      '  tcs34725_begin(tcs34725_gain_reg);',
      '}',
      '',
      '// Read CDATA/RDATA/GDATA/BDATA (8 bytes starting at 0x14) in a single',
      '// I2C transaction using the command register\'s auto-increment bit (0x20).',
      '// On any transaction failure we return the last good sample (Layer 2) and',
      '// after 10 consecutive failures run bus recovery (Layer 3).',
      'TCS34725Sample tcs34725_read_all() {',
      '  Wire.beginTransmission(TCS34725_ADDR);',
      '  Wire.write(0xA0 | 0x14); // command + auto-increment, starting at CDATAL',
      '  if (Wire.endTransmission() != 0) {',
      '    if (++tcs34725_failures >= 10) { tcs34725_recover(); tcs34725_failures = 0; }',
      '    return tcs34725_last;',
      '  }',
      '  uint8_t bytesRead = Wire.requestFrom(TCS34725_ADDR, (uint8_t)8);',
      '  if (bytesRead != 8) {',
      '    if (++tcs34725_failures >= 10) { tcs34725_recover(); tcs34725_failures = 0; }',
      '    return tcs34725_last;',
      '  }',
      '  uint8_t cl = Wire.read(); uint8_t ch = Wire.read();',
      '  uint8_t rl = Wire.read(); uint8_t rh = Wire.read();',
      '  uint8_t gl = Wire.read(); uint8_t gh = Wire.read();',
      '  uint8_t bl = Wire.read(); uint8_t bh = Wire.read();',
      '  TCS34725Sample s;',
      '  s.c = ((uint16_t)ch << 8) | cl;',
      '  s.r = ((uint16_t)rh << 8) | rl;',
      '  s.g = ((uint16_t)gh << 8) | gl;',
      '  s.b = ((uint16_t)bh << 8) | bl;',
      '  if (s.c == 0 && s.r == 0 && s.g == 0 && s.b == 0 && !tcs34725_id_ok()) {',
      '    // All-zero data with a wrong/absent ID means the bus is being fought',
      '    // over (a stray ToF rebooted back onto 0x29) — reclaim and re-init.',
      '    // Genuine darkness still passes the ID probe and flows through below.',
      '    tcs34725_begin(tcs34725_gain_reg);',
      '    return tcs34725_last;',
      '  }',
      '  tcs34725_last = s; // Layer 2: remember this good read',
      '  tcs34725_failures = 0; // reset failure streak on success',
      '  return s;',
      '}',
    ].join('\n'),
  },
};

// Setup ordering for I2C devices. ToF sensors must be readdressed off the
// default 0x29/0x52 before the TCS34725 (fixed at 0x29) is initialized, so the
// bus is unambiguous by the time the color sensor is configured.
const I2C_TYPE_ORDER: NodeTypeId[] = ['sensor-tof', 'sensor-color'];

/** Distinct I2C-device types present in this graph, in setup order. */
function i2cTypesIn(graph: WiringGraph): NodeTypeId[] {
  const seen = new Set<NodeTypeId>();
  for (const node of graph.nodes) {
    if (node.protocol === 'i2c') seen.add(node.typeId);
  }
  return [...seen].sort(
    (a, b) => I2C_TYPE_ORDER.indexOf(a) - I2C_TYPE_ORDER.indexOf(b),
  );
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
    '  // (Validation guarantees no node claims pin 13, so the LED is ours.)',
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

export interface GenerateSketchOptions {
  /** When true, emit a throttled Serial.print block at the end of loop()
   *  (before timing padding) that prints every sig_ variable at ~250 ms
   *  intervals.  Default: false. */
  serialDebug?: boolean;
}

/**
 * Collect the names of all `sig_…` variables that will be alive at the
 * bottom of loop() — one entry per single-output node and one per port for
 * multi-output nodes (sensor-color).  Ordering follows executionOrder so
 * the printed line is deterministic.
 */
function collectSignalVars(graph: WiringGraph): string[] {
  const SIG_TYPES = new Set<NodeTypeId>([
    'sensor-analog', 'sensor-digital', 'sensor-tof', 'sensor-color',
    'constant',
    'compute-threshold', 'compute-summation', 'compute-multiply', 'compute-delay',
    'compute-min', 'compute-max',
    'compute-oscillator', 'compute-noise',
  ]);
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const vars: string[] = [];
  for (const nodeId of graph.executionOrder) {
    const node = nodeMap.get(nodeId);
    if (!node || !SIG_TYPES.has(node.typeId)) continue;
    const ports = getOutputPorts(node.typeId);
    if (ports) {
      for (const port of ports as string[]) {
        vars.push(`sig_${readableId(node)}_${port}`);
      }
    } else {
      vars.push(varName(node));
    }
  }
  return vars;
}

/** Emit the serial-debug throttle block.  Inserts before loop-timing padding. */
function emitSerialDebugBlock(sigVars: string[], indent: string): string {
  const lines: string[] = [
    `${indent}// Serial debug: print signal values every 250 ms (does not affect timing)`,
    `${indent}static unsigned long _dbg_last = 0;`,
    `${indent}if (millis() - _dbg_last >= 250UL) {`,
    `${indent}  _dbg_last = millis();`,
  ];
  for (let i = 0; i < sigVars.length; i++) {
    const v = sigVars[i];
    const label = v.replace(/^sig_/, '');
    const prefix = i === 0 ? `"${label}="` : `" ${label}="`;
    lines.push(`${indent}  Serial.print(${prefix}); Serial.print(${v});`);
  }
  lines.push(`${indent}  Serial.println();`);
  lines.push(`${indent}}`);
  return lines.join('\n');
}

export function generateSketch(graph: WiringGraph, options: GenerateSketchOptions = {}): string {
  setLabelMap(buildLabelMap(graph));
  const sections: string[] = [];
  const ctx: EmitCtx = { graph, indent: '  ', loopPeriodMs: graph.loopPeriodMs };

  const i2cTypes = i2cTypesIn(graph);
  const hasI2C = i2cTypes.length > 0;
  const hasTof = graph.nodes.some((n) => n.typeId === 'sensor-tof');
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
  if (hasTof) sections.push('#include <vl53l4cd_class.h>');
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
    if (driver?.decl) {
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
  const loopLines: string[] = ['void loop() {', '  unsigned long _loopStart = millis();'];
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

  if (options.serialDebug) {
    const sigVars = collectSignalVars(graph);
    if (sigVars.length > 0) {
      loopLines.push('');
      loopLines.push(emitSerialDebugBlock(sigVars, '  '));
    }
  }

  loopLines.push('');
  loopLines.push(`  unsigned long _elapsed = millis() - _loopStart;`);
  loopLines.push(`  if (_elapsed < ${graph.loopPeriodMs}) delay(${graph.loopPeriodMs} - _elapsed);`);
  loopLines.push('}');

  sections.push(loopLines.join('\n'));
  sections.push('');

  return sections.join('\n');
}
