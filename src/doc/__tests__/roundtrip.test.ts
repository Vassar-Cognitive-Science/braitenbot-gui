import { describe, it, expect } from 'vitest';
import { DiagramStore } from '../DiagramStore';
import { parse, serialize } from '../../lib/diagramFile';
import type { DiagramState } from '../../lib/diagramFile';

const sample: DiagramState = {
  loopPeriodMs: 25,
  comments: [
    { id: 'comment-1', x: 10, y: 20, width: 220, height: 120, text: 'Light-seeking layer' },
  ],
  nodes: [
    { id: 'motor-left', type: 'servo-cr', label: 'Left Wheel', x: 0, y: 0, servoPin: '5' },
    { id: 'motor-right', type: 'servo-cr', label: 'Right Wheel', x: 100, y: 0, servoPin: '6' },
    { id: 'sensor-1', type: 'sensor-analog', label: 'Light', x: 40, y: 60, arduinoPort: 'A0', invert: true },
    { id: 'inst-1', type: 'compound', label: 'Comp', x: 200, y: 200, compoundTypeId: 'comp-1' },
  ],
  connections: [
    {
      id: 'link-1',
      from: 'sensor-1',
      to: 'inst-1',
      toPort: 'in',
      weight: 0.5,
      transferMode: 'nonlinear',
      transferPoints: [
        { x: -100, y: -80 },
        { x: 0, y: 10 },
        { x: 100, y: 100 },
      ],
      labelT: 0.4,
    },
  ],
  compoundTypes: [
    {
      id: 'comp-1',
      displayName: 'Comp',
      body: {
        nodes: [
          { id: 'in', type: 'compound-input', label: 'in', x: 120, y: 120 },
          { id: 'sum', type: 'compute-summation', label: 'Sum', x: 320, y: 120 },
          { id: 'out', type: 'compound-output', label: 'out', x: 520, y: 120 },
        ],
        connections: [
          { id: 'comp-1/in-0', from: 'in', to: 'sum', weight: 1, transferMode: 'linear', transferPoints: [{ x: -100, y: -100 }, { x: 100, y: 100 }] },
          { id: 'comp-1/out-0', from: 'sum', to: 'out', weight: 1, transferMode: 'linear', transferPoints: [{ x: -100, y: -100 }, { x: 100, y: 100 }] },
        ],
      },
    },
  ],
};

describe('serialize round-trip through the store', () => {
  it('loads a DiagramState and serializes back to the same file shape', () => {
    const store = new DiagramStore();
    store.replaceAll(sample);
    const snap = store.getSnapshot();
    const state: DiagramState = {
      nodes: snap.topNodes,
      connections: snap.topConnections,
      loopPeriodMs: snap.loopPeriodMs,
      compoundTypes: snap.compoundTypes,
      comments: snap.comments,
    };
    const json = serialize(state);
    const reparsed = parse(json);
    const byId = <T extends { id: string }>(items: T[]) =>
      [...items].sort((a, b) => a.id.localeCompare(b.id));
    expect(reparsed.loopPeriodMs).toBe(sample.loopPeriodMs);
    expect(reparsed.comments).toEqual(sample.comments);
    // Store reads come back sorted by id (deterministic cross-peer order), so
    // compare contents modulo array order.
    expect(reparsed.nodes).toEqual(byId(sample.nodes));
    expect(reparsed.connections).toEqual(byId(sample.connections));
    expect(reparsed.compoundTypes).toEqual(
      sample.compoundTypes.map((def) => ({
        ...def,
        body: { nodes: byId(def.body.nodes), connections: byId(def.body.connections) },
      })),
    );
  });

  it('orders compound body nodes deterministically by id (port order stability)', () => {
    const store = new DiagramStore();
    store.replaceAll(sample);
    const body = store.getSnapshot().compoundTypes[0].body.nodes.map((n) => n.id);
    expect(body).toEqual(['in', 'out', 'sum']);
  });
});

describe('group / ungroup through the store', () => {
  it('groups two connected nodes into a compound and back', () => {
    const store = new DiagramStore();
    store.replaceAll({
      nodes: [
        { id: 'motor-left', type: 'servo-cr', label: 'L', x: 0, y: 0, servoPin: '5' },
        { id: 'motor-right', type: 'servo-cr', label: 'R', x: 400, y: 0, servoPin: '6' },
        { id: 's', type: 'sensor-analog', label: 'S', x: 40, y: 40, arduinoPort: 'A0' },
        { id: 'sum', type: 'compute-summation', label: 'Sum', x: 140, y: 40 },
      ],
      connections: [
        { id: 'e1', from: 's', to: 'sum', weight: 1, transferMode: 'linear', transferPoints: [{ x: -100, y: -100 }, { x: 100, y: 100 }] },
        { id: 'e2', from: 'sum', to: 'motor-left', weight: 0.7, transferMode: 'linear', transferPoints: [{ x: -100, y: -100 }, { x: 100, y: 100 }] },
      ],
      loopPeriodMs: 20,
      compoundTypes: [],
      comments: [],
    });
    store.stopCapturing();
    const result = store.group(new Set(['s', 'sum']));
    expect(result).not.toBeNull();
    const afterGroup = store.getSnapshot();
    expect(afterGroup.compoundTypes).toHaveLength(1);
    // s and sum removed from top; one compound instance added.
    expect(afterGroup.topNodes.some((n) => n.id === 's')).toBe(false);
    expect(afterGroup.topNodes.some((n) => n.id === result!.instanceId)).toBe(true);
    // The outgoing boundary edge now leaves the instance via a port.
    const boundary = afterGroup.topConnections.find((c) => c.to === 'motor-left');
    expect(boundary?.from).toBe(result!.instanceId);
    expect(boundary?.fromPort).toBeTruthy();
    expect(boundary?.weight).toBe(0.7);

    // Undo restores the pre-group state in one step.
    store.undo();
    const afterUndo = store.getSnapshot();
    expect(afterUndo.compoundTypes).toHaveLength(0);
    expect(afterUndo.topNodes.some((n) => n.id === 's')).toBe(true);
  });
});
