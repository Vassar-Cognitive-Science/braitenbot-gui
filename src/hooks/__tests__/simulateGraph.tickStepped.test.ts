import { describe, it, expect } from 'vitest';
import {
  createSimulationState,
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

describe('simulateGraph tick-stepped mode', () => {
  it('delay node replays the input after BUF_SIZE ticks', () => {
    const sensor: DiagramNode = {
      id: 's1', type: 'sensor-analog', label: 's', x: 0, y: 0, arduinoPort: 'A0',
    };
    const delay: DiagramNode = {
      id: 'd1', type: 'compute-delay', label: 'd', x: 0, y: 0, delayMs: 60,
    };
    const motor: DiagramNode = {
      id: 'motor-left', type: 'servo-cr', label: 'L', x: 0, y: 0, servoPin: '9',
    };
    const nodes = [sensor, delay, motor];
    const connections = [
      lin({ id: 'c1', from: 's1', to: 'd1' }),
      lin({ id: 'c2', from: 'd1', to: 'motor-left' }),
    ];
    // 60ms delay at 20ms loop = 3 ticks of history.
    const state = createSimulationState(nodes, 20);

    // Tick 1: sensor=70, delay reads buf[0]=0 (initial), buffer captures 70.
    let r = simulateGraph(nodes, connections, { s1: 70 }, state);
    expect(r.nodeValues.d1).toBe(0);

    // Tick 2: sensor=30, delay reads buf[1]=0, buffer captures 30.
    r = simulateGraph(nodes, connections, { s1: 30 }, state);
    expect(r.nodeValues.d1).toBe(0);

    // Tick 3: sensor=50, delay reads buf[2]=0, buffer captures 50.
    r = simulateGraph(nodes, connections, { s1: 50 }, state);
    expect(r.nodeValues.d1).toBe(0);

    // Tick 4: buffer wraps; delay reads buf[0]=70 (captured at tick 1).
    r = simulateGraph(nodes, connections, { s1: 0 }, state);
    expect(r.nodeValues.d1).toBeCloseTo(70, 9);

    // Tick 5: delay reads buf[1]=30.
    r = simulateGraph(nodes, connections, { s1: 0 }, state);
    expect(r.nodeValues.d1).toBeCloseTo(30, 9);

    // Tick 6: delay reads buf[2]=50.
    r = simulateGraph(nodes, connections, { s1: 0 }, state);
    expect(r.nodeValues.d1).toBeCloseTo(50, 9);
  });

  it('oscillator phase advances with state.t', () => {
    const osc: DiagramNode = {
      id: 'o1', type: 'compute-oscillator', label: 'o', x: 0, y: 0, frequencyHz: 1, amplitude: 100,
    };
    const sum: DiagramNode = {
      id: 'sum1', type: 'compute-summation', label: 'sum', x: 0, y: 0,
    };
    const motor: DiagramNode = {
      id: 'motor-left', type: 'servo-cr', label: 'L', x: 0, y: 0, servoPin: '9',
    };
    const nodes = [osc, sum, motor];
    const connections = [
      lin({ id: 'c1', from: 'o1', to: 'sum1' }),
      lin({ id: 'c2', from: 'sum1', to: 'motor-left' }),
    ];
    const state = createSimulationState(nodes, 20);

    // At t=0: 100 * sin(0) = 0.
    state.t = 0;
    let r = simulateGraph(nodes, connections, {}, state);
    expect(r.nodeValues.o1).toBeCloseTo(0, 9);

    // At t=250ms with 1Hz: 100 * sin(π/2) = 100.
    state.t = 250;
    r = simulateGraph(nodes, connections, {}, state);
    expect(r.nodeValues.o1).toBeCloseTo(100, 9);

    // At t=750ms: 100 * sin(3π/2) = -100.
    state.t = 750;
    r = simulateGraph(nodes, connections, {}, state);
    expect(r.nodeValues.o1).toBeCloseTo(-100, 9);
  });

  it('feedback cycle through a delay converges with constant input', () => {
    // Leaky integrator: Sum = input + 0.5 * Delay(Sum).
    // With input = 50, steady state Sum = 50 / (1 - 0.5) = 100.
    const sensor: DiagramNode = {
      id: 's1', type: 'sensor-analog', label: 's', x: 0, y: 0, arduinoPort: 'A0',
    };
    const sum: DiagramNode = {
      id: 'sum1', type: 'compute-summation', label: 'sum', x: 0, y: 0,
    };
    const delay: DiagramNode = {
      id: 'd1', type: 'compute-delay', label: 'd', x: 0, y: 0, delayMs: 20,
    };
    const motor: DiagramNode = {
      id: 'motor-left', type: 'servo-cr', label: 'L', x: 0, y: 0, servoPin: '9',
    };
    const nodes = [sensor, sum, delay, motor];
    const connections = [
      lin({ id: 'c1', from: 's1', to: 'sum1', weight: 1 }),
      lin({ id: 'c2', from: 'sum1', to: 'd1', weight: 1 }),
      lin({ id: 'c3', from: 'd1', to: 'sum1', weight: 0.5 }),
      lin({ id: 'c4', from: 'sum1', to: 'motor-left' }),
    ];
    const state = createSimulationState(nodes, 20);
    let last = 0;
    for (let i = 0; i < 50; i++) {
      const r = simulateGraph(nodes, connections, { s1: 50 }, state);
      last = r.nodeValues.sum1;
    }
    // 50 ticks is plenty for a 0.5-decay geometric series to be very near 100.
    expect(last).toBeCloseTo(100, 2);
  });
});
