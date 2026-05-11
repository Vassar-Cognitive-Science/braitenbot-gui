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

/**
 * Wheel motors are the two paired continuous servos that drive the robot
 * body. Identified at graph-build time so codegen never has to know the
 * UI's literal "motor-left" / "motor-right" id convention.
 */
export type WheelRole = 'left' | 'right';

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
  clkPin?: string;
  dioPin?: string;
  brightness?: number;
  wheelRole?: WheelRole;
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

function wheelRoleFor(id: string, typeId: NodeTypeId): WheelRole | undefined {
  if (typeId !== 'servo-cr') return undefined;
  if (id === 'motor-left') return 'left';
  if (id === 'motor-right') return 'right';
  return undefined;
}

/**
 * Bounds the loop period to a safe range. The lower bound prevents
 * division-by-zero / Infinity in delay-buffer sizing; the upper bound keeps
 * real-time guarantees and trace simulation usable.
 */
const MIN_LOOP_PERIOD_MS = 1;
const MAX_LOOP_PERIOD_MS = 1000;

export function buildGraph(
  nodes: DiagramNode[],
  connections: DiagramConnection[],
  loopPeriodMs = 20,
): WiringGraph {
  const safeLoopPeriodMs = Math.max(
    MIN_LOOP_PERIOD_MS,
    Math.min(MAX_LOOP_PERIOD_MS, Math.round(loopPeriodMs)),
  );
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
      clkPin: node.clkPin,
      dioPin: node.dioPin,
      brightness: node.brightness,
      wheelRole: wheelRoleFor(node.id, node.type),
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

  // Cycle-breaking nodes (currently just delay) read a value from a previous
  // loop iteration, so edges into them don't impose an ordering dependency.
  // We strip those edges before toposort so the rest of the loop runs first
  // and the cycle-breakers capture their (now-final) inputs at the bottom.
  const cycleBreakerIds = new Set(
    graphNodes.filter((n) => TYPE_BY_ID[n.typeId].breaksCycles).map((n) => n.id),
  );
  const orderingEdges = graphEdges.filter((e) => !cycleBreakerIds.has(e.to));

  const nodeIds = graphNodes.map((n) => n.id);
  const executionOrder = toposort(nodeIds, orderingEdges);

  return { nodes: graphNodes, edges: graphEdges, executionOrder, loopPeriodMs: safeLoopPeriodMs };
}
