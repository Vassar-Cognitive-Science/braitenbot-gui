import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getRecents, recordRecent, RECENT_FILES_STORAGE_KEY } from '../recentFiles';

// Vitest runs in the node environment here, which has no localStorage. Provide
// a tiny in-memory stand-in so the persistence helpers are exercised for real
// (same pattern as primaryAction.test.ts).
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
  vi.restoreAllMocks();
});

describe('recentFiles', () => {
  it('starts empty and records most-recent-first', () => {
    expect(getRecents()).toEqual([]);
    recordRecent('C:\\designs\\first.json');
    recordRecent('C:\\designs\\second.json');
    const recents = getRecents();
    expect(recents.map((r) => r.path)).toEqual([
      'C:\\designs\\second.json',
      'C:\\designs\\first.json',
    ]);
  });

  it('derives the display name from the basename without .json (both separators)', () => {
    recordRecent('C:\\designs\\My Vehicle.json');
    recordRecent('/home/sam/robots/fear-and-love.json');
    const [posix, windows] = getRecents();
    expect(posix.name).toBe('fear-and-love');
    expect(windows.name).toBe('My Vehicle');
  });

  it('dedupes by path, moving a re-recorded path to the front', () => {
    recordRecent('C:\\a.json');
    recordRecent('C:\\b.json');
    recordRecent('C:\\a.json');
    const recents = getRecents();
    expect(recents).toHaveLength(2);
    expect(recents[0].path).toBe('C:\\a.json');
    expect(recents[1].path).toBe('C:\\b.json');
  });

  it('caps the list at 8 entries, dropping the oldest', () => {
    for (let i = 1; i <= 10; i++) recordRecent(`C:\\designs\\v${i}.json`);
    const recents = getRecents();
    expect(recents).toHaveLength(8);
    expect(recents[0].name).toBe('v10');
    expect(recents[7].name).toBe('v3');
  });

  it('returns [] for corrupt stored JSON and filters malformed entries', () => {
    localStorage.setItem(RECENT_FILES_STORAGE_KEY, 'not json');
    expect(getRecents()).toEqual([]);
    localStorage.setItem(
      RECENT_FILES_STORAGE_KEY,
      JSON.stringify([{ path: 'C:\\ok.json', name: 'ok', openedAt: 1 }, { nonsense: true }, 42]),
    );
    const recents = getRecents();
    expect(recents).toHaveLength(1);
    expect(recents[0].name).toBe('ok');
  });
});
