import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, MouseEvent, PointerEvent } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { CompoundTypeDefinition, DiagramNode, DiagramConnection, OutputPortId } from '../types/diagram';
import { TYPE_BY_ID, getInputPorts, getOutputPorts, DEFAULT_TOF_MAX_MM } from '../types/diagram';
import { validateGraph, buildGraph, generateSketch } from '../codegen';
import type { ValidationError } from '../codegen';
import { NodePalette, NODE_DRAG_MIME } from './NodePalette';
import type { NodeDragPayload } from './NodePalette';
import { NumberInput } from './NumberInput';
import { formatTraceValue } from '../hooks/useTraceSimulation';
import { useScopeSimulation } from '../hooks/useScopeSimulation';
import { Oscilloscope } from './Oscilloscope';
import { useDiagramPersistence } from '../hooks/useDiagramPersistence';
import { useViewport, MIN_ZOOM, MAX_ZOOM, ZOOM_STEP } from '../hooks/useViewport';
import { useDiagramUndo } from '../hooks/useDiagramUndo';
import { useCompoundEditing } from '../hooks/useCompoundEditing';
import { DiagramNodeView } from './DiagramNodeView';
import { ConfigPanel } from './ConfigPanel';
import { CodeDialog, UploadErrorDialog } from './dialogs';
import { SerialMonitor } from './SerialMonitor';
import { canInput, canOutput, isWheelNode, supportsArduinoPort } from './diagramShared';
import type { ConfigTarget } from './diagramShared';
import type { useArduino } from '../hooks/useArduino';
import { useSerialMonitor } from '../hooks/useSerialMonitor';
import {
  ChevronDownIcon,
  GroupIcon,
  SearchIcon,
  UngroupIcon,
  WaypointsIcon,
} from './icons';
import type { PrimaryAction } from '../lib/primaryAction';
import { loadPrimaryAction, savePrimaryAction } from '../lib/primaryAction';

const NODE_W = 148;
const NODE_H = 64;
const DEFAULT_CONNECTION_WEIGHT = 1;
const TM1637_DEFAULT_BRIGHTNESS = 3;

// Global block-size scale applied to every rendered node (a view preference,
// independent of canvas zoom). Persisted to localStorage; never written into
// the diagram file (node positions stay in unscaled world coordinates).
const MIN_BLOCK_SCALE = 0.6;
const MAX_BLOCK_SCALE = 1.5;
const BLOCK_SCALE_STEP = 0.05;
const DEFAULT_BLOCK_SCALE = 1;
const BLOCK_SCALE_STORAGE_KEY = 'braitenbot-gui:block-scale:v1';

interface RobotOverlayLayout {
  bodyCx: number;
  bodyCy: number;
  bodyRadius: number;
  wheelRadius: number;
  wheelWidth: number;
  wheelHeight: number;
  leftWheelCx: number;
  leftWheelCy: number;
  rightWheelCx: number;
  rightWheelCy: number;
}

const START_CONNECTIONS: DiagramConnection[] = [];

function makePath(x1: number, y1: number, x2: number, y2: number): string {
  const c1 = y1 + 60;
  const c2 = y2 - 60;
  return `M ${x1} ${y1} C ${x1} ${c1}, ${x2} ${c2}, ${x2} ${y2}`;
}

/**
 * Evaluate the connection cubic bézier at parameter t ∈ [0, 1]. Control points
 * mirror makePath: P0=(x1,y1), P1=(x1,y1+60), P2=(x2,y2−60), P3=(x2,y2).
 */
