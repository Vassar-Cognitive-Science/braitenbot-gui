import { describe, it, expect, beforeEach } from 'vitest';
import { DiagramStore } from '../DiagramStore';
import type { DiagramConnection, DiagramNode } from '../../types/diagram';

function sensorNode(id: string, overrides: Partial<DiagramNode> = {}): DiagramNode {
  return { id, type: 'sensor-analog', label: id, x: 10, y: 20, arduinoPort: 'A0', ...overrides };
}

function connection(id: string, from: string, to: string): DiagramConnection {
  return {
    id,
    from,
    to,
    weight: 1,
    transferMode: 'linear',
    transferPoints: [
      { x: -100, y: -100 },
      { x: 100, y: 100 },
    ],
  };
}

describe('DiagramStore CRUD', () => {
  let store: DiagramStore;
  beforeEach(() => {
    store = new DiagramStore();
  });

  it('starts with the two wheel motors and nothing else', () => {
    const snap = store.getSnapshot();
    expect(snap.topNodes.map((n) => n.id).sort()).toEqual(['motor-left', 'motor-right']);
    expect(snap.topConnections).toEqual([]);
    expect(snap.compoundTypes).toEqual([]);
    expect(snap.loopPeriodMs).toBe(20);
  });

  it('adds, patches, moves and removes a node', () => {
    store.addNode(sensorNode('sensor-1'));
    expect(store.getSnapshot().topNodes.find((n) => n.id === 'sensor-1')).toBeTruthy();

    store.patchNode('sensor-1', { label: 'Renamed', invert: true });
    const patched = store.getSnapshot().topNodes.find((n) => n.id === 'sensor-1')!;
    expect(patched.label).toBe('Renamed');
    expect(patched.invert).toBe(true);

    store.moveNode('sensor-1', 111, 222);
    const moved = store.getSnapshot().topNodes.find((n) => n.id === 'sensor-1')!;
    expect(moved.x).toBe(111);
    expect(moved.y).toBe(222);

    store.removeNodeWithConnections('sensor-1');
    expect(store.getSnapshot().topNodes.find((n) => n.id === 'sensor-1')).toBeUndefined();
  });

  it('removing a node drops its attached connections in the same step', () => {
    store.addNode(sensorNode('sensor-1'));
    store.addConnection(connection('link-1', 'sensor-1', 'motor-left'));
    expect(store.getSnapshot().topConnections).toHaveLength(1);
    store.removeNodeWithConnections('sensor-1');
    expect(store.getSnapshot().topConnections).toHaveLength(0);
  });

  it('orders nodes deterministically by id regardless of insertion order', () => {
    store.addNode(sensorNode('c'));
    store.addNode(sensorNode('a'));
    store.addNode(sensorNode('b'));
    expect(store.getSnapshot().topNodes.map((n) => n.id)).toEqual([
      'a',
      'b',
      'c',
      'motor-left',
      'motor-right',
    ]);
  });

  it('patchConnection replaces transferPoints wholesale', () => {
    store.addNode(sensorNode('s'));
    store.addConnection(connection('link', 's', 'motor-left'));
    const pts = [
      { x: -100, y: 0 },
      { x: 0, y: 50 },
      { x: 100, y: 100 },
    ];
    store.patchConnection('link', { transferMode: 'nonlinear', transferPoints: pts });
    const conn = store.getSnapshot().topConnections[0];
    expect(conn.transferMode).toBe('nonlinear');
    expect(conn.transferPoints).toEqual(pts);
  });

  it('setLoopPeriodMs updates meta', () => {
    store.setLoopPeriodMs(40);
    expect(store.getSnapshot().loopPeriodMs).toBe(40);
  });

  it('notifies subscribers on change with a stable snapshot between updates', () => {
    let count = 0;
    const unsub = store.subscribe(() => {
      count += 1;
    });
    const before = store.getSnapshot();
    expect(store.getSnapshot()).toBe(before); // stable between updates
    store.addNode(sensorNode('n'));
    expect(count).toBe(1);
    expect(store.getSnapshot()).not.toBe(before); // new snapshot after update
    unsub();
  });
});
