import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_APP_SETTINGS,
  loadAppSettings,
  saveAppSettings,
} from '../appSettings';

/** Minimal in-memory localStorage stand-in (tests run in Node, no DOM). */
function installLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
  return store;
}

describe('appSettings persistence', () => {
  beforeEach(() => {
    installLocalStorage();
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it('defaults to capped weights when nothing is stored', () => {
    expect(loadAppSettings()).toEqual(DEFAULT_APP_SETTINGS);
    expect(DEFAULT_APP_SETTINGS.capWeights).toBe(true);
  });

  it('round-trips a saved setting', () => {
    saveAppSettings({ capWeights: false, pulseDurationMs: 350 });
    expect(loadAppSettings().capWeights).toBe(false);
    expect(loadAppSettings().pulseDurationMs).toBe(350);
  });

  it('falls back to the default on malformed JSON', () => {
    localStorage.setItem('braitenbot-gui:settings:v1', '{not json');
    expect(loadAppSettings()).toEqual(DEFAULT_APP_SETTINGS);
  });

  it('falls back to the default when a known key has the wrong type', () => {
    localStorage.setItem('braitenbot-gui:settings:v1', JSON.stringify({ capWeights: 'nope' }));
    expect(loadAppSettings().capWeights).toBe(DEFAULT_APP_SETTINGS.capWeights);
  });

  it('returns the default when localStorage is unavailable', () => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    expect(loadAppSettings()).toEqual(DEFAULT_APP_SETTINGS);
  });
});
