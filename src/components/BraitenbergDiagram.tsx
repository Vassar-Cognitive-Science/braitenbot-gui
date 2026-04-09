import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, MouseEvent } from 'react';
import type { DiagramNode, DiagramConnection, NodeTypeId, NodeTypeDefinition, SensorProtocol } from '../types/diagram';
import { NODE_TYPES, TYPE_BY_ID } from '../types/diagram';
import { validateGraph, buildGraph, generateSketch } from '../codegen';
import type { ValidationError } from '../codegen';

const NODE_W = 148;
const NODE_H = 64;
const DEFAULT_CONNECTION_WEIGHT = 1;
const ANALOG_PORT_PLACEHOLDER = 'A0';
const DIGITAL_PORT_PLACEHOLDER = '2';
const MOTOR_PIN_FWD_PLACEHOLDER = '5';
const MOTOR_PIN_REV_PLACEHOLDER = '6';

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
  return nodeType.kind !== 'sensor';
}

function makePath(x1: number, y1: number, x2: number, y2: number): string {
  const c1 = y1 + 60;
  const c2 = y2 - 60;
  return `M ${x1} ${y1} C ${x1} ${c1}, ${x2} ${c2}, ${x2} ${y2}`;
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
      motorPinFwd: '',
      motorPinRev: '',
    },
    {
      id: 'motor-right',
      type: 'motor',
      label: 'Right Motor',
      x: layout.rightWheelCx - NODE_W / 2,
      y: layout.rightWheelCy - NODE_H / 2,
      motorPinFwd: '',
      motorPinRev: '',
    },
  ];
}

const START_NODES: DiagramNode[] = makeMotorNodes(INITIAL_ROBOT_LAYOUT);

