import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { readSyncMessage, writeSyncStep1, writeUpdate } from 'y-protocols/sync';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from 'y-protocols/awareness';
import type { DiagramState } from '../lib/diagramFile';
import { ORIGIN_REMOTE } from '../doc/origins';
import { loadDiagramInto } from '../doc/yconvert';
import { diagramStore, type DiagramStore } from '../doc/DiagramStore';
import { APP_VERSION, DEFAULT_RELAY_URL } from './config';
import {
  EMPTY_PRESENCE,
  presenceColor,
  type DragPresence,
  type LocalPresence,
  type PeerPresence,
  type Point,
  type ViewportPresence,
} from './presence';
import {
  PROTOCOL_VERSION,
  messageAwareness,
  messageSync,
  type ClientMessage,
  type Participant,
  type Role,
  type ServerMessage,
} from './protocol';

export type SessionStatus =
  | 'idle'
  | 'hosting'
  | 'requesting'
  | 'joined'
  | 'reconnecting'
  | 'ended';

export type SessionEndReason =
  | 'denied'
  | 'rejected'
  | 'removed'
  | 'host-left'
  | 'error';

export interface JoinRequest {
  requestId: string;
  name: string;
}

export interface SessionState {
  status: SessionStatus;
  /** True when this client created the session. */
  isHost: boolean;
  /** The 6-digit room code (host receives it; guests entered it). */
  code: string | null;
  selfId: string | null;
  role: Role;
  participants: Participant[];
  locked: boolean;
  /** Pending guest join requests (host only) — rendered as toasts. */
  joinRequests: JoinRequest[];
  /** WebSocket is open and admitted (false while status is 'reconnecting'). */
  connected: boolean;
  /** Why the session ended / the join failed (status 'ended'). */
  endReason: SessionEndReason | null;
  endMessage: string | null;
}

const IDLE_STATE: SessionState = {
  status: 'idle',
  isHost: false,
  code: null,
  selfId: null,
  role: 'edit',
  participants: [],
  locked: false,
  joinRequests: [],
  connected: false,
  endReason: null,
  endMessage: null,
};

const MAX_BACKOFF_MS = 10_000;

function buildDocFrom(state: DiagramState): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    loadDiagramInto(
      doc.getMap('nodes'),
      doc.getMap('connections'),
      doc.getMap('compoundTypes'),
      doc.getMap('meta'),
      state,
    );
  });
  return doc;
}

/**
 * Owns the WebSocket to the relay plus the Yjs sync/awareness provider logic.
 * Hosting swaps a fresh doc (pre-loaded with the current diagram) into the
 * DiagramStore and shares it; joining swaps in the synced session doc after
 * admission. Exposed via useSyncExternalStore-style subscribe/getState.
 */
export class SessionManager {
  private store: DiagramStore;
  private relayUrl: string;

  private state: SessionState = IDLE_STATE;
  private listeners = new Set<() => void>();

  private ws: WebSocket | null = null;
  private doc: Y.Doc | null = null;
  private awareness: Awareness | null = null;
  private token: string | null = null;

  // Presence: local awareness state we publish, plus a derived snapshot of
  // remote peers (excluding self) exposed to React via subscribePresence.
  private localPresence: LocalPresence | null = null;
  private presenceSnapshot: PeerPresence[] = EMPTY_PRESENCE;
  private presenceListeners = new Set<() => void>();
  // The relay sends the room's awareness snapshot (containing existing peers)
  // right before the admitted/hosted verdict — i.e. before attachSync creates
  // our Awareness. Buffer those early frames and drain them once attached.
  private pendingAwareness: Uint8Array[] = [];

  private displayName = '';
  private intentionalClose = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(store: DiagramStore = diagramStore, relayUrl: string = DEFAULT_RELAY_URL) {
    this.store = store;
    this.relayUrl = relayUrl;
  }

  // --- subscription --------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = (): SessionState => this.state;

