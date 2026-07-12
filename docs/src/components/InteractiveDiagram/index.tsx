import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import type {
  CompoundTypeDefinition,
  DiagramConnection,
  DiagramNode,
  NodeTypeId,
  OutputPortId,
} from '@app/types/diagram';
import { TYPE_BY_ID } from '@app/types/diagram';
import { useScopeSimulation } from '@app/hooks/useScopeSimulation';
import type { ConfigTarget } from '@app/components/diagramShared';
import { DiagramCanvas } from '@app/components/DiagramCanvas';
import { NODE_H, NODE_W, computeConnectionPaths } from '@app/components/connectionGeometry';
// The app's diagram presentation layer (nodes, connections, trace UI). Scoped
// under `.bb-diagram`, so it renders as a self-contained dark panel and leaks
// nothing into the Docusaurus theme. Aliased CSS import resolves through the
// `@app` webpack alias defined in docusaurus.config.ts.
import '@app/components/diagram.css';
import './styles.css';

/**
 * An embeddable trace-mode diagram for the docs site. It reuses BOTH the desktop
 * app's simulation core (`useScopeSimulation` — see `@app/hooks/*`) AND the app's
 * rendering layer (the shared `DiagramCanvas`, which composes `DiagramNodeView` /
 * `ConnectionLayer` and the `.bb-diagram` stylesheet), so an embedded diagram
 * looks and behaves exactly like the app's trace mode and can never drift from
 * it. Only layout/embed chrome (panel frame, scaling, palette, popover, caption)
 * is docs-local.
 *
 * The `diagram` prop is the app's EXPORT format, so a diagram built in the app
 * can be pasted straight into MDX.
 *
 * ## Editing (`editable` / `palette`)
 *
 * With `editable` (or `palette`, which implies it) the diagram becomes a small
 * hands-on sandbox: the reader can drag nodes, draw links, edit connection
 * weights, add nodes from a palette strip, and delete. Diagram structure moves
 * into component state (deep-cloned from the prop so Reset restores the original)
 * while the live simulation keeps running through every edit — `useScopeSimulation`
 * rebuilds its plan whenever the nodes/connections array identity changes.
 */
export interface InteractiveDiagramProps {
  diagram: {
    loopPeriodMs?: number;
    nodes: DiagramNode[];
    connections: DiagramConnection[];
    compoundTypes?: CompoundTypeDefinition[];
  };
  caption?: string;
  /**
   * Explicit canvas height override (px). By default the panel derives its
   * height from the scaled content (clamped ~260–560), so most embeds omit it.
   * Content is always scaled to fit the available width.
   */
  height?: number;
  /**
   * Initial sensor values keyed exactly as the simulation keys them: the node
   * id for analog/digital/tof/constant/compound-input, and `${id}:${channel}`
   * (channel ∈ clear|red|green|blue) for color sensors.
   */
  initialInputs?: Record<string, number>;
  /** Default pulse length (ms) for the per-sensor pulse buttons. */
  pulseDurationMs?: number;
  /**
   * Let the reader rewire the diagram: node dragging, link drawing, weight
   * editing (badge → popover), and deletion (Delete/Backspace when focused, or
   * the × affordance on a selected node). Structure lives in component state and
   * Reset restores the initial props.
   */
  editable?: boolean;
  /**
   * Node types the reader may add via a palette strip above the canvas. Implies
   * `editable`. Clicking a chip drops a node of that type at a free spot; the
   * reader can then drag it into place and wire it up.
   */
  palette?: NodeTypeId[];
  /**
   * Whether the embed starts in trace mode (live simulation — sliders, value
   * readouts, expanded sensor nodes). Defaults to `true` so existing embeds
   * keep simulating on load. A "Trace Signal Flow" / "Exit Trace" button in the
   * footer flips it; set `initialTrace={false}` for wire-first exercises.
   */
  initialTrace?: boolean;
}

/** Symmetric world padding around the node bounds (world px, pre-scale). */
const PAD = 48;
/** Extra working room below the content in editable embeds, so there's space to
 *  drop and drag palette nodes without an immediate rescale (world px). */
const EDIT_MARGIN = 120;
/** Extra bottom room in trace mode: trace-expanded sensor nodes render taller
 *  than their NODE_H box (86 vs 64 px), so allow for that plus the value
 *  readout below the output handle, keeping the toggle from clipping/jumping. */
