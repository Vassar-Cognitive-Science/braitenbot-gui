import { getOutputPorts } from '../types/diagram';
import type { WiringGraph, GraphNode, GraphEdge } from './graph';

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

function readableId(node: GraphNode): string {
  return _labelMap.get(node.id) ?? sanitizeId(node.id);
}

function varName(node: GraphNode): string {
  return `sig_${readableId(node)}`;
}

/**
 * Resolve the emitted source-variable suffix for a node's output port.
 * Unknown or missing ports fall back to the first declared port, which is
 * guaranteed to correspond to an emitted variable — this keeps the generated
 * sketch compilable even if a persisted diagram contains a stale `fromPort`.
 */
function srcPortSuffix(node: GraphNode, fromPort?: string): string | undefined {
  const ports = getOutputPorts(node.typeId);
  if (!ports) return undefined;
  if (fromPort && (ports as string[]).includes(fromPort)) return fromPort;
  return ports[0];
}

/**
 * The variable a downstream consumer reads for a given source node + port.
 * Multi-output nodes (currently only the TCS34725 color sensor) expose one
 * variable per channel suffixed with the port name; single-output nodes
 * fall back to the canonical `sig_` variable.
 */
function srcVarName(node: GraphNode, fromPort?: string): string {
  const suffix = srcPortSuffix(node, fromPort);
  if (suffix !== undefined) {
    return `sig_${readableId(node)}_${suffix}`;
  }
  return varName(node);
}

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
 * Input: 0–1 (normalized sensor signal). Output: -1 to 1.
 */
function readableEdgeId(nodeId: string): string {
  // Look up the readable name via the label map, fall back to sanitized raw id
  for (const [id, label] of _labelMap) {
    if (id === nodeId) return label;
  }
  return sanitizeId(nodeId);
}

