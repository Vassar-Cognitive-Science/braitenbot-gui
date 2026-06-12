import type {
  CompoundTypeDefinition,
  DiagramNode,
  DiagramConnection,
  NodeTypeId,
  PinFieldId,
} from '../types/diagram';
import {
  TYPE_BY_ID,
  isValidOutputPort,
  getInputPorts,
} from '../types/diagram';
import { toposort, CycleError } from './toposort';

const PIN_FIELD_LABEL: Record<PinFieldId, string> = {
  arduinoPort: 'Arduino port',
  servoPin: 'pin',
  clkPin: 'CLK pin',
  gpioPin: 'GPIO pin',
};

/**
 * Pin strings are interpolated directly into the generated C source, so we
 * reject anything that isn't a plain pin reference. Accepts digit-only
 * (digital pins) or A-prefixed digits (analog pins like A0, A6).
 */
function isValidPinString(pin: string): boolean {
  return /^[Aa]?\d+$/.test(pin);
}

/**
 * Whether a given pin field will be used as a digital pin on the board.
 * The emitter always calls Serial.begin(), which claims pins 0 (RX) and 1
 * (TX), so digital-pin fields wired to those pins silently fail.
 */
function isDigitalPinField(typeId: NodeTypeId, field: PinFieldId): boolean {
  if (field === 'servoPin' || field === 'clkPin' || field === 'gpioPin') return true;
  if (field === 'arduinoPort') return typeId === 'sensor-digital';
  return false;
}

export interface ValidationError {
  nodeId?: string;
  message: string;
  severity: 'error' | 'warning';
}

/**
 * Walk the compound-type dependency graph and report any cycle (type A's
 * body references type B which references A, transitively). Cycles would
 * cause the flattener to throw at codegen time; we surface them as a
 * user-visible error here.
 */
function detectCompoundTypeRecursion(
  compoundTypes: CompoundTypeDefinition[],
): ValidationError[] {
  const errors: ValidationError[] = [];
  const byId = new Map(compoundTypes.map((c) => [c.id, c]));
  // DFS with a stack to find back-edges in the type dependency graph.
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const seenCycles = new Set<string>();
  const visit = (typeId: string, path: string[]) => {
    if (visited.has(typeId)) return;
    if (visiting.has(typeId)) {
      const cyclePath = [...path.slice(path.indexOf(typeId)), typeId].join(' → ');
      if (!seenCycles.has(cyclePath)) {
        seenCycles.add(cyclePath);
        errors.push({
          message: `Compound type recursion: ${cyclePath}`,
          severity: 'error',
        });
      }
      return;
    }
    const def = byId.get(typeId);
    if (!def) return;
    visiting.add(typeId);
    for (const node of def.body.nodes) {
      if (node.type === 'compound' && node.compoundTypeId) {
        visit(node.compoundTypeId, [...path, typeId]);
      }
    }
    visiting.delete(typeId);
    visited.add(typeId);
  };
  for (const def of compoundTypes) visit(def.id, []);
  return errors;
}