const TRACE_MARGIN = 40;
/** Floor on the fit-to-width shrink so nodes stay close to app-native size;
 *  wider diagrams scroll horizontally rather than shrink past this. */
const MIN_SCALE = 0.72;
/** Clamp on the auto-derived viewport height (screen px). */
const MIN_HEIGHT = 260;
const MAX_HEIGHT = 560;
const DEFAULT_CONNECTION_WEIGHT = 1;

// ── Static layout shared by SSR fallback and live component ────────────────

interface Layout {
  offsetX: number;
  offsetY: number;
  contentW: number;
  contentH: number;
}

/**
 * World-space content box: the node bounds (min/max x,y grown by NODE_W/NODE_H)
 * expanded by symmetric `PAD`, plus an optional extra `bottomMargin` of working
 * room below the content (editable embeds). `offsetX/Y` shift raw node
 * coordinates so the padded content sits at the world origin.
 */
function computeLayout(nodes: DiagramNode[], bottomMargin = 0): Layout {
  if (nodes.length === 0) {
    return { offsetX: PAD, offsetY: PAD, contentW: 400, contentH: 300 + bottomMargin };
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + NODE_W);
    maxY = Math.max(maxY, n.y + NODE_H);
  }
  return {
    offsetX: -minX + PAD,
    offsetY: -minY + PAD,
    contentW: maxX - minX + PAD * 2,
    contentH: maxY - minY + PAD * 2 + bottomMargin,
  };
}

// View-only embed: the graph structure is not editable (the shared canvas
// disables node/link/badge dragging because the editing callbacks are omitted),
// and selection is pinned to an inert empty state. Trace inputs (sliders /
// toggles / pulse) stay live via the trace passthrough props.
const NOOP = () => {};
const NOOP_SET_SELECTED: Dispatch<SetStateAction<Set<string>>> = () => {};
const NOOP_SET_CONFIG: Dispatch<SetStateAction<ConfigTarget | null>> = () => {};
const EMPTY_SELECTION: ReadonlySet<string> = new Set<string>();

/** Deep clone of the diagram's structural arrays so editing never mutates the
 *  caller's prop object and Reset can restore the exact original. */
function cloneNodes(nodes: DiagramNode[]): DiagramNode[] {
  return nodes.map((n) => ({ ...n }));
}
function cloneConnections(connections: DiagramConnection[]): DiagramConnection[] {
  return connections.map((c) => ({
    ...c,
    transferPoints: c.transferPoints.map((p) => ({ ...p })),
  }));
}

