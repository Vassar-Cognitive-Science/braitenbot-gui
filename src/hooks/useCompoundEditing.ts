import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { CompoundTypeDefinition, DiagramConnection, DiagramNode } from '../types/diagram';
import type { DiagramStore } from '../doc/DiagramStore';

interface UseCompoundEditingParams {
  store: DiagramStore;
  topNodes: DiagramNode[];
  topConnections: DiagramConnection[];
  compoundTypes: CompoundTypeDefinition[];
}

export interface CompoundEditing {
  // Stack of compound-type ids currently being edited. Empty = at top level.
  editingPath: string[];
  setEditingPath: Dispatch<SetStateAction<string[]>>;
  // The compound type currently being edited, if any.
  currentCompoundId: string | null;
  currentCompound: CompoundTypeDefinition | null;
  // The routed view: top-level state, or the open compound body. Mutations go
  // through the store's context-routed methods (the store tracks the same
  // editing context), not through setters here.
  nodes: DiagramNode[];
  connections: DiagramConnection[];
  // Descend into a compound instance's body for editing.
  enterCompound: (compoundTypeId: string) => void;
}

export function useCompoundEditing({
  store,
  topNodes,
  topConnections,
  compoundTypes,
}: UseCompoundEditingParams): CompoundEditing {
  const [rawEditingPath, setEditingPath] = useState<string[]>([]);

  // Prune the editing path to compound types that still exist, at read time. An
  // undo/redo (or later a remote edit) can delete the compound you are inside;
  // without this the routed view would strand on a missing body. Deriving the
  // pruned path (rather than writing state in an effect) keeps this reactive
  // without cascading renders.
  const editingPath = useMemo(() => {
    const valid: string[] = [];
    for (const id of rawEditingPath) {
      if (compoundTypes.some((c) => c.id === id)) valid.push(id);
      else break;
    }
    return valid.length === rawEditingPath.length ? rawEditingPath : valid;
  }, [rawEditingPath, compoundTypes]);

  const currentCompoundId = editingPath.length > 0 ? editingPath[editingPath.length - 1] : null;
  const currentCompound = currentCompoundId
    ? compoundTypes.find((c) => c.id === currentCompoundId) ?? null
    : null;

  // Keep the store's routing context in lockstep with the visible layer.
  // useLayoutEffect (not useEffect) so the store never routes a mutation with
  // a stale context: it runs synchronously in the same commit, before any
  // event handler can fire against the new view.
  useLayoutEffect(() => {
    store.setEditingContext(currentCompoundId);
  }, [store, currentCompoundId]);

  const nodes = currentCompound ? currentCompound.body.nodes : topNodes;
  const connections = currentCompound ? currentCompound.body.connections : topConnections;

  const enterCompound = useCallback((compoundTypeId: string) => {
    setEditingPath((prev) => [...prev, compoundTypeId]);
  }, []);

  return {
    editingPath,
    setEditingPath,
    currentCompoundId,
    currentCompound,
    nodes,
    connections,
    enterCompound,
  };
}
