import { isTauri } from './tauri';

/**
 * Open a URL in the user's OS default browser. Inside Tauri this must go
 * through the shell plugin — a plain `window.open` would navigate the app's
 * own webview. In plain-browser dev (no Tauri runtime) it falls back to a
 * normal new-tab open.
 */
export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
