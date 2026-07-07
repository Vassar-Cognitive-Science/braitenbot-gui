import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { readSyncMessage, writeSyncStep1, writeUpdate } from 'y-protocols/sync';
import { createRelayServer, type RelayHandle } from '../server';
import { PROTOCOL_VERSION, messageSync, type ServerMessage } from '../protocol';

const APP_VERSION = '0.4.0';

interface TestClient {
  ws: WebSocket;
  send(msg: unknown): void;
  waitFor(type: ServerMessage['type']): Promise<ServerMessage>;
  opened(): Promise<void>;
  closed(): Promise<void>;
  close(): void;
  /** Number of binary (Yjs sync/awareness) frames received so far. */
  binaryCount(): number;
}

function mkClient(port: number, headers?: Record<string, string>): TestClient {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers });
  ws.binaryType = 'arraybuffer';
  const queue: ServerMessage[] = [];
  const waiters: Array<{ type: string; resolve: (m: ServerMessage) => void }> = [];
  let binaryFrames = 0;

  ws.on('message', (data: Buffer | ArrayBuffer, isBinary: boolean) => {
    if (isBinary) {
      binaryFrames += 1;
      return;
    }
    const msg = JSON.parse(data.toString()) as ServerMessage;
    const idx = waiters.findIndex((w) => w.type === msg.type);
    if (idx >= 0) {
      const [w] = waiters.splice(idx, 1);
      w.resolve(msg);
    } else {
      queue.push(msg);
    }
  });

  return {
    ws,
    send(msg: unknown) {
      ws.send(JSON.stringify(msg));
    },
    binaryCount() {
      return binaryFrames;
    },
    waitFor(type) {
      const idx = queue.findIndex((m) => m.type === type);
      if (idx >= 0) return Promise.resolve(queue.splice(idx, 1)[0]);
      return new Promise((resolve) => waiters.push({ type, resolve }));
    },
    opened() {
      return new Promise((resolve, reject) => {
        if (ws.readyState === WebSocket.OPEN) return resolve();
        ws.on('open', () => resolve());
        ws.on('error', reject);
      });
    },
    closed() {
      return new Promise((resolve) => ws.on('close', () => resolve()));
    },
    close() {
      ws.close();
    },
  };
}

// A minimal Yjs sync client matching what the browser SessionManager speaks.
function startSync(ws: WebSocket, doc: Y.Doc): void {
  const REMOTE = Symbol('remote');
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, messageSync);
    writeUpdate(enc, update);
    ws.send(encoding.toUint8Array(enc));
  });
  ws.on('message', (data: ArrayBuffer, isBinary: boolean) => {
    if (!isBinary) return;
    const dec = decoding.createDecoder(new Uint8Array(data));
    const type = decoding.readVarUint(dec);
    if (type !== messageSync) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, messageSync);
    readSyncMessage(dec, enc, doc, REMOTE);
    if (encoding.length(enc) > 1) ws.send(encoding.toUint8Array(enc));
  });
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, messageSync);
  writeSyncStep1(enc, doc);
  ws.send(encoding.toUint8Array(enc));
}

