import { useCallback, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { CompoundTypeDefinition, DiagramConnection, DiagramNode } from '../types/diagram';

const UNDO_LIMIT = 100;

interface Snapshot {
  context: string | null;
  nodes: DiagramNode[];
  connections: DiagramConnection[];
  compoundTypes: CompoundTypeDefinition[];
}

interface UseDiagramUndoParams {
  // The current routed editing context (top level, or the open compound body).
  nodes: DiagramNode[];
  connections: DiagramConnection[];
  compoundTypes: CompoundTypeDefinition[];
  currentCompoundId: string | null;
  // Canonical top-level state setters. Restore writes directly into the tagged
  // context via these, rather than routing through context-sensitive setters.
  setTopNodes: Dispatch<SetStateAction<DiagramNode[]>>;
  setTopConnections: Dispatch<SetStateAction<DiagramConnection[]>>;
  setCompoundTypes: Dispatch<SetStateAction<CompoundTypeDefinition[]>>;
  // Called after a successful restore (e.g. to drop the config-panel target).
  onRestore: () => void;
}

export interface DiagramUndo {
  pushUndo: () => void;
  undo: () => void;
  redo: () => void;
  clear: () => void;
}

export function useDiagramUndo({
  nodes,
  connections,
  compoundTypes,
  currentCompoundId,
  setTopNodes,
  setTopConnections,
  setCompoundTypes,
  onRestore,
}: UseDiagramUndoParams): DiagramUndo {
  // Each snapshot is tagged with the editing context it was captured in
  // (`context` = the open compound's id, or null at the top level) so undo
  // can restore into exactly that context instead of whatever context the
  // editor happens to be in when undo fires.
  const undoStackRef = useRef<Snapshot[]>([]);
  // Redo mirrors undo: undo pushes the pre-restore state here, redo replays it.
  // Any fresh edit (pushUndo) clears this so redo can't jump across branches.
  const redoStackRef = useRef<Snapshot[]>([]);

  // A snapshot of the current editing context (top level, or the open
  // compound's body), tagged with that context so it can be restored later
  // even if the editor has since moved elsewhere.
  const captureSnapshot = useCallback(
    (): Snapshot => ({
      context: currentCompoundId,
      nodes: structuredClone(nodes),
      connections: structuredClone(connections),
      compoundTypes: structuredClone(compoundTypes),
    }),
    [nodes, connections, compoundTypes, currentCompoundId],
  );

  // Restore a snapshot into the context it was taken in — writing top-level
  // state directly, or into the matching compound body — rather than routing
  // through the context-sensitive setters (which would misdirect the write if
  // the editor is now in a different context). Returns false when the target
  // compound no longer exists, so callers can skip and try the next snapshot.
  const restoreSnapshot = useCallback(
    (snapshot: Snapshot): boolean => {
      if (snapshot.context === null) {
        setTopNodes(snapshot.nodes);
        setTopConnections(snapshot.connections);
        setCompoundTypes(snapshot.compoundTypes);
      } else {
        if (!snapshot.compoundTypes.some((c) => c.id === snapshot.context)) return false;
        setCompoundTypes(
          snapshot.compoundTypes.map((c) =>
            c.id === snapshot.context
              ? { ...c, body: { ...c.body, nodes: snapshot.nodes, connections: snapshot.connections } }
              : c,
          ),
        );
      }
      onRestore();
      return true;
    },
    [setTopNodes, setTopConnections, setCompoundTypes, onRestore],
  );

  const pushUndo = useCallback(() => {
    undoStackRef.current.push(captureSnapshot());
    if (undoStackRef.current.length > UNDO_LIMIT) undoStackRef.current.shift();
    // A new edit invalidates any redo branch.
    redoStackRef.current = [];
  }, [captureSnapshot]);

  const undo = useCallback(() => {
    const current = captureSnapshot();
    while (undoStackRef.current.length > 0) {
      const snapshot = undoStackRef.current.pop()!;
      if (restoreSnapshot(snapshot)) {
        redoStackRef.current.push(current);
        if (redoStackRef.current.length > UNDO_LIMIT) redoStackRef.current.shift();
        return;
      }
    }
  }, [captureSnapshot, restoreSnapshot]);

  const redo = useCallback(() => {
    const current = captureSnapshot();
    while (redoStackRef.current.length > 0) {
      const snapshot = redoStackRef.current.pop()!;
      if (restoreSnapshot(snapshot)) {
        undoStackRef.current.push(current);
        if (undoStackRef.current.length > UNDO_LIMIT) undoStackRef.current.shift();
        return;
      }
    }
  }, [captureSnapshot, restoreSnapshot]);

  const clear = useCallback(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
  }, []);

  return { pushUndo, undo, redo, clear };
}
