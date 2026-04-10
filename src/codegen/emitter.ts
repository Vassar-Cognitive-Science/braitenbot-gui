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
  if (edge.transferMode === 'nonlinear' && edge.transferPoints.length >= 2) {
    const fnIdx = graph.edges.indexOf(edge);
    const fname = `transfer_${readableEdgeId(edge.from)}_${readableEdgeId(edge.to)}_${fnIdx}`;
    return `${fname}(${varName(src)})`;
  }
  return `${varName(src)} * ${edge.weight.toFixed(4)}`;
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
    if (node.kind === 'motor' && node.typeId === 'motor') {
      if (node.motorPinFwd?.trim()) {
        lines.push(
          `const int MOTOR_${readableId(node)}_FWD = ${node.motorPinFwd.trim()};`,
        );
      }
      if (node.motorPinRev?.trim()) {
        lines.push(
          `const int MOTOR_${readableId(node)}_REV = ${node.motorPinRev.trim()};`,
        );
      }
    }
    if (node.typeId === 'servo' && node.servoPin?.trim()) {
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

  if (hasI2C) {
    lines.push('  Wire.begin();');
  }

  for (const node of graph.nodes) {
    if (node.kind === 'sensor' && node.protocol === 'digital' && node.arduinoPort?.trim()) {
      lines.push(`  pinMode(SENSOR_${readableId(node)}, INPUT);`);
    }
    if (node.kind === 'motor' && node.typeId === 'motor') {
      if (node.motorPinFwd?.trim()) {
        lines.push(`  pinMode(MOTOR_${readableId(node)}_FWD, OUTPUT);`);
      }
      if (node.motorPinRev?.trim()) {
        lines.push(`  pinMode(MOTOR_${readableId(node)}_REV, OUTPUT);`);
      }
    }
    if (node.typeId === 'servo' && node.servoPin?.trim()) {
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
  // I2C stub
  return `${indent}float ${name} = 0.0; // TODO: read I2C sensor (Wire.requestFrom)`;
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

function emitMotorWrite(
  graph: WiringGraph,
  node: GraphNode,
  indent: string,
): string {
  const lines: string[] = [];
  const sid = readableId(node);

  lines.push(emitInputAggregation(graph, node, indent));
  lines.push(
    `${indent}int pwm_${sid} = constrain((int)(fabs(${inputVar(node)}) * 255.0), 0, 255);`,
  );
  lines.push(`${indent}if (${inputVar(node)} >= 0) {`);
  lines.push(`${indent}  analogWrite(MOTOR_${sid}_FWD, pwm_${sid});`);
  lines.push(`${indent}  analogWrite(MOTOR_${sid}_REV, 0);`);
  lines.push(`${indent}} else {`);
  lines.push(`${indent}  analogWrite(MOTOR_${sid}_FWD, 0);`);
  lines.push(`${indent}  analogWrite(MOTOR_${sid}_REV, pwm_${sid});`);
  lines.push(`${indent}}`);

  return lines.join('\n');
}

function emitServoWrite(
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
  const servoNodes = graph.nodes.filter((n) => n.typeId === 'servo');
  const hasServo = servoNodes.length > 0;

  // Header
  sections.push('// --- Auto-generated by BraitenBot GUI ---');
  sections.push('// Signal convention: sensors output 0.0–1.0, internal signals -1.0–1.0');
  if (hasI2C) {
    sections.push('#include <Wire.h>');
  }
  if (hasServo) {
    sections.push('#include <Servo.h>');
  }
  sections.push('');

  // Pin declarations
  const pins = emitPinDeclarations(graph);
  if (pins) {
    sections.push(pins);
    sections.push('');
  }

  // Servo objects
  if (hasServo) {
    for (const node of servoNodes) {
      sections.push(`Servo servo_${readableId(node)};`);
    }
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
    } else if (node.typeId === 'servo') {
      loopLines.push('');
      loopLines.push(emitServoWrite(graph, node, '  '));
    } else if (node.kind === 'motor') {
      loopLines.push('');
      loopLines.push(emitMotorWrite(graph, node, '  '));
    }
  }

  loopLines.push('');
  loopLines.push(`  delay(${graph.loopPeriodMs});`);
  loopLines.push('}');

  sections.push(loopLines.join('\n'));
  sections.push('');

  return sections.join('\n');
}
