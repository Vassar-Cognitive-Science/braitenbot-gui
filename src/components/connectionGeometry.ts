import type { CompoundTypeDefinition, DiagramConnection, DiagramNode, OutputPortId } from '../types/diagram';
import { getInputPorts, getOutputPorts } from '../types/diagram';

/**
 * Pure geometry/stroke helpers for rendering diagram connections. Extracted
 * from BraitenbergDiagram so the docs site's InteractiveDiagram can reuse the
 * exact same presentational math — single source for rendering, like the
 * simulation core in hooks/useTraceSimulation.
 */

export const NODE_W = 148;
export const NODE_H = 64;

export function makePath(x1: number, y1: number, x2: number, y2: number): string {
  const c1 = y1 + 60;
  const c2 = y2 - 60;
  return `M ${x1} ${y1} C ${x1} ${c1}, ${x2} ${c2}, ${x2} ${y2}`;
}

/**
 * Evaluate the connection cubic bézier at parameter t ∈ [0, 1]. Control points
 * mirror makePath: P0=(x1,y1), P1=(x1,y1+60), P2=(x2,y2−60), P3=(x2,y2).
 */
export function bezierPointAt(
  x1: number, y1: number, x2: number, y2: number, t: number,
): { x: number; y: number } {
  const c1y = y1 + 60;
  const c2y = y2 - 60;
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * x1 + b * x1 + c * x2 + d * x2,
    y: a * y1 + b * c1y + c * c2y + d * y2,
  };
}

/**
 * Project a point onto the connection curve by sampling and returning the
 * nearest parameter t, clamped to [0.1, 0.9] so the badge stays off the
 * endpoints. Sampling ~64 points is plenty for a smooth cubic.
 */
export function nearestTOnCurve(
  x1: number, y1: number, x2: number, y2: number, px: number, py: number,
): number {
  const SAMPLES = 64;
  let bestT = 0.5;
  let bestDist = Infinity;
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const p = bezierPointAt(x1, y1, x2, y2, t);
    const dist = (p.x - px) * (p.x - px) + (p.y - py) * (p.y - py);
    if (dist < bestDist) {
      bestDist = dist;
      bestT = t;
    }
  }
  return Math.max(0.1, Math.min(0.9, bestT));
}

/**
 * Default badge parameter t for a connection given its position `index` among
 * `count` parallel edges between the same node pair. A lone edge sits at 0.5;
 * parallel edges spread apart (2 → 0.35/0.65, 3 → 0.3/0.5/0.7) so their badges
 * don't overlap. Clamped to [0.3, 0.7] for larger groups.
 */
export function staggeredLabelT(index: number, count: number): number {
  if (count <= 1) return 0.5;
  const step = 0.6 / count;
  const t = 0.5 + (index - (count - 1) / 2) * step;
  return Math.max(0.3, Math.min(0.7, t));
}

/**
 * Horizontal offset (px, in canvas space) of the output anchor for a given
 * port. `scale` is the current block scale so the endpoint lands on the
 * handle, which CSS positions at a percentage of the (scaled) node width.
 */
export function portOffsetX(
  node: DiagramNode,
  fromPort?: OutputPortId,
  compoundTypes?: CompoundTypeDefinition[],
  scale = 1,
): number {
  const ports = getOutputPorts(node.type, node, compoundTypes);
  if (!ports || ports.length === 0) return (NODE_W / 2) * scale;
  const idx = fromPort ? ports.indexOf(fromPort) : -1;
  const i = idx >= 0 ? idx : 0;
  return ((i + 0.5) / ports.length) * NODE_W * scale;
}

/**
 * Horizontal offset (px, in canvas space) of the input anchor for a given
 * port. See `portOffsetX` for the `scale` argument.
 */
export function inputPortOffsetX(
  node: DiagramNode,
  toPort?: string,
  compoundTypes?: CompoundTypeDefinition[],
  scale = 1,
): number {
  const ports = getInputPorts(node.type, node, compoundTypes);
  if (!ports || ports.length === 0) return (NODE_W / 2) * scale;
  const idx = toPort ? ports.indexOf(toPort) : -1;
  const i = idx >= 0 ? idx : 0;
  return ((i + 0.5) / ports.length) * NODE_W * scale;
}

