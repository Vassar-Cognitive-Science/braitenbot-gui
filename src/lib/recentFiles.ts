// Recent diagram files (saved or opened), for the landing page's "Recent
// designs" list. Purely a per-device convenience: paths are recorded on every
// successful save/load and re-checked for existence before display.

export const RECENT_FILES_STORAGE_KEY = 'braitenbot-gui:recent-files:v1';
const MAX_RECENTS = 8;

export interface RecentFile {
  /** Absolute path on disk, as returned by the native dialogs. */
  path: string;
  /** Display name — basename without the .json extension. */
  name: string;
  /** Last save/open time (ms since epoch). */
  openedAt: number;
}

/** Basename without a trailing `.json`, handling both path separators. */
function displayName(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  return base.replace(/\.json$/i, '');
}

export function getRecents(): RecentFile[] {
  try {
    const raw = localStorage.getItem(RECENT_FILES_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is RecentFile =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as RecentFile).path === 'string' &&
        typeof (entry as RecentFile).name === 'string' &&
        typeof (entry as RecentFile).openedAt === 'number',
    );
  } catch (err) {
    console.warn('[recent-files] failed to read recent files:', err);
    return [];
  }
}

/** Record a save/open of `path`: dedupe by path, most-recent-first, cap 8. */
export function recordRecent(path: string): void {
  try {
    const entry: RecentFile = { path, name: displayName(path), openedAt: Date.now() };
    const rest = getRecents().filter((existing) => existing.path !== path);
    const next = [entry, ...rest].slice(0, MAX_RECENTS);
    localStorage.setItem(RECENT_FILES_STORAGE_KEY, JSON.stringify(next));
  } catch (err) {
    console.warn('[recent-files] failed to record recent file:', err);
  }
}
