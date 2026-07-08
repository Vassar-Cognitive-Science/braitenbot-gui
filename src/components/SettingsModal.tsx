import { useEffect, useRef } from 'react';
import type { AppSettings, UpdateAppSettings } from '../settings/appSettings';

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
}

/**
 * App preferences dialog, opened from the native "Settings…" menu item. Holds
 * cross-diagram settings (see AppSettings) rather than anything tied to the
 * current diagram document.
 */
export function SettingsModal({ open, onClose, settings, onChange }: SettingsModalProps) {
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
      </div>
    </dialog>
  );
}
