import * as Y from 'yjs';
import type {
  CompoundTypeDefinition,
  DiagramComment,
  DiagramConnection,
  DiagramNode,
} from '../types/diagram';
import { TYPE_BY_ID } from '../types/diagram';
import type { DiagramState } from '../lib/diagramFile';
import { ORIGIN_LOCAL, ORIGIN_REMOTE, ORIGIN_REPAIR, ORIGIN_UNTRACKED } from './origins';
import {
  commentToYMap,
  compoundTypeToYMap,
  connectionToYMap,
  loadDiagramInto,
  nodeToYMap,
  readComments,
  readCompoundType,
  readConnections,
  readNodes,
} from './yconvert';
import { defaultDiagram } from './defaults';
import { repairDiagram } from './repair';

type YNode = Y.Map<unknown>;
type Container = Y.Map<YNode>;

// Vertical spacing for generated compound port anchors. Mirrors the node height
// used by the diagram view; only affects cosmetic anchor placement.
const NODE_H = 64;

export interface DiagramSnapshot {
  topNodes: DiagramNode[];
  topConnections: DiagramConnection[];
  compoundTypes: CompoundTypeDefinition[];
  /** Top-level explanatory notes. Never routed into compound bodies. */
  comments: DiagramComment[];
  loopPeriodMs: number;
}

/**
 * One shared trace-mode pulse event. Each client applies it once via the
 * existing tick-based pulse mechanism (relative to its own clock — see the
 * tick-drift limitation), then the writer prunes it once expired.
 */
export interface TracePulseEvent {
  id: string;
  sensorId: string;
  value: number;
  startTick: number;
  durationTicks: number;
}

/**
 * Derived plain view of the session-ephemeral `trace` Y.Map. `inputs` are the
 * sensor slider values (keyed nodeId or nodeId:channel) that used to live in
 * local React state. Never exported to `.bbot` and never autosaved — the
 * trace map is not part of DiagramSnapshot.
 */
export interface TraceSnapshot {
  enabled: boolean;
  seed: number | undefined;
  inputs: Record<string, number>;
  pulses: TracePulseEvent[];
}

