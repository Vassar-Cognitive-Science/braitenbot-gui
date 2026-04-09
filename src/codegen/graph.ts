import type { DiagramNode, DiagramConnection, NodeKind, NodeTypeId, SensorProtocol } from '../types/diagram';
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
  comparatorOp?: string;
  motorPinFwd?: string;
  motorPinRev?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  weight: number;
}

export interface WiringGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  executionOrder: string[];
}

export function buildGraph(
  nodes: DiagramNode[],
  connections: DiagramConnection[],
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
      comparatorOp: node.comparatorOp,
      motorPinFwd: node.motorPinFwd,
      motorPinRev: node.motorPinRev,
    };
  });

  const graphEdges: GraphEdge[] = connections.map((conn) => ({
    from: conn.from,
    to: conn.to,
    weight: conn.weight,
  }));

  const nodeIds = graphNodes.map((n) => n.id);
  const executionOrder = toposort(nodeIds, graphEdges);

  return { nodes: graphNodes, edges: graphEdges, executionOrder };
}
