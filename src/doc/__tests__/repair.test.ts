import { describe, it, expect, beforeEach } from 'vitest';
import { DiagramStore } from '../DiagramStore';
import type { DiagramConnection, DiagramNode } from '../../types/diagram';

function node(id: string, overrides: Partial<DiagramNode> = {}): DiagramNode {
  return { id, type: 'sensor-analog', label: id, x: 0, y: 0, ...overrides };
}
function connection(id: string, from: string, to: string, extra: Partial<DiagramConnection> = {}): DiagramConnection {
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
    ...extra,
  };
}

describe('invariant repair (via undo, which runs the repair pass)', () => {
  let store: DiagramStore;
  beforeEach(() => {
    store = new DiagramStore();
  });

  it('drops connections whose endpoint node disappears after undo', () => {
    // Build: sensor + connection in one gesture, then delete sensor in another.
    store.stopCapturing();
    store.addNode(node('s'));
    store.addConnection(connection('l', 's', 'motor-left'));
    store.stopCapturing();
    // A connection added referencing a node that a later undo will remove.
    store.addNode(node('t'));
    store.addConnection(connection('l2', 't', 'motor-right'));
    store.stopCapturing();
    // Now undo the (t + l2) creation. l2 endpoint 't' is gone; repair drops it.
    store.undo();
    const conns = store.getSnapshot().topConnections.map((c) => c.id);
    expect(conns).toContain('l');
    expect(conns).not.toContain('l2');
  });

  it('restores a wheel motor if it goes missing, then re-runs cleanly', () => {
    // Force the invariant by replacing all with a diagram missing motor-right.
    store.replaceAll({
      nodes: [node('motor-left', { type: 'servo-cr' })],
      connections: [],
      loopPeriodMs: 20,
      comments: [],
      compoundTypes: [],
    });
    // A tracked edit + undo triggers the repair pass.
    store.stopCapturing();
    store.addNode(node('x'));
    store.undo();
    const ids = store.getSnapshot().topNodes.map((n) => n.id);
    expect(ids).toContain('motor-left');
    expect(ids).toContain('motor-right');
  });

  it('clamps transfer-curve endpoint anchors back to x = ±100', () => {
    store.addNode(node('s'));
    store.addConnection(
      connection('l', 's', 'motor-left', {
        transferMode: 'nonlinear',
        transferPoints: [
          { x: -50, y: -100 },
          { x: 0, y: 0 },
          { x: 60, y: 100 },
        ],
      }),
    );
    // Trigger repair through an undo of an unrelated later gesture.
    store.stopCapturing();
    store.addNode(node('z'));
    store.undo();
    const pts = store.getSnapshot().topConnections[0].transferPoints;
    expect(pts[0].x).toBe(-100);
    expect(pts[pts.length - 1].x).toBe(100);
    // interior y preserved
    expect(pts[1]).toEqual({ x: 0, y: 0 });
  });
});
