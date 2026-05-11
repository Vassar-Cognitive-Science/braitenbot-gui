import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DiagramConnection, DiagramNode } from '../types/diagram';
import {
  type SimulationState,
  type TraceResult,
  createSimulationState,
  simulateGraph,
} from './useTraceSimulation';

/**
 * A rolling buffer of samples for a single node, keyed in the parent map by
 * node id. Time values are in ms of simulation time (state.t).
 */
export interface ScopeRow {
  times: number[];
  values: number[];
}

/**
 * An active pulse injection on a sensor. Until `endsAtT` the sensor's value
 * is overridden with `value` regardless of the slider position. Triggered
 * by the per-sensor "▶" button so users can probe latches, pulse responses,
 * and edge-triggered behaviors without dropping the slider.
 */
interface Pulse {
  value: number;
  endsAtT: number;
}

const EMPTY: TraceResult = { nodeValues: {}, edgeSignals: {}, disconnected: new Set() };

/** State-update throttle for the diagram trace display, in ticks. */
const DIAGRAM_UPDATE_EVERY = 2;

export interface UseScopeSimulationOptions {
  /** Visible scope window in seconds. */
  windowSec?: number;
}

export interface UseScopeSimulationResult {
  /** Latest TraceResult, suitable for driving the diagram's trace overlay. */
  current: TraceResult;
  /** Mutable buffer map keyed by node id — read directly from rAF. */
  buffersRef: React.MutableRefObject<Map<string, ScopeRow>>;
  /** Current simulation time in ms — read directly from rAF. */
  timeRef: React.MutableRefObject<number>;
  /** True while ticks are being stepped. */
  running: boolean;
  paused: boolean;
  setPaused: (p: boolean) => void;
  /** Discard buffer history and reset the sim clock. */
  clear: () => void;
  /**
   * Inject a temporary override on a sensor for `durationMs`. Stacks if
   * called rapidly — the most recent call wins.
   */
  pulse: (sensorId: string, value: number, durationMs: number) => void;
}

/**
 * Tick-stepped simulation loop with rolling scope buffers. Drives the
 * diagram's live trace values and the oscilloscope panel from the same
 * source of truth.
 *
 * Sampling runs at `loopPeriodMs` while `enabled && !paused`. React state
 * for the diagram trace is updated every Nth tick to avoid re-rendering
 * the canvas at full sample rate; the oscilloscope canvas reads `buffersRef`
 * directly via requestAnimationFrame.
 */
export function useScopeSimulation(
  nodes: DiagramNode[],
  connections: DiagramConnection[],
  sensorValues: Record<string, number>,
  enabled: boolean,
  loopPeriodMs: number,
  options: UseScopeSimulationOptions = {},
): UseScopeSimulationResult {
  const windowSec = options.windowSec ?? 5;
  const windowMs = windowSec * 1000;

  const stateRef = useRef<SimulationState | null>(null);
  const buffersRef = useRef<Map<string, ScopeRow>>(new Map());
  const timeRef = useRef(0);
  const pulsesRef = useRef<Map<string, Pulse>>(new Map());

  // Latest props for the interval callback — refs avoid restarting the
  // tick loop on every keystroke or slider drag.
  const nodesRef = useRef(nodes);
  const connectionsRef = useRef(connections);
  const sensorValuesRef = useRef(sensorValues);
  nodesRef.current = nodes;
  connectionsRef.current = connections;
  sensorValuesRef.current = sensorValues;

  const [current, setCurrent] = useState<TraceResult>(EMPTY);
  const [paused, setPaused] = useState(false);

  const initSim = useCallback(() => {
    stateRef.current = createSimulationState(nodesRef.current, loopPeriodMs);
    timeRef.current = 0;
    buffersRef.current = new Map();
    pulsesRef.current = new Map();
    setCurrent(EMPTY);
  }, [loopPeriodMs]);

  const clear = useCallback(() => {
    initSim();
  }, [initSim]);

  const pulse = useCallback((sensorId: string, value: number, durationMs: number) => {
    const now = timeRef.current;
    pulsesRef.current.set(sensorId, { value, endsAtT: now + durationMs });
  }, []);

  // Reset when the sim is turned on, or when the diagram's structure or
  // loop period changes in a way that the existing buffers/state no
  // longer model. We compare by id+typeId+delayMs instead of node-array
  // identity so dragging a node or toggling trace mode doesn't trash
  // accumulated history.
  const structureKey = useMemo(() => structureFingerprint(nodes), [nodes]);
  useEffect(() => {
    if (!enabled) {
      stateRef.current = null;
      return;
    }
    initSim();
  }, [enabled, structureKey, loopPeriodMs, initSim]);

  useEffect(() => {
    if (!enabled || paused) return;
    let tickCount = 0;
    const interval = window.setInterval(() => {
      const state = stateRef.current;
      if (!state) return;
      state.t += loopPeriodMs;
      timeRef.current = state.t;

      // Resolve sensor inputs with active pulses overriding the slider.
      const effective: Record<string, number> = { ...sensorValuesRef.current };
      for (const [id, p] of pulsesRef.current) {
        if (state.t < p.endsAtT) {
          effective[id] = p.value;
        } else {
          pulsesRef.current.delete(id);
        }
      }

      const result = simulateGraph(
        nodesRef.current,
        connectionsRef.current,
        effective,
        state,
      );

      // Append to scope buffers and prune the trailing edge.
      const buffers = buffersRef.current;
      const cutoff = state.t - windowMs;
      for (const node of nodesRef.current) {
        const v = result.nodeValues[node.id] ?? 0;
        let row = buffers.get(node.id);
        if (!row) {
          row = { times: [], values: [] };
          buffers.set(node.id, row);
        }
        row.times.push(state.t);
        row.values.push(v);
        while (row.times.length > 0 && row.times[0] < cutoff) {
          row.times.shift();
          row.values.shift();
        }
      }

      // Drop buffers for nodes that no longer exist in the diagram.
      const liveIds = new Set(nodesRef.current.map((n) => n.id));
      for (const id of buffers.keys()) {
        if (!liveIds.has(id)) buffers.delete(id);
      }

      tickCount += 1;
      if (tickCount % DIAGRAM_UPDATE_EVERY === 0) {
        setCurrent(result);
      }
    }, Math.max(1, loopPeriodMs));
    return () => window.clearInterval(interval);
  }, [enabled, paused, loopPeriodMs, windowMs]);

  return {
    current: enabled ? current : EMPTY,
    buffersRef,
    timeRef,
    running: enabled && !paused,
    paused,
    setPaused,
    clear,
    pulse,
  };
}

function structureFingerprint(nodes: DiagramNode[]): string {
  // Only fields that change the sim's structural state need to be in
  // here. Other fields (label, position, weights) can change without
  // resetting the sim.
  return nodes
    .map((n) => `${n.id}:${n.type}:${n.delayMs ?? ''}`)
    .sort()
    .join('|');
}
