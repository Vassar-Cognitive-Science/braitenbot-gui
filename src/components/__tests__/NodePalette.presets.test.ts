/**
 * Guard: ToF presets encode physical XSHUT wiring. A label/pin swap would
 * misdirect students building the kit, so we pin the mapping here.
 */
import { describe, it, expect } from 'vitest';
import { KIT_SENSORS } from '../palettePresets';

describe('KIT_SENSORS ToF presets', () => {
  it('Left ToF Distance is wired to XSHUT pin 8', () => {
    const preset = KIT_SENSORS.find((p) => p.label === 'Left ToF Distance');
    expect(preset).toBeDefined();
    expect(preset?.params?.xshutPin).toBe('8');
  });

  it('Right ToF Distance is wired to XSHUT pin 12', () => {
    const preset = KIT_SENSORS.find((p) => p.label === 'Right ToF Distance');
    expect(preset).toBeDefined();
    expect(preset?.params?.xshutPin).toBe('12');
  });

  it('no preset is labelled with the old names', () => {
    const labels = KIT_SENSORS.map((p) => p.label);
    expect(labels).not.toContain('ToF Distance 1');
    expect(labels).not.toContain('ToF Distance 2');
  });
});
