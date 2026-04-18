import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent } from 'react';
import type { DiagramNode, DiagramConnection, NodeTypeId, NodeTypeDefinition, SensorProtocol, TransferPoint } from '../types/diagram';
import { NODE_TYPES, TYPE_BY_ID, getOutputPorts } from '../types/diagram';
import { validateGraph, buildGraph, generateSketch } from '../codegen';
import type { ValidationError } from '../codegen';
import { TransferCurveEditor } from './TransferCurveEditor';
import { useTraceSimulation, formatTraceValue } from '../hooks/useTraceSimulation';
import { useDiagramPersistence } from '../hooks/useDiagramPersistence';
import type { useArduino } from '../hooks/useArduino';

const NODE_W = 148;
const NODE_H = 64;
const DEFAULT_CONNECTION_WEIGHT = 1;
const ANALOG_PORT_PLACEHOLDER = 'A0';
const DIGITAL_PORT_PLACEHOLDER = '2';
const MOTOR_PIN_PLACEHOLDER = '9';
const SERVO_PIN_PLACEHOLDER = '10';

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
  return nodeType.kind !== 'motor';
}

function canInput(nodeType: NodeTypeDefinition): boolean {
  return nodeType.kind !== 'sensor' && nodeType.kind !== 'constant';
}

function makePath(x1: number, y1: number, x2: number, y2: number): string {
  const c1 = y1 + 60;
  const c2 = y2 - 60;
  return `M ${x1} ${y1} C ${x1} ${c1}, ${x2} ${c2}, ${x2} ${y2}`;
}

