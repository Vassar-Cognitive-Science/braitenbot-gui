import { useEffect, useRef } from 'react';
import type { AppSettings, UpdateAppSettings } from '../settings/appSettings';
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
  settings: AppSettings;
  onChange: UpdateAppSettings;
  /** Loop period of the current diagram (ms). A per-diagram document value,
   *  surfaced here rather than in AppSettings. */
  loopPeriodMs: number;
  onLoopPeriodChange: (value: number) => void;
}

/**
 * App preferences dialog, opened from the in-app gear button (or the native
 * "Settings…" menu item on macOS). Holds cross-diagram app settings (see
 * AppSettings) plus the current diagram's sketch loop period.
 */
export function SettingsModal({
  open,
  onClose,
  settings,
  onChange,
  loopPeriodMs,
  onLoopPeriodChange,
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

        <div className="settings-section">
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={settings.capWeights}
              onChange={(e) => onChange({ capWeights: e.target.checked })}
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
                periods react faster; longer periods are steadier. Saved with the
                diagram.
              </span>
            </span>
            <span className="settings-field-control">
              <NumberInput
                min={1}
                max={1000}
                step={1}
                integer
                value={loopPeriodMs}
                onChange={onLoopPeriodChange}
              />
              <span className="settings-field-unit">ms</span>
            </span>
          </label>
        </div>
      </div>
    </dialog>
  );
}
