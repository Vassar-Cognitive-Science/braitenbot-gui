import type { WiringGraph, GraphNode, GraphEdge } from './graph';

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_');
}

function varName(node: GraphNode): string {
  return `sig_${sanitizeId(node.id)}`;
}

function inputVar(node: GraphNode): string {
  return `input_${sanitizeId(node.id)}`;
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
function emitTransferFunction(edge: GraphEdge, idx: number): string {
  const fname = `transfer_${sanitizeId(edge.from)}_${sanitizeId(edge.to)}_${idx}`;
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
    const fname = `transfer_${sanitizeId(edge.from)}_${sanitizeId(edge.to)}_${fnIdx}`;
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

function emitPinDeclarations(graph: WiringGraph): string {
  const lines: string[] = [];
  for (const node of graph.nodes) {
    if (node.kind === 'sensor' && node.arduinoPort?.trim()) {
      lines.push(
        `const int SENSOR_${sanitizeId(node.id)} = ${node.arduinoPort.trim()};`,
      );
    }
    if (node.kind === 'motor') {
      if (node.motorPinFwd?.trim()) {
        lines.push(
          `const int MOTOR_${sanitizeId(node.id)}_FWD = ${node.motorPinFwd.trim()};`,
        );
      }
      if (node.motorPinRev?.trim()) {
        lines.push(
          `const int MOTOR_${sanitizeId(node.id)}_REV = ${node.motorPinRev.trim()};`,
        );
      }
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
      lines.push(`  pinMode(SENSOR_${sanitizeId(node.id)}, INPUT);`);
    }
    if (node.kind === 'motor') {
      if (node.motorPinFwd?.trim()) {
        lines.push(`  pinMode(MOTOR_${sanitizeId(node.id)}_FWD, OUTPUT);`);
      }
      if (node.motorPinRev?.trim()) {
        lines.push(`  pinMode(MOTOR_${sanitizeId(node.id)}_REV, OUTPUT);`);
      }
    }
  }

  lines.push('}');
  return lines.join('\n');
}

function emitSensorRead(node: GraphNode, indent: string): string {
  const name = varName(node);
  if (node.protocol === 'analog') {
    return `${indent}float ${name} = analogRead(SENSOR_${sanitizeId(node.id)}) / 1023.0;`;
  }
  if (node.protocol === 'digital') {
    return `${indent}float ${name} = (float)digitalRead(SENSOR_${sanitizeId(node.id)});`;
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
  } else if (typeDef === 'compute-comparator') {
    const edges = incomingEdges(graph, node.id);
    const op = node.comparatorOp ?? '>';
    if (edges.length >= 2) {
      const srcA = nodeById(graph, edges[0].from);
      const srcB = nodeById(graph, edges[1].from);
      if (srcA && srcB) {
        const termA = emitEdgeTerm(graph, edges[0], srcA);
        const termB = emitEdgeTerm(graph, edges[1], srcB);
        lines.push(
          `${indent}float ${name} = ((${termA}) ${op} (${termB})) ? 1.0 : 0.0;`,
        );
      }
    } else {
      lines.push(emitInputAggregation(graph, node, indent));
      lines.push(`${indent}float ${name} = ${inputVar(node)};`);
    }
  } else if (typeDef === 'compute-summation') {
    lines.push(emitInputAggregation(graph, node, indent));
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
  const sid = sanitizeId(node.id);

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

export function generateSketch(graph: WiringGraph): string {
  const sections: string[] = [];
  const hasI2C = graph.nodes.some((n) => n.protocol === 'i2c');

  // Header
  sections.push('// --- Auto-generated by BraitenBot GUI ---');
  sections.push('// Signal convention: sensors output 0.0–1.0, internal signals -1.0–1.0');
  if (hasI2C) {
    sections.push('#include <Wire.h>');
  }
  sections.push('');

  // Pin declarations
  const pins = emitPinDeclarations(graph);
  if (pins) {
    sections.push(pins);
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
