export type NodeKind = 'sensor' | 'compute' | 'motor' | 'constant';
export type SensorProtocol = 'analog' | 'digital' | 'i2c';
export type ComputeMode = 'threshold' | 'delay' | 'summation' | 'multiply';
export type ColorChannel = 'clear' | 'red' | 'green' | 'blue';
/**
 * Identifier for a specific output port on a multi-output node.
 * Currently only color sensors have named ports, so this is equivalent to
 * `ColorChannel`. Adding new multi-output node types should widen this union.
 */
export type OutputPortId = ColorChannel;
export type NodeTypeId =
  | 'sensor-analog'
  | 'sensor-digital'
  | 'sensor-color'
  | 'compute-threshold'
  | 'compute-delay'
  | 'compute-summation'
  | 'compute-multiply'
  | 'constant'
  | 'servo-cr'
  | 'servo-positional'
  | 'display-tm1637';

export interface NodeTypeDefinition {
  id: NodeTypeId;
  kind: NodeKind;
  displayName: string;
  metaLabel: string;
  protocol?: SensorProtocol;
  mode?: ComputeMode;
}

export interface DiagramNode {
  id: string;
  type: NodeTypeId;
  label: string;
  x: number;
  y: number;
  arduinoPort?: string;
  threshold?: number;
  delayMs?: number;
  servoPin?: string;
  constantValue?: number;
  clkPin?: string;
  dioPin?: string;
  brightness?: number;
}

export type TransferMode = 'linear' | 'nonlinear';

export interface TransferPoint {
  x: number; // input  -100 to 100 (signed signal)
  y: number; // output -100 to 100
}

export interface DiagramConnection {
  id: string;
  from: string;
  /** Optional output-port id on the source node; used by multi-output nodes (e.g. color sensors). */
  fromPort?: OutputPortId;
  to: string;
  weight: number;
  transferMode: TransferMode;
  transferPoints: TransferPoint[];
}

/**
 * Output ports for node types that expose more than one signal.
 * Undefined means the node has a single default output — edges leaving such
 * nodes don't carry a `fromPort` field.
 */
export function getOutputPorts(typeId: NodeTypeId): OutputPortId[] | undefined {
  if (typeId === 'sensor-color') return ['clear', 'red', 'green', 'blue'];
  return undefined;
}

/** Type guard for runtime `fromPort` values loaded from persisted diagrams. */
export function isValidOutputPort(
  typeId: NodeTypeId,
  value: unknown,
): value is OutputPortId {
  const ports = getOutputPorts(typeId);
  return ports !== undefined && typeof value === 'string' && (ports as string[]).includes(value);
}

export const NODE_TYPES: NodeTypeDefinition[] = [
  { id: 'sensor-analog', kind: 'sensor', displayName: 'Analog Sensor', metaLabel: 'analog', protocol: 'analog' },
  { id: 'sensor-digital', kind: 'sensor', displayName: 'Digital Sensor', metaLabel: 'digital', protocol: 'digital' },
  { id: 'sensor-color', kind: 'sensor', displayName: 'Color Sensor', metaLabel: 'TCS34725', protocol: 'i2c' },
  { id: 'compute-threshold', kind: 'compute', displayName: 'Threshold', metaLabel: 'threshold', mode: 'threshold' },
  { id: 'compute-delay', kind: 'compute', displayName: 'Delay', metaLabel: 'delay', mode: 'delay' },
  { id: 'compute-summation', kind: 'compute', displayName: 'Summation', metaLabel: 'sum', mode: 'summation' },
  { id: 'compute-multiply', kind: 'compute', displayName: 'Multiply', metaLabel: 'multiply', mode: 'multiply' },
  { id: 'constant', kind: 'constant', displayName: 'Constant', metaLabel: 'constant' },
  { id: 'servo-cr', kind: 'motor', displayName: 'Continuous Servo', metaLabel: 'continuous servo' },
  { id: 'servo-positional', kind: 'motor', displayName: 'Positional Servo', metaLabel: 'positional servo' },
  { id: 'display-tm1637', kind: 'motor', displayName: '7-Segment Display', metaLabel: 'TM1637 4-digit' },
];

export const TYPE_BY_ID = Object.fromEntries(
  NODE_TYPES.map((nodeType) => [nodeType.id, nodeType] as const),
) as Record<NodeTypeId, NodeTypeDefinition>;
