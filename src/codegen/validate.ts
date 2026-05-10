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

  // 0. Duplicate node labels
  const labelCounts = new Map<string, DiagramNode[]>();
  for (const node of nodes) {
    const existing = labelCounts.get(node.label) ?? [];
    existing.push(node);
    labelCounts.set(node.label, existing);
  }
  for (const [label, dupes] of labelCounts) {
    if (dupes.length > 1) {
      for (const node of dupes) {
        errors.push({
          nodeId: node.id,
          message: `Duplicate node name '${label}' — each node must have a unique name`,
          severity: 'error',
        });
      }
    }
  }

  const sensors = nodes.filter((n) => TYPE_BY_ID[n.type].kind === 'sensor');
  const constants = nodes.filter((n) => TYPE_BY_ID[n.type].kind === 'constant');
  const sourceCompute = nodes.filter(
    (n) => n.type === 'compute-oscillator' || n.type === 'compute-noise',
  );
  const motors = nodes.filter((n) => TYPE_BY_ID[n.type].kind === 'motor');

  // 1. No source nodes (sensors, constants, oscillators, or noise generators)
  if (sensors.length === 0 && constants.length === 0 && sourceCompute.length === 0) {
    errors.push({
      message: 'Diagram has no source nodes (sensors, constants, oscillators, or noise)',
      severity: 'error',
    });
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

  // 3. Actuator missing pin
  for (const motor of motors) {
    if (!motor.servoPin?.trim()) {
      errors.push({
        nodeId: motor.id,
        message: `${TYPE_BY_ID[motor.type].displayName} '${motor.label}' has no pin configured`,
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
  const queue = [...sensors, ...constants, ...sourceCompute].map((s) => s.id);
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
        message: `${TYPE_BY_ID[motor.type].displayName} '${motor.label}' is not connected to any sensor`,
        severity: 'error',
      });
    }
  }

  // 5. Cycle detection — delay nodes break cycles (their output comes from
  // a previous loop iteration), so we exclude edges into delays before
  // checking. Any cycle that survives this filtering has no delay to break
  // it and must be flagged.
  try {
    const nodeIds = nodes.map((n) => n.id);
    const delayIds = new Set(
      nodes.filter((n) => n.type === 'compute-delay').map((n) => n.id),
    );
    const orderingEdges = connections.filter((c) => !delayIds.has(c.to));
    toposort(nodeIds, orderingEdges);
  } catch (err) {
    if (err instanceof CycleError) {
      for (const nodeId of err.involvedNodeIds) {
        const node = nodes.find((n) => n.id === nodeId);
        errors.push({
          nodeId,
          message: `Cycle detected involving node '${node?.label ?? nodeId}' — break the cycle by inserting a Delay node`,
          severity: 'error',
        });
      }
    }
  }

  // 6. Orphan compute nodes
  const computeNodes = nodes.filter((n) => TYPE_BY_ID[n.type].kind === 'compute');
  for (const compute of computeNodes) {
    // Oscillators and noise generators are source-like and don't take
    // inputs — only require an output.
    const requiresInputs =
      compute.type !== 'compute-oscillator' && compute.type !== 'compute-noise';
    const hasInputs = connections.some((c) => c.to === compute.id);
    const hasOutputs = connections.some((c) => c.from === compute.id);
    if ((requiresInputs && !hasInputs) || !hasOutputs) {
      errors.push({
        nodeId: compute.id,
        message: `Compute node '${compute.label}' is not connected`,
        severity: 'warning',
      });
    }
  }

  return errors;
}
