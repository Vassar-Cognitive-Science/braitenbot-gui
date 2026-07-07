import { useSyncExternalStore } from 'react';
import type { DiagramSnapshot, DiagramStore, TraceSnapshot } from './DiagramStore';
import { diagramStore } from './DiagramStore';

/** The shared singleton store. Swappable later for a session-scoped doc. */
export function useDiagramStore(): DiagramStore {
  return diagramStore;
}

/**
 * Subscribe to the store's plain-object snapshot. The snapshot is referentially
 * stable between doc updates, so React only re-renders when the diagram changes.
 */
export function useDiagramSnapshot(store: DiagramStore = diagramStore): DiagramSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/**
 * Subscribe to the shared trace state (enabled flag, seed, sensor inputs,
 * pulse events). Separate from the diagram snapshot so trace writes drive the
 * sim/sliders without re-rendering the whole canvas.
 */
export function useTraceSnapshot(store: DiagramStore = diagramStore): TraceSnapshot {
  return useSyncExternalStore(store.subscribeTrace, store.getTraceSnapshot, store.getTraceSnapshot);
}
