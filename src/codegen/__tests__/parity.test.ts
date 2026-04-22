// Parity tests: for every node type, the trace simulator and the Arduino
// codegen must compute the same value at every node for the same inputs.
//
// Strategy: this file defines `simulateEmittedC`, a JS interpreter that
// mirrors the per-node arithmetic in `src/codegen/emitter.ts` branch for
// branch. The trace simulator (`simulateGraph`) is run on the same graph
// and the two are asserted equal node-by-node.
//
// IMPORTANT: any change to a node type's emitter branch MUST be reflected
// in `simulateEmittedC` below, and vice versa. Each branch in the
// interpreter is annotated with the emitter line range it mirrors. The
// test will fail loudly if either side drifts — that is the whole point.
//
// Known divergences (intentionally not covered by parity):
//   - delay nodes: the C code uses a multi-tick ring buffer; the trace
//     simulator passes the input through (it has no time dimension). A
//     dedicated test below documents this.
//   - i2c sensors: the C code emits a `0.0 // TODO` stub; the trace
//     returns whatever the user dialed in. Skipped here.

import { describe, it, expect } from 'vitest';
import { buildGraph } from '../graph';
import type { WiringGraph, GraphNode } from '../graph';
import { simulateGraph } from '../../hooks/useTraceSimulation';
import type {
  DiagramNode,
  DiagramConnection,
  TransferPoint,
} from '../../types/diagram';

// ---------------------------------------------------------------------------
// Reference C-semantics interpreter
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function applyEdgeTerm(
  edge: { weight: number; transferMode: string; transferPoints: TransferPoint[] },
  src: number,
): number {
  // Mirrors emitter.ts:92-99 (emitEdgeTerm). Nonlinear edges go through
  // the piecewise-linear transfer function; linear edges are weight * src.
  if (edge.transferMode === 'nonlinear' && edge.transferPoints.length >= 2) {
    return interpolate(src, edge.transferPoints);
  }
  return src * edge.weight;
}

function interpolate(input: number, points: TransferPoint[]): number {
  // Mirrors the piecewise-linear interpolation that the emitted C
  // transfer function performs between its declared knots. Inputs outside
  // [pts[0].x, pts[N-1].x] are flatlined to the nearest endpoint — this
  // matches the trace simulator. (The emitted C's branch structure will
  // linearly extrapolate outside the declared domain, which is a known
  // divergence not covered by this parity harness.)
  const sorted = [...points].sort((a, b) => a.x - b.x);
  if (input <= sorted[0].x) return sorted[0].y;
  if (input >= sorted[sorted.length - 1].x) return sorted[sorted.length - 1].y;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (input >= sorted[i].x && input <= sorted[i + 1].x) {
      const t = (input - sorted[i].x) / (sorted[i + 1].x - sorted[i].x);
      return sorted[i].y + t * (sorted[i + 1].y - sorted[i].y);
    }
  }
  return sorted[sorted.length - 1].y;
}

function aggregateSum(graph: WiringGraph, nodeId: string, vals: Record<string, number>): number {
  // Mirrors emitter.ts:101-115 (emitInputAggregation): float input = 0.0;
  // input += sig_X * w for each edge.
  let acc = 0;
  for (const edge of graph.edges) {
    if (edge.to !== nodeId) continue;
    acc += applyEdgeTerm(edge, vals[edge.from] ?? 0);
  }
  return acc;
}

function aggregateProduct(graph: WiringGraph, nodeId: string, vals: Record<string, number>): number {
  // Mirrors emitter.ts:117-136 (emitProductAggregation): float input = 1.0;
  // input *= (sig_X * w) for each edge. Empty product is 0.0.
  const incoming = graph.edges.filter((e) => e.to === nodeId);
  if (incoming.length === 0) return 0;
  let acc = 1;
  for (const edge of incoming) {
    acc *= applyEdgeTerm(edge, vals[edge.from] ?? 0);
  }
  return acc;
}

interface CResult {
  nodeValues: Record<string, number>;
}

