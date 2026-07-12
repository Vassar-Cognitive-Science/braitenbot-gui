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
import {
  buildSimulationPlan,
  createSimulationState,
  simulateGraph,
} from '@app/hooks/useTraceSimulation';
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
/**
 * One assertion evaluated against the simulated node values after a test's
 * final phase. Either compares a node's output to a constant, or (with
 * `other`) to another node's output — the latter expresses relational goals
 * like "the right wheel outruns the left" without hard-coding magnitudes.
 * `eq` passes within `tol` (default 0.5).
 */
export type GoalAssertion =
  | { node: string; op: 'gt' | 'gte' | 'lt' | 'lte' | 'eq'; value: number; tol?: number }
  | { node: string; op: 'gt' | 'eq'; other: string; tol?: number };

/**
 * One behavioral test: feed each phase's inputs for its tick count in order,
 * then check every assertion against the final tick's node values. A single
 * phase covers steady-state goals; multiple phases express pulse-then-release
 * sequences (latches: "the wheel still turns ten ticks after the bump ends").
 */
export interface GoalTest {
  /** Optional name, purely for MDX readability. */
  label?: string;
  phases: Array<{ inputs: Record<string, number>; ticks: number }>;
  expect: GoalAssertion[];
}

/**
 * A behavioral win condition for an editable embed. The reader's CURRENT
 * wiring is simulated headlessly against every test (fixed seed, so noise
 * nodes are deterministic); when all tests pass the goal banner flips to
 * Solved. Only behavior is checked, never structure — any wiring that
 * produces the right behavior wins.
 */
export interface DiagramGoal {
  /** Challenge text shown in the goal banner, e.g. "Make it chase the light." */
  title: string;
  tests: GoalTest[];
}

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
  /**
   * Behavioral win condition — turns an editable embed into a puzzle. Checked
   * headlessly (independent of trace mode) ~300 ms after every edit; once
   * solved it stays solved until Reset. Meaningless without `editable`.
   */
  goal?: DiagramGoal;
}

/** Symmetric world padding around the node bounds (world px, pre-scale). */
const PAD = 48;
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
 * expanded by symmetric `PAD`. `offsetX/Y` shift raw node coordinates so the
 * padded content sits at the world origin.
 */
function computeLayout(nodes: DiagramNode[]): Layout {
  if (nodes.length === 0) {
    return { offsetX: PAD, offsetY: PAD, contentW: 400, contentH: 300 };
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
    contentH: maxY - minY + PAD * 2,
  };
}

/**
 * Compute the scaled content dimensions and viewport height from an epoch layout
 * and available width.
 */
function computeEpochFit(
  layout: Layout,
  availW: number,
  traceMode: boolean,
  heightOverride?: number,
): {
  scale: number;
  worldOffsetX: number;
  overflowsX: boolean;
  viewportH: number;
} {
  const scale = Math.max(MIN_SCALE, Math.min(1, availW / layout.contentW));
  const scaledW = layout.contentW * scale;
  const scaledH = (layout.contentH + (traceMode ? TRACE_MARGIN : 0)) * scale;
  const overflowsX = scaledW > availW + 0.5;
  const worldOffsetX = overflowsX ? 0 : Math.max(0, (availW - scaledW) / 2);
  const viewportH =
    heightOverride ?? Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(scaledH)));
  return { scale, worldOffsetX, overflowsX, viewportH };
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

// ── Goal evaluation (headless simulation of the reader's wiring) ───────────

/** Fixed PRNG seed so noise nodes produce the same trace on every check —
 *  a puzzle must not flicker between solved and unsolved on identical wiring. */
const GOAL_SEED = 1;

function assertionHolds(a: GoalAssertion, values: Record<string, number>): boolean {
  const v = values[a.node];
  const target = 'other' in a ? values[a.other] : a.value;
  if (v === undefined || target === undefined) return false;
  switch (a.op) {
    case 'gt':
      return v > target;
    case 'gte':
      return v >= target;
    case 'lt':
      return v < target;
    case 'lte':
      return v <= target;
    case 'eq':
      return Math.abs(v - target) <= (a.tol ?? 0.5);
  }
}

