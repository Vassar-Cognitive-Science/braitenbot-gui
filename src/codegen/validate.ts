import type { DiagramNode, DiagramConnection, PinFieldId } from '../types/diagram';
import { TYPE_BY_ID, isValidOutputPort } from '../types/diagram';
import { toposort, CycleError } from './toposort';

const PIN_FIELD_LABEL: Record<PinFieldId, string> = {
  arduinoPort: 'Arduino port',
  servoPin: 'pin',
  clkPin: 'CLK pin',
  dioPin: 'DIO pin',
};

/**
 * Pin strings are interpolated directly into the generated C source, so we
 * reject anything that isn't a plain pin reference. Accepts digit-only
 * (digital pins) or A-prefixed digits (analog pins like A0, A6).
 */
function isValidPinString(pin: string): boolean {
  return /^[Aa]?\d+$/.test(pin);
}

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
    (n) => TYPE_BY_ID[n.type].kind === 'compute' && !TYPE_BY_ID[n.type].hasInputs,
  );
  const outputs = nodes.filter((n) => TYPE_BY_ID[n.type].kind === 'output');

  // 1. No source nodes (sensors, constants, oscillators, or noise generators)
  if (sensors.length === 0 && constants.length === 0 && sourceCompute.length === 0) {
    errors.push({
      message: 'Diagram has no source nodes (sensors, constants, oscillators, or noise)',
      severity: 'error',
    });
  }

  // 2. Required pin fields are configured and well-formed (driven by
  // NodeTypeDefinition.pinFields). Pin strings are interpolated into the
  // generated C source, so we reject anything that isn't a plain pin.
  for (const node of nodes) {
    const typeDef = TYPE_BY_ID[node.type];
    for (const field of typeDef.pinFields ?? []) {
      const raw = node[field]?.trim();
      if (!raw) {
        errors.push({
          nodeId: node.id,
          message: `${typeDef.displayName} '${node.label}' has no ${PIN_FIELD_LABEL[field]} configured`,
          severity: 'error',
        });
      } else if (!isValidPinString(raw)) {
        errors.push({
          nodeId: node.id,
          message: `${typeDef.displayName} '${node.label}' has invalid ${PIN_FIELD_LABEL[field]} '${raw}' — must be a pin number like 9 or A0`,
          severity: 'error',
        });
      }
    }
  }

  // 2b. Stale fromPort references — multi-output node types declare a set of
  // ports; an edge that names a port the source no longer exposes would
  // silently fall back at codegen time, surprising the user.
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  for (const conn of connections) {
    if (!conn.fromPort) continue;
    const src = nodeById.get(conn.from);
    if (!src) continue;
    if (!isValidOutputPort(src.type, conn.fromPort)) {
      errors.push({
        nodeId: src.id,
        message: `Connection from '${src.label}' references unknown output port '${conn.fromPort}'`,
        severity: 'warning',
      });
    }
  }

  // 4. Output unreachable from any sensor (BFS forward from sensors)
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
  for (const output of outputs) {
    if (!reachable.has(output.id)) {
      errors.push({
        nodeId: output.id,
        message: `${TYPE_BY_ID[output.type].displayName} '${output.label}' is not connected to any sensor`,
        severity: 'error',
      });
    }
  }

  // 5. Cycle detection — cycle-breaking nodes (currently delays) read from a
  // previous loop iteration, so we strip edges into them before checking.
  // Any cycle that survives has no breaker and must be flagged.
  try {
    const nodeIds = nodes.map((n) => n.id);
    const cycleBreakerIds = new Set(
      nodes.filter((n) => TYPE_BY_ID[n.type].breaksCycles).map((n) => n.id),
    );
    const orderingEdges = connections.filter((c) => !cycleBreakerIds.has(c.to));
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

  // 6. Orphan compute nodes — types that consume inputs need at least one
  // incoming edge; every compute node needs at least one outgoing edge.
  const computeNodes = nodes.filter((n) => TYPE_BY_ID[n.type].kind === 'compute');
  for (const compute of computeNodes) {
    const requiresInputs = TYPE_BY_ID[compute.type].hasInputs ?? false;
    const hasIncoming = connections.some((c) => c.to === compute.id);
    const hasOutgoing = connections.some((c) => c.from === compute.id);
    if ((requiresInputs && !hasIncoming) || !hasOutgoing) {
      errors.push({
        nodeId: compute.id,
        message: `Compute node '${compute.label}' is not connected`,
        severity: 'warning',
      });
    }
  }

  return errors;
}
