import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRelayServer, type RelayHandle } from '../../../relay/src/server';
import { DiagramStore } from '../../doc/DiagramStore';
import { SessionManager } from '../SessionManager';
import { serialize, type DiagramState } from '../../lib/diagramFile';

// End-to-end: two SessionManagers, each owning its own DiagramStore, syncing
// through the real relay over real WebSockets (Node >= 22 has a global
// WebSocket, so the browser-targeted SessionManager runs unmodified).

async function until(predicate: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

function initialState(): DiagramState {
  return {
    nodes: [
      { id: 'motor-left', type: 'servo-cr', label: 'Left Wheel', x: 0, y: 0, servoPin: '5' },
      { id: 'motor-right', type: 'servo-cr', label: 'Right Wheel', x: 100, y: 0, servoPin: '6' },
      { id: 'sensor-1', type: 'sensor-analog', label: 'Light', x: 40, y: 60, arduinoPort: 'A0' },
    ],
    connections: [
      {
        id: 'link-1',
        from: 'sensor-1',
        to: 'motor-left',
        weight: 1,
        transferMode: 'linear',
        transferPoints: [
          { x: -100, y: -100 },
          { x: 100, y: 100 },
        ],
      },
    ],
    loopPeriodMs: 20,
    compoundTypes: [],
    comments: [],
  };
}

describe('SessionManager end-to-end through the relay', () => {
  let relay: RelayHandle;
  let hostStore: DiagramStore;
  let guestStore: DiagramStore;
  let host: SessionManager;
  let guest: SessionManager;

  beforeEach(async () => {
    relay = await createRelayServer({ port: 0, hostGraceMs: 50 });
    hostStore = new DiagramStore();
    guestStore = new DiagramStore();
    const url = `ws://127.0.0.1:${relay.port}`;
    host = new SessionManager(hostStore, url);
    guest = new SessionManager(guestStore, url);
  });

  afterEach(async () => {
    guest.leave();
    host.leave();
    await relay.close();
  });

  async function hostAndJoin(): Promise<void> {
    host.host(initialState(), 'Teacher');
    await until(() => host.getState().code !== null, 'host code');

    guest.join(host.getState().code!, 'Sam');
    await until(() => host.getState().joinRequests.length === 1, 'join request');
    expect(host.getState().joinRequests[0].name).toBe('Sam');

    host.admit(host.getState().joinRequests[0].requestId);
    await until(() => guest.getState().status === 'joined', 'guest joined');
  }

  it('syncs the host diagram to an admitted guest and edits both ways', async () => {
    await hostAndJoin();

    // Guest received the host's pre-loaded diagram via swapDoc.
    await until(
      () => guestStore.getSnapshot().topNodes.some((n) => n.id === 'sensor-1'),
      'initial sync',
    );
    expect(guestStore.getSnapshot().topConnections.map((c) => c.id)).toEqual(['link-1']);

    // Host edit propagates to guest.
    hostStore.addNode({ id: 'const-1', type: 'constant', label: 'K', x: 5, y: 5, constantValue: 42 });
    await until(
      () => guestStore.getSnapshot().topNodes.some((n) => n.id === 'const-1'),
      'host edit at guest',
    );

    // Guest edit propagates to host.
    guestStore.patchNode('sensor-1', { label: 'Renamed by Sam' });
    await until(
      () => hostStore.getSnapshot().topNodes.find((n) => n.id === 'sensor-1')?.label === 'Renamed by Sam',
      'guest edit at host',
    );

    // Roster is visible on both sides with roles carried.
    const roster = guest.getState().participants;
    expect(roster.map((p) => p.name).sort()).toEqual(['Sam', 'Teacher']);
    expect(roster.every((p) => p.role === 'edit')).toBe(true);
  });

  it('runs the repair pass on remote updates (motor singleton restored)', async () => {
    await hostAndJoin();
    await until(
      () => guestStore.getSnapshot().topNodes.some((n) => n.id === 'sensor-1'),
      'initial sync',
    );

    // Guest deletes a wheel motor (no local repair runs for local edits).
    guestStore.removeNodeWithConnections('motor-left');
    expect(guestStore.getSnapshot().topNodes.some((n) => n.id === 'motor-left')).toBe(false);

    // The host receives it as a remote transaction, repairs the invariant, and
    // the repair syncs back — both peers converge with the motor restored.
    await until(
      () => hostStore.getSnapshot().topNodes.some((n) => n.id === 'motor-left'),
      'host repair',
    );
    await until(
      () => guestStore.getSnapshot().topNodes.some((n) => n.id === 'motor-left'),
      'repair synced back to guest',
    );
  });

  it('ends the session for the guest when the host leaves', async () => {
    await hostAndJoin();
    host.leave();
    await until(() => guest.getState().status === 'ended', 'guest ended');
    expect(guest.getState().endReason).toBe('host-left');
    // Guest still holds the full session diagram for the keep-a-copy flow.
    expect(guestStore.getSnapshot().topNodes.some((n) => n.id === 'sensor-1')).toBe(true);
  });

  it('reports a denial politely and never swaps the guest doc', async () => {
    host.host(initialState(), 'Teacher');
    await until(() => host.getState().code !== null, 'host code');

    const before = guestStore.getSnapshot();
    guest.join(host.getState().code!, 'Sam');
    await until(() => host.getState().joinRequests.length === 1, 'join request');
    host.deny(host.getState().joinRequests[0].requestId);
    await until(() => guest.getState().status === 'ended', 'guest denied');
    expect(guest.getState().endReason).toBe('denied');
    // The guest's own diagram was never replaced.
    expect(guestStore.getSnapshot()).toBe(before);
  });

  it('carries host role changes to the roster (view flag, phase-4 enforcement)', async () => {
    await hostAndJoin();
    const guestId = guest.getState().selfId!;
    host.setRole(guestId, 'view');
    await until(
      () => guest.getState().participants.find((p) => p.id === guestId)?.role === 'view',
      'role flag in roster',
    );
    await until(() => guest.getState().role === 'view', 'self role tracked from roster');
  });

  // (a) Presence: a peer's selection is published via awareness and visible.
  it('publishes remote selection through awareness presence', async () => {
    await hostAndJoin();
    await until(() => guest.getPresence().length === 1, 'guest sees host presence');
    await until(() => host.getPresence().length === 1, 'host sees guest presence');

    host.setPresenceSelection(['sensor-1', 'motor-left']);
    await until(() => {
      const peer = guest.getPresence()[0];
      return !!peer && peer.isHost && peer.selection.includes('sensor-1');
    }, 'host selection visible to guest');

    const hostPeer = guest.getPresence()[0];
    expect(hostPeer.selection).toEqual(['sensor-1', 'motor-left']);
    expect(hostPeer.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  // (b) View-only enforcement no-ops mutations; a role change re-enables them.
  it('gates a view-only guest at the store choke-point and re-enables on edit', async () => {
    await hostAndJoin();
    await until(
      () => guestStore.getSnapshot().topNodes.some((n) => n.id === 'sensor-1'),
      'initial sync',
    );
    const guestId = guest.getState().selfId!;

    host.setRole(guestId, 'view');
    await until(() => guest.getState().role === 'view', 'guest role view');
    await until(() => guestStore.isReadOnly(), 'store read-only');

    // Mutations silently no-op: nothing is added locally or synced to the host.
    guestStore.addNode({ id: 'view-add', type: 'constant', label: 'X', x: 0, y: 0, constantValue: 1 });
    expect(guestStore.getSnapshot().topNodes.some((n) => n.id === 'view-add')).toBe(false);
    guestStore.undo();
    guestStore.setTraceInput('sensor-1', 30);
    expect(guestStore.getTraceSnapshot().inputs['sensor-1']).toBeUndefined();

    // Back to edit: the same mutation now works and propagates to the host.
    host.setRole(guestId, 'edit');
    await until(() => !guestStore.isReadOnly(), 'store writable again');
    guestStore.addNode({ id: 'edit-add', type: 'constant', label: 'Y', x: 1, y: 1, constantValue: 2 });
    await until(
      () => hostStore.getSnapshot().topNodes.some((n) => n.id === 'edit-add'),
      'guest edit reaches host after re-enable',
    );
  });

  // (c) Shared trace: enable + seed + input + pulse all reach the guest.
  it('syncs shared trace state (enabled, seed, inputs, pulses) to the guest', async () => {
    await hostAndJoin();
    await until(
      () => guestStore.getSnapshot().topNodes.some((n) => n.id === 'sensor-1'),
      'initial sync',
    );

    hostStore.setTraceEnabled(true, 777);
    hostStore.setTraceInput('sensor-1', 42);
    hostStore.addTracePulse({ id: 'p1', sensorId: 'sensor-1', value: 100, startTick: 5, durationTicks: 10 });

    await until(() => {
      const t = guestStore.getTraceSnapshot();
      return (
        t.enabled &&
        t.seed === 777 &&
        t.inputs['sensor-1'] === 42 &&
        t.pulses.length === 1 &&
        t.pulses[0].sensorId === 'sensor-1'
      );
    }, 'shared trace state at guest');
  });

  // (d) Exiting trace clears the whole shared map for everyone.
  it('clears the shared trace map on trace exit', async () => {
    await hostAndJoin();
    await until(
      () => guestStore.getSnapshot().topNodes.some((n) => n.id === 'sensor-1'),
      'initial sync',
    );

    hostStore.setTraceEnabled(true, 5);
    hostStore.setTraceInput('sensor-1', 60);
    await until(() => guestStore.getTraceSnapshot().inputs['sensor-1'] === 60, 'trace on at guest');

    hostStore.setTraceEnabled(false);
    await until(() => {
      const t = guestStore.getTraceSnapshot();
      return !t.enabled && Object.keys(t.inputs).length === 0 && t.pulses.length === 0;
    }, 'trace cleared at guest');
  });

  // (e) Trace state is never part of the serialized diagram.
  it('never leaks trace state into serialize() output', async () => {
    await hostAndJoin();
    await until(
      () => guestStore.getSnapshot().topNodes.some((n) => n.id === 'sensor-1'),
      'initial sync',
    );

    hostStore.setTraceEnabled(true, 9);
    hostStore.setTraceInput('sensor-1', 88);
    await until(() => guestStore.getTraceSnapshot().inputs['sensor-1'] === 88, 'trace synced');

    const snap = guestStore.getSnapshot();
    const text = serialize({
      nodes: snap.topNodes,
      connections: snap.topConnections,
      loopPeriodMs: snap.loopPeriodMs,
      compoundTypes: snap.compoundTypes,
      comments: snap.comments,
    });
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual([
      'comments',
      'compoundTypes',
      'connections',
      'loopPeriodMs',
      'nodes',
    ]);
    expect(text).not.toContain('trace');
    expect(text).not.toContain('enabled');
    expect(text).not.toContain('88');
  });
});
