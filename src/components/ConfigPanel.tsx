import { useCallback, useEffect } from 'react';
import type { DiagramConnection, DiagramNode, TransferPoint } from '../types/diagram';
import { TYPE_BY_ID, COLOR_GAINS, DEFAULT_COLOR_GAIN, DEFAULT_TOF_MAX_MM } from '../types/diagram';
import type { DiagramStore } from '../doc/DiagramStore';
import { TransferCurveEditor } from './TransferCurveEditor';
import { NumberInput } from './NumberInput';
import {
  clampWeight,
  getArduinoPortPlaceholder,
  isWheelNode,
  supportsArduinoPort,
  DIGITAL_OUT_PIN_PLACEHOLDER,
  MOTOR_PIN_PLACEHOLDER,
  SERVO_PIN_PLACEHOLDER,
  TM1637_CLK_PLACEHOLDER,
  TM1637_GPIO_PLACEHOLDER,
  TOF_XSHUT_PLACEHOLDER,
  TM1637_DEFAULT_BRIGHTNESS,
} from './diagramShared';

interface ConfigPanelProps {
  selectedNode: DiagramNode | null;
  selectedConnection: DiagramConnection | null;
  hasTarget: boolean;
  store: DiagramStore;
  deleteNode: (id: string) => void;
  deleteConnection: (id: string) => void;
  onClose: () => void;
}