  private setState(patch: Partial<SessionState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  // --- public API -----------------------------------------------------------

  /** Start hosting: share a fresh doc pre-loaded with the given diagram. */
  host(initial: DiagramState, displayName: string): void {
    if (this.state.status !== 'idle' && this.state.status !== 'ended') return;
    this.displayName = displayName.trim() || 'Host';
    this.doc = buildDocFrom(initial);
    this.store.swapDoc(this.doc);
    this.token = null;
    this.setState({
      ...IDLE_STATE,
      status: 'hosting',
      isHost: true,
      connected: false,
    });
    this.connect();
  }

  /** Request to join an existing session. The doc swaps in after admission. */
  join(code: string, displayName: string): void {
    if (this.state.status !== 'idle' && this.state.status !== 'ended') return;
    this.displayName = displayName.trim() || 'Guest';
    this.doc = new Y.Doc();
    this.token = null;
    this.setState({
      ...IDLE_STATE,
      status: 'requesting',
      isHost: false,
      code,
    });
    this.connect();
  }

  /**
   * Leave the session intentionally. For the host this ends the session for
   * everyone. Callers handle keep-a-copy / personal-slot restore themselves.
   */
  leave(): void {
    this.intentionalClose = true;
    this.sendControl({ type: 'leave' });
    this.teardown();
    this.state = IDLE_STATE;
    this.setState({});
  }

  /** Dismiss the 'ended' state (after the keep-a-copy flow completes). */
  acknowledgeEnd(): void {
    if (this.state.status !== 'ended') return;
    this.state = IDLE_STATE;
    this.setState({});
  }

  // Host controls.
  admit(requestId: string, role: Role = 'edit'): void {
    this.sendControl({ type: 'admit', requestId, role });
    this.setState({
      joinRequests: this.state.joinRequests.filter((r) => r.requestId !== requestId),
    });
  }

  deny(requestId: string): void {
    this.sendControl({ type: 'deny', requestId });
    this.setState({
      joinRequests: this.state.joinRequests.filter((r) => r.requestId !== requestId),
    });
  }

  setLocked(locked: boolean): void {
    this.sendControl({ type: locked ? 'lock' : 'unlock' });
  }

  removeParticipant(participantId: string): void {
    this.sendControl({ type: 'remove', participantId });
  }

  setRole(participantId: string, role: Role): void {
    this.sendControl({ type: 'set-role', participantId, role });
  }

  // --- connection lifecycle -------------------------------------------------

  private connect(): void {
    this.intentionalClose = false;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.relayUrl);
    } catch {
      this.endSession('error', 'Could not reach the collaboration relay.');
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.addEventListener('open', () => {
      if (this.ws !== ws) return;
      const hello = {
        type: 'hello' as const,
        protocolVersion: PROTOCOL_VERSION,
        appVersion: APP_VERSION,
        role: this.state.isHost ? ('host' as const) : ('guest' as const),
        displayName: this.displayName,
        code: this.state.code ?? undefined,
        token: this.token ?? undefined,
      };
      ws.send(JSON.stringify(hello));
    });

    ws.addEventListener('message', (event: MessageEvent) => {
      if (this.ws !== ws) return;
      if (typeof event.data === 'string') {
        this.handleServerMessage(JSON.parse(event.data) as ServerMessage);
      } else {
        this.handleBinary(new Uint8Array(event.data as ArrayBuffer));
      }
    });

    ws.addEventListener('close', () => {
      if (this.ws !== ws) return;
      this.handleClose();
    });
  }