/** Horizontal offset (px, local to the node) of the output anchor for a given port. */
function portOffsetX(typeId: NodeTypeId, fromPort?: string): number {
  const ports = getOutputPorts(typeId);
  if (!ports) return NODE_W / 2;
  const idx = fromPort ? ports.indexOf(fromPort as (typeof ports)[number]) : -1;
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

function makeMotorNodes(layout: RobotOverlayLayout): DiagramNode[] {
  return [
    {
      id: 'motor-left',
      type: 'motor',
      label: 'Left Motor',
      x: layout.leftWheelCx - NODE_W / 2,
      y: layout.leftWheelCy - NODE_H / 2,
      motorPin: '',
    },
    {
      id: 'motor-right',
      type: 'motor',
      label: 'Right Motor',
      x: layout.rightWheelCx - NODE_W / 2,
      y: layout.rightWheelCy - NODE_H / 2,
      motorPin: '',
    },
  ];
}

const START_NODES: DiagramNode[] = makeMotorNodes(INITIAL_ROBOT_LAYOUT);

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
  const [nodes, setNodes] = useState<DiagramNode[]>(START_NODES);
  const [connections, setConnections] = useState<DiagramConnection[]>(START_CONNECTIONS);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [nodeDragOffset, setNodeDragOffset] = useState({ x: 0, y: 0 });
  const [linkDraftSource, setLinkDraftSource] = useState<{ id: string; port?: string } | null>(null);
  const [linkDraftPoint, setLinkDraftPoint] = useState({ x: 0, y: 0 });
  const [robotLayout, setRobotLayout] = useState<RobotOverlayLayout>(INITIAL_ROBOT_LAYOUT);
  const [configTarget, setConfigTarget] = useState<{ kind: 'node' | 'connection'; id: string } | null>(null);
  const [loopPeriodMs, setLoopPeriodMs] = useState(20);
  const [codeGenErrors, setCodeGenErrors] = useState<ValidationError[]>([]);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [showCodeDialog, setShowCodeDialog] = useState(false);
  const codeDialogRef = useRef<HTMLDialogElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const lastAppliedLayoutRef = useRef<RobotOverlayLayout | null>(null);
  const fallbackIdCounterRef = useRef(0);
  const [traceMode, setTraceMode] = useState(false);
  const [sensorValues, setSensorValues] = useState<Record<string, number>>({});
  const undoStackRef = useRef<{ nodes: DiagramNode[]; connections: DiagramConnection[] }[]>([]);
  const [resetArmed, setResetArmed] = useState(false);
  const resetArmTimerRef = useRef<number | null>(null);
  const resetButtonRef = useRef<HTMLButtonElement | null>(null);


  const traceResult = useTraceSimulation(
    traceMode ? nodes : [],
    traceMode ? connections : [],
    sensorValues,
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
      nodes.every((node) => TYPE_BY_ID[node.type]?.kind === 'motor'),
    [nodes, connections],
  );

  const resetToDefault = useCallback(() => {
    setNodes(makeMotorNodes(robotLayout));
    setConnections(START_CONNECTIONS);
    setLoopPeriodMs(20);
    setConfigTarget(null);
  }, [robotLayout]);

  useDiagramPersistence({
    state: { nodes, connections, loopPeriodMs },
    setters: { setNodes, setConnections, setLoopPeriodMs },
    isPristine: isDiagramPristine,
    resetToDefault,
  });

  const clearResetArmTimer = useCallback(() => {
    if (resetArmTimerRef.current !== null) {
      window.clearTimeout(resetArmTimerRef.current);
      resetArmTimerRef.current = null;
    }
  }, []);

  const disarmReset = useCallback(() => {
    clearResetArmTimer();
    setResetArmed(false);
  }, [clearResetArmTimer]);

  useEffect(() => () => clearResetArmTimer(), [clearResetArmTimer]);

  useEffect(() => {
    if (isDiagramPristine && resetArmed) disarmReset();
  }, [isDiagramPristine, resetArmed, disarmReset]);

  const handleResetClick = useCallback(() => {
    if (isDiagramPristine) return;
    if (!resetArmed) {
      setResetArmed(true);
      clearResetArmTimer();
      resetArmTimerRef.current = window.setTimeout(() => setResetArmed(false), 3500);
      return;
    }
    clearResetArmTimer();
    pushUndo();
    setNodes(makeMotorNodes(robotLayout));
    setConnections(START_CONNECTIONS);
    setConfigTarget(null);
    setResetArmed(false);
    resetButtonRef.current?.blur();
  }, [isDiagramPristine, resetArmed, clearResetArmTimer, pushUndo, robotLayout]);

  const handleResetKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'Escape' && resetArmed) {
        event.preventDefault();
        disarmReset();
      }
    },
    [resetArmed, disarmReset],
  );

  const handleGenerate = useCallback(() => {
    const errors = validateGraph(nodes, connections);
    setCodeGenErrors(errors);
    const hasErrors = errors.some((e) => e.severity === 'error');
    if (hasErrors) {
      setGeneratedCode(null);
      setShowCodeDialog(true);
      return;
    }
    const graph = buildGraph(nodes, connections, loopPeriodMs);
    setGeneratedCode(generateSketch(graph));
    setShowCodeDialog(true);
  }, [nodes, connections, loopPeriodMs]);

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
    const errors = validateGraph(nodes, connections);
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
    const graph = buildGraph(nodes, connections, loopPeriodMs);
    const code = generateSketch(graph);
    setGeneratedCode(code);
    await compileAndUpload(code, selectedBoard.fqbn, selectedBoard.port);
  }, [nodes, connections, loopPeriodMs, selectedBoard, compileAndUpload]);

  useEffect(() => {
    const dialog = codeDialogRef.current;
    if (!dialog) return;
    if (showCodeDialog && !dialog.open) {
      dialog.showModal();
    } else if (!showCodeDialog && dialog.open) {
      dialog.close();
    }
  }, [showCodeDialog]);

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
    if (!node || node.type === 'motor') return;
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
        const x1 = from.x + portOffsetX(from.type, connection.fromPort);
        const y1 = from.y + NODE_H;
        const x2 = to.x + NODE_W / 2;
        const y2 = to.y;
        return {
          id: connection.id,
          d: makePath(x1, y1, x2, y2),
          weight: connection.weight,
          midX: (x1 + x2) / 2,
          midY: (y1 + y2) / 2,
        };
      })
      .filter((item): item is { id: string; d: string; weight: number; midX: number; midY: number } => item !== null);
  }, [connections, nodeMap]);

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
    const target = event.currentTarget as HTMLDivElement;
    const rect = target.getBoundingClientRect();
    setDraggingNodeId(nodeId);
    setNodeDragOffset({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  };

  const beginLinkDrag = (event: MouseEvent, nodeId: string, port?: string) => {
    event.stopPropagation();
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    setLinkDraftSource({ id: nodeId, port });
    setLinkDraftPoint({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  };

  const handleCanvasMove = (event: MouseEvent) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;

    if (draggingNodeId) {
      setNodes((prev) =>
        prev.map((node) =>
          node.id === draggingNodeId
            ? { ...node, x: pointerX - nodeDragOffset.x, y: pointerY - nodeDragOffset.y }
            : node,
        ),
      );
    }

    if (linkDraftSource) {
      setLinkDraftPoint({ x: pointerX, y: pointerY });
    }
  };

  const handleCanvasMouseUp = () => {
    setDraggingNodeId(null);
    setLinkDraftSource(null);
  };

  const handleDropNode = (event: DragEvent) => {
    event.preventDefault();
    if (!canvasRef.current) return;
    const nodeTypeId = event.dataTransfer.getData('application/x-node-type') as NodeTypeId;
    if (!nodeTypeId || !(nodeTypeId in TYPE_BY_ID)) return;
    pushUndo();

    const rect = canvasRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left - NODE_W / 2;
    const y = event.clientY - rect.top - NODE_H / 2;

    const id = makeId(nodeTypeId);
    const baseLabel = TYPE_BY_ID[nodeTypeId].displayName;
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
          threshold: nodeType.mode === 'threshold' ? 0.5 : undefined,
          delayMs: nodeType.mode === 'delay' ? 100 : undefined,
          constantValue: nodeType.kind === 'constant' ? 512 : undefined,
          servoPin: nodeTypeId === 'servo' ? '' : undefined,
        },
      ];
    });
  };

  const canConnect = (fromId: string, toId: string, fromPort?: string): boolean => {
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

  const completeLink = (toId: string) => {
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
        weight: DEFAULT_CONNECTION_WEIGHT,
        transferMode: 'linear',
        transferPoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
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
        {(['sensor', 'compute', 'motor'] as const).map((kind) => {
          const nodesOfKind = kind === 'compute'
            ? NODE_TYPES.filter((n) => n.kind === 'compute' || n.kind === 'constant')
            : NODE_TYPES.filter((n) => n.kind === kind);
          if (nodesOfKind.length === 0) return null;
          const kindLabels: Record<string, string> = {
            sensor: 'Sensors',
            compute: 'Compute',
            motor: 'Motors',
          };
          return (
            <div key={kind} className="palette-group">
              <h2 className={`palette-category palette-category-${kind}`}>
                <span className={`palette-category-dot palette-dot-${kind}`} />
                {kindLabels[kind]}
              </h2>
              {nodesOfKind.map((nodeType) => (
                <div
                  key={nodeType.id}
                  className={`palette-item palette-item-${nodeType.kind}`}
                  draggable
                  onDragStart={(event) => event.dataTransfer.setData('application/x-node-type', nodeType.id)}
                >
                  <span>{nodeType.displayName}</span>
                  <small>{nodeType.kind === 'constant' ? 'compute' : nodeType.kind}</small>
                </div>
              ))}
            </div>
          );
        })}
      </aside>

      <div className="canvas-toolbar">
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
          <span className="toolbar-group-label">Code</span>
          <label className="toolbar-setting">
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

        <div className="toolbar-separator" />

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
                className="toolbar-btn toolbar-tertiary"
                onClick={refreshBoards}
                title="Rescan for connected Arduinos"
              >
                Refresh
              </button>
              <button
                className="toolbar-btn toolbar-primary toolbar-upload"
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
                <span
                  className="serial-error-msg"
                  title={lastResult.uploadOutput || lastResult.compileOutput}
                >
                  ⓘ details
                </span>
              )}
            </>
          )}
        </div>

        <div className="toolbar-spacer" />

        <button
          ref={resetButtonRef}
          type="button"
          className={`toolbar-btn toolbar-tertiary toolbar-reset${resetArmed ? ' is-armed' : ''}`}
          onClick={handleResetClick}
          onKeyDown={handleResetKeyDown}
          onBlur={disarmReset}
          disabled={isDiagramPristine}
          aria-live="polite"
          aria-label={
            resetArmed
              ? 'Confirm clearing the diagram'
              : 'Clear the diagram and restore defaults'
          }
          title={
            isDiagramPristine
              ? 'Diagram is already empty'
              : resetArmed
                ? 'Click again to confirm — Esc to cancel'
                : 'Clear all nodes and connections'
          }
        >
          <svg
            className="toolbar-reset-icon"
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M2.8 8a5.2 5.2 0 1 0 1.6-3.75" />
            <path d="M2.3 2.6v3.4h3.4" />
          </svg>
          <span className="toolbar-reset-label">
            {resetArmed ? 'Confirm reset' : 'Reset'}
          </span>
        </button>
      </div>

      <div
        ref={canvasRef}
        className={`diagram-canvas ${traceMode ? 'trace-active' : ''} ${linkDraftSource ? 'linking' : ''}`.trim()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDropNode}
        onMouseMove={handleCanvasMove}
        onMouseUp={handleCanvasMouseUp}
      >
        {traceMode && (
          <div className="trace-banner">
            <span>Trace Mode</span> — set sensor values to see signal propagation
            <button className="trace-banner-close" onClick={() => setTraceMode(false)}>Exit</button>
          </div>
        )}
        <div
          className="robot-overlay robot-body"
          style={{
            left: `${robotLayout.bodyCx}px`,
            top: `${robotLayout.bodyCy}px`,
            width: `${robotLayout.bodyRadius * 2}px`,
            height: `${robotLayout.bodyRadius * 2}px`,
          }}
          aria-hidden="true"
        />
        <div
          className="robot-overlay robot-wheel"
          style={{
            left: `${robotLayout.leftWheelCx}px`,
            top: `${robotLayout.leftWheelCy}px`,
            width: `${robotLayout.wheelWidth}px`,
            height: `${robotLayout.wheelHeight}px`,
          }}
          aria-hidden="true"
        />
        <div
          className="robot-overlay robot-wheel"
          style={{
            left: `${robotLayout.rightWheelCx}px`,
            top: `${robotLayout.rightWheelCy}px`,
            width: `${robotLayout.wheelWidth}px`,
            height: `${robotLayout.wheelHeight}px`,
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
          {linkDraftSource && nodeMap[linkDraftSource.id] && (
            <path
              className="draft-link"
              d={makePath(
                nodeMap[linkDraftSource.id].x +
                  portOffsetX(nodeMap[linkDraftSource.id].type, linkDraftSource.port),
                nodeMap[linkDraftSource.id].y + NODE_H,
                linkDraftPoint.x,
                linkDraftPoint.y,
              )}
            />
          )}
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
          const hasSlider = traceMode && (nodeType.kind === 'sensor' || nodeType.kind === 'constant');

          let nodeMeta: string;
          if (traceVal !== undefined) {
            nodeMeta = `output: ${formatTraceValue(traceVal)}`;
          } else if (supportsArduinoPort(nodeType) && node.arduinoPort?.trim()) {
            nodeMeta = `${nodeType.metaLabel} • port ${node.arduinoPort.trim()}`;
          } else if (nodeType.mode === 'threshold' && node.threshold !== undefined) {
            nodeMeta = `${nodeType.metaLabel} • ${node.threshold}`;
          } else if (nodeType.mode === 'delay' && node.delayMs !== undefined) {
            nodeMeta = `${nodeType.metaLabel} • ${node.delayMs}ms`;
          } else if (nodeType.kind === 'constant' && node.constantValue !== undefined) {
            nodeMeta = `${nodeType.metaLabel} • ${node.constantValue}`;
          } else if (nodeType.id === 'servo' && node.servoPin?.trim()) {
            nodeMeta = `${nodeType.metaLabel} • pin ${node.servoPin.trim()}`;
          } else if (nodeType.id === 'motor' && node.motorPin?.trim()) {
            nodeMeta = `${nodeType.metaLabel} • pin ${node.motorPin.trim()}`;
          } else if (nodeType.id === 'sensor-color') {
            nodeMeta = `${nodeType.metaLabel} • RGBC outputs`;
          } else {
            nodeMeta = nodeType.metaLabel;
          }

          return (
            <div
              key={node.id}
              className={[
                'diagram-node',
                `node-${nodeType.kind}`,
                selectedNode?.id === node.id ? 'selected' : '',
                isDisconnected ? 'trace-disconnected' : '',
                hasSlider ? 'trace-expanded' : '',
              ].filter(Boolean).join(' ')}
              style={{ left: `${node.x}px`, top: `${node.y}px` }}
              onMouseDown={(event) => beginNodeDrag(event, node.id)}
              onClick={() => setConfigTarget({ kind: 'node', id: node.id })}
            >
              <div className="node-label">{node.label}</div>
              <div className={`node-meta ${traceVal !== undefined ? 'node-meta-trace' : ''}`}>{nodeMeta}</div>
              {hasSlider && (
                <div className="trace-slider-row">
                  <span className="trace-slider-label">0</span>
                  <input
                    type="range"
                    className="trace-slider"
                    min="0"
                    max="1"
                    step="0.01"
                    value={nodeType.kind === 'sensor'
                      ? (sensorValues[node.id] ?? 0.5)
                      : (node.constantValue ?? 0.5)}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (nodeType.kind === 'sensor') {
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
                  <span className="trace-slider-label">1</span>
                </div>
              )}
              {canOutput(nodeType) && (() => {
                const ports = getOutputPorts(nodeType.id);
                if (!ports) {
                  return (
                    <button
                      className="node-handle output-handle"
                      aria-label={`Start connection from ${node.label}`}
                      onMouseDown={(event) => beginLinkDrag(event, node.id)}
                    />
                  );
                }
                return ports.map((port, i) => {
                  const leftPct = ((i + 0.5) / ports.length) * 100;
                  return (
                    <button
                      key={port}
                      className={`node-handle output-handle output-handle-port output-handle-${port}`}
                      style={{ left: `${leftPct}%` }}
                      title={port}
                      aria-label={`Start ${port} connection from ${node.label}`}
                      onMouseDown={(event) => beginLinkDrag(event, node.id, port)}
                    />
                  );
                });
              })()}
              {canInput(nodeType) && (
                <button
                  className="node-handle input-handle"
                  aria-label={`Connect to ${node.label}`}
                  onMouseDown={(event) => event.stopPropagation()}
                  onMouseUp={() => completeLink(node.id)}
                />
              )}
            </div>
          );
        })}

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
                {TYPE_BY_ID[selectedNode.type].kind === 'constant' &&
                  'Emits a fixed constant value to all connected nodes.'}
                {selectedNode.type === 'motor' &&
                  'Drives a wheel of the robot as a continuous-rotation servo on a single PWM pin. Speed and direction are determined by incoming connection weights; the right wheel is inverted automatically to account for mirrored mounting.'}
                {selectedNode.type === 'servo' &&
                  'Controls a servo motor. The input signal (-1 to 1) is mapped to an angle (0° to 180°).'}
              </p>
              <label>
                Node Label
                <input
                  type="text"
                  value={selectedNode.label}
                  onChange={(event) =>
                    setNodes((prev) =>
                      prev.map((node) =>
                        node.id === selectedNode.id ? { ...node, label: event.target.value } : node,
                      ),
                    )
                  }
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
                    min="-1"
                    max="1"
                    step="0.01"
                    value={selectedNode.threshold ?? 0.5}
                    onChange={(event) => {
                      const parsed = Number.parseFloat(event.target.value);
                      const value = Number.isFinite(parsed) ? Math.max(-1, Math.min(1, parsed)) : 0.5;
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

              {TYPE_BY_ID[selectedNode.type].kind === 'constant' && (
                <label>
                  Constant Value
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value={selectedNode.constantValue ?? 0.5}
                    onChange={(event) => {
                      const parsed = Number.parseFloat(event.target.value);
                      const value = Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0.5;
                      setNodes((prev) =>
                        prev.map((node) =>
                          node.id === selectedNode.id ? { ...node, constantValue: value } : node,
                        ),
                      );
                    }}
                  />
                </label>
              )}

              {selectedNode.type === 'motor' && (
                <label>
                  Servo PWM Pin
                  <input
                    type="text"
                    value={selectedNode.motorPin ?? ''}
                    placeholder={MOTOR_PIN_PLACEHOLDER}
                    onChange={(event) =>
                      setNodes((prev) =>
                        prev.map((node) =>
                          node.id === selectedNode.id
                            ? { ...node, motorPin: event.target.value.trimStart() }
                            : node,
                        ),
                      )
                    }
                  />
                </label>
              )}

              {selectedNode.type === 'servo' && (
                <label>
                  Servo Pin
                  <input
                    type="text"
                    value={selectedNode.servoPin ?? ''}
                    placeholder={SERVO_PIN_PLACEHOLDER}
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
              {selectedNode.type !== 'motor' && (
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
                                : [{ x: 0, y: 0 }, { x: 1, y: 1 }],
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
                    <input
                      type="number"
                      min="-1"
                      max="1"
                      step="0.05"
                      value={selectedConnection.weight}
                      onChange={(event) => {
                        const parsed = Number.parseFloat(event.target.value);
                        const value = Number.isFinite(parsed)
                          ? clampWeight(parsed)
                          : DEFAULT_CONNECTION_WEIGHT;
                        setConnections((prev) =>
                          prev.map((connection) =>
                            connection.id === selectedConnection.id ? { ...connection, weight: value } : connection,
                          ),
                        );
                      }}
                    />
                  </label>
                </>
              )}

              {selectedConnection.transferMode === 'nonlinear' && (
                <TransferCurveEditor
                  points={selectedConnection.transferPoints ?? [{ x: 0, y: 0 }, { x: 1, y: 1 }]}
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
      </div>

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
    </section>
  );
}
