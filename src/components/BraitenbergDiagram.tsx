import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, DragEvent, MouseEvent, SetStateAction } from 'react';
import type { CompoundTypeDefinition, DiagramNode, DiagramConnection, NodeTypeId, NodeTypeDefinition, OutputPortId, SensorProtocol, TransferPoint } from '../types/diagram';
import { NODE_TYPES, TYPE_BY_ID, getInputPorts, getOutputPorts, getPortLabel } from '../types/diagram';
import { validateGraph, buildGraph, generateSketch } from '../codegen';
import type { ValidationError } from '../codegen';
import { TransferCurveEditor } from './TransferCurveEditor';
import { formatTraceValue, type TraceResult } from '../hooks/useTraceSimulation';
import { useScopeSimulation } from '../hooks/useScopeSimulation';
import { Oscilloscope } from './Oscilloscope';
import { useDiagramPersistence } from '../hooks/useDiagramPersistence';
import type { useArduino } from '../hooks/useArduino';

const NODE_W = 148;
const NODE_H = 64;
const DEFAULT_CONNECTION_WEIGHT = 1;
const ANALOG_PORT_PLACEHOLDER = 'A0';
const DIGITAL_PORT_PLACEHOLDER = '2';
const MOTOR_PIN_PLACEHOLDER = '9';
const SERVO_PIN_PLACEHOLDER = '10';
const DIGITAL_OUT_PIN_PLACEHOLDER = '13';
const TM1637_CLK_PLACEHOLDER = '2';
const TM1637_DIO_PLACEHOLDER = '3';
const TM1637_DEFAULT_BRIGHTNESS = 3;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 3;
const ZOOM_STEP = 1.25;

function clampZoom(z: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}

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

function canOutput(nodeType: NodeTypeDefinition): boolean {
  // compound-output is a body-only sink — it receives values inside the
  // body but exposes nothing inside the body itself.
  if (nodeType.id === 'compound-output') return false;
  return nodeType.kind !== 'output';
}

function canInput(nodeType: NodeTypeDefinition): boolean {
  // compound-input is a body-only source — it produces values inside the
  // body but accepts nothing from the body itself.
  if (nodeType.id === 'compound-input') return false;
  return nodeType.kind !== 'sensor' && nodeType.kind !== 'constant';
}

/**
 * The small tag rendered under each palette item. Sources/computes show
 * their kind, but the Outputs group has heterogeneous hardware — servos,
 * GPIO pins, displays — so we surface what each *is* rather than the
 * common kind label.
 */
function paletteItemTag(nodeType: NodeTypeDefinition): string {
  if (nodeType.id === 'servo-cr' || nodeType.id === 'servo-positional') return 'servo';
  if (nodeType.id === 'digital-out') return 'output';
  if (nodeType.id === 'display-tm1637') return 'display';
  if (nodeType.kind === 'constant') return 'compute';
  return nodeType.kind;
}

type PaletteSection = 'sensor' | 'compute' | 'output' | 'compound';
const PALETTE_COLLAPSED_KEY = 'braitenbot-gui:palette-collapsed:v1';

