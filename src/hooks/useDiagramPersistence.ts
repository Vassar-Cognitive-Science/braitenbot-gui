import { useEffect, useLayoutEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { isTauri } from '../lib/tauri';
import { parse, serialize, type DiagramState } from '../lib/diagramFile';
import { TYPE_BY_ID } from '../types/diagram';
import type { DiagramConnection, DiagramNode } from '../types/diagram';

const STORAGE_KEY = 'braitenbot-gui:diagram:v1';
const AUTOSAVE_DEBOUNCE_MS = 300;

export interface DiagramPersistenceSetters {
  setNodes: (nodes: DiagramNode[]) => void;
  setConnections: (connections: DiagramConnection[]) => void;
  setLoopPeriodMs: (ms: number) => void;
}

export interface DiagramPersistenceOptions {
  state: DiagramState;
  setters: DiagramPersistenceSetters;
  isPristine: boolean;
  resetToDefault: () => void;
}

// Migrate legacy node shapes: the old 'motor' (wheel CR) and 'servo'
// (positional) types were unified into 'servo-cr' / 'servo-positional',
// and 'motorPin' was folded into 'servoPin'.
function migrate(node: DiagramNode): DiagramNode {
  const raw = node as unknown as Omit<DiagramNode, 'type'> & { type: string; motorPin?: string };
  if (raw.type === 'motor') {
    const { motorPin, type: _t, ...rest } = raw;
    return { ...rest, type: 'servo-cr', servoPin: rest.servoPin ?? motorPin ?? '' };
  }
  if (raw.type === 'servo') {
    const { type: _t, ...rest } = raw;
    return { ...rest, type: 'servo-positional' };
  }
  return node;
}

// Drop nodes whose type is unknown on this build (e.g., after a branch
// switch or opening a file produced by a newer version), and drop any
// connections that would be left dangling.
function sanitize(file: DiagramState): DiagramState {
  const migrated = file.nodes.map(migrate);
  const validNodes = migrated.filter((node) => node.type in TYPE_BY_ID);
  const dropped = migrated.length - validNodes.length;
  if (dropped > 0) {
    const unknownTypes = Array.from(
      new Set(migrated.filter((n) => !(n.type in TYPE_BY_ID)).map((n) => n.type)),
    );
    console.warn(
      `[diagram] dropped ${dropped} node(s) with unknown type(s): ${unknownTypes.join(', ')}`,
    );
  }
  const validIds = new Set(validNodes.map((n) => n.id));
  const validConnections = file.connections.filter(
    (c) => validIds.has(c.from) && validIds.has(c.to),
  );
  return { nodes: validNodes, connections: validConnections, loopPeriodMs: file.loopPeriodMs };
}

function applyFile(file: DiagramState, setters: DiagramPersistenceSetters) {
  const clean = sanitize(file);
  setters.setNodes(clean.nodes);
  setters.setConnections(clean.connections);
  setters.setLoopPeriodMs(clean.loopPeriodMs);
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

    const confirmReplace = (message: string): boolean => {
      if (isPristineRef.current) return true;
      return window.confirm(message);
    };

    const handleSave = async () => {
      try {
        const contents = serialize(stateRef.current);
        await invoke<string | null>('save_diagram', { contents });
      } catch (err) {
        window.alert(`Failed to save diagram: ${String(err)}`);
      }
    };

    const handleLoad = async () => {
      try {
        const contents = await invoke<string | null>('load_diagram');
        if (contents === null) return;
        const file = parse(contents);
        if (!confirmReplace('Replace the current diagram with the loaded file?')) return;
        applyFile(file, settersRef.current);
      } catch (err) {
        window.alert(`Failed to load diagram: ${String(err)}`);
      }
    };

    const handleNew = () => {
      if (!confirmReplace('Discard the current diagram and start fresh?')) return;
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
