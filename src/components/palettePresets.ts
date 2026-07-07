import type { DiagramNode, NodeTypeId } from '../types/diagram';

// ---- Kit presets -----------------------------------------------------------

/**
 * A Basic-tab preset: a friendly kit name that drops a normal node of an
 * existing type with its pins/params pre-filled to match the reference build
 * (see docs/docs/hardware/assembly.md). `kind` selects the accent color;
 * `meta` is the small pin label shown under the name.
 */
export interface KitPreset {
  key: string;
  type: NodeTypeId;
  label: string;
  meta: string;
  kind: 'sensor' | 'output';
  params?: Partial<DiagramNode>;
}

export const KIT_SENSORS: KitPreset[] = [
  { key: 'photocell-left', type: 'sensor-analog', label: 'Left Photocell', meta: 'A0', kind: 'sensor', params: { arduinoPort: 'A0' } },
  { key: 'photocell-right', type: 'sensor-analog', label: 'Right Photocell', meta: 'A1', kind: 'sensor', params: { arduinoPort: 'A1' } },
  { key: 'bump-fl', type: 'sensor-digital', label: 'Bump Front-Left', meta: 'D2', kind: 'sensor', params: { arduinoPort: '2', pullup: true } },
  { key: 'bump-fr', type: 'sensor-digital', label: 'Bump Front-Right', meta: 'D3', kind: 'sensor', params: { arduinoPort: '3', pullup: true } },
  { key: 'bump-rl', type: 'sensor-digital', label: 'Bump Rear-Left', meta: 'D4', kind: 'sensor', params: { arduinoPort: '4', pullup: true } },
  { key: 'bump-rr', type: 'sensor-digital', label: 'Bump Rear-Right', meta: 'D7', kind: 'sensor', params: { arduinoPort: '7', pullup: true } },
  { key: 'color', type: 'sensor-color', label: 'Color Sensor', meta: 'I2C', kind: 'sensor' },
  { key: 'tof-1', type: 'sensor-tof', label: 'Left ToF Distance', meta: 'XSHUT D8', kind: 'sensor', params: { xshutPin: '8' } },
  { key: 'tof-2', type: 'sensor-tof', label: 'Right ToF Distance', meta: 'XSHUT D12', kind: 'sensor', params: { xshutPin: '12' } },
];

export const KIT_OUTPUTS: KitPreset[] = [
  { key: 'display', type: 'display-tm1637', label: '7-Segment Display', meta: 'CLK D9 / DIO D10', kind: 'output', params: { clkPin: '9', gpioPin: '10' } },
];

/** Generic starter compute nodes shown on the Basic tab (no preset params). */
export const BASIC_COMPUTE_TYPES: NodeTypeId[] = ['compute-threshold', 'compute-summation', 'compute-multiply', 'compute-delay'];