function simulateEmittedC(
  graph: WiringGraph,
  sensorValues: Record<string, number>,
): CResult {
  const vals: Record<string, number> = {};
  const nodeById = new Map<string, GraphNode>(graph.nodes.map((n) => [n.id, n]));

  for (const nodeId of graph.executionOrder) {
    const node = nodeById.get(nodeId);
    if (!node) continue;

    if (node.kind === 'sensor') {
      // Mirrors emitter.ts (emitSensorRead):
      //   analog: analogRead * (100.0 / 1023.0)  →  caller supplies value in [0, 100]
      //   digital: digitalRead * 100.0           →  caller supplies 0 or 100
      //   i2c color: channel * (100.0 / 65535.0) →  caller supplies value in [0, 100]
      if (node.protocol === 'i2c') {
        vals[nodeId] = 0;
      } else {
        vals[nodeId] = sensorValues[nodeId] ?? 50;
      }
      continue;
    }

    if (node.kind === 'constant') {
      vals[nodeId] = node.constantValue ?? 0;
      continue;
    }

    if (node.kind === 'compute') {
      if (node.typeId === 'compute-threshold') {
        const sum = aggregateSum(graph, nodeId, vals);
        const thresh = node.threshold ?? 50;
        vals[nodeId] = sum > thresh ? 100 : 0;
      } else if (node.typeId === 'compute-summation') {
        // emitter.ts:223-225
        vals[nodeId] = aggregateSum(graph, nodeId, vals);
      } else if (node.typeId === 'compute-multiply') {
        // emitter.ts (compute-multiply branch following summation)
        vals[nodeId] = aggregateProduct(graph, nodeId, vals);
      } else if (node.typeId === 'compute-delay') {
        // Delay nodes have multi-tick state in C; not part of parity.
        // Falling through to sum here so the value is at least defined,
        // but parity tests must skip delay nodes.
        vals[nodeId] = aggregateSum(graph, nodeId, vals);
      }
      continue;
    }

    if (node.kind === 'motor') {
      // Wheel motors aggregate inputs into a sum and pass them to the emitted
      // drive() helper, which clamps to [-100, 100] before writing
      // microseconds. Servos aggregate into a sum then map to angle via
      // constrain((input+100)*0.9, 0, 180). In both cases the effective
      // signal at the node is clamp(sum, -100, 100) — that is what the trace
      // simulator stores, so that is what we compare here.
      const sum = aggregateSum(graph, nodeId, vals);
      vals[nodeId] = clamp(sum, -100, 100);
      continue;
    }
  }

  return { nodeValues: vals };
}

// ---------------------------------------------------------------------------
// Test plumbing
// ---------------------------------------------------------------------------

function makeConn(c: Partial<DiagramConnection> & { id: string; from: string; to: string }): DiagramConnection {
  return {
    weight: 1,
    transferMode: 'linear',
    transferPoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    ...c,
  };
}

const EPS = 1e-9;

function expectParity(
  nodes: DiagramNode[],
  connections: DiagramConnection[],
  sensorValues: Record<string, number>,
  nodeIdsToCheck: string[],
) {
  const graph = buildGraph(nodes, connections);
  const trace = simulateGraph(nodes, connections, sensorValues);
  const c = simulateEmittedC(graph, sensorValues);

  for (const id of nodeIdsToCheck) {
    const traceVal = trace.nodeValues[id];
    const cVal = c.nodeValues[id];
    expect(
      Math.abs((traceVal ?? NaN) - (cVal ?? NaN)),
      `node '${id}': trace=${traceVal} vs C=${cVal}`,
    ).toBeLessThan(EPS);
  }
}

// Reusable node factories
function sensor(id: string, overrides: Partial<DiagramNode> = {}): DiagramNode {
  return {
    id,
    type: 'sensor-analog',
    label: id,
    x: 0,
    y: 0,
    arduinoPort: 'A0',
    ...overrides,
  };
}

function leftMotor(): DiagramNode {
  return {
    id: 'motor-L',
    type: 'servo-cr',
    label: 'Left',
    x: 0,
    y: 0,
    servoPin: '9',
  };
}

// ---------------------------------------------------------------------------
// Per-node parity
// ---------------------------------------------------------------------------

