import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, MouseEvent } from 'react';

type NodeKind = 'sensor' | 'compute' | 'motor';
type SensorProtocol = 'analog' | 'digital' | 'i2c';
type ComputeMode = 'threshold' | 'comparator' | 'delay';
type NodeTypeId =
  | 'sensor-analog'
  | 'sensor-digital'
  | 'sensor-i2c'
  | 'compute-threshold'
  | 'compute-comparator'
  | 'compute-delay'
  | 'motor';

interface NodeTypeDefinition {
  id: NodeTypeId;
  kind: NodeKind;
  displayName: string;
  metaLabel: string;
  protocol?: SensorProtocol;
  mode?: ComputeMode;
}

interface DiagramNode {
  id: string;
  type: NodeTypeId;
  label: string;
  x: number;
  y: number;
  arduinoPort?: string;
}

interface DiagramConnection {
  id: string;
  from: string;
  to: string;
  weight: number;
}

const NODE_W = 148;
const NODE_H = 64;
const DEFAULT_CONNECTION_WEIGHT = 1;
const ANALOG_PORT_PLACEHOLDER = 'A0';
const DIGITAL_PORT_PLACEHOLDER = '2';

interface RobotOverlayLayout {
  bodyCx: number;
  bodyCy: number;
  bodyRadius: number;
  wheelRadius: number;
  leftWheelCx: number;
  leftWheelCy: number;
  rightWheelCx: number;
  rightWheelCy: number;
}

const NODE_TYPES: NodeTypeDefinition[] = [
  { id: 'sensor-analog', kind: 'sensor', displayName: 'Analog Sensor', metaLabel: 'analog', protocol: 'analog' },
  { id: 'sensor-digital', kind: 'sensor', displayName: 'Digital Sensor', metaLabel: 'digital', protocol: 'digital' },
  { id: 'sensor-i2c', kind: 'sensor', displayName: 'I2C Sensor', metaLabel: 'i2c', protocol: 'i2c' },
  { id: 'compute-threshold', kind: 'compute', displayName: 'Threshold', metaLabel: 'threshold', mode: 'threshold' },
  { id: 'compute-comparator', kind: 'compute', displayName: 'Comparator', metaLabel: 'comparator', mode: 'comparator' },
  { id: 'compute-delay', kind: 'compute', displayName: 'Delay', metaLabel: 'delay', mode: 'delay' },
  { id: 'motor', kind: 'motor', displayName: 'Motor', metaLabel: 'actuator' },
];

const TYPE_BY_ID = Object.fromEntries(
  NODE_TYPES.map((nodeType) => [nodeType.id, nodeType] as const),
) as Record<NodeTypeId, NodeTypeDefinition>;

const START_CONNECTIONS: DiagramConnection[] = [];

function canOutput(nodeType: NodeTypeDefinition): boolean {
  return nodeType.kind !== 'motor';
}

function canInput(nodeType: NodeTypeDefinition): boolean {
  return nodeType.kind !== 'sensor';
}

function makePath(x1: number, y1: number, x2: number, y2: number): string {
  const c1 = x1 + 60;
  const c2 = x2 - 60;
  return `M ${x1} ${y1} C ${c1} ${y1}, ${c2} ${y2}, ${x2} ${y2}`;
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
  const wheelOffset = bodyRadius - wheelRadius * 0.8;
  const horizontalPadding = bodyRadius + wheelRadius + 32;
  const bodyCx = Math.min(
    canvasWidth - horizontalPadding,
    Math.max(horizontalPadding, canvasWidth * 0.67),
  );
  const bodyCy = Math.max(bodyRadius + 22, Math.min(canvasHeight - bodyRadius - 22, canvasHeight / 2));

  return {
    bodyCx,
    bodyCy,
    bodyRadius,
    wheelRadius,
    leftWheelCx: bodyCx - wheelOffset,
    leftWheelCy: bodyCy,
    rightWheelCx: bodyCx + wheelOffset,
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
    },
    {
      id: 'motor-right',
      type: 'motor',
      label: 'Right Motor',
      x: layout.rightWheelCx - NODE_W / 2,
      y: layout.rightWheelCy - NODE_H / 2,
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
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const fallbackIdCounterRef = useRef(0);

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

  const connectionPaths = useMemo(() => {
    return connections
      .map((connection) => {
        const from = nodeMap[connection.from];
        const to = nodeMap[connection.to];
        if (!from || !to) return null;
        const x1 = from.x + NODE_W;
        const y1 = from.y + NODE_H / 2;
        const x2 = to.x;
        const y2 = to.y + NODE_H / 2;
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
    if (!configTarget) return;
    if (configTarget.kind === 'node' && !nodeMap[configTarget.id]) {
      setConfigTarget(null);
      return;
    }
    if (configTarget.kind === 'connection' && !connections.some((connection) => connection.id === configTarget.id)) {
      setConfigTarget(null);
    }
  }, [configTarget, connections, nodeMap]);

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
          className="palette-reset"
          onClick={() => {
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
            width: `${robotLayout.wheelRadius * 2}px`,
            height: `${robotLayout.wheelRadius * 2}px`,
          }}
          aria-hidden="true"
        />
        <div
          className="robot-overlay robot-wheel"
          style={{
            left: `${robotLayout.rightWheelCx}px`,
            top: `${robotLayout.rightWheelCy}px`,
            width: `${robotLayout.wheelRadius * 2}px`,
            height: `${robotLayout.wheelRadius * 2}px`,
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
                nodeMap[linkDraftSource].x + NODE_W,
                nodeMap[linkDraftSource].y + NODE_H / 2,
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
          const nodeMeta = supportsArduinoPort(nodeType) && node.arduinoPort?.trim()
            ? `${nodeType.metaLabel} • port ${node.arduinoPort.trim()}`
            : nodeType.metaLabel;

          return (
            <div
              key={node.id}
              className={`diagram-node node-${nodeType.kind} ${selectedNode?.id === node.id ? 'selected' : ''}`}
              style={{ left: `${node.x}px`, top: `${node.y}px` }}
              onMouseDown={(event) => beginNodeDrag(event, node.id)}
            >
              <div className="node-label">{node.label}</div>
              <div className="node-meta">{nodeMeta}</div>
              <button
                className="node-config-trigger"
                aria-label={`Configure ${node.label}`}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => setConfigTarget({ kind: 'node', id: node.id })}
              >
                ⚙
              </button>
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
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
