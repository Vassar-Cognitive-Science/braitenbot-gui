import { useState, useCallback } from 'react';
import type { VehiclePreset, VehicleState, VehicleWeights } from '../types';

/** Preset Braitenberg vehicle configurations. */
export const VEHICLE_PRESETS: VehiclePreset[] = [
  {
    id: 'coward',
    name: 'Vehicle 2a – Coward',
    description:
      'Uncrossed excitatory connections. Steers away from the light source.',
    weights: { ll: 0.8, lr: 0, rl: 0, rr: 0.8 },
  },
  {
    id: 'aggressor',
    name: 'Vehicle 2b – Aggressor',
    description:
      'Crossed excitatory connections. Charges straight toward the light source.',
    weights: { ll: 0, lr: 0.8, rl: 0.8, rr: 0 },
  },
  {
    id: 'lover',
    name: 'Vehicle 3a – Lover',
    description:
      'Uncrossed inhibitory connections. Seeks the light and slows to a stop near it.',
    weights: { ll: -0.8, lr: 0, rl: 0, rr: -0.8 },
  },
  {
    id: 'explorer',
    name: 'Vehicle 3b – Explorer',
    description:
      'Crossed inhibitory connections. Avoids the light and wanders freely.',
    weights: { ll: 0, lr: -0.8, rl: -0.8, rr: 0 },
  },
];

const INITIAL_WEIGHTS: VehicleWeights = VEHICLE_PRESETS[0].weights;

/**
 * Custom hook that manages the active vehicle's connection weights and the
 * currently selected preset.
 */
export function useVehicle() {
  const [state, setState] = useState<VehicleState>({
    weights: INITIAL_WEIGHTS,
    activePreset: VEHICLE_PRESETS[0].id,
  });

  const setWeights = useCallback((weights: VehicleWeights) => {
    setState({ weights, activePreset: null });
  }, []);

  const setWeight = useCallback(
    (key: keyof VehicleWeights, value: number) => {
      setState((prev) => ({
        weights: { ...prev.weights, [key]: value },
        activePreset: null,
      }));
    },
    [],
  );

  const applyPreset = useCallback((preset: VehiclePreset) => {
    setState({ weights: preset.weights, activePreset: preset.id });
  }, []);

  return { state, setWeights, setWeight, applyPreset };
}
