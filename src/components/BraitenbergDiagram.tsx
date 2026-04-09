import { useMemo, useRef, useState } from 'react';
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
}

interface DiagramConnection {
  id: string;
  from: string;
  to: string;
}

const NODE_W = 148;
const NODE_H = 64;

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

const START_NODES: DiagramNode[] = [
  { id: 'motor-left', type: 'motor', label: 'Left Motor', x: 620, y: 180 },
  { id: 'motor-right', type: 'motor', label: 'Right Motor', x: 620, y: 300 },
];

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

export function BraitenbergDiagram() {
  const [nodes, setNodes] = useState<DiagramNode[]>(START_NODES);
  const [connections, setConnections] = useState<DiagramConnection[]>(START_CONNECTIONS);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [nodeDragOffset, setNodeDragOffset] = useState({ x: 0, y: 0 });
  const [linkDraftSource, setLinkDraftSource] = useState<string | null>(null);
  const [linkDraftPoint, setLinkDraftPoint] = useState({ x: 0, y: 0 });
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
        return {
          id: connection.id,
          d: makePath(from.x + NODE_W, from.y + NODE_H / 2, to.x, to.y + NODE_H / 2),
        };
      })
      .filter((item): item is { id: string; d: string } => item !== null);
  }, [connections, nodeMap]);

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
      return [...prev, { id, type: nodeTypeId, label: `${baseLabel} ${nodeNumber}`, x, y }];
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
      { id: makeId('link'), from: linkDraftSource, to: toId },
    ]);
    setLinkDraftSource(null);
  };

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
            setNodes(START_NODES);
            setConnections(START_CONNECTIONS);
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
        <svg className="diagram-links" aria-hidden="true">
          {connectionPaths.map((connection) => (
            <path key={connection.id} d={connection.d} />
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

        {nodes.map((node) => {
          const nodeType = TYPE_BY_ID[node.type];
          return (
            <div
              key={node.id}
              className={`diagram-node node-${nodeType.kind}`}
              style={{ left: `${node.x}px`, top: `${node.y}px` }}
              onMouseDown={(event) => beginNodeDrag(event, node.id)}
            >
              <div className="node-label">{node.label}</div>
              <div className="node-meta">
                {nodeType.metaLabel}
              </div>
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
                  onMouseUp={() => completeLink(node.id)}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
