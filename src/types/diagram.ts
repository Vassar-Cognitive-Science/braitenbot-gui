export type NodeKind = 'sensor' | 'compute' | 'motor';
export type SensorProtocol = 'analog' | 'digital' | 'i2c';
export type ComputeMode = 'threshold' | 'comparator' | 'delay';
export type NodeTypeId =
  | 'sensor-analog'
  | 'sensor-digital'
  | 'sensor-i2c'
  | 'compute-threshold'
  | 'compute-comparator'
  | 'compute-delay'
  | 'motor';

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
  comparatorOp?: string;
  motorPinFwd?: string;
  motorPinRev?: string;
}

export interface DiagramConnection {
  id: string;
  from: string;
  to: string;
  weight: number;
}

export const NODE_TYPES: NodeTypeDefinition[] = [
  { id: 'sensor-analog', kind: 'sensor', displayName: 'Analog Sensor', metaLabel: 'analog', protocol: 'analog' },
  { id: 'sensor-digital', kind: 'sensor', displayName: 'Digital Sensor', metaLabel: 'digital', protocol: 'digital' },
  { id: 'sensor-i2c', kind: 'sensor', displayName: 'I2C Sensor', metaLabel: 'i2c', protocol: 'i2c' },
  { id: 'compute-threshold', kind: 'compute', displayName: 'Threshold', metaLabel: 'threshold', mode: 'threshold' },
  { id: 'compute-comparator', kind: 'compute', displayName: 'Comparator', metaLabel: 'comparator', mode: 'comparator' },
  { id: 'compute-delay', kind: 'compute', displayName: 'Delay', metaLabel: 'delay', mode: 'delay' },
  { id: 'motor', kind: 'motor', displayName: 'Motor', metaLabel: 'actuator' },
];

export const TYPE_BY_ID = Object.fromEntries(
  NODE_TYPES.map((nodeType) => [nodeType.id, nodeType] as const),
) as Record<NodeTypeId, NodeTypeDefinition>;
