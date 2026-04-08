import type { VehiclePreset } from '../types';
import { VEHICLE_PRESETS } from '../hooks/useVehicle';

interface VehiclePresetsProps {
  activePreset: string | null;
  onSelect: (preset: VehiclePreset) => void;
}

/** Preset-selector row showing all four canonical Braitenberg vehicle types. */
export function VehiclePresets({ activePreset, onSelect }: VehiclePresetsProps) {
  return (
    <div className="presets-section">
      <h2 className="section-title">Presets</h2>
      <div className="presets-grid">
        {VEHICLE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            className={`preset-btn ${activePreset === preset.id ? 'preset-btn--active' : ''}`}
            onClick={() => onSelect(preset)}
            title={preset.description}
          >
            <span className="preset-name">{preset.name}</span>
            <span className="preset-desc">{preset.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
