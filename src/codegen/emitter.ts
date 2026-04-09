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
    lines.push(
      `${indent}${inputVar(node)} += ${varName(src)} * ${edge.weight.toFixed(4)};`,
    );
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
    return `${indent}int ${name} = analogRead(SENSOR_${sanitizeId(node.id)});`;
  }
  if (node.protocol === 'digital') {
    return `${indent}int ${name} = digitalRead(SENSOR_${sanitizeId(node.id)}) * 1023;`;
  }
  // I2C stub
  return `${indent}int ${name} = 0; // TODO: read I2C sensor (Wire.requestFrom)`;
}

function emitComputeNode(
  graph: WiringGraph,
  node: GraphNode,
  indent: string,
): string {
  const lines: string[] = [];
  const name = varName(node);
  const typeDef = node.typeId;

  if (typeDef === 'compute-threshold') {
    lines.push(emitInputAggregation(graph, node, indent));
    const threshold = node.threshold ?? 512;
    lines.push(
      `${indent}int ${name} = (${inputVar(node)} > ${threshold}) ? 1023 : 0;`,
    );
  } else if (typeDef === 'compute-comparator') {
    // Comparator: compare two input terms individually (not summed)
    const edges = incomingEdges(graph, node.id);
    const op = node.comparatorOp ?? '>';
    if (edges.length >= 2) {
      const srcA = nodeById(graph, edges[0].from);
      const srcB = nodeById(graph, edges[1].from);
      if (srcA && srcB) {
        const termA = `${varName(srcA)} * ${edges[0].weight.toFixed(4)}`;
        const termB = `${varName(srcB)} * ${edges[1].weight.toFixed(4)}`;
        lines.push(
          `${indent}int ${name} = ((${termA}) ${op} (${termB})) ? 1023 : 0;`,
        );
      }
    } else {
      // Fallback: should be caught by validation
      lines.push(emitInputAggregation(graph, node, indent));
      lines.push(`${indent}int ${name} = (int)${inputVar(node)};`);
    }
  } else if (typeDef === 'compute-delay') {
    lines.push(emitInputAggregation(graph, node, indent));
    const delayMs = node.delayMs ?? 100;
    lines.push(`${indent}static unsigned long ${name}_lastTime = 0;`);
    lines.push(`${indent}static int ${name}_held = 0;`);
    lines.push(`${indent}if (millis() - ${name}_lastTime >= ${delayMs}) {`);
    lines.push(`${indent}  ${name}_held = (int)${inputVar(node)};`);
    lines.push(`${indent}  ${name}_lastTime = millis();`);
    lines.push(`${indent}}`);
    lines.push(`${indent}int ${name} = ${name}_held;`);
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
    `${indent}int pwm_${sid} = constrain((int)(abs(${inputVar(node)}) * 255.0 / 1023.0), 0, 255);`,
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
    } else if (node.kind === 'compute') {
      loopLines.push('');
      loopLines.push(emitComputeNode(graph, node, '  '));
    } else if (node.kind === 'motor') {
      loopLines.push('');
      loopLines.push(emitMotorWrite(graph, node, '  '));
    }
  }

  loopLines.push('');
  loopLines.push('  delay(20);');
  loopLines.push('}');

  sections.push(loopLines.join('\n'));
  sections.push('');

  return sections.join('\n');
}
