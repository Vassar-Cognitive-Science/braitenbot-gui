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

  it('defaults to auto-selecting an identified board when nothing is stored', () => {
    expect(loadAppSettings()).toEqual(DEFAULT_APP_SETTINGS);
    expect(DEFAULT_APP_SETTINGS.autoSelectIdentifiedBoard).toBe(true);
  });

  it('round-trips a saved setting', () => {
    saveAppSettings({ autoSelectIdentifiedBoard: false, advancedWeightViz: false, relayUrl: '' });
    expect(loadAppSettings().autoSelectIdentifiedBoard).toBe(false);
  });

  it('defaults the relay URL to empty (use the built-in relay)', () => {
    expect(DEFAULT_APP_SETTINGS.relayUrl).toBe('');
  });

  it('round-trips a custom relay URL', () => {
    saveAppSettings({ autoSelectIdentifiedBoard: true, advancedWeightViz: false, relayUrl: 'ws://localhost:1234' });
    expect(loadAppSettings().relayUrl).toBe('ws://localhost:1234');
  });

  it('falls back to the default on malformed JSON', () => {
    localStorage.setItem('braitenbot-gui:settings:v1', '{not json');
    expect(loadAppSettings()).toEqual(DEFAULT_APP_SETTINGS);
  });

  it('falls back to the default when a known key has the wrong type', () => {
    localStorage.setItem(
      'braitenbot-gui:settings:v1',
      JSON.stringify({ autoSelectIdentifiedBoard: 'nope' }),
    );
    expect(loadAppSettings().autoSelectIdentifiedBoard).toBe(
      DEFAULT_APP_SETTINGS.autoSelectIdentifiedBoard,
    );
  });

  it('returns the default when localStorage is unavailable', () => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    expect(loadAppSettings()).toEqual(DEFAULT_APP_SETTINGS);
  });
});