export function ConfigPanel({
  selectedNode,
  selectedConnection,
  hasTarget,
  store,
  deleteNode,
  deleteConnection,
  onClose,
}: ConfigPanelProps) {
  // One undo entry per config-target "session". A session begins when the
  // selected target changes (including after an undo/redo, which clears the
  // selection). stopCapturing() at that boundary starts a fresh undo item, so
  // the many onChange calls of a single slider/curve drag merge into one entry.
  const targetId = selectedNode?.id ?? selectedConnection?.id ?? null;
  useEffect(() => {
    store.stopCapturing();
  }, [store, targetId]);

  const patchNode = useCallback(
    (id: string, patch: Partial<DiagramNode>) => {
      store.patchNode(id, patch);
    },
    [store],
  );

  const patchConnection = useCallback(
    (id: string, patch: Partial<DiagramConnection>) => {
      store.patchConnection(id, patch);
    },
    [store],
  );

  return (
    <aside className="diagram-config-panel" onMouseDown={(event) => event.stopPropagation()}>
      <div className="config-header">
        <h3>Configuration</h3>
        {hasTarget && (
          <button className="config-close" onClick={onClose} aria-label="Close configuration">
            ✕
          </button>
        )}
      </div>

      {!selectedNode && !selectedConnection && (
        <p className="config-empty">Select a node or connection to configure it.</p>
      )}

      {selectedNode && (
        <div className="config-section">
          <p className="config-description">
            {TYPE_BY_ID[selectedNode.type].kind === 'sensor' &&
              'Reads input from a physical sensor on the robot and outputs a signal to connected nodes.'}
            {TYPE_BY_ID[selectedNode.type].kind === 'compute' &&
              TYPE_BY_ID[selectedNode.type].mode === 'threshold' &&
              'Outputs 1 when the combined input exceeds the threshold, otherwise 0. Acts as an on/off switch.'}
            {TYPE_BY_ID[selectedNode.type].kind === 'compute' &&
              TYPE_BY_ID[selectedNode.type].mode === 'delay' &&
              'Delays the input signal by the configured number of milliseconds before passing it on.'}
            {TYPE_BY_ID[selectedNode.type].kind === 'compute' &&
              TYPE_BY_ID[selectedNode.type].mode === 'summation' &&
              'Sums all weighted input signals and outputs the total.'}
            {TYPE_BY_ID[selectedNode.type].kind === 'compute' &&
              TYPE_BY_ID[selectedNode.type].mode === 'multiply' &&
              'Multiplies all incoming signals together. When one input is 0 or 1, it acts as a gate: the other signal passes through when the gate is on, and zero when the gate is off.'}
            {TYPE_BY_ID[selectedNode.type].kind === 'compute' &&
              TYPE_BY_ID[selectedNode.type].mode === 'min' &&
              'Outputs the smallest of its incoming (weighted) signals. Useful for "respond to the nearest/weakest" behaviors, or as a ceiling when one input is a constant.'}
            {TYPE_BY_ID[selectedNode.type].kind === 'compute' &&
              TYPE_BY_ID[selectedNode.type].mode === 'max' &&
              'Outputs the largest of its incoming (weighted) signals. Useful for "respond to the strongest" behaviors, or as a floor when one input is a constant.'}
            {TYPE_BY_ID[selectedNode.type].kind === 'compute' &&
              TYPE_BY_ID[selectedNode.type].mode === 'oscillator' &&
              'Generates a sine wave that oscillates over time. Useful as a central pattern generator for rhythmic motor behavior. Output ranges from -amplitude to +amplitude.'}
            {TYPE_BY_ID[selectedNode.type].kind === 'compute' &&
              TYPE_BY_ID[selectedNode.type].mode === 'noise' &&
              'Emits a fresh uniform random value every loop iteration. Useful for adding exploration or jitter to motor behavior. Output ranges from -amplitude to +amplitude.'}
            {TYPE_BY_ID[selectedNode.type].kind === 'constant' &&
              'Emits a fixed constant value to all connected nodes.'}
            {selectedNode.type === 'servo-cr' && isWheelNode(selectedNode.id) &&
              'Drives a wheel of the robot as a continuous-rotation servo on a single PWM pin. Speed and direction are determined by incoming connection weights; the right wheel is inverted automatically to account for mirrored mounting.'}
            {selectedNode.type === 'servo-cr' && !isWheelNode(selectedNode.id) &&
              'Continuous-rotation servo. The input signal (-100 to 100) is mapped to signed speed via writeMicroseconds (1500 ± 500 µs).'}
            {selectedNode.type === 'servo-positional' &&
              'Positional servo. The input signal (-100 to 100) is mapped to an angle (0° to 180°).'}
            {selectedNode.type === 'digital-out' &&
              'Digital output pin (e.g. an LED). Drives the pin HIGH when the aggregated input exceeds the threshold, otherwise LOW. Useful for showing internal state externally.'}
            {selectedNode.type === 'display-tm1637' &&
              'TM1637 4-digit 7-segment display. The aggregated input signal is rounded to the nearest integer, clamped to -999…9999, and shown on the display.'}
          </p>
          <label>
            Node Label
            <input
              type="text"
              value={selectedNode.label}
              onChange={(event) => {
                const newLabel = event.target.value;
                if (selectedNode.type === 'compound' && selectedNode.compoundTypeId) {
                  store.renameCompound(selectedNode.compoundTypeId, newLabel);
                } else {
                  patchNode(selectedNode.id, { label: newLabel });
                }
              }}
            />
          </label>

          {supportsArduinoPort(TYPE_BY_ID[selectedNode.type]) && (
            <label>
              Arduino Port
              <input
                type="text"
                value={selectedNode.arduinoPort ?? ''}
                placeholder={getArduinoPortPlaceholder(TYPE_BY_ID[selectedNode.type].protocol)}
                onChange={(event) =>
                  patchNode(selectedNode.id, { arduinoPort: event.target.value.trimStart() })
                }
              />
            </label>
          )}

          {selectedNode.type === 'sensor-digital' && (
            <label className="config-checkbox">
              <input
                type="checkbox"
                checked={selectedNode.pullup ?? false}
                onChange={(event) =>
                  patchNode(selectedNode.id, { pullup: event.target.checked })
                }
              />
              Enable INPUT_PULLUP
            </label>
          )}

          {selectedNode.type === 'sensor-analog' && (
            <label className="config-checkbox">
              <input
                type="checkbox"
                checked={selectedNode.invert ?? false}
                onChange={(event) =>
                  patchNode(selectedNode.id, { invert: event.target.checked })
                }
              />
              Invert signal
            </label>
          )}

          {selectedNode.type === 'sensor-color' && (
            <>
              <label>
                Gain
                <select
                  value={selectedNode.colorGain ?? DEFAULT_COLOR_GAIN}
                  onChange={(event) => {
                    const gain = Number(event.target.value);
                    patchNode(selectedNode.id, { colorGain: gain });
                  }}
                >
                  {COLOR_GAINS.map((g) => (
                    <option key={g} value={g}>
                      {g}×
                    </option>
                  ))}
                </select>
              </label>
              <p className="config-description">
                This sensor exposes four output anchors — clear, red, green, blue.
                Drag from the specific anchor to wire that channel. Raise the
                gain if readings are too low in dim light.
              </p>
            </>
          )}

          {selectedNode.type === 'sensor-tof' && (
            <>
              <label>
                XSHUT Pin
                <input
                  type="text"
                  value={selectedNode.xshutPin ?? ''}
                  placeholder={TOF_XSHUT_PLACEHOLDER}
                  onChange={(event) =>
                    patchNode(selectedNode.id, { xshutPin: event.target.value.trimStart() })
                  }
                />
              </label>
              <label>
                Max Distance (mm)
                <NumberInput
                  min={10}
                  max={4000}
                  step={10}
                  integer
                  value={selectedNode.maxDistanceMm ?? DEFAULT_TOF_MAX_MM}
                  onChange={(value) => patchNode(selectedNode.id, { maxDistanceMm: value })}
                />
              </label>
              <label className="config-checkbox">
                <input
                  type="checkbox"
                  checked={selectedNode.invert ?? false}
                  onChange={(event) =>
                    patchNode(selectedNode.id, { invert: event.target.checked })
                  }
                />
                Invert (far reads higher)
              </label>
              <p className="config-description">
                Distance sensor (VL53L4CD). By default a closer object reads
                higher, ramping to 0 at the max distance. Each ToF node needs
                its own XSHUT pin — they share the I2C bus, so the generated
                sketch brings them up one at a time and assigns each a unique
                address.
              </p>
            </>
          )}

          {TYPE_BY_ID[selectedNode.type].mode === 'threshold' && (
            <label>
              Threshold Value
              <NumberInput
                min={-100}
                max={100}
                step={1}
                value={selectedNode.threshold ?? 50}
                onChange={(value) => patchNode(selectedNode.id, { threshold: value })}
              />
            </label>
          )}

          {TYPE_BY_ID[selectedNode.type].mode === 'delay' && (
            <label>
              Delay (ms)
              <NumberInput
                min={0}
                max={10000}
                step={10}
                integer
                value={selectedNode.delayMs ?? 100}
                onChange={(value) => patchNode(selectedNode.id, { delayMs: value })}
              />
            </label>
          )}

          {TYPE_BY_ID[selectedNode.type].mode === 'oscillator' && (
            <>
              <label>
                Frequency (Hz)
                <NumberInput
                  min={0}
                  max={50}
                  step={0.1}
                  value={selectedNode.frequencyHz ?? 1.0}
                  onChange={(value) => patchNode(selectedNode.id, { frequencyHz: value })}
                />
              </label>
              <label>
                Amplitude
                <NumberInput
                  min={0}
                  max={100}
                  step={1}
                  value={selectedNode.amplitude ?? 100}
                  onChange={(value) => patchNode(selectedNode.id, { amplitude: value })}
                />
              </label>
            </>
          )}

          {TYPE_BY_ID[selectedNode.type].mode === 'noise' && (
            <label>
              Amplitude
              <NumberInput
                min={0}
                max={100}
                step={1}
                value={selectedNode.amplitude ?? 50}
                onChange={(value) => patchNode(selectedNode.id, { amplitude: value })}
              />
            </label>
          )}

          {TYPE_BY_ID[selectedNode.type].kind === 'constant' && (
            <label>
              Constant Value
              <NumberInput
                min={-100}
                max={100}
                step={1}
                value={selectedNode.constantValue ?? 0}
                onChange={(value) => patchNode(selectedNode.id, { constantValue: value })}
              />
            </label>
          )}

          {TYPE_BY_ID[selectedNode.type].kind === 'output' &&
            selectedNode.type !== 'display-tm1637' && (
            <label>
              {selectedNode.type === 'digital-out' ? 'Pin' : 'Servo Pin'}
              <input
                type="text"
                value={selectedNode.servoPin ?? ''}
                placeholder={
                  selectedNode.type === 'digital-out'
                    ? DIGITAL_OUT_PIN_PLACEHOLDER
                    : selectedNode.type === 'servo-cr'
                      ? MOTOR_PIN_PLACEHOLDER
                      : SERVO_PIN_PLACEHOLDER
                }
                onChange={(event) =>
                  patchNode(selectedNode.id, { servoPin: event.target.value.trimStart() })
                }
              />
            </label>
          )}

          {selectedNode.type === 'digital-out' && (
            <label>
              Threshold
              <NumberInput
                min={-100}
                max={100}
                step={1}
                value={selectedNode.threshold ?? 50}
                onChange={(value) => patchNode(selectedNode.id, { threshold: value })}
              />
            </label>
          )}

          {selectedNode.type === 'display-tm1637' && (
            <>
              <label>
                CLK Pin
                <input
                  type="text"
                  value={selectedNode.clkPin ?? ''}
                  placeholder={TM1637_CLK_PLACEHOLDER}
                  onChange={(event) =>
                    patchNode(selectedNode.id, { clkPin: event.target.value.trimStart() })
                  }
                />
              </label>
              <label>
                GPIO Pin
                <input
                  type="text"
                  value={selectedNode.gpioPin ?? ''}
                  placeholder={TM1637_GPIO_PLACEHOLDER}
                  onChange={(event) =>
                    patchNode(selectedNode.id, { gpioPin: event.target.value.trimStart() })
                  }
                />
              </label>
              <label>
                Brightness (0–7)
                <NumberInput
                  min={0}
                  max={7}
                  step={1}
                  integer
                  value={selectedNode.brightness ?? TM1637_DEFAULT_BRIGHTNESS}
                  onChange={(value) => patchNode(selectedNode.id, { brightness: value })}
                />
              </label>
            </>
          )}
          {!isWheelNode(selectedNode.id) && (
            <button
              className="config-delete"
              onClick={() => deleteNode(selectedNode.id)}
            >
              Delete Node
            </button>
          )}
        </div>
      )}

      {selectedConnection && (
        <div className="config-section">
          <label>
            Transfer Function
            <select
              value={selectedConnection.transferMode ?? 'linear'}
              onChange={(event) => {
                const mode = event.target.value as 'linear' | 'nonlinear';
                patchConnection(selectedConnection.id, {
                  transferMode: mode,
                  transferPoints: selectedConnection.transferPoints?.length
                    ? selectedConnection.transferPoints
                    : [{ x: -100, y: -100 }, { x: 100, y: 100 }],
                });
              }}
            >
              <option value="linear">Linear (weight)</option>
              <option value="nonlinear">Non-linear (curve)</option>
            </select>
          </label>

          {(selectedConnection.transferMode ?? 'linear') === 'linear' && (
            <>
              <label>
                Connection Weight
                <input
                  type="range"
                  min="-1"
                  max="1"
                  step="0.05"
                  value={selectedConnection.weight}
                  onChange={(event) => {
                    const value = clampWeight(parseFloat(event.target.value));
                    patchConnection(selectedConnection.id, { weight: value });
                  }}
                />
              </label>
              <label>
                Numeric Weight
                <NumberInput
                  min={-1}
                  max={1}
                  step={0.05}
                  value={selectedConnection.weight}
                  onChange={(value) => patchConnection(selectedConnection.id, { weight: value })}
                />
              </label>
            </>
          )}

          {selectedConnection.transferMode === 'nonlinear' && (
            <TransferCurveEditor
              points={selectedConnection.transferPoints ?? [{ x: -100, y: -100 }, { x: 100, y: 100 }]}
              onChange={(pts: TransferPoint[]) =>
                patchConnection(selectedConnection.id, { transferPoints: pts })
              }
            />
          )}

          <button
            className="config-delete"
            onClick={() => deleteConnection(selectedConnection.id)}
          >
            Delete Connection
          </button>
        </div>
      )}
    </aside>
  );
}
