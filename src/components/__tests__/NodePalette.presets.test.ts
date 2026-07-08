/**
 * Guard: ToF presets encode physical XSHUT wiring. A label/pin swap would
 * misdirect students building the kit, so we pin the mapping here.
 */
import { describe, it, expect } from 'vitest';
import { KIT_SENSORS, BASIC_COMPUTE_TYPES } from '../palettePresets';
import { NODE_TYPES } from '../../types/diagram';

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

describe('min / max compute nodes', () => {
  it('are registered as compute node types', () => {
    const ids = NODE_TYPES.map((n) => n.id);
    expect(ids).toContain('compute-min');
    expect(ids).toContain('compute-max');
    for (const id of ['compute-min', 'compute-max'] as const) {
      const def = NODE_TYPES.find((n) => n.id === id)!;
      expect(def.kind).toBe('compute');
      expect(def.hasInputs).toBe(true);
      // Unbounded inputs — they reduce over any number of edges.
      expect(def.maxInputs).toBeUndefined();
    }
  });

  it('are Advanced-palette only (not offered on the Basic tab)', () => {
    expect(BASIC_COMPUTE_TYPES).not.toContain('compute-min');
    expect(BASIC_COMPUTE_TYPES).not.toContain('compute-max');
  });
});
