import { createServer, type Server as HttpServer, type IncomingMessage } from 'node:http';
import { randomInt, randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import {
  readSyncMessage,
  writeSyncStep1,
  writeUpdate,
} from 'y-protocols/sync';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import {
  PROTOCOL_VERSION,
  messageAwareness,
  messageSync,
  type ClientMessage,
  type HelloMessage,
  type Participant,
  type Role,
  type ServerMessage,
} from './protocol.js';

export interface RelayOptions {
  port?: number;
  host?: string;
  /** Grace window a disconnected host has to rejoin before the room closes. */
  hostGraceMs?: number;
  /** Max join attempts allowed per IP inside `rateLimitWindowMs`. */
  rateLimitMax?: number;
  rateLimitWindowMs?: number;
  /** Max rooms one IP may create inside `rateLimitWindowMs`. */
  roomCreateMax?: number;
  /** Ping interval for dead-socket detection (half-open connections). */
  heartbeatMs?: number;
  /**
   * Trust the X-Forwarded-For header for the client IP. Enable ONLY when the
   * relay sits behind a reverse proxy (Apache/nginx) that overwrites the
   * header — otherwise clients can spoof it to bypass the per-IP limiters.
   */
  trustProxy?: boolean;
  /** Injectable clock for tests. */
  now?: () => number;
}

export interface RelayHandle {
  readonly port: number;
  readonly roomCount: number;
  close(): Promise<void>;
}

interface ConnState {
  ws: WebSocket;
  ip: string;
  room: Room | null;
  participantId: string;
  name: string;
  role: Role;
  isHost: boolean;
  token: string;
  admitted: boolean;
  /** Set while queued as a pending guest. */
  requestId: string | null;
  /** Awareness client ids this connection currently controls (for cleanup). */
  awarenessIds: Set<number>;
  /** Heartbeat flag: set on pong, cleared on ping; dead sockets terminate. */
  alive: boolean;
}

interface Room {
  code: string;
  hostToken: string;
  hostAppVersion: string;
  hostProtocolVersion: number;
  doc: Y.Doc;
  awareness: Awareness;
  host: ConnState | null;
  members: Set<ConnState>;
  pending: Map<string, ConnState>;
  /** token -> last-known participant, so a dropped guest can rejoin silently. */
  knownGuests: Map<string, Participant>;
  locked: boolean;
  graceTimer: ReturnType<typeof setTimeout> | null;
}

const DEFAULTS = {
  hostGraceMs: 30_000,
  rateLimitMax: 20,
  rateLimitWindowMs: 60_000,
  roomCreateMax: 10,
  heartbeatMs: 30_000,
};

function send(conn: ConnState, msg: ServerMessage): void {
  if (conn.ws.readyState === WebSocket.OPEN) {
    conn.ws.send(JSON.stringify(msg));
  }
}

function sendBinary(conn: ConnState, payload: Uint8Array): void {
  if (conn.ws.readyState === WebSocket.OPEN) {
    conn.ws.send(payload);
  }
}

export function createRelayServer(options: RelayOptions = {}): Promise<RelayHandle> {
  const hostGraceMs = options.hostGraceMs ?? DEFAULTS.hostGraceMs;
  const rateLimitMax = options.rateLimitMax ?? DEFAULTS.rateLimitMax;
  const rateLimitWindowMs = options.rateLimitWindowMs ?? DEFAULTS.rateLimitWindowMs;
  const roomCreateMax = options.roomCreateMax ?? DEFAULTS.roomCreateMax;
  const heartbeatMs = options.heartbeatMs ?? DEFAULTS.heartbeatMs;
  const trustProxy = options.trustProxy ?? false;
  const now = options.now ?? (() => Date.now());

  const rooms = new Map<string, Room>();
  const conns = new Map<WebSocket, ConnState>();
  const joinAttempts = new Map<string, number[]>();
  const roomCreations = new Map<string, number[]>();

  const http: HttpServer = createServer((_req, res) => {
    res.writeHead(426, { 'content-type': 'text/plain' });
    res.end('This is a Braitenbot collaboration relay; connect over WebSocket.\n');
  });
  const wss = new WebSocketServer({ server: http });

  // --- helpers -----------------------------------------------------------

  function generateCode(): string {
    for (let i = 0; i < 1000; i++) {
      // Crypto randomness: room codes are the only join credential.
      const code = String(randomInt(100000, 1000000));
      if (!rooms.has(code)) return code;
    }
    // Astronomically unlikely; fall back to a longer unique string.
    return randomUUID().slice(0, 6);
  }

  // Sliding-window per-IP limiter shared by join attempts and room creation.
  function limited(counters: Map<string, number[]>, ip: string, max: number): boolean {
    const cutoff = now() - rateLimitWindowMs;
    const hits = (counters.get(ip) ?? []).filter((t) => t > cutoff);
    hits.push(now());
    counters.set(ip, hits);
    return hits.length > max;
  }

  // Drop limiter entries whose newest hit fell out of the window (run
  // periodically from the heartbeat so idle IPs don't accumulate forever).
  function pruneLimiter(counters: Map<string, number[]>): void {
    const cutoff = now() - rateLimitWindowMs;
    for (const [ip, hits] of counters) {
      if (hits.length === 0 || hits[hits.length - 1] <= cutoff) counters.delete(ip);
    }
  }

  function participantOf(conn: ConnState): Participant {
    return { id: conn.participantId, name: conn.name, role: conn.role, isHost: conn.isHost };
  }

  function roster(room: Room): Participant[] {
    const list: Participant[] = [];
    for (const member of room.members) list.push(participantOf(member));
    // Stable order: host first, then by id.
    list.sort((a, b) => (a.isHost === b.isHost ? a.id.localeCompare(b.id) : a.isHost ? -1 : 1));
    return list;
  }

  function broadcastRoster(room: Room): void {
    const msg: ServerMessage = { type: 'roster', participants: roster(room), locked: room.locked };
    for (const member of room.members) send(member, msg);
  }

  function broadcastBinary(room: Room, payload: Uint8Array, except: ConnState | null): void {
    for (const member of room.members) {
      if (member !== except) sendBinary(member, payload);
    }
  }

  // Send this connection the initial sync step + current awareness snapshot.
  function beginSync(room: Room, conn: ConnState): void {
    const syncEncoder = encoding.createEncoder();
    encoding.writeVarUint(syncEncoder, messageSync);
    writeSyncStep1(syncEncoder, room.doc);
    sendBinary(conn, encoding.toUint8Array(syncEncoder));

    const states = room.awareness.getStates();
    if (states.size > 0) {
      const awEncoder = encoding.createEncoder();
      encoding.writeVarUint(awEncoder, messageAwareness);
      encoding.writeVarUint8Array(
        awEncoder,
        encodeAwarenessUpdate(room.awareness, [...states.keys()]),
      );
      sendBinary(conn, encoding.toUint8Array(awEncoder));
    }
  }

  function admitToRoom(room: Room, conn: ConnState): void {
    conn.room = room;
    conn.admitted = true;
    conn.requestId = null;
    room.members.add(conn);
    beginSync(room, conn);
    broadcastRoster(room);
  }

  function closeRoom(room: Room, reason: 'host-left' | 'server-shutdown'): void {
    if (room.graceTimer) clearTimeout(room.graceTimer);
    const msg: ServerMessage = { type: 'session-ended', reason };
    for (const member of [...room.members]) {
      send(member, msg);
      member.room = null;
      member.admitted = false;
      member.ws.close();
    }
    for (const pending of room.pending.values()) {
      pending.ws.close();
    }
    room.awareness.destroy();
    room.doc.destroy();
    rooms.delete(room.code);
  }

  // --- Yjs wiring per room ------------------------------------------------

  function wireRoomDoc(room: Room): void {
    room.doc.on('update', (update: Uint8Array, origin: unknown) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      writeUpdate(encoder, update);
      const payload = encoding.toUint8Array(encoder);
      broadcastBinary(room, payload, origin instanceof Object ? (origin as ConnState) : null);
    });
    room.awareness.on(
      'update',
      ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
        const changed = added.concat(updated, removed);
        const conn = origin && conns.has((origin as ConnState).ws) ? (origin as ConnState) : null;
        if (conn) {
          for (const id of added) conn.awarenessIds.add(id);
          for (const id of updated) conn.awarenessIds.add(id);
          for (const id of removed) conn.awarenessIds.delete(id);
        }
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, messageAwareness);
        encoding.writeVarUint8Array(encoder, encodeAwarenessUpdate(room.awareness, changed));
        broadcastBinary(room, encoding.toUint8Array(encoder), conn);
      },
    );
  }

  function handleBinary(conn: ConnState, data: Uint8Array): void {
    const room = conn.room;
    if (!room || !conn.admitted) return;
    const decoder = decoding.createDecoder(data);
    const messageType = decoding.readVarUint(decoder);
    if (messageType === messageSync) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      readSyncMessage(decoder, encoder, room.doc, conn);
      if (encoding.length(encoder) > 1) sendBinary(conn, encoding.toUint8Array(encoder));
    } else if (messageType === messageAwareness) {
      applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(decoder), conn);
    }
  }

  // --- session-protocol handling -----------------------------------------

  function handleHello(conn: ConnState, msg: HelloMessage): void {
    if (msg.protocolVersion !== PROTOCOL_VERSION) {
      send(conn, {
        type: 'rejected',
        reason: 'version-mismatch',
        message: `Relay protocol v${PROTOCOL_VERSION}, client v${msg.protocolVersion}. Update to join.`,
      });
      conn.ws.close();
      return;
    }
    if (msg.role === 'host') {
      handleHostHello(conn, msg);
    } else {
      handleGuestHello(conn, msg);
    }
  }

  function handleHostHello(conn: ConnState, msg: HelloMessage): void {
    conn.isHost = true;
    conn.name = msg.displayName?.trim() || 'Host';

    // Host reconnect: rejoin an existing room within the grace window.
    if (msg.code && msg.token) {
      const room = rooms.get(msg.code);
      if (!room || room.hostToken !== msg.token) {
        send(conn, { type: 'rejected', reason: 'no-room', message: 'That session is no longer available.' });
        conn.ws.close();
        return;
      }
      if (room.graceTimer) {
        clearTimeout(room.graceTimer);
        room.graceTimer = null;
      }
      // Evict a stale host socket whose close hasn't been processed yet (the
      // token proves the newcomer is the same host).
      if (room.host && room.host !== conn) {
        const stale = room.host;
        room.members.delete(stale);
        if (stale.awarenessIds.size > 0) {
          removeAwarenessStates(room.awareness, [...stale.awarenessIds], null);
        }
        stale.room = null;
        stale.admitted = false;
        room.host = null;
        stale.ws.close();
      }
      conn.participantId = 'host';
      conn.token = room.hostToken;
      conn.role = 'edit';
      room.host = conn;
      admitToRoom(room, conn);
      send(conn, { type: 'hosted', code: room.code, participantId: conn.participantId, token: room.hostToken });
      return;
    }

    // New room. Rate-limited per IP so one machine can't allocate unbounded
    // rooms (each room holds a Y.Doc in RAM).
    if (limited(roomCreations, conn.ip, roomCreateMax)) {
      send(conn, {
        type: 'rejected',
        reason: 'rate-limited',
        message: 'Too many sessions started from this address. Wait a moment and try again.',
      });
      conn.ws.close();
      return;
    }
    const doc = new Y.Doc();
    const room: Room = {
      code: generateCode(),
      hostToken: randomUUID(),
      hostAppVersion: msg.appVersion,
      hostProtocolVersion: msg.protocolVersion,
      doc,
      awareness: new Awareness(doc),
      host: conn,
      members: new Set(),
      pending: new Map(),
      knownGuests: new Map(),
      locked: false,
      graceTimer: null,
    };
    rooms.set(room.code, room);
    wireRoomDoc(room);

    conn.participantId = 'host';
    conn.token = room.hostToken;
    conn.role = 'edit';
    admitToRoom(room, conn);
    send(conn, { type: 'hosted', code: room.code, participantId: conn.participantId, token: room.hostToken });
  }

  function handleGuestHello(conn: ConnState, msg: HelloMessage): void {
    conn.isHost = false;
    conn.name = msg.displayName?.trim() || 'Guest';

    const room = msg.code ? rooms.get(msg.code) : undefined;
    if (!room) {
      send(conn, { type: 'rejected', reason: 'no-room', message: 'No session found for that code.' });
      conn.ws.close();
      return;
    }

    if (limited(joinAttempts, conn.ip, rateLimitMax)) {
      send(conn, {
        type: 'rejected',
        reason: 'rate-limited',
        message: 'Too many join attempts. Wait a moment and try again.',
      });
      conn.ws.close();
      return;
    }

    if (msg.appVersion !== room.hostAppVersion) {
      send(conn, {
        type: 'rejected',
        reason: 'version-mismatch',
        message: `Host is running v${room.hostAppVersion}. Update to join.`,
        hostVersion: room.hostAppVersion,
      });
      conn.ws.close();
      return;
    }

    // Silent guest reconnect via token.
    if (msg.token && room.knownGuests.has(msg.token)) {
      const prior = room.knownGuests.get(msg.token)!;
      conn.participantId = prior.id;
      conn.token = msg.token;
      conn.role = prior.role;
      conn.name = prior.name;
      admitToRoom(room, conn);
      send(conn, { type: 'admitted', participantId: conn.participantId, role: conn.role, token: conn.token });
      return;
    }

    if (room.locked) {
      send(conn, { type: 'rejected', reason: 'locked', message: 'The host has locked this session.' });
      conn.ws.close();
      return;
    }

    // Queue a join request for the host to admit or deny.
    conn.room = room;
    conn.requestId = randomUUID();
    conn.role = 'edit';
    room.pending.set(conn.requestId, conn);
    send(conn, { type: 'join-pending', requestId: conn.requestId });
    if (room.host) {
      send(room.host, { type: 'join-request', requestId: conn.requestId, name: conn.name });
    }
  }

  function handleControl(conn: ConnState, msg: ClientMessage): void {
    const room = conn.room;
    if (!room || room.host !== conn) return; // host-only controls
    switch (msg.type) {
      case 'admit': {
        const guest = room.pending.get(msg.requestId);
        if (!guest) return;
        room.pending.delete(msg.requestId);
        guest.participantId = randomUUID();
        guest.token = randomUUID();
        guest.role = msg.role ?? 'edit';
        room.knownGuests.set(guest.token, participantOf(guest));
        admitToRoom(room, guest);
        send(guest, { type: 'admitted', participantId: guest.participantId, role: guest.role, token: guest.token });
        break;
      }
      case 'deny': {
        const guest = room.pending.get(msg.requestId);
        if (!guest) return;
        room.pending.delete(msg.requestId);
        send(guest, { type: 'denied', message: 'The host declined your request to join.' });
        guest.ws.close();
        break;
      }
      case 'lock':
        room.locked = true;
        broadcastRoster(room);
        break;
      case 'unlock':
        room.locked = false;
        broadcastRoster(room);
        break;
      case 'remove': {
        for (const member of room.members) {
          if (member.participantId === msg.participantId && !member.isHost) {
            room.knownGuests.delete(member.token);
            send(member, { type: 'removed', message: 'The host removed you from the session.' });
            member.ws.close();
            break;
          }
        }
        break;
      }
      case 'set-role': {
        for (const member of room.members) {
          if (member.participantId === msg.participantId) {
            member.role = msg.role;
            if (room.knownGuests.has(member.token)) {
              room.knownGuests.set(member.token, participantOf(member));
            }
            broadcastRoster(room);
            break;
          }
        }
        break;
      }
      default:
        break;
    }
  }

  function handleText(conn: ConnState, text: string): void {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(text) as ClientMessage;
    } catch {
      return;
    }
    if (msg.type === 'hello') {
      if (conn.room) return; // already in a session; ignore duplicate hello
      handleHello(conn, msg);
      return;
    }
    if (msg.type === 'leave') {
      conn.ws.close();
      return;
    }
    handleControl(conn, msg);
  }

  function handleDisconnect(conn: ConnState): void {
    conns.delete(conn.ws);
    const room = conn.room;
    if (!room) return;

    if (conn.requestId) {
      room.pending.delete(conn.requestId);
    }

    if (room.members.has(conn)) {
      room.members.delete(conn);
      if (conn.awarenessIds.size > 0) {
        removeAwarenessStates(room.awareness, [...conn.awarenessIds], null);
      }
    }

    if (conn.isHost && room.host === conn) {
      room.host = null;
      // Keep the room (and guests) alive briefly so the host can rejoin.
      if (room.members.size === 0) {
        closeRoom(room, 'host-left');
      } else {
        room.graceTimer = setTimeout(() => closeRoom(room, 'host-left'), hostGraceMs);
        broadcastRoster(room);
      }
    } else if (rooms.has(room.code)) {
      broadcastRoster(room);
      if (room.members.size === 0 && !room.host) {
        closeRoom(room, 'host-left');
      }
    }
  }

  // --- connection lifecycle ----------------------------------------------

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // Behind a proxy every socket arrives from 127.0.0.1; without the real
    // client IP the whole campus would share one rate-limit bucket.
    const forwarded = trustProxy ? req.headers['x-forwarded-for'] : undefined;
    const forwardedIp = (Array.isArray(forwarded) ? forwarded[0] : forwarded)
      ?.split(',')[0]
      .trim();
    const ip = forwardedIp || req.socket.remoteAddress || 'unknown';
    const conn: ConnState = {
      ws,
      ip,
      room: null,
      participantId: '',
      name: '',
      role: 'edit',
      isHost: false,
      token: '',
      admitted: false,
      requestId: null,
      awarenessIds: new Set(),
      alive: true,
    };
    conns.set(ws, conn);

    ws.on('pong', () => {
      conn.alive = true;
    });

    ws.on('message', (data: Buffer | ArrayBuffer, isBinary: boolean) => {
      // A malformed frame must never take the process (and every room) down:
      // decoding/y-protocols throw on truncated or garbage input. Drop the
      // frame and close the offending socket.
      try {
        if (isBinary) {
          handleBinary(conn, new Uint8Array(data instanceof ArrayBuffer ? data : (data as Buffer)));
        } else {
          handleText(conn, data.toString());
        }
      } catch (err) {
        console.warn('[relay] dropping malformed frame:', err);
        ws.close();
      }
    });
    ws.on('close', () => {
      try {
        handleDisconnect(conn);
      } catch (err) {
        console.warn('[relay] error during disconnect cleanup:', err);
      }
    });
    ws.on('error', () => ws.close());
  });

  // Heartbeat: ping every connection; terminate sockets that never answered
  // the previous ping (half-open connections — closed laptop lids — otherwise
  // linger as ghost participants until TCP times out). Also prunes limiter
  // maps so idle IP entries don't accumulate.
  const heartbeatTimer = setInterval(() => {
    for (const [ws, conn] of conns) {
      if (!conn.alive) {
        ws.terminate(); // fires 'close' -> handleDisconnect
        continue;
      }
      conn.alive = false;
      ws.ping();
    }
    pruneLimiter(joinAttempts);
    pruneLimiter(roomCreations);
  }, heartbeatMs);

  return new Promise<RelayHandle>((resolve) => {
    http.listen(options.port ?? 0, options.host, () => {
      const address = http.address();
      const port = typeof address === 'object' && address ? address.port : (options.port ?? 0);
      resolve({
        get port() {
          return port;
        },
        get roomCount() {
          return rooms.size;
        },
        close(): Promise<void> {
          clearInterval(heartbeatTimer);
          for (const room of [...rooms.values()]) closeRoom(room, 'server-shutdown');
          return new Promise((res) => {
            wss.close(() => http.close(() => res()));
          });
        },
      });
    });
  });
}
