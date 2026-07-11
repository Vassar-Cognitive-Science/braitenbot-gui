import * as Y from 'yjs';
import type {
  CompoundTypeDefinition,
  DiagramComment,
  DiagramConnection,
  DiagramNode,
} from '../types/diagram';

// Plain <-> Yjs conversion. Each node/connection is a nested Y.Map keyed by its
// own property names so concurrent edits to different properties merge cleanly.
// `transferPoints` is stored as a single plain-JSON entry (replaced wholesale on
// curve edits), which is fine per the design.

function fillYMap(target: Y.Map<unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) target.set(key, value);
  }
}

export function nodeToYMap(node: DiagramNode): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  fillYMap(map, node as unknown as Record<string, unknown>);
  return map;
}

export function connectionToYMap(connection: DiagramConnection): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  fillYMap(map, connection as unknown as Record<string, unknown>);
  return map;
}

export function commentToYMap(comment: DiagramComment): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  fillYMap(map, comment as unknown as Record<string, unknown>);
  return map;
}

// A container Y.Map<Y.Map> keyed by entity id, built from a plain array. Order
// follows the array; Y.Map preserves insertion order, so downstream ordering
// (compound port order, render order) matches the source arrays.
function entitiesToYMap<T extends { id: string }>(
  items: T[],
  toYMap: (item: T) => Y.Map<unknown>,
): Y.Map<Y.Map<unknown>> {
  const container = new Y.Map<Y.Map<unknown>>();
  for (const item of items) container.set(item.id, toYMap(item));
  return container;
}

export function compoundTypeToYMap(def: CompoundTypeDefinition): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  map.set('displayName', def.displayName);
  map.set('nodes', entitiesToYMap(def.body.nodes, nodeToYMap));
  map.set('connections', entitiesToYMap(def.body.connections, connectionToYMap));
  return map;
}

export function readNode(map: Y.Map<unknown>): DiagramNode {
  return map.toJSON() as DiagramNode;
}

export function readConnection(map: Y.Map<unknown>): DiagramConnection {
  return map.toJSON() as DiagramConnection;
}

// Read order is sorted by key (entity id), NOT Y.Map iteration order: iteration
// order is not guaranteed identical across peers after concurrent inserts, and
// every peer must derive the same arrays (render z-order, compound port
// enumeration) from the same doc. Compound port anchors ('in', 'in_2', ...)
// keep a sensible order under an id sort; render z-order becomes id-order
// rather than insertion-recency — an accepted alpha tradeoff.
function sortedMaps<T>(container: Y.Map<T>): T[] {
  return [...container.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, map]) => map);
}

export function readNodes(container: Y.Map<Y.Map<unknown>>): DiagramNode[] {
  return sortedMaps(container).map(readNode);
}

export function readConnections(container: Y.Map<Y.Map<unknown>>): DiagramConnection[] {
  return sortedMaps(container).map(readConnection);
}

export function readComment(map: Y.Map<unknown>): DiagramComment {
  return map.toJSON() as DiagramComment;
}

export function readComments(container: Y.Map<Y.Map<unknown>>): DiagramComment[] {
  return sortedMaps(container).map(readComment);
}

export function readCompoundType(id: string, map: Y.Map<unknown>): CompoundTypeDefinition {
  const nodes = map.get('nodes') as Y.Map<Y.Map<unknown>>;
  const connections = map.get('connections') as Y.Map<Y.Map<unknown>>;
  return {
    id,
    displayName: (map.get('displayName') as string) ?? id,
    body: {
      nodes: nodes ? readNodes(nodes) : [],
      connections: connections ? readConnections(connections) : [],
    },
  };
}

// Populate all four top-level containers from a plain diagram state. Callers
// wrap this in a transaction; it clears existing content first.
export function loadDiagramInto(
  nodes: Y.Map<Y.Map<unknown>>,
  connections: Y.Map<Y.Map<unknown>>,
  compoundTypes: Y.Map<Y.Map<unknown>>,
  comments: Y.Map<Y.Map<unknown>>,
  meta: Y.Map<unknown>,
  state: {
    nodes: DiagramNode[];
    connections: DiagramConnection[];
    compoundTypes: CompoundTypeDefinition[];
    comments: DiagramComment[];
    loopPeriodMs: number;
  },
): void {
  nodes.clear();
  connections.clear();
  compoundTypes.clear();
  comments.clear();
  for (const node of state.nodes) nodes.set(node.id, nodeToYMap(node));
  for (const connection of state.connections) {
    connections.set(connection.id, connectionToYMap(connection));
  }
  for (const def of state.compoundTypes) {
    compoundTypes.set(def.id, compoundTypeToYMap(def));
  }
  for (const comment of state.comments) {
    comments.set(comment.id, commentToYMap(comment));
  }
  meta.set('loopPeriodMs', state.loopPeriodMs);
}
