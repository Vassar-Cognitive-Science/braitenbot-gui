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
import { flattenCompounds } from './flatten';

const PIN_FIELD_LABEL: Record<PinFieldId, string> = {
  arduinoPort: 'Arduino port',
  servoPin: 'pin',
  clkPin: 'CLK pin',
  gpioPin: 'GPIO pin',
  xshutPin: 'XSHUT pin',
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
  if (field === 'servoPin' || field === 'clkPin' || field === 'gpioPin' || field === 'xshutPin') return true;
  if (field === 'arduinoPort') return typeId === 'sensor-digital';
  return false;
}

/**
 * Canonical identity for a configured pin, used to detect two nodes claiming
 * the same physical pin. Analog pins (A-prefixed, or a bare number on an
 * analog field) are keyed with an `A` prefix so they never collide with the
 * same-numbered digital pin — A0 and digital 0 are different pins.
 */
function canonicalPin(typeId: NodeTypeId, field: PinFieldId, raw: string): string {
  const upper = raw.toUpperCase();
  if (upper.startsWith('A')) return upper;
  // Bare number: analog fields address the A-bank, digital fields the digital bank.
  return isDigitalPinField(typeId, field) ? upper : `A${upper}`;
}

/** Top-level node id owning a (possibly compound-prefixed) flattened id. */
function topLevelId(flatId: string): string {
  return flatId.split('/')[0];
}

/**
 * Friendly label for a flattened node id. Top-level nodes use their label;
 * nodes that came from a compound body are shown as a path through the
 * instance labels, e.g. `Gain ▸ Sensor`, so students can find them.
 * Falls back to the raw id if the path can't be resolved.
 */
