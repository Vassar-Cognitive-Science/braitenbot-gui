// Determinism tests: the trace simulation must be a pure function of
// (seed, diagram, inputs, tick index). Two clients constructing separate
// simulations from the same seed and stepping the same tick sequence must
// produce BIT-IDENTICAL traces — this is the contract shared trace mode
// (deterministic lockstep, collab-sync-design.md) is built on.

import { describe, it, expect } from 'vitest';
import {
  createSimulationState,
  noiseSample,
  simTimeMs,
  simulateGraph,
} from '../useTraceSimulation';
import type { DiagramNode, DiagramConnection } from '../../types/diagram';

function lin(c: Partial<DiagramConnection> & { id: string; from: string; to: string }): DiagramConnection {
  return {
    weight: 1,
    transferMode: 'linear',
    transferPoints: [{ x: -100, y: -100 }, { x: 100, y: 100 }],
    ...c,
  };
}

const LOOP_MS = 20;

/**
 * Sensor + oscillator + noise feeding a summation into a motor — exercises
 * every time/randomness-dependent node type except delay (covered
 * separately because of the late-joiner warm-up constraint).
 */
function delayFreeGraph(): { nodes: DiagramNode[]; connections: DiagramConnection[] } {
  const nodes: DiagramNode[] = [
    { id: 's1', type: 'sensor-analog', label: 's', x: 0, y: 0, arduinoPort: 'A0' },
    { id: 'o1', type: 'compute-oscillator', label: 'o', x: 0, y: 0, frequencyHz: 0.7, amplitude: 60 },
    { id: 'n1', type: 'compute-noise', label: 'n', x: 0, y: 0, amplitude: 30 },
    { id: 'sum1', type: 'compute-summation', label: 'sum', x: 0, y: 0 },
    { id: 'motor-left', type: 'servo-cr', label: 'L', x: 0, y: 0, servoPin: '9' },
  ];
  const connections = [
    lin({ id: 'c1', from: 's1', to: 'sum1', weight: 0.4 }),
    lin({ id: 'c2', from: 'o1', to: 'sum1', weight: 0.8 }),
    lin({ id: 'c3', from: 'n1', to: 'sum1', weight: 0.6 }),
    lin({ id: 'c4', from: 'sum1', to: 'motor-left' }),
  ];
  return { nodes, connections };
}

/**
 * Step a fresh simulation from `startTick` for `ticks` ticks, mirroring the
 * useScopeSimulation loop (tick pre-increments, then simulateGraph), and
 * return the per-tick values of the requested nodes.
 */
function runSim(
  nodes: DiagramNode[],
  connections: DiagramConnection[],
  seed: number,
  ticks: number,
  nodeIds: string[],
  startTick = 0,
  sensorValues: Record<string, number> = { s1: 50 },
): Record<string, number[]> {
  const state = createSimulationState(nodes, LOOP_MS, connections, [], seed);
  state.tick = startTick;
  const out: Record<string, number[]> = Object.fromEntries(nodeIds.map((id) => [id, []]));
  for (let i = 0; i < ticks; i++) {
    state.tick += 1;
    const r = simulateGraph(nodes, connections, sensorValues, state);
    for (const id of nodeIds) out[id].push(r.nodeValues[id]);
  }
  return out;
}

