import type {
  CompoundTypeDefinition,
  DiagramConnection,
  DiagramNode,
} from '../types/diagram';

/**
 * Result of expanding every `type: 'compound'` instance into its body.
 * The returned graph contains no compound instances and no port-anchor
 * nodes — port anchors are kept but rewritten to `compute-summation`
 * pass-throughs so that edge weights and nonlinear transfers compose
 * naturally with no special boundary handling downstream.
 */
export interface FlattenResult {
  nodes: DiagramNode[];
  connections: DiagramConnection[];
}

export class CompoundCycleError extends Error {
  involvedTypeIds: string[];

  constructor(involvedTypeIds: string[]) {
    super(`Compound-type recursion detected: ${involvedTypeIds.join(' → ')}`);
    this.name = 'CompoundCycleError';
    this.involvedTypeIds = involvedTypeIds;
  }
}

/**
 * Recursively inline every compound-instance node in `nodes` using the
 * matching definition from `compoundTypes`. Inner node ids are prefixed
 * with the instance id so independent instances don't collide. External
 * edges that reference a compound instance via fromPort / toPort are
 * rewired to the corresponding (prefixed) port-anchor node inside the
 * body.
 *
 * Compound-type recursion (type A references type B which references A)
 * throws `CompoundCycleError`.
 */
export function flattenCompounds(
  nodes: DiagramNode[],
  connections: DiagramConnection[],
  compoundTypes: CompoundTypeDefinition[],
): FlattenResult {
  const typeById = new Map(compoundTypes.map((c) => [c.id, c]));
  return flattenInner(nodes, connections, typeById, []);
}

function flattenInner(
  nodes: DiagramNode[],
  connections: DiagramConnection[],
  typeById: Map<string, CompoundTypeDefinition>,
  typeStack: string[],
): FlattenResult {
  const outNodes: DiagramNode[] = [];
  const outConnections: DiagramConnection[] = [];

  // Per-instance bookkeeping for the second pass (rewriting outer edges
  // that target a compound via fromPort / toPort).
  const instanceInfo = new Map<string, { prefix: string }>();

  for (const node of nodes) {
    if (node.type !== 'compound') {
      outNodes.push(node);
      continue;
    }
    const typeId = node.compoundTypeId;
    if (!typeId) continue; // bare 'compound' with no type bound — drop
    const def = typeById.get(typeId);
    if (!def) continue; // dangling reference — drop (validator surfaces this)
    if (typeStack.includes(typeId)) {
      throw new CompoundCycleError([...typeStack, typeId]);
    }

    // Recursively flatten the body first so any nested compounds are gone
    // by the time we id-prefix and emit.
    const inner = flattenInner(def.body.nodes, def.body.connections, typeById, [
      ...typeStack,
      typeId,
    ]);

    const prefix = `${node.id}/`;
    const idRemap = new Map<string, string>();
    for (const n of inner.nodes) idRemap.set(n.id, prefix + n.id);

    for (const innerNode of inner.nodes) {
      const newId = idRemap.get(innerNode.id)!;
      // Port anchors become summation pass-throughs so weight/transfer
      // composition is automatic at the compound boundary.
      const type =
        innerNode.type === 'compound-input' || innerNode.type === 'compound-output'
          ? 'compute-summation'
          : innerNode.type;
      outNodes.push({ ...innerNode, id: newId, type });
    }

    for (const innerConn of inner.connections) {
      outConnections.push({
        ...innerConn,
        id: prefix + innerConn.id,
        from: idRemap.get(innerConn.from) ?? innerConn.from,
        to: idRemap.get(innerConn.to) ?? innerConn.to,
      });
    }

    instanceInfo.set(node.id, { prefix });
  }

  // Rewire any outer edges that referenced a compound instance. The
  // destination/source becomes the prefixed port-anchor id; the rest of
  // the edge (weight, transfer, etc.) is preserved untouched. An edge
  // that touches a compound but doesn't name a port is dropped — the
  // validator surfaces these to the user; we silently skip here.
  // Edges that don't touch a compound pass through unchanged so that
  // multi-output sources (e.g. color sensors) keep their fromPort.
  for (const conn of connections) {
    const fromInst = instanceInfo.get(conn.from);
    const toInst = instanceInfo.get(conn.to);
    if (!fromInst && !toInst) {
      outConnections.push(conn);
      continue;
    }
    if (fromInst && !conn.fromPort) continue;
    if (toInst && !conn.toPort) continue;
    const from = fromInst ? fromInst.prefix + conn.fromPort! : conn.from;
    const to = toInst ? toInst.prefix + conn.toPort! : conn.to;
    // Strip fromPort/toPort only on edges we just rewired — they pointed
    // at compound boundary ports that no longer exist after flattening.
    const { fromPort: _fp, toPort: _tp, ...rest } = conn;
    void _fp;
    void _tp;
    outConnections.push({ ...rest, from, to });
  }

  return { nodes: outNodes, connections: outConnections };
}