function uuid(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

/** New node ids follow the app convention `{type}-{uuid}`. */
function makeNodeId(type: NodeTypeId): string {
  return `${type}-${uuid()}`;
}

/**
 * Default per-type params for a freshly added node — mirrors the app's
 * palette-drop handler in BraitenbergDiagram so the simulation gets sane values
 * (thresholds, delays, oscillator freq/amplitude, constant value, ToF range).
 */
function defaultNode(type: NodeTypeId, x: number, y: number, label: string): DiagramNode {
  const nodeType = TYPE_BY_ID[type];
  return {
    id: makeNodeId(type),
    type,
    label,
    x,
    y,
    threshold: nodeType.mode === 'threshold' || type === 'digital-out' ? 50 : undefined,
    delayMs: nodeType.mode === 'delay' ? 100 : undefined,
    frequencyHz: nodeType.mode === 'oscillator' ? 1.0 : undefined,
    amplitude:
      nodeType.mode === 'oscillator' ? 100 : nodeType.mode === 'noise' ? 50 : undefined,
    constantValue: nodeType.kind === 'constant' ? 0 : undefined,
    maxDistanceMm: type === 'sensor-tof' ? 500 : undefined,
  };
}

// ── Rendering core, shared by the live and static (SSR) variants ───────────

interface DiagramPanelProps {
  nodes: DiagramNode[];
  connections: DiagramConnection[];
  compoundTypes: CompoundTypeDefinition[];
  /** Explicit viewport height override (px). When omitted the panel derives its
   *  height from the scaled content. */
  height?: number;
  sensorValues: Record<string, number>;
  setSensor: (key: string, value: number) => void;
  setConstant: (id: string, value: number) => void;
  pulse: (id: string) => void;
  pulsingId: string | null;
  pulseDurationMs: number;
  /** Whether trace mode is active (sliders, value readouts, expanded nodes). */
  traceMode: boolean;
  /** Toggle trace on/off. Omitted → no toggle button (SSR fallback). */
  onToggleTrace?: () => void;
  /** Live trace values; undefined when trace is off or in the SSR fallback. */
  traceResult?: {
    nodeValues: Record<string, number>;
    edgeSignals: Record<string, number>;
    disconnected: Set<string>;
  };
  // ── editing (all optional; omit → view-only) ─────────────────────────────
  editable?: boolean;
  palette?: NodeTypeId[];
  selectedNodeIds?: Set<string>;
  setSelectedNodeIds?: Dispatch<SetStateAction<Set<string>>>;
  configTarget?: ConfigTarget | null;
  setConfigTarget?: Dispatch<SetStateAction<ConfigTarget | null>>;
  onNodeMove?: (id: string, x: number, y: number) => void;
  onConnectionCreate?: (edge: { from: string; fromPort?: OutputPortId; to: string; toPort?: string }) => void;
  onConnectionLabelT?: (id: string, labelT: number) => void;
  onAddNode?: (type: NodeTypeId) => void;
  onDeleteSelection?: () => void;
  onSetWeight?: (id: string, weight: number) => void;
  onDeleteConnection?: (id: string) => void;
  onReset?: () => void;
  /** True when reset would change something (an edit or non-default input). */
  canReset?: boolean;
}

function DiagramPanel({
  nodes,
  connections,
  compoundTypes,
  height,
  sensorValues,
  setSensor,
  setConstant,
  pulse,
  pulsingId,
  pulseDurationMs,
  traceMode,
  onToggleTrace,
  traceResult,
  editable = false,
  palette,
  selectedNodeIds,
  setSelectedNodeIds,
  configTarget = null,
  setConfigTarget,
  onNodeMove,
  onConnectionCreate,
  onConnectionLabelT,
  onAddNode,
  onDeleteSelection,
  onSetWeight,
  onDeleteConnection,
  onReset,
  canReset = false,
}: DiagramPanelProps) {
  // Bottom working room: editable embeds get room to drop palette nodes; trace
  // mode adds a small allowance because trace-expanded sensor nodes render
  // ~22px taller than their NODE_H box, so a bottom-most sensor won't clip and
  // toggling trace doesn't jump the derived height much.
  const bottomMargin = (editable ? EDIT_MARGIN : 0) + (traceMode ? TRACE_MARGIN : 0);
  const layout = useMemo(
    () => computeLayout(nodes, bottomMargin),
    [nodes, bottomMargin],
  );

  const canvasRef = useRef<HTMLDivElement>(null);

  // Measure the viewport's available width (the figure content column). The
  // world is CSS-scaled to fit this; recompute on mount, on resize, and when the
  // content bounds change (readers add/drag nodes). Seed with the content width
  // so SSR / first paint isn't scaled to 0.
  const [availW, setAvailW] = useState(layout.contentW);
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setAvailW(w);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit-to-width, but never shrink past MIN_SCALE (readability). Because
  // CSS `transform: scale()` does not shrink the element's layout box, the
  // world div carries its unscaled `contentW/contentH` as its box size and the
  // scale is applied purely visually — so we size the viewport ourselves rather
  // than let the scaled world dictate it.
  const liveScale = Math.max(MIN_SCALE, Math.min(1, availW / layout.contentW));
  const liveScaledW = layout.contentW * liveScale;
  const liveScaledH = layout.contentH * liveScale;
  const liveOverflowsX = liveScaledW > availW + 0.5;
  const liveWorldOffsetX = liveOverflowsX ? 0 : Math.max(0, (availW - liveScaledW) / 2);

  // ── Drag-latch: freeze the stage layout for the duration of a node drag ──
  //
  // During a node drag, `onNodeMove` updates positions on every mousemove →
  // `layout` recomputes → `scale`/`worldOffsetX` change → `clientToWorld` maps
  // the same pointer to a different world coordinate → the node teleports →
  // runaway rescale. Fix: latch all layout-derived values on drag-start and
  // hold them until drag-end; only then let bounds/scale/height reflow from
  // the final positions.
  //
  // `latchedLayout` is null while not dragging (live values are used).
  // During a drag it holds the snapshot of { scale, offsetX, offsetY,
  // worldOffsetX, contentW, contentH, viewportH, overflowsX } that was current
  // at drag-start. All resolver callbacks (clientToLayer/World, nodeWorldPos)
  // read from a ref so DiagramCanvas's stableRef always sees the current
  // latched values without needing new function identities.
  interface LayoutSnapshot {
    scale: number;
    offsetX: number;
    offsetY: number;
    worldOffsetX: number;
    contentW: number;
    contentH: number;
    viewportH: number;
    overflowsX: boolean;
  }
  const [latchedLayout, setLatchedLayout] = useState<LayoutSnapshot | null>(null);
  // A ref that always mirrors `latchedLayout` so stable callbacks can read it.
  const latchRef = useRef<LayoutSnapshot | null>(null);
  latchRef.current = latchedLayout;

  // Live layout values also in a ref so drag-start can snapshot them without a
  // stale-closure hazard (latchRef is read at call time, inside the callback).
  const liveLayoutRef = useRef<LayoutSnapshot>({
    scale: liveScale,
    offsetX: layout.offsetX,
    offsetY: layout.offsetY,
    worldOffsetX: liveWorldOffsetX,
    contentW: layout.contentW,
    contentH: layout.contentH,
    viewportH: height ?? Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(liveScaledH))),
    overflowsX: liveOverflowsX,
  });
  // Update the live snapshot every render so drag-start always captures the
  // most recent pre-drag values (no stale closure).
  liveLayoutRef.current = {
    scale: liveScale,
    offsetX: layout.offsetX,
    offsetY: layout.offsetY,
    worldOffsetX: liveWorldOffsetX,
    contentW: layout.contentW,
    contentH: layout.contentH,
    viewportH: height ?? Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(liveScaledH))),
    overflowsX: liveOverflowsX,
  };

  // Effective (rendered) layout: latched if dragging, otherwise live.
  const effective = latchedLayout ?? liveLayoutRef.current;
  const scale = effective.scale;
  const worldOffsetX = effective.worldOffsetX;
  const overflowsX = effective.overflowsX;
  const viewportH = effective.viewportH;
  // World div sizing mirrors the effective layout so it doesn't change mid-drag.
  const effectiveContentW = effective.contentW;
  const effectiveContentH = effective.contentH;

  const onNodeDragStart = useCallback(() => {
    // Latch the pre-drag layout snapshot so neither scale, offsets, nor
    // viewport height reflow while the drag is in progress.
    setLatchedLayout({ ...liveLayoutRef.current });
  }, []);

  const onNodeDragEnd = useCallback(() => {
    // Release the latch — one reflow from the final node positions.
    setLatchedLayout(null);
  }, []);

  const [rejectedNotice, setRejectedNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<number | null>(null);

  // Node world position = raw node coordinate + layout offset (docs have no
  // zoom / block-scale; the fit-to-width scale is a CSS transform on the
  // wrapper, outside the canvas's coordinate space).
  // Reads from latchRef so it's always stable but always current (no new
  // function identity needed as latch changes).
  const nodeWorldPos = useCallback(
    (node: DiagramNode) => {
      const l = latchRef.current ?? liveLayoutRef.current;
      return { x: node.x + l.offsetX, y: node.y + l.offsetY };
    },
    // Stable: reads latchRef/liveLayoutRef at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // clientToLayer: client px → world-div (unscaled layer) px. The world div is
  // CSS-scaled by `scale`, so undo it. clientToWorld: same, minus the layout
  // offset, so it matches node.x/y.
  // Both callbacks are stable references that read latchRef at call time, so
  // DiagramCanvas's stateRef always gets the current (latched or live) values
  // without the resolver identities changing on every render.
  const clientToLayer = useCallback(
    (clientX: number, clientY: number) => {
      const l = latchRef.current ?? liveLayoutRef.current;
      const rect = canvasRef.current?.getBoundingClientRect();
      const left = (rect?.left ?? 0) + l.worldOffsetX;
      const top = rect?.top ?? 0;
      return { x: (clientX - left) / l.scale, y: (clientY - top) / l.scale };
    },
    // Stable: reads latchRef/liveLayoutRef at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const clientToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const l = latchRef.current ?? liveLayoutRef.current;
      const layer = clientToLayer(clientX, clientY);
      return { x: layer.x - l.offsetX, y: layer.y - l.offsetY };
    },
    // clientToLayer is stable above.
    [clientToLayer],
  );

  const showRejected = useCallback((message: string) => {
    setRejectedNotice(message);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setRejectedNotice(null), 3200);
  }, []);

  const handleConnectionRejected = useCallback(
    ({ toId }: { toId: string }) => {
      const to = nodes.find((n) => n.id === toId);
      if (!to) return;
      const toType = TYPE_BY_ID[to.type];
      if (toType.maxInputs !== undefined) {
        showRejected(
          `${toType.displayName} accepts only ${toType.maxInputs} incoming connection${toType.maxInputs === 1 ? '' : 's'}.`,
        );
      }
    },
    [nodes, showRejected],
  );

  // ── deletion affordance / keyboard (editable only) ───────────────────────
  const hasSelection = editable && !!selectedNodeIds && selectedNodeIds.size > 0;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!editable) return;
      if (e.key === 'Escape') {
        setConfigTarget?.(null);
        setSelectedNodeIds?.(new Set());
        return;
      }
      // Only act on Delete/Backspace when the canvas itself (not a slider or
      // input inside it) has focus, so page typing/scrolling is unaffected.
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (e.target !== e.currentTarget) return;
        if (hasSelection) {
          e.preventDefault();
          onDeleteSelection?.();
        }
      }
    },
    [editable, hasSelection, onDeleteSelection, setConfigTarget, setSelectedNodeIds],
  );

  // ── weight popover position (for the selected connection's badge) ─────────
  const popover = useMemo(() => {
    if (!editable || configTarget?.kind !== 'connection') return null;
    const conn = connections.find((c) => c.id === configTarget.id);
    if (!conn) return null;
    const nodeMap = Object.fromEntries(nodes.map((n) => [n.id, n]));
    const paths = computeConnectionPaths(connections, (id) => nodeMap[id], nodeWorldPos, compoundTypes, 1, traceMode);
    const path = paths.find((p) => p.id === conn.id);
    if (!path) return null;
    // Badge is at (midX, midY) in layer px; the world div is scaled, so the
    // screen offset inside the (unscaled) `.id-canvas` is midX/Y * scale.
    return { conn, left: worldOffsetX + path.midX * scale, top: path.midY * scale };
  }, [editable, configTarget, connections, nodes, nodeWorldPos, compoundTypes, scale, worldOffsetX, traceMode]);

  // Dismiss the popover on outside click (Escape is handled by the canvas keydown).
  useEffect(() => {
    if (!popover) return;
    const onDown = (e: globalThis.MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.id-weight-popover')) return;
      if (target?.closest('.connection-config-trigger')) return;
      setConfigTarget?.(null);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [popover, setConfigTarget]);

  const selectedNodeId =
    editable && selectedNodeIds && selectedNodeIds.size === 1 ? [...selectedNodeIds][0] : null;
  const selectedNode = selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : undefined;

  return (
    <div className="id-frame">
      {editable && palette && palette.length > 0 && (
        <div className="id-palette" role="toolbar" aria-label="Add node">
          <span className="id-palette-label">Add:</span>
          {palette.map((type) => {
            const def = TYPE_BY_ID[type];
            return (
              <button
                key={type}
                type="button"
                className={`id-palette-chip id-kind-${def.kind}`}
                onClick={() => onAddNode?.(type)}
                title={`Add a ${def.displayName}`}
              >
                + {def.displayName}
              </button>
            );
          })}
        </div>
      )}

      <div
        className={`id-canvas${overflowsX ? ' id-canvas-scroll' : ''}`}
        style={{ height: viewportH }}
        ref={canvasRef}
        tabIndex={editable ? 0 : undefined}
        onKeyDown={handleKeyDown}
        onMouseDown={
          editable
            ? (e) => {
                // Clicking empty canvas clears selection + closes the popover.
                if (e.target === e.currentTarget) {
                  setSelectedNodeIds?.(new Set());
                  setConfigTarget?.(null);
                }
              }
            : undefined
        }
      >
        <div
          className="id-world bb-diagram"
          style={{
            transform: `scale(${scale})`,
            transformOrigin: '0 0',
            width: effectiveContentW,
            height: effectiveContentH,
            left: worldOffsetX,
          }}
        >
          <DiagramCanvas
            nodes={nodes}
            connections={connections}
            compoundTypes={compoundTypes}
            nodeWorldPos={nodeWorldPos}
            clientToWorld={editable ? clientToWorld : undefined}
            clientToLayer={editable ? clientToLayer : undefined}
            traceMode={traceMode}
            traceResult={traceMode ? traceResult : undefined}
            sensorValues={sensorValues}
            setSensorValue={setSensor}
            setConstantValue={setConstant}
            pulseSensor={pulse}
            pulsingId={pulsingId}
            pulseDurationMs={pulseDurationMs}
            readOnly={traceResult === undefined}
            selectedNodeIds={selectedNodeIds ?? (EMPTY_SELECTION as Set<string>)}
            setSelectedNodeIds={setSelectedNodeIds ?? NOOP_SET_SELECTED}
            configTarget={configTarget}
            setConfigTarget={setConfigTarget ?? NOOP_SET_CONFIG}
            onNodeMove={editable ? onNodeMove : undefined}
            onNodeDragStart={editable ? onNodeDragStart : undefined}
            onNodeDragEnd={editable ? onNodeDragEnd : undefined}
            onConnectionCreate={editable ? onConnectionCreate : undefined}
            onConnectionRejected={editable ? handleConnectionRejected : undefined}
            onConnectionLabelT={editable ? onConnectionLabelT : undefined}
          />
        </div>

        {/* Delete affordance on the singly-selected node (keyboard-free path). */}
        {selectedNode && (
          <button
            type="button"
            className="id-node-delete"
            title="Delete node"
            aria-label={`Delete ${selectedNode.label}`}
            style={{
              left: worldOffsetX + nodeWorldPos(selectedNode).x * scale + NODE_W * scale - 10,
              top: nodeWorldPos(selectedNode).y * scale - 10,
            }}
            onClick={(e) => {
              e.stopPropagation();
              onDeleteSelection?.();
            }}
          >
            ×
          </button>
        )}

        {/* Lightweight weight editor near the connection badge (badge click). */}
        {popover && (
          <div
            className="id-weight-popover"
            style={{ left: popover.left, top: popover.top }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="id-weight-row">
              <span className="id-weight-label">weight</span>
              <span className="id-weight-value">{popover.conn.weight.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={-1}
              max={1}
              step={0.05}
              value={popover.conn.weight}
              onChange={(e) => onSetWeight?.(popover.conn.id, Number(e.target.value))}
            />
            <button
              type="button"
              className="id-weight-delete"
              onClick={() => onDeleteConnection?.(popover.conn.id)}
            >
              Delete connection
            </button>
          </div>
        )}

        {rejectedNotice && <div className="id-notice">{rejectedNotice}</div>}
      </div>

      {(editable || onReset || onToggleTrace) && (
        <div className="id-footer">
          {editable && (
            <span className="id-hint">
              Drag nodes • drag from a node's bottom dot to wire • click a weight badge to edit
            </span>
          )}
          <div className="id-footer-actions">
            {onToggleTrace && (
              <button
                type="button"
                className={`id-trace-toggle${traceMode ? ' active' : ''}`}
                onClick={onToggleTrace}
                aria-pressed={traceMode}
                title={
                  traceMode
                    ? 'Stop simulating and return to the static wiring view'
                    : 'Simulate signal flow through the wiring'
                }
              >
                {traceMode ? 'Exit Trace' : 'Trace Signal Flow'}
              </button>
            )}
            {onReset && (
              <button
                type="button"
                className="id-reset"
                onClick={onReset}
                disabled={!canReset}
                title="Restore the original diagram"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Live (browser-only) implementation ─────────────────────────────────────

function LiveDiagram({
  diagram,
  height,
  initialInputs,
  pulseDurationMs,
  editable,
  palette,
  initialTrace,
}: {
  diagram: InteractiveDiagramProps['diagram'];
  height?: number;
  initialInputs: Record<string, number>;
  pulseDurationMs: number;
  editable: boolean;
  palette?: NodeTypeId[];
  initialTrace: boolean;
}) {
  const compoundTypes = useMemo(() => diagram.compoundTypes ?? [], [diagram.compoundTypes]);
  const loopPeriodMs = diagram.loopPeriodMs ?? 50;

  // Editable structure lives in state, deep-cloned from the prop so Reset can
  // restore the pristine original and edits never mutate the caller's object.
  const [editNodes, setEditNodes] = useState<DiagramNode[]>(() => cloneNodes(diagram.nodes));
  const [editConnections, setEditConnections] = useState<DiagramConnection[]>(() =>
    cloneConnections(diagram.connections),
  );

  const [sensorValues, setSensorValues] = useState<Record<string, number>>(initialInputs);
  // Trace-mode constant edits (constant nodes' slider) apply as an override on
  // top of the diagram's declared constantValue.
  const [constantOverrides, setConstantOverrides] = useState<Record<string, number>>({});
  const [pulsingId, setPulsingId] = useState<string | null>(null);

  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(() => new Set());
  const [configTarget, setConfigTarget] = useState<ConfigTarget | null>(null);
  const [dirty, setDirty] = useState(false);
  // Trace mode mirrors the app's toggle: edit the wiring, then flip on tracing
  // to simulate. Defaults to `initialTrace` (true, so existing embeds keep
  // their always-simulating behavior).
  const [traceOn, setTraceOn] = useState(initialTrace);

  const setSensor = (key: string, value: number) => {
    setSensorValues((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };
  const setConstant = (id: string, value: number) => {
    setConstantOverrides((prev) => ({ ...prev, [id]: value }));
    setDirty(true);
  };

  // Structural source: the edited arrays when editable, else the prop directly.
  const baseNodes = editable ? editNodes : diagram.nodes;
  const baseConnections = editable ? editConnections : diagram.connections;

  const nodes = useMemo(() => {
    if (Object.keys(constantOverrides).length === 0) return baseNodes;
    return baseNodes.map((n) =>
      constantOverrides[n.id] !== undefined ? { ...n, constantValue: constantOverrides[n.id] } : n,
    );
  }, [baseNodes, constantOverrides]);
  const connections = baseConnections;

  // The simulation loop only runs while tracing is on — no timers when off.
  const { traceResult, pulse } = useScopeSimulation(
    nodes,
    connections,
    sensorValues,
    /* enabled */ traceOn,
    loopPeriodMs,
    compoundTypes,
  );

  // Flash the pulse button + drive a real pulse through the simulation.
  const pulseSensor = (id: string) => {
    pulse(id, 100, pulseDurationMs);
    setPulsingId(id);
    window.setTimeout(() => {
      setPulsingId((cur) => (cur === id ? null : cur));
    }, pulseDurationMs);
  };

  // ── editing mutations (structure lives in state) ─────────────────────────
  const onNodeMove = useCallback((id: string, x: number, y: number) => {
    setEditNodes((prev) => prev.map((n) => (n.id === id ? { ...n, x, y } : n)));
    setDirty(true);
  }, []);

  const onConnectionCreate = useCallback(
    (edge: { from: string; fromPort?: OutputPortId; to: string; toPort?: string }) => {
      setEditConnections((prev) => [
        ...prev,
        {
          id: `link-${uuid()}`,
          from: edge.from,
          ...(edge.fromPort ? { fromPort: edge.fromPort } : {}),
          to: edge.to,
          ...(edge.toPort ? { toPort: edge.toPort } : {}),
          weight: DEFAULT_CONNECTION_WEIGHT,
          transferMode: 'linear' as const,
          transferPoints: [
            { x: -100, y: -100 },
            { x: 100, y: 100 },
          ],
        },
      ]);
      setDirty(true);
    },
    [],
  );

  const onConnectionLabelT = useCallback((id: string, labelT: number) => {
    setEditConnections((prev) => prev.map((c) => (c.id === id ? { ...c, labelT } : c)));
    setDirty(true);
  }, []);

  const onSetWeight = useCallback((id: string, weight: number) => {
    setEditConnections((prev) => prev.map((c) => (c.id === id ? { ...c, weight } : c)));
    setDirty(true);
  }, []);

  const onDeleteConnection = useCallback((id: string) => {
    setEditConnections((prev) => prev.filter((c) => c.id !== id));
    setConfigTarget((cur) => (cur?.kind === 'connection' && cur.id === id ? null : cur));
    setDirty(true);
  }, []);

  const onDeleteSelection = useCallback(() => {
    setSelectedNodeIds((selected) => {
      if (selected.size === 0) return selected;
      setEditNodes((prev) => prev.filter((n) => !selected.has(n.id)));
      setEditConnections((prev) =>
        prev.filter((c) => !selected.has(c.from) && !selected.has(c.to)),
      );
      setDirty(true);
      return new Set();
    });
    setConfigTarget(null);
  }, []);

  const onAddNode = useCallback(
    (type: NodeTypeId) => {
      setEditNodes((prev) => {
        // Placement heuristic: drop below the current node stack, left-aligned to
        // the leftmost node, nudging right to avoid overlapping an existing node.
        const minX = prev.length ? Math.min(...prev.map((n) => n.x)) : 40;
        const maxY = prev.length ? Math.max(...prev.map((n) => n.y + NODE_H)) : 40;
        let x = minX;
        const y = maxY + 32;
        const collides = (px: number) =>
          prev.some((n) => Math.abs(n.y - y) < NODE_H && Math.abs(n.x - px) < NODE_W + 12);
        while (collides(x)) x += NODE_W + 24;
        const count = prev.filter((n) => n.type === type).length + 1;
        const node = defaultNode(type, x, y, `${TYPE_BY_ID[type].displayName} ${count}`);
        setSelectedNodeIds(new Set([node.id]));
        setConfigTarget({ kind: 'node', id: node.id });
        return [...prev, node];
      });
      setDirty(true);
    },
    [],
  );

  // Reset restores the pristine initial state, including the trace toggle, so
  // the embed looks exactly as first loaded — least surprising for the reader.
  const onReset = useCallback(() => {
    setEditNodes(cloneNodes(diagram.nodes));
    setEditConnections(cloneConnections(diagram.connections));
    setSensorValues(initialInputs);
    setConstantOverrides({});
    setSelectedNodeIds(new Set());
    setConfigTarget(null);
    setPulsingId(null);
    setTraceOn(initialTrace);
    setDirty(false);
  }, [diagram.nodes, diagram.connections, initialInputs, initialTrace]);

  return (
    <DiagramPanel
      nodes={nodes}
      connections={connections}
      compoundTypes={compoundTypes}
      height={height}
      sensorValues={sensorValues}
      setSensor={setSensor}
      setConstant={setConstant}
      pulse={pulseSensor}
      pulsingId={pulsingId}
      pulseDurationMs={pulseDurationMs}
      traceMode={traceOn}
      onToggleTrace={() => setTraceOn((on) => !on)}
      traceResult={traceResult}
      editable={editable}
      palette={palette}
      selectedNodeIds={selectedNodeIds}
      setSelectedNodeIds={setSelectedNodeIds}
      configTarget={configTarget}
      setConfigTarget={setConfigTarget}
      onNodeMove={onNodeMove}
      onConnectionCreate={onConnectionCreate}
      onConnectionLabelT={onConnectionLabelT}
      onAddNode={onAddNode}
      onDeleteSelection={onDeleteSelection}
      onSetWeight={onSetWeight}
      onDeleteConnection={onDeleteConnection}
      onReset={onReset}
      canReset={dirty || traceOn !== initialTrace}
    />
  );
}

// ── Static SSR fallback (nodes + edges, no live values) ────────────────────

function StaticDiagram({
  diagram,
  height,
  pulseDurationMs,
  initialTrace,
}: {
  diagram: InteractiveDiagramProps['diagram'];
  height?: number;
  pulseDurationMs: number;
  initialTrace: boolean;
}) {
  return (
    <DiagramPanel
      nodes={diagram.nodes}
      connections={diagram.connections}
      compoundTypes={diagram.compoundTypes ?? []}
      height={height}
      sensorValues={{}}
      setSensor={NOOP}
      setConstant={NOOP}
      pulse={NOOP}
      pulsingId={null}
      pulseDurationMs={pulseDurationMs}
      // Reserve the same layout as the hydrated view so the height doesn't jump
      // on hydration; there are no live values, so nodes render read-only.
      traceMode={initialTrace}
      traceResult={undefined}
    />
  );
}

export default function InteractiveDiagram({
  diagram,
  caption,
  height,
  initialInputs = {},
  pulseDurationMs = 200,
  editable = false,
  palette,
  initialTrace = true,
}: InteractiveDiagramProps) {
  // A palette implies editing.
  const isEditable = editable || (palette !== undefined && palette.length > 0);
  return (
    <figure className="id-figure">
      <BrowserOnly
        fallback={
          <StaticDiagram
            diagram={diagram}
            height={height}
            pulseDurationMs={pulseDurationMs}
            initialTrace={initialTrace}
          />
        }
      >
        {() => (
          <LiveDiagram
            diagram={diagram}
            height={height}
            initialInputs={initialInputs}
            pulseDurationMs={pulseDurationMs}
            editable={isEditable}
            palette={palette}
            initialTrace={initialTrace}
          />
        )}
      </BrowserOnly>
      {caption && <figcaption className="id-caption">{caption}</figcaption>}
    </figure>
  );
}
