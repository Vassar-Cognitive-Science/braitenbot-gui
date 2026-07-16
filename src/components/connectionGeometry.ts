import type { CompoundTypeDefinition, DiagramConnection, DiagramNode, OutputPortId, TransferMode, TransferPoint } from '../types/diagram';
import { TYPE_BY_ID, getInputPorts, getOutputPorts } from '../types/diagram';

/**
 * Pure geometry/stroke helpers for rendering diagram connections. Extracted
 * from BraitenbergDiagram so the docs site's InteractiveDiagram can reuse the
 * exact same presentational math — single source for rendering, like the
 * simulation core in hooks/useTraceSimulation.
 */

export const NODE_W = 148;
export const NODE_H = 64;

/**
 * Expanded heights for nodes that grow downward in trace mode.
 *
 * These values must stay in sync with the CSS rules in diagram.css:
 *   - `.trace-expanded`       → height: 86px
 *   - `.trace-color-expanded` → height: auto, min-height: 86px (4 slider rows
 *     add ~52px of content above the base, empirically ~130px total)
 *
 * The expansion classes are applied in DiagramNodeView when:
 *   hasSlider = traceMode && (nodeType.kind === 'sensor' || nodeType.kind === 'constant'
 *               || node.type === 'compound-input')
 * and additionally `.trace-color-expanded` when node.type === 'sensor-color'.
 *
 * Input (top-edge) anchors are unaffected — expansion grows downward only.
 */
const TRACE_EXPANDED_H = 86;     // matches .trace-expanded { height: 86px }
const TRACE_COLOR_EXPANDED_H = 130; // matches .trace-color-expanded auto height (~4 sliders)

/**
 * Returns the effective rendered height of a node in canvas px (pre-scale).
 * In trace mode, sensor/constant/compound-input nodes expand downward due to
 * inline slider UI; the color sensor expands further for four channel sliders.
 * Outside trace mode (or for non-expanding node types) this is NODE_H.
 */
export function nodeRenderHeight(node: DiagramNode, traceMode: boolean): number {
  if (!traceMode) return NODE_H;
  const nodeType = TYPE_BY_ID[node.type];
  const isCompoundInput = node.type === 'compound-input';
  const hasSlider =
    nodeType.kind === 'sensor' || nodeType.kind === 'constant' || isCompoundInput;
  if (!hasSlider) return NODE_H;
  if (node.type === 'sensor-color') return TRACE_COLOR_EXPANDED_H;
  return TRACE_EXPANDED_H;
}

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

/**
 * The transfer graph of a plain scalar weight: a straight line through the
 * origin with slope = weight, i.e. y = weight·x. This lets a linear weight be
 * drawn with the same graph as a transfer curve — a curve is just this line
 * with extra points — so the two read as the same kind of thing across badges
 * and editors.
 *
 * The returned endpoints sit where the line leaves the −100…100 box: at the
 * left/right edges when |weight| ≤ 1, or the top/bottom edges when |weight| > 1
 * (a slope too steep to fit). `weightExceedsRange` reports the latter so the
 * renderer can cap the line with an out-of-range arrow rather than drawing a
 * misleading corner-to-corner diagonal.
 */
export function weightLinePoints(weight: number): TransferPoint[] {
  if (weight === 0) return [{ x: -100, y: 0 }, { x: 100, y: 0 }];
  const ax = Math.min(100, 100 / Math.abs(weight));
  return [
    { x: -ax, y: -weight * ax },
    { x: ax, y: weight * ax },
  ];
}

/** True when a linear weight's line is too steep to fit the −100…100 box
 *  (|weight| > 1), i.e. its output saturates before the input reaches ±100. */
export function weightExceedsRange(weight: number): boolean {
  return Math.abs(weight) > 1;
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

/** A node's occupied box in canvas space (for occlusion tests). */
export interface NodeRect { x: number; y: number; w: number; h: number }

/**
 * The portions of a connection's curve that pass *behind* an opaque node box,
 * returned as polyline path `d` strings so the caller can redraw them dashed
 * on a layer above the nodes (a wire hidden under a node is otherwise
 * invisible). `rects` must already exclude the connection's own endpoint nodes.
 *
 * Samples the bézier and collects maximal runs of samples that fall inside some
 * rect; a short polyline through the sampled points reads as a smooth dashed
 * arc at these sizes.
 */
export function occludedSpans(
  x1: number, y1: number, x2: number, y2: number, rects: NodeRect[],
): string[] {
  if (rects.length === 0) return [];
  const SAMPLES = 48;
  const inside = (p: { x: number; y: number }) =>
    rects.some((r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);
  const spans: string[] = [];
  let run: Array<{ x: number; y: number }> = [];
  const flush = () => {
    if (run.length >= 2) {
      spans.push(run.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' '));
    }
    run = [];
  };
  for (let i = 0; i <= SAMPLES; i++) {
    const p = bezierPointAt(x1, y1, x2, y2, i / SAMPLES);
    if (inside(p)) run.push(p);
    else flush();
  }
  flush();
  return spans;
}

/** Rendered geometry for one connection: bézier path plus badge anchor. */
export interface ConnectionPathDatum {
  id: string;
  d: string;
  weight: number;
  transferMode: TransferMode;
  transferPoints: TransferPoint[];
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
 *
 * `traceMode` is forwarded to `nodeRenderHeight` so the output-edge start
 * anchor (y1) lands at the true bottom of trace-expanded sensor/constant nodes
 * rather than the collapsed NODE_H. Input (top-edge) anchors (y2) are
 * unaffected because expansion grows downward.
 */
export function computeConnectionPaths(
  connections: DiagramConnection[],
  nodeById: (id: string) => DiagramNode | undefined,
  nodeWorldPos: (node: DiagramNode) => { x: number; y: number },
  compoundTypes: CompoundTypeDefinition[],
  blockScale = 1,
  traceMode = false,
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
      const y1 = fromWorld.y + nodeRenderHeight(from, traceMode) * blockScale;
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
        transferMode: connection.transferMode,
        transferPoints: connection.transferPoints,
        x1, y1, x2, y2,
        midX: badge.x,
        midY: badge.y,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
}