export function BraitenbergDiagram() {
  const [nodes, setNodes] = useState<DiagramNode[]>(START_NODES);
  const [connections, setConnections] = useState<DiagramConnection[]>(START_CONNECTIONS);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [nodeDragOffset, setNodeDragOffset] = useState({ x: 0, y: 0 });
  const [linkDraftSource, setLinkDraftSource] = useState<string | null>(null);
  const [linkDraftPoint, setLinkDraftPoint] = useState({ x: 0, y: 0 });
  const [robotLayout, setRobotLayout] = useState<RobotOverlayLayout>(INITIAL_ROBOT_LAYOUT);
  const [configTarget, setConfigTarget] = useState<{ kind: 'node' | 'connection'; id: string } | null>(null);
  const [codeGenErrors, setCodeGenErrors] = useState<ValidationError[]>([]);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [showCodeDialog, setShowCodeDialog] = useState(false);
  const codeDialogRef = useRef<HTMLDialogElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const fallbackIdCounterRef = useRef(0);
  const undoStackRef = useRef<{ nodes: DiagramNode[]; connections: DiagramConnection[] }[]>([]);

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

  const handleGenerate = useCallback(() => {
    const errors = validateGraph(nodes, connections);
    setCodeGenErrors(errors);
    const hasErrors = errors.some((e) => e.severity === 'error');
    if (hasErrors) {
      setGeneratedCode(null);
      setShowCodeDialog(true);
      return;
    }
    const graph = buildGraph(nodes, connections);
    setGeneratedCode(generateSketch(graph));
    setShowCodeDialog(true);
  }, [nodes, connections]);

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
        const x1 = from.x + NODE_W / 2;
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

    const updateLayout = () => {
      const rect = canvas.getBoundingClientRect();
      setRobotLayout(calculateRobotOverlay(rect.width, rect.height));
    };

    updateLayout();
    const observer = new ResizeObserver(updateLayout);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setNodes((prev) =>
      prev.map((node) => {
        if (node.id === 'motor-left') {
          return { ...node, x: robotLayout.leftWheelCx - NODE_W / 2, y: robotLayout.leftWheelCy - NODE_H / 2 };
        }
        if (node.id === 'motor-right') {
          return { ...node, x: robotLayout.rightWheelCx - NODE_W / 2, y: robotLayout.rightWheelCy - NODE_H / 2 };
        }
        return node;
      }),
    );
  }, [robotLayout]);

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

  const beginLinkDrag = (event: MouseEvent, nodeId: string) => {
    event.stopPropagation();
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    setLinkDraftSource(nodeId);
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
          threshold: nodeType.mode === 'threshold' ? 512 : undefined,
          delayMs: nodeType.mode === 'delay' ? 100 : undefined,
          comparatorOp: nodeType.mode === 'comparator' ? '>' : undefined,
        },
      ];
    });
  };

  const canConnect = (fromId: string, toId: string): boolean => {
    if (fromId === toId) return false;
    const from = nodeMap[fromId];
    const to = nodeMap[toId];
    if (!from || !to) return false;
    const fromType = TYPE_BY_ID[from.type];
    const toType = TYPE_BY_ID[to.type];
    if (!canOutput(fromType) || !canInput(toType)) return false;
    return !connections.some((connection) => connection.from === fromId && connection.to === toId);
  };

  const completeLink = (toId: string) => {
    if (!linkDraftSource || !canConnect(linkDraftSource, toId)) {
      setLinkDraftSource(null);
      return;
    }
    pushUndo();
    setConnections((prev) => [
      ...prev,
      { id: makeId('link'), from: linkDraftSource, to: toId, weight: DEFAULT_CONNECTION_WEIGHT },
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
        <h2>Nodes</h2>
        {NODE_TYPES.map((nodeType) => (
          <div
            key={nodeType.id}
            className="palette-item"
            draggable
            onDragStart={(event) => event.dataTransfer.setData('application/x-node-type', nodeType.id)}
          >
            <span>{nodeType.displayName}</span>
            <small>{nodeType.kind}</small>
          </div>
        ))}
        <button
          className="palette-generate"
          onClick={handleGenerate}
        >
          Generate Arduino Code
        </button>
        <button
          className="palette-reset"
          onClick={() => {
            pushUndo();
            setNodes(makeMotorNodes(robotLayout));
            setConnections(START_CONNECTIONS);
            setConfigTarget(null);
          }}
        >
          Reset diagram
        </button>
      </aside>

      <div
        ref={canvasRef}
        className="diagram-canvas"
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDropNode}
        onMouseMove={handleCanvasMove}
        onMouseUp={handleCanvasMouseUp}
      >
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
          {connectionPaths.map((connection) => (
            <path
              key={connection.id}
              className={`connection-link ${selectedConnection?.id === connection.id ? 'selected' : ''}`}
              d={connection.d}
            />
          ))}
          {linkDraftSource && nodeMap[linkDraftSource] && (
            <path
              className="draft-link"
              d={makePath(
                nodeMap[linkDraftSource].x + NODE_W / 2,
                nodeMap[linkDraftSource].y + NODE_H,
                linkDraftPoint.x,
                linkDraftPoint.y,
              )}
            />
          )}
        </svg>

        {connectionPaths.map((connection) => (
          <button
            key={`${connection.id}-config`}
            className={`connection-config-trigger ${selectedConnection?.id === connection.id ? 'selected' : ''}`}
            style={{ left: `${connection.midX}px`, top: `${connection.midY}px` }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => setConfigTarget({ kind: 'connection', id: connection.id })}
          >
            w {connection.weight.toFixed(2)}
          </button>
        ))}

        {nodes.map((node) => {
          const nodeType = TYPE_BY_ID[node.type];
          let nodeMeta = nodeType.metaLabel;
          if (supportsArduinoPort(nodeType) && node.arduinoPort?.trim()) {
            nodeMeta = `${nodeType.metaLabel} • port ${node.arduinoPort.trim()}`;
          } else if (nodeType.mode === 'threshold' && node.threshold !== undefined) {
            nodeMeta = `${nodeType.metaLabel} • ${node.threshold}`;
          } else if (nodeType.mode === 'delay' && node.delayMs !== undefined) {
            nodeMeta = `${nodeType.metaLabel} • ${node.delayMs}ms`;
          } else if (nodeType.mode === 'comparator' && node.comparatorOp) {
            nodeMeta = `${nodeType.metaLabel} • ${node.comparatorOp}`;
          } else if (nodeType.kind === 'motor' && node.motorPinFwd?.trim()) {
            nodeMeta = `${nodeType.metaLabel} • pins ${node.motorPinFwd.trim()}/${node.motorPinRev?.trim() || '?'}`;
          }

          return (
            <div
              key={node.id}
              className={`diagram-node node-${nodeType.kind} ${selectedNode?.id === node.id ? 'selected' : ''}`}
              style={{ left: `${node.x}px`, top: `${node.y}px` }}
              onMouseDown={(event) => beginNodeDrag(event, node.id)}
              onClick={() => setConfigTarget({ kind: 'node', id: node.id })}
            >
              <div className="node-label">{node.label}</div>
              <div className="node-meta">{nodeMeta}</div>
              {canOutput(nodeType) && (
                <button
                  className="node-handle output-handle"
                  aria-label={`Start connection from ${node.label}`}
                  onMouseDown={(event) => beginLinkDrag(event, node.id)}
                />
              )}
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
                  'Passes the input signal through only if it exceeds the configured threshold value.'}
                {TYPE_BY_ID[selectedNode.type].kind === 'compute' &&
                  TYPE_BY_ID[selectedNode.type].mode === 'comparator' &&
                  'Compares two input signals using the selected operator and outputs the result.'}
                {TYPE_BY_ID[selectedNode.type].kind === 'compute' &&
                  TYPE_BY_ID[selectedNode.type].mode === 'delay' &&
                  'Delays the input signal by the configured number of milliseconds before passing it on.'}
                {TYPE_BY_ID[selectedNode.type].kind === 'motor' &&
                  'Drives a wheel motor on the robot. Speed and direction are determined by incoming connection weights.'}
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

              {TYPE_BY_ID[selectedNode.type].mode === 'threshold' && (
                <label>
                  Threshold Value
                  <input
                    type="number"
                    min="0"
                    max="1023"
                    step="1"
                    value={selectedNode.threshold ?? 512}
                    onChange={(event) => {
                      const parsed = Number.parseInt(event.target.value, 10);
                      const value = Number.isFinite(parsed) ? Math.max(0, Math.min(1023, parsed)) : 512;
                      setNodes((prev) =>
                        prev.map((node) =>
                          node.id === selectedNode.id ? { ...node, threshold: value } : node,
                        ),
                      );
                    }}
                  />
                </label>
              )}

              {TYPE_BY_ID[selectedNode.type].mode === 'comparator' && (
                <label>
                  Comparison Operator
                  <select
                    value={selectedNode.comparatorOp ?? '>'}
                    onChange={(event) =>
                      setNodes((prev) =>
                        prev.map((node) =>
                          node.id === selectedNode.id ? { ...node, comparatorOp: event.target.value } : node,
                        ),
                      )
                    }
                  >
                    <option value=">">&gt; Greater than</option>
                    <option value="<">&lt; Less than</option>
                    <option value=">=">&gt;= Greater or equal</option>
                    <option value="<=">&lt;= Less or equal</option>
                    <option value="==">== Equal</option>
                    <option value="!=">!= Not equal</option>
                  </select>
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

              {TYPE_BY_ID[selectedNode.type].kind === 'motor' && (
                <>
                  <label>
                    Forward Pin
                    <input
                      type="text"
                      value={selectedNode.motorPinFwd ?? ''}
                      placeholder={MOTOR_PIN_FWD_PLACEHOLDER}
                      onChange={(event) =>
                        setNodes((prev) =>
                          prev.map((node) =>
                            node.id === selectedNode.id
                              ? { ...node, motorPinFwd: event.target.value.trimStart() }
                              : node,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    Reverse Pin
                    <input
                      type="text"
                      value={selectedNode.motorPinRev ?? ''}
                      placeholder={MOTOR_PIN_REV_PLACEHOLDER}
                      onChange={(event) =>
                        setNodes((prev) =>
                          prev.map((node) =>
                            node.id === selectedNode.id
                              ? { ...node, motorPinRev: event.target.value.trimStart() }
                              : node,
                          ),
                        )
                      }
                    />
                  </label>
                </>
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