  private handleClose(): void {
    this.detachSync();
    this.ws = null;
    if (this.intentionalClose) return;
    const { status } = this.state;
    if (status === 'idle' || status === 'ended') return;
    if (status === 'requesting') {
      // Closed before a verdict (denied/rejected set 'ended' themselves).
      this.endSession('error', 'Connection to the session was lost before joining.');
      return;
    }
    // Active session interrupted: keep the doc, reconnect with backoff.
    this.setState({ status: 'reconnecting', connected: false });
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = Math.min(1000 * 2 ** this.reconnectAttempt, MAX_BACKOFF_MS);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.state.status === 'reconnecting') this.connect();
    }, delay);
  }

  private teardown(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempt = 0;
    this.detachSync();
    // Leaving/ending the session drops any view-only enforcement.
    this.store.setReadOnly(false);
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    }
    this.doc = null;
    this.token = null;
  }

  private endSession(reason: SessionEndReason, message: string | null): void {
    this.intentionalClose = true;
    this.teardown();
    this.setState({
      status: 'ended',
      connected: false,
      joinRequests: [],
      endReason: reason,
      endMessage: message,
    });
  }

  // --- session protocol -----------------------------------------------------

  private handleServerMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'hosted':
        this.token = msg.token;
        this.setState({
          status: 'hosting',
          code: msg.code,
          selfId: msg.participantId,
          role: 'edit',
          connected: true,
        });
        this.reconnectAttempt = 0;
        this.applyReadOnly();
        if (this.doc) this.attachSync(this.doc);
        break;
      case 'join-pending':
        break;
      case 'join-request':
        this.setState({
          joinRequests: [...this.state.joinRequests, { requestId: msg.requestId, name: msg.name }],
        });
        break;
      case 'admitted': {
        this.token = msg.token;
        const rejoining = this.state.status === 'reconnecting';
        this.setState({
          status: 'joined',
          selfId: msg.participantId,
          role: msg.role,
          connected: true,
        });
        this.reconnectAttempt = 0;
        this.applyReadOnly();
        if (this.doc) {
          if (!rejoining) this.store.swapDoc(this.doc);
          this.attachSync(this.doc);
        }
        break;
      }
      case 'denied':
        this.endSession('denied', msg.message);
        break;
      case 'rejected':
        if (this.state.status === 'reconnecting') {
          // The room died while we were away: treat like the session ending.
          this.endSession('host-left', 'The session is no longer available.');
        } else {
          this.endSession('rejected', msg.message);
        }
        break;
      case 'roster': {
        // Track our own role flag from the roster (enforcement is phase 4).
        const self = msg.participants.find((p) => p.id === this.state.selfId);
        this.setState({
          participants: msg.participants,
          locked: msg.locked,
          role: self?.role ?? this.state.role,
        });
        // A live role change (host toggles view/edit) re-gates the store.
        this.applyReadOnly();
        break;
      }
      case 'removed':
        this.endSession('removed', msg.message);
        break;
      case 'session-ended':
        this.endSession('host-left', msg.message ?? 'The host ended the session.');
        break;
    }
  }

  private sendControl(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  // --- Yjs sync + awareness over the same socket ----------------------------

  private docUpdateHandler = (update: Uint8Array, origin: unknown): void => {
    if (origin === ORIGIN_REMOTE) return; // never echo remote updates back
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    writeUpdate(encoder, update);
    this.sendBinary(encoding.toUint8Array(encoder));
  };

  private awarenessUpdateHandler = ({
    added,
    updated,
    removed,
  }: {
    added: number[];
    updated: number[];
    removed: number[];
  }): void => {
    const awareness = this.awareness;
    if (!awareness) return;
    const local = awareness.clientID;
    const changed = added.concat(updated, removed).filter((id) => id === local);
    if (changed.length === 0) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageAwareness);
    encoding.writeVarUint8Array(encoder, encodeAwarenessUpdate(awareness, changed));
    this.sendBinary(encoding.toUint8Array(encoder));
  };

  private attachSync(doc: Y.Doc): void {
    // Capture early-arrived awareness frames (the room's existing-peers
    // snapshot) before detachSync clears the buffer.
    const pending = this.pendingAwareness;
    this.pendingAwareness = [];
    this.detachSync();
    doc.on('update', this.docUpdateHandler);
    this.awareness = new Awareness(doc);
    this.awareness.on('update', this.awarenessUpdateHandler);
    this.awareness.on('change', this.awarenessChangeHandler);

    // Seed our full local presence. Color is deterministic from our stable
    // participant id, so every peer colors us identically.
    const id = this.state.selfId ?? String(this.awareness.clientID);
    this.localPresence = {
      user: { id, name: this.displayName, color: presenceColor(id), isHost: this.state.isHost },
      selection: [],
      editingContext: null,
      dragging: null,
      cursor: null,
      viewport: null,
    };
    this.awareness.setLocalState(this.localPresence);
    // Replay the captured pre-attach frames, then rebuild once.
    for (const update of pending) {
      applyAwarenessUpdate(this.awareness, update, this);
    }
    this.rebuildPresence();

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    writeSyncStep1(encoder, doc);
    this.sendBinary(encoding.toUint8Array(encoder));
  }

  private detachSync(): void {
    if (this.doc) this.doc.off('update', this.docUpdateHandler);
    if (this.awareness) {
      this.awareness.off('update', this.awarenessUpdateHandler);
      this.awareness.off('change', this.awarenessChangeHandler);
      this.awareness.destroy();
      this.awareness = null;
    }
    this.localPresence = null;
    this.pendingAwareness = [];
    if (this.presenceSnapshot !== EMPTY_PRESENCE) {
      this.presenceSnapshot = EMPTY_PRESENCE;
      for (const listener of this.presenceListeners) listener();
    }
  }

  // --- presence -------------------------------------------------------------

  subscribePresence = (listener: () => void): (() => void) => {
    this.presenceListeners.add(listener);
    return () => {
      this.presenceListeners.delete(listener);
    };
  };

  getPresence = (): PeerPresence[] => this.presenceSnapshot;

  private awarenessChangeHandler = ({
    added,
    updated,
    removed,
  }: {
    added: number[];
    updated: number[];
    removed: number[];
  }): void => {
    const local = this.awareness?.clientID;
    // Ignore updates that only touch our own state (e.g. our cursor at 30Hz),
    // so presence consumers don't re-render when no peer changed.
    if ([...added, ...updated, ...removed].every((id) => id === local)) return;
    this.rebuildPresence();
  };

  private rebuildPresence(): void {
    const awareness = this.awareness;
    if (!awareness) {
      this.presenceSnapshot = EMPTY_PRESENCE;
    } else {
      const local = awareness.clientID;
      const peers: PeerPresence[] = [];
      for (const [clientId, raw] of awareness.getStates()) {
        if (clientId === local) continue;
        const state = raw as Partial<LocalPresence>;
        if (!state.user) continue;
        peers.push({
          clientId,
          id: state.user.id ?? '',
          name: state.user.name ?? 'Guest',
          color: state.user.color ?? presenceColor(String(clientId)),
          isHost: !!state.user.isHost,
          selection: state.selection ?? [],
          editingContext: state.editingContext ?? null,
          dragging: state.dragging ?? null,
          cursor: state.cursor ?? null,
          viewport: state.viewport ?? null,
        });
      }
      peers.sort((a, b) => a.clientId - b.clientId);
      this.presenceSnapshot = peers;
    }
    for (const listener of this.presenceListeners) listener();
  }

  private patchLocalPresence(patch: Partial<LocalPresence>): void {
    if (!this.awareness || !this.localPresence) return;
    this.localPresence = { ...this.localPresence, ...patch };
    this.awareness.setLocalState(this.localPresence);
  }

  setPresenceSelection(selection: string[]): void {
    this.patchLocalPresence({ selection });
  }

  setPresenceEditingContext(editingContext: string | null): void {
    this.patchLocalPresence({ editingContext });
  }

  setPresenceDragging(dragging: DragPresence | null): void {
    this.patchLocalPresence({ dragging });
  }

  setPresenceCursor(cursor: Point | null): void {
    this.patchLocalPresence({ cursor });
  }

  setPresenceViewport(viewport: ViewportPresence | null): void {
    this.patchLocalPresence({ viewport });
  }

  /** Enforce the guest's live role at the store choke-point (host never view). */
  private applyReadOnly(): void {
    this.store.setReadOnly(!this.state.isHost && this.state.role === 'view');
  }

  private handleBinary(data: Uint8Array): void {
    const doc = this.doc;
    if (!doc) return;
    const decoder = decoding.createDecoder(data);
    const messageType = decoding.readVarUint(decoder);
    if (messageType === messageSync) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      readSyncMessage(decoder, encoder, doc, ORIGIN_REMOTE);
      if (encoding.length(encoder) > 1) this.sendBinary(encoding.toUint8Array(encoder));
    } else if (messageType === messageAwareness) {
      const update = decoding.readVarUint8Array(decoder);
      if (this.awareness) {
        applyAwarenessUpdate(this.awareness, update, this);
      } else {
        this.pendingAwareness.push(update);
      }
    }
  }

  private sendBinary(payload: Uint8Array): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(payload);
    }
  }
}

export const sessionManager = new SessionManager();