export function validateGraph(
  nodes: DiagramNode[],
  connections: DiagramConnection[],
  compoundTypes: CompoundTypeDefinition[] = [],
): ValidationError[] {
  const errors: ValidationError[] = [];

  // 0. Duplicate node labels
  // Compound instances of the same type intentionally share a label (synced
  // from the type's displayName). The emitter already disambiguates them with
  // numeric suffixes, so we only flag duplicates that aren't all the same
  // compound type.
  const labelCounts = new Map<string, DiagramNode[]>();
  for (const node of nodes) {
    const existing = labelCounts.get(node.label) ?? [];
    existing.push(node);
    labelCounts.set(node.label, existing);
  }
  for (const [label, dupes] of labelCounts) {
    if (dupes.length > 1) {
      const firstTypeId = dupes[0].compoundTypeId;
      const allSameCompound =
        firstTypeId != null &&
        dupes.every(
          (n) => n.type === 'compound' && n.compoundTypeId === firstTypeId,
        );
      if (!allSameCompound) {
        for (const node of dupes) {
          errors.push({
            nodeId: node.id,
            message: `Duplicate node name '${label}' — each node must have a unique name`,
            severity: 'error',
          });
        }
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
      } else if (isDigitalPinField(node.type, field) && (raw === '0' || raw === '1')) {
        errors.push({
          nodeId: node.id,
          message: `${typeDef.displayName} '${node.label}' uses pin ${raw}, which is reserved by Serial (RX/TX). Pick a different digital pin.`,
          severity: 'error',
        });
      } else if (isDigitalPinField(node.type, field) && raw === '13') {
        // Pin 13 drives the board's built-in LED directly on the Uno R4 (no
        // buffer like the R3 had), so the LED load corrupts signals on the
        // line. The generated USB safeguard also blinks LED_BUILTIN (= 13).
        errors.push({
          nodeId: node.id,
          message: `${typeDef.displayName} '${node.label}' uses pin 13, which is wired to the board's built-in LED. Pick a different digital pin.`,
          severity: 'error',
        });
      }
    }
  }

  // 2b. Stale fromPort / toPort references — multi-port node types declare a
  // set of ports; an edge that names a port the source/target no longer
  // exposes would silently misroute at flatten or codegen time.
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  for (const conn of connections) {
    const src = nodeById.get(conn.from);
    const dst = nodeById.get(conn.to);
    if (conn.fromPort && src && !isValidOutputPort(src.type, conn.fromPort, src, compoundTypes)) {
      errors.push({
        nodeId: src.id,
        message: `Connection from '${src.label}' references unknown output port '${conn.fromPort}'`,
        severity: 'warning',
      });
    }
    if (conn.toPort && dst) {
      const inputs = getInputPorts(dst.type, dst, compoundTypes);
      if (!inputs || !inputs.includes(conn.toPort)) {
        errors.push({
          nodeId: dst.id,
          message: `Connection to '${dst.label}' references unknown input port '${conn.toPort}'`,
          severity: 'warning',
        });
      }
    }
  }

  // 2c. Compound instances — references to unknown types, and edges that
  // touch a compound but don't name a port.
  const compoundTypeIds = new Set(compoundTypes.map((c) => c.id));
  for (const node of nodes) {
    if (node.type !== 'compound') continue;
    if (!node.compoundTypeId) {
      errors.push({
        nodeId: node.id,
        message: `Compound '${node.label}' has no type assigned`,
        severity: 'error',
      });
    } else if (!compoundTypeIds.has(node.compoundTypeId)) {
      errors.push({
        nodeId: node.id,
        message: `Compound '${node.label}' references unknown type '${node.compoundTypeId}'`,
        severity: 'error',
      });
    }
  }
  for (const conn of connections) {
    const src = nodeById.get(conn.from);
    const dst = nodeById.get(conn.to);
    if (src?.type === 'compound' && !conn.fromPort) {
      errors.push({
        nodeId: src.id,
        message: `Edge from compound '${src.label}' must specify which output port`,
        severity: 'error',
      });
    }
    if (dst?.type === 'compound' && !conn.toPort) {
      errors.push({
        nodeId: dst.id,
        message: `Edge into compound '${dst.label}' must specify which input port`,
        severity: 'error',
      });
    }
  }

  // 2d. Compound-type recursion (would cause the flattener to throw).
  errors.push(...detectCompoundTypeRecursion(compoundTypes));

  // 3. Connection limits — nodes with maxInputs must not exceed the cap.
  const incomingCounts = new Map<string, number>();
  for (const conn of connections) {
    incomingCounts.set(conn.to, (incomingCounts.get(conn.to) ?? 0) + 1);
  }
  for (const node of nodes) {
    const typeDef = TYPE_BY_ID[node.type];
    if (typeDef.maxInputs !== undefined) {
      const count = incomingCounts.get(node.id) ?? 0;
      if (count > typeDef.maxInputs) {
        errors.push({
          nodeId: node.id,
          message: `${typeDef.displayName} '${node.label}' has ${count} incoming connections but only accepts ${typeDef.maxInputs}. Use a Summation node to combine signals.`,
          severity: 'error',
        });
      }
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