function hostHello(extra: Record<string, unknown> = {}) {
  return { type: 'hello', protocolVersion: PROTOCOL_VERSION, appVersion: APP_VERSION, role: 'host', displayName: 'Teacher', ...extra };
}
function guestHello(code: string, extra: Record<string, unknown> = {}) {
  return { type: 'hello', protocolVersion: PROTOCOL_VERSION, appVersion: APP_VERSION, role: 'guest', displayName: 'Sam', code, ...extra };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('relay server', () => {
  let relay: RelayHandle;
  const clients: TestClient[] = [];

  beforeEach(async () => {
    relay = await createRelayServer({ port: 0, hostGraceMs: 60, rateLimitMax: 100 });
  });

  afterEach(async () => {
    for (const c of clients.splice(0)) c.close();
    await relay.close();
  });

  function client(): TestClient {
    const c = mkClient(relay.port);
    clients.push(c);
    return c;
  }

  it('creates a room with a 6-digit code', async () => {
    const host = client();
    await host.opened();
    host.send(hostHello());
    const hosted = await host.waitFor('hosted');
    expect(hosted.type).toBe('hosted');
    if (hosted.type === 'hosted') {
      expect(hosted.code).toMatch(/^\d{6}$/);
      expect(hosted.participantId).toBe('host');
      expect(hosted.token).toBeTruthy();
    }
    expect(relay.roomCount).toBe(1);
  });

  it('routes a join request to the host and admits on approval', async () => {
    const host = client();
    await host.opened();
    host.send(hostHello());
    const hosted = await host.waitFor('hosted');
    const code = hosted.type === 'hosted' ? hosted.code : '';

    const guest = client();
    await guest.opened();
    guest.send(guestHello(code));

    await guest.waitFor('join-pending');
    const req = await host.waitFor('join-request');
    expect(req.type === 'join-request' && req.name).toBe('Sam');

    if (req.type === 'join-request') host.send({ type: 'admit', requestId: req.requestId });
    const admitted = await guest.waitFor('admitted');
    expect(admitted.type).toBe('admitted');
    if (admitted.type === 'admitted') expect(admitted.role).toBe('edit');

    const roster = await guest.waitFor('roster');
    expect(roster.type === 'roster' && roster.participants.length).toBe(2);
  });

  it('denies a join request with a polite message', async () => {
    const host = client();
    await host.opened();
    host.send(hostHello());
    const hosted = await host.waitFor('hosted');
    const code = hosted.type === 'hosted' ? hosted.code : '';

    const guest = client();
    await guest.opened();
    guest.send(guestHello(code));
    const req = await host.waitFor('join-request');
    if (req.type === 'join-request') host.send({ type: 'deny', requestId: req.requestId });

    const denied = await guest.waitFor('denied');
    expect(denied.type).toBe('denied');
    await guest.closed();
  });

  it('rejects joins to a locked session', async () => {
    const host = client();
    await host.opened();
    host.send(hostHello());
    const hosted = await host.waitFor('hosted');
    const code = hosted.type === 'hosted' ? hosted.code : '';
    host.send({ type: 'lock' });
    await host.waitFor('roster');

    const guest = client();
    await guest.opened();
    guest.send(guestHello(code));
    const rejected = await guest.waitFor('rejected');
    expect(rejected.type === 'rejected' && rejected.reason).toBe('locked');
  });

  it('removes an admitted participant', async () => {
    const host = client();
    await host.opened();
    host.send(hostHello());
    const hosted = await host.waitFor('hosted');
    const code = hosted.type === 'hosted' ? hosted.code : '';

    const guest = client();
    await guest.opened();
    guest.send(guestHello(code));
    const req = await host.waitFor('join-request');
    if (req.type === 'join-request') host.send({ type: 'admit', requestId: req.requestId });
    const admitted = await guest.waitFor('admitted');
    const pid = admitted.type === 'admitted' ? admitted.participantId : '';

    host.send({ type: 'remove', participantId: pid });
    const removed = await guest.waitFor('removed');
    expect(removed.type).toBe('removed');
    await guest.closed();
  });

  it('rejects a guest whose app version differs from the host', async () => {
    const host = client();
    await host.opened();
    host.send(hostHello());
    const hosted = await host.waitFor('hosted');
    const code = hosted.type === 'hosted' ? hosted.code : '';

    const guest = client();
    await guest.opened();
    guest.send(guestHello(code, { appVersion: '9.9.9' }));
    const rejected = await guest.waitFor('rejected');
    expect(rejected.type === 'rejected' && rejected.reason).toBe('version-mismatch');
    expect(rejected.type === 'rejected' && rejected.hostVersion).toBe(APP_VERSION);
  });

  it('rejects a guest with an unknown room code', async () => {
    const guest = client();
    await guest.opened();
    guest.send(guestHello('000000'));
    const rejected = await guest.waitFor('rejected');
    expect(rejected.type === 'rejected' && rejected.reason).toBe('no-room');
  });

  it('ends the session for guests after the host leaves and does not return', async () => {
    const host = client();
    await host.opened();
    host.send(hostHello());
    const hosted = await host.waitFor('hosted');
    const code = hosted.type === 'hosted' ? hosted.code : '';

    const guest = client();
    await guest.opened();
    guest.send(guestHello(code));
    const req = await host.waitFor('join-request');
    if (req.type === 'join-request') host.send({ type: 'admit', requestId: req.requestId });
    await guest.waitFor('admitted');

    host.close();
    const ended = await guest.waitFor('session-ended');
    expect(ended.type === 'session-ended' && ended.reason).toBe('host-left');
  });

  it('keeps the room alive when the host rejoins within the grace window', async () => {
    const relay2 = await createRelayServer({ port: 0, hostGraceMs: 500 });
    try {
      const host = mkClient(relay2.port);
      await host.opened();
      host.send(hostHello());
      const hosted = await host.waitFor('hosted');
      const code = hosted.type === 'hosted' ? hosted.code : '';
      const token = hosted.type === 'hosted' ? hosted.token : '';

      const guest = mkClient(relay2.port);
      await guest.opened();
      guest.send(guestHello(code));
      const req = await host.waitFor('join-request');
      if (req.type === 'join-request') host.send({ type: 'admit', requestId: req.requestId });
      await guest.waitFor('admitted');

      host.close();
      const host2 = mkClient(relay2.port);
      await host2.opened();
      host2.send(hostHello({ code, token }));
      const rehosted = await host2.waitFor('hosted');
      expect(rehosted.type === 'hosted' && rehosted.code).toBe(code);
      // Guest is still in the session (never got session-ended). Roster may be
      // rebroadcast while the stale host socket tears down; wait until it
      // settles at exactly host + guest.
      let participants = 0;
      while (participants !== 2) {
        const roster = await host2.waitFor('roster');
        if (roster.type === 'roster') participants = roster.participants.length;
      }
      expect(participants).toBe(2);

      host2.close();
      guest.close();
    } finally {
      await relay2.close();
    }
  });

  it('rate-limits repeated join attempts from one IP', async () => {
    const relay2 = await createRelayServer({ port: 0, rateLimitMax: 2 });
    try {
      const host = mkClient(relay2.port);
      await host.opened();
      host.send(hostHello());
      const hosted = await host.waitFor('hosted');
      const code = hosted.type === 'hosted' ? hosted.code : '';

      let rateLimitedSeen = false;
      for (let i = 0; i < 4; i++) {
        const g = mkClient(relay2.port);
        await g.opened();
        g.send(guestHello(code));
        const msg = await Promise.race([
          g.waitFor('join-pending'),
          g.waitFor('rejected'),
        ]);
        if (msg.type === 'rejected' && msg.reason === 'rate-limited') rateLimitedSeen = true;
        g.close();
      }
      expect(rateLimitedSeen).toBe(true);
    } finally {
      await relay2.close();
    }
  });

  it('converges two admitted clients on a shared Y.Doc through the relay', async () => {
    const host = client();
    await host.opened();
    host.send(hostHello());
    const hosted = await host.waitFor('hosted');
    const code = hosted.type === 'hosted' ? hosted.code : '';

    const hostDoc = new Y.Doc();
    startSync(host.ws, hostDoc);
    hostDoc.getMap('nodes').set('n1', 'from-host');

    const guest = client();
    await guest.opened();
    guest.send(guestHello(code));
    const req = await host.waitFor('join-request');
    if (req.type === 'join-request') host.send({ type: 'admit', requestId: req.requestId });
    await guest.waitFor('admitted');

    const guestDoc = new Y.Doc();
    startSync(guest.ws, guestDoc);

    // Guest pulls the host's existing content.
    await waitFor(() => guestDoc.getMap('nodes').get('n1') === 'from-host');

    // Guest edits propagate back to the host.
    guestDoc.getMap('nodes').set('n2', 'from-guest');
    await waitFor(() => hostDoc.getMap('nodes').get('n2') === 'from-guest');

    expect(hostDoc.getMap('nodes').get('n2')).toBe('from-guest');
    expect(guestDoc.getMap('nodes').get('n1')).toBe('from-host');
  });

  // --- security / robustness ---------------------------------------------

  // Shorthand: create a room, admit one guest, return both with synced docs.
  async function hostWithAdmittedGuest(): Promise<{
    host: TestClient;
    hostDoc: Y.Doc;
    code: string;
    guest: TestClient;
    guestDoc: Y.Doc;
  }> {
    const host = client();
    await host.opened();
    host.send(hostHello());
    const hosted = await host.waitFor('hosted');
    const code = hosted.type === 'hosted' ? hosted.code : '';
    const hostDoc = new Y.Doc();
    startSync(host.ws, hostDoc);

    const guest = client();
    await guest.opened();
    guest.send(guestHello(code));
    const req = await host.waitFor('join-request');
    if (req.type === 'join-request') host.send({ type: 'admit', requestId: req.requestId });
    await guest.waitFor('admitted');
    const guestDoc = new Y.Doc();
    startSync(guest.ws, guestDoc);
    return { host, hostDoc, code, guest, guestDoc };
  }

  it('survives malformed binary frames from admitted clients (crash DoS)', async () => {
    const { host, hostDoc, code } = await hostWithAdmittedGuest();

    // Three malicious admitted guests, each sending a different bad frame:
    // empty, truncated sync header, truncated awareness header. The server
    // must drop the frame and close only that socket.
    const badFrames = [Buffer.alloc(0), Buffer.from([0]), Buffer.from([1])];
    for (const frame of badFrames) {
      const evil = client();
      await evil.opened();
      evil.send(guestHello(code, { displayName: 'Mallory' }));
      const req = await host.waitFor('join-request');
      if (req.type === 'join-request') host.send({ type: 'admit', requestId: req.requestId });
      await evil.waitFor('admitted');
      evil.ws.send(frame);
      await evil.closed(); // offending socket closed, process alive
    }

    // The relay is still up, the room survives, and sync still works: a new
    // guest joins and converges on a fresh host edit.
    expect(relay.roomCount).toBe(1);
    const late = client();
    await late.opened();
    late.send(guestHello(code, { displayName: 'Late' }));
    const req = await host.waitFor('join-request');
    if (req.type === 'join-request') host.send({ type: 'admit', requestId: req.requestId });
    await late.waitFor('admitted');
    const lateDoc = new Y.Doc();
    startSync(late.ws, lateDoc);
    hostDoc.getMap('nodes').set('after-attack', true);
    await waitFor(() => lateDoc.getMap('nodes').get('after-attack') === true);
  });

  it('never applies a pending guest\'s binary frames nor sends it sync data', async () => {
    const host = client();
    await host.opened();
    host.send(hostHello());
    const hosted = await host.waitFor('hosted');
    const code = hosted.type === 'hosted' ? hosted.code : '';
    const hostDoc = new Y.Doc();
    startSync(host.ws, hostDoc);
    hostDoc.getMap('nodes').set('n1', 'real'); // room has syncable content

    // Pending guest fires a doc update at the room before being admitted.
    const pending = client();
    await pending.opened();
    pending.send(guestHello(code, { displayName: 'Eve' }));
    await pending.waitFor('join-pending');
    const evilDoc = new Y.Doc();
    evilDoc.getMap('nodes').set('evil', true);
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, messageSync);
    writeUpdate(enc, Y.encodeStateAsUpdate(evilDoc));
    pending.ws.send(encoding.toUint8Array(enc));

    // Deny — this conn was never admitted, so its frames were dropped no
    // matter when the server processed them (no ordering race).
    const req = await host.waitFor('join-request');
    if (req.type === 'join-request') host.send({ type: 'deny', requestId: req.requestId });
    await pending.waitFor('denied');
    await pending.closed();
    expect(pending.binaryCount()).toBe(0); // no sync/awareness before admit

    // Positive control: a legit guest converges, and the room doc has no
    // trace of the pending guest's update.
    const guest = client();
    await guest.opened();
    guest.send(guestHello(code));
    const req2 = await host.waitFor('join-request');
    if (req2.type === 'join-request') host.send({ type: 'admit', requestId: req2.requestId });
    await guest.waitFor('admitted');
    const guestDoc = new Y.Doc();
    startSync(guest.ws, guestDoc);
    await waitFor(() => guestDoc.getMap('nodes').get('n1') === 'real');
    expect(guestDoc.getMap('nodes').has('evil')).toBe(false);
    expect(hostDoc.getMap('nodes').has('evil')).toBe(false);
  });

  it('ignores host-only controls sent by a guest', async () => {
    const { host, hostDoc, code, guest, guestDoc } = await hostWithAdmittedGuest();
    const guestAdmitted = await guest.waitFor('roster');
    const guestId =
      guestAdmitted.type === 'roster'
        ? guestAdmitted.participants.find((p) => !p.isHost)!.id
        : '';

    // Guest tries every host-only control.
    guest.send({ type: 'lock' });
    guest.send({ type: 'set-role', participantId: guestId, role: 'view' });
    guest.send({ type: 'remove', participantId: 'host' });
    guest.send({ type: 'admit', requestId: 'bogus' });
    guest.send({ type: 'deny', requestId: 'bogus' });

    // Barrier: a marker doc edit on the SAME socket — once the host sees it,
    // the server has processed every control message above.
    guestDoc.getMap('nodes').set('marker', 1);
    await waitFor(() => hostDoc.getMap('nodes').get('marker') === 1);

    // Lock had no effect: a newcomer's join request still reaches the host.
    const newcomer = client();
    await newcomer.opened();
    newcomer.send(guestHello(code, { displayName: 'Newcomer' }));
    const req = await host.waitFor('join-request');
    expect(req.type === 'join-request' && req.name).toBe('Newcomer');
    if (req.type === 'join-request') host.send({ type: 'admit', requestId: req.requestId });
    await newcomer.waitFor('admitted');

    // Roster after that admit (drain queued stale rosters until the
    // 3-participant one): host still present, guest role unchanged.
    let roster: ServerMessage;
    do {
      roster = await host.waitFor('roster');
    } while (roster.type === 'roster' && roster.participants.length !== 3);
    if (roster.type === 'roster') {
      expect(roster.locked).toBe(false);
      expect(roster.participants.some((p) => p.isHost)).toBe(true);
      expect(roster.participants.find((p) => p.id === guestId)?.role).toBe('edit');
    }
  });

  it('rejects reconnect tokens from a different room', async () => {
    // Room A (target of the impostors).
    const { code: codeA } = await hostWithAdmittedGuest();

    // Room B, capturing its host token and one admitted guest's token.
    const hostB = client();
    await hostB.opened();
    hostB.send(hostHello({ displayName: 'Host B' }));
    const hostedB = await hostB.waitFor('hosted');
    const codeB = hostedB.type === 'hosted' ? hostedB.code : '';
    const hostTokenB = hostedB.type === 'hosted' ? hostedB.token : '';

    const guestB = client();
    await guestB.opened();
    guestB.send(guestHello(codeB, { displayName: 'B-Guest' }));
    const reqB = await hostB.waitFor('join-request');
    if (reqB.type === 'join-request') hostB.send({ type: 'admit', requestId: reqB.requestId });
    const admittedB = await guestB.waitFor('admitted');
    const guestTokenB = admittedB.type === 'admitted' ? admittedB.token : '';

    // Guest token from room B used against room A: not silently admitted —
    // it falls through to a normal join request.
    const impostor = client();
    await impostor.opened();
    impostor.send(guestHello(codeA, { token: guestTokenB, displayName: 'Impostor' }));
    const verdict = await Promise.race([
      impostor.waitFor('join-pending'),
      impostor.waitFor('admitted'),
    ]);
    expect(verdict.type).toBe('join-pending');

    // Host token from room B used to "rejoin" room A: rejected outright.
    const hostImpostor = client();
    await hostImpostor.opened();
    hostImpostor.send(hostHello({ code: codeA, token: hostTokenB }));
    const rejected = await hostImpostor.waitFor('rejected');
    expect(rejected.type === 'rejected' && rejected.reason).toBe('no-room');
  });

  it('rate-limits room creation per IP', async () => {
    const relay2 = await createRelayServer({ port: 0, roomCreateMax: 2 });
    try {
      const results: string[] = [];
      for (let i = 0; i < 3; i++) {
        const h = mkClient(relay2.port);
        await h.opened();
        h.send(hostHello());
        const msg = await Promise.race([h.waitFor('hosted'), h.waitFor('rejected')]);
        results.push(
          msg.type === 'rejected' ? `rejected:${msg.reason}` : msg.type,
        );
        if (msg.type === 'rejected') await h.closed();
      }
      expect(results).toEqual(['hosted', 'hosted', 'rejected:rate-limited']);
      expect(relay2.roomCount).toBe(2);
    } finally {
      await relay2.close();
    }
  });

  it('buckets rate limits by X-Forwarded-For only when trustProxy is on', async () => {
    // With trustProxy, two clients from the same socket IP but different
    // forwarded IPs get separate buckets, and the forwarded bucket is honored.
    const trusted = await createRelayServer({ port: 0, roomCreateMax: 1, trustProxy: true });
    try {
      const hostFrom = async (xff: string) => {
        const h = mkClient(trusted.port, { 'x-forwarded-for': xff });
        await h.opened();
        h.send(hostHello());
        const msg = await Promise.race([h.waitFor('hosted'), h.waitFor('rejected')]);
        return msg.type === 'rejected' ? `rejected:${msg.reason}` : msg.type;
      };
      expect(await hostFrom('10.0.0.1')).toBe('hosted');
      expect(await hostFrom('10.0.0.2, 172.16.0.1')).toBe('hosted');
      expect(await hostFrom('10.0.0.1')).toBe('rejected:rate-limited');
    } finally {
      await trusted.close();
    }

    // Without trustProxy the header is ignored: same socket IP = one bucket.
    const untrusted = await createRelayServer({ port: 0, roomCreateMax: 1 });
    try {
      const first = mkClient(untrusted.port, { 'x-forwarded-for': '10.0.0.1' });
      await first.opened();
      first.send(hostHello());
      expect((await first.waitFor('hosted')).type).toBe('hosted');
      const second = mkClient(untrusted.port, { 'x-forwarded-for': '10.0.0.2' });
      await second.opened();
      second.send(hostHello());
      const verdict = await second.waitFor('rejected');
      expect(verdict.type === 'rejected' && verdict.reason).toBe('rate-limited');
    } finally {
      await untrusted.close();
    }
  });
});
