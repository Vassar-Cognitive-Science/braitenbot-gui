export type NodeKind = 'sensor' | 'compute' | 'motor' | 'constant';
export type SensorProtocol = 'analog' | 'digital' | 'i2c';
export type ComputeMode = 'threshold' | 'delay' | 'summation' | 'multiply';
export type NodeTypeId =
  | 'sensor-analog'
  | 'sensor-digital'
  | 'sensor-i2c'
  | 'compute-threshold'
  | 'compute-delay'
  | 'compute-summation'
  | 'compute-multiply'
  | 'constant'
  | 'motor'
  | 'servo';

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
  motorPin?: string;
  servoPin?: string;
  constantValue?: number;
}

export type TransferMode = 'linear' | 'nonlinear';

export interface TransferPoint {
  x: number; // input  0–1 (normalized sensor signal)
  y: number; // output -1 to 1
}

export interface DiagramConnection {
  id: string;
  from: string;
  to: string;
  weight: number;
  transferMode: TransferMode;
  transferPoints: TransferPoint[];
}

export const NODE_TYPES: NodeTypeDefinition[] = [
  { id: 'sensor-analog', kind: 'sensor', displayName: 'Analog Sensor', metaLabel: 'analog', protocol: 'analog' },
  { id: 'sensor-digital', kind: 'sensor', displayName: 'Digital Sensor', metaLabel: 'digital', protocol: 'digital' },
  { id: 'sensor-i2c', kind: 'sensor', displayName: 'I2C Sensor', metaLabel: 'i2c', protocol: 'i2c' },
  { id: 'compute-threshold', kind: 'compute', displayName: 'Threshold', metaLabel: 'threshold', mode: 'threshold' },
  { id: 'compute-delay', kind: 'compute', displayName: 'Delay', metaLabel: 'delay', mode: 'delay' },
  { id: 'compute-summation', kind: 'compute', displayName: 'Summation', metaLabel: 'sum', mode: 'summation' },
  { id: 'compute-multiply', kind: 'compute', displayName: 'Multiply', metaLabel: 'multiply', mode: 'multiply' },
  { id: 'constant', kind: 'constant', displayName: 'Constant', metaLabel: 'constant' },
  { id: 'motor', kind: 'motor', displayName: 'Motor', metaLabel: 'actuator' },
  { id: 'servo', kind: 'motor', displayName: 'Servo', metaLabel: 'servo' },
];

export const TYPE_BY_ID = Object.fromEntries(
  NODE_TYPES.map((nodeType) => [nodeType.id, nodeType] as const),
) as Record<NodeTypeId, NodeTypeDefinition>;
