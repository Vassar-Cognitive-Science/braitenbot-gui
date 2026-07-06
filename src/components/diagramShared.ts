import type { NodeTypeDefinition, SensorProtocol } from '../types/diagram';

/** The node or connection currently shown in the configuration panel. */
export interface ConfigTarget {
  kind: 'node' | 'connection';
  id: string;
}

export const ANALOG_PORT_PLACEHOLDER = 'A0';
export const DIGITAL_PORT_PLACEHOLDER = '2';
export const MOTOR_PIN_PLACEHOLDER = '9';
export const SERVO_PIN_PLACEHOLDER = '10';
export const DIGITAL_OUT_PIN_PLACEHOLDER = '13';
export const TM1637_CLK_PLACEHOLDER = '2';
export const TM1637_GPIO_PLACEHOLDER = '3';
export const TOF_XSHUT_PLACEHOLDER = '4';
export const TM1637_DEFAULT_BRIGHTNESS = 3;

export function canOutput(nodeType: NodeTypeDefinition): boolean {
  // compound-output is a body-only sink — it receives values inside the
  // body but exposes nothing inside the body itself.
  if (nodeType.id === 'compound-output') return false;
  return nodeType.kind !== 'output';
}

export function canInput(nodeType: NodeTypeDefinition): boolean {
  // compound-input is a body-only source — it produces values inside the
  // body but accepts nothing from the body itself.
  if (nodeType.id === 'compound-input') return false;
  return nodeType.kind !== 'sensor' && nodeType.kind !== 'constant';
}

export function supportsArduinoPort(nodeType: NodeTypeDefinition): boolean {
  return nodeType.kind === 'sensor' && (nodeType.protocol === 'analog' || nodeType.protocol === 'digital');
}

export function getArduinoPortPlaceholder(protocol?: SensorProtocol): string {
  return protocol === 'analog' ? ANALOG_PORT_PLACEHOLDER : DIGITAL_PORT_PLACEHOLDER;
}

export function clampWeight(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

export function isWheelNode(id: string): boolean {
  return id === 'motor-left' || id === 'motor-right';
}
