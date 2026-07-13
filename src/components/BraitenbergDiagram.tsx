import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, MouseEvent } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { DiagramNode, DiagramConnection, OutputPortId } from '../types/diagram';
import { TYPE_BY_ID, DEFAULT_TOF_MAX_MM, DEFAULT_COMMENT_WIDTH, DEFAULT_COMMENT_HEIGHT } from '../types/diagram';
import { validateGraph, buildGraph, generateSketch } from '../codegen';
import type { ValidationError } from '../codegen';
import { NodePalette, NODE_DRAG_MIME } from './NodePalette';
import type { NodeDragPayload } from './NodePalette';
import { useScopeSimulation } from '../hooks/useScopeSimulation';
import { Oscilloscope } from './Oscilloscope';
import { useDiagramPersistence } from '../hooks/useDiagramPersistence';
import { useViewport, MIN_ZOOM, MAX_ZOOM, ZOOM_STEP } from '../hooks/useViewport';
import { useCompoundEditing } from '../hooks/useCompoundEditing';
import { useDiagramSnapshot, useDiagramStore, useTraceSnapshot } from '../doc/useDiagramStore';
import type { DiagramState } from '../lib/diagramFile';
import { ConfigPanel } from './ConfigPanel';
import { CodeDialog, DiagnosticsDialog, UploadErrorDialog } from './dialogs';
import { SettingsModal } from './SettingsModal';
import type { AppSettings, UpdateAppSettings } from '../settings/appSettings';
import { SerialMonitor } from './SerialMonitor';
import { ShareMenu, SessionOverlays } from './ShareMenu';
import { useSession, usePresence } from '../collab/useSession';
import { sessionManager } from '../collab/SessionManager';
import { isWheelNode, supportsArduinoPort } from './diagramShared';
import type { ConfigTarget } from './diagramShared';
import type { useArduino } from '../hooks/useArduino';
import { useSerialMonitor } from '../hooks/useSerialMonitor';
import {
  ChevronDownIcon,
  CommentIcon,
  GroupIcon,
  SearchIcon,
  SettingsIcon,
  UngroupIcon,
  WaypointsIcon,
} from './icons';
import type { PrimaryAction } from '../lib/primaryAction';
import { loadPrimaryAction, savePrimaryAction } from '../lib/primaryAction';
import { NODE_H, NODE_W } from './connectionGeometry';
import { wheelArrowGeometry } from './wheelArrow';
import { DiagramCanvas } from './DiagramCanvas';
import { CommentView } from './CommentView';
import './diagram.css';

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
  /** Personal, per-device preferences (lifted to App so useArduino can read
   *  the board auto-swap setting). Diagram-level prefs live in the doc store. */
  appSettings: AppSettings;
  updateAppSettings: UpdateAppSettings;
}

