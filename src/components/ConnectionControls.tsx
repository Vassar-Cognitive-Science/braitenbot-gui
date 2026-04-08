import type { VehicleWeights } from '../types';

interface ConnectionControlsProps {
  weights: VehicleWeights;
  onChange: (key: keyof VehicleWeights, value: number) => void;
}

type WeightKey = keyof VehicleWeights;

const WEIGHT_LABELS: Record<WeightKey, string> = {
  ll: 'Left Sensor → Left Motor',
  lr: 'Left Sensor → Right Motor',
  rl: 'Right Sensor → Left Motor',
  rr: 'Right Sensor → Right Motor',
};

const WEIGHT_SHORT: Record<WeightKey, string> = {
  ll: 'LL',
  lr: 'LR',
  rl: 'RL',
  rr: 'RR',
};

const WEIGHT_KEYS: WeightKey[] = ['ll', 'lr', 'rl', 'rr'];

/**
 * Four sliders (range −1 to +1) for editing each sensor-to-motor connection
 * weight of the Braitenberg vehicle.
 */
export function ConnectionControls({
  weights,
  onChange,
}: ConnectionControlsProps) {
  return (
    <div className="connection-controls">
      <h2 className="section-title">Connection Weights</h2>
      {WEIGHT_KEYS.map((key) => {
        const value = weights[key];
        const isExcitatory = value > 0.01;
        const isInhibitory = value < -0.01;
        const colorClass = isExcitatory
          ? 'weight-positive'
          : isInhibitory
            ? 'weight-negative'
            : 'weight-zero';

        return (
          <div key={key} className="weight-row">
            <div className="weight-header">
              <span className={`weight-badge ${colorClass}`}>
                {WEIGHT_SHORT[key]}
              </span>
              <span className="weight-label">{WEIGHT_LABELS[key]}</span>
              <span className={`weight-value ${colorClass}`}>
                {value >= 0 ? '+' : ''}
                {value.toFixed(2)}
              </span>
            </div>
            <div className="slider-row">
              <span className="slider-bound">−1</span>
              <input
                type="range"
                min="-1"
                max="1"
                step="0.05"
                value={value}
                aria-label={WEIGHT_LABELS[key]}
                onChange={(e) => onChange(key, parseFloat(e.target.value))}
                className={`weight-slider ${colorClass}`}
              />
              <span className="slider-bound">+1</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
