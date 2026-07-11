import { describe, it, expect } from 'vitest';
import { DiagramStore } from '../DiagramStore';
import type { DiagramNode } from '../../types/diagram';

function node(id: string, overrides: Partial<DiagramNode> = {}): DiagramNode {
  return { id, type: 'sensor-analog', label: id, x: 0, y: 0, ...overrides };
}

describe('snapshot structural sharing', () => {
  it('keeps identity of untouched entities and arrays when one node moves', () => {
    const store = new DiagramStore();
    store.addNode(node('a'));
    store.addNode(node('b'));
    store.addConnection({
      id: 'l',
      from: 'a',
      to: 'motor-left',
      weight: 1,
      transferMode: 'linear',
      transferPoints: [
        { x: -100, y: -100 },
        { x: 100, y: 100 },
      ],
    });

    const before = store.getSnapshot();
    store.moveNode('a', 50, 60);
    const after = store.getSnapshot();

    // The moved node gets a new object; every other node keeps identity.
    const nodeA = (snap: typeof before) => snap.topNodes.find((n) => n.id === 'a')!;
    const nodeB = (snap: typeof before) => snap.topNodes.find((n) => n.id === 'b')!;
    expect(nodeA(after)).not.toBe(nodeA(before));
    expect(nodeA(after).x).toBe(50);
    expect(nodeB(after)).toBe(nodeB(before));
    expect(after.topNodes.find((n) => n.id === 'motor-left')).toBe(
      before.topNodes.find((n) => n.id === 'motor-left'),
    );

    // Untouched containers keep array identity outright.
    expect(after.topNodes).not.toBe(before.topNodes);
    expect(after.topConnections).toBe(before.topConnections);
    expect(after.compoundTypes).toBe(before.compoundTypes);
  });

  it('shares untouched body entities when editing inside a compound', () => {
    const store = new DiagramStore();
    store.replaceAll({
      nodes: [node('motor-left', { type: 'servo-cr' }), node('motor-right', { type: 'servo-cr' })],
      connections: [],
      loopPeriodMs: 20,
      comments: [],
      compoundTypes: [
        {
          id: 'comp-1',
          displayName: 'Comp',
          body: {
            nodes: [node('p', { type: 'compound-input' }), node('q', { type: 'compute-summation' })],
            connections: [],
          },
        },
      ],
    });

    const before = store.getSnapshot();
    store.setEditingContext('comp-1');
    store.moveNode('p', 5, 5);
    const after = store.getSnapshot();

    const def = (snap: typeof before) => snap.compoundTypes[0];
    expect(def(after)).not.toBe(def(before)); // the edited definition changes
    // ...but the untouched body node keeps identity, as does the connections array.
    expect(def(after).body.nodes.find((n) => n.id === 'q')).toBe(
      def(before).body.nodes.find((n) => n.id === 'q'),
    );
    expect(def(after).body.connections).toBe(def(before).body.connections);
    // Top-level containers are untouched entirely.
    expect(after.topNodes).toBe(before.topNodes);
    expect(after.topConnections).toBe(before.topConnections);
  });

  it('returns the identical snapshot object when a transaction changes nothing', () => {
    const store = new DiagramStore();
    const before = store.getSnapshot();
    // Patch of a missing id mutates nothing.
    store.patchNode('does-not-exist', { x: 1 });
    expect(store.getSnapshot()).toBe(before);
  });
});