describe('deterministic lockstep simulation', () => {
  it('two separately-constructed sims with the same seed are bit-identical over 120 ticks', () => {
    const { nodes, connections } = delayFreeGraph();
    const ids = ['s1', 'o1', 'n1', 'sum1', 'motor-left'];
    const a = runSim(nodes, connections, 0xdecafbad, 120, ids);
    const b = runSim(nodes, connections, 0xdecafbad, 120, ids);
    for (const id of ids) {
      expect(a[id]).toHaveLength(120);
      // Object.is per sample: bit-identical, not merely approximately equal.
      for (let i = 0; i < 120; i++) {
        expect(Object.is(a[id][i], b[id][i]), `${id} diverged at tick ${i + 1}`).toBe(true);
      }
    }
    // Sanity: the noise node actually varies (we're not comparing constants).
    expect(new Set(a.n1).size).toBeGreaterThan(100);
  });

  it('different seeds diverge', () => {
    const { nodes, connections } = delayFreeGraph();
    const a = runSim(nodes, connections, 1, 50, ['n1', 'motor-left']);
    const b = runSim(nodes, connections, 2, 50, ['n1', 'motor-left']);
    expect(a.n1).not.toEqual(b.n1);
    expect(a['motor-left']).not.toEqual(b['motor-left']);
  });

  it('noiseSample is a pure, bounded function of (seed, nodeId, tick)', () => {
    // Purity: same triple → same value.
    expect(noiseSample(42, 'n1', 7)).toBe(noiseSample(42, 'n1', 7));
    // Sensitivity: each key component changes the sample.
    expect(noiseSample(42, 'n1', 7)).not.toBe(noiseSample(43, 'n1', 7));
    expect(noiseSample(42, 'n2', 7)).not.toBe(noiseSample(42, 'n1', 7));
    expect(noiseSample(42, 'n1', 8)).not.toBe(noiseSample(42, 'n1', 7));
    // Bounds and rough uniformity: samples stay in [-1, 1) and cover both
    // halves of the range.
    let neg = 0;
    let pos = 0;
    for (let tick = 0; tick < 1000; tick++) {
      const v = noiseSample(42, 'n1', tick);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThan(1);
      if (v < 0) neg++;
      else pos++;
    }
    expect(neg).toBeGreaterThan(300);
    expect(pos).toBeGreaterThan(300);
  });

  it('a late joiner handed tick N matches the tail of a run from tick 0 (delay-free graphs)', () => {
    const { nodes, connections } = delayFreeGraph();
    const ids = ['o1', 'n1', 'sum1', 'motor-left'];
    const seed = 0x12345678;
    const N = 80;
    const K = 40;
    const full = runSim(nodes, connections, seed, N + K, ids);
    const late = runSim(nodes, connections, seed, K, ids, N);
    for (const id of ids) {
      for (let i = 0; i < K; i++) {
        expect(
          Object.is(full[id][N + i], late[id][i]),
          `${id} late-joiner mismatch at tick ${N + i + 1}`,
        ).toBe(true);
      }
    }
  });

  it('KNOWN LIMITATION: late joiners need warm-up for delay ring buffers', () => {
    // A delay node's output depends on the last BUF_SIZE ticks of input
    // history, which a state created at tick N does not have — its ring
    // buffer is zero-filled. This is a real design constraint for shared
    // trace mode: a late joiner's delays read 0 until it has stepped
    // BUF_SIZE ticks, after which it re-converges with everyone else.
    // Phase 4 must either accept this brief divergence or ship ring-buffer
    // contents in the join handshake.
    const nodes: DiagramNode[] = [
      { id: 'o1', type: 'compute-oscillator', label: 'o', x: 0, y: 0, frequencyHz: 1, amplitude: 100 },
      { id: 'd1', type: 'compute-delay', label: 'd', x: 0, y: 0, delayMs: 100 }, // 5 ticks at 20ms
      { id: 'motor-left', type: 'servo-cr', label: 'L', x: 0, y: 0, servoPin: '9' },
    ];
    const connections = [
      lin({ id: 'c1', from: 'o1', to: 'd1' }),
      lin({ id: 'c2', from: 'd1', to: 'motor-left' }),
    ];
    const seed = 7;
    const N = 60;
    const bufSize = 5;
    const full = runSim(nodes, connections, seed, N + 20, ['d1'], 0, {});
    const late = runSim(nodes, connections, seed, 20, ['d1'], N, {});

    // During warm-up the late joiner reads its zero-filled buffer while the
    // long-running sim replays real history — they diverge.
    expect(late.d1.slice(0, bufSize)).toEqual([0, 0, 0, 0, 0]);
    expect(full.d1.slice(N, N + bufSize)).not.toEqual(late.d1.slice(0, bufSize));

    // After BUF_SIZE ticks both buffers hold the same (tick-derived)
    // history and the traces re-converge bit-identically.
    for (let i = bufSize; i < 20; i++) {
      expect(
        Object.is(full.d1[N + i], late.d1[i]),
        `d1 should have re-converged by tick ${N + i + 1}`,
      ).toBe(true);
    }
  });

  it('stateless snapshot is a pure function of its inputs (fixed at tick 0, seed 0)', () => {
    const { nodes, connections } = delayFreeGraph();
    const a = simulateGraph(nodes, connections, { s1: 50 });
    const b = simulateGraph(nodes, connections, { s1: 50 });
    expect(a.nodeValues).toEqual(b.nodeValues);
    expect(a.edgeSignals).toEqual(b.edgeSignals);
    // The snapshot matches a tick-0 stateful evaluation with seed 0.
    const state = createSimulationState(nodes, LOOP_MS, connections, [], 0);
    const c = simulateGraph(nodes, connections, { s1: 50 }, state);
    expect(a.nodeValues).toEqual(c.nodeValues);
  });

  it('simTimeMs derives ms time from the tick index', () => {
    const { nodes, connections } = delayFreeGraph();
    const state = createSimulationState(nodes, LOOP_MS, connections, [], 0);
    expect(simTimeMs(state)).toBe(0);
    state.tick = 123;
    expect(simTimeMs(state)).toBe(123 * LOOP_MS);
  });
});
