import type { SerialState, VehicleWeights } from '../types';

interface ArduinoPanelProps {
  serialState: SerialState;
  weights: VehicleWeights;
  onUpload: () => void;
  serialSupported: boolean;
}

/**
 * Panel shown at the bottom of the editor, enabling the user to upload the
 * current vehicle weights to a connected Arduino.
 */
export function ArduinoPanel({
  serialState,
  weights,
  onUpload,
  serialSupported,
}: ArduinoPanelProps) {
  const isConnected = serialState.status === 'connected';

  const payloadPreview = JSON.stringify({
    ll: round3(weights.ll),
    lr: round3(weights.lr),
    rl: round3(weights.rl),
    rr: round3(weights.rr),
  });

  return (
    <div className="arduino-panel">
      <div className="arduino-panel-left">
        <span className="arduino-label">Upload to Arduino</span>
        <code className="arduino-payload">{payloadPreview}</code>
      </div>
      <button
        className="btn btn-upload"
        onClick={onUpload}
        disabled={!isConnected || !serialSupported}
        title={
          !serialSupported
            ? 'Web Serial API not supported in this browser'
            : !isConnected
              ? 'Connect to an Arduino first'
              : 'Send current weights to the Arduino'
        }
      >
        ⚡ Upload
      </button>
    </div>
  );
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
