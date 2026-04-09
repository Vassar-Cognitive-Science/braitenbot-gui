export * from './diagram';

/** Connection weights for a Braitenberg vehicle.
 * Each weight represents a sensor-to-motor connection.
 * Positive = excitatory, negative = inhibitory, zero = no connection.
 */
export interface VehicleWeights {
  /** Left sensor → Left motor */
  ll: number;
  /** Left sensor → Right motor */
  lr: number;
  /** Right sensor → Left motor */
  rl: number;
  /** Right sensor → Right motor */
  rr: number;
}

export interface VehiclePreset {
  id: string;
  name: string;
  description: string;
  weights: VehicleWeights;
}

export interface VehicleState {
  weights: VehicleWeights;
  activePreset: string | null;
}

export type SerialStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface SerialState {
  status: SerialStatus;
  error: string | null;
}