function emitTransferFunction(edge: GraphEdge, idx: number): string {
  const fname = `transfer_${readableEdgeId(edge.from)}_${readableEdgeId(edge.to)}_${idx}`;
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
    const fname = `transfer_${readableEdgeId(edge.from)}_${readableEdgeId(edge.to)}_${fnIdx}`;
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

function emitPinDeclarations(graph: WiringGraph): string {
  const lines: string[] = [];
  for (const node of graph.nodes) {
    if (node.kind === 'sensor' && node.arduinoPort?.trim()) {
      lines.push(
        `const int SENSOR_${readableId(node)} = ${node.arduinoPort.trim()};`,
      );
    }
    if (node.kind === 'motor' && node.servoPin?.trim()) {
      lines.push(
        `const int SERVO_${readableId(node)}_PIN = ${node.servoPin.trim()};`,
      );
    }
  }
  return lines.join('\n');
}

function emitSetup(graph: WiringGraph): string {
  const lines: string[] = [];
  const hasI2C = graph.nodes.some((n) => n.protocol === 'i2c');

  lines.push('void setup() {');
  lines.push('  Serial.begin(115200);');

  const hasColor = graph.nodes.some((n) => n.typeId === 'sensor-color');

  if (hasI2C) {
    lines.push('  Wire.begin();');
  }
  if (hasColor) {
    lines.push('  tcs34725_begin();');
  }

  for (const node of graph.nodes) {
    if (node.kind === 'sensor' && node.protocol === 'digital' && node.arduinoPort?.trim()) {
      lines.push(`  pinMode(SENSOR_${readableId(node)}, INPUT);`);
    }
    if (node.kind === 'motor' && node.servoPin?.trim()) {
      lines.push(`  servo_${readableId(node)}.attach(SERVO_${readableId(node)}_PIN);`);
    }
  }

  lines.push('}');
  return lines.join('\n');
}

function emitSensorRead(node: GraphNode, indent: string): string {
  const name = varName(node);
  if (node.protocol === 'analog') {
    return `${indent}float ${name} = analogRead(SENSOR_${readableId(node)}) / 1023.0;`;
  }
  if (node.protocol === 'digital') {
    return `${indent}float ${name} = (float)digitalRead(SENSOR_${readableId(node)});`;
  }
  if (node.typeId === 'sensor-color') {
    // One bulk I2C read per loop; each channel is exposed as its own
    // variable so downstream edges can pick via their fromPort.
    const rid = readableId(node);
    return [
      `${indent}TCS34725Sample sample_${rid} = tcs34725_read_all();`,
      `${indent}float sig_${rid}_clear = sample_${rid}.c / 65535.0;`,
      `${indent}float sig_${rid}_red   = sample_${rid}.r / 65535.0;`,
      `${indent}float sig_${rid}_green = sample_${rid}.g / 65535.0;`,
      `${indent}float sig_${rid}_blue  = sample_${rid}.b / 65535.0;`,
    ].join('\n');
  }
  return `${indent}float ${name} = 0.0;`;
}

function emitTcs34725Driver(): string {
  return [
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
  ].join('\n');
}

function emitComputeNode(
  graph: WiringGraph,
  node: GraphNode,
  indent: string,
  loopPeriodMs: number,
): string {
  const lines: string[] = [];
  const name = varName(node);
  const typeDef = node.typeId;

  if (typeDef === 'compute-threshold') {
    lines.push(emitInputAggregation(graph, node, indent));
    const threshold = node.threshold ?? 0.5;
    lines.push(
      `${indent}float ${name} = (${inputVar(node)} > ${threshold.toFixed(4)}) ? 1.0 : 0.0;`,
    );
  } else if (typeDef === 'compute-summation') {
    lines.push(emitInputAggregation(graph, node, indent));
    lines.push(`${indent}float ${name} = ${inputVar(node)};`);
  } else if (typeDef === 'compute-multiply') {
    lines.push(emitProductAggregation(graph, node, indent));
    lines.push(`${indent}float ${name} = ${inputVar(node)};`);
  } else if (typeDef === 'compute-delay') {
    lines.push(emitInputAggregation(graph, node, indent));
    const delayMs = node.delayMs ?? 100;
    const bufSize = Math.max(1, Math.round(delayMs / loopPeriodMs));
    lines.push(`${indent}static const int ${name}_BUF_SIZE = ${bufSize};`);
    lines.push(`${indent}static float ${name}_buf[${bufSize}] = {0};`);
    lines.push(`${indent}static int ${name}_idx = 0;`);
    lines.push(`${indent}float ${name} = ${name}_buf[${name}_idx];`);
    lines.push(`${indent}${name}_buf[${name}_idx] = ${inputVar(node)};`);
    lines.push(`${indent}${name}_idx = (${name}_idx + 1) % ${name}_BUF_SIZE;`);
  }

  return lines.join('\n');
}

function emitWheelWrite(
  graph: WiringGraph,
  node: GraphNode,
  indent: string,
): string {
  // Wheels aggregate their weighted inputs; drive() below consumes both
  // aggregated signals once per loop with right-wheel inversion.
  return emitInputAggregation(graph, node, indent);
}

function emitCrServoWrite(
  graph: WiringGraph,
  node: GraphNode,
  indent: string,
): string {
  const lines: string[] = [];
  const sid = readableId(node);
  lines.push(emitInputAggregation(graph, node, indent));
  lines.push(
    `${indent}int us_${sid} = 1500 + (int)(constrain(${inputVar(node)}, -1.0, 1.0) * 500.0);`,
  );
  lines.push(`${indent}servo_${sid}.writeMicroseconds(us_${sid});`);
  return lines.join('\n');
}

function emitDriveHelper(leftWheel: GraphNode, rightWheel: GraphNode): string {
  const left = readableId(leftWheel);
  const right = readableId(rightWheel);
  return [
    '// Drive both wheel continuous servos. left/right are -1.0..1.0 (signed speed).',
    '// The right servo is mounted mirrored, so its direction is inverted.',
    'void drive(float left, float right) {',
    '  left  = constrain(left,  -1.0, 1.0);',
    '  right = constrain(right, -1.0, 1.0);',
    `  servo_${left}.writeMicroseconds(1500 + (int)(left  * 500.0));`,
    `  servo_${right}.writeMicroseconds(1500 - (int)(right * 500.0));`,
    '}',
  ].join('\n');
}

function emitPositionalServoWrite(
  graph: WiringGraph,
  node: GraphNode,
  indent: string,
): string {
  const lines: string[] = [];
  const sid = readableId(node);

  lines.push(emitInputAggregation(graph, node, indent));
  lines.push(
    `${indent}int angle_${sid} = constrain((int)((${inputVar(node)} + 1.0) * 0.5 * 180.0), 0, 180);`,
  );
  lines.push(`${indent}servo_${sid}.write(angle_${sid});`);

  return lines.join('\n');
}

export function generateSketch(graph: WiringGraph): string {
  setLabelMap(buildLabelMap(graph));
  const sections: string[] = [];
  const hasI2C = graph.nodes.some((n) => n.protocol === 'i2c');
  const hasColor = graph.nodes.some((n) => n.typeId === 'sensor-color');
  const actuatorNodes = graph.nodes.filter((n) => n.kind === 'motor');
  const leftWheel = graph.nodes.find((n) => n.id === 'motor-left');
  const rightWheel = graph.nodes.find((n) => n.id === 'motor-right');
  const hasActuator = actuatorNodes.length > 0;
  const hasDrive = !!(leftWheel && rightWheel);

  // Header
  sections.push('// --- Auto-generated by BraitenBot GUI ---');
  sections.push('// Signal convention: sensors output 0.0–1.0, internal signals -1.0–1.0');
  if (hasI2C) {
    sections.push('#include <Wire.h>');
  }
  if (hasActuator) {
    sections.push('#include <Servo.h>');
  }
  sections.push('');

  // Pin declarations
  const pins = emitPinDeclarations(graph);
  if (pins) {
    sections.push(pins);
    sections.push('');
  }

  // TCS34725 driver — emitted once when any color sensor is used.
  if (hasColor) {
    sections.push(emitTcs34725Driver());
    sections.push('');
  }

  // Servo objects — every actuator (wheels, continuous servos, positional
  // servos) is driven through Servo.h.
  if (hasActuator) {
    for (const node of actuatorNodes) {
      sections.push(`Servo servo_${readableId(node)};`);
    }
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
  sections.push(emitSetup(graph));
  sections.push('');

  // loop()
  const loopLines: string[] = [];
  loopLines.push('void loop() {');

  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  for (const nodeId of graph.executionOrder) {
    const node = nodeMap.get(nodeId);
    if (!node) continue;

    if (node.kind === 'sensor') {
      loopLines.push(emitSensorRead(node, '  '));
    } else if (node.kind === 'constant') {
      const val = node.constantValue ?? 0.5;
      loopLines.push(`  float ${varName(node)} = ${val.toFixed(4)};`);
    } else if (node.kind === 'compute') {
      loopLines.push('');
      loopLines.push(emitComputeNode(graph, node, '  ', graph.loopPeriodMs));
    } else if (node.typeId === 'servo-positional') {
      loopLines.push('');
      loopLines.push(emitPositionalServoWrite(graph, node, '  '));
    } else if (node.typeId === 'servo-cr') {
      loopLines.push('');
      if (node.id === 'motor-left' || node.id === 'motor-right') {
        loopLines.push(emitWheelWrite(graph, node, '  '));
      } else {
        loopLines.push(emitCrServoWrite(graph, node, '  '));
      }
    }
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
