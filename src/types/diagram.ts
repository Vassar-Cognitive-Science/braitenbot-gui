export type NodeKind = 'sensor' | 'compute' | 'output' | 'constant' | 'compound' | 'port';
export type SensorProtocol = 'analog' | 'digital' | 'i2c';
export type ComputeMode = 'threshold' | 'delay' | 'summation' | 'multiply' | 'min' | 'max' | 'oscillator' | 'noise';
export type ColorChannel = 'clear' | 'red' | 'green' | 'blue';
/** TCS34725 RGBC gain multipliers the UI offers; the emitter maps each to a
 *  CONTROL-register value. 16× is a good default for indoor/classroom light. */
export const COLOR_GAINS = [1, 4, 16, 60] as const;
export const DEFAULT_COLOR_GAIN = 16;
/** Distance (mm) a VL53L4CD ToF sensor maps to full-scale signal. Objects at
 *  or beyond this read 0 (near = high) — short enough to be useful indoors. */
export const DEFAULT_TOF_MAX_MM = 500;
/**
 * Identifier for a port on a node. Color sensor channels are a fixed enum;
 * compound-node ports are user-defined strings. Runtime port validity is
 * checked via getOutputPorts / getInputPorts, not the static type.
 */
export type OutputPortId = string;
export type InputPortId = string;
export type NodeTypeId =
  | 'sensor-analog'
  | 'sensor-digital'
  | 'sensor-color'
  | 'sensor-tof'
  | 'compute-threshold'
  | 'compute-delay'
  | 'compute-summation'
  | 'compute-multiply'
  | 'compute-min'
  | 'compute-max'
  | 'compute-oscillator'
  | 'compute-noise'
  | 'constant'
  | 'servo-cr'
  | 'servo-positional'
  | 'digital-out'
  | 'display-tm1637'
  | 'compound'
  | 'compound-input'
  | 'compound-output';

export type PinFieldId = 'arduinoPort' | 'servoPin' | 'clkPin' | 'gpioPin' | 'xshutPin';

export interface NodeTypeDefinition {
  id: NodeTypeId;
  kind: NodeKind;
  displayName: string;
  metaLabel: string;
  protocol?: SensorProtocol;
  mode?: ComputeMode;
  /** User-supplied pin/port fields the type requires. Drives pin-decl emission and validation. */
  pinFields?: PinFieldId[];
  /** Whether the node consumes incoming edges. Sources (sensors, constants, oscillator, noise) are false. */
  hasInputs?: boolean;
  /** Maximum number of incoming connections. Undefined = unlimited. */
  maxInputs?: number;
  /** Whether the node breaks feedback cycles (delay nodes do; nothing else currently). */
  breaksCycles?: boolean;
  /** Type may only appear inside a compound body — never on the top-level diagram. */
  bodyOnly?: boolean;
  /** Type may only appear at the top level — never inside a compound body (e.g. wheel motors). */
  topLevelOnly?: boolean;
}

export interface DiagramNode {
  id: string;
  type: NodeTypeId;
  label: string;
  x: number;
  y: number;
  arduinoPort?: string;
  /** Use INPUT_PULLUP mode for digital sensors. Ignored for non-digital sensors. */
  pullup?: boolean;
  /** Latch brief pulses on a digital sensor via a pin interrupt so pulses
   *  shorter than the loop period (e.g. a clap on a sound sensor) register as
   *  high for one full tick. Steady signals read the same as plain polling.
   *  Ignored for non-digital sensors. */
  pulseCapture?: boolean;
  /** Invert an analog sensor's signal (100 − value) so brighter/closer reads
   *  higher. Ignored for non-analog sensors. */
  invert?: boolean;
  /** TCS34725 color-sensor RGBC gain multiplier (1, 4, 16, or 60). Higher gain
   *  lifts low-light readings. Ignored for non-color sensors. */
  colorGain?: number;
  /** VL53L4CD ToF sensor's XSHUT (shutdown) pin. Each ToF node needs its own
   *  so the setup sequence can bring sensors up one at a time and assign each a
   *  unique I2C address. */
  xshutPin?: string;
  /** VL53L4CD distance (mm) that maps to full-scale signal. Defaults to
   *  DEFAULT_TOF_MAX_MM. Ignored for non-ToF sensors. */
  maxDistanceMm?: number;
  threshold?: number;
  delayMs?: number;
  servoPin?: string;
  constantValue?: number;
  /** Oscillator frequency in Hz. */
  frequencyHz?: number;
  /** Oscillator amplitude (0–100). Output ranges from -amplitude to +amplitude. */
  amplitude?: number;
  clkPin?: string;
  gpioPin?: string;
  brightness?: number;
  /** For type === 'compound': id of the CompoundTypeDefinition this node instantiates. */
  compoundTypeId?: string;
}

