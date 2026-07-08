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
import { useCompoundEditing } from '../hooks/useCompoundEditing';
import { useDiagramSnapshot, useDiagramStore, useTraceSnapshot } from '../doc/useDiagramStore';
import type { DiagramState } from '../lib/diagramFile';
import { DiagramNodeView } from './DiagramNodeView';
import { ConfigPanel } from './ConfigPanel';
import { CodeDialog, UploadErrorDialog } from './dialogs';
import { SettingsModal } from './SettingsModal';
import { useAppSettings } from '../settings/appSettings';
import { SerialMonitor } from './SerialMonitor';
import { ShareMenu, SessionOverlays } from './ShareMenu';
import { useSession, usePresence } from '../collab/useSession';
import { sessionManager } from '../collab/SessionManager';
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
    driverIssue,
    driverInstallStatus,
    driverError,
    installDrivers,
  } = arduino;
  // The whole diagram document (nodes, connections, compoundTypes,
  // loopPeriodMs) lives in a Yjs-backed store. React reads a referentially
  // stable snapshot; every mutation goes through the store's methods.
  const store = useDiagramStore();
  const { topNodes, topConnections, compoundTypes, loopPeriodMs } = useDiagramSnapshot(store);
  // Multi-selection for group operations. Click/shift-click on nodes maintain
  // this set; the "Group selection" toolbar action consumes it.
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(() => new Set());
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [nodeDragOffset, setNodeDragOffset] = useState({ x: 0, y: 0 });
  const [linkDraftSource, setLinkDraftSource] = useState<{ id: string; port?: OutputPortId } | null>(null);
  const [linkDraftPoint, setLinkDraftPoint] = useState({ x: 0, y: 0 });
  const [robotLayout, setRobotLayout] = useState<RobotOverlayLayout>(INITIAL_ROBOT_LAYOUT);
  const [configTarget, setConfigTarget] = useState<ConfigTarget | null>(null);

  const {
    editingPath,
    setEditingPath,
    currentCompoundId,
    nodes,
    connections,
    enterCompound,
  } = useCompoundEditing({
    store,
    topNodes,
    topConnections,
    compoundTypes,
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
  const [appSettings, updateAppSettings] = useAppSettings();
  const [showSettings, setShowSettings] = useState(false);
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
  // Trace mode + sensor inputs live in the shared `trace` Y.Map (backed by the
  // doc even solo). In a session, entering/exiting trace and moving a slider
  // syncs to every participant; solo, behavior is unchanged (untracked writes,
  // never autosaved/exported).
  const trace = useTraceSnapshot(store);
  const traceMode = trace.enabled;
  const sensorValues = trace.inputs;
  const setSensorValue = useCallback(
    (key: string, value: number) => store.setTraceInput(key, value),
    [store],
  );
  // True once a live node drag has already captured its single undo snapshot,
  // so a whole drag collapses to one entry (reset at each drag start).
  const didPushDragUndoRef = useRef(false);
  // Follow-the-host: a guest's viewport tracks the host's published viewport;
  // any manual pan/zoom breaks the follow (wired below via onUserGesture and
  // the manual-gesture handlers).
  const [followingHost, setFollowingHost] = useState(false);
  const breakFollow = useCallback(() => setFollowingHost(false), []);
  const { zoom, pan, setPan, resetView, zoomByStep, applyViewport } = useViewport(
    canvasRef,
    breakFollow,
  );
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
  // Throttle presence cursor/drag publishing to ~30Hz.
  const lastPresenceMoveRef = useRef(0);

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
    // Shared seed so every participant produces an identical trace.
    { seed: trace.seed },
  );

  const traceResult = scope.traceResult;

  const [pulsingId, setPulsingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number>(0);
  const showToast = useCallback((msg: string) => {
    window.clearTimeout(toastTimerRef.current);
    setToast(msg);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3000);
  }, []);
  // Pulse writes a shared event into the trace map; every client (including
  // this one) applies it once via the pulse-apply effect below, so the
  // initiator never double-applies. The writer prunes the event once expired.
  // Depend on scope.currentTick (a stable callback) rather than the scope
  // object, which is rebuilt every render — keeping pulseSensor's identity
  // stable so it doesn't bust the memoized DiagramNodeView on trace updates.
  const currentTick = scope.currentTick;
  const pulseSensor = useCallback(
    (sensorId: string) => {
      const eventId = `pulse-${
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
          : `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
      }`;
      const durationTicks = Math.max(1, Math.round(200 / Math.max(1, loopPeriodMs)));
      store.addTracePulse({
        id: eventId,
        sensorId,
        value: 100,
        startTick: currentTick(),
        durationTicks,
      });
      setPulsingId(sensorId);
      window.setTimeout(() => {
        setPulsingId((prev) => (prev === sensorId ? null : prev));
      }, 200);
      // Writer-side pruning. A peer whose trace view attaches after this
      // window misses the pulse entirely (accepted, like tick drift).
      window.setTimeout(() => store.removeTracePulse(eventId), 200 + 600);
    },
    [currentTick, store, loopPeriodMs],
  );

  // Apply shared pulse events: each client fires every not-yet-seen event once
  // through the tick-based pulse mechanism (relative to its own clock — see the
  // documented tick-drift limitation). Forget ids once they leave the map.
  const appliedPulsesRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!traceMode) {
      appliedPulsesRef.current.clear();
      return;
    }
    const present = new Set<string>();
    for (const p of trace.pulses) {
      present.add(p.id);
      if (appliedPulsesRef.current.has(p.id)) continue;
      appliedPulsesRef.current.add(p.id);
      scope.pulse(p.sensorId, p.value, p.durationTicks * loopPeriodMs);
    }
    for (const id of [...appliedPulsesRef.current]) {
      if (!present.has(id)) appliedPulsesRef.current.delete(id);
    }
  }, [trace.pulses, traceMode, scope, loopPeriodMs]);

  const clearConfigTarget = useCallback(() => setConfigTarget(null), []);
  // Undo/redo delegate to the store's Y.UndoManager. Clearing the config
  // target mirrors the previous snapshot-restore behavior (a restored edit may
  // no longer target the same node/connection).
  const undo = useCallback(() => {
    store.undo();
    setConfigTarget(null);
  }, [store]);
  const redo = useCallback(() => {
    store.redo();
    setConfigTarget(null);
  }, [store]);

  const isDiagramPristine = useMemo(
    () =>
      connections.length === 0 &&
      nodes.length === 2 &&
      nodes.every((node) => isWheelNode(node.id)),
    [nodes, connections],
  );

  // Full-replacement helper shared by New/Open/restore. replaceAll also clears
  // the undo history, so undoing back into a discarded diagram is impossible.
  const applyDiagram = useCallback(
    (next: DiagramState) => {
      store.replaceAll(next);
      setEditingPath([]);
      setConfigTarget(null);
    },
    [store, setEditingPath],
  );

  const resetToDefault = useCallback(() => {
    applyDiagram({
      nodes: makeWheelNodes(robotLayout),
      connections: START_CONNECTIONS,
      loopPeriodMs: 20,
      compoundTypes: [],
    });
  }, [robotLayout, applyDiagram]);

  // Collaborative session state. While in a session, guests autosave to a
  // separate localStorage slot (the personal slot is sacred); the host keeps
  // autosaving to their own slot — the host is the copy of record.
  const session = useSession();
  const sessionRole =
    session.status === 'hosting' || session.status === 'joined' || session.status === 'reconnecting'
      ? session.isHost
        ? ('host' as const)
        : ('guest' as const)
      : null;
  const inSession = sessionRole !== null;
  // View-only guests can't mutate the document or trace inputs. The store
  // enforces this at the choke-point; the UI also disables the controls so it
  // doesn't feel broken. The host is never view-only.
  const isViewOnly = inSession && session.role === 'view' && !session.isHost;

  // Remote presence: peers in the SAME editing context (top level vs. the same
  // compound body) get their selection/drag outlines and cursors rendered.
  const peers = usePresence();
  const visiblePeers = useMemo(
    () => peers.filter((p) => (p.editingContext ?? null) === (currentCompoundId ?? null)),
    [peers, currentCompoundId],
  );
  // node/connection id -> the color+name of a peer selecting or dragging it.
  const remoteHighlight = useMemo(() => {
    const map = new Map<string, { color: string; name: string }>();
    for (const p of visiblePeers) {
      for (const id of p.selection) if (!map.has(id)) map.set(id, { color: p.color, name: p.name });
      if (p.dragging) map.set(p.dragging.nodeId, { color: p.color, name: p.name });
    }
    return map;
  }, [visiblePeers]);

  // Follow-the-host: the host publishes its viewport; a following guest tracks
  // it. Break follow if we're no longer a guest.
  const hostViewport = useMemo(
    () => peers.find((p) => p.isHost)?.viewport ?? null,
    [peers],
  );
  const canFollowHost = sessionRole === 'guest' && hostViewport !== null;
  useEffect(() => {
    // Leaving the guest role (host, or session ended) cancels any active follow.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (sessionRole !== 'guest') setFollowingHost(false);
  }, [sessionRole]);
  useEffect(() => {
    if (!followingHost || !hostViewport) return;
    applyViewport(hostViewport.pan, hostViewport.zoom);
  }, [followingHost, hostViewport, applyViewport]);
  const toggleFollowHost = useCallback(() => setFollowingHost((v) => !v), []);

  // Publish our presence into awareness (no-ops when not in a session).
  useEffect(() => {
    const selection = [...selectedNodeIds];
    if (configTarget?.kind === 'connection') selection.push(configTarget.id);
    sessionManager.setPresenceSelection(selection);
  }, [selectedNodeIds, configTarget]);
  useEffect(() => {
    sessionManager.setPresenceEditingContext(currentCompoundId);
  }, [currentCompoundId]);
  // Only the host publishes its viewport (the thing guests can follow).
  useEffect(() => {
    if (sessionRole === 'host') sessionManager.setPresenceViewport({ pan, zoom });
  }, [sessionRole, pan, zoom]);

  // Reset per-user editing UI when a session swaps the backing doc in (the
  // compound you were inside no longer exists on the shared doc).
  const prevSessionStatusRef = useRef(session.status);
  useEffect(() => {
    const prev = prevSessionStatusRef.current;
    prevSessionStatusRef.current = session.status;
    const enteredSession =
      (session.status === 'hosting' || session.status === 'joined') &&
      prev !== 'hosting' &&
      prev !== 'joined' &&
      prev !== 'reconnecting';
    if (enteredSession) {
      setEditingPath([]);
      setConfigTarget(null);
      store.clearUndoHistory();
    }
  }, [session.status, setEditingPath, store]);

  // Current canonical state / fresh-doc replacement, for the Share menu.
  const getCurrentState = useCallback((): DiagramState => {
    const snap = store.getSnapshot();
    return {
      nodes: snap.topNodes,
      connections: snap.topConnections,
      loopPeriodMs: snap.loopPeriodMs,
      compoundTypes: snap.compoundTypes,
    };
  }, [store]);

  const applyDiagramFresh = useCallback(
    (next: DiagramState) => {
      store.resetDoc(next);
      setEditingPath([]);
      setConfigTarget(null);
    },
    [store, setEditingPath],
  );

  // Persistence operates on the canonical top-level state — never on the
  // compound body currently in view — so reload/autosave round-trips
  // independent of which compound the user happens to be editing.
  useDiagramPersistence({
    state: { nodes: topNodes, connections: topConnections, loopPeriodMs, compoundTypes },
    applyDiagram,
    isPristine: isDiagramPristine,
    resetToDefault,
    sessionRole,
  });

  // Group the currently-selected nodes into a new compound. Boundary-
  // crossing edges become port anchors; weights and transfers on those
  // edges stay on the *outer* edge so a user looking at the new compound
  // instance sees the same wiring they had before grouping.
  //
  // Wheel motors and other top-level-only types can't move into a body,
  // so they're filtered out of the selection silently before grouping.
  const handleGroupSelection = useCallback(() => {
    // Grouping (geometry, port synthesis, boundary rewiring) lives in the
    // store as a single transaction so it undoes/redoes as one step.
    store.stopCapturing();
    const result = store.group(selectedNodeIds);
    if (!result) return;
    setSelectedNodeIds(new Set([result.instanceId]));
    setConfigTarget({ kind: 'node', id: result.instanceId });
  }, [store, selectedNodeIds]);

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
    // Inlining (id remapping, position translation, edge rewiring) lives in
    // the store as one transaction so it undoes/redoes as a single step.
    store.stopCapturing();
    store.ungroup(ungroupCandidate.node.id);
    setSelectedNodeIds(new Set());
    setConfigTarget(null);
  }, [ungroupCandidate, store]);

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

  useEffect(() => {
    if (!tauriAvailable) return;
    let unlisten: (() => void) | undefined;
    listen('menu://settings', () => {
      setShowSettings(true);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [tauriAvailable]);

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
    store.stopCapturing();
    store.removeNodeWithConnections(nodeId);
    setConfigTarget(null);
  }, [nodeMap, store]);

  const deleteConnection = useCallback((connectionId: string) => {
    store.stopCapturing();
    store.removeConnection(connectionId);
    setConfigTarget(null);
  }, [store]);

  // Stable identity so the memoized DiagramNodeView isn't re-rendered by a
  // fresh inline lambda on every parent render.
  const setConstantValue = useCallback(
    (id: string, value: number) => store.setConstantValue(id, value),
    [store],
  );

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

      // On the first pass, snap the motors only. On later resizes, snap the
      // motors and translate every other top-level node by the body delta. The
      // store method always targets the top level (never an open compound body)
      // via an untracked transaction, matching the old no-undo behavior.
      const dx = prev === null ? 0 : layout.bodyCx - prev.bodyCx;
      const dy = prev === null ? 0 : layout.bodyCy - prev.bodyCy;
      if (prev !== null && dx === 0 && dy === 0) return;

      store.applyMotorLayout({
        leftX: layout.leftWheelCx - NODE_W / 2,
        leftY: layout.leftWheelCy - NODE_H / 2,
        rightX: layout.rightWheelCx - NODE_W / 2,
        rightY: layout.rightWheelCy - NODE_H / 2,
        dx,
        dy,
      });
    };

    const updateLayout = () => {
      const rect = canvas.getBoundingClientRect();
      applyLayout(calculateRobotOverlay(rect.width, rect.height));
    };

    updateLayout();
    const observer = new ResizeObserver(updateLayout);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [store]);

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
      if (arrowDelta !== 0 && !mod && traceMode && !isViewOnly && configTarget?.kind === 'node') {
        if (isBlocked()) return;
        const node = nodeMap[configTarget.id];
        if (!node) return;
        const nodeType = TYPE_BY_ID[node.type];
        const step = arrowDelta * (event.shiftKey ? 10 : 1);
        if (node.type === 'sensor-digital') {
          event.preventDefault();
          store.setTraceInput(node.id, arrowDelta > 0 ? 100 : 0);
        } else if (nodeType.kind === 'sensor' && node.type !== 'sensor-color') {
          event.preventDefault();
          store.setTraceInput(node.id, Math.max(0, Math.min(100, (sensorValues[node.id] ?? 50) + step)));
        } else if (node.type === 'compound-input') {
          event.preventDefault();
          store.setTraceInput(node.id, Math.max(-100, Math.min(100, (sensorValues[node.id] ?? 0) + step)));
        } else if (nodeType.kind === 'constant') {
          event.preventDefault();
          store.setConstantValue(
            node.id,
            Math.max(-100, Math.min(100, (node.constantValue ?? 0) + step)),
          );
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
  }, [configTarget, deleteNode, deleteConnection, undo, redo, traceMode, isViewOnly, sensorValues, nodeMap, store]);

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
    // Manually grabbing the canvas breaks follow-the-host.
    breakFollow();
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
      store.setConnectionLabelT(conn.id, t);
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
      // Start a fresh undo item on the first move of the drag, so the whole
      // drag (many moveNode transactions, merged via captureTimeout) collapses
      // to one undo entry that returns the node to where the drag began.
      if (!didPushDragUndoRef.current) {
        store.stopCapturing();
        didPushDragUndoRef.current = true;
      }
      const screenLeft = pointerX - nodeDragOffset.x;
      const screenTop = pointerY - nodeDragOffset.y;
      const worldX = (screenLeft - pan.x) / zoom;
      const worldY = (screenTop - pan.y) / zoom;
      store.moveNode(draggingNodeId, worldX, worldY);
    }

    if (linkDraftSource) {
      setLinkDraftPoint({ x: pointerX - pan.x, y: pointerY - pan.y });
    }

    // Publish cursor (and drag) presence, throttled to ~30Hz. World coords match
    // node.x/y so the remote-cursor layer positions consistently.
    if (inSession) {
      const nowT = performance.now();
      if (nowT - lastPresenceMoveRef.current >= 33) {
        lastPresenceMoveRef.current = nowT;
        const worldX = (pointerX - pan.x) / zoom;
        const worldY = (pointerY - pan.y) / zoom;
        sessionManager.setPresenceCursor({ x: worldX, y: worldY });
        if (draggingNodeId) {
          sessionManager.setPresenceDragging({ nodeId: draggingNodeId, x: worldX, y: worldY });
        }
      }
    }
  };

  const handleCanvasMouseUp = () => {
    if (draggingNodeId) sessionManager.setPresenceDragging(null);
    setDraggingNodeId(null);
    setLinkDraftSource(null);
    if (panStateRef.current) {
      panStateRef.current = null;
      setIsPanning(false);
    }
  };

  const handleCanvasMouseLeave = () => {
    handleCanvasMouseUp();
    // Don't leave a frozen remote cursor parked at the canvas edge.
    if (inSession) sessionManager.setPresenceCursor(null);
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
    store.stopCapturing();

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
    const nodeType = TYPE_BY_ID[nodeTypeId];
    // Number the new node within its current editing context (matches the
    // routed `nodes` view the drop lands in).
    const nodeNumber = nodes.filter((node) => node.type === nodeTypeId).length + 1;
    store.addNode({
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
    store.stopCapturing();
    const { id: fromId, port: fromPort } = linkDraftSource;
    store.addConnection({
      id: makeId('link'),
      from: fromId,
      ...(fromPort ? { fromPort } : {}),
      to: toId,
      ...(toPort ? { toPort } : {}),
      weight: DEFAULT_CONNECTION_WEIGHT,
      transferMode: 'linear',
      transferPoints: [{ x: -100, y: -100 }, { x: 100, y: 100 }],
    });
    setLinkDraftSource(null);
  }, [canConnect, showToast, store, makeId]);

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
            onClick={() => store.setTraceEnabled(!traceMode)}
            disabled={isViewOnly}
            title={isViewOnly ? 'View-only: the host controls trace mode.' : undefined}
          >
            <WaypointsIcon />
            <span>{traceMode ? 'Exit Trace' : 'Trace Signal Flow'}</span>
          </button>
          {isViewOnly && <span className="view-only-chip" title="You have view-only access">View only</span>}
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
              onChange={(value) => store.setLoopPeriodMs(value)}
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
              {driverIssue && (
                <button
                  type="button"
                  className="driver-warning"
                  onClick={() => void installDrivers()}
                  disabled={driverInstallStatus === 'installing'}
                  title={
                    driverError ??
                    `Windows sees "${driverIssue.deviceName}" but its USB driver is not installed (device error ${driverIssue.errorCode}). Click to run the Arduino driver installer, then accept the administrator prompt.`
                  }
                >
                  {driverInstallStatus === 'installing'
                    ? 'Installing driver…'
                    : driverInstallStatus === 'error'
                      ? '⚠ Driver install failed — retry'
                      : '⚠ USB driver missing — install'}
                </button>
              )}
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

        <div className="toolbar-separator" />

        <ShareMenu
          getCurrentState={getCurrentState}
          applyDiagramFresh={applyDiagramFresh}
          isPristine={isDiagramPristine}
          showToast={showToast}
          canFollowHost={canFollowHost}
          followingHost={followingHost}
          onToggleFollowHost={toggleFollowHost}
        />
      </div>

      <div
        ref={canvasRef}
        className={`diagram-canvas ${traceMode ? 'trace-active' : ''} ${linkDraftSource ? 'linking' : ''} ${isPanning ? 'panning' : ''}`.trim()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDropNode}
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleCanvasMove}
        onMouseUp={handleCanvasMouseUp}
        onMouseLeave={handleCanvasMouseLeave}
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
            <button
              className="trace-banner-close"
              onClick={() => store.setTraceEnabled(false)}
              disabled={isViewOnly}
            >
              Exit
            </button>
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
            const remote = remoteHighlight.get(connection.id);
            return (
              <g key={connection.id}>
                {remote && (
                  <path
                    className="connection-remote-select"
                    d={connection.d}
                    style={{ stroke: remote.color }}
                  />
                )}
                <path
                  className={`connection-link ${selectedConnection?.id === connection.id ? 'selected' : ''}`}
                  d={connection.d}
                  style={stroke
                    ? { stroke: stroke.color, strokeWidth: stroke.width, opacity: stroke.opacity }
                    : { stroke: weightToColor(connection.weight) }
                  }
                />
              </g>
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
          const remote = remoteHighlight.get(node.id);
          // Per-node primitive trace props. traceResult is a fresh object on
          // every simulation update, so extracting each node's displayed
          // values here — already formatted to display precision — lets the
          // memoized DiagramNodeView bail out unless something it actually
          // renders changed (sub-display-precision jitter included).
          const nodeType = TYPE_BY_ID[node.type];
          const isCompound = node.type === 'compound';
          const rawTraceValue = traceMode ? traceResult.nodeValues[node.id] : undefined;
          // Compound instances publish per-port values keyed `${id}/${port}`;
          // multi-output sources (color sensor) use `${id}:${port}`. Encode
          // them as one comma-joined string ('' slot = no value) so the memo
          // comparison stays a primitive.
          const outputPorts = traceMode && canOutput(nodeType)
            ? getOutputPorts(nodeType.id, node, compoundTypes)
            : undefined;
          const outputPortValues = outputPorts && outputPorts.length > 0
            ? outputPorts
                .map((port) => {
                  const v = traceResult.nodeValues[
                    isCompound ? `${node.id}/${port}` : `${node.id}:${port}`
                  ];
                  return v === undefined ? '' : formatTraceValue(v);
                })
                .join(',')
            : undefined;
          const inputPorts = traceMode && isCompound
            ? getInputPorts(nodeType.id, node, compoundTypes)
            : undefined;
          const inputPortValues = inputPorts && inputPorts.length > 0
            ? inputPorts
                .map((port) => {
                  const v = traceResult.nodeValues[`${node.id}/${port}`];
                  return v === undefined ? '' : formatTraceValue(v);
                })
                .join(',')
            : undefined;
          const colorSensorValues = traceMode && node.type === 'sensor-color'
            ? getOutputPorts('sensor-color')!
                .map((ch) => sensorValues[`${node.id}:${ch}`] ?? 0)
                .join(',')
            : undefined;
          return (
            <DiagramNodeView
              key={node.id}
              node={node}
              worldX={worldPos.x}
              worldY={worldPos.y}
              isSelected={selectedNode?.id === node.id}
              isMultiSelected={selectedNodeIds.has(node.id)}
              traceMode={traceMode}
              traceValue={rawTraceValue !== undefined ? formatTraceValue(rawTraceValue) : undefined}
              isDisconnected={traceMode && traceResult.disconnected.has(node.id)}
              outputPortValues={outputPortValues}
              inputPortValues={inputPortValues}
              compoundTypes={compoundTypes}
              sensorValue={sensorValues[node.id]}
              colorSensorValues={colorSensorValues}
              isPulsing={pulsingId === node.id}
              beginNodeDrag={beginNodeDrag}
              beginLinkDrag={beginLinkDrag}
              completeLink={completeLink}
              enterCompound={enterCompound}
              pulseSensor={pulseSensor}
              setSelectedNodeIds={setSelectedNodeIds}
              setConfigTarget={setConfigTarget}
              setSensorValue={setSensorValue}
              setConstantValue={setConstantValue}
              readOnly={isViewOnly}
              remoteColor={remote?.color}
              remoteLabel={remote?.name}
            />
          );
        })}
        {visiblePeers.map((peer) =>
          peer.cursor ? (
            <div
              key={`cursor-${peer.clientId}`}
              className="remote-cursor"
              style={{ left: `${peer.cursor.x * zoom}px`, top: `${peer.cursor.y * zoom}px`, color: peer.color }}
              aria-hidden="true"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <path d="M1 1 L1 11 L4 8 L6.5 13 L8.5 12 L6 7 L10 7 Z" stroke="rgba(0,0,0,0.4)" strokeWidth="0.5" />
              </svg>
              <span className="remote-cursor-label" style={{ background: peer.color }}>{peer.name}</span>
            </div>
          ) : null,
        )}
        </div>

        <ConfigPanel
          selectedNode={selectedNode}
          selectedConnection={selectedConnection}
          hasTarget={configTarget !== null}
          store={store}
          deleteNode={deleteNode}
          deleteConnection={deleteConnection}
          onClose={clearConfigTarget}
          capWeights={appSettings.capWeights}
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
            onClick={() => { breakFollow(); zoomByStep(1 / ZOOM_STEP); }}
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
            onClick={() => { breakFollow(); resetView(); }}
            title="Reset view (100%)"
            aria-label={`Current zoom ${Math.round(zoom * 100)}%. Click to reset.`}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            className="toolbar-btn toolbar-tertiary toolbar-zoom-btn"
            onClick={() => { breakFollow(); zoomByStep(ZOOM_STEP); }}
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

      <SettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
        settings={appSettings}
        onChange={updateAppSettings}
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
      <SessionOverlays />
      {toast && (
        <div className="toast" role="status">{toast}</div>
      )}
    </section>
  );
}
