// Plan equivalence tests: simulateGraph with a precompiled SimulationPlan
// must produce results deeply (bit-)identical to the plan-less call. The
// plan only relocates structural work (flatten, toposort, adjacency,
// transfer-point sorting) from per-tick to build time — no numeric
// computation or evaluation order may change.

import { describe, it, expect } from 'vitest';
import {
  buildSimulationPlan,
  createSimulationState,
  simulateGraph,
} from '../useTraceSimulation';
import type {
  CompoundTypeDefinition,
  DiagramNode,
  DiagramConnection,
} from '../../types/diagram';

function lin(c: Partial<DiagramConnection> & { id: string; from: string; to: string }): DiagramConnection {
  return {
    weight: 1,
    transferMode: 'linear',
    transferPoints: [{ x: -100, y: -100 }, { x: 100, y: 100 }],
    ...c,
  };
}

/** Nonlinear edge with deliberately UNSORTED transfer points. */
function nonlin(c: Partial<DiagramConnection> & { id: string; from: string; to: string }): DiagramConnection {
  return {
    weight: 1,
    transferMode: 'nonlinear',
    // Unsorted on purpose — exercises the pre-sort in buildSimulationPlan
    // against the per-call sort in the plan-less path.
    transferPoints: [
      { x: 100, y: 40 },
      { x: -100, y: -80 },
      { x: 0, y: 10 },
      { x: 50, y: 90 },
    ],
    ...c,
  };
}

const LOOP_MS = 20;

/**
 * A representative graph exercising every structural feature the plan
 * precomputes: nonlinear transfer edges, a delay node (multi-tick state),
 * a compound instance (with a nested delay), a color sensor with per-port
 * edges, a multiply node, noise/oscillator time dependence, and
 * disconnected nodes.
 */
function representativeGraph(): {
  nodes: DiagramNode[];
  connections: DiagramConnection[];
  compoundTypes: CompoundTypeDefinition[];
} {
  const delayBox: CompoundTypeDefinition = {
    id: 'delayBox',
    displayName: 'Delay Box',
    body: {
      nodes: [
        { id: 'in', type: 'compound-input', label: 'in', x: 0, y: 0 },
        { id: 'd1', type: 'compute-delay', label: 'd', x: 0, y: 0, delayMs: 60 },
        { id: 'out', type: 'compound-output', label: 'out', x: 0, y: 0 },
      ],
      connections: [
        lin({ id: 'b1', from: 'in', to: 'd1', weight: 0.9 }),
        nonlin({ id: 'b2', from: 'd1', to: 'out' }),
      ],
    },
  };

  const nodes: DiagramNode[] = [
    { id: 's1', type: 'sensor-analog', label: 's', x: 0, y: 0, arduinoPort: 'A0' },
    { id: 'col1', type: 'sensor-color', label: 'col', x: 0, y: 0 },
    { id: 'o1', type: 'compute-oscillator', label: 'o', x: 0, y: 0, frequencyHz: 0.7, amplitude: 60 },
    { id: 'n1', type: 'compute-noise', label: 'n', x: 0, y: 0, amplitude: 30 },
    { id: 'sum1', type: 'compute-summation', label: 'sum', x: 0, y: 0 },
    { id: 'mul1', type: 'compute-multiply', label: 'mul', x: 0, y: 0 },
    { id: 'del1', type: 'compute-delay', label: 'del', x: 0, y: 0, delayMs: 80 },
    { id: 'inst-1', type: 'compound', label: 'box', x: 0, y: 0, compoundTypeId: 'delayBox' },
    { id: 'motor-left', type: 'servo-cr', label: 'L', x: 0, y: 0, servoPin: '9' },
    { id: 'motor-right', type: 'servo-cr', label: 'R', x: 0, y: 0, servoPin: '10' },
    // Disconnected: no incoming edges, not a source.
    { id: 'lonely-sum', type: 'compute-summation', label: 'lonely', x: 0, y: 0 },
    { id: 'lonely-motor', type: 'servo-cr', label: 'lm', x: 0, y: 0, servoPin: '11' },
  ];

  const connections: DiagramConnection[] = [
    // Nonlinear edge + weighted edges into the summation — order matters
    // for float accumulation.
    nonlin({ id: 'c1', from: 's1', to: 'sum1' }),
    lin({ id: 'c2', from: 'o1', to: 'sum1', weight: 0.8 }),
    lin({ id: 'c3', from: 'n1', to: 'sum1', weight: 0.6 }),
    // Color sensor per-port edges feeding the multiply node.
    lin({ id: 'c4', from: 'col1', to: 'mul1', fromPort: 'red', weight: 0.01 }),
    nonlin({ id: 'c5', from: 'col1', to: 'mul1', fromPort: 'blue' }),
    // Delay fed by the summation (multi-tick ring-buffer state).
    lin({ id: 'c6', from: 'sum1', to: 'del1', weight: 0.7 }),
    lin({ id: 'c7', from: 'del1', to: 'motor-left' }),
    // Compound instance in the signal path.
    lin({ id: 'c8', from: 'sum1', to: 'inst-1', toPort: 'in' }),
    lin({ id: 'c9', from: 'inst-1', to: 'motor-right', fromPort: 'out', weight: 0.5 }),
    lin({ id: 'c10', from: 'mul1', to: 'motor-right', weight: 0.3 }),
  ];

  return { nodes, connections, compoundTypes: [delayBox] };
}

