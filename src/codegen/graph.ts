import type {
  DiagramNode,
  DiagramConnection,
  NodeKind,
  NodeTypeId,
  OutputPortId,
  SensorProtocol,
} from '../types/diagram';
import { TYPE_BY_ID } from '../types/diagram';
import { toposort } from './toposort';

export interface GraphNode {
  id: string;
  kind: NodeKind;
  typeId: NodeTypeId;
  label: string;
  arduinoPort?: string;
  protocol?: SensorProtocol;
  threshold?: number;
  delayMs?: number;
  servoPin?: string;
  constantValue?: number;
}

export interface GraphEdge {
  from: string;
  /** Optional output-port id on the source node — see DiagramConnection.fromPort. */
  fromPort?: OutputPortId;
  to: string;
  weight: number;
  transferMode: 'linear' | 'nonlinear';
  transferPoints: { x: number; y: number }[];
}

export interface WiringGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  executionOrder: string[];
  loopPeriodMs: number;
}

export function buildGraph(
  nodes: DiagramNode[],
  connections: DiagramConnection[],
  loopPeriodMs = 20,
): WiringGraph {
  const graphNodes: GraphNode[] = nodes.map((node) => {
    const typeDef = TYPE_BY_ID[node.type];
    return {
      id: node.id,
      kind: typeDef.kind,
      typeId: node.type,
      label: node.label,
      arduinoPort: node.arduinoPort,
      protocol: typeDef.protocol,
      threshold: node.threshold,
      delayMs: node.delayMs,
      servoPin: node.servoPin,
      constantValue: node.constantValue,
    };
  });

  const graphEdges: GraphEdge[] = connections.map((conn) => ({
    from: conn.from,
    fromPort: conn.fromPort,
    to: conn.to,
    weight: conn.weight,
    transferMode: conn.transferMode,
    transferPoints: conn.transferPoints,
  }));

  const nodeIds = graphNodes.map((n) => n.id);
  const executionOrder = toposort(nodeIds, graphEdges);

  return { nodes: graphNodes, edges: graphEdges, executionOrder, loopPeriodMs };
}
