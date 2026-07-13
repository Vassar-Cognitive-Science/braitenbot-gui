import { useCallback, useState } from 'react';

/**
 * Personal, per-device preferences that persist across diagrams and sessions
 * (as opposed to the diagram document itself). Stored in localStorage,
 * independent of the diagram so switching or clearing a diagram never touches
 * them — and, unlike diagram preferences, they are never shared in a live
 * session: each participant keeps their own.
 */
export interface AppSettings {
  /**
   * When true (default), the board picker automatically switches to a newly
   * detected identified (known-FQBN) board if the current selection is an
   * unidentified port. Turn it off to keep whatever board you picked. A
   * per-device preference: it governs only your own board selection, so it
   * needs no sharing (web guests have no board picker at all).
   */
  autoSelectIdentifiedBoard: boolean;

  /**
   * Advanced: override the collaboration relay endpoint (a `ws://`/`wss://`
   * URL). Empty string — the default — means use the built-in relay
   * (`DEFAULT_RELAY_URL`). Set this to point at a self-hosted relay instead.
   * Per-device: it only affects sessions you start or join from this machine,
   * and takes effect the next time you host or join.
   */
  relayUrl: string;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  autoSelectIdentifiedBoard: true,
  relayUrl: '',
};

const STORAGE_KEY = 'braitenbot-gui:settings:v1';

export function loadAppSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_APP_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    // Read known keys explicitly so an unexpected shape falls back cleanly.
    return {
      autoSelectIdentifiedBoard:
        typeof parsed.autoSelectIdentifiedBoard === 'boolean'
          ? parsed.autoSelectIdentifiedBoard
          : DEFAULT_APP_SETTINGS.autoSelectIdentifiedBoard,
      relayUrl:
        typeof parsed.relayUrl === 'string'
          ? parsed.relayUrl
          : DEFAULT_APP_SETTINGS.relayUrl,
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
