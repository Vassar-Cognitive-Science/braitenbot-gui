import { serialize } from '@app/lib/diagramFile';
import type { DiagramState } from '@app/lib/diagramFile';

/**
 * Whether this page is loaded inside the desktop app's Lessons iframe.
 * `LessonsView.tsx` (app side) loads the bundled docs with a `?bb-app=1`
 * query param on the very first URL; Docusaurus's client-side router only
 * ever does in-page navigations after that (no full document reload), so
 * this module — which evaluates exactly once per document load — can read
 * the flag a single time here rather than re-checking `location.search` on
 * every render or wiring up a postMessage handshake.
 *
 * That "no full document reload" assumption doesn't always hold: things like
 * a hard-refresh inside the iframe, an error-page recovery, or the browser
 * restoring the iframe's document after eviction land back on a URL that no
 * longer carries `?bb-app=1` (only the very first navigation did). A
 * `sessionStorage` latch survives those reloads within the same tab/frame
 * session — once we've ever seen the query flag, we remember it for the rest
 * of the session even after the query string is gone.
 *
 * Guarded for SSR: Docusaurus statically renders every page (and therefore
 * evaluates this module) at build time in Node, where `window` does not
 * exist.
 */
const EMBED_FLAG_KEY = 'braitenbot:embedded';

const queryFlag =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('bb-app') === '1';

if (queryFlag) {
  try {
    sessionStorage.setItem(EMBED_FLAG_KEY, '1');
  } catch {
    // sessionStorage unavailable (privacy mode, etc.) — the query flag alone
    // still covers the current document load.
  }
}

export const isEmbeddedInApp: boolean =
  queryFlag ||
  (() => {
    try {
      return typeof window !== 'undefined' && sessionStorage.getItem(EMBED_FLAG_KEY) === '1';
    } catch {
      return false;
    }
  })();

/**
 * Send the reader's current diagram to the app shell for direct upload to
 * the robot. Posts to `window.parent` (the app shell that hosts the Lessons
 * iframe), which listens for `braitenbot:upload-to-bot` messages and opens
 * a small board-picker/upload dialog for the circuit — the student never
 * has to leave the lesson or open the editor.
 *
 * Scoped to `window.location.origin` as the target origin — same-origin by
 * construction, since the iframe and the app shell both serve the bundled
 * docs build from the app's own protocol/origin.
 *
 * Callers should gate rendering the "Upload to bot" affordance on
 * `isEmbeddedInApp`; calling this outside the app is harmless (there is no
 * parent frame listening) but pointless.
 */
export function sendToBot(state: DiagramState): void {
  if (typeof window === 'undefined') return;
  window.parent.postMessage(
    { type: 'braitenbot:upload-to-bot', file: serialize(state) },
    window.location.origin,
  );
}

/**
 * Ask the app shell to unlock and switch to the Editor view. Posts to
 * `window.parent` (the app shell that hosts the Lessons iframe), which
 * listens for `braitenbot:open-editor` messages, latches an
 * `editorUnlocked` flag in its own `localStorage` (so cross-nav buttons
 * between Editor and Lessons appear from then on), and switches views.
 *
 * Scoped to `window.location.origin` as the target origin — same-origin by
 * construction, since the iframe and the app shell both serve the bundled
 * docs build from the app's own protocol/origin.
 *
 * Callers should gate rendering the "Open the Editor" affordance on
 * `isEmbeddedInApp`; calling this outside the app is harmless (there is no
 * parent frame listening) but pointless.
 */
export function requestOpenEditor(): void {
  if (typeof window === 'undefined') return;
  window.parent.postMessage({ type: 'braitenbot:open-editor' }, window.location.origin);
}

/**
 * Suppress the native right-click context menu while embedded in the app
 * shell. The desktop app's webview has no browser chrome, so the OS's
 * default "Back / Reload / Inspect Element" menu reads as a bug rather than
 * a feature there; on the public website (a real browser tab) the native
 * menu is left alone. Inputs and textareas are exempted so copy/paste/
 * spellcheck still work for any editable text fields.
 *
 * Call once from a swizzled `src/theme/Root.tsx` so it applies site-wide
 * regardless of which page is current. Returns an unsubscribe function for
 * symmetry with a `useEffect` cleanup; a no-op when not embedded or during
 * SSR.
 */
export function suppressNativeContextMenuIfEmbedded(): () => void {
  if (typeof document === 'undefined' || !isEmbeddedInApp) {
    return () => {};
  }
  const handler = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea')) return;
    event.preventDefault();
  };
  document.addEventListener('contextmenu', handler);
  return () => document.removeEventListener('contextmenu', handler);
}
