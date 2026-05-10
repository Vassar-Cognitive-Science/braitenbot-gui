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
  pullup?: boolean;
  threshold?: number;
  delayMs?: number;
  servoPin?: string;
  constantValue?: number;
  frequencyHz?: number;
  amplitude?: number;
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
      pullup: node.pullup,
      threshold: node.threshold,
      delayMs: node.delayMs,
      servoPin: node.servoPin,
      constantValue: node.constantValue,
      frequencyHz: node.frequencyHz,
      amplitude: node.amplitude,
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

  // Delay nodes break feedback cycles: their output is the buffered value
  // from a previous loop iteration, so they don't impose an ordering
  // dependency on their inputs. We filter edges INTO delay nodes out of the
  // dependency graph used for toposort, which lets the rest of the loop run
  // before delays capture their (now-final) inputs at the bottom.
  const delayIds = new Set(graphNodes.filter((n) => n.typeId === 'compute-delay').map((n) => n.id));
  const orderingEdges = graphEdges.filter((e) => !delayIds.has(e.to));

  const nodeIds = graphNodes.map((n) => n.id);
  const executionOrder = toposort(nodeIds, orderingEdges);

  return { nodes: graphNodes, edges: graphEdges, executionOrder, loopPeriodMs };
}
