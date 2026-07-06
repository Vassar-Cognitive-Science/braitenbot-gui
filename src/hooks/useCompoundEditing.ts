import { useCallback, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { CompoundTypeDefinition, DiagramConnection, DiagramNode } from '../types/diagram';

interface UseCompoundEditingParams {
  topNodes: DiagramNode[];
  topConnections: DiagramConnection[];
  setTopNodes: Dispatch<SetStateAction<DiagramNode[]>>;
  setTopConnections: Dispatch<SetStateAction<DiagramConnection[]>>;
  compoundTypes: CompoundTypeDefinition[];
  setCompoundTypes: Dispatch<SetStateAction<CompoundTypeDefinition[]>>;
}

export interface CompoundEditing {
  // Stack of compound-type ids currently being edited. Empty = at top level.
  editingPath: string[];
  setEditingPath: Dispatch<SetStateAction<string[]>>;
  // The compound type currently being edited, if any.
  currentCompoundId: string | null;
  currentCompound: CompoundTypeDefinition | null;
  // The routed view + setters: top-level state, or the open compound body.
  nodes: DiagramNode[];
  connections: DiagramConnection[];
  setNodes: Dispatch<SetStateAction<DiagramNode[]>>;
  setConnections: Dispatch<SetStateAction<DiagramConnection[]>>;
  // Descend into a compound instance's body for editing.
  enterCompound: (compoundTypeId: string) => void;
}

export function useCompoundEditing({
  topNodes,
  topConnections,
  setTopNodes,
  setTopConnections,
  compoundTypes,
  setCompoundTypes,
}: UseCompoundEditingParams): CompoundEditing {
  const [editingPath, setEditingPath] = useState<string[]>([]);

  // The compound type currently being edited, if any. Body edits flow into
  // its body.nodes / body.connections instead of the top-level state.
  const currentCompoundId = editingPath.length > 0 ? editingPath[editingPath.length - 1] : null;
  const currentCompound = currentCompoundId
    ? compoundTypes.find((c) => c.id === currentCompoundId) ?? null
    : null;

  const nodes = currentCompound ? currentCompound.body.nodes : topNodes;
  const connections = currentCompound ? currentCompound.body.connections : topConnections;

  const setNodes = useCallback<Dispatch<SetStateAction<DiagramNode[]>>>(
    (action) => {
      if (currentCompoundId) {
        setCompoundTypes((prev) =>
          prev.map((c) =>
            c.id === currentCompoundId
              ? {
                  ...c,
                  body: {
                    ...c.body,
                    nodes:
                      typeof action === 'function'
                        ? (action as (p: DiagramNode[]) => DiagramNode[])(c.body.nodes)
                        : action,
                  },
                }
              : c,
          ),
        );
      } else {
        setTopNodes(action);
      }
    },
    [currentCompoundId, setCompoundTypes, setTopNodes],
  );

  const setConnections = useCallback<Dispatch<SetStateAction<DiagramConnection[]>>>(
    (action) => {
      if (currentCompoundId) {
        setCompoundTypes((prev) =>
          prev.map((c) =>
            c.id === currentCompoundId
              ? {
                  ...c,
                  body: {
                    ...c.body,
                    connections:
                      typeof action === 'function'
                        ? (action as (p: DiagramConnection[]) => DiagramConnection[])(c.body.connections)
                        : action,
                  },
                }
              : c,
          ),
        );
      } else {
        setTopConnections(action);
      }
    },
    [currentCompoundId, setCompoundTypes, setTopConnections],
  );

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
    setNodes,
    setConnections,
    enterCompound,
  };
}