export type TransferMode = 'linear' | 'nonlinear';

export interface TransferPoint {
  x: number; // input  -100 to 100 (signed signal)
  y: number; // output -100 to 100
}

export interface DiagramConnection {
  id: string;
  from: string;
  /** Output port on the source node (color sensor channel or compound output). */
  fromPort?: OutputPortId;
  to: string;
  /** Input port on the target node (compound input). */
  toPort?: InputPortId;
  weight: number;
  transferMode: TransferMode;
  transferPoints: TransferPoint[];
  /** Position of the weight badge along this connection's curve, as a bézier
   *  parameter in [0, 1]. When unset, the badge sits at an auto-staggered
   *  default (0.5 for a lone edge; spread apart for parallel edges between the
   *  same node pair). Set by dragging the badge along its curve. */
  labelT?: number;
}

/**
 * A free-floating explanatory note drawn on the top-level canvas. Comments are
 * purely didactic — they carry no ports, take part in no signal flow, and are
 * ignored by the code emitter. They render behind the nodes so wiring stays
 * legible on top. Position and size are in world coordinates (pre-zoom), like
 * DiagramNode.x/y.
 */
export interface DiagramComment {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}

/** Default size (world units) for a freshly dropped comment box. */
export const DEFAULT_COMMENT_WIDTH = 220;
export const DEFAULT_COMMENT_HEIGHT = 120;
/** Lower bounds so a comment can't be collapsed past usability while resizing. */
export const MIN_COMMENT_WIDTH = 80;
export const MIN_COMMENT_HEIGHT = 48;

/**
 * A user-defined compound node — a named subdiagram with declared input and
 * output anchor nodes. Instances of this type appear as `type: 'compound'`
 * DiagramNodes whose `compoundTypeId` matches `id` below.
 */
export interface CompoundTypeDefinition {
  id: string;
  displayName: string;
  body: {
    nodes: DiagramNode[];
    connections: DiagramConnection[];
  };
}

/**
 * Output ports on a node. Compound instances expose one port per
 * 'compound-output' anchor in their body; color sensors expose their fixed
 * channels. Single-output nodes return undefined.
 */
export function getOutputPorts(
  typeId: NodeTypeId,
  node?: { compoundTypeId?: string },
  compoundTypes?: CompoundTypeDefinition[],
): OutputPortId[] | undefined {
  if (typeId === 'sensor-color') return ['clear', 'red', 'green', 'blue'];
  if (typeId === 'compound' && node?.compoundTypeId && compoundTypes) {
    const def = compoundTypes.find((c) => c.id === node.compoundTypeId);
    if (!def) return undefined;
    return def.body.nodes
      .filter((n) => n.type === 'compound-output')
      .map((n) => n.id);
  }
  return undefined;
}

/**
 * Input ports on a node. Currently only compound instances have named input
 * ports — every other consumer type has a single implicit input.
 */
export function getInputPorts(
  typeId: NodeTypeId,
  node?: { compoundTypeId?: string },
  compoundTypes?: CompoundTypeDefinition[],
): InputPortId[] | undefined {
  if (typeId === 'compound' && node?.compoundTypeId && compoundTypes) {
    const def = compoundTypes.find((c) => c.id === node.compoundTypeId);
    if (!def) return undefined;
    return def.body.nodes
      .filter((n) => n.type === 'compound-input')
      .map((n) => n.id);
  }
  return undefined;
}

/**
 * Look up the display label for a compound port (input or output).
 * Falls back to the raw port ID if the compound type or node is not found.
 */
export function getPortLabel(
  portId: string,
  node: { compoundTypeId?: string },
  compoundTypes: CompoundTypeDefinition[],
): string {
  if (!node.compoundTypeId) return portId;
  const def = compoundTypes.find((c) => c.id === node.compoundTypeId);
  const anchor = def?.body.nodes.find((n) => n.id === portId);
  return anchor?.label ?? portId;
}

