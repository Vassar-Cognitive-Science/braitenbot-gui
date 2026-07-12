import { useEffect, useLayoutEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { ask, message } from '@tauri-apps/plugin-dialog';
import { isTauri } from '../lib/tauri';
import { diagramStore } from '../doc/DiagramStore';
import { parse, serialize, type DiagramState } from '../lib/diagramFile';

// The user's own diagram ("personal slot") — never written while a guest is in
// a collaborative session, so leaving a session can always restore it.
export const PERSONAL_STORAGE_KEY = 'braitenbot-gui:diagram:v1';
// Separate autosave slot for the shared diagram while joined as a guest.
export const SESSION_STORAGE_KEY = 'braitenbot-gui:session-diagram:v1';
const AUTOSAVE_DEBOUNCE_MS = 300;

/** Read the personal-slot diagram, or null if absent/unreadable. */
export function loadPersonalDiagram(): DiagramState | null {
  try {
    const raw = localStorage.getItem(PERSONAL_STORAGE_KEY);
    return raw ? parse(raw) : null;
  } catch (err) {
    console.warn('[diagram] failed to read personal slot:', err);
    return null;
  }
}

/** Write the personal slot directly (the guest "keep a copy" flow). */
export function savePersonalDiagram(state: DiagramState): void {
  try {
    localStorage.setItem(PERSONAL_STORAGE_KEY, serialize(state));
  } catch (err) {
    console.warn('[diagram] failed to write personal slot:', err);
  }
}

export interface DiagramPersistenceOptions {
  // The canonical top-level diagram, for autosave/serialize.
  state: DiagramState;
  // Full replacement (mount restore, file open). Routes through the store's
  // replaceAll (which also clears undo history) and resets local editing state.
  applyDiagram: (state: DiagramState) => void;
  isPristine: boolean;
  resetToDefault: () => void;
  // Collaborative-session role. Guests autosave to the session slot (personal
  // slot untouched); the host keeps autosaving to the personal slot — the host
  // is the copy of record. Any in-session role gates file ops behind a
  // "replaces the shared diagram" confirm.
  sessionRole: 'host' | 'guest' | null;
  // When false, all persistence is disabled: no mount-restore from localStorage,
  // no autosave, no desktop-menu file listeners. Used by the docs playground,
  // where each embed is seeded from a preset and must stay ephemeral (multiple
  // iframes share one origin's localStorage and would otherwise clobber it).
  enabled?: boolean;
}

export function useDiagramPersistence({
  state,
  applyDiagram,
  isPristine,
  resetToDefault,
  sessionRole,
  enabled = true,
}: DiagramPersistenceOptions) {
  const applyRef = useRef(applyDiagram);
  // eslint-disable-next-line react-hooks/refs
  applyRef.current = applyDiagram;

  const stateRef = useRef(state);
  // eslint-disable-next-line react-hooks/refs
  stateRef.current = state;

  const isPristineRef = useRef(isPristine);
  // eslint-disable-next-line react-hooks/refs
  isPristineRef.current = isPristine;

  const resetRef = useRef(resetToDefault);
  // eslint-disable-next-line react-hooks/refs
  resetRef.current = resetToDefault;

  const sessionRoleRef = useRef(sessionRole);
  // eslint-disable-next-line react-hooks/refs
  sessionRoleRef.current = sessionRole;

  useLayoutEffect(() => {
    if (!enabled) return;
    try {
      const raw = localStorage.getItem(PERSONAL_STORAGE_KEY);
      if (!raw) return;
      const file = parse(raw);
      applyRef.current(file);
    } catch (err) {
      console.warn('[diagram] failed to restore from localStorage:', err);
    }
    // Intentionally run once on mount — refs are read inside, no reactive deps needed.
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const key = sessionRole === 'guest' ? SESSION_STORAGE_KEY : PERSONAL_STORAGE_KEY;
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(key, serialize(state));
      } catch (err) {
        console.warn('[diagram] failed to autosave to localStorage:', err);
      }
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [state, sessionRole, enabled]);

  useEffect(() => {
    if (!enabled) return;
    if (!isTauri()) return;

    let disposed = false;
    const unlistenFns: UnlistenFn[] = [];

    // window.confirm/alert are silent no-ops inside Tauri's WebView, so all
    // dialogs here must go through the dialog plugin's async API.
    const confirmReplace = async (prompt: string, title: string): Promise<boolean> => {
      // Mid-session file ops replace the SHARED diagram — always confirm, and
      // say so explicitly (the design doc gates New/Open behind this).
      if (sessionRoleRef.current) {
        if (diagramStore.isReadOnly()) {
          await message('You are view-only in this session, so you cannot replace the shared diagram.', {
            title,
            kind: 'info',
          });
          return false;
        }
        return ask(
          `${prompt}\n\nYou are in a live session: this will replace the shared diagram for all participants.`,
          { title, kind: 'warning' },
        );
      }
      if (isPristineRef.current) return true;
      return ask(prompt, { title, kind: 'warning' });
    };

    const handleSave = async () => {
      try {
        const contents = serialize(stateRef.current);
        await invoke<string | null>('save_diagram', { contents });
      } catch (err) {
        await message(`Failed to save diagram: ${String(err)}`, { kind: 'error' });
      }
    };

    const handleLoad = async () => {
      try {
        const contents = await invoke<string | null>('load_diagram');
        if (contents === null) return;
        const file = parse(contents);
        if (!(await confirmReplace('Replace the current diagram with the loaded file?', 'Load Diagram'))) return;
        applyRef.current(file);
      } catch (err) {
        await message(`Failed to load diagram: ${String(err)}`, { kind: 'error' });
      }
    };

    const handleNew = async () => {
      if (!(await confirmReplace('Discard the current diagram and start fresh?', 'New Diagram'))) return;
      resetRef.current();
    };

    (async () => {
      try {
        const saveUnlisten = await listen('menu://save', handleSave);
        if (disposed) {
          saveUnlisten();
          return;
        }
        unlistenFns.push(saveUnlisten);

        const loadUnlisten = await listen('menu://load', handleLoad);
        if (disposed) {
          loadUnlisten();
          return;
        }
        unlistenFns.push(loadUnlisten);

        const newUnlisten = await listen('menu://new', handleNew);
        if (disposed) {
          newUnlisten();
          return;
        }
        unlistenFns.push(newUnlisten);
      } catch (err) {
        console.warn('[diagram] failed to attach menu listeners:', err);
      }
    })();

    return () => {
      disposed = true;
      for (const fn of unlistenFns) fn();
    };
  }, [enabled]);
}