export function weightToColor(weight: number): string {
  // Warm ink-like tones: positive → muted green, negative → muted rust
  if (weight >= 0) {
    const t = weight;
    const r = Math.round(70 + 10 * (1 - t));
    const g = Math.round(80 + 90 * t);
    const b = Math.round(50 + 20 * (1 - t));
    return `rgb(${r},${g},${b})`;
  } else {
    const t = -weight;
    const r = Math.round(90 + 110 * t);
    const g = Math.round(80 * (1 - t));
    const b = Math.round(50 * (1 - t));
    return `rgb(${r},${g},${b})`;
  }
}

export function signalToStroke(signal: number): { color: string; width: number; opacity: number } {
  const abs = Math.min(Math.abs(signal), 1);
  const width = 1.2 + abs * 2.5;
  const opacity = 0.4 + abs * 0.6;
  if (signal >= 0) {
    const r = Math.round(70 + 10 * (1 - abs));
    const g = Math.round(100 + 70 * abs);
    const b = Math.round(50 + 20 * (1 - abs));
    return { color: `rgb(${r},${g},${b})`, width, opacity };
  } else {
    const r = Math.round(130 + 70 * abs);
    const g = Math.round(90 * (1 - abs));
    const b = Math.round(50 * (1 - abs));
    return { color: `rgb(${r},${g},${b})`, width, opacity };
  }
}

/** Rendered geometry for one connection: bézier path plus badge anchor. */
export interface ConnectionPathDatum {
  id: string;
  d: string;
  weight: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  midX: number;
  midY: number;
}

/**
 * Compute the render geometry for every connection. `nodeWorldPos` maps a
 * node to its canvas position (the app applies zoom / wheel anchoring there;
 * the docs use plain node coordinates plus an offset).
 *
 * Parallel edges between the same node pair get staggered default badge
 * positions; an explicit `labelT` (badge dragged along the curve) wins.
 */
export function computeConnectionPaths(
  connections: DiagramConnection[],
  nodeById: (id: string) => DiagramNode | undefined,
  nodeWorldPos: (node: DiagramNode) => { x: number; y: number },
  compoundTypes: CompoundTypeDefinition[],
  blockScale = 1,
): ConnectionPathDatum[] {
  // Group edges by unordered node pair {from, to} so parallel edges (e.g. an
  // A→B / B→A latch) can be staggered. Membership order is stable (sorted by
  // connection id) so each edge's default badge position is deterministic.
  const groups = new Map<string, string[]>();
  for (const connection of connections) {
    const key = [connection.from, connection.to].sort().join('::');
    const list = groups.get(key);
    if (list) list.push(connection.id);
    else groups.set(key, [connection.id]);
  }
  for (const list of groups.values()) list.sort();

  return connections
    .map((connection) => {
      const from = nodeById(connection.from);
      const to = nodeById(connection.to);
      if (!from || !to) return null;
      const fromWorld = nodeWorldPos(from);
      const toWorld = nodeWorldPos(to);
      const x1 = fromWorld.x + portOffsetX(from, connection.fromPort, compoundTypes, blockScale);
      const y1 = fromWorld.y + NODE_H * blockScale;
      const x2 = toWorld.x + inputPortOffsetX(to, connection.toPort, compoundTypes, blockScale);
      const y2 = toWorld.y;

      const key = [connection.from, connection.to].sort().join('::');
      const group = groups.get(key)!;
      const t = connection.labelT ?? staggeredLabelT(group.indexOf(connection.id), group.length);
      const badge = bezierPointAt(x1, y1, x2, y2, t);

      return {
        id: connection.id,
        d: makePath(x1, y1, x2, y2),
        weight: connection.weight,
        x1, y1, x2, y2,
        midX: badge.x,
        midY: badge.y,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
}