function loadCollapsedPaletteSections(): Record<PaletteSection, boolean> {
  const fallback: Record<PaletteSection, boolean> = {
    sensor: false,
    compute: false,
    output: false,
    compound: false,
  };
  try {
    const raw = localStorage.getItem(PALETTE_COLLAPSED_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return fallback;
    return {
      sensor: !!parsed.sensor,
      compute: !!parsed.compute,
      output: !!parsed.output,
      compound: !!parsed.compound,
    };
  } catch {
    return fallback;
  }
}

function makePath(x1: number, y1: number, x2: number, y2: number): string {
  const c1 = y1 + 60;
  const c2 = y2 - 60;
  return `M ${x1} ${y1} C ${x1} ${c1}, ${x2} ${c2}, ${x2} ${y2}`;
}

/** Horizontal offset (px, local to the node) of the output anchor for a given port. */
function portOffsetX(
  node: DiagramNode,
  fromPort?: OutputPortId,
  compoundTypes?: CompoundTypeDefinition[],
): number {
  const ports = getOutputPorts(node.type, node, compoundTypes);
  if (!ports || ports.length === 0) return NODE_W / 2;
  const idx = fromPort ? ports.indexOf(fromPort) : -1;
  const i = idx >= 0 ? idx : 0;
  return ((i + 0.5) / ports.length) * NODE_W;
}

/** Horizontal offset (px, local to the node) of the input anchor for a given port. */
function inputPortOffsetX(
  node: DiagramNode,
  toPort?: string,
  compoundTypes?: CompoundTypeDefinition[],
): number {
  const ports = getInputPorts(node.type, node, compoundTypes);
  if (!ports || ports.length === 0) return NODE_W / 2;
  const idx = toPort ? ports.indexOf(toPort) : -1;
  const i = idx >= 0 ? idx : 0;
  return ((i + 0.5) / ports.length) * NODE_W;
}

function supportsArduinoPort(nodeType: NodeTypeDefinition): boolean {
  return nodeType.kind === 'sensor' && (nodeType.protocol === 'analog' || nodeType.protocol === 'digital');
}

function getArduinoPortPlaceholder(protocol?: SensorProtocol): string {
  return protocol === 'analog' ? ANALOG_PORT_PLACEHOLDER : DIGITAL_PORT_PLACEHOLDER;
}

function clampWeight(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

function WeightInput({ value, onChange }: { value: number; onChange: (next: number) => void }) {
  const [text, setText] = useState(() => value.toString());
  const lastCommitted = useRef(value);

  useEffect(() => {
    if (value !== lastCommitted.current) {
      setText(value.toString());
      lastCommitted.current = value;
    }
  }, [value]);

  return (
    <input
      type="number"
      min="-1"
      max="1"
      step="0.05"
      value={text}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        const parsed = Number.parseFloat(next);
        if (Number.isFinite(parsed)) {
          const clamped = clampWeight(parsed);
          lastCommitted.current = clamped;
          onChange(clamped);
        }
      }}
      onBlur={() => {
        const parsed = Number.parseFloat(text);
        if (!Number.isFinite(parsed)) {
          setText(value.toString());
        }
      }}
    />
  );
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

function isWheelNode(id: string): boolean {
  return id === 'motor-left' || id === 'motor-right';
}

function makeWheelNodes(layout: RobotOverlayLayout): DiagramNode[] {
  return [
    {
      id: 'motor-left',
      type: 'servo-cr',
      label: 'Left Wheel',
      x: layout.leftWheelCx - NODE_W / 2,
      y: layout.leftWheelCy - NODE_H / 2,
      servoPin: '',
    },
    {
      id: 'motor-right',
      type: 'servo-cr',
      label: 'Right Wheel',
      x: layout.rightWheelCx - NODE_W / 2,
      y: layout.rightWheelCy - NODE_H / 2,
      servoPin: '',
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
  } = arduino;
  // Top-level diagram state lives here; the user-visible `nodes` /
  // `connections` below are a routed view that switches to a compound
  // body when the user double-clicks into one (see `editingPath`).
  const [topNodes, setTopNodes] = useState<DiagramNode[]>(START_NODES);
  const [topConnections, setTopConnections] = useState<DiagramConnection[]>(START_CONNECTIONS);
  // Stack of compound-type ids currently being edited. Empty = at top.
  const [editingPath, setEditingPath] = useState<string[]>([]);
  // Multi-selection for group operations. Click/shift-click on nodes maintain
  // this set; the "Group selection" toolbar action consumes it.
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(() => new Set());
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [nodeDragOffset, setNodeDragOffset] = useState({ x: 0, y: 0 });
  const [linkDraftSource, setLinkDraftSource] = useState<{ id: string; port?: OutputPortId } | null>(null);
  const [linkDraftPoint, setLinkDraftPoint] = useState({ x: 0, y: 0 });
  const [robotLayout, setRobotLayout] = useState<RobotOverlayLayout>(INITIAL_ROBOT_LAYOUT);
  const [configTarget, setConfigTarget] = useState<{ kind: 'node' | 'connection'; id: string } | null>(null);
  const [loopPeriodMs, setLoopPeriodMs] = useState(20);
  const [compoundTypes, setCompoundTypes] = useState<CompoundTypeDefinition[]>([]);

  // The compound type currently being edited, if any. Body edits flow into
  // its body.nodes / body.connections instead of the top-level state.
  const currentCompoundId = editingPath.length > 0 ? editingPath[editingPath.length - 1] : null;
  const currentCompound = currentCompoundId
    ? compoundTypes.find((c) => c.id === currentCompoundId) ?? null
    : null;

  const nodes = currentCompound ? currentCompound.body.nodes : topNodes;
  const connections = currentCompound ? currentCompound.body.connections : topConnections;

  const setNodes = useCallback<Dispatch<SetStateAction<DiagramNode[]>>>(
    (action) => {
      if (currentCompoundId) {
        setCompoundTypes((prev) =>
          prev.map((c) =>
            c.id === currentCompoundId
              ? {
                  ...c,
                  body: {
                    ...c.body,
                    nodes:
                      typeof action === 'function'
                        ? (action as (p: DiagramNode[]) => DiagramNode[])(c.body.nodes)
                        : action,
                  },
                }
              : c,
          ),
        );
      } else {
        setTopNodes(action);
      }
    },
    [currentCompoundId],
  );

  const setConnections = useCallback<Dispatch<SetStateAction<DiagramConnection[]>>>(
    (action) => {
      if (currentCompoundId) {
        setCompoundTypes((prev) =>
          prev.map((c) =>
            c.id === currentCompoundId
              ? {
                  ...c,
                  body: {
                    ...c.body,
                    connections:
                      typeof action === 'function'
                        ? (action as (p: DiagramConnection[]) => DiagramConnection[])(c.body.connections)
                        : action,
                  },
                }
              : c,
          ),
        );
      } else {
        setTopConnections(action);
      }
    },
    [currentCompoundId],
  );
  const [codeGenErrors, setCodeGenErrors] = useState<ValidationError[]>([]);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [showCodeDialog, setShowCodeDialog] = useState(false);
  const codeDialogRef = useRef<HTMLDialogElement | null>(null);
  const [showUploadErrorDialog, setShowUploadErrorDialog] = useState(false);
  const uploadErrorDialogRef = useRef<HTMLDialogElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const lastAppliedLayoutRef = useRef<RobotOverlayLayout | null>(null);
  const fallbackIdCounterRef = useRef(0);
  const [traceMode, setTraceMode] = useState(false);
  const [sensorValues, setSensorValues] = useState<Record<string, number>>({});
  const [collapsedPaletteSections, setCollapsedPaletteSections] = useState<
    Record<PaletteSection, boolean>
  >(loadCollapsedPaletteSections);
  useEffect(() => {
    try {
      localStorage.setItem(
        PALETTE_COLLAPSED_KEY,
        JSON.stringify(collapsedPaletteSections),
      );
    } catch {
      /* private mode / quota — ignore */
    }
  }, [collapsedPaletteSections]);
  const undoStackRef = useRef<{ nodes: DiagramNode[]; connections: DiagramConnection[] }[]>([]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panStateRef = useRef<{ startClientX: number; startClientY: number; startPanX: number; startPanY: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  const nodeWorldPos = useCallback(
    (node: DiagramNode): { x: number; y: number } => {
      if (node.id === 'motor-left') {
        return {
          x: robotLayout.leftWheelCx * zoom - NODE_W / 2,
          y: robotLayout.leftWheelCy * zoom - NODE_H / 2,
        };
      }
      if (node.id === 'motor-right') {
        return {
          x: robotLayout.rightWheelCx * zoom - NODE_W / 2,
          y: robotLayout.rightWheelCy * zoom - NODE_H / 2,
        };
      }
      return { x: node.x * zoom, y: node.y * zoom };
    },
    [zoom, robotLayout],
  );

  const zoomAtPoint = useCallback((nextZoom: number, screenX: number, screenY: number) => {
    setZoom((prev) => {
      const clamped = clampZoom(nextZoom);
      if (clamped === prev) return prev;
      setPan((p) => {
        const worldX = (screenX - p.x) / prev;
        const worldY = (screenY - p.y) / prev;
        return { x: screenX - worldX * clamped, y: screenY - worldY * clamped };
      });
      return clamped;
    });
  }, []);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const zoomByStep = useCallback((factor: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    zoomAtPoint(zoom * factor, rect.width / 2, rect.height / 2);
  }, [zoom, zoomAtPoint]);


  const [scopeOpen, setScopeOpen] = useState(true);

  // When editing a compound body whose type is instantiated in the
  // parent diagram, we drive the body's trace from the LIVE top-level
  // simulation rather than treating the body in isolation. tracePrefix
  // is the concatenated chain of instance ids ("inst-1/inst-2/") needed
  // to map a visible body node to its flattened sim id, or null when
  // any level of editingPath has no matching instance (in which case
  // we fall back to the body's own slider-driven simulation).
  const tracePrefix = useMemo<string | null>(() => {
    if (editingPath.length === 0) return '';
    let prefix = '';
    let scopeNodes: DiagramNode[] = topNodes;
    for (const typeId of editingPath) {
      const instance = scopeNodes.find(
        (n) => n.type === 'compound' && n.compoundTypeId === typeId,
      );
      if (!instance) return null;
      prefix = prefix + instance.id + '/';
      const def = compoundTypes.find((c) => c.id === typeId);
      if (!def) return null;
      scopeNodes = def.body.nodes;
    }
    return prefix;
  }, [editingPath, topNodes, compoundTypes]);
  const useTopForTrace = tracePrefix !== null;

  const scope = useScopeSimulation(
    traceMode ? (useTopForTrace ? topNodes : nodes) : [],
    traceMode ? (useTopForTrace ? topConnections : connections) : [],
    sensorValues,
    traceMode,
    loopPeriodMs,
    compoundTypes,
  );

  // When the scope simulates the top level on behalf of a body view, the
  // raw nodeValues / edgeSignals are keyed by flattened ids. Remap them
  // back to the body's local ids so the existing display code (which
  // looks up by visible-view ids) keeps working.
  const traceResult = useMemo<TraceResult>(() => {
    if (!useTopForTrace || !tracePrefix) return scope.current;
    const nodeValues: Record<string, number> = {};
    const edgeSignals: Record<string, number> = {};
    const disconnected = new Set<string>();
    for (const node of nodes) {
      const fullId = tracePrefix + node.id;
      if (fullId in scope.current.nodeValues) {
        nodeValues[node.id] = scope.current.nodeValues[fullId];
      }
      if (scope.current.disconnected.has(fullId)) disconnected.add(node.id);
    }
    for (const conn of connections) {
      const fullId = tracePrefix + conn.id;
      if (fullId in scope.current.edgeSignals) {
        edgeSignals[conn.id] = scope.current.edgeSignals[fullId];
      }
    }
    return { nodeValues, edgeSignals, disconnected };
  }, [scope.current, useTopForTrace, tracePrefix, nodes, connections]);

  // Look up the trace value at a specific port handle on a compound
  // instance. Used to draw per-port readouts on instance nodes.
  const lookupPortValue = useCallback(
    (nodeId: string, portId: string): number | undefined => {
      const prefix = tracePrefix ?? '';
      return scope.current.nodeValues[`${prefix}${nodeId}/${portId}`];
    },
    [tracePrefix, scope.current.nodeValues],
  );
  const [pulsingId, setPulsingId] = useState<string | null>(null);
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

  const pushUndo = useCallback(() => {
    undoStackRef.current.push({ nodes: structuredClone(nodes), connections: structuredClone(connections) });
  }, [nodes, connections]);

  const undo = useCallback(() => {
    const snapshot = undoStackRef.current.pop();
    if (!snapshot) return;
    setNodes(snapshot.nodes);
    setConnections(snapshot.connections);
    setConfigTarget(null);
  }, []);

  const isDiagramPristine = useMemo(
    () =>
      connections.length === 0 &&
      nodes.length === 2 &&
      nodes.every((node) => isWheelNode(node.id)),
    [nodes, connections],
  );

  const resetToDefault = useCallback(() => {
    setTopNodes(makeWheelNodes(robotLayout));
    setTopConnections(START_CONNECTIONS);
    setLoopPeriodMs(20);
    setCompoundTypes([]);
    setEditingPath([]);
    setConfigTarget(null);
  }, [robotLayout]);

  // Persistence operates on the canonical top-level state — never on the
  // compound body currently in view — so reload/autosave round-trips
  // independent of which compound the user happens to be editing.
  useDiagramPersistence({
    state: { nodes: topNodes, connections: topConnections, loopPeriodMs, compoundTypes },
    setters: {
      setNodes: setTopNodes,
      setConnections: setTopConnections,
      setLoopPeriodMs,
      setCompoundTypes,
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
    setGeneratedCode(generateSketch(graph));
    setShowCodeDialog(true);
  }, [topNodes, topConnections, loopPeriodMs, compoundTypes]);

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
    const code = generateSketch(graph);
    setGeneratedCode(code);
    await compileAndUpload(code, selectedBoard.fqbn, selectedBoard.port);
  }, [topNodes, topConnections, loopPeriodMs, compoundTypes, selectedBoard, compileAndUpload]);

  useEffect(() => {
    const dialog = codeDialogRef.current;
    if (!dialog) return;
    if (showCodeDialog && !dialog.open) {
      dialog.showModal();
    } else if (!showCodeDialog && dialog.open) {
      dialog.close();
    }
  }, [showCodeDialog]);

  useEffect(() => {
    const dialog = uploadErrorDialogRef.current;
    if (!dialog) return;
    if (showUploadErrorDialog && !dialog.open) {
      dialog.showModal();
    } else if (!showUploadErrorDialog && dialog.open) {
      dialog.close();
    }
  }, [showUploadErrorDialog]);

  const makeId = (prefix: string): string => {
    const uuid =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `fallback-${(fallbackIdCounterRef.current++).toString(36).padStart(8, '0')}`;
    return `${prefix}-${uuid.replace(/-/g, '').slice(0, 12)}`;
  };

  const nodeMap = useMemo(
    () => Object.fromEntries(nodes.map((n) => [n.id, n])) as Record<string, DiagramNode>,
    [nodes],
  );

  const deleteNode = useCallback((nodeId: string) => {
    const node = nodeMap[nodeId];
    if (!node || isWheelNode(node.id)) return;
    pushUndo();
    setNodes((prev) => prev.filter((n) => n.id !== nodeId));
    setConnections((prev) => prev.filter((c) => c.from !== nodeId && c.to !== nodeId));
    setConfigTarget(null);
  }, [nodeMap, pushUndo]);

  const deleteConnection = useCallback((connectionId: string) => {
    pushUndo();
    setConnections((prev) => prev.filter((c) => c.id !== connectionId));
    setConfigTarget(null);
  }, [pushUndo]);

  const connectionPaths = useMemo(() => {
    return connections
      .map((connection) => {
        const from = nodeMap[connection.from];
        const to = nodeMap[connection.to];
        if (!from || !to) return null;
        const fromWorld = nodeWorldPos(from);
        const toWorld = nodeWorldPos(to);
        const x1 = fromWorld.x + portOffsetX(from, connection.fromPort, compoundTypes);
        const y1 = fromWorld.y + NODE_H;
        const x2 = toWorld.x + inputPortOffsetX(to, connection.toPort, compoundTypes);
        const y2 = toWorld.y;
        return {
          id: connection.id,
          d: makePath(x1, y1, x2, y2),
          weight: connection.weight,
          midX: (x1 + x2) / 2,
          midY: (y1 + y2) / 2,
        };
      })
      .filter((item): item is { id: string; d: string; weight: number; midX: number; midY: number } => item !== null);
  }, [connections, nodeMap, nodeWorldPos]);

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

      if (prev === null) {
        setNodes((nodes) => nodes.map(snapMotor));
        return;
      }

      const dx = layout.bodyCx - prev.bodyCx;
      const dy = layout.bodyCy - prev.bodyCy;
      if (dx === 0 && dy === 0) return;

      setNodes((nodes) =>
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
    if (configTarget.kind === 'node' && !nodeMap[configTarget.id]) {
      setConfigTarget(null);
      return;
    }
    if (configTarget.kind === 'connection' && !connections.some((connection) => connection.id === configTarget.id)) {
      setConfigTarget(null);
    }
  }, [configTarget, connections, nodeMap]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.key === 'Delete' || event.key === 'Backspace') && configTarget) {
        const target = event.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
        if (configTarget.kind === 'node') deleteNode(configTarget.id);
        if (configTarget.kind === 'connection') deleteConnection(configTarget.id);
      }
      if (event.key === 'z' && (event.metaKey || event.ctrlKey) && !event.shiftKey) {
        event.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [configTarget, deleteNode, deleteConnection, undo]);

  const beginNodeDrag = (event: MouseEvent, nodeId: string) => {
    if (event.button !== 0) return;
    if (isWheelNode(nodeId)) return;
    const target = event.currentTarget as HTMLDivElement;
    const rect = target.getBoundingClientRect();
    setDraggingNodeId(nodeId);
    setNodeDragOffset({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  };

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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const cursorX = event.clientX - rect.left;
        const cursorY = event.clientY - rect.top;
        zoomAtPoint(zoom * Math.exp(-event.deltaY * 0.0015), cursorX, cursorY);
      } else {
        event.preventDefault();
        setPan((p) => ({ x: p.x - event.deltaX, y: p.y - event.deltaY }));
      }
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [zoom, zoomAtPoint]);

  const beginLinkDrag = (event: MouseEvent, nodeId: string, port?: OutputPortId) => {
    event.stopPropagation();
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    setLinkDraftSource({ id: nodeId, port });
    setLinkDraftPoint({ x: event.clientX - rect.left - pan.x, y: event.clientY - rect.top - pan.y });
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
    const nodeTypeId = event.dataTransfer.getData('application/x-node-type') as NodeTypeId;
    if (!nodeTypeId || !(nodeTypeId in TYPE_BY_ID)) return;
    const typeDef = TYPE_BY_ID[nodeTypeId];
    // Body-only types (port anchors) only drop inside a compound body;
    // dropping one at the top level is silently ignored.
    if (typeDef.bodyOnly && editingPath.length === 0) return;
    // Compound instances need their target type id from the drag payload.
    const compoundTypeId =
      nodeTypeId === 'compound'
        ? event.dataTransfer.getData('application/x-compound-type')
        : null;
    if (nodeTypeId === 'compound' && !compoundTypeId) return;
    pushUndo();

    const rect = canvasRef.current.getBoundingClientRect();
    const screenX = event.clientX - rect.left - NODE_W / 2;
    const screenY = event.clientY - rect.top - NODE_H / 2;
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
          label: `${baseLabel} ${nodeNumber}`,
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
          dioPin: nodeType.id === 'display-tm1637' ? '' : undefined,
          brightness:
            nodeType.id === 'display-tm1637' ? TM1637_DEFAULT_BRIGHTNESS : undefined,
          compoundTypeId: compoundTypeId ?? undefined,
        },
      ];
    });
  };

  const canConnect = (fromId: string, toId: string, fromPort?: OutputPortId): boolean => {
    if (fromId === toId) return false;
    const from = nodeMap[fromId];
    const to = nodeMap[toId];
    if (!from || !to) return false;
    const fromType = TYPE_BY_ID[from.type];
    const toType = TYPE_BY_ID[to.type];
    if (!canOutput(fromType) || !canInput(toType)) return false;
    return !connections.some(
      (connection) =>
        connection.from === fromId &&
        connection.to === toId &&
        (connection.fromPort ?? undefined) === fromPort,
    );
  };

  const completeLink = (toId: string, toPort?: string) => {
    if (
      !linkDraftSource ||
      !canConnect(linkDraftSource.id, toId, linkDraftSource.port)
    ) {
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
  };

  const selectedNode = configTarget?.kind === 'node' ? nodeMap[configTarget.id] : null;
  const selectedConnection =
    configTarget?.kind === 'connection'
      ? connections.find((connection) => connection.id === configTarget.id) ?? null
      : null;

  return (
    <section className="diagram-layout">
      <aside className="node-palette">
        {(['sensor', 'compute', 'output'] as const).map((kind) => {
          const nodesOfKind = kind === 'compute'
            ? NODE_TYPES.filter((n) => n.kind === 'compute' || n.kind === 'constant')
            : NODE_TYPES.filter((n) => n.kind === kind);
          if (nodesOfKind.length === 0) return null;
          const kindLabels: Record<string, string> = {
            sensor: 'Sensors',
            compute: 'Compute',
            output: 'Outputs',
          };
          const collapsed = collapsedPaletteSections[kind];
          return (
            <div key={kind} className="palette-group">
              <h2 className={`palette-category palette-category-${kind}`}>
                <button
                  type="button"
                  className="palette-category-toggle"
                  aria-expanded={!collapsed}
                  aria-controls={`palette-group-${kind}`}
                  onClick={() =>
                    setCollapsedPaletteSections((prev) => ({ ...prev, [kind]: !prev[kind] }))
                  }
                >
                  <span
                    className={`palette-chevron ${collapsed ? 'collapsed' : ''}`}
                    aria-hidden="true"
                  >
                    ▾
                  </span>
                  <span
                    className={`palette-category-dot palette-dot-${kind}`}
                    aria-hidden="true"
                  />
                  {kindLabels[kind]}
                </button>
              </h2>
              {!collapsed && (
                <div id={`palette-group-${kind}`} className="palette-group-items">
                  {nodesOfKind.map((nodeType) => (
                    <div
                      key={nodeType.id}
                      className={`palette-item palette-item-${nodeType.kind}`}
                      draggable
                      onDragStart={(event) => event.dataTransfer.setData('application/x-node-type', nodeType.id)}
                    >
                      <span>{nodeType.displayName}</span>
                      <small>{paletteItemTag(nodeType)}</small>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {(compoundTypes.length > 0 || editingPath.length > 0) && (
        <div className="palette-group">
          <h2 className="palette-category palette-category-compound">
            <button
              type="button"
              className="palette-category-toggle"
              aria-expanded={!collapsedPaletteSections.compound}
              aria-controls="palette-group-compound"
              onClick={() =>
                setCollapsedPaletteSections((prev) => ({ ...prev, compound: !prev.compound }))
              }
            >
              <span
                className={`palette-chevron ${collapsedPaletteSections.compound ? 'collapsed' : ''}`}
                aria-hidden="true"
              >
                ▾
              </span>
              <span className="palette-category-dot palette-dot-compound" aria-hidden="true" />
              Compounds
            </button>
          </h2>
          {!collapsedPaletteSections.compound && (
          <div id="palette-group-compound" className="palette-group-items">
            {editingPath.length > 0 && (
                <>
                  <div
                    className="palette-item palette-item-port"
                    draggable
                    onDragStart={(event) =>
                      event.dataTransfer.setData('application/x-node-type', 'compound-input')
                    }
                    title="Drop inside a compound body — exposes one input port to the outer diagram."
                  >
                    <span>Compound Input</span>
                    <small>input port</small>
                  </div>
                  <div
                    className="palette-item palette-item-port"
                    draggable
                    onDragStart={(event) =>
                      event.dataTransfer.setData('application/x-node-type', 'compound-output')
                    }
                    title="Drop inside a compound body — exposes one output port to the outer diagram."
                  >
                    <span>Compound Output</span>
                    <small>output port</small>
                  </div>
                </>
              )}
              {compoundTypes.map((def) => (
                <div
                  key={def.id}
                  className="palette-item palette-item-compound"
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData('application/x-node-type', 'compound');
                    event.dataTransfer.setData('application/x-compound-type', def.id);
                  }}
                >
                  <span>{def.displayName}</span>
                  <small>compound</small>
                </div>
              ))}
          </div>
          )}
        </div>
        )}
      </aside>

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
            {selectedNodeIds.size >= 2
              ? `Group ${selectedNodeIds.size}`
              : 'Group'}
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
            Ungroup
          </button>
        </div>

        <div className="toolbar-separator" />

        <div className="toolbar-group">
          <span className="toolbar-group-label">Simulate</span>
          <button
            className={`toolbar-btn toolbar-secondary toolbar-trace ${traceMode ? 'active' : ''}`}
            onClick={() => setTraceMode((v) => !v)}
          >
            {traceMode ? 'Exit Trace' : 'Trace Signal Flow'}
          </button>
        </div>

        <div className="toolbar-separator" />

        <div className="toolbar-group">
          <span className="toolbar-group-label">Sketch</span>
          <label className="toolbar-setting" title="Delay between sensor reads in the generated Arduino loop">
            <span className="toolbar-setting-label">Loop</span>
            <input
              type="number"
              min="1"
              max="1000"
              step="1"
              value={loopPeriodMs}
              onChange={(e) => {
                const v = Number.parseInt(e.target.value, 10);
                if (Number.isFinite(v) && v >= 1) setLoopPeriodMs(Math.min(1000, v));
              }}
            />
            <span className="toolbar-setting-unit">ms</span>
          </label>
          <button
            className="toolbar-btn toolbar-primary toolbar-generate"
            onClick={handleGenerate}
          >
            Generate
          </button>
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
                value={selectedBoard?.port ?? ''}
                onChange={(e) => {
                  const board = boards.find((b) => b.port === e.target.value);
                  setSelectedBoard(board ?? null);
                }}
              >
                {boards.length === 0 && <option value="">No boards detected</option>}
                {boards.map((b) => (
                  <option key={b.port} value={b.port}>
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
              <button
                className="toolbar-btn toolbar-primary"
                onClick={handleUploadToArduino}
                disabled={
                  !selectedBoard ||
                  !selectedBoard.fqbn ||
                  uploadStatus === 'compiling' ||
                  uploadStatus === 'uploading'
                }
              >
                {uploadStatus === 'compiling'
                  ? 'Compiling…'
                  : uploadStatus === 'uploading'
                    ? 'Uploading…'
                    : uploadStatus === 'success'
                      ? 'Uploaded!'
                      : uploadStatus === 'error'
                        ? 'Upload failed'
                        : 'Upload to Arduino'}
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
          style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0)` }}
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
                  srcWorld.x + portOffsetX(src, linkDraftSource.port, compoundTypes),
                  srcWorld.y + NODE_H,
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
              className={`connection-config-trigger ${selectedConnection?.id === connection.id ? 'selected' : ''} ${edgeSignal !== undefined ? 'trace-signal' : ''}`}
              style={{ left: `${connection.midX}px`, top: `${connection.midY}px` }}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => setConfigTarget({ kind: 'connection', id: connection.id })}
            >
              {edgeSignal !== undefined
                ? formatTraceValue(edgeSignal)
                : `w ${connection.weight.toFixed(2)}`}
            </button>
          );
        })}

        {nodes.map((node) => {
          const nodeType = TYPE_BY_ID[node.type];
          const traceVal = traceMode ? traceResult.nodeValues[node.id] : undefined;
          const isDisconnected = traceMode && traceResult.disconnected.has(node.id);
          // Compound input anchors get the sensor-style slider only when
          // there's no live outer signal driving them — i.e., when the
          // user is editing a body in isolation (useTopForTrace=false).
          // When an instance exists in the parent, the trace already
          // reflects the real incoming value, so the slider would be a
          // no-op and is hidden.
          const isCompoundInput = node.type === 'compound-input';
          const hasSlider =
            traceMode &&
            (nodeType.kind === 'sensor' ||
              nodeType.kind === 'constant' ||
              (isCompoundInput && !useTopForTrace));

          let nodeMeta: string;
          if (traceVal !== undefined) {
            nodeMeta = `output: ${formatTraceValue(traceVal)}`;
          } else if (supportsArduinoPort(nodeType) && node.arduinoPort?.trim()) {
            nodeMeta = `${nodeType.metaLabel} • port ${node.arduinoPort.trim()}`;
          } else if (nodeType.mode === 'threshold' && node.threshold !== undefined) {
            nodeMeta = `${nodeType.metaLabel} • ${node.threshold}`;
          } else if (nodeType.mode === 'delay' && node.delayMs !== undefined) {
            nodeMeta = `${nodeType.metaLabel} • ${node.delayMs}ms`;
          } else if (nodeType.mode === 'oscillator' && node.frequencyHz !== undefined) {
            nodeMeta = `${nodeType.metaLabel} • ${node.frequencyHz} Hz`;
          } else if (nodeType.mode === 'noise' && node.amplitude !== undefined) {
            nodeMeta = `${nodeType.metaLabel} • ±${node.amplitude}`;
          } else if (nodeType.kind === 'constant' && node.constantValue !== undefined) {
            nodeMeta = `${nodeType.metaLabel} • ${node.constantValue}`;
          } else if (nodeType.id === 'display-tm1637' && node.clkPin?.trim() && node.dioPin?.trim()) {
            nodeMeta = `${nodeType.metaLabel} • CLK ${node.clkPin.trim()} / DIO ${node.dioPin.trim()}`;
          } else if (nodeType.kind === 'output' && nodeType.id !== 'display-tm1637' && node.servoPin?.trim()) {
            nodeMeta = `${nodeType.metaLabel} • pin ${node.servoPin.trim()}`;
          } else if (nodeType.id === 'sensor-color') {
            nodeMeta = `${nodeType.metaLabel} • RGBC outputs`;
          } else {
            nodeMeta = nodeType.metaLabel;
          }

          const worldPos = nodeWorldPos(node);
          return (
            <div
              key={node.id}
              className={[
                'diagram-node',
                `node-${nodeType.kind}`,
                selectedNode?.id === node.id ? 'selected' : '',
                selectedNodeIds.has(node.id) ? 'multi-selected' : '',
                isDisconnected ? 'trace-disconnected' : '',
                hasSlider ? 'trace-expanded' : '',
              ].filter(Boolean).join(' ')}
              style={{ left: `${worldPos.x}px`, top: `${worldPos.y}px` }}
              onMouseDown={(event) => beginNodeDrag(event, node.id)}
              onClick={(event) => {
                if (event.shiftKey) {
                  // Toggle this node in the multi-select set without
                  // disturbing the rest.
                  setSelectedNodeIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(node.id)) next.delete(node.id);
                    else next.add(node.id);
                    return next;
                  });
                } else {
                  setSelectedNodeIds(new Set([node.id]));
                }
                setConfigTarget({ kind: 'node', id: node.id });
              }}
              onDoubleClick={
                node.type === 'compound' && node.compoundTypeId
                  ? (event) => {
                      event.stopPropagation();
                      setEditingPath((prev) => [...prev, node.compoundTypeId!]);
                      setConfigTarget(null);
                    }
                  : undefined
              }
            >
              <div className="node-label">{node.label}</div>
              <div className={`node-meta ${traceVal !== undefined ? 'node-meta-trace' : ''}`}>{nodeMeta}</div>
              {hasSlider && node.type === 'sensor-digital' && (
                <div className="trace-slider-row">
                  <button
                    type="button"
                    className={`trace-digital-toggle ${
                      (sensorValues[node.id] ?? 0) >= 50 ? 'high' : 'low'
                    }`}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      const isHigh = (sensorValues[node.id] ?? 0) >= 50;
                      setSensorValues((prev) => ({
                        ...prev,
                        [node.id]: isHigh ? 0 : 100,
                      }));
                    }}
                    title="Toggle digital input (LOW / HIGH)"
                  >
                    {(sensorValues[node.id] ?? 0) >= 50 ? 'HIGH' : 'LOW'}
                  </button>
                  <button
                    type="button"
                    className={`trace-pulse-btn ${pulsingId === node.id ? 'pulsing' : ''}`}
                    title="Pulse this sensor HIGH for 200ms"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      pulseSensor(node.id);
                    }}
                  >
                    ▶
                  </button>
                </div>
              )}
              {hasSlider && node.type !== 'sensor-digital' && (() => {
                const sliderMin = nodeType.kind === 'constant' || isCompoundInput ? -100 : 0;
                const sliderValue = nodeType.kind === 'sensor'
                  ? (sensorValues[node.id] ?? 50)
                  : isCompoundInput
                    ? (sensorValues[node.id] ?? 0)
                    : (node.constantValue ?? 0);
                return (
                <div className="trace-slider-row">
                  <span className="trace-slider-label">{sliderMin}</span>
                  <input
                    type="range"
                    className="trace-slider"
                    min={sliderMin}
                    max="100"
                    step="1"
                    value={sliderValue}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (nodeType.kind === 'sensor' || isCompoundInput) {
                        setSensorValues((prev) => ({ ...prev, [node.id]: v }));
                      } else {
                        setNodes((prev) =>
                          prev.map((n) =>
                            n.id === node.id ? { ...n, constantValue: v } : n,
                          ),
                        );
                      }
                    }}
                  />
                  <span className="trace-slider-label">100</span>
                  {nodeType.kind === 'sensor' && (
                    <button
                      type="button"
                      className={`trace-pulse-btn ${pulsingId === node.id ? 'pulsing' : ''}`}
                      title="Pulse this sensor to 100 for 200ms"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        pulseSensor(node.id);
                      }}
                    >
                      ▶
                    </button>
                  )}
                </div>
                );
              })()}
              {canOutput(nodeType) && (() => {
                const ports = getOutputPorts(nodeType.id, node, compoundTypes);
                if (!ports || ports.length === 0) {
                  return (
                    <button
                      className="node-handle output-handle"
                      aria-label={`Start connection from ${node.label}`}
                      onMouseDown={(event) => beginLinkDrag(event, node.id)}
                    />
                  );
                }
                const isCompound = node.type === 'compound';
                return ports.map((port, i) => {
                  const leftPct = ((i + 0.5) / ports.length) * 100;
                  const label = isCompound ? getPortLabel(port, node, compoundTypes) : port[0].toUpperCase();
                  const portValue = isCompound && traceMode
                    ? lookupPortValue(node.id, port)
                    : undefined;
                  return (
                    <span key={port}>
                      <button
                        className={`node-handle output-handle output-handle-port output-handle-${port}`}
                        style={{ left: `${leftPct}%` }}
                        title={port}
                        aria-label={`Start ${port} connection from ${node.label}`}
                        onMouseDown={(event) => beginLinkDrag(event, node.id, port)}
                      />
                      <span
                        className={`output-port-label ${
                          isCompound ? 'output-port-label-compound' : `output-port-label-${port}`
                        }`}
                        style={{ left: `${leftPct}%` }}
                        aria-hidden="true"
                      >
                        {label}
                      </span>
                      {portValue !== undefined && (
                        <span
                          className="output-port-value"
                          style={{ left: `${leftPct}%` }}
                          aria-hidden="true"
                        >
                          {formatTraceValue(portValue)}
                        </span>
                      )}
                    </span>
                  );
                });
              })()}
              {canInput(nodeType) && (() => {
                const inputs = getInputPorts(nodeType.id, node, compoundTypes);
                if (!inputs || inputs.length === 0) {
                  return (
                    <button
                      className="node-handle input-handle"
                      aria-label={`Connect to ${node.label}`}
                      onMouseDown={(event) => event.stopPropagation()}
                      onMouseUp={() => completeLink(node.id)}
                    />
                  );
                }
                return inputs.map((port, i) => {
                  const leftPct = ((i + 0.5) / inputs.length) * 100;
                  const portValue = node.type === 'compound' && traceMode
                    ? lookupPortValue(node.id, port)
                    : undefined;
                  return (
                    <span key={port}>
                      <button
                        className="node-handle input-handle input-handle-port"
                        style={{ left: `${leftPct}%` }}
                        title={port}
                        aria-label={`Connect to ${node.label} (${port})`}
                        onMouseDown={(event) => event.stopPropagation()}
                        onMouseUp={() => completeLink(node.id, port)}
                      />
                      <span
                        className="input-port-label"
                        style={{ left: `${leftPct}%` }}
                        aria-hidden="true"
                      >
                        {getPortLabel(port, node, compoundTypes)}
                      </span>
                      {portValue !== undefined && (
                        <span
                          className="input-port-value"
                          style={{ left: `${leftPct}%` }}
                          aria-hidden="true"
                        >
                          {formatTraceValue(portValue)}
                        </span>
                      )}
                    </span>
                  );
                });
              })()}
            </div>
          );
        })}
        </div>

        <aside className="diagram-config-panel" onMouseDown={(event) => event.stopPropagation()}>
          <div className="config-header">
            <h3>Configuration</h3>
            {configTarget && (
              <button className="config-close" onClick={() => setConfigTarget(null)} aria-label="Close configuration">
                ✕
              </button>
            )}
          </div>

          {!selectedNode && !selectedConnection && (
            <p className="config-empty">Select a node or connection to configure it.</p>
          )}

          {selectedNode && (
            <div className="config-section">
              <p className="config-description">
                {TYPE_BY_ID[selectedNode.type].kind === 'sensor' &&
                  'Reads input from a physical sensor on the robot and outputs a signal to connected nodes.'}
                {TYPE_BY_ID[selectedNode.type].kind === 'compute' &&
                  TYPE_BY_ID[selectedNode.type].mode === 'threshold' &&
                  'Outputs 1 when the combined input exceeds the threshold, otherwise 0. Acts as an on/off switch.'}
                {TYPE_BY_ID[selectedNode.type].kind === 'compute' &&
                  TYPE_BY_ID[selectedNode.type].mode === 'delay' &&
                  'Delays the input signal by the configured number of milliseconds before passing it on.'}
                {TYPE_BY_ID[selectedNode.type].kind === 'compute' &&
                  TYPE_BY_ID[selectedNode.type].mode === 'summation' &&
                  'Sums all weighted input signals and outputs the total.'}
                {TYPE_BY_ID[selectedNode.type].kind === 'compute' &&
                  TYPE_BY_ID[selectedNode.type].mode === 'multiply' &&
                  'Multiplies all incoming signals together. When one input is 0 or 1, it acts as a gate: the other signal passes through when the gate is on, and zero when the gate is off.'}
                {TYPE_BY_ID[selectedNode.type].kind === 'compute' &&
                  TYPE_BY_ID[selectedNode.type].mode === 'oscillator' &&
                  'Generates a sine wave that oscillates over time. Useful as a central pattern generator for rhythmic motor behavior. Output ranges from -amplitude to +amplitude.'}
                {TYPE_BY_ID[selectedNode.type].kind === 'compute' &&
                  TYPE_BY_ID[selectedNode.type].mode === 'noise' &&
                  'Emits a fresh uniform random value every loop iteration. Useful for adding exploration or jitter to motor behavior. Output ranges from -amplitude to +amplitude.'}
                {TYPE_BY_ID[selectedNode.type].kind === 'constant' &&
                  'Emits a fixed constant value to all connected nodes.'}
                {selectedNode.type === 'servo-cr' && isWheelNode(selectedNode.id) &&
                  'Drives a wheel of the robot as a continuous-rotation servo on a single PWM pin. Speed and direction are determined by incoming connection weights; the right wheel is inverted automatically to account for mirrored mounting.'}
                {selectedNode.type === 'servo-cr' && !isWheelNode(selectedNode.id) &&
                  'Continuous-rotation servo. The input signal (-100 to 100) is mapped to signed speed via writeMicroseconds (1500 ± 500 µs).'}
                {selectedNode.type === 'servo-positional' &&
                  'Positional servo. The input signal (-100 to 100) is mapped to an angle (0° to 180°).'}
                {selectedNode.type === 'digital-out' &&
                  'Digital output pin (e.g. an LED). Drives the pin HIGH when the aggregated input exceeds the threshold, otherwise LOW. Useful for showing internal state externally.'}
                {selectedNode.type === 'display-tm1637' &&
                  'TM1637 4-digit 7-segment display. The aggregated input signal is rounded to the nearest integer, clamped to -999…9999, and shown on the display.'}
              </p>
              <label>
                Node Label
                <input
                  type="text"
                  value={selectedNode.label}
                  onChange={(event) => {
                    const newLabel = event.target.value;
                    if (selectedNode.type === 'compound' && selectedNode.compoundTypeId) {
                      const typeId = selectedNode.compoundTypeId;
                      setCompoundTypes((prev) =>
                        prev.map((c) =>
                          c.id === typeId ? { ...c, displayName: newLabel } : c,
                        ),
                      );
                      const syncInstances = (prev: DiagramNode[]) =>
                        prev.map((node) =>
                          node.type === 'compound' && node.compoundTypeId === typeId
                            ? { ...node, label: newLabel }
                            : node,
                        );
                      setNodes(syncInstances);
                      if (currentCompoundId) setTopNodes(syncInstances);
                    } else {
                      setNodes((prev) =>
                        prev.map((node) =>
                          node.id === selectedNode.id ? { ...node, label: newLabel } : node,
                        ),
                      );
                    }
                  }}
                />
              </label>

              {supportsArduinoPort(TYPE_BY_ID[selectedNode.type]) && (
                <label>
                  Arduino Port
                  <input
                    type="text"
                    value={selectedNode.arduinoPort ?? ''}
                    placeholder={getArduinoPortPlaceholder(TYPE_BY_ID[selectedNode.type].protocol)}
                    onChange={(event) =>
                      setNodes((prev) =>
                        prev.map((node) =>
                          node.id === selectedNode.id
                            ? { ...node, arduinoPort: event.target.value.trimStart() }
                            : node,
                        ),
                      )
                    }
                  />
                </label>
              )}

              {selectedNode.type === 'sensor-digital' && (
                <label className="config-checkbox">
                  <input
                    type="checkbox"
                    checked={selectedNode.pullup ?? false}
                    onChange={(event) =>
                      setNodes((prev) =>
                        prev.map((node) =>
                          node.id === selectedNode.id
                            ? { ...node, pullup: event.target.checked }
                            : node,
                        ),
                      )
                    }
                  />
                  Enable INPUT_PULLUP
                </label>
              )}

              {selectedNode.type === 'sensor-color' && (
                <p className="config-description">
                  This sensor exposes four output anchors — clear, red, green, blue.
                  Drag from the specific anchor to wire that channel.
                </p>
              )}

              {TYPE_BY_ID[selectedNode.type].mode === 'threshold' && (
                <label>
                  Threshold Value
                  <input
                    type="number"
                    min="-100"
                    max="100"
                    step="1"
                    value={selectedNode.threshold ?? 50}
                    onChange={(event) => {
                      const parsed = Number.parseFloat(event.target.value);
                      const value = Number.isFinite(parsed) ? Math.max(-100, Math.min(100, parsed)) : 50;
                      setNodes((prev) =>
                        prev.map((node) =>
                          node.id === selectedNode.id ? { ...node, threshold: value } : node,
                        ),
                      );
                    }}
                  />
                </label>
              )}

              {TYPE_BY_ID[selectedNode.type].mode === 'delay' && (
                <label>
                  Delay (ms)
                  <input
                    type="number"
                    min="0"
                    max="10000"
                    step="10"
                    value={selectedNode.delayMs ?? 100}
                    onChange={(event) => {
                      const parsed = Number.parseInt(event.target.value, 10);
                      const value = Number.isFinite(parsed) ? Math.max(0, Math.min(10000, parsed)) : 100;
                      setNodes((prev) =>
                        prev.map((node) =>
                          node.id === selectedNode.id ? { ...node, delayMs: value } : node,
                        ),
                      );
                    }}
                  />
                </label>
              )}

              {TYPE_BY_ID[selectedNode.type].mode === 'oscillator' && (
                <>
                  <label>
                    Frequency (Hz)
                    <input
                      type="number"
                      min="0"
                      max="50"
                      step="0.1"
                      value={selectedNode.frequencyHz ?? 1.0}
                      onChange={(event) => {
                        const parsed = Number.parseFloat(event.target.value);
                        const value = Number.isFinite(parsed) ? Math.max(0, Math.min(50, parsed)) : 1.0;
                        setNodes((prev) =>
                          prev.map((node) =>
                            node.id === selectedNode.id ? { ...node, frequencyHz: value } : node,
                          ),
                        );
                      }}
                    />
                  </label>
                  <label>
                    Amplitude
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={selectedNode.amplitude ?? 100}
                      onChange={(event) => {
                        const parsed = Number.parseFloat(event.target.value);
                        const value = Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 100;
                        setNodes((prev) =>
                          prev.map((node) =>
                            node.id === selectedNode.id ? { ...node, amplitude: value } : node,
                          ),
                        );
                      }}
                    />
                  </label>
                </>
              )}

              {TYPE_BY_ID[selectedNode.type].mode === 'noise' && (
                <label>
                  Amplitude
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={selectedNode.amplitude ?? 50}
                    onChange={(event) => {
                      const parsed = Number.parseFloat(event.target.value);
                      const value = Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 50;
                      setNodes((prev) =>
                        prev.map((node) =>
                          node.id === selectedNode.id ? { ...node, amplitude: value } : node,
                        ),
                      );
                    }}
                  />
                </label>
              )}

              {TYPE_BY_ID[selectedNode.type].kind === 'constant' && (
                <label>
                  Constant Value
                  <input
                    type="number"
                    min="-100"
                    max="100"
                    step="1"
                    value={selectedNode.constantValue ?? 0}
                    onChange={(event) => {
                      const parsed = Number.parseFloat(event.target.value);
                      const value = Number.isFinite(parsed) ? Math.max(-100, Math.min(100, parsed)) : 0;
                      setNodes((prev) =>
                        prev.map((node) =>
                          node.id === selectedNode.id ? { ...node, constantValue: value } : node,
                        ),
                      );
                    }}
                  />
                </label>
              )}

              {TYPE_BY_ID[selectedNode.type].kind === 'output' &&
                selectedNode.type !== 'display-tm1637' && (
                <label>
                  {selectedNode.type === 'digital-out' ? 'Pin' : 'Servo Pin'}
                  <input
                    type="text"
                    value={selectedNode.servoPin ?? ''}
                    placeholder={
                      selectedNode.type === 'digital-out'
                        ? DIGITAL_OUT_PIN_PLACEHOLDER
                        : selectedNode.type === 'servo-cr'
                          ? MOTOR_PIN_PLACEHOLDER
                          : SERVO_PIN_PLACEHOLDER
                    }
                    onChange={(event) =>
                      setNodes((prev) =>
                        prev.map((node) =>
                          node.id === selectedNode.id
                            ? { ...node, servoPin: event.target.value.trimStart() }
                            : node,
                        ),
                      )
                    }
                  />
                </label>
              )}

              {selectedNode.type === 'digital-out' && (
                <label>
                  Threshold
                  <input
                    type="number"
                    min="-100"
                    max="100"
                    step="1"
                    value={selectedNode.threshold ?? 50}
                    onChange={(event) => {
                      const parsed = Number.parseFloat(event.target.value);
                      const value = Number.isFinite(parsed) ? Math.max(-100, Math.min(100, parsed)) : 50;
                      setNodes((prev) =>
                        prev.map((node) =>
                          node.id === selectedNode.id ? { ...node, threshold: value } : node,
                        ),
                      );
                    }}
                  />
                </label>
              )}

              {selectedNode.type === 'display-tm1637' && (
                <>
                  <label>
                    CLK Pin
                    <input
                      type="text"
                      value={selectedNode.clkPin ?? ''}
                      placeholder={TM1637_CLK_PLACEHOLDER}
                      onChange={(event) =>
                        setNodes((prev) =>
                          prev.map((node) =>
                            node.id === selectedNode.id
                              ? { ...node, clkPin: event.target.value.trimStart() }
                              : node,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    DIO Pin
                    <input
                      type="text"
                      value={selectedNode.dioPin ?? ''}
                      placeholder={TM1637_DIO_PLACEHOLDER}
                      onChange={(event) =>
                        setNodes((prev) =>
                          prev.map((node) =>
                            node.id === selectedNode.id
                              ? { ...node, dioPin: event.target.value.trimStart() }
                              : node,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    Brightness (0–7)
                    <input
                      type="number"
                      min="0"
                      max="7"
                      step="1"
                      value={selectedNode.brightness ?? TM1637_DEFAULT_BRIGHTNESS}
                      onChange={(event) => {
                        const parsed = Number.parseInt(event.target.value, 10);
                        const value = Number.isFinite(parsed)
                          ? Math.max(0, Math.min(7, parsed))
                          : TM1637_DEFAULT_BRIGHTNESS;
                        setNodes((prev) =>
                          prev.map((node) =>
                            node.id === selectedNode.id ? { ...node, brightness: value } : node,
                          ),
                        );
                      }}
                    />
                  </label>
                </>
              )}
              {!isWheelNode(selectedNode.id) && (
                <button
                  className="config-delete"
                  onClick={() => deleteNode(selectedNode.id)}
                >
                  Delete Node
                </button>
              )}
            </div>
          )}

          {selectedConnection && (
            <div className="config-section">
              <label>
                Transfer Function
                <select
                  value={selectedConnection.transferMode ?? 'linear'}
                  onChange={(event) => {
                    const mode = event.target.value as 'linear' | 'nonlinear';
                    setConnections((prev) =>
                      prev.map((connection) =>
                        connection.id === selectedConnection.id
                          ? {
                              ...connection,
                              transferMode: mode,
                              transferPoints: connection.transferPoints?.length
                                ? connection.transferPoints
                                : [{ x: -100, y: -100 }, { x: 100, y: 100 }],
                            }
                          : connection,
                      ),
                    );
                  }}
                >
                  <option value="linear">Linear (weight)</option>
                  <option value="nonlinear">Non-linear (curve)</option>
                </select>
              </label>

              {(selectedConnection.transferMode ?? 'linear') === 'linear' && (
                <>
                  <label>
                    Connection Weight
                    <input
                      type="range"
                      min="-1"
                      max="1"
                      step="0.05"
                      value={selectedConnection.weight}
                      onChange={(event) => {
                        const value = clampWeight(parseFloat(event.target.value));
                        setConnections((prev) =>
                          prev.map((connection) =>
                            connection.id === selectedConnection.id ? { ...connection, weight: value } : connection,
                          ),
                        );
                      }}
                    />
                  </label>
                  <label>
                    Numeric Weight
                    <WeightInput
                      value={selectedConnection.weight}
                      onChange={(value) =>
                        setConnections((prev) =>
                          prev.map((connection) =>
                            connection.id === selectedConnection.id ? { ...connection, weight: value } : connection,
                          ),
                        )
                      }
                    />
                  </label>
                </>
              )}

              {selectedConnection.transferMode === 'nonlinear' && (
                <TransferCurveEditor
                  points={selectedConnection.transferPoints ?? [{ x: -100, y: -100 }, { x: 100, y: 100 }]}
                  onChange={(pts: TransferPoint[]) =>
                    setConnections((prev) =>
                      prev.map((connection) =>
                        connection.id === selectedConnection.id
                          ? { ...connection, transferPoints: pts }
                          : connection,
                      ),
                    )
                  }
                />
              )}

              <button
                className="config-delete"
                onClick={() => deleteConnection(selectedConnection.id)}
              >
                Delete Connection
              </button>
            </div>
          )}
        </aside>

        <div className="canvas-zoom-overlay">
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

      <dialog
        ref={codeDialogRef}
        className="code-dialog"
        onClose={() => setShowCodeDialog(false)}
        onClick={(e) => {
          if (e.target === codeDialogRef.current) setShowCodeDialog(false);
        }}
      >
        <div className="code-dialog-inner">
        <div className="code-dialog-header">
          <h2>Generated Arduino Code</h2>
          <button type="button" className="config-close" onClick={() => setShowCodeDialog(false)} aria-label="Close">
            ✕
          </button>
        </div>

        {codeGenErrors.length > 0 && (
          <ul className="code-errors">
            {codeGenErrors.map((err, i) => (
              <li key={i} className={`code-error-${err.severity}`}>
                {err.message}
              </li>
            ))}
          </ul>
        )}

        {generatedCode && (
          <>
            <pre className="code-preview"><code>{generatedCode}</code></pre>
            <div className="code-dialog-actions">
              <button onClick={handleCopyCode}>Copy to Clipboard</button>
              <button onClick={handleDownloadCode}>Download .ino</button>
            </div>
          </>
        )}

        {!generatedCode && codeGenErrors.some((e) => e.severity === 'error') && (
          <p className="code-error-hint">Fix the errors above before generating code.</p>
        )}
        </div>
      </dialog>

      <dialog
        ref={uploadErrorDialogRef}
        className="code-dialog"
        onClose={() => setShowUploadErrorDialog(false)}
        onClick={(e) => {
          if (e.target === uploadErrorDialogRef.current) setShowUploadErrorDialog(false);
        }}
      >
        <div className="code-dialog-inner">
          <div className="code-dialog-header">
            <h2>Upload failed</h2>
            <button
              type="button"
              className="config-close"
              onClick={() => setShowUploadErrorDialog(false)}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          {lastResult?.compileOutput && (
            <>
              <h3 className="upload-error-section">Compile output</h3>
              <pre className="code-preview"><code>{lastResult.compileOutput}</code></pre>
            </>
          )}
          {lastResult?.uploadOutput && (
            <>
              <h3 className="upload-error-section">Upload output</h3>
              <pre className="code-preview"><code>{lastResult.uploadOutput}</code></pre>
            </>
          )}
          {!lastResult?.compileOutput && !lastResult?.uploadOutput && (
            <p>No output captured.</p>
          )}
        </div>
      </dialog>
    </section>
  );
}
