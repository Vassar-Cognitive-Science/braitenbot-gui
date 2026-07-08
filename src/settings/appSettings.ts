import { useCallback, useState } from 'react';

/**
 * App-wide preferences that persist across diagrams and sessions (as opposed
 * to the diagram document itself). Stored in localStorage, independent of the
 * diagram so switching or clearing a diagram never touches them.
 */
export interface AppSettings {
  /**
   * When true (default), connection weights are constrained to the
   * conventional Braitenberg range of [-1, 1]. Turn it off to author
   * arbitrary weights (any min/max) — useful for experiments that need
   * stronger-than-unit coupling.
   */
  capWeights: boolean;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  capWeights: true,
};

const STORAGE_KEY = 'braitenbot-gui:settings:v1';

export function loadAppSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_APP_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    // Read known keys explicitly so an unexpected shape falls back cleanly.
    return {
      capWeights:
        typeof parsed.capWeights === 'boolean'
          ? parsed.capWeights
          : DEFAULT_APP_SETTINGS.capWeights,
    };
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

export function saveAppSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Best-effort — a full/blocked localStorage just means the preference
    // won't persist past this session.
  }
}

export type UpdateAppSettings = (patch: Partial<AppSettings>) => void;

/**
 * Stateful accessor for the app settings, seeded from localStorage and
 * persisted on every change. Returns the current settings plus a patch
 * updater.
 */
export function useAppSettings(): [AppSettings, UpdateAppSettings] {
  const [settings, setSettings] = useState<AppSettings>(loadAppSettings);
  const update = useCallback<UpdateAppSettings>((patch) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveAppSettings(next);
      return next;
    });
  }, []);
  return [settings, update];
}
