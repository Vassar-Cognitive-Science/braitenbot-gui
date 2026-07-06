import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_PRIMARY_ACTION,
  PRIMARY_ACTION_STORAGE_KEY,
  isPrimaryAction,
  loadPrimaryAction,
  savePrimaryAction,
} from '../primaryAction';

// Vitest runs in the node environment here, which has no localStorage. Provide
// a tiny in-memory stand-in so the persistence helpers are exercised for real.
beforeAll(() => {
  if (typeof globalThis.localStorage === 'undefined') {
    const store = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    } as Storage;
  }
});

afterEach(() => {
  localStorage.clear();
});

describe('primaryAction persistence', () => {
  it('defaults to upload when nothing is stored', () => {
    expect(DEFAULT_PRIMARY_ACTION).toBe('upload');
    expect(loadPrimaryAction()).toBe('upload');
  });

  it('round-trips a saved choice through localStorage', () => {
    savePrimaryAction('generate');
    expect(localStorage.getItem(PRIMARY_ACTION_STORAGE_KEY)).toBe('generate');
    expect(loadPrimaryAction()).toBe('generate');

    savePrimaryAction('upload');
    expect(loadPrimaryAction()).toBe('upload');
  });

  it('falls back to the default for an invalid stored value', () => {
    localStorage.setItem(PRIMARY_ACTION_STORAGE_KEY, 'nonsense');
    expect(loadPrimaryAction()).toBe(DEFAULT_PRIMARY_ACTION);
  });

  it('validates action values', () => {
    expect(isPrimaryAction('upload')).toBe(true);
    expect(isPrimaryAction('generate')).toBe(true);
    expect(isPrimaryAction('')).toBe(false);
    expect(isPrimaryAction(null)).toBe(false);
    expect(isPrimaryAction(42)).toBe(false);
  });
});
