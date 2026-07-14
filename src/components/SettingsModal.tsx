import { useEffect, useRef } from 'react';
import type { AppSettings, UpdateAppSettings } from '../settings/appSettings';
import { DEFAULT_RELAY_URL } from '../collab/config';
import { NumberInput } from './NumberInput';

/**
 * Drive a native <dialog>'s modal state from a React `open` boolean, opening
 * with showModal() and closing with close() as it changes. Mirrors the helper
 * in dialogs.tsx.
 */
function useDialogOpen(open: boolean) {
  const ref = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);
  return ref;
}

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  /** Personal, per-device preferences (localStorage). Never shared. */
  settings: AppSettings;
  onChange: UpdateAppSettings;
  /** Diagram preferences below live in the shared diagram document: they sync
   *  live (host-determined), save with the diagram, and are read-only for a
   *  view-only guest. */
  capWeights: boolean;
  onCapWeightsChange: (value: boolean) => void;
  loopPeriodMs: number;
  onLoopPeriodChange: (value: number) => void;
  pulseDurationMs: number;
  onPulseDurationChange: (value: number) => void;
  /** True for a view-only guest, who can't change the host's diagram prefs. */
  diagramReadOnly: boolean;
}

/**
 * App preferences dialog, opened from the toolbar gear (or the native
 * "Settings…" menu item). Split into two groups: personal, per-device
 * preferences (AppSettings, localStorage — each participant keeps their own)
 * and diagram preferences (stored in the shared diagram document, so the host
 * determines them for everyone in a live session and they save with the file).
 */
export function SettingsModal({
  open,
  onClose,
  settings,
  onChange,
  capWeights,
  onCapWeightsChange,
  loopPeriodMs,
  onLoopPeriodChange,
  pulseDurationMs,
  onPulseDurationChange,
  diagramReadOnly,
}: SettingsModalProps) {
  const dialogRef = useDialogOpen(open);
  return (
    <dialog
      ref={dialogRef}
      className="settings-dialog"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
    >
      <div className="settings-dialog-inner">
        <div className="code-dialog-header">
          <h2>Settings</h2>
          <button type="button" className="config-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <h3 className="settings-group-title">Personal preferences</h3>
        <p className="settings-group-hint">Yours only — kept per device, never shared.</p>

        <div className="settings-section">
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={settings.autoSelectIdentifiedBoard}
              onChange={(e) => onChange({ autoSelectIdentifiedBoard: e.target.checked })}
            />
            <span className="settings-toggle-text">
              <span className="settings-toggle-label">Auto-select an identified board</span>
              <span className="settings-toggle-hint">
                When the current board picker selection is an unidentified port,
                switch to a newly detected board with a known type (FQBN)
                automatically. Turn off to keep whatever board you picked.
              </span>
            </span>
          </label>
        </div>

        <div className="settings-section">
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={settings.advancedWeightViz}
              onChange={(e) => onChange({ advancedWeightViz: e.target.checked })}
            />
            <span className="settings-toggle-text">
              <span className="settings-toggle-label">Advanced weight visualization</span>
              <span className="settings-toggle-hint">
                In trace mode, show the full calculation on each connection —
                input × weight = output (or input ↝ output for a transfer
                curve) — instead of just the resulting signal value.
              </span>
            </span>
          </label>
        </div>

        <h3 className="settings-group-title">Diagram preferences</h3>
        <p className="settings-group-hint">
          {diagramReadOnly
            ? 'Set by the host — read-only while you have view-only access.'
            : 'Saved with the diagram and shared live (the host controls them).'}
        </p>

        <div className="settings-section">
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={capWeights}
              disabled={diagramReadOnly}
              onChange={(e) => onCapWeightsChange(e.target.checked)}
            />
            <span className="settings-toggle-text">
              <span className="settings-toggle-label">Cap connection weights to −1 … 1</span>
              <span className="settings-toggle-hint">
                The conventional Braitenberg range. Turn this off to set any
                weight value on a connection. Existing weights are left as-is.
              </span>
            </span>
          </label>
        </div>

        <div className="settings-section">
          <label className="settings-field">
            <span className="settings-toggle-text">
              <span className="settings-toggle-label">Sketch loop period</span>
              <span className="settings-toggle-hint">
                Delay between sensor reads in the generated Arduino loop. Shorter
                periods react faster; longer periods are steadier.
              </span>
            </span>
            <span className="settings-field-control">
              <NumberInput
                min={1}
                max={1000}
                step={1}
                integer
                value={loopPeriodMs}
                disabled={diagramReadOnly}
                onChange={onLoopPeriodChange}
              />
              <span className="settings-field-unit">ms</span>
            </span>
          </label>
        </div>

        <div className="settings-section">
          <label className="settings-field">
            <span className="settings-toggle-text">
              <span className="settings-toggle-label">Trace pulse duration</span>
              <span className="settings-toggle-hint">
                How long the ▶ pulse button holds a sensor at full value in trace
                mode. Longer pulses are easier to watch propagate through the
                diagram.
              </span>
            </span>
            <span className="settings-field-control">
              <NumberInput
                min={10}
                max={5000}
                step={10}
                integer
                value={pulseDurationMs}
                disabled={diagramReadOnly}
                onChange={onPulseDurationChange}
              />
              <span className="settings-field-unit">ms</span>
            </span>
          </label>
        </div>

        <details className="settings-advanced">
          <summary>Advanced</summary>
          <div className="settings-section">
            <label className="settings-field settings-field-stacked">
              <span className="settings-toggle-text">
                <span className="settings-toggle-label">Collaboration relay URL</span>
                <span className="settings-toggle-hint">
                  The server that carries live sessions. Leave blank to use the
                  built-in relay. Point this at your own self-hosted relay (a{' '}
                  <code>ws://</code> or <code>wss://</code> URL) to keep session
                  traffic on your own infrastructure. Applies the next time you
                  host or join.
                </span>
              </span>
              <input
                type="text"
                className="settings-text-input"
                inputMode="url"
                spellCheck={false}
                autoComplete="off"
                placeholder={DEFAULT_RELAY_URL}
                value={settings.relayUrl}
                onChange={(e) => onChange({ relayUrl: e.target.value })}
              />
            </label>
          </div>
        </details>
      </div>
    </dialog>
  );
}