/** Type guard for runtime `fromPort` values loaded from persisted diagrams. */
export function isValidOutputPort(
  typeId: NodeTypeId,
  value: unknown,
  node?: { compoundTypeId?: string },
  compoundTypes?: CompoundTypeDefinition[],
): value is OutputPortId {
  const ports = getOutputPorts(typeId, node, compoundTypes);
  return ports !== undefined && typeof value === 'string' && (ports as string[]).includes(value);
}

export const NODE_TYPES: NodeTypeDefinition[] = [
  { id: 'sensor-analog', kind: 'sensor', displayName: 'Analog Sensor', metaLabel: 'analog', protocol: 'analog', pinFields: ['arduinoPort'] },
  { id: 'sensor-digital', kind: 'sensor', displayName: 'Digital Sensor', metaLabel: 'digital', protocol: 'digital', pinFields: ['arduinoPort'] },
  { id: 'sensor-color', kind: 'sensor', displayName: 'Color Sensor', metaLabel: 'TCS34725', protocol: 'i2c' },
  { id: 'sensor-tof', kind: 'sensor', displayName: 'ToF Distance', metaLabel: 'VL53L4CD', protocol: 'i2c', pinFields: ['xshutPin'] },
  { id: 'compute-threshold', kind: 'compute', displayName: 'Threshold', metaLabel: 'threshold', mode: 'threshold', hasInputs: true, maxInputs: 1 },
  { id: 'compute-delay', kind: 'compute', displayName: 'Delay', metaLabel: 'delay', mode: 'delay', hasInputs: true, maxInputs: 1, breaksCycles: true },
  { id: 'compute-summation', kind: 'compute', displayName: 'Summation', metaLabel: 'sum', mode: 'summation', hasInputs: true },
  { id: 'compute-multiply', kind: 'compute', displayName: 'Multiply', metaLabel: 'multiply', mode: 'multiply', hasInputs: true },
  { id: 'compute-min', kind: 'compute', displayName: 'Minimum', metaLabel: 'min', mode: 'min', hasInputs: true },
  { id: 'compute-max', kind: 'compute', displayName: 'Maximum', metaLabel: 'max', mode: 'max', hasInputs: true },
  { id: 'compute-oscillator', kind: 'compute', displayName: 'Oscillator', metaLabel: 'oscillator', mode: 'oscillator' },
  { id: 'compute-noise', kind: 'compute', displayName: 'Noise', metaLabel: 'noise', mode: 'noise' },
  { id: 'constant', kind: 'constant', displayName: 'Constant', metaLabel: 'constant' },
  { id: 'servo-cr', kind: 'output', displayName: 'Continuous Servo', metaLabel: 'continuous servo', pinFields: ['servoPin'], hasInputs: true, maxInputs: 1 },
  { id: 'servo-positional', kind: 'output', displayName: 'Positional Servo', metaLabel: 'positional servo', pinFields: ['servoPin'], hasInputs: true, maxInputs: 1 },
  { id: 'digital-out', kind: 'output', displayName: 'Digital Output', metaLabel: 'digital out', pinFields: ['servoPin'], hasInputs: true, maxInputs: 1 },
  { id: 'display-tm1637', kind: 'output', displayName: '7-Segment Display', metaLabel: 'TM1637 4-digit', pinFields: ['clkPin', 'gpioPin'], hasInputs: true, maxInputs: 1 },
  // Compound instance — a placeholder node whose ports and behavior are defined by a CompoundTypeDefinition.
  { id: 'compound', kind: 'compound', displayName: 'Compound', metaLabel: 'compound', hasInputs: true },
  // Port anchors — only legal inside a compound body.
  { id: 'compound-input', kind: 'port', displayName: 'Compound Input', metaLabel: 'input port', bodyOnly: true },
  { id: 'compound-output', kind: 'port', displayName: 'Compound Output', metaLabel: 'output port', bodyOnly: true, hasInputs: true, maxInputs: 1 },
];

export const TYPE_BY_ID = Object.fromEntries(
  NODE_TYPES.map((nodeType) => [nodeType.id, nodeType] as const),
) as Record<NodeTypeId, NodeTypeDefinition>;