export function BraitenbergDiagram({
  arduino,
  appSettings,
  updateAppSettings,
}: BraitenbergDiagramProps) {
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
    uploadProgress,
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
  const {
    topNodes,
    topConnections,
    compoundTypes,
    loopPeriodMs,
    capWeights,
    pulseDurationMs,
    comments,
  } = useDiagramSnapshot(store);
  // Multi-selection for group operations. Click/shift-click on nodes maintain
  // this set; the "Group selection" toolbar action consumes it.
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(() => new Set());
  // True while a link is being drafted from an output handle, for the canvas's
  // `.linking` cursor styling. The draft state itself lives inside DiagramCanvas.
  const [isLinking, setIsLinking] = useState(false);
  const [robotLayout, setRobotLayout] = useState<RobotOverlayLayout>(INITIAL_ROBOT_LAYOUT);
  const [configTarget, setConfigTarget] = useState<ConfigTarget | null>(null);
  // Per-node right-click context menu (Duplicate / Disconnect / Delete),
  // anchored at the click point in viewport (client) coordinates.
  const [nodeMenu, setNodeMenu] = useState<{ id: string; x: number; y: number } | null>(null);

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
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  // Live validation issues, so View → Check can show current problems without
  // running codegen.
  const diagnostics = useMemo(
    () => validateGraph(topNodes, topConnections, compoundTypes),
    [topNodes, topConnections, compoundTypes],
  );
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
  // Duration of the "▶" sensor pulse in trace mode. A diagram-level preference
  // (lives in the shared doc, `pulseDurationMs` from the snapshot above), so a
  // shared/opened diagram carries the author's chosen timing. The duration is
  // still baked into each shared pulse event as durationTicks, so peers render
  // an identical pulse regardless.
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
      const durationTicks = Math.max(1, Math.round(pulseDurationMs / Math.max(1, loopPeriodMs)));
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
      }, pulseDurationMs);
      // Writer-side pruning. A peer whose trace view attaches after this
      // window misses the pulse entirely (accepted, like tick drift).
      window.setTimeout(() => store.removeTracePulse(eventId), pulseDurationMs + 600);
    },
    [currentTick, store, loopPeriodMs, pulseDurationMs],
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
      capWeights: true,
      pulseDurationMs: 200,
      compoundTypes: [],
      comments: [],
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
      capWeights: snap.capWeights,
      pulseDurationMs: snap.pulseDurationMs,
      compoundTypes: snap.compoundTypes,
      comments: snap.comments,
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
    state: {
      nodes: topNodes,
      connections: topConnections,
      loopPeriodMs,
      capWeights,
      pulseDurationMs,
      compoundTypes,
      comments,
    },
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

  useEffect(() => {
    if (!tauriAvailable) return;
    let unlisten: (() => void) | undefined;
    listen('menu://view-home', () => {
      breakFollow();
      resetView();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [tauriAvailable, breakFollow, resetView]);

  useEffect(() => {
    if (!tauriAvailable) return;
    let unlisten: (() => void) | undefined;
    listen('menu://view-check', () => {
      setShowDiagnostics(true);
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

  // Drop a fresh comment box at the center of the current viewport. Comments
  // are top-level only, so the toolbar button is disabled while a compound
  // body is open.
  const handleAddComment = useCallback(() => {
    if (isViewOnly) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    const screenCx = rect ? rect.width / 2 : 320;
    const screenCy = rect ? rect.height / 2 : 220;
    const x = (screenCx - pan.x) / zoom - DEFAULT_COMMENT_WIDTH / 2;
    const y = (screenCy - pan.y) / zoom - DEFAULT_COMMENT_HEIGHT / 2;
    store.stopCapturing();
    store.addComment({
      id: makeId('comment'),
      x,
      y,
      width: DEFAULT_COMMENT_WIDTH,
      height: DEFAULT_COMMENT_HEIGHT,
      text: '',
    });
  }, [store, pan, zoom, isViewOnly, makeId]);

  // Add an input/output port anchor to the compound body currently open. Ports
  // are body-only, so this is offered only from the breadcrumb while editing a
  // compound (see below). New ports stack down one side of the viewport center.
  const addPort = useCallback(
    (type: 'compound-input' | 'compound-output') => {
      if (isViewOnly || editingPath.length === 0) return;
      const rect = canvasRef.current?.getBoundingClientRect();
      const screenCx = rect ? rect.width / 2 : 320;
      const screenCy = rect ? rect.height / 2 : 220;
      const sideOffset = type === 'compound-input' ? -180 : 180;
      const count = nodes.filter((node) => node.type === type).length;
      const x = (screenCx - pan.x) / zoom - (NODE_W / 2) * blockScale + sideOffset;
      const y =
        (screenCy - pan.y) / zoom -
        (NODE_H / 2) * blockScale +
        count * (NODE_H * blockScale + 16);
      store.stopCapturing();
      store.addNode({
        id: makeId(type),
        type,
        label: type === 'compound-input' ? `Input ${count + 1}` : `Output ${count + 1}`,
        x,
        y,
      });
    },
    [store, pan, zoom, blockScale, nodes, isViewOnly, editingPath.length, makeId],
  );

  const nodeMap = useMemo(
    () => Object.fromEntries(nodes.map((n) => [n.id, n])) as Record<string, DiagramNode>,
    [nodes],
  );

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

  // Rename a node from its inline label editor. One undo entry per rename.
  const renameNode = useCallback(
    (id: string, label: string) => {
      if (isViewOnly) return;
      store.stopCapturing();
      store.patchNode(id, { label });
    },
    [store, isViewOnly],
  );

  // Duplicate a node in place, offset slightly so the copy is visible, and
  // select it. Wheel motors are fixtures and can't be duplicated.
  const duplicateNode = useCallback(
    (id: string) => {
      const node = nodeMap[id];
      if (!node || isWheelNode(node.id) || isViewOnly) return;
      const newId = makeId(node.type);
      store.stopCapturing();
      store.addNode({ ...node, id: newId, x: node.x + 28, y: node.y + 28 });
      setSelectedNodeIds(new Set([newId]));
      setConfigTarget({ kind: 'node', id: newId });
    },
    [nodeMap, store, makeId, isViewOnly],
  );

  // Remove every connection touching a node (keeps the node). One undo entry.
  const disconnectNode = useCallback(
    (id: string) => {
      if (isViewOnly) return;
      store.stopCapturing();
      store.disconnectNode(id);
    },
    [store, isViewOnly],
  );

  const openNodeMenu = useCallback(
    (id: string, clientX: number, clientY: number) => {
      if (isViewOnly) return;
      setNodeMenu({ id, x: clientX, y: clientY });
    },
    [isViewOnly],
  );

  // Stable context-menu action handlers. Hoisted out of the menu's JSX so the
  // render doesn't call a ref-reading helper (duplicateNode → makeId) inline.
  const menuDuplicate = useCallback(() => {
    if (nodeMenu) duplicateNode(nodeMenu.id);
    setNodeMenu(null);
  }, [nodeMenu, duplicateNode]);
  const menuDisconnect = useCallback(() => {
    if (nodeMenu) disconnectNode(nodeMenu.id);
    setNodeMenu(null);
  }, [nodeMenu, disconnectNode]);
  const menuDelete = useCallback(() => {
    if (nodeMenu) deleteNode(nodeMenu.id);
    setNodeMenu(null);
  }, [nodeMenu, deleteNode]);

  // Frame every node of the current editing context in the viewport. Node
  // boxes are a fixed px size (only zoom spacing changes), so we fit the span
  // of node positions plus one node box of margin, capped at 100% so a small
  // diagram isn't blown up.
  const fitToContent = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || nodes.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const w = NODE_W * blockScale;
    const h = NODE_H * blockScale;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x);
      maxY = Math.max(maxY, node.y);
    }
    const padding = 100;
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const availW = Math.max(1, rect.width - padding * 2 - w);
    const availH = Math.max(1, rect.height - padding * 2 - h);
    const nextZoom = Math.max(
      MIN_ZOOM,
      Math.min(
        MAX_ZOOM,
        1,
        spanX > 0 ? availW / spanX : MAX_ZOOM,
        spanY > 0 ? availH / spanY : MAX_ZOOM,
      ),
    );
    const panX = (rect.width - w) / 2 - ((minX + maxX) / 2) * nextZoom;
    const panY = (rect.height - h) / 2 - ((minY + maxY) / 2) * nextZoom;
    breakFollow();
    applyViewport({ x: panX, y: panY }, nextZoom);
  }, [nodes, blockScale, breakFollow, applyViewport]);

  // Close the node context menu on any outside interaction. Presses inside the
  // menu stop propagation, so this only fires for the dismissing gesture.
  useEffect(() => {
    if (!nodeMenu) return;
    const close = () => setNodeMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNodeMenu(null);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('wheel', close, { passive: true });
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('wheel', close);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [nodeMenu]);

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
      // Reset view: Cmd/Ctrl+0 (mirrors View → Go to Main View).
      if (mod && key === '0') {
        if (isBlocked()) return;
        event.preventDefault();
        breakFollow();
        resetView();
      }
      // Select every node in the current editing context.
      if (mod && key === 'a') {
        if (isBlocked()) return;
        event.preventDefault();
        setSelectedNodeIds(new Set(nodes.map((node) => node.id)));
      }
      // Escape: drop the multi-selection and close the config panel.
      if (event.key === 'Escape') {
        if (isBlocked()) return;
        setSelectedNodeIds(new Set());
        setConfigTarget(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [configTarget, deleteNode, deleteConnection, undo, redo, traceMode, isViewOnly, sensorValues, nodeMap, nodes, store, breakFollow, resetView]);

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

  // Coordinate resolvers handed to DiagramCanvas so its interaction math works
  // under the app's pan/zoom. `clientToWorld` yields unscaled node coords (for
  // moveNode); `clientToLayer` yields render (world-div) px (link-draft endpoint
  // and badge projection), matching the space nodeWorldPos renders into.
  const clientToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      const left = rect?.left ?? 0;
      const top = rect?.top ?? 0;
      return { x: (clientX - left - pan.x) / zoom, y: (clientY - top - pan.y) / zoom };
    },
    [pan, zoom],
  );
  const clientToLayer = useCallback(
    (clientX: number, clientY: number) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      const left = rect?.left ?? 0;
      const top = rect?.top ?? 0;
      return { x: clientX - left - pan.x, y: clientY - top - pan.y };
    },
    [pan],
  );

  // The canvas owns node/link/badge dragging; the app only supplies the
  // mutations and the collab presence side-effects. Node drags collapse to a
  // single undo entry: the canvas fires onNodeDragStart on the first movement,
  // where we open a fresh undo item.
  const handleNodeDragStart = useCallback(() => {
    store.stopCapturing();
  }, [store]);
  const handleNodeMove = useCallback(
    (id: string, x: number, y: number) => store.moveNode(id, x, y),
    [store],
  );
  const handleNodeDragEnd = useCallback(() => {
    if (inSession) sessionManager.setPresenceDragging(null);
  }, [inSession]);
  const handleConnectionCreate = useCallback(
    (edge: { from: string; fromPort?: OutputPortId; to: string; toPort?: string }) => {
      store.stopCapturing();
      store.addConnection({
        id: makeId('link'),
        from: edge.from,
        ...(edge.fromPort ? { fromPort: edge.fromPort } : {}),
        to: edge.to,
        ...(edge.toPort ? { toPort: edge.toPort } : {}),
        weight: DEFAULT_CONNECTION_WEIGHT,
        transferMode: 'linear',
        transferPoints: [{ x: -100, y: -100 }, { x: 100, y: 100 }],
      });
    },
    [store, makeId],
  );
  const handleConnectionRejected = useCallback(
    ({ toId }: { toId: string }) => {
      const to = nodeMap[toId];
      if (!to) return;
      const toType = TYPE_BY_ID[to.type];
      if (toType.maxInputs !== undefined) {
        const existing = connections.filter((c) => c.to === toId).length;
        if (existing >= toType.maxInputs) {
          showToast(`${toType.displayName} only accepts ${toType.maxInputs} incoming connection${toType.maxInputs === 1 ? '' : 's'}. Use a Summation node to combine signals.`);
        }
      }
    },
    [nodeMap, connections, showToast],
  );
  const handleConnectionLabelT = useCallback(
    (id: string, labelT: number) => store.setConnectionLabelT(id, labelT),
    [store],
  );
  // Presence: publish the drag field from the canvas's drag moves, on its own
  // ~30Hz throttle (the cursor is still published by handleCanvasMove below,
  // which also fires during a drag since the pointer is over the canvas).
  const lastDragPresenceRef = useRef(0);
  const handlePointerWorldMove = useCallback(
    (world: { x: number; y: number }, draggingNodeId: string | null) => {
      if (!inSession || !draggingNodeId) return;
      const nowT = performance.now();
      if (nowT - lastDragPresenceRef.current < 33) return;
      lastDragPresenceRef.current = nowT;
      sessionManager.setPresenceDragging({ nodeId: draggingNodeId, x: world.x, y: world.y });
    },
    [inSession],
  );

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

    // Publish the hover cursor, throttled to ~30Hz. World coords match node.x/y
    // so the remote-cursor layer positions consistently. Drag presence is
    // published by handlePointerWorldMove from the canvas's own drag moves.
    if (inSession) {
      const nowT = performance.now();
      if (nowT - lastPresenceMoveRef.current >= 33) {
        lastPresenceMoveRef.current = nowT;
        sessionManager.setPresenceCursor({ x: (pointerX - pan.x) / zoom, y: (pointerY - pan.y) / zoom });
      }
    }
  };

  const handleCanvasMouseUp = () => {
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

  const selectedNode = configTarget?.kind === 'node' ? nodeMap[configTarget.id] : null;
  const selectedConnection =
    configTarget?.kind === 'connection'
      ? connections.find((connection) => connection.id === configTarget.id) ?? null
      : null;

  // Split-button derived state. Upload requires the desktop shell, a working
  // arduino-cli, and a selected board; generate-only is always available (it
  // never touches hardware — matching the old always-on Generate button).
  const uploadBusy = uploadStatus === 'compiling' || uploadStatus === 'uploading';
  // Only trust a reported percent when it belongs to the phase we're showing;
  // otherwise the bar runs indeterminate.
  const uploadPercent =
    uploadProgress &&
    ((uploadStatus === 'compiling' && uploadProgress.phase === 'compile') ||
      (uploadStatus === 'uploading' && uploadProgress.phase === 'upload'))
      ? uploadProgress.percent
      : null;
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
          <span className="toolbar-group-label">Annotate</span>
          <button
            type="button"
            className="toolbar-btn toolbar-secondary"
            onClick={handleAddComment}
            disabled={isViewOnly || editingPath.length > 0}
            title={
              editingPath.length > 0
                ? 'Comments can only be added on the top-level diagram.'
                : 'Add a gray explanatory note to the canvas.'
            }
          >
            <CommentIcon />
            <span>Comment</span>
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
              <select
                className="toolbar-board-select"
                data-status={canUpload ? 'connected' : 'disconnected'}
                title={cliVersion ?? undefined}
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

        <button
          type="button"
          className="toolbar-btn toolbar-secondary toolbar-settings"
          onClick={() => setShowSettings(true)}
          title="Settings"
          aria-label="Settings"
        >
          <SettingsIcon />
        </button>
      </div>

      {uploadBusy && (
        <div className="upload-progress" role="status" aria-live="polite">
          <span className="upload-progress-label">
            {uploadStatus === 'compiling' ? 'Compiling' : 'Uploading'}
            {uploadPercent != null ? ` ${Math.round(uploadPercent)}%` : '…'}
          </span>
          {uploadPercent != null ? (
            <progress className="upload-progress-bar" max={100} value={uploadPercent} />
          ) : (
            <div className="upload-progress-bar is-indeterminate">
              <div className="upload-progress-fill" />
            </div>
          )}
        </div>
      )}

      <div
        ref={canvasRef}
        className={`bb-diagram diagram-canvas ${traceMode ? 'trace-active' : ''} ${isLinking ? 'linking' : ''} ${isPanning ? 'panning' : ''}`.trim()}
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
            {!isViewOnly && (
              <div className="diagram-breadcrumb-ports">
                <button
                  type="button"
                  className="diagram-breadcrumb-port-btn"
                  onClick={() => addPort('compound-input')}
                  title="Add an input port to this compound — signals flow in from the outer diagram."
                >
                  + Input
                </button>
                <button
                  type="button"
                  className="diagram-breadcrumb-port-btn"
                  onClick={() => addPort('compound-output')}
                  title="Add an output port to this compound — its value is exposed to the outer diagram."
                >
                  + Output
                </button>
              </div>
            )}
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

        {/* Per-wheel drive indicator: in trace mode an arrow grows straight out
            of each motor block — up from the block's top edge for a positive
            (forward) signal, down from the bottom edge for a negative (reverse)
            one, scaled by magnitude. Drawn clear of the block so its label stays
            readable. Purely a readout of the motor's trace value — real motion
            still needs the robot. */}
        {traceMode &&
          ([
            ['motor-left', robotLayout.leftWheelCx, robotLayout.leftWheelCy] as const,
            ['motor-right', robotLayout.rightWheelCx, robotLayout.rightWheelCy] as const,
          ]).map(([motorId, wheelCx, wheelCy]) => {
            const raw = traceResult.nodeValues[motorId];
            if (raw === undefined) return null;
            // Geometry is anchored to the block (scaled node box), not the
            // background wheel, so the arrow always leaves from the block edge.
            const g = wheelArrowGeometry(raw, blockScale);
            if (!g) return null;
            return (
              <svg
                key={`${motorId}-drive`}
                className={`wheel-drive-arrow ${g.forward ? 'forward' : 'reverse'}`}
                style={{
                  left: `${wheelCx * zoom - g.svgHalfW}px`,
                  top: `${wheelCy * zoom - g.reach}px`,
                  width: `${g.svgHalfW * 2}px`,
                  height: `${g.reach * 2}px`,
                }}
                aria-hidden="true"
              >
                <line x1={g.cx} y1={g.base} x2={g.cx} y2={g.shaftEndY} strokeWidth={g.strokeW} />
                <polygon
                  points={`${g.cx},${g.tipY} ${g.cx - g.headHalf},${g.shaftEndY} ${g.cx + g.headHalf},${g.shaftEndY}`}
                />
              </svg>
            );
          })}

        {/* Comments render before the canvas so they sit behind the links and
            nodes. Top-level only — hidden while a compound body is open. */}
        {editingPath.length === 0 &&
          comments.map((comment) => (
            <CommentView
              key={comment.id}
              comment={comment}
              zoom={zoom}
              readOnly={isViewOnly}
              onMove={(id, x, y) => store.moveComment(id, x, y)}
              onResize={(id, width, height) => store.patchComment(id, { width, height })}
              onChangeText={(id, text) => store.patchComment(id, { text })}
              onDelete={(id) => store.removeComment(id)}
              onInteractStart={() => store.stopCapturing()}
            />
          ))}

        <DiagramCanvas
          nodes={nodes}
          connections={connections}
          compoundTypes={compoundTypes}
          blockScale={blockScale}
          nodeWorldPos={nodeWorldPos}
          clientToWorld={clientToWorld}
          clientToLayer={clientToLayer}
          traceMode={traceMode}
          traceResult={traceMode ? traceResult : undefined}
          sensorValues={sensorValues}
          setSensorValue={setSensorValue}
          setConstantValue={setConstantValue}
          pulseSensor={pulseSensor}
          pulsingId={pulsingId}
          pulseDurationMs={pulseDurationMs}
          readOnly={isViewOnly}
          selectedNodeIds={selectedNodeIds}
          setSelectedNodeIds={setSelectedNodeIds}
          configTarget={configTarget}
          setConfigTarget={setConfigTarget}
          onNodeMove={handleNodeMove}
          onNodeDragStart={handleNodeDragStart}
          onNodeDragEnd={handleNodeDragEnd}
          onConnectionCreate={handleConnectionCreate}
          onConnectionRejected={handleConnectionRejected}
          onConnectionLabelT={handleConnectionLabelT}
          onEnterCompound={enterCompound}
          onRenameNode={isViewOnly ? undefined : renameNode}
          onNodeContextMenu={isViewOnly ? undefined : openNodeMenu}
          onLinkDraftChange={setIsLinking}
          remoteHighlight={remoteHighlight}
          onPointerWorldMove={handlePointerWorldMove}
        />
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
          capWeights={capWeights}
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
            onClick={fitToContent}
            disabled={nodes.length === 0}
            aria-label="Fit all blocks in view"
            title="Fit all blocks in view"
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
              <path d="M6 2 H2 V6" />
              <path d="M10 2 H14 V6" />
              <path d="M6 14 H2 V10" />
              <path d="M10 14 H14 V10" />
            </svg>
          </button>
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

      <DiagnosticsDialog
        open={showDiagnostics}
        onClose={() => setShowDiagnostics(false)}
        issues={diagnostics}
      />

      <SettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
        settings={appSettings}
        onChange={updateAppSettings}
        capWeights={capWeights}
        onCapWeightsChange={(value) => store.setCapWeights(value)}
        loopPeriodMs={loopPeriodMs}
        onLoopPeriodChange={(value) => store.setLoopPeriodMs(value)}
        pulseDurationMs={pulseDurationMs}
        onPulseDurationChange={(value) => store.setPulseDurationMs(value)}
        diagramReadOnly={isViewOnly}
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
          onSend={(text) => void serialMonitor.send(text)}
        />
      )}
      {nodeMenu && (() => {
        const menuNode = nodeMap[nodeMenu.id];
        if (!menuNode) return null;
        const isWheel = isWheelNode(menuNode.id);
        return (
          <div
            className="node-context-menu"
            role="menu"
            style={{ left: `${nodeMenu.x}px`, top: `${nodeMenu.y}px` }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              className="node-context-menu-item"
              disabled={isWheel}
              title={isWheel ? 'The wheel motors are fixtures and cannot be duplicated.' : undefined}
              onClick={menuDuplicate}
            >
              Duplicate
            </button>
            <button
              type="button"
              role="menuitem"
              className="node-context-menu-item"
              onClick={menuDisconnect}
            >
              Disconnect
            </button>
            <button
              type="button"
              role="menuitem"
              className="node-context-menu-item danger"
              disabled={isWheel}
              title={isWheel ? 'The wheel motors are fixtures and cannot be deleted.' : undefined}
              onClick={menuDelete}
            >
              Delete
            </button>
          </div>
        );
      })()}
      <SessionOverlays />
      {toast && (
        <div className="toast" role="status">{toast}</div>
      )}
    </section>
  );
}