function bezierPointAt(
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
function nearestTOnCurve(
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
function staggeredLabelT(index: number, count: number): number {
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
function portOffsetX(
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
function inputPortOffsetX(
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

function weightToColor(weight: number): string {
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

function signalToStroke(signal: number): { color: string; width: number; opacity: number } {
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

function calculateRobotOverlay(canvasWidth: number, canvasHeight: number): RobotOverlayLayout {
  const bodyDiameter = Math.max(260, Math.min(420, Math.min(canvasHeight * 0.74, canvasWidth * 0.46)));
  const bodyRadius = bodyDiameter / 2;
  const wheelRadius = bodyRadius * 0.27;
  const wheelWidth = bodyRadius * 0.18;
  const wheelHeight = bodyRadius * 0.55;
  const horizontalPadding = bodyRadius + wheelWidth + 32;
  const bodyCx = Math.min(
    canvasWidth - horizontalPadding,
    Math.max(horizontalPadding, canvasWidth * 0.5),
  );
  const bodyCy = Math.max(bodyRadius + 22, Math.min(canvasHeight - bodyRadius - 22, canvasHeight / 2));

  return {
    bodyCx,
    bodyCy,
    bodyRadius,
    wheelRadius,
    wheelWidth,
    wheelHeight,
    leftWheelCx: bodyCx - bodyRadius,
    leftWheelCy: bodyCy,
    rightWheelCx: bodyCx + bodyRadius,
    rightWheelCy: bodyCy,
  };
}

const INITIAL_ROBOT_LAYOUT = calculateRobotOverlay(960, 620);

function makeWheelNodes(layout: RobotOverlayLayout): DiagramNode[] {
  return [
    {
      id: 'motor-left',
      type: 'servo-cr',
      label: 'Left Wheel',
      x: layout.leftWheelCx - NODE_W / 2,
      y: layout.leftWheelCy - NODE_H / 2,
      servoPin: '5',
    },
    {
      id: 'motor-right',
      type: 'servo-cr',
      label: 'Right Wheel',
      x: layout.rightWheelCx - NODE_W / 2,
      y: layout.rightWheelCy - NODE_H / 2,
      servoPin: '6',
    },
  ];
}

const START_NODES: DiagramNode[] = makeWheelNodes(INITIAL_ROBOT_LAYOUT);

interface BraitenbergDiagramProps {
  arduino: ReturnType<typeof useArduino>;
}

export function BraitenbergDiagram({ arduino }: BraitenbergDiagramProps) {
  const {
    tauriAvailable,
    cliAvailable,
    cliVersion,
    cliError,
    boards,
    selectedBoard,
    setSelectedBoard,
    refreshBoards,
    uploadStatus,
    lastResult,
    compileAndUpload,
    uploadTestSketch,
    cancelUpload,
  } = arduino;
  // Top-level diagram state lives here; the user-visible `nodes` /
  // `connections` below are a routed view that switches to a compound
  // body when the user double-clicks into one (see `editingPath`).
  const [topNodes, setTopNodes] = useState<DiagramNode[]>(START_NODES);
  const [topConnections, setTopConnections] = useState<DiagramConnection[]>(START_CONNECTIONS);
  // Multi-selection for group operations. Click/shift-click on nodes maintain
  // this set; the "Group selection" toolbar action consumes it.
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(() => new Set());
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [nodeDragOffset, setNodeDragOffset] = useState({ x: 0, y: 0 });
  const [linkDraftSource, setLinkDraftSource] = useState<{ id: string; port?: OutputPortId } | null>(null);
  const [linkDraftPoint, setLinkDraftPoint] = useState({ x: 0, y: 0 });
  const [robotLayout, setRobotLayout] = useState<RobotOverlayLayout>(INITIAL_ROBOT_LAYOUT);
  const [configTarget, setConfigTarget] = useState<ConfigTarget | null>(null);
  const [loopPeriodMs, setLoopPeriodMs] = useState(20);
  const [compoundTypes, setCompoundTypes] = useState<CompoundTypeDefinition[]>([]);

  const {
    editingPath,
    setEditingPath,
    currentCompoundId,
    nodes,
    connections,
    setNodes,
    setConnections,
    enterCompound,
  } = useCompoundEditing({
    topNodes,
    topConnections,
    setTopNodes,
    setTopConnections,
    compoundTypes,
    setCompoundTypes,
  });
  const [codeGenErrors, setCodeGenErrors] = useState<ValidationError[]>([]);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [showCodeDialog, setShowCodeDialog] = useState(false);
  const [serialDebug, setSerialDebug] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem('braitenbot-gui:serial-debug:v1');
      return v ? (JSON.parse(v) as boolean) : false;
    } catch {
      return false;
    }
  });
  const [showUploadErrorDialog, setShowUploadErrorDialog] = useState(false);
  // Split-button primary action ("upload" vs "generate"), persisted so the
  // toolbar's main button remembers the user's last choice across sessions.
  const [primaryAction, setPrimaryAction] = useState<PrimaryAction>(() => loadPrimaryAction());
  const [splitMenuOpen, setSplitMenuOpen] = useState(false);
  const splitMenuRef = useRef<HTMLDivElement | null>(null);
  const [showSerialMonitor, setShowSerialMonitor] = useState(false);
  const serialMonitor = useSerialMonitor();
  const { pauseForUpload } = serialMonitor;
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const lastAppliedLayoutRef = useRef<RobotOverlayLayout | null>(null);
  const fallbackIdCounterRef = useRef(0);
  const [traceMode, setTraceMode] = useState(false);
  const [sensorValues, setSensorValues] = useState<Record<string, number>>({});
  // True once a live node drag has already captured its single undo snapshot,
  // so a whole drag collapses to one entry (reset at each drag start).
  const didPushDragUndoRef = useRef(false);
  const { zoom, pan, setPan, resetView, zoomByStep } = useViewport(canvasRef);
  // Global block-size scale (a view preference, distinct from canvas zoom).
  // Restored from localStorage; only the rendered node size changes, never the
  // stored node positions.
  const [blockScale, setBlockScale] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(BLOCK_SCALE_STORAGE_KEY);
      if (raw) {
        const parsed = Number(JSON.parse(raw));
        if (Number.isFinite(parsed)) return parsed;
      }
    } catch { /* ignore storage errors */ }
    return DEFAULT_BLOCK_SCALE;
  });
  const handleBlockScaleChange = useCallback((next: number) => {
    setBlockScale(next);
    try {
      localStorage.setItem(BLOCK_SCALE_STORAGE_KEY, JSON.stringify(next));
    } catch { /* ignore storage errors */ }
  }, []);
  const resetBlockScale = useCallback(
    () => handleBlockScaleChange(DEFAULT_BLOCK_SCALE),
    [handleBlockScaleChange],
  );
  // Connection whose weight badge is being dragged along its curve, for the
  // grabbing cursor. Null when no badge is being dragged.
  const [draggingBadgeId, setDraggingBadgeId] = useState<string | null>(null);
  // Set true when a badge pointer-drag crosses the movement threshold, so the
  // trailing click that fires on pointer-up doesn't also open the config panel.
  const badgeClickSuppressRef = useRef(false);
  const panStateRef = useRef<{ startClientX: number; startClientY: number; startPanX: number; startPanY: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  const nodeWorldPos = useCallback(
    (node: DiagramNode): { x: number; y: number } => {
      // Wheel-anchored motors are centered on their wheel. The node renders
      // with transform-origin top-left, so back off half the *scaled* size to
      // keep the visual center on the wheel at any block scale.
      if (node.id === 'motor-left') {
        return {
          x: robotLayout.leftWheelCx * zoom - (NODE_W / 2) * blockScale,
          y: robotLayout.leftWheelCy * zoom - (NODE_H / 2) * blockScale,
        };
      }
      if (node.id === 'motor-right') {
        return {
          x: robotLayout.rightWheelCx * zoom - (NODE_W / 2) * blockScale,
          y: robotLayout.rightWheelCy * zoom - (NODE_H / 2) * blockScale,
        };
      }
      return { x: node.x * zoom, y: node.y * zoom };
    },
    [zoom, robotLayout, blockScale],
  );

  const [scopeOpen, setScopeOpen] = useState(true);

  const scope = useScopeSimulation(
    traceMode ? nodes : [],
    traceMode ? connections : [],
    sensorValues,
    traceMode,
    loopPeriodMs,
    compoundTypes,
  );

  const traceResult = scope.traceResult;

  const lookupPortValue = useCallback(
    (nodeId: string, portId: string): number | undefined => {
      return traceResult.nodeValues[`${nodeId}/${portId}`];
    },
    [traceResult.nodeValues],
  );
  const [pulsingId, setPulsingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number>(0);
  const showToast = useCallback((msg: string) => {
    window.clearTimeout(toastTimerRef.current);
    setToast(msg);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3000);
  }, []);
  const pulseSensor = useCallback(
    (id: string) => {
      scope.pulse(id, 100, 200);
      setPulsingId(id);
      window.setTimeout(() => {
        setPulsingId((prev) => (prev === id ? null : prev));
      }, 200);
    },
    [scope],
  );

  const clearConfigTarget = useCallback(() => setConfigTarget(null), []);
  const { pushUndo, undo, redo, clear: clearUndoHistory } = useDiagramUndo({
    nodes,
    connections,
    compoundTypes,
    currentCompoundId,
    setTopNodes,
    setTopConnections,
    setCompoundTypes,
    onRestore: clearConfigTarget,
  });

  const isDiagramPristine = useMemo(
    () =>
      connections.length === 0 &&
      nodes.length === 2 &&
      nodes.every((node) => isWheelNode(node.id)),
    [nodes, connections],
  );

  const resetToDefault = useCallback(() => {
    clearUndoHistory();
    setTopNodes(makeWheelNodes(robotLayout));
    setTopConnections(START_CONNECTIONS);
    setLoopPeriodMs(20);
    setCompoundTypes([]);
    setEditingPath([]);
    setConfigTarget(null);
  }, [robotLayout, clearUndoHistory, setEditingPath]);

  // Persistence operates on the canonical top-level state — never on the
  // compound body currently in view — so reload/autosave round-trips
  // independent of which compound the user happens to be editing.
  useDiagramPersistence({
    state: { nodes: topNodes, connections: topConnections, loopPeriodMs, compoundTypes },
    setters: {
      // Persistence only calls this for full replacements (mount restore,
      // file load), where undoing back into the previous diagram would be
      // wrong — so the undo history dies with the old diagram.
      setNodes: (next) => {
        clearUndoHistory();
        setTopNodes(next);
      },
      setConnections: setTopConnections,
      setLoopPeriodMs,
      setCompoundTypes,
      setEditingPath,
    },
    isPristine: isDiagramPristine,
    resetToDefault,
  });

  // Group the currently-selected nodes into a new compound. Boundary-
  // crossing edges become port anchors; weights and transfers on those
  // edges stay on the *outer* edge so a user looking at the new compound
  // instance sees the same wiring they had before grouping.
  //
  // Wheel motors and other top-level-only types can't move into a body,
  // so they're filtered out of the selection silently before grouping.
  const handleGroupSelection = useCallback(() => {
    const selectedNodes = nodes.filter(
      (n) =>
        selectedNodeIds.has(n.id) &&
        !TYPE_BY_ID[n.type].topLevelOnly &&
        !(n.type === 'servo-cr' && (n.id === 'motor-left' || n.id === 'motor-right')),
    );
    if (selectedNodes.length === 0) return;
    pushUndo();

    const selectedIds = new Set(selectedNodes.map((n) => n.id));
    const isInternal = (conn: DiagramConnection) =>
      selectedIds.has(conn.from) && selectedIds.has(conn.to);
    const incomingBoundary = connections.filter(
      (c) => selectedIds.has(c.to) && !selectedIds.has(c.from),
    );
    const outgoingBoundary = connections.filter(
      (c) => selectedIds.has(c.from) && !selectedIds.has(c.to),
    );
    const internalConns = connections.filter((c) => isInternal(c));

    const nextNumber = compoundTypes.length + 1;
    const compoundTypeId = `compound-${nextNumber}-${Math.random().toString(36).slice(2, 8)}`;

    // Compute centroid for placing the resulting instance node on the
    // outer canvas, then translate body nodes so the selection's
    // top-left maps to a comfortable origin inside the body.
    const minX = Math.min(...selectedNodes.map((n) => n.x));
    const minY = Math.min(...selectedNodes.map((n) => n.y));
    const cx = (Math.min(...selectedNodes.map((n) => n.x)) + Math.max(...selectedNodes.map((n) => n.x))) / 2;
    const cy = (Math.min(...selectedNodes.map((n) => n.y)) + Math.max(...selectedNodes.map((n) => n.y))) / 2;

    const BODY_MARGIN = 120;
    const bodyNodes: DiagramNode[] = selectedNodes.map((n) => ({
      ...n,
      x: n.x - minX + BODY_MARGIN + 100,
      y: n.y - minY + BODY_MARGIN,
    }));

    // One input anchor per *distinct internal target* (not per boundary
    // edge) and one output anchor per *distinct internal source*. This
    // way a single internal output fanning out to multiple external
    // destinations still presents one port on the compound. Names are
    // generic ("in", "in_2", "out", …) so users can rename in the body
    // editor without inheriting confusing external-endpoint context.
    const inputTargetIds: string[] = [];
    for (const edge of incomingBoundary) {
      if (!inputTargetIds.includes(edge.to)) inputTargetIds.push(edge.to);
    }
    const outputSourceIds: string[] = [];
    for (const edge of outgoingBoundary) {
      if (!outputSourceIds.includes(edge.from)) outputSourceIds.push(edge.from);
    }
    const nameWithIndex = (base: string, i: number) => (i === 0 ? base : `${base}_${i + 1}`);
    const inputPortIdByTarget = new Map<string, string>();
    inputTargetIds.forEach((targetId, i) => {
      inputPortIdByTarget.set(targetId, nameWithIndex('in', i));
    });
    const outputPortIdBySource = new Map<string, string>();
    outputSourceIds.forEach((sourceId, i) => {
      outputPortIdBySource.set(sourceId, nameWithIndex('out', i));
    });

    const inputAnchorNodes: DiagramNode[] = [...inputPortIdByTarget.entries()].map(
      ([, portId], i) => ({
        id: portId,
        type: 'compound-input',
        label: portId,
        x: BODY_MARGIN,
        y: BODY_MARGIN + i * (NODE_H + 20),
      }),
    );
    const outputAnchorNodes: DiagramNode[] = [...outputPortIdBySource.entries()].map(
      ([, portId], i) => ({
        id: portId,
        type: 'compound-output',
        label: portId,
        x: BODY_MARGIN + 700,
        y: BODY_MARGIN + i * (NODE_H + 20),
      }),
    );

    // Internal pass-through edges from input anchor → original target and
    // from original source → output anchor. Unit weight, linear transfer:
    // the user-facing weight/transfer stays on the *outer* edge so the
    // compound instance reads identically to the pre-group wiring.
    const linearOne = () => ({
      weight: 1,
      transferMode: 'linear' as const,
      transferPoints: [
        { x: -100, y: -100 },
        { x: 100, y: 100 },
      ],
    });
    const innerInputEdges: DiagramConnection[] = [...inputPortIdByTarget.entries()].map(
      ([targetId, portId], i) => ({
        id: `${compoundTypeId}/in-${i}`,
        from: portId,
        to: targetId,
        ...linearOne(),
      }),
    );
    const innerOutputEdges: DiagramConnection[] = [...outputPortIdBySource.entries()].map(
      ([sourceId, portId], i) => ({
        id: `${compoundTypeId}/out-${i}`,
        from: sourceId,
        to: portId,
        ...linearOne(),
      }),
    );

    const def: CompoundTypeDefinition = {
      id: compoundTypeId,
      displayName: `Compound ${nextNumber}`,
      body: {
        nodes: [...inputAnchorNodes, ...bodyNodes, ...outputAnchorNodes],
        connections: [...internalConns, ...innerInputEdges, ...innerOutputEdges],
      },
    };

    // Replace the selected nodes on the outer canvas with one compound
    // instance positioned at the selection centroid.
    const instanceId = `compound-inst-${Math.random().toString(36).slice(2, 8)}`;
    const instanceNode: DiagramNode = {
      id: instanceId,
      type: 'compound',
      label: def.displayName,
      x: cx,
      y: cy,
      compoundTypeId,
    };

    // Rewire boundary edges to target the new instance + port. Internal
    // edges are gone (moved into the body); external↔external edges are
    // untouched. Multiple boundary edges that share an internal endpoint
    // all route through the same port.
    const rewiredConnections: DiagramConnection[] = [];
    for (const conn of connections) {
      if (isInternal(conn)) continue;
      const inboundPort = selectedIds.has(conn.to) && !selectedIds.has(conn.from)
        ? inputPortIdByTarget.get(conn.to)
        : undefined;
      const outboundPort = selectedIds.has(conn.from) && !selectedIds.has(conn.to)
        ? outputPortIdBySource.get(conn.from)
        : undefined;
      if (inboundPort) {
        rewiredConnections.push({ ...conn, to: instanceId, toPort: inboundPort });
      } else if (outboundPort) {
        rewiredConnections.push({ ...conn, from: instanceId, fromPort: outboundPort });
      } else {
        rewiredConnections.push(conn);
      }
    }

    setCompoundTypes((prev) => [...prev, def]);
    setNodes((prev) => [...prev.filter((n) => !selectedIds.has(n.id)), instanceNode]);
    setConnections(rewiredConnections);
    setSelectedNodeIds(new Set([instanceId]));
    setConfigTarget({ kind: 'node', id: instanceId });
  }, [
    nodes,
    connections,
    selectedNodeIds,
    compoundTypes.length,
    pushUndo,
    setCompoundTypes,
    setNodes,
    setConnections,
  ]);

  // True when the selection is exactly one compound instance — that's the
  // only state in which "Ungroup" makes sense.
  const ungroupCandidate = useMemo(() => {
    if (selectedNodeIds.size !== 1) return null;
    const id = [...selectedNodeIds][0];
    const node = nodes.find((n) => n.id === id);
    if (!node || node.type !== 'compound' || !node.compoundTypeId) return null;
    const def = compoundTypes.find((c) => c.id === node.compoundTypeId);
    if (!def) return null;
    return { node, def };
  }, [selectedNodeIds, nodes, compoundTypes]);

  // Ungroup: inline one compound instance back into its parent. Inverse of
  // grouping — port anchors become compute-summation pass-throughs so any
  // weight/transfer that was on the outer edge composes correctly with the
  // unit-weight internal edges we generated at group time. Nested compounds
  // inside the body stay as compound instances (single-level expansion).
  const handleUngroup = useCallback(() => {
    if (!ungroupCandidate) return;
    const { node: instance, def } = ungroupCandidate;
    pushUndo();

    const prefix = `${instance.id}/`;
    const idRemap = new Map<string, string>();
    for (const n of def.body.nodes) idRemap.set(n.id, prefix + n.id);

    // Translate body positions so the body's centroid lands on the instance.
    const bodyXs = def.body.nodes.map((n) => n.x);
    const bodyYs = def.body.nodes.map((n) => n.y);
    const bodyCx = bodyXs.length ? (Math.min(...bodyXs) + Math.max(...bodyXs)) / 2 : 0;
    const bodyCy = bodyYs.length ? (Math.min(...bodyYs) + Math.max(...bodyYs)) / 2 : 0;
    const dx = instance.x - bodyCx;
    const dy = instance.y - bodyCy;

    const inlinedNodes: DiagramNode[] = def.body.nodes.map((n) => ({
      ...n,
      id: idRemap.get(n.id)!,
      type:
        n.type === 'compound-input' || n.type === 'compound-output'
          ? 'compute-summation'
          : n.type,
      x: n.x + dx,
      y: n.y + dy,
    }));
    const inlinedConns: DiagramConnection[] = def.body.connections.map((c) => ({
      ...c,
      id: prefix + c.id,
      from: idRemap.get(c.from) ?? c.from,
      to: idRemap.get(c.to) ?? c.to,
    }));

    // Rewire external edges that referenced this instance via a port. An
    // edge without a port is dropped (the validator surfaces these).
    const rewiredExternal: DiagramConnection[] = [];
    for (const conn of connections) {
      if (conn.from === instance.id) {
        if (!conn.fromPort) continue;
        const anchorId = prefix + conn.fromPort;
        if (!idRemap.has(conn.fromPort)) continue;
        const { fromPort: _fp, toPort: _tp, ...rest } = conn;
        void _fp;
        void _tp;
        rewiredExternal.push({ ...rest, from: anchorId });
      } else if (conn.to === instance.id) {
        if (!conn.toPort) continue;
        const anchorId = prefix + conn.toPort;
        if (!idRemap.has(conn.toPort)) continue;
        const { fromPort: _fp, toPort: _tp, ...rest } = conn;
        void _fp;
        void _tp;
        rewiredExternal.push({ ...rest, to: anchorId });
      } else {
        rewiredExternal.push(conn);
      }
    }

    setNodes((prev) => [...prev.filter((n) => n.id !== instance.id), ...inlinedNodes]);
    setConnections([...rewiredExternal, ...inlinedConns]);
    setSelectedNodeIds(new Set());
    setConfigTarget(null);
  }, [ungroupCandidate, connections, pushUndo, setNodes, setConnections]);

  const handleSerialDebugChange = useCallback((newValue: boolean) => {
    setSerialDebug(newValue);
    try {
      localStorage.setItem('braitenbot-gui:serial-debug:v1', JSON.stringify(newValue));
    } catch { /* ignore storage errors */ }
    if (generatedCode !== null) {
      const graph = buildGraph(topNodes, topConnections, loopPeriodMs, compoundTypes);
      setGeneratedCode(generateSketch(graph, { serialDebug: newValue }));
    }
  }, [generatedCode, topNodes, topConnections, loopPeriodMs, compoundTypes]);

  const handleGenerate = useCallback(() => {
    // Codegen always targets the canonical top-level diagram, even if the
    // user is currently inside a compound body.
    const errors = validateGraph(topNodes, topConnections, compoundTypes);
    setCodeGenErrors(errors);
    const hasErrors = errors.some((e) => e.severity === 'error');
    if (hasErrors) {
      setGeneratedCode(null);
      setShowCodeDialog(true);
      return;
    }
    const graph = buildGraph(topNodes, topConnections, loopPeriodMs, compoundTypes);
    setGeneratedCode(generateSketch(graph, { serialDebug }));
    setShowCodeDialog(true);
  }, [topNodes, topConnections, loopPeriodMs, compoundTypes, serialDebug]);

  const handleCopyCode = useCallback(() => {
    if (generatedCode) {
      navigator.clipboard.writeText(generatedCode);
    }
  }, [generatedCode]);

  const handleDownloadCode = useCallback(() => {
    if (!generatedCode) return;
    const blob = new Blob([generatedCode], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'braitenbot.ino';
    a.click();
    URL.revokeObjectURL(url);
  }, [generatedCode]);

  const handleUploadToArduino = useCallback(async () => {
    // Always upload the canonical top-level diagram, not whichever
    // compound body the user is currently editing.
    const errors = validateGraph(topNodes, topConnections, compoundTypes);
    const hasErrors = errors.some((e) => e.severity === 'error');
    if (hasErrors) {
      setCodeGenErrors(errors);
      setGeneratedCode(null);
      setShowCodeDialog(true);
      return;
    }
    if (!selectedBoard || !selectedBoard.fqbn) {
      setCodeGenErrors([
        {
          severity: 'error',
          message: 'No board selected. Plug in an Arduino and click Refresh.',
        },
      ]);
      setGeneratedCode(null);
      setShowCodeDialog(true);
      return;
    }
    const graph = buildGraph(topNodes, topConnections, loopPeriodMs, compoundTypes);
    const code = generateSketch(graph, { serialDebug });
    setGeneratedCode(code);
    // Release the serial port first: a running monitor holds it and would make
    // the upload fail. Not auto-restarted afterwards (boards re-enumerate).
    await pauseForUpload();
    await compileAndUpload(code, selectedBoard.fqbn, selectedBoard.port);
  }, [topNodes, topConnections, loopPeriodMs, compoundTypes, selectedBoard, compileAndUpload, pauseForUpload, serialDebug]);

  // Hardware ▸ Upload Test Sketch — flash the bundled bring-up test that
  // exercises every device in the default build. Independent of the diagram.
  const handleUploadTestSketch = useCallback(async () => {
    if (!selectedBoard || !selectedBoard.fqbn) {
      setCodeGenErrors([
        {
          severity: 'error',
          message: 'No board selected. Plug in an Arduino and click Refresh.',
        },
      ]);
      setGeneratedCode(null);
      setShowCodeDialog(true);
      return;
    }
    await pauseForUpload();
    await uploadTestSketch(selectedBoard.fqbn, selectedBoard.port);
  }, [selectedBoard, uploadTestSketch, pauseForUpload]);

  // Choosing an option in the split-button menu only re-points the primary
  // segment (and persists it) — it does not run anything. The user then clicks
  // the primary segment to execute, matching the Gmail "Send | Schedule send"
  // pattern.
  const selectPrimaryAction = useCallback((action: PrimaryAction) => {
    setPrimaryAction(action);
    savePrimaryAction(action);
    setSplitMenuOpen(false);
  }, []);

  // Close the split-button menu on an outside click or Escape.
  useEffect(() => {
    if (!splitMenuOpen) return;
    const onPointerDown = (event: Event) => {
      if (splitMenuRef.current && !splitMenuRef.current.contains(event.target as Node)) {
        setSplitMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSplitMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [splitMenuOpen]);

  // Serial monitor open/close. The toolbar button toggles both the panel and
  // the underlying monitor process together; closing the panel stops it.
  const openSerialMonitor = useCallback(() => {
    if (!selectedBoard) return;
    setShowSerialMonitor(true);
    void serialMonitor.start(selectedBoard.port);
  }, [selectedBoard, serialMonitor]);

  const closeSerialMonitor = useCallback(() => {
    setShowSerialMonitor(false);
    void serialMonitor.stop();
  }, [serialMonitor]);

  const toggleSerialMonitor = useCallback(() => {
    if (showSerialMonitor) closeSerialMonitor();
    else openSerialMonitor();
  }, [showSerialMonitor, closeSerialMonitor, openSerialMonitor]);

  useEffect(() => {
    if (!tauriAvailable) return;
    let unlisten: (() => void) | undefined;
    listen('menu://upload-test-sketch', () => {
      void handleUploadTestSketch();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [tauriAvailable, handleUploadTestSketch]);

  const makeId = useCallback((prefix: string): string => {
    const uuid =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `fallback-${(fallbackIdCounterRef.current++).toString(36).padStart(8, '0')}`;
    return `${prefix}-${uuid.replace(/-/g, '').slice(0, 12)}`;
  }, []);

  const nodeMap = useMemo(
    () => Object.fromEntries(nodes.map((n) => [n.id, n])) as Record<string, DiagramNode>,
    [nodes],
  );

  // Latest volatile values, mirrored into a ref so the node-drag / link
  // handlers below can stay referentially stable (empty useCallback deps).
  // Passing stable handlers to the memoized DiagramNodeView keeps its memo
  // intact during a node drag, when `nodeMap` / `connections` change every
  // frame. Event handlers only read these at call time (after commit), so the
  // values are always current — behavior matches closing over them directly.
  const handlerStateRef = useRef({ pan, nodeMap, connections, linkDraftSource });
  // eslint-disable-next-line react-hooks/refs
  handlerStateRef.current = { pan, nodeMap, connections, linkDraftSource };

  const deleteNode = useCallback((nodeId: string) => {
    const node = nodeMap[nodeId];
    if (!node || isWheelNode(node.id)) return;
    pushUndo();
    setNodes((prev) => prev.filter((n) => n.id !== nodeId));
    setConnections((prev) => prev.filter((c) => c.from !== nodeId && c.to !== nodeId));
    setConfigTarget(null);
  }, [nodeMap, pushUndo, setNodes, setConnections]);

  const deleteConnection = useCallback((connectionId: string) => {
    pushUndo();
    setConnections((prev) => prev.filter((c) => c.id !== connectionId));
    setConfigTarget(null);
  }, [pushUndo, setConnections]);

  const connectionPaths = useMemo(() => {
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
        const from = nodeMap[connection.from];
        const to = nodeMap[connection.to];
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
  }, [connections, nodeMap, nodeWorldPos, compoundTypes, blockScale]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const applyLayout = (layout: RobotOverlayLayout) => {
      const prev = lastAppliedLayoutRef.current;
      lastAppliedLayoutRef.current = layout;
      setRobotLayout(layout);

      const snapMotor = (node: DiagramNode): DiagramNode => {
        if (node.id === 'motor-left') {
          return { ...node, x: layout.leftWheelCx - NODE_W / 2, y: layout.leftWheelCy - NODE_H / 2 };
        }
        if (node.id === 'motor-right') {
          return { ...node, x: layout.rightWheelCx - NODE_W / 2, y: layout.rightWheelCy - NODE_H / 2 };
        }
        return node;
      };

      // Always target the top-level diagram: the wheel anchors live there, and
      // resize must not translate a compound body that happens to be open.
      if (prev === null) {
        setTopNodes((nodes) => nodes.map(snapMotor));
        return;
      }

      const dx = layout.bodyCx - prev.bodyCx;
      const dy = layout.bodyCy - prev.bodyCy;
      if (dx === 0 && dy === 0) return;

      setTopNodes((nodes) =>
        nodes.map((node) => {
          if (node.id === 'motor-left' || node.id === 'motor-right') return snapMotor(node);
          return { ...node, x: node.x + dx, y: node.y + dy };
        }),
      );
    };

    const updateLayout = () => {
      const rect = canvas.getBoundingClientRect();
      applyLayout(calculateRobotOverlay(rect.width, rect.height));
    };

    updateLayout();
    const observer = new ResizeObserver(updateLayout);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!configTarget) return;
    // guard: deselect config panel when the targeted node/connection is deleted
    if (configTarget.kind === 'node' && !nodeMap[configTarget.id]) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setConfigTarget(null);
      return;
    }
    if (configTarget.kind === 'connection' && !connections.some((connection) => connection.id === configTarget.id)) {
      setConfigTarget(null);
    }
  }, [configTarget, connections, nodeMap]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore shortcuts while typing in a form control, or while any dialog is
      // open (so e.g. Backspace over the generated-code dialog doesn't delete
      // the node selected on the canvas behind it).
      const isBlocked = () => {
        const target = event.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
        if (document.activeElement?.closest('dialog')) return true;
        if (document.querySelector('dialog[open]')) return true;
        return false;
      };
      const key = event.key.toLowerCase();
      const mod = event.metaKey || event.ctrlKey;
      if ((event.key === 'Delete' || event.key === 'Backspace') && configTarget) {
        if (isBlocked()) return;
        if (configTarget.kind === 'node') deleteNode(configTarget.id);
        if (configTarget.kind === 'connection') deleteConnection(configTarget.id);
      }
      // Trace mode: arrow keys adjust the selected node's input value, so the
      // user can click a node and nudge it without grabbing the tiny slider.
      // Up/Right increase, Down/Left decrease; Shift steps by 10.
      const arrowDelta =
        event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 :
        event.key === 'ArrowDown' || event.key === 'ArrowLeft' ? -1 : 0;
      if (arrowDelta !== 0 && !mod && traceMode && configTarget?.kind === 'node') {
        if (isBlocked()) return;
        const node = nodeMap[configTarget.id];
        if (!node) return;
        const nodeType = TYPE_BY_ID[node.type];
        const step = arrowDelta * (event.shiftKey ? 10 : 1);
        if (node.type === 'sensor-digital') {
          event.preventDefault();
          setSensorValues((prev) => ({ ...prev, [node.id]: arrowDelta > 0 ? 100 : 0 }));
        } else if (nodeType.kind === 'sensor' && node.type !== 'sensor-color') {
          event.preventDefault();
          setSensorValues((prev) => ({
            ...prev,
            [node.id]: Math.max(0, Math.min(100, (prev[node.id] ?? 50) + step)),
          }));
        } else if (node.type === 'compound-input') {
          event.preventDefault();
          setSensorValues((prev) => ({
            ...prev,
            [node.id]: Math.max(-100, Math.min(100, (prev[node.id] ?? 0) + step)),
          }));
        } else if (nodeType.kind === 'constant') {
          event.preventDefault();
          setNodes((prev) => prev.map((n) =>
            n.id === node.id
              ? { ...n, constantValue: Math.max(-100, Math.min(100, (n.constantValue ?? 0) + step)) }
              : n,
          ));
        }
      }
      // Redo: Cmd/Ctrl+Shift+Z or Cmd/Ctrl+Y.
      if (mod && ((key === 'z' && event.shiftKey) || key === 'y')) {
        if (isBlocked()) return;
        event.preventDefault();
        redo();
      } else if (mod && key === 'z' && !event.shiftKey) {
        if (isBlocked()) return;
        event.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [configTarget, deleteNode, deleteConnection, undo, redo, traceMode, nodeMap, setNodes]);

  const beginNodeDrag = useCallback((event: MouseEvent, nodeId: string) => {
    if (event.button !== 0) return;
    if (isWheelNode(nodeId)) return;
    const target = event.currentTarget as HTMLDivElement;
    const rect = target.getBoundingClientRect();
    setDraggingNodeId(nodeId);
    setNodeDragOffset({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    // Defer the undo snapshot until the first actual movement, so a click
    // (mousedown without a drag) doesn't spam the undo stack.
    didPushDragUndoRef.current = false;
  }, []);

  const handleCanvasMouseDown = (event: MouseEvent) => {
    const isBackground = event.target === event.currentTarget;
    const shouldPan = event.button === 1 || (event.button === 0 && isBackground);
    if (!shouldPan) return;
    event.preventDefault();
    // Clicking empty canvas clears the multi-selection (matches the
    // common convention in Figma / VSCode / etc.).
    if (event.button === 0 && isBackground && !event.shiftKey) {
      setSelectedNodeIds(new Set());
    }
    panStateRef.current = {
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPanX: pan.x,
      startPanY: pan.y,
    };
    setIsPanning(true);
  };

  const beginLinkDrag = useCallback((event: MouseEvent, nodeId: string, port?: OutputPortId) => {
    event.stopPropagation();
    if (!canvasRef.current) return;
    const { pan } = handlerStateRef.current;
    const rect = canvasRef.current.getBoundingClientRect();
    setLinkDraftSource({ id: nodeId, port });
    setLinkDraftPoint({ x: event.clientX - rect.left - pan.x, y: event.clientY - rect.top - pan.y });
  }, []);

  // Drag a connection's weight badge along its own curve. Below a small
  // movement threshold this is a click (opens the connection config); past it
  // we project the cursor onto the bézier and store the nearest t as labelT.
  // Badge placement carries no undo entry — it's a cheap, repeatable tweak.
  const beginBadgeDrag = (
    event: PointerEvent<HTMLButtonElement>,
    conn: { id: string; x1: number; y1: number; x2: number; y2: number },
  ) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const target = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let dragged = false;
    target.setPointerCapture(pointerId);

    const move = (e: globalThis.PointerEvent) => {
      if (!dragged && Math.hypot(e.clientX - startX, e.clientY - startY) < 4) return;
      if (!dragged) {
        dragged = true;
        badgeClickSuppressRef.current = true;
        setDraggingBadgeId(conn.id);
      }
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left - pan.x;
      const py = e.clientY - rect.top - pan.y;
      const t = nearestTOnCurve(conn.x1, conn.y1, conn.x2, conn.y2, px, py);
      setConnections((prev) => prev.map((c) => (c.id === conn.id ? { ...c, labelT: t } : c)));
    };
    const up = () => {
      target.releasePointerCapture(pointerId);
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      setDraggingBadgeId(null);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };

  const handleCanvasMove = (event: MouseEvent) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;

    if (panStateRef.current) {
      const s = panStateRef.current;
      setPan({
        x: s.startPanX + (event.clientX - s.startClientX),
        y: s.startPanY + (event.clientY - s.startClientY),
      });
      return;
    }

    if (draggingNodeId) {
      // Capture one undo snapshot per drag, on the first move (before the
      // node's position actually changes), so undo returns it to where the
      // drag began.
      if (!didPushDragUndoRef.current) {
        pushUndo();
        didPushDragUndoRef.current = true;
      }
      const screenLeft = pointerX - nodeDragOffset.x;
      const screenTop = pointerY - nodeDragOffset.y;
      const worldX = (screenLeft - pan.x) / zoom;
      const worldY = (screenTop - pan.y) / zoom;
      setNodes((prev) =>
        prev.map((node) =>
          node.id === draggingNodeId ? { ...node, x: worldX, y: worldY } : node,
        ),
      );
    }

    if (linkDraftSource) {
      setLinkDraftPoint({ x: pointerX - pan.x, y: pointerY - pan.y });
    }
  };

  const handleCanvasMouseUp = () => {
    setDraggingNodeId(null);
    setLinkDraftSource(null);
    if (panStateRef.current) {
      panStateRef.current = null;
      setIsPanning(false);
    }
  };

  const handleDropNode = (event: DragEvent) => {
    event.preventDefault();
    if (!canvasRef.current) return;
    const raw = event.dataTransfer.getData(NODE_DRAG_MIME);
    if (!raw) return;
    let payload: NodeDragPayload;
    try {
      payload = JSON.parse(raw) as NodeDragPayload;
    } catch {
      return;
    }
    const nodeTypeId = payload.type;
    if (!nodeTypeId || !(nodeTypeId in TYPE_BY_ID)) return;
    const typeDef = TYPE_BY_ID[nodeTypeId];
    // Body-only types (port anchors) only drop inside a compound body;
    // dropping one at the top level is silently ignored.
    if (typeDef.bodyOnly && editingPath.length === 0) return;
    // Compound instances need their target type id from the drag payload.
    const compoundTypeId = nodeTypeId === 'compound' ? payload.compoundTypeId ?? null : null;
    if (nodeTypeId === 'compound' && !compoundTypeId) return;
    pushUndo();

    const rect = canvasRef.current.getBoundingClientRect();
    // Center the (scaled) node under the cursor: the node renders with
    // transform-origin top-left, so offset by half the scaled size.
    const screenX = event.clientX - rect.left - (NODE_W / 2) * blockScale;
    const screenY = event.clientY - rect.top - (NODE_H / 2) * blockScale;
    const x = (screenX - pan.x) / zoom;
    const y = (screenY - pan.y) / zoom;

    const id = makeId(nodeTypeId);
    const baseLabel =
      compoundTypeId
        ? compoundTypes.find((c) => c.id === compoundTypeId)?.displayName ?? 'Compound'
        : TYPE_BY_ID[nodeTypeId].displayName;
    setNodes((prev) => {
      const nodeNumber = prev.filter((node) => node.type === nodeTypeId).length + 1;
      const nodeType = TYPE_BY_ID[nodeTypeId];
      return [
        ...prev,
        {
          id,
          type: nodeTypeId,
          label: payload.label ?? `${baseLabel} ${nodeNumber}`,
          x,
          y,
          arduinoPort: supportsArduinoPort(nodeType) ? '' : undefined,
          threshold:
            nodeType.mode === 'threshold' || nodeTypeId === 'digital-out' ? 50 : undefined,
          delayMs: nodeType.mode === 'delay' ? 100 : undefined,
          frequencyHz: nodeType.mode === 'oscillator' ? 1.0 : undefined,
          amplitude:
            nodeType.mode === 'oscillator'
              ? 100
              : nodeType.mode === 'noise'
                ? 50
                : undefined,
          constantValue: nodeType.kind === 'constant' ? 0 : undefined,
          servoPin:
            nodeType.kind === 'output' && nodeType.id !== 'display-tm1637' ? '' : undefined,
          clkPin: nodeType.id === 'display-tm1637' ? '' : undefined,
          gpioPin: nodeType.id === 'display-tm1637' ? '' : undefined,
          xshutPin: nodeType.id === 'sensor-tof' ? '' : undefined,
          maxDistanceMm: nodeType.id === 'sensor-tof' ? DEFAULT_TOF_MAX_MM : undefined,
          brightness:
            nodeType.id === 'display-tm1637' ? TM1637_DEFAULT_BRIGHTNESS : undefined,
          compoundTypeId: compoundTypeId ?? undefined,
          // Kit presets pre-fill pins/params on top of the type defaults above.
          ...payload.params,
        },
      ];
    });
  };

  const canConnect = useCallback((fromId: string, toId: string, fromPort?: OutputPortId): boolean => {
    if (fromId === toId) return false;
    const { nodeMap, connections } = handlerStateRef.current;
    const from = nodeMap[fromId];
    const to = nodeMap[toId];
    if (!from || !to) return false;
    const fromType = TYPE_BY_ID[from.type];
    const toType = TYPE_BY_ID[to.type];
    if (!canOutput(fromType) || !canInput(toType)) return false;
    if (connections.some(
      (connection) =>
        connection.from === fromId &&
        connection.to === toId &&
        (connection.fromPort ?? undefined) === fromPort,
    )) return false;
    if (toType.maxInputs !== undefined) {
      const existing = connections.filter((c) => c.to === toId).length;
      if (existing >= toType.maxInputs) return false;
    }
    return true;
  }, []);

  const completeLink = useCallback((toId: string, toPort?: string) => {
    const { nodeMap, connections, linkDraftSource } = handlerStateRef.current;
    if (!linkDraftSource) {
      setLinkDraftSource(null);
      return;
    }
    if (!canConnect(linkDraftSource.id, toId, linkDraftSource.port)) {
      const to = nodeMap[toId];
      if (to) {
        const toType = TYPE_BY_ID[to.type];
        if (toType.maxInputs !== undefined) {
          const existing = connections.filter((c) => c.to === toId).length;
          if (existing >= toType.maxInputs) {
            showToast(`${toType.displayName} only accepts ${toType.maxInputs} incoming connection${toType.maxInputs === 1 ? '' : 's'}. Use a Summation node to combine signals.`);
          }
        }
      }
      setLinkDraftSource(null);
      return;
    }
    pushUndo();
    const { id: fromId, port: fromPort } = linkDraftSource;
    setConnections((prev) => [
      ...prev,
      {
        id: makeId('link'),
        from: fromId,
        ...(fromPort ? { fromPort } : {}),
        to: toId,
        ...(toPort ? { toPort } : {}),
        weight: DEFAULT_CONNECTION_WEIGHT,
        transferMode: 'linear',
        transferPoints: [{ x: -100, y: -100 }, { x: 100, y: 100 }],
      },
    ]);
    setLinkDraftSource(null);
  }, [canConnect, showToast, pushUndo, setConnections, makeId]);

  const selectedNode = configTarget?.kind === 'node' ? nodeMap[configTarget.id] : null;
  const selectedConnection =
    configTarget?.kind === 'connection'
      ? connections.find((connection) => connection.id === configTarget.id) ?? null
      : null;

  // Split-button derived state. Upload requires the desktop shell, a working
  // arduino-cli, and a selected board; generate-only is always available (it
  // never touches hardware — matching the old always-on Generate button).
  const uploadBusy = uploadStatus === 'compiling' || uploadStatus === 'uploading';
  const uploadSupported = tauriAvailable && cliAvailable;
  const canUpload = uploadSupported && !!selectedBoard && !!selectedBoard.fqbn;
  const primaryIsUpload = primaryAction === 'upload';
  const primaryLabel = primaryIsUpload
    ? uploadStatus === 'compiling'
      ? 'Compiling…'
      : uploadStatus === 'uploading'
        ? 'Uploading…'
        : uploadStatus === 'success'
          ? 'Uploaded!'
          : uploadStatus === 'error'
            ? 'Upload failed'
            : 'Upload to Arduino'
    : 'Generate';
  const primaryDisabled = primaryIsUpload ? !canUpload || uploadBusy : false;
  const runPrimaryAction = primaryIsUpload ? handleUploadToArduino : handleGenerate;

  return (
    <section className="diagram-layout">
      <NodePalette compoundTypes={compoundTypes} isEditingCompound={editingPath.length > 0} />

      <div className="canvas-toolbar">
        <div className="toolbar-group">
          <span className="toolbar-group-label">Group</span>
          <button
            type="button"
            className="toolbar-btn toolbar-secondary"
            onClick={handleGroupSelection}
            disabled={selectedNodeIds.size < 2}
            title={
              selectedNodeIds.size < 2
                ? 'Shift-click two or more nodes to enable grouping.'
                : `Wrap the ${selectedNodeIds.size} selected nodes in a new compound subdiagram.`
            }
          >
            <GroupIcon />
            <span>
              {selectedNodeIds.size >= 2
                ? `Group ${selectedNodeIds.size}`
                : 'Group'}
            </span>
          </button>
          <button
            type="button"
            className="toolbar-btn toolbar-secondary"
            onClick={handleUngroup}
            disabled={!ungroupCandidate}
            title={
              ungroupCandidate
                ? `Inline ${ungroupCandidate.def.displayName} back into this diagram.`
                : 'Select a single compound instance to ungroup it.'
            }
          >
            <UngroupIcon />
            <span>Ungroup</span>
          </button>
        </div>

        <div className="toolbar-separator" />

        <div className="toolbar-group">
          <span className="toolbar-group-label">Simulate</span>
          <button
            className={`toolbar-btn toolbar-secondary toolbar-trace ${traceMode ? 'active' : ''}`}
            onClick={() => setTraceMode((v) => !v)}
          >
            <WaypointsIcon />
            <span>{traceMode ? 'Exit Trace' : 'Trace Signal Flow'}</span>
          </button>
        </div>

        <div className="toolbar-separator" />

        <div className="toolbar-group">
          <span className="toolbar-group-label">Sketch</span>
          <label className="toolbar-setting" title="Delay between sensor reads in the generated Arduino loop">
            <span className="toolbar-setting-label">Loop</span>
            <NumberInput
              min={1}
              max={1000}
              step={1}
              integer
              value={loopPeriodMs}
              onChange={setLoopPeriodMs}
            />
            <span className="toolbar-setting-unit">ms</span>
          </label>
          <div className="toolbar-split" ref={splitMenuRef}>
            <button
              type="button"
              className="toolbar-btn toolbar-primary toolbar-split-primary"
              onClick={runPrimaryAction}
              disabled={primaryDisabled}
              title={
                primaryIsUpload
                  ? canUpload
                    ? 'Compile the diagram and upload it to the connected board.'
                    : 'Select a connected board to upload.'
                  : 'Compile the diagram and show the generated Arduino code.'
              }
            >
              {primaryLabel}
            </button>
            <button
              type="button"
              className="toolbar-btn toolbar-primary toolbar-split-chevron"
              onClick={() => setSplitMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={splitMenuOpen}
              aria-label="Choose the primary action"
              title="Choose the primary action"
            >
              <ChevronDownIcon size={14} />
            </button>
            {splitMenuOpen && (
              <div className="toolbar-split-menu" role="menu">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={primaryIsUpload}
                  className={`toolbar-split-menu-item ${primaryIsUpload ? 'current' : ''}`.trim()}
                  onClick={() => selectPrimaryAction('upload')}
                  disabled={!uploadSupported}
                  title={
                    uploadSupported
                      ? undefined
                      : 'Uploading needs the desktop app and arduino-cli.'
                  }
                >
                  <span className="toolbar-split-menu-check" aria-hidden="true">
                    {primaryIsUpload ? '✓' : ''}
                  </span>
                  Upload to robot
                </button>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={!primaryIsUpload}
                  className={`toolbar-split-menu-item ${!primaryIsUpload ? 'current' : ''}`.trim()}
                  onClick={() => selectPrimaryAction('generate')}
                >
                  <span className="toolbar-split-menu-check" aria-hidden="true">
                    {!primaryIsUpload ? '✓' : ''}
                  </span>
                  Generate code only
                </button>
              </div>
            )}
          </div>
          {primaryIsUpload && uploadBusy && (
            <button
              type="button"
              className="toolbar-btn toolbar-tertiary"
              onClick={cancelUpload}
              title="Cancel the in-progress upload"
            >
              Cancel
            </button>
          )}
        </div>

        <div className="toolbar-group toolbar-serial">
          <span className="toolbar-group-label">Device</span>
          {!tauriAvailable ? (
            <span className="serial-unsupported" title="Launch the desktop build with `npm run tauri:dev`">
              Desktop app required
            </span>
          ) : !cliAvailable ? (
            <span className="serial-error-msg" title={cliError ?? undefined}>
              arduino-cli not found
            </span>
          ) : (
            <>
              <span
                className="serial-status-dot"
                data-status={selectedBoard ? 'connected' : 'disconnected'}
                title={cliVersion ?? undefined}
              />
              <select
                className="toolbar-board-select"
                value={selectedBoard ? `${selectedBoard.port}|${selectedBoard.fqbn ?? ''}` : ''}
                onChange={(e) => {
                  // arduino-cli can report several FQBN matches for one port, so
                  // options are keyed on port+fqbn to stay unique/selectable.
                  const board = boards.find(
                    (b) => `${b.port}|${b.fqbn ?? ''}` === e.target.value,
                  );
                  setSelectedBoard(board ?? null);
                }}
              >
                {boards.length === 0 && <option value="">No boards detected</option>}
                {boards.map((b) => (
                  <option
                    key={`${b.port}|${b.fqbn ?? ''}`}
                    value={`${b.port}|${b.fqbn ?? ''}`}
                  >
                    {b.name ?? 'Unknown'} — {b.port}
                  </option>
                ))}
              </select>
              <button
                className="toolbar-btn toolbar-tertiary toolbar-zoom-btn"
                onClick={refreshBoards}
                title="Rescan for connected Arduinos"
                aria-label="Refresh boards"
              >
                <svg
                  className="toolbar-icon"
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path d="M2.8 8a5.2 5.2 0 1 0 1.6-3.75" />
                  <path d="M2.3 2.6v3.4h3.4" />
                </svg>
              </button>
              {lastResult && !lastResult.success && (
                <button
                  type="button"
                  className="serial-error-msg"
                  onClick={() => setShowUploadErrorDialog(true)}
                  title="Show full compile/upload output"
                >
                  ⓘ details
                </button>
              )}
              <button
                type="button"
                className={`toolbar-btn toolbar-secondary toolbar-monitor ${showSerialMonitor ? 'active' : ''}`.trim()}
                onClick={toggleSerialMonitor}
                disabled={
                  !selectedBoard ||
                  uploadStatus === 'compiling' ||
                  uploadStatus === 'uploading'
                }
                title="View live serial output from the board"
              >
                <SearchIcon />
                <span>Monitor</span>
              </button>
            </>
          )}
        </div>

      </div>

      <div
        ref={canvasRef}
        className={`diagram-canvas ${traceMode ? 'trace-active' : ''} ${linkDraftSource ? 'linking' : ''} ${isPanning ? 'panning' : ''}`.trim()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDropNode}
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleCanvasMove}
        onMouseUp={handleCanvasMouseUp}
        onMouseLeave={handleCanvasMouseUp}
      >
        {editingPath.length > 0 && (
          <div className="diagram-breadcrumb">
            <button
              type="button"
              className="diagram-breadcrumb-segment"
              onClick={() => setEditingPath([])}
            >
              Top
            </button>
            {editingPath.map((typeId, index) => {
              const def = compoundTypes.find((c) => c.id === typeId);
              const label = def?.displayName ?? typeId;
              const isLast = index === editingPath.length - 1;
              return (
                <span key={`${typeId}-${index}`} className="diagram-breadcrumb-step">
                  <span className="diagram-breadcrumb-sep">›</span>
                  <button
                    type="button"
                    className={`diagram-breadcrumb-segment ${isLast ? 'current' : ''}`}
                    onClick={() => setEditingPath(editingPath.slice(0, index + 1))}
                    disabled={isLast}
                  >
                    {label}
                  </button>
                </span>
              );
            })}
          </div>
        )}
        {traceMode && (
          <div className="trace-banner">
            <span>Trace Mode</span> — set sensor values to see signal propagation
            <button className="trace-banner-close" onClick={() => setTraceMode(false)}>Exit</button>
          </div>
        )}
        <div
          className="diagram-world"
          style={{
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0)`,
            ['--block-scale' as string]: blockScale,
          } as CSSProperties}
        >
        <div
          className="robot-overlay robot-body"
          style={{
            left: `${robotLayout.bodyCx * zoom}px`,
            top: `${robotLayout.bodyCy * zoom}px`,
            width: `${robotLayout.bodyRadius * 2 * zoom}px`,
            height: `${robotLayout.bodyRadius * 2 * zoom}px`,
          }}
          aria-hidden="true"
        />
        <div
          className="robot-overlay robot-wheel"
          style={{
            left: `${robotLayout.leftWheelCx * zoom}px`,
            top: `${robotLayout.leftWheelCy * zoom}px`,
            width: `${robotLayout.wheelWidth * zoom}px`,
            height: `${robotLayout.wheelHeight * zoom}px`,
          }}
          aria-hidden="true"
        />
        <div
          className="robot-overlay robot-wheel"
          style={{
            left: `${robotLayout.rightWheelCx * zoom}px`,
            top: `${robotLayout.rightWheelCy * zoom}px`,
            width: `${robotLayout.wheelWidth * zoom}px`,
            height: `${robotLayout.wheelHeight * zoom}px`,
          }}
          aria-hidden="true"
        />

        <svg className="diagram-links" aria-hidden="true">
          {connectionPaths.map((connection) => {
            const edgeSignal = traceMode ? traceResult.edgeSignals[connection.id] : undefined;
            const stroke = edgeSignal !== undefined ? signalToStroke(edgeSignal) : null;
            return (
              <path
                key={connection.id}
                className={`connection-link ${selectedConnection?.id === connection.id ? 'selected' : ''}`}
                d={connection.d}
                style={stroke
                  ? { stroke: stroke.color, strokeWidth: stroke.width, opacity: stroke.opacity }
                  : { stroke: weightToColor(connection.weight) }
                }
              />
            );
          })}
          {linkDraftSource && nodeMap[linkDraftSource.id] && (() => {
            const src = nodeMap[linkDraftSource.id];
            const srcWorld = nodeWorldPos(src);
            return (
              <path
                className="draft-link"
                d={makePath(
                  srcWorld.x + portOffsetX(src, linkDraftSource.port, compoundTypes, blockScale),
                  srcWorld.y + NODE_H * blockScale,
                  linkDraftPoint.x,
                  linkDraftPoint.y,
                )}
              />
            );
          })()}
        </svg>

        {connectionPaths.map((connection) => {
          const edgeSignal = traceMode ? traceResult.edgeSignals[connection.id] : undefined;
          return (
            <button
              key={`${connection.id}-config`}
              className={`connection-config-trigger ${selectedConnection?.id === connection.id ? 'selected' : ''} ${edgeSignal !== undefined ? 'trace-signal' : ''} ${draggingBadgeId === connection.id ? 'dragging' : ''}`}
              style={{ left: `${connection.midX}px`, top: `${connection.midY}px` }}
              onMouseDown={(event) => event.stopPropagation()}
              onPointerDown={(event) => beginBadgeDrag(event, connection)}
              onClick={() => {
                // A drag just ended: swallow the trailing click so it doesn't
                // also open the config panel.
                if (badgeClickSuppressRef.current) {
                  badgeClickSuppressRef.current = false;
                  return;
                }
                setConfigTarget({ kind: 'connection', id: connection.id });
              }}
            >
              {edgeSignal !== undefined
                ? formatTraceValue(edgeSignal)
                : `w ${connection.weight.toFixed(2)}`}
            </button>
          );
        })}

        {nodes.map((node) => {
          const worldPos = nodeWorldPos(node);
          return (
            <DiagramNodeView
              key={node.id}
              node={node}
              worldX={worldPos.x}
              worldY={worldPos.y}
              isSelected={selectedNode?.id === node.id}
              isMultiSelected={selectedNodeIds.has(node.id)}
              traceMode={traceMode}
              traceResult={traceResult}
              compoundTypes={compoundTypes}
              sensorValues={sensorValues}
              pulsingId={pulsingId}
              beginNodeDrag={beginNodeDrag}
              beginLinkDrag={beginLinkDrag}
              completeLink={completeLink}
              enterCompound={enterCompound}
              pulseSensor={pulseSensor}
              lookupPortValue={lookupPortValue}
              setSelectedNodeIds={setSelectedNodeIds}
              setConfigTarget={setConfigTarget}
              setSensorValues={setSensorValues}
              setNodes={setNodes}
            />
          );
        })}
        </div>

        <ConfigPanel
          selectedNode={selectedNode}
          selectedConnection={selectedConnection}
          hasTarget={configTarget !== null}
          currentCompoundId={currentCompoundId}
          pushUndo={pushUndo}
          setNodes={setNodes}
          setConnections={setConnections}
          setCompoundTypes={setCompoundTypes}
          setTopNodes={setTopNodes}
          deleteNode={deleteNode}
          deleteConnection={deleteConnection}
          onClose={clearConfigTarget}
        />

        <div className="canvas-zoom-overlay">
          <div className="canvas-block-scale" title="Resize all blocks (double-click to reset)">
            <button
              type="button"
              className="canvas-block-scale-label"
              onClick={resetBlockScale}
              title="Reset block size to 100%"
              aria-label={`Block size ${Math.round(blockScale * 100)}%. Click to reset.`}
            >
              Blocks
            </button>
            <input
              type="range"
              className="canvas-block-scale-slider"
              min={MIN_BLOCK_SCALE}
              max={MAX_BLOCK_SCALE}
              step={BLOCK_SCALE_STEP}
              value={blockScale}
              onChange={(event) => handleBlockScaleChange(Number(event.target.value))}
              onDoubleClick={resetBlockScale}
              aria-label="Block size"
            />
            <span className="canvas-block-scale-value">{Math.round(blockScale * 100)}%</span>
          </div>
          <div className="canvas-zoom-divider" />
          <button
            type="button"
            className="toolbar-btn toolbar-tertiary toolbar-zoom-btn"
            onClick={() => zoomByStep(1 / ZOOM_STEP)}
            disabled={zoom <= MIN_ZOOM + 1e-6}
            aria-label="Zoom out"
            title="Zoom out"
          >
            <svg
              className="toolbar-icon"
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.3 10.3 l3.2 3.2" />
              <path d="M5 7 h4" />
            </svg>
          </button>
          <button
            type="button"
            className="toolbar-btn toolbar-tertiary toolbar-zoom-level"
            onClick={resetView}
            title="Reset view (100%)"
            aria-label={`Current zoom ${Math.round(zoom * 100)}%. Click to reset.`}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            className="toolbar-btn toolbar-tertiary toolbar-zoom-btn"
            onClick={() => zoomByStep(ZOOM_STEP)}
            disabled={zoom >= MAX_ZOOM - 1e-6}
            aria-label="Zoom in"
            title="Zoom in"
          >
            <svg
              className="toolbar-icon"
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.3 10.3 l3.2 3.2" />
              <path d="M5 7 h4" />
              <path d="M7 5 v4" />
            </svg>
          </button>
        </div>
      </div>

      {traceMode && (
        <Oscilloscope
          nodes={nodes}
          buffersRef={scope.buffersRef}
          timeRef={scope.timeRef}
          windowSec={5}
          paused={scope.paused}
          onTogglePause={() => scope.setPaused(!scope.paused)}
          onClear={scope.clear}
          open={scopeOpen}
          onToggleOpen={() => setScopeOpen((v) => !v)}
        />
      )}

      <CodeDialog
        open={showCodeDialog}
        onClose={() => setShowCodeDialog(false)}
        errors={codeGenErrors}
        generatedCode={generatedCode}
        onCopy={handleCopyCode}
        onDownload={handleDownloadCode}
        serialDebug={serialDebug}
        onSerialDebugChange={handleSerialDebugChange}
      />

      <UploadErrorDialog
        open={showUploadErrorDialog}
        onClose={() => setShowUploadErrorDialog(false)}
        result={lastResult}
      />

      {showSerialMonitor && selectedBoard && (
        <SerialMonitor
          port={selectedBoard.port}
          running={serialMonitor.running}
          lines={serialMonitor.lines}
          note={serialMonitor.note}
          onClear={serialMonitor.clear}
          onReconnect={() => void serialMonitor.start(selectedBoard.port)}
          onClose={closeSerialMonitor}
        />
      )}
      {toast && (
        <div className="toast" role="status">{toast}</div>
      )}
    </section>
  );
}