function friendlyLabel(
  flatId: string,
  topNodes: DiagramNode[],
  compoundTypes: CompoundTypeDefinition[],
): string {
  const segments = flatId.split('/');
  const parts: string[] = [];
  let bodyNodes = topNodes;
  for (let i = 0; i < segments.length; i++) {
    const node: DiagramNode | undefined = bodyNodes.find((n) => n.id === segments[i]);
    if (!node) return flatId;
    parts.push(node.label);
    if (i < segments.length - 1) {
      const def = compoundTypes.find((c) => c.id === node.compoundTypeId);
      if (!def) return flatId;
      bodyNodes = def.body.nodes;
    }
  }
  return parts.join(' ▸ ');
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

  // 0. Duplicate node labels — advisory only. The emitter disambiguates
  // duplicate labels with numeric suffixes, so generated code is always
  // valid; duplicates are just ambiguous to read in validation messages,
  // the trace view, and the scope channel list. Compound instances of the
  // same type intentionally share a label (synced from the type's
  // displayName), so those aren't flagged at all.
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
            message: `Duplicate node name '${label}' — rename for clarity (generated code stays valid)`,
            severity: 'warning',
          });
        }
      }
    }
  }

  // NOTE: Per-node pin checks (presence/format/reserved, duplicate pins) and
  // the structural checks (source presence, reachability, cycles) all run on
  // the FLATTENED graph further below, so nodes inside compound bodies are
  // covered. The checks between here and there are authoring-level and operate
  // on the top-level (unflattened) graph.

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

  // --- Flattened-graph checks ------------------------------------------------
  // Expand compound bodies so per-node and structural checks see inside them.
  // A source/oscillator inside a compound is a legitimate signal source, and a
  // delay inside a compound legitimately breaks a cycle — neither is visible on
  // the top-level graph, so these checks run on the flattened graph and map
  // prefixed ids back to friendly labels when reporting.
  let flatNodes = nodes;
  let flatConnections = connections;
  try {
    const flat = flattenCompounds(nodes, connections, compoundTypes);
    flatNodes = flat.nodes;
    flatConnections = flat.connections;
  } catch {
    // flattenCompounds only throws on compound-type recursion, already surfaced
    // by 2d. Fall back to the authored graph so the remaining checks still run.
  }
  const flatNodeById = new Map(flatNodes.map((n) => [n.id, n]));
  const label = (id: string) => friendlyLabel(id, nodes, compoundTypes);

  const flatSensors = flatNodes.filter((n) => TYPE_BY_ID[n.type].kind === 'sensor');
  const flatConstants = flatNodes.filter((n) => TYPE_BY_ID[n.type].kind === 'constant');
  const flatSourceCompute = flatNodes.filter(
    (n) => TYPE_BY_ID[n.type].kind === 'compute' && !TYPE_BY_ID[n.type].hasInputs,
  );
  const flatOutputs = flatNodes.filter((n) => TYPE_BY_ID[n.type].kind === 'output');

  // 1. No source nodes anywhere (top level or inside a compound body).
  if (flatSensors.length === 0 && flatConstants.length === 0 && flatSourceCompute.length === 0) {
    errors.push({
      message: 'Diagram has no source nodes (sensors, constants, oscillators, or noise)',
      severity: 'error',
    });
  }

  // 2. Required pin fields are configured and well-formed (driven by
  // NodeTypeDefinition.pinFields). Pin strings are interpolated into the
  // generated C source, so we reject anything that isn't a plain pin. Runs on
  // the flattened graph so pins inside compound bodies are covered too.
  for (const node of flatNodes) {
    const typeDef = TYPE_BY_ID[node.type];
    const name = label(node.id);
    const errNodeId = topLevelId(node.id);
    for (const field of typeDef.pinFields ?? []) {
      const raw = node[field]?.trim();
      if (!raw) {
        errors.push({
          nodeId: errNodeId,
          message: `${typeDef.displayName} '${name}' has no ${PIN_FIELD_LABEL[field]} configured`,
          severity: 'error',
        });
      } else if (!isValidPinString(raw)) {
        errors.push({
          nodeId: errNodeId,
          message: `${typeDef.displayName} '${name}' has invalid ${PIN_FIELD_LABEL[field]} '${raw}' — must be a pin number like 9 or A0`,
          severity: 'error',
        });
      } else if (isDigitalPinField(node.type, field) && (raw === '0' || raw === '1')) {
        errors.push({
          nodeId: errNodeId,
          message: `${typeDef.displayName} '${name}' uses pin ${raw}, which is reserved by Serial (RX/TX). Pick a different digital pin.`,
          severity: 'error',
        });
      } else if (isDigitalPinField(node.type, field) && raw === '13') {
        // Pin 13 drives the board's built-in LED directly on the Uno R4 (no
        // buffer like the R3 had), so the LED load corrupts signals on the
        // line. The generated USB safeguard also blinks LED_BUILTIN (= 13).
        errors.push({
          nodeId: errNodeId,
          message: `${typeDef.displayName} '${name}' uses pin 13, which is wired to the board's built-in LED. Pick a different digital pin.`,
          severity: 'error',
        });
      }
    }
  }

  // 2e. Duplicate pins — two nodes (or two fields of one node) claiming the
  // same physical pin emit conflicting pinMode/attach code. Collect every
  // well-formed pin across all pin fields of all flattened nodes and flag
  // shared ones. Analog and digital pins of the same number don't collide.
  const pinUsers = new Map<
    string,
    { nodeId: string; name: string; typeDef: (typeof TYPE_BY_ID)[NodeTypeId]; field: PinFieldId }[]
  >();
  for (const node of flatNodes) {
    const typeDef = TYPE_BY_ID[node.type];
    for (const field of typeDef.pinFields ?? []) {
      const raw = node[field]?.trim();
      if (!raw || !isValidPinString(raw)) continue;
      const key = canonicalPin(node.type, field, raw);
      const users = pinUsers.get(key) ?? [];
      users.push({ nodeId: node.id, name: label(node.id), typeDef, field });
      pinUsers.set(key, users);
    }
  }
  for (const [pin, users] of pinUsers) {
    if (users.length < 2) continue;
    const allSameNode = users.every((u) => u.nodeId === users[0].nodeId);
    const display = pin.startsWith('A') && !isDigitalPinField(users[0].typeDef.id, users[0].field)
      ? pin
      : pin.replace(/^A/, '');
    if (allSameNode) {
      const fields = users.map((u) => PIN_FIELD_LABEL[u.field]);
      errors.push({
        nodeId: topLevelId(users[0].nodeId),
        message: `${users[0].typeDef.displayName} '${users[0].name}' uses pin ${display} for both its ${fields[0]} and ${fields[1]}`,
        severity: 'error',
      });
    } else {
      const names = [...new Set(users.map((u) => `'${u.name}'`))];
      errors.push({
        nodeId: topLevelId(users[0].nodeId),
        message: `Pin conflict: ${names.join(' and ')} all use pin ${display}. Each pin can drive only one node.`,
        severity: 'error',
      });
    }
  }

  // 2f. Dangling edges — a connection whose endpoint doesn't resolve to a node
  // (e.g. a stale imported diagram referencing a deleted node). Left unchecked
  // these crash toposort/codegen; here we report them clearly.
  for (const conn of flatConnections) {
    const fromKnown = flatNodeById.has(conn.from);
    const toKnown = flatNodeById.has(conn.to);
    if (fromKnown && toKnown) continue;
    let message: string;
    if (!fromKnown && !toKnown) {
      message = 'Connection references deleted or unknown nodes — delete and redraw it';
    } else if (!fromKnown) {
      message = `Connection into '${label(conn.to)}' comes from a deleted or unknown node — delete and redraw it`;
    } else {
      message = `Connection out of '${label(conn.from)}' goes to a deleted or unknown node — delete and redraw it`;
    }
    errors.push({ message, severity: 'error' });
  }

  // 4. Output unreachable from any source (BFS forward from all sources).
  const reachable = new Set<string>();
  const adjacency = new Map<string, string[]>();
  for (const node of flatNodes) {
    adjacency.set(node.id, []);
  }
  for (const conn of flatConnections) {
    adjacency.get(conn.from)?.push(conn.to);
  }
  const queue = [...flatSensors, ...flatConstants, ...flatSourceCompute].map((s) => s.id);
  for (const id of queue) {
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const neighbor of adjacency.get(id) ?? []) {
      queue.push(neighbor);
    }
  }
  for (const output of flatOutputs) {
    if (!reachable.has(output.id)) {
      errors.push({
        nodeId: topLevelId(output.id),
        message: `${TYPE_BY_ID[output.type].displayName} '${label(output.id)}' is not connected to any sensor`,
        severity: 'error',
      });
    }
  }

  // 5. Cycle detection — cycle-breaking nodes (currently delays) read from a
  // previous loop iteration, so we strip edges into them before checking.
  // Any cycle that survives has no breaker and must be flagged. Runs on the
  // flattened graph so a delay inside a compound body counts as a breaker.
  try {
    const nodeIds = flatNodes.map((n) => n.id);
    const cycleBreakerIds = new Set(
      flatNodes.filter((n) => TYPE_BY_ID[n.type].breaksCycles).map((n) => n.id),
    );
    const orderingEdges = flatConnections.filter((c) => !cycleBreakerIds.has(c.to));
    toposort(nodeIds, orderingEdges);
  } catch (err) {
    if (err instanceof CycleError) {
      const reported = new Set<string>();
      for (const nodeId of err.involvedNodeIds) {
        const top = topLevelId(nodeId);
        if (reported.has(top)) continue;
        reported.add(top);
        errors.push({
          nodeId: top,
          message: `Cycle detected involving node '${label(nodeId)}' — break the cycle by inserting a Delay node`,
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
