import { useEffect, useLayoutEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { ask, message } from '@tauri-apps/plugin-dialog';
import { isTauri } from '../lib/tauri';
import { parse, serialize, type DiagramState } from '../lib/diagramFile';
import type { CompoundTypeDefinition, DiagramConnection, DiagramNode } from '../types/diagram';

const STORAGE_KEY = 'braitenbot-gui:diagram:v1';
const AUTOSAVE_DEBOUNCE_MS = 300;

export interface DiagramPersistenceSetters {
  setNodes: (nodes: DiagramNode[]) => void;
  setConnections: (connections: DiagramConnection[]) => void;
  setLoopPeriodMs: (ms: number) => void;
  setCompoundTypes: (compoundTypes: CompoundTypeDefinition[]) => void;
}

export interface DiagramPersistenceOptions {
  state: DiagramState;
  setters: DiagramPersistenceSetters;
  isPristine: boolean;
  resetToDefault: () => void;
}

function applyFile(file: DiagramState, setters: DiagramPersistenceSetters) {
  setters.setNodes(file.nodes);
  setters.setConnections(file.connections);
  setters.setLoopPeriodMs(file.loopPeriodMs);
  setters.setCompoundTypes(file.compoundTypes);
}

export function useDiagramPersistence({
  state,
  setters,
  isPristine,
  resetToDefault,
}: DiagramPersistenceOptions) {
  const settersRef = useRef(setters);
  settersRef.current = setters;

  const stateRef = useRef(state);
  stateRef.current = state;

  const isPristineRef = useRef(isPristine);
  isPristineRef.current = isPristine;

  const resetRef = useRef(resetToDefault);
  resetRef.current = resetToDefault;

  useLayoutEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const file = parse(raw);
      applyFile(file, settersRef.current);
    } catch (err) {
      console.warn('[diagram] failed to restore from localStorage:', err);
    }
    // Intentionally run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, serialize(state));
      } catch (err) {
        console.warn('[diagram] failed to autosave to localStorage:', err);
      }
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    if (!isTauri()) return;

    let disposed = false;
    const unlistenFns: UnlistenFn[] = [];

    // window.confirm/alert are silent no-ops inside Tauri's WebView, so all
    // dialogs here must go through the dialog plugin's async API.
    const confirmReplace = async (prompt: string, title: string): Promise<boolean> => {
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
        applyFile(file, settersRef.current);
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
  }, []);
}