/**
 * Run every test against the current wiring and report whether all pass.
 * Mid-edit graphs can be arbitrarily broken (dangling wires were already
 * filtered by the editor, but cycles without delays make `order` null and
 * yield an empty trace) — assertions on missing values simply fail, so a
 * broken diagram is just "not solved yet", never an error.
 */
function goalSatisfied(
  goal: DiagramGoal,
  nodes: DiagramNode[],
  connections: DiagramConnection[],
  compoundTypes: CompoundTypeDefinition[],
  loopPeriodMs: number,
): boolean {
  try {
    const plan = buildSimulationPlan(nodes, connections, compoundTypes);
    for (const test of goal.tests) {
      const state = createSimulationState(nodes, loopPeriodMs, connections, compoundTypes, GOAL_SEED);
      let last: Record<string, number> = {};
      for (const phase of test.phases) {
        for (let i = 0; i < phase.ticks; i++) {
          // Same stepping the live loop uses: advance the tick, then evaluate.
          state.tick += 1;
          last = simulateGraph(nodes, connections, phase.inputs, state, compoundTypes, plan).nodeValues;
        }
      }
      if (!test.expect.every((a) => assertionHolds(a, last))) return false;
    }
    return true;
  } catch {
    return false;
  }
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
  /** Goal banner text; rendered above the canvas when present. */
  goalTitle?: string;
  /** Whether the goal is currently solved (flips the banner state). */
  goalSolved?: boolean;
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
  /**
   * Epoch layout: stable fit computed at mount (or on Reset / container resize).
   * Editable panels receive this from LiveDiagram so drag, add, and delete never
   * retrigger a re-fit. Omit for view-only / SSR panels (they compute it inline).
   */
  epochLayout?: {
    layout: Layout;
    scale: number;
    worldOffsetX: number;
    overflowsX: boolean;
    viewportH: number;
  };
  /**
   * Callback to notify that the container width was measured (so LiveDiagram can
   * recompute epoch layout on resize).
   */
  onAvailWMeasured?: (w: number) => void;
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
  goalTitle,
  goalSolved = false,
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
  epochLayout,
  onAvailWMeasured,
}: DiagramPanelProps) {
  const canvasRef = useRef<HTMLDivElement>(null);

  // For view-only embeds (no epochLayout prop), compute layout + fit inline,
  // responding to both node positions and container width (ResizeObserver).
  // For editable embeds, the epoch values come from the parent LiveDiagram and
  // are stable across drags/adds/deletes.
  const inlineLayout = useMemo(
    () => (!epochLayout ? computeLayout(nodes) : null),
    // Intentionally re-runs when nodes change, but only for view-only panels.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [epochLayout, nodes],
  );

  // availW is needed only for view-only panels (to compute inline fit). For
  // editable panels, availW measurements are forwarded to LiveDiagram via
  // onAvailWMeasured instead.
  const [availW, setAvailW] = useState(() => inlineLayout?.contentW ?? 400);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w <= 0) return;
      setAvailW(w);
      onAvailWMeasured?.(w);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resolve the effective fit values — either epoch-stable (editable) or
  // inline-derived (view-only).
  let scale: number;
  let worldOffsetX: number;
  let overflowsX: boolean;
  let viewportH: number;
  let epochOffsetX: number;
  let epochOffsetY: number;

  if (epochLayout) {
    scale = epochLayout.scale;
    worldOffsetX = epochLayout.worldOffsetX;
    overflowsX = epochLayout.overflowsX;
    viewportH = height ?? epochLayout.viewportH;
    epochOffsetX = epochLayout.layout.offsetX;
    epochOffsetY = epochLayout.layout.offsetY;
  } else {
    // View-only: fit from current nodes + current availW.
    const fit = computeEpochFit(inlineLayout!, availW, traceMode, height);
    scale = fit.scale;
    worldOffsetX = fit.worldOffsetX;
    overflowsX = fit.overflowsX;
    viewportH = fit.viewportH;
    epochOffsetX = inlineLayout!.offsetX;
    epochOffsetY = inlineLayout!.offsetY;
  }

  // ── World div sizing: grows with current content extents (enables scroll) ──
  //
  // The epoch layout (offsetX/Y, scale) is fixed. The world div's unscaled
  // dimensions grow right/down as nodes are added or dragged. Multiplied by
  // scale gives the scrollable extent inside the viewport.
  //
  // For editable embeds we track the current node extents independently of the
  // epoch so the world grows without triggering a re-fit.
  const currentExtentW = useMemo(() => {
    if (nodes.length === 0) return epochLayout?.layout.contentW ?? inlineLayout!.contentW;
    let maxX = -Infinity;
    for (const n of nodes) maxX = Math.max(maxX, n.x + NODE_W);
    // Extent = epochOffsetX brings node coords into world space, plus right PAD.
    return maxX + epochOffsetX + PAD;
  }, [nodes, epochOffsetX, epochLayout, inlineLayout]);

  const currentExtentH = useMemo(() => {
    if (nodes.length === 0) return epochLayout?.layout.contentH ?? inlineLayout!.contentH;
    let maxY = -Infinity;
    for (const n of nodes) maxY = Math.max(maxY, n.y + NODE_H);
    return maxY + epochOffsetY + PAD + (traceMode ? TRACE_MARGIN : 0);
  }, [nodes, epochOffsetY, traceMode, epochLayout, inlineLayout]);

  // A ref that always holds the current epoch values so stable callbacks can
  // read them without needing new function identities.
  const epochRef = useRef({ scale, worldOffsetX, offsetX: epochOffsetX, offsetY: epochOffsetY });
  epochRef.current = { scale, worldOffsetX, offsetX: epochOffsetX, offsetY: epochOffsetY };

  // Node world position = raw node coordinate + epoch offset.
  // Reads from epochRef so it's always stable and always current.
  const nodeWorldPos = useCallback(
    (node: DiagramNode) => {
      const e = epochRef.current;
      return { x: node.x + e.offsetX, y: node.y + e.offsetY };
    },
    // Stable: reads epochRef at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // clientToLayer: client px → world-div (unscaled layer) px.
  // clientToWorld: same, minus the epoch offset → matches node.x/y.
  // Both are stable and read epochRef at call time.
  const clientToLayer = useCallback(
    (clientX: number, clientY: number) => {
      const e = epochRef.current;
      const rect = canvasRef.current?.getBoundingClientRect();
      // Horizontal scroll offset inside the canvas (for overflow-x: auto panels).
      const scrollLeft = canvasRef.current?.scrollLeft ?? 0;
      const left = (rect?.left ?? 0) + e.worldOffsetX - scrollLeft;
      const scrollTop = canvasRef.current?.scrollTop ?? 0;
      const top = (rect?.top ?? 0) - scrollTop;
      return { x: (clientX - left) / e.scale, y: (clientY - top) / e.scale };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const clientToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const e = epochRef.current;
      const layer = clientToLayer(clientX, clientY);
      return { x: layer.x - e.offsetX, y: layer.y - e.offsetY };
    },
    [clientToLayer],
  );

  const [rejectedNotice, setRejectedNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<number | null>(null);

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

  // Vertical scroll: if the current content extents exceed the fixed viewport
  // height we want overflow-y: auto so the user can scroll to see everything.
  const scaledCurrentH = currentExtentH * scale;
  const overflowsY = editable && scaledCurrentH > viewportH + 0.5;

  return (
    <div className="id-frame">
      {goalTitle && (
        <div
          className={`id-goal${goalSolved ? ' id-goal-solved' : ''}`}
          role="status"
          aria-live="polite"
        >
          <span className="id-goal-icon" aria-hidden="true">
            {goalSolved ? '✓' : '◎'}
          </span>
          <span className="id-goal-text">{goalTitle}</span>
          {goalSolved && <span className="id-goal-badge">Solved</span>}
        </div>
      )}
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
        className={`id-canvas${overflowsX ? ' id-canvas-scroll-x' : ''}${overflowsY ? ' id-canvas-scroll-y' : ''}`}
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
            width: currentExtentW,
            height: currentExtentH,
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
            onNodeDragStart={undefined}
            onNodeDragEnd={undefined}
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
  goal,
}: {
  diagram: InteractiveDiagramProps['diagram'];
  height?: number;
  initialInputs: Record<string, number>;
  pulseDurationMs: number;
  editable: boolean;
  palette?: NodeTypeId[];
  initialTrace: boolean;
  goal?: DiagramGoal;
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

  // ── Epoch layout: stable fit, computed only at mount / Reset / resize ─────
  //
  // The epoch is derived from the INITIAL nodes (diagram.nodes) and the
  // measured container width. It stays fixed while the user edits (drags,
  // adds, deletes), so scale/offsets/viewportH never change in response to
  // user edits. Reset restores the epoch to the initial fit. Container width
  // changes (ResizeObserver) recompute the epoch from the CURRENT initial
  // nodes (diagram.nodes, not the live editNodes).
  //
  // `null` before the first width measurement; the panel seed-renders with a
  // fallback until the ResizeObserver fires.
  const [epochAvailW, setEpochAvailW] = useState<number | null>(null);
  const [epochLayout, setEpochLayout] = useState<Layout>(() => computeLayout(diagram.nodes));
  // Epoch trace mode tracks the trace state AT THE TIME the epoch was computed
  // (mount), so the trace-margin bottom-room in the viewport height matches
  // the initial render. View-only embeds don't need this because they re-derive
  // inline; editable embeds freeze it.
  const [epochTraceMode] = useState(initialTrace);

  // Recompute epoch when the container width is measured/changes.
  const handleAvailWMeasured = useCallback((w: number) => {
    setEpochAvailW(w);
  }, []);

  // The derived epoch fit (scale, offsets, viewportH) from current epochLayout + availW.
  const epochFit = useMemo(() => {
    if (epochAvailW === null) return null;
    return computeEpochFit(epochLayout, epochAvailW, epochTraceMode, height);
  }, [epochLayout, epochAvailW, epochTraceMode, height]);

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

  // ── Goal checking ─────────────────────────────────────────────────────────
  //
  // Headless and debounced: every structural or constant edit schedules a
  // re-check of the CURRENT wiring (the same effective `nodes` array the live
  // simulation consumes). Solved is sticky — a reader dismantling their
  // solution afterwards keeps the win — and only Reset clears it. If the
  // pristine diagram itself passes, the banner shows Solved immediately: that's
  // an authoring bug the preview makes visible, not a state to defend against.
  const [goalSolved, setGoalSolved] = useState(false);
  useEffect(() => {
    if (!goal || goalSolved) return;
    const timer = window.setTimeout(() => {
      if (goalSatisfied(goal, nodes, connections, compoundTypes, loopPeriodMs)) {
        setGoalSolved(true);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [goal, goalSolved, nodes, connections, compoundTypes, loopPeriodMs]);

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

  // ── Epoch clamp helpers ───────────────────────────────────────────────────
  //
  // Nodes must not be dragged left or up past the visible origin (given the
  // fixed epoch offsets). The world div doesn't extend left/up, so a node
  // placed there would be unreachable. Clamp coordinates so node.x/y ≥ 0
  // in world space (≥ -epochOffsetX / -epochOffsetY in raw space), with a
  // small PAD inset to keep the node visually reachable.
  const epochOffsetX = epochLayout.offsetX;
  const epochOffsetY = epochLayout.offsetY;
  // Minimum raw x/y so that the world-space position ≥ small buffer.
  const clampX = useCallback(
    (x: number) => Math.max(-epochOffsetX + PAD / 2, x),
    [epochOffsetX],
  );
  const clampY = useCallback(
    (y: number) => Math.max(-epochOffsetY + PAD / 2, y),
    [epochOffsetY],
  );

  // ── editing mutations (structure lives in state) ─────────────────────────
  const onNodeMove = useCallback(
    (id: string, x: number, y: number) => {
      setEditNodes((prev) =>
        prev.map((n) => (n.id === id ? { ...n, x: clampX(x), y: clampY(y) } : n)),
      );
      setDirty(true);
    },
    [clampX, clampY],
  );

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
        // Placement: drop the new node within the currently visible area.
        // The visible origin in raw node coordinates is -epochOffsetX + PAD/2,
        // -epochOffsetY + PAD/2 (the clamped minimum). We place below the
        // current node stack but within a reasonable distance from the top.
        const minX = prev.length ? Math.min(...prev.map((n) => n.x)) : -epochOffsetX + PAD;
        const maxY = prev.length
          ? Math.max(...prev.map((n) => n.y + NODE_H))
          : -epochOffsetY + PAD;
        let x = minX;
        const y = clampY(maxY + 32);
        const collides = (px: number) =>
          prev.some((n) => Math.abs(n.y - y) < NODE_H && Math.abs(n.x - px) < NODE_W + 12);
        while (collides(x)) x += NODE_W + 24;
        x = clampX(x);
        const count = prev.filter((n) => n.type === type).length + 1;
        const node = defaultNode(type, x, y, `${TYPE_BY_ID[type].displayName} ${count}`);
        setSelectedNodeIds(new Set([node.id]));
        setConfigTarget({ kind: 'node', id: node.id });
        return [...prev, node];
      });
      setDirty(true);
    },
    [epochOffsetX, epochOffsetY, clampX, clampY],
  );

  // Reset restores the pristine initial state, including the trace toggle and
  // the epoch layout (re-derived from the initial nodes), so the embed looks
  // exactly as first loaded — least surprising for the reader.
  const onReset = useCallback(() => {
    setEditNodes(cloneNodes(diagram.nodes));
    setEditConnections(cloneConnections(diagram.connections));
    setSensorValues(initialInputs);
    setConstantOverrides({});
    setSelectedNodeIds(new Set());
    setConfigTarget(null);
    setPulsingId(null);
    setTraceOn(initialTrace);
    setGoalSolved(false);
    // Recompute the epoch layout from the initial nodes (restores the exact
    // fit the reader saw on first load).
    setEpochLayout(computeLayout(diagram.nodes));
    setDirty(false);
  }, [diagram.nodes, diagram.connections, initialInputs, initialTrace]);

  // Build the epochLayout prop for DiagramPanel: null until first measurement.
  const epochLayoutProp = epochFit
    ? { layout: epochLayout, ...epochFit }
    : undefined;

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
      goalTitle={goal?.title}
      goalSolved={goalSolved}
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
      epochLayout={epochLayoutProp}
      onAvailWMeasured={handleAvailWMeasured}
    />
  );
}

// ── Static SSR fallback (nodes + edges, no live values) ────────────────────

function StaticDiagram({
  diagram,
  height,
  pulseDurationMs,
  initialTrace,
  goalTitle,
}: {
  diagram: InteractiveDiagramProps['diagram'];
  height?: number;
  pulseDurationMs: number;
  initialTrace: boolean;
  goalTitle?: string;
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
      goalTitle={goalTitle}
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
  goal,
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
            goalTitle={goal?.title}
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
            goal={goal}
          />
        )}
      </BrowserOnly>
      {caption && <figcaption className="id-caption">{caption}</figcaption>}
    </figure>
  );
}