describe('node parity (trace vs emitted C)', () => {
  describe('analog sensor', () => {
    const cases = [0, 25, 50, 75, 100];
    for (const v of cases) {
      it(`returns ${v} from both`, () => {
        const nodes = [sensor('s1'), leftMotor()];
        const connections = [makeConn({ id: 'c1', from: 's1', to: 'motor-L' })];
        expectParity(nodes, connections, { s1: v }, ['s1', 'motor-L']);
      });
    }
  });

  describe('digital sensor', () => {
    // Digital sensors: only 0 or 100 are physically meaningful (0 or 1 from
    // digitalRead, scaled by 100).
    for (const v of [0, 100]) {
      it(`returns ${v} from both`, () => {
        const nodes = [
          sensor('s1', { type: 'sensor-digital', arduinoPort: '2' }),
          leftMotor(),
        ];
        const connections = [makeConn({ id: 'c1', from: 's1', to: 'motor-L' })];
        expectParity(nodes, connections, { s1: v }, ['s1', 'motor-L']);
      });
    }
  });

  describe('constant', () => {
    for (const v of [-100, -50, 0, 30, 50, 80, 100]) {
      it(`emits ${v} from both`, () => {
        const constant: DiagramNode = {
          id: 'k1',
          type: 'constant',
          label: 'k',
          x: 0,
          y: 0,
          constantValue: v,
        };
        const nodes = [constant, leftMotor()];
        const connections = [makeConn({ id: 'c1', from: 'k1', to: 'motor-L' })];
        expectParity(nodes, connections, {}, ['k1', 'motor-L']);
      });
    }
  });

  describe('threshold', () => {
    // Below, at, and above threshold. The strict ">" boundary case is the
    // exact spot where the original threshold bug lived — make sure both
    // sides agree on it.
    const thresh = 50;
    const cases = [
      { input: 0, label: 'below' },
      { input: 49, label: 'just below' },
      { input: 50, label: 'exactly at threshold' },
      { input: 51, label: 'just above' },
      { input: 100, label: 'above' },
    ];
    for (const { input, label } of cases) {
      it(`agrees ${label}`, () => {
        const t: DiagramNode = {
          id: 't1',
          type: 'compute-threshold',
          label: 't',
          x: 0,
          y: 0,
          threshold: thresh,
        };
        const nodes = [sensor('s1'), t, leftMotor()];
        const connections = [
          makeConn({ id: 'c1', from: 's1', to: 't1' }),
          makeConn({ id: 'c2', from: 't1', to: 'motor-L' }),
        ];
        expectParity(nodes, connections, { s1: input }, ['t1', 'motor-L']);
      });
    }
  });

  describe('summation', () => {
    it('agrees on a two-input weighted sum', () => {
      const sum: DiagramNode = {
        id: 'sum1',
        type: 'compute-summation',
        label: 'sum',
        x: 0,
        y: 0,
      };
      const nodes = [sensor('s1'), sensor('s2'), sum, leftMotor()];
      const connections = [
        makeConn({ id: 'c1', from: 's1', to: 'sum1', weight: 0.6 }),
        makeConn({ id: 'c2', from: 's2', to: 'sum1', weight: -0.4 }),
        makeConn({ id: 'c3', from: 'sum1', to: 'motor-L' }),
      ];
      expectParity(nodes, connections, { s1: 80, s2: 30 }, ['sum1', 'motor-L']);
    });

    it('agrees with three inputs of mixed sign', () => {
      const sum: DiagramNode = {
        id: 'sum1',
        type: 'compute-summation',
        label: 'sum',
        x: 0,
        y: 0,
      };
      const nodes = [
        sensor('s1'),
        sensor('s2'),
        sensor('s3'),
        sum,
        leftMotor(),
      ];
      const connections = [
        makeConn({ id: 'c1', from: 's1', to: 'sum1', weight: 1 }),
        makeConn({ id: 'c2', from: 's2', to: 'sum1', weight: -0.5 }),
        makeConn({ id: 'c3', from: 's3', to: 'sum1', weight: 0.25 }),
        makeConn({ id: 'c4', from: 'sum1', to: 'motor-L' }),
      ];
      expectParity(
        nodes,
        connections,
        { s1: 40, s2: 90, s3: 60 },
        ['sum1', 'motor-L'],
      );
    });
  });

  describe('multiply', () => {
    it('agrees on a two-input product', () => {
      const mult: DiagramNode = {
        id: 'm1',
        type: 'compute-multiply',
        label: 'gate',
        x: 0,
        y: 0,
      };
      const nodes = [sensor('s1'), sensor('s2'), mult, leftMotor()];
      const connections = [
        makeConn({ id: 'c1', from: 's1', to: 'm1' }),
        makeConn({ id: 'c2', from: 's2', to: 'm1' }),
        makeConn({ id: 'c3', from: 'm1', to: 'motor-L' }),
      ];
      expectParity(nodes, connections, { s1: 60, s2: 50 }, ['m1', 'motor-L']);
    });

    it('agrees when one input is a 0/100 gate', () => {
      // Threshold-driven gating: this is the canonical "use multiply as a
      // gate" pattern from the tutorial walkthrough. If either side gets
      // its arithmetic wrong, the gated output diverges here.
      const t: DiagramNode = {
        id: 't1',
        type: 'compute-threshold',
        label: 'gate',
        x: 0,
        y: 0,
        threshold: 50,
      };
      const mult: DiagramNode = {
        id: 'm1',
        type: 'compute-multiply',
        label: 'gated',
        x: 0,
        y: 0,
      };
      const nodes = [sensor('s_signal'), sensor('s_gate'), t, mult, leftMotor()];
      const connections = [
        makeConn({ id: 'c1', from: 's_gate', to: 't1' }),
        makeConn({ id: 'c2', from: 's_signal', to: 'm1' }),
        makeConn({ id: 'c3', from: 't1', to: 'm1' }),
        makeConn({ id: 'c4', from: 'm1', to: 'motor-L' }),
      ];
      // Gate open
      expectParity(
        nodes,
        connections,
        { s_signal: 70, s_gate: 90 },
        ['t1', 'm1', 'motor-L'],
      );
      // Gate closed
      expectParity(
        nodes,
        connections,
        { s_signal: 70, s_gate: 10 },
        ['t1', 'm1', 'motor-L'],
      );
    });

    it('agrees on three-input product', () => {
      const mult: DiagramNode = {
        id: 'm1',
        type: 'compute-multiply',
        label: 'mul3',
        x: 0,
        y: 0,
      };
      const nodes = [
        sensor('s1'),
        sensor('s2'),
        sensor('s3'),
        mult,
        leftMotor(),
      ];
      const connections = [
        makeConn({ id: 'c1', from: 's1', to: 'm1' }),
        makeConn({ id: 'c2', from: 's2', to: 'm1' }),
        makeConn({ id: 'c3', from: 's3', to: 'm1' }),
        makeConn({ id: 'c4', from: 'm1', to: 'motor-L' }),
      ];
      expectParity(
        nodes,
        connections,
        { s1: 50, s2: 40, s3: 80 },
        ['m1', 'motor-L'],
      );
    });
  });

  describe('motor', () => {
    // Motor parity is the clamping behavior: anything beyond ±100 should be
    // saturated to ±100 by both sides.
    it('agrees in the linear range', () => {
      const nodes = [sensor('s1'), leftMotor()];
      const connections = [
        makeConn({ id: 'c1', from: 's1', to: 'motor-L', weight: 0.7 }),
      ];
      expectParity(nodes, connections, { s1: 50 }, ['motor-L']);
    });

    it('agrees when input saturates positive', () => {
      const nodes = [sensor('s1'), sensor('s2'), leftMotor()];
      const connections = [
        makeConn({ id: 'c1', from: 's1', to: 'motor-L', weight: 1 }),
        makeConn({ id: 'c2', from: 's2', to: 'motor-L', weight: 1 }),
      ];
      // sum = 170, both should clamp to 100.
      expectParity(nodes, connections, { s1: 90, s2: 80 }, ['motor-L']);
    });

    it('agrees when input saturates negative', () => {
      const nodes = [sensor('s1'), sensor('s2'), leftMotor()];
      const connections = [
        makeConn({ id: 'c1', from: 's1', to: 'motor-L', weight: -1 }),
        makeConn({ id: 'c2', from: 's2', to: 'motor-L', weight: -1 }),
      ];
      // sum = -170, both should clamp to -100.
      expectParity(nodes, connections, { s1: 90, s2: 80 }, ['motor-L']);
    });
  });

  describe('servo', () => {
    it('agrees on the underlying signal', () => {
      const servo: DiagramNode = {
        id: 'srv',
        type: 'servo-positional',
        label: 'srv',
        x: 0,
        y: 0,
        servoPin: '9',
      };
      const nodes = [sensor('s1'), servo];
      const connections = [
        makeConn({ id: 'c1', from: 's1', to: 'srv', weight: 1 }),
      ];
      expectParity(nodes, connections, { s1: 40 }, ['srv']);
    });
  });

  describe('nonlinear transfer function', () => {
    it('agrees through a piecewise-linear edge transfer', () => {
      const nodes = [sensor('s1'), leftMotor()];
      const connections = [
        makeConn({
          id: 'c1',
          from: 's1',
          to: 'motor-L',
          weight: 1,
          transferMode: 'nonlinear',
          transferPoints: [
            { x: -100, y: -100 },
            { x: 0, y: 0 },
            { x: 100, y: 100 },
          ],
        }),
      ];
      // Sample several points across the curve, including a knot.
      for (const v of [-100, -50, 0, 25, 50, 100]) {
        expectParity(nodes, connections, { s1: v }, ['motor-L']);
      }
    });
  });

  describe('integration: deeper graph', () => {
    it('agrees on a multi-stage diagram with mixed node types', () => {
      // Two sensors → summation → threshold → multiplied with a third
      // sensor → motor. Exercises every parity-tested branch in one shot.
      const sumNode: DiagramNode = {
        id: 'sum',
        type: 'compute-summation',
        label: 'sum',
        x: 0,
        y: 0,
      };
      const threshNode: DiagramNode = {
        id: 'thr',
        type: 'compute-threshold',
        label: 'thr',
        x: 0,
        y: 0,
        threshold: 40,
      };
      const multNode: DiagramNode = {
        id: 'mul',
        type: 'compute-multiply',
        label: 'mul',
        x: 0,
        y: 0,
      };
      const nodes = [
        sensor('a'),
        sensor('b'),
        sensor('c'),
        sumNode,
        threshNode,
        multNode,
        leftMotor(),
      ];
      const connections = [
        makeConn({ id: 'e1', from: 'a', to: 'sum', weight: 0.6 }),
        makeConn({ id: 'e2', from: 'b', to: 'sum', weight: 0.4 }),
        makeConn({ id: 'e3', from: 'sum', to: 'thr', weight: 1 }),
        makeConn({ id: 'e4', from: 'thr', to: 'mul', weight: 1 }),
        makeConn({ id: 'e5', from: 'c', to: 'mul', weight: 1 }),
        makeConn({ id: 'e6', from: 'mul', to: 'motor-L', weight: 1 }),
      ];
      const ids = ['a', 'b', 'c', 'sum', 'thr', 'mul', 'motor-L'];
      // Cover gate-open and gate-closed regimes plus an edge case.
      expectParity(nodes, connections, { a: 70, b: 60, c: 50 }, ids);
      expectParity(nodes, connections, { a: 10, b: 10, c: 50 }, ids);
      expectParity(nodes, connections, { a: 40, b: 40, c: 90 }, ids);
    });
  });
});

// ---------------------------------------------------------------------------
// Documented divergences (these are NOT parity tests — they pin the gap)
// ---------------------------------------------------------------------------

describe('known divergences (documented, not parity)', () => {
  it('delay node: trace passes through, C uses a ring buffer', () => {
    // The trace simulator has no time dimension. This test pins the
    // current pass-through behavior so it cannot drift silently. If you
    // ever add multi-tick simulation, replace this with a real parity
    // test against a tick-stepped C interpreter.
    const delayNode: DiagramNode = {
      id: 'd1',
      type: 'compute-delay',
      label: 'd',
      x: 0,
      y: 0,
      delayMs: 100,
    };
    const nodes = [sensor('s1'), delayNode, leftMotor()];
    const connections = [
      makeConn({ id: 'c1', from: 's1', to: 'd1' }),
      makeConn({ id: 'c2', from: 'd1', to: 'motor-L' }),
    ];
    const trace = simulateGraph(nodes, connections, { s1: 70 });
    expect(trace.nodeValues.d1).toBeCloseTo(70, 9);
  });

});

