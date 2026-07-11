import { describe, it, expect, beforeEach } from 'vitest';
import { DiagramStore } from '../DiagramStore';
import type { DiagramConnection, DiagramNode } from '../../types/diagram';

function node(id: string, overrides: Partial<DiagramNode> = {}): DiagramNode {
  return { id, type: 'sensor-analog', label: id, x: 0, y: 0, ...overrides };
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

describe('undo scoping and gesture boundaries', () => {
  let store: DiagramStore;
  beforeEach(() => {
    store = new DiagramStore();
  });

  it('tracks a nested node-property edit and reverts it on undo', () => {
    store.addNode(node('n'));
    store.stopCapturing();
    store.patchNode('n', { x: 500 });
    expect(store.getSnapshot().topNodes.find((x) => x.id === 'n')!.x).toBe(500);
    store.undo();
    expect(store.getSnapshot().topNodes.find((x) => x.id === 'n')!.x).toBe(0);
  });

  it('undo/redo an add node', () => {
    store.stopCapturing();
    store.addNode(node('n'));
    expect(store.getSnapshot().topNodes.some((x) => x.id === 'n')).toBe(true);
    store.undo();
    expect(store.getSnapshot().topNodes.some((x) => x.id === 'n')).toBe(false);
    store.redo();
    expect(store.getSnapshot().topNodes.some((x) => x.id === 'n')).toBe(true);
  });

  it('collapses many moves without an intervening stopCapturing into one undo', () => {
    store.addNode(node('n'));
    store.stopCapturing();
    for (let i = 1; i <= 10; i++) store.moveNode('n', i, i);
    expect(store.getSnapshot().topNodes.find((x) => x.id === 'n')!.x).toBe(10);
    store.undo();
    // back to the pre-drag position (0) in a single undo
    expect(store.getSnapshot().topNodes.find((x) => x.id === 'n')!.x).toBe(0);
  });

  it('stopCapturing separates two gestures into two undo steps', () => {
    store.stopCapturing();
    store.addNode(node('a'));
    store.stopCapturing();
    store.addNode(node('b'));
    store.undo();
    expect(store.getSnapshot().topNodes.some((x) => x.id === 'b')).toBe(false);
    expect(store.getSnapshot().topNodes.some((x) => x.id === 'a')).toBe(true);
    store.undo();
    expect(store.getSnapshot().topNodes.some((x) => x.id === 'a')).toBe(false);
  });

  it('does not track untracked mutations (constant slider, labelT, layout)', () => {
    store.stopCapturing();
    store.addNode(node('c', { type: 'constant', constantValue: 0 }));
    store.stopCapturing();
    store.addNode(node('anchor'));
    // Untracked edit creates no undo entry of its own.
    store.setConstantValue('c', 42);
    expect(store.getSnapshot().topNodes.find((x) => x.id === 'c')!.constantValue).toBe(42);
    // Undo reverts the last *tracked* gesture (the anchor add), leaving the
    // untracked constant change in place.
    store.undo();
    expect(store.getSnapshot().topNodes.some((x) => x.id === 'anchor')).toBe(false);
    expect(store.getSnapshot().topNodes.find((x) => x.id === 'c')!.constantValue).toBe(42);
  });

  it('does not track loop-period edits', () => {
    store.setLoopPeriodMs(99);
    store.undo();
    expect(store.getSnapshot().loopPeriodMs).toBe(99);
  });

  it('removing a node with connections undoes as one step', () => {
    store.addNode(node('s'));
    store.addConnection(connection('l', 's', 'motor-left'));
    store.stopCapturing();
    store.removeNodeWithConnections('s');
    expect(store.getSnapshot().topNodes.some((n) => n.id === 's')).toBe(false);
    expect(store.getSnapshot().topConnections).toHaveLength(0);
    store.undo();
    expect(store.getSnapshot().topNodes.some((n) => n.id === 's')).toBe(true);
    expect(store.getSnapshot().topConnections).toHaveLength(1);
  });

  it('replaceAll clears undo history', () => {
    store.stopCapturing();
    store.addNode(node('n'));
    store.replaceAll({
      nodes: [node('motor-left', { type: 'servo-cr' }), node('motor-right', { type: 'servo-cr' })],
      connections: [],
      loopPeriodMs: 20,
      compoundTypes: [],
      comments: [],
    });
    store.undo(); // no-op: history cleared
    expect(store.getSnapshot().topNodes.some((n) => n.id === 'n')).toBe(false);
  });
});