function uuidSuffix(): string {
  const uuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(16)}${Math.floor(Math.random() * 1e9).toString(16)}`;
  return uuid.replace(/-/g, '').slice(0, 12);
}

function recordsEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  for (const k of ak) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

function pulsesEqual(a: TracePulseEvent[], b: TracePulseEvent[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.sensorId !== y.sensorId ||
      x.value !== y.value ||
      x.startTick !== y.startTick ||
      x.durationTicks !== y.durationTicks
    ) {
      return false;
    }
  }
  return true;
}

// Structural-sharing cache: one entry per entity id, holding the last plain
// object handed to React plus its serialized form for cheap change detection.
type EntityCache<T> = Map<string, { json: string; obj: T }>;

interface BodyCache {
  nodes: EntityCache<DiagramNode>;
  connections: EntityCache<DiagramConnection>;
}

/**
 * Reuse the cached object for every entity whose content is unchanged, and the
 * previous array itself when every element (and the order) is unchanged, so
 * React.memo consumers only re-render for entities that actually changed.
 * Entities are small; JSON-string comparison is cheap enough per update.
 */
function shareEntities<T extends { id: string }>(
  fresh: T[],
  cache: EntityCache<T>,
  prev: T[] | undefined,
): T[] {
  const seen = new Set<string>();
  const result = fresh.map((item) => {
    seen.add(item.id);
    const json = JSON.stringify(item);
    const hit = cache.get(item.id);
    if (hit && hit.json === json) return hit.obj;
    cache.set(item.id, { json, obj: item });
    return item;
  });
  for (const id of [...cache.keys()]) {
    if (!seen.has(id)) cache.delete(id);
  }
  if (prev && prev.length === result.length && result.every((item, i) => item === prev[i])) {
    return prev;
  }
  return result;
}

/**
 * Owns the Yjs document that backs the diagram. Every mutation the UI performs
 * goes through a named method here (the single choke-point where view-only role
 * enforcement will later land). React reads via `subscribe` + `getSnapshot`.
 *
 * The underlying doc can be swapped (`swapDoc`) so a future collaborative
 * session can replace it wholesale.
 */
export class DiagramStore {
  private doc!: Y.Doc;
  private nodes!: Container;
  private connections!: Container;
  private compoundTypes!: Container;
  // Top-level explanatory notes. Undo-tracked like nodes/connections, but never
  // routed into a compound body — comments only live on the top-level canvas.
  private comments!: Container;
  private meta!: Y.Map<unknown>;
  // Session-ephemeral shared trace state (enabled flag, PRNG seed, sensor
  // inputs, pulse events). Backed by the doc even solo; never tracked by the
  // undo manager, never part of DiagramSnapshot (so it never autosaves/exports).
  private trace!: Y.Map<unknown>;
  // View-only role enforcement. When true every mutation method (tracked and
  // untracked, including undo/redo and trace writes) silently no-ops. The
  // SessionManager sets it from the guest's live role; the host is never view.
  private readOnly = false;
  private undoManager!: Y.UndoManager;
  // Remote transactions can violate semantic invariants (concurrent deletes,
  // curve-endpoint drift), so each remote batch schedules one repair pass —
  // debounced to a microtask, mirroring what undo/redo do synchronously.
  private remoteRepairScheduled = false;
  private onUpdate = (_update: Uint8Array, origin: unknown) => {
    if (origin === ORIGIN_REMOTE) this.scheduleRemoteRepair();
    this.refresh();
    this.refreshTrace();
  };

  // The open compound body, if any. Kept in sync from React (editingPath).
  // Routed mutations (nodes/connections) target this body when set.
  private editingContext: string | null = null;

  private snapshot: DiagramSnapshot;
  private listeners = new Set<() => void>();

  // Trace state has its own snapshot + listeners, separate from the diagram
  // snapshot: a trace-only write must notify trace readers (sim, sliders)
  // without churning the diagram snapshot (which stays referentially stable so
  // the canvas doesn't re-render on every slider tick).
  private traceSnapshot!: TraceSnapshot;
  private traceListeners = new Set<() => void>();

  // Structural-sharing caches keyed by entity id (compound bodies get one
  // nested cache pair per compound type). Cleared on doc swap.
  private nodeCache: EntityCache<DiagramNode> = new Map();
  private connectionCache: EntityCache<DiagramConnection> = new Map();
  private commentCache: EntityCache<DiagramComment> = new Map();
  private bodyCaches = new Map<string, BodyCache>();

  constructor() {
    this.init(new Y.Doc(), defaultDiagram());
    this.snapshot = this.buildSnapshot();
    this.traceSnapshot = this.buildTraceSnapshot();
  }

  private init(doc: Y.Doc, initial?: DiagramState): void {
    this.doc = doc;
    this.nodes = doc.getMap('nodes');
    this.connections = doc.getMap('connections');
    this.compoundTypes = doc.getMap('compoundTypes');
    this.comments = doc.getMap('comments');
    this.meta = doc.getMap('meta');
    this.trace = doc.getMap('trace');
    if (initial) {
      doc.transact(() => {
        loadDiagramInto(
          this.nodes,
          this.connections,
          this.compoundTypes,
          this.comments,
          this.meta,
          initial,
        );
      });
    }
    this.undoManager = new Y.UndoManager(
      [this.nodes, this.connections, this.compoundTypes, this.comments],
      {
        trackedOrigins: new Set([ORIGIN_LOCAL]),
        captureTimeout: 500,
      },
    );
    doc.on('update', this.onUpdate);
  }

  /** Replace the backing doc (a collaborative session swaps in the shared doc). */
  swapDoc(doc: Y.Doc): void {
    this.doc.off('update', this.onUpdate);
    this.undoManager.destroy();
    this.nodeCache.clear();
    this.connectionCache.clear();
    this.commentCache.clear();
    this.bodyCaches.clear();
    this.init(doc);
    this.refresh();
    this.refreshTrace();
  }

  /**
   * Swap in a brand-new doc loaded from a plain diagram state. Used when
   * leaving a session (restore the personal diagram onto a clean doc rather
   * than layering it into the shared doc's history).
   */
  resetDoc(state: DiagramState): void {
    const doc = new Y.Doc();
    doc.transact(() => {
      loadDiagramInto(
        doc.getMap('nodes'),
        doc.getMap('connections'),
        doc.getMap('compoundTypes'),
        doc.getMap('comments'),
        doc.getMap('meta'),
        state,
      );
    });
    this.swapDoc(doc);
  }

  /** The live backing doc (the session layer wires sync onto it). */
  getDoc(): Y.Doc {
    return this.doc;
  }

  // --- snapshot / subscription -------------------------------------------

  // Rebuild the plain snapshot with structural sharing: entities, arrays, and
  // compound definitions keep their previous object identity when their
  // content is unchanged, so React.memo consumers skip untouched entities
  // (e.g. only the dragged node re-renders during a drag).
  private buildSnapshot(): DiagramSnapshot {
    const prev = this.snapshot as DiagramSnapshot | undefined;
    const topNodes = shareEntities(readNodes(this.nodes), this.nodeCache, prev?.topNodes);
    const topConnections = shareEntities(
      readConnections(this.connections),
      this.connectionCache,
      prev?.topConnections,
    );
    const compoundTypes = this.shareCompoundTypes(prev?.compoundTypes);
    const comments = shareEntities(readComments(this.comments), this.commentCache, prev?.comments);
    const loopPeriodMs = (this.meta.get('loopPeriodMs') as number) ?? 20;
    if (
      prev &&
      prev.topNodes === topNodes &&
      prev.topConnections === topConnections &&
      prev.compoundTypes === compoundTypes &&
      prev.comments === comments &&
      prev.loopPeriodMs === loopPeriodMs
    ) {
      return prev;
    }
    return { topNodes, topConnections, compoundTypes, comments, loopPeriodMs };
  }

  private shareCompoundTypes(
    prev: CompoundTypeDefinition[] | undefined,
  ): CompoundTypeDefinition[] {
    const seen = new Set<string>();
    const result: CompoundTypeDefinition[] = [];
    // Sorted by id for the same cross-peer determinism as readNodes/readConnections.
    const entries = [...this.compoundTypes.entries()].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    for (const [id, map] of entries) {
      seen.add(id);
      let caches = this.bodyCaches.get(id);
      if (!caches) {
        caches = { nodes: new Map(), connections: new Map() };
        this.bodyCaches.set(id, caches);
      }
      const fresh = readCompoundType(id, map);
      const prevDef = prev?.find((d) => d.id === id);
      const bodyNodes = shareEntities(fresh.body.nodes, caches.nodes, prevDef?.body.nodes);
      const bodyConnections = shareEntities(
        fresh.body.connections,
        caches.connections,
        prevDef?.body.connections,
      );
      if (
        prevDef &&
        prevDef.displayName === fresh.displayName &&
        prevDef.body.nodes === bodyNodes &&
        prevDef.body.connections === bodyConnections
      ) {
        result.push(prevDef);
      } else {
        result.push({
          id,
          displayName: fresh.displayName,
          body: { nodes: bodyNodes, connections: bodyConnections },
        });
      }
    }
    for (const id of [...this.bodyCaches.keys()]) {
      if (!seen.has(id)) this.bodyCaches.delete(id);
    }
    if (prev && prev.length === result.length && result.every((def, i) => def === prev[i])) {
      return prev;
    }
    return result;
  }

  private refresh(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): DiagramSnapshot => this.snapshot;

  // --- trace snapshot / subscription -------------------------------------

  private buildTraceSnapshot(): TraceSnapshot {
    const prev = this.traceSnapshot as TraceSnapshot | undefined;
    const enabled = (this.trace.get('enabled') as boolean) ?? false;
    const seed = this.trace.get('seed') as number | undefined;

    const inputsMap = this.trace.get('inputs') as Y.Map<number> | undefined;
    const inputs: Record<string, number> = {};
    if (inputsMap) {
      for (const [key, value] of inputsMap.entries()) inputs[key] = value as number;
    }

    const pulsesMap = this.trace.get('pulses') as Y.Map<unknown> | undefined;
    const pulses: TracePulseEvent[] = [];
    if (pulsesMap) {
      // Sorted by id so every peer derives the same order deterministically.
      for (const [id, raw] of [...pulsesMap.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
        const ev = raw as Omit<TracePulseEvent, 'id'>;
        pulses.push({ id, sensorId: ev.sensorId, value: ev.value, startTick: ev.startTick, durationTicks: ev.durationTicks });
      }
    }

    // Structural sharing: reuse the previous snapshot (and its inputs/pulses)
    // when nothing changed, so useSyncExternalStore stays quiet.
    if (
      prev &&
      prev.enabled === enabled &&
      prev.seed === seed &&
      recordsEqual(prev.inputs, inputs) &&
      pulsesEqual(prev.pulses, pulses)
    ) {
      return prev;
    }
    return { enabled, seed, inputs, pulses };
  }

  private refreshTrace(): void {
    const next = this.buildTraceSnapshot();
    if (next === this.traceSnapshot) return;
    this.traceSnapshot = next;
    for (const listener of this.traceListeners) listener();
  }

  subscribeTrace = (listener: () => void): (() => void) => {
    this.traceListeners.add(listener);
    return () => {
      this.traceListeners.delete(listener);
    };
  };

  getTraceSnapshot = (): TraceSnapshot => this.traceSnapshot;

  // --- view-only role ----------------------------------------------------

  /** Toggle view-only enforcement. When true, all mutations silently no-op. */
  setReadOnly(readOnly: boolean): void {
    this.readOnly = readOnly;
  }

  isReadOnly(): boolean {
    return this.readOnly;
  }

  // --- editing context ---------------------------------------------------

  setEditingContext(compoundTypeId: string | null): void {
    this.editingContext = compoundTypeId;
  }

  private contextNodeContainer(): Container {
    const ctx = this.editingContext;
    if (ctx) {
      const body = (this.compoundTypes.get(ctx) as Y.Map<unknown> | undefined)?.get('nodes');
      if (body) return body as Container;
    }
    return this.nodes;
  }

  private contextConnectionContainer(): Container {
    const ctx = this.editingContext;
    if (ctx) {
      const body = (this.compoundTypes.get(ctx) as Y.Map<unknown> | undefined)?.get('connections');
      if (body) return body as Container;
    }
    return this.connections;
  }

  private contextNodes(): DiagramNode[] {
    const ctx = this.editingContext;
    if (ctx) {
      const def = this.snapshot.compoundTypes.find((c) => c.id === ctx);
      if (def) return def.body.nodes;
    }
    return this.snapshot.topNodes;
  }

  private contextConnections(): DiagramConnection[] {
    const ctx = this.editingContext;
    if (ctx) {
      const def = this.snapshot.compoundTypes.find((c) => c.id === ctx);
      if (def) return def.body.connections;
    }
    return this.snapshot.topConnections;
  }

  // --- transaction helpers -----------------------------------------------

  private transactLocal(fn: () => void): void {
    this.doc.transact(fn, ORIGIN_LOCAL);
  }

  private transactUntracked(fn: () => void): void {
    this.doc.transact(fn, ORIGIN_UNTRACKED);
  }

  // --- undo --------------------------------------------------------------

  stopCapturing(): void {
    this.undoManager.stopCapturing();
  }

  clearUndoHistory(): void {
    this.undoManager.clear();
  }

  undo(): void {
    if (this.readOnly) return;
    this.undoManager.undo();
    this.runRepair();
  }

  redo(): void {
    if (this.readOnly) return;
    this.undoManager.redo();
    this.runRepair();
  }

  private runRepair(): void {
    this.doc.transact(() => {
      repairDiagram(this.nodes, this.connections, this.compoundTypes);
    }, ORIGIN_REPAIR);
  }

  private scheduleRemoteRepair(): void {
    if (this.remoteRepairScheduled) return;
    this.remoteRepairScheduled = true;
    queueMicrotask(() => {
      this.remoteRepairScheduled = false;
      // repairDiagram is idempotent, so repairing whatever doc is current is
      // always safe — even if the doc was swapped between schedule and run.
      this.runRepair();
    });
  }

  // --- routed node mutations ---------------------------------------------

  addNode(node: DiagramNode): void {
    if (this.readOnly) return;
    this.transactLocal(() => {
      this.contextNodeContainer().set(node.id, nodeToYMap(node) as YNode);
    });
  }

  patchNode(id: string, patch: Partial<DiagramNode>): void {
    if (this.readOnly) return;
    this.transactLocal(() => this.applyPatch(this.contextNodeContainer(), id, patch));
  }

  moveNode(id: string, x: number, y: number): void {
    if (this.readOnly) return;
    this.transactLocal(() => {
      const map = this.contextNodeContainer().get(id);
      if (map) {
        map.set('x', x);
        map.set('y', y);
      }
    });
  }

  removeNodeWithConnections(id: string): void {
    if (this.readOnly) return;
    this.transactLocal(() => {
      const nodeContainer = this.contextNodeContainer();
      const connectionContainer = this.contextConnectionContainer();
      nodeContainer.delete(id);
      for (const [connectionId, connection] of [...connectionContainer.entries()]) {
        if (connection.get('from') === id || connection.get('to') === id) {
          connectionContainer.delete(connectionId);
        }
      }
    });
  }

  // --- routed connection mutations ---------------------------------------

  addConnection(connection: DiagramConnection): void {
    if (this.readOnly) return;
    this.transactLocal(() => {
      this.contextConnectionContainer().set(connection.id, connectionToYMap(connection) as YNode);
    });
  }

  patchConnection(id: string, patch: Partial<DiagramConnection>): void {
    if (this.readOnly) return;
    this.transactLocal(() => this.applyPatch(this.contextConnectionContainer(), id, patch));
  }

  removeConnection(id: string): void {
    if (this.readOnly) return;
    this.transactLocal(() => {
      this.contextConnectionContainer().delete(id);
    });
  }

  // --- comment mutations (top-level only) --------------------------------

  addComment(comment: DiagramComment): void {
    if (this.readOnly) return;
    this.transactLocal(() => {
      this.comments.set(comment.id, commentToYMap(comment) as YNode);
    });
  }

  patchComment(id: string, patch: Partial<DiagramComment>): void {
    if (this.readOnly) return;
    this.transactLocal(() => this.applyPatch(this.comments, id, patch));
  }

  moveComment(id: string, x: number, y: number): void {
    if (this.readOnly) return;
    this.transactLocal(() => {
      const map = this.comments.get(id);
      if (map) {
        map.set('x', x);
        map.set('y', y);
      }
    });
  }

  removeComment(id: string): void {
    if (this.readOnly) return;
    this.transactLocal(() => {
      this.comments.delete(id);
    });
  }

  private applyPatch(container: Container, id: string, patch: Record<string, unknown>): void {
    const map = container.get(id);
    if (!map) return;
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) map.delete(key);
      else map.set(key, value);
    }
  }

  // --- untracked mutations (no undo entry) -------------------------------

  setConstantValue(id: string, value: number): void {
    if (this.readOnly) return;
    this.transactUntracked(() => {
      this.contextNodeContainer().get(id)?.set('constantValue', value);
    });
  }

  setConnectionLabelT(id: string, labelT: number): void {
    if (this.readOnly) return;
    this.transactUntracked(() => {
      this.contextConnectionContainer().get(id)?.set('labelT', labelT);
    });
  }

  // --- shared trace mode (untracked; never undoable, never autosaved) ----

  /**
   * Flip trace mode for every participant. On enable, writes the shared PRNG
   * seed (the initiating client's, so all clients produce identical traces)
   * and fresh empty input/pulse maps. On disable, clears the whole trace map.
   */
  setTraceEnabled(enabled: boolean, seed?: number): void {
    if (this.readOnly) return;
    const current = (this.trace.get('enabled') as boolean) ?? false;
    if (current === enabled) return;
    this.transactUntracked(() => {
      if (enabled) {
        this.trace.set('enabled', true);
        this.trace.set('seed', (seed ?? (Date.now() >>> 0)) >>> 0);
        this.trace.set('inputs', new Y.Map<number>());
        this.trace.set('pulses', new Y.Map<unknown>());
      } else {
        this.trace.clear();
      }
    });
  }

  /** Write one shared sensor-input value (keyed nodeId or nodeId:channel). */
  setTraceInput(key: string, value: number): void {
    if (this.readOnly) return;
    this.transactUntracked(() => {
      let inputs = this.trace.get('inputs') as Y.Map<number> | undefined;
      if (!inputs) {
        inputs = new Y.Map<number>();
        this.trace.set('inputs', inputs);
      }
      inputs.set(key, value);
    });
  }

  /** Append a shared pulse event; every client applies it once. */
  addTracePulse(event: TracePulseEvent): void {
    if (this.readOnly) return;
    this.transactUntracked(() => {
      let pulses = this.trace.get('pulses') as Y.Map<unknown> | undefined;
      if (!pulses) {
        pulses = new Y.Map<unknown>();
        this.trace.set('pulses', pulses);
      }
      pulses.set(event.id, {
        sensorId: event.sensorId,
        value: event.value,
        startTick: event.startTick,
        durationTicks: event.durationTicks,
      });
    });
  }

  /** Prune a consumed/expired pulse event (called by its writer). */
  removeTracePulse(id: string): void {
    if (this.readOnly) return;
    this.transactUntracked(() => {
      (this.trace.get('pulses') as Y.Map<unknown> | undefined)?.delete(id);
    });
  }

  // Resize-driven motor snap + top-level node translation. Always targets the
  // top level (the wheel anchors live there), never a compound body.
  applyMotorLayout(opts: {
    leftX: number;
    leftY: number;
    rightX: number;
    rightY: number;
    dx: number;
    dy: number;
  }): void {
    if (this.readOnly) return;
    this.transactUntracked(() => {
      for (const [id, map] of this.nodes.entries()) {
        if (id === 'motor-left') {
          map.set('x', opts.leftX);
          map.set('y', opts.leftY);
        } else if (id === 'motor-right') {
          map.set('x', opts.rightX);
          map.set('y', opts.rightY);
        } else if (opts.dx !== 0 || opts.dy !== 0) {
          map.set('x', (map.get('x') as number) + opts.dx);
          map.set('y', (map.get('y') as number) + opts.dy);
        }
      }
      // Comments live in the same world space as nodes, so the resize-driven
      // translation must move them too or annotations drift off their groups.
      if (opts.dx !== 0 || opts.dy !== 0) {
        for (const map of this.comments.values()) {
          map.set('x', (map.get('x') as number) + opts.dx);
          map.set('y', (map.get('y') as number) + opts.dy);
        }
      }
    });
  }

  // --- global ------------------------------------------------------------

  setLoopPeriodMs(ms: number): void {
    if (this.readOnly) return;
    // meta is intentionally outside the undo scope, so loop period edits are
    // not undoable — matching the pre-CRDT snapshot behavior.
    this.transactLocal(() => this.meta.set('loopPeriodMs', ms));
  }

  // Full replacement (file open, restore, new). Clears undo history: undoing
  // back into a discarded diagram would be wrong.
  replaceAll(state: DiagramState): void {
    if (this.readOnly) return;
    this.doc.transact(() => {
      loadDiagramInto(
        this.nodes,
        this.connections,
        this.compoundTypes,
        this.comments,
        this.meta,
        state,
      );
    }, ORIGIN_LOCAL);
    this.undoManager.clear();
  }

  // --- compound operations -----------------------------------------------

  renameCompound(typeId: string, displayName: string): void {
    if (this.readOnly) return;
    this.transactLocal(() => {
      (this.compoundTypes.get(typeId) as Y.Map<unknown> | undefined)?.set('displayName', displayName);
      this.syncInstanceLabels(this.contextNodeContainer(), typeId, displayName);
      if (this.editingContext) this.syncInstanceLabels(this.nodes, typeId, displayName);
    });
  }

  private syncInstanceLabels(container: Container, typeId: string, label: string): void {
    for (const map of container.values()) {
      if (map.get('type') === 'compound' && map.get('compoundTypeId') === typeId) {
        map.set('label', label);
      }
    }
  }

  /**
   * Group the given node ids (in the current editing context) into a new
   * compound. Boundary edges become port anchors; weights/transfers stay on the
   * outer edge. One transaction = one undo step. Returns the new instance id, or
   * null if nothing groupable was selected.
   */
  group(selectedNodeIds: Set<string>): { instanceId: string } | null {
    if (this.readOnly) return null;
    const nodes = this.contextNodes();
    const connections = this.contextConnections();
    const selectedNodes = nodes.filter(
      (n) =>
        selectedNodeIds.has(n.id) &&
        !TYPE_BY_ID[n.type].topLevelOnly &&
        !(n.type === 'servo-cr' && (n.id === 'motor-left' || n.id === 'motor-right')),
    );
    if (selectedNodes.length === 0) return null;

    const selectedIds = new Set(selectedNodes.map((n) => n.id));
    const isInternal = (conn: DiagramConnection) =>
      selectedIds.has(conn.from) && selectedIds.has(conn.to);
    const incomingBoundary = connections.filter(
      (c) => selectedIds.has(c.to) && !selectedIds.has(c.from),
    );
    const outgoingBoundary = connections.filter(
      (c) => selectedIds.has(c.from) && !selectedIds.has(c.to),
    );
    const internalConns = connections.filter((c) => isInternal(c));

    const nextNumber = this.snapshot.compoundTypes.length + 1;
    const compoundTypeId = `compound-${nextNumber}-${uuidSuffix()}`;

    const minX = Math.min(...selectedNodes.map((n) => n.x));
    const minY = Math.min(...selectedNodes.map((n) => n.y));
    const cx = (Math.min(...selectedNodes.map((n) => n.x)) + Math.max(...selectedNodes.map((n) => n.x))) / 2;
    const cy = (Math.min(...selectedNodes.map((n) => n.y)) + Math.max(...selectedNodes.map((n) => n.y))) / 2;

    const BODY_MARGIN = 120;
    const bodyNodes: DiagramNode[] = selectedNodes.map((n) => ({
      ...n,
      x: n.x - minX + BODY_MARGIN + 100,
      y: n.y - minY + BODY_MARGIN,
    }));

    const inputTargetIds: string[] = [];
    for (const edge of incomingBoundary) {
      if (!inputTargetIds.includes(edge.to)) inputTargetIds.push(edge.to);
    }
    const outputSourceIds: string[] = [];
    for (const edge of outgoingBoundary) {
      if (!outputSourceIds.includes(edge.from)) outputSourceIds.push(edge.from);
    }
    const nameWithIndex = (base: string, i: number) => (i === 0 ? base : `${base}_${i + 1}`);
    const inputPortIdByTarget = new Map<string, string>();
    inputTargetIds.forEach((targetId, i) => {
      inputPortIdByTarget.set(targetId, nameWithIndex('in', i));
    });
    const outputPortIdBySource = new Map<string, string>();
    outputSourceIds.forEach((sourceId, i) => {
      outputPortIdBySource.set(sourceId, nameWithIndex('out', i));
    });

    const inputAnchorNodes: DiagramNode[] = [...inputPortIdByTarget.entries()].map(
      ([, portId], i) => ({
        id: portId,
        type: 'compound-input',
        label: portId,
        x: BODY_MARGIN,
        y: BODY_MARGIN + i * (NODE_H + 20),
      }),
    );
    const outputAnchorNodes: DiagramNode[] = [...outputPortIdBySource.entries()].map(
      ([, portId], i) => ({
        id: portId,
        type: 'compound-output',
        label: portId,
        x: BODY_MARGIN + 700,
        y: BODY_MARGIN + i * (NODE_H + 20),
      }),
    );

    const linearOne = () => ({
      weight: 1,
      transferMode: 'linear' as const,
      transferPoints: [
        { x: -100, y: -100 },
        { x: 100, y: 100 },
      ],
    });
    const innerInputEdges: DiagramConnection[] = [...inputPortIdByTarget.entries()].map(
      ([targetId, portId], i) => ({
        id: `${compoundTypeId}/in-${i}`,
        from: portId,
        to: targetId,
        ...linearOne(),
      }),
    );
    const innerOutputEdges: DiagramConnection[] = [...outputPortIdBySource.entries()].map(
      ([sourceId, portId], i) => ({
        id: `${compoundTypeId}/out-${i}`,
        from: sourceId,
        to: portId,
        ...linearOne(),
      }),
    );

    const def: CompoundTypeDefinition = {
      id: compoundTypeId,
      displayName: `Compound ${nextNumber}`,
      body: {
        nodes: [...inputAnchorNodes, ...bodyNodes, ...outputAnchorNodes],
        connections: [...internalConns, ...innerInputEdges, ...innerOutputEdges],
      },
    };

    const instanceId = `compound-inst-${uuidSuffix()}`;
    const instanceNode: DiagramNode = {
      id: instanceId,
      type: 'compound',
      label: def.displayName,
      x: cx,
      y: cy,
      compoundTypeId,
    };

    const rewiredConnections: DiagramConnection[] = [];
    for (const conn of connections) {
      if (isInternal(conn)) continue;
      const inboundPort = selectedIds.has(conn.to) && !selectedIds.has(conn.from)
        ? inputPortIdByTarget.get(conn.to)
        : undefined;
      const outboundPort = selectedIds.has(conn.from) && !selectedIds.has(conn.to)
        ? outputPortIdBySource.get(conn.from)
        : undefined;
      if (inboundPort) {
        rewiredConnections.push({ ...conn, to: instanceId, toPort: inboundPort });
      } else if (outboundPort) {
        rewiredConnections.push({ ...conn, from: instanceId, fromPort: outboundPort });
      } else {
        rewiredConnections.push(conn);
      }
    }

    this.transactLocal(() => {
      this.compoundTypes.set(def.id, compoundTypeToYMap(def) as YNode);
      const nodeContainer = this.contextNodeContainer();
      for (const removedId of selectedIds) nodeContainer.delete(removedId);
      nodeContainer.set(instanceNode.id, nodeToYMap(instanceNode) as YNode);
      this.replaceConnections(this.contextConnectionContainer(), rewiredConnections);
    });

    return { instanceId };
  }

  /** Inline one compound instance back into its parent (inverse of group). */
  ungroup(instanceId: string): void {
    if (this.readOnly) return;
    const nodes = this.contextNodes();
    const connections = this.contextConnections();
    const instance = nodes.find((n) => n.id === instanceId);
    if (!instance || instance.type !== 'compound' || !instance.compoundTypeId) return;
    const def = this.snapshot.compoundTypes.find((c) => c.id === instance.compoundTypeId);
    if (!def) return;

    const prefix = `${instance.id}/`;
    const idRemap = new Map<string, string>();
    for (const n of def.body.nodes) idRemap.set(n.id, prefix + n.id);

    const bodyXs = def.body.nodes.map((n) => n.x);
    const bodyYs = def.body.nodes.map((n) => n.y);
    const bodyCx = bodyXs.length ? (Math.min(...bodyXs) + Math.max(...bodyXs)) / 2 : 0;
    const bodyCy = bodyYs.length ? (Math.min(...bodyYs) + Math.max(...bodyYs)) / 2 : 0;
    const dx = instance.x - bodyCx;
    const dy = instance.y - bodyCy;

    const inlinedNodes: DiagramNode[] = def.body.nodes.map((n) => ({
      ...n,
      id: idRemap.get(n.id)!,
      type:
        n.type === 'compound-input' || n.type === 'compound-output'
          ? 'compute-summation'
          : n.type,
      x: n.x + dx,
      y: n.y + dy,
    }));
    const inlinedConns: DiagramConnection[] = def.body.connections.map((c) => ({
      ...c,
      id: prefix + c.id,
      from: idRemap.get(c.from) ?? c.from,
      to: idRemap.get(c.to) ?? c.to,
    }));

    const rewiredExternal: DiagramConnection[] = [];
    for (const conn of connections) {
      if (conn.from === instance.id) {
        if (!conn.fromPort) continue;
        const anchorId = prefix + conn.fromPort;
        if (!idRemap.has(conn.fromPort)) continue;
        const { fromPort: _fp, toPort: _tp, ...rest } = conn;
        void _fp;
        void _tp;
        rewiredExternal.push({ ...rest, from: anchorId });
      } else if (conn.to === instance.id) {
        if (!conn.toPort) continue;
        const anchorId = prefix + conn.toPort;
        if (!idRemap.has(conn.toPort)) continue;
        const { fromPort: _fp, toPort: _tp, ...rest } = conn;
        void _fp;
        void _tp;
        rewiredExternal.push({ ...rest, to: anchorId });
      } else {
        rewiredExternal.push(conn);
      }
    }

    this.transactLocal(() => {
      const nodeContainer = this.contextNodeContainer();
      nodeContainer.delete(instance.id);
      for (const n of inlinedNodes) nodeContainer.set(n.id, nodeToYMap(n) as YNode);
      this.replaceConnections(this.contextConnectionContainer(), [...rewiredExternal, ...inlinedConns]);
    });
  }

  private replaceConnections(container: Container, next: DiagramConnection[]): void {
    container.clear();
    for (const connection of next) {
      container.set(connection.id, connectionToYMap(connection) as YNode);
    }
  }
}

export const diagramStore = new DiagramStore();