const SENSORS: Record<string, number> = {
  s1: 42,
  'col1:clear': 80,
  'col1:red': 55,
  'col1:green': 20,
  'col1:blue': 65,
};

describe('simulateGraph with a precompiled plan', () => {
  it('stateless snapshot matches the plan-less call exactly', () => {
    const { nodes, connections, compoundTypes } = representativeGraph();
    const plan = buildSimulationPlan(nodes, connections, compoundTypes);

    const a = simulateGraph(nodes, connections, SENSORS, undefined, compoundTypes);
    const b = simulateGraph(nodes, connections, SENSORS, undefined, compoundTypes, plan);

    expect(b.nodeValues).toEqual(a.nodeValues);
    expect(b.edgeSignals).toEqual(a.edgeSignals);
    expect(b.disconnected).toEqual(a.disconnected);
    // Sanity: the graph actually exercises what it claims to.
    expect(a.disconnected.has('lonely-sum')).toBe(true);
    expect(a.disconnected.has('lonely-motor')).toBe(true);
    expect('inst-1/d1' in a.nodeValues).toBe(true);
    expect('c5' in a.edgeSignals).toBe(true);
  });

  it('tick-stepped runs are bit-identical over 120 ticks (delays, noise, oscillator)', () => {
    const { nodes, connections, compoundTypes } = representativeGraph();
    const plan = buildSimulationPlan(nodes, connections, compoundTypes);
    const seed = 0xdecafbad;

    // Two independent states (delay ring buffers are mutated in place), one
    // stepped plan-less and one with the plan, on the same tick sequence.
    const stateA = createSimulationState(nodes, LOOP_MS, connections, compoundTypes, seed);
    const stateB = createSimulationState(nodes, LOOP_MS, connections, compoundTypes, seed);

    for (let i = 0; i < 120; i++) {
      stateA.tick += 1;
      stateB.tick += 1;
      // Vary the analog sensor over time to push fresh values through the
      // delay buffers and across nonlinear segments.
      const sensors = { ...SENSORS, s1: (i * 7) % 100 };
      const a = simulateGraph(nodes, connections, sensors, stateA, compoundTypes);
      const b = simulateGraph(nodes, connections, sensors, stateB, compoundTypes, plan);

      expect(b.disconnected).toEqual(a.disconnected);
      expect(Object.keys(b.nodeValues)).toEqual(Object.keys(a.nodeValues));
      expect(Object.keys(b.edgeSignals)).toEqual(Object.keys(a.edgeSignals));
      for (const id of Object.keys(a.nodeValues)) {
        expect(
          Object.is(a.nodeValues[id], b.nodeValues[id]),
          `nodeValues[${id}] diverged at tick ${i + 1}`,
        ).toBe(true);
      }
      for (const id of Object.keys(a.edgeSignals)) {
        expect(
          Object.is(a.edgeSignals[id], b.edgeSignals[id]),
          `edgeSignals[${id}] diverged at tick ${i + 1}`,
        ).toBe(true);
      }
    }

    // The delay ring buffers themselves must have evolved identically.
    expect([...stateB.delays.keys()].sort()).toEqual([...stateA.delays.keys()].sort());
    for (const [id, bufA] of stateA.delays) {
      const bufB = stateB.delays.get(id)!;
      expect(bufB.idx).toBe(bufA.idx);
      expect(bufB.values).toEqual(bufA.values);
    }
  });

  it('a reused plan matches per-tick rebuilt plans (plan is tick-independent)', () => {
    const { nodes, connections, compoundTypes } = representativeGraph();
    const reused = buildSimulationPlan(nodes, connections, compoundTypes);
    const stateA = createSimulationState(nodes, LOOP_MS, connections, compoundTypes, 7);
    const stateB = createSimulationState(nodes, LOOP_MS, connections, compoundTypes, 7);
    for (let i = 0; i < 30; i++) {
      stateA.tick += 1;
      stateB.tick += 1;
      const fresh = buildSimulationPlan(nodes, connections, compoundTypes);
      const a = simulateGraph(nodes, connections, SENSORS, stateA, compoundTypes, fresh);
      const b = simulateGraph(nodes, connections, SENSORS, stateB, compoundTypes, reused);
      expect(b.nodeValues).toEqual(a.nodeValues);
      expect(b.edgeSignals).toEqual(a.edgeSignals);
    }
  });

  it('plan reports a non-delay cycle as null order and simulateGraph returns empty', () => {
    const nodes: DiagramNode[] = [
      { id: 'a', type: 'compute-summation', label: 'a', x: 0, y: 0 },
      { id: 'b', type: 'compute-summation', label: 'b', x: 0, y: 0 },
    ];
    const connections = [
      lin({ id: 'c1', from: 'a', to: 'b' }),
      lin({ id: 'c2', from: 'b', to: 'a' }),
    ];
    const plan = buildSimulationPlan(nodes, connections, []);
    expect(plan.order).toBeNull();
    const withPlan = simulateGraph(nodes, connections, {}, undefined, [], plan);
    const without = simulateGraph(nodes, connections, {});
    expect(withPlan.nodeValues).toEqual(without.nodeValues);
    expect(withPlan.nodeValues).toEqual({});
  });
});
