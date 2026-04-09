import type { DiagramNode, DiagramConnection } from '../types/diagram';
import { TYPE_BY_ID } from '../types/diagram';
import { toposort, CycleError } from './toposort';

export interface ValidationError {
  nodeId?: string;
  message: string;
  severity: 'error' | 'warning';
}

export function validateGraph(
  nodes: DiagramNode[],
  connections: DiagramConnection[],
): ValidationError[] {
  const errors: ValidationError[] = [];

  const sensors = nodes.filter((n) => TYPE_BY_ID[n.type].kind === 'sensor');
  const constants = nodes.filter((n) => TYPE_BY_ID[n.type].kind === 'constant');
  const motors = nodes.filter((n) => TYPE_BY_ID[n.type].kind === 'motor');

  // 1. No source nodes (sensors or constants)
  if (sensors.length === 0 && constants.length === 0) {
    errors.push({ message: 'Diagram has no source nodes (sensors or constants)', severity: 'error' });
  }

  // 2. Sensor missing arduinoPort
  for (const sensor of sensors) {
    const typeDef = TYPE_BY_ID[sensor.type];
    if (
      (typeDef.protocol === 'analog' || typeDef.protocol === 'digital') &&
      !sensor.arduinoPort?.trim()
    ) {
      errors.push({
        nodeId: sensor.id,
        message: `Sensor '${sensor.label}' has no Arduino port configured`,
        severity: 'error',
      });
    }
  }

  // 3. Motor missing pins
  for (const motor of motors) {
    if (!motor.motorPinFwd?.trim() || !motor.motorPinRev?.trim()) {
      errors.push({
        nodeId: motor.id,
        message: `Motor '${motor.label}' has no pin configured for forward/reverse`,
        severity: 'error',
      });
    }
  }

  // 4. Motor unreachable from any sensor (BFS forward from sensors)
  const reachable = new Set<string>();
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) {
    adjacency.set(node.id, []);
  }
  for (const conn of connections) {
    adjacency.get(conn.from)?.push(conn.to);
  }
  const queue = [...sensors, ...constants].map((s) => s.id);
  for (const id of queue) {
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const neighbor of adjacency.get(id) ?? []) {
      queue.push(neighbor);
    }
  }
  for (const motor of motors) {
    if (!reachable.has(motor.id)) {
      errors.push({
        nodeId: motor.id,
        message: `Motor '${motor.label}' is not connected to any sensor`,
        severity: 'error',
      });
    }
  }

  // 5. Cycle detection
  try {
    const nodeIds = nodes.map((n) => n.id);
    toposort(nodeIds, connections);
  } catch (err) {
    if (err instanceof CycleError) {
      for (const nodeId of err.involvedNodeIds) {
        const node = nodes.find((n) => n.id === nodeId);
        errors.push({
          nodeId,
          message: `Cycle detected involving node '${node?.label ?? nodeId}'`,
          severity: 'error',
        });
      }
    }
  }

  // 6. Comparator with fewer than 2 inputs
  const comparators = nodes.filter((n) => TYPE_BY_ID[n.type].mode === 'comparator');
  for (const comp of comparators) {
    const inputCount = connections.filter((c) => c.to === comp.id).length;
    if (inputCount < 2) {
      errors.push({
        nodeId: comp.id,
        message: `Comparator '${comp.label}' requires exactly 2 inputs (has ${inputCount})`,
        severity: 'error',
      });
    }
  }

  // 7. Orphan compute nodes
  const computeNodes = nodes.filter((n) => TYPE_BY_ID[n.type].kind === 'compute');
  for (const compute of computeNodes) {
    const hasInputs = connections.some((c) => c.to === compute.id);
    const hasOutputs = connections.some((c) => c.from === compute.id);
    if (!hasInputs || !hasOutputs) {
      errors.push({
        nodeId: compute.id,
        message: `Compute node '${compute.label}' is not connected`,
        severity: 'warning',
      });
    }
  }

  // 8. I2C sensor warning
  const i2cSensors = nodes.filter((n) => n.type === 'sensor-i2c');
  for (const sensor of i2cSensors) {
    errors.push({
      nodeId: sensor.id,
      message: `I2C sensor '${sensor.label}' will generate stub code — manual editing required`,
      severity: 'warning',
    });
  }

  return errors;
}
