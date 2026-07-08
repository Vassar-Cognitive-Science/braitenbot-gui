import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CompoundTypeDefinition, DiagramConnection, DiagramNode } from '../types/diagram';
import {
  type SimulationPlan,
  type SimulationState,
  type TraceResult,
  buildSimulationPlan,
  createSimulationState,
  simulateGraph,
} from './useTraceSimulation';

/**
 * A rolling buffer of samples for a single node, keyed in the parent map by
 * node id. Time values are in ms of simulation time (tick * loopPeriodMs).
 */
export interface ScopeRow {
  times: number[];
  values: number[];
}

/**
 * An active pulse injection on a sensor. Until `endsAtTick` the sensor's
 * value is overridden with `value` regardless of the slider position.
 * Triggered by the per-sensor "▶" button so users can probe latches, pulse
 * responses, and edge-triggered behaviors without dropping the slider.
 * Tick-based so a pulse is reproducible as (start tick, duration in ticks)
 * — phase 4 turns this into a shared timestamped event.
 */
interface Pulse {
  value: number;
  endsAtTick: number;
}

const EMPTY: TraceResult = { nodeValues: {}, edgeSignals: {}, disconnected: new Set() };

/**
 * Minimum wall-derived sim time between React state pushes for the diagram
 * trace display (~10Hz). Scope buffers still append every tick — only the
 * React re-render is throttled — and the cadence is independent of the loop
 * period (a 5ms loop won't flood React at 200Hz).
 */
const DIAGRAM_UPDATE_INTERVAL_MS = 100;

export interface UseScopeSimulationOptions {
  /** Visible scope window in seconds. */
  windowSec?: number;
  /**
   * PRNG seed for noise nodes. When omitted, a fresh seed is generated
   * each time the simulation (re)starts. A collaborative session passes
   * the shared session seed here so all clients produce identical traces.
   */
  seed?: number;
}

export interface UseScopeSimulationResult {
  /** Latest TraceResult, suitable for driving the diagram's trace overlay. */
  traceResult: TraceResult;
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
   * Inject a temporary override on a sensor for `durationMs` (internally
   * rounded to whole ticks). Stacks if called rapidly — the most recent
   * call wins.
   */
  pulse: (sensorId: string, value: number, durationMs: number) => void;
  /** Current integer tick index (0 when not running) — for shared pulse events. */
  currentTick: () => number;
  /**
   * PRNG seed of the current simulation run — read directly (e.g. to put
   * it in a shared session doc). Set via options.seed; otherwise freshly
   * generated whenever the simulation (re)starts.
   */
  seedRef: React.MutableRefObject<number>;
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
  compoundTypes: CompoundTypeDefinition[] = [],
  options: UseScopeSimulationOptions = {},
): UseScopeSimulationResult {
  const windowSec = options.windowSec ?? 5;
  const windowMs = windowSec * 1000;
  const optionSeed = options.seed;

  const stateRef = useRef<SimulationState | null>(null);
  const buffersRef = useRef<Map<string, ScopeRow>>(new Map());
  const timeRef = useRef(0);
  const seedRef = useRef(0);
  const pulsesRef = useRef<Map<string, Pulse>>(new Map());
  // Sim time (ms) of the last React state push — throttles re-renders.
  const lastDisplayPushRef = useRef(0);

  // Latest props for the interval callback — refs avoid restarting the
  // tick loop on every keystroke or slider drag.
  const nodesRef = useRef(nodes);
  const connectionsRef = useRef(connections);
  const sensorValuesRef = useRef(sensorValues);
  const compoundTypesRef = useRef(compoundTypes);
  // eslint-disable-next-line react-hooks/refs
  nodesRef.current = nodes;         // intentional render-time ref sync — avoids restarting tick loop on prop changes
  // eslint-disable-next-line react-hooks/refs
  connectionsRef.current = connections;
  // eslint-disable-next-line react-hooks/refs
  sensorValuesRef.current = sensorValues;
  // eslint-disable-next-line react-hooks/refs
  compoundTypesRef.current = compoundTypes;

  // Compiled simulation plan — the structural work (flatten, toposort,
  // adjacency, sorted transfers) done once per edit rather than every tick.
  // Rebuilds when node/connection/compound identity changes; node-position
  // drags rebuild too, which is still edit-time (not per-tick) and fine.
  // Skipped entirely while the sim is off so trace mode adds zero cost to
  // plain editing.
  const plan = useMemo(
    () => (enabled ? buildSimulationPlan(nodes, connections, compoundTypes) : null),
    [enabled, nodes, connections, compoundTypes],
  );
  const planRef = useRef<SimulationPlan | null>(plan);
  // eslint-disable-next-line react-hooks/refs
  planRef.current = plan;    // intentional render-time ref sync — matches the prop refs above

  const [current, setCurrent] = useState<TraceResult>(EMPTY);
  const [paused, setPaused] = useState(false);

  const initSim = useCallback(() => {
    // Seed chosen at session start — wall clock is fine here because it is
    // outside the simulation; every value thereafter derives from the seed
    // and the integer tick index. A shared session passes options.seed.
    const seed = optionSeed ?? (Date.now() >>> 0);
    seedRef.current = seed;
    stateRef.current = createSimulationState(
      nodesRef.current,
      loopPeriodMs,
      connectionsRef.current,
      compoundTypesRef.current,
      seed,
    );
    timeRef.current = 0;
    buffersRef.current = new Map();
    pulsesRef.current = new Map();
    // Reset the throttle marker so the first push lands ~one interval after
    // start (sim time begins at 0) — never left starved indefinitely.
    lastDisplayPushRef.current = 0;
    setCurrent(EMPTY);
  }, [loopPeriodMs, optionSeed]);

  const clear = useCallback(() => {
    initSim();
  }, [initSim]);

  const pulse = useCallback((sensorId: string, value: number, durationMs: number) => {
    const state = stateRef.current;
    if (!state) return;
    const ticks = Math.max(1, Math.round(durationMs / Math.max(1, loopPeriodMs)));
    pulsesRef.current.set(sensorId, { value, endsAtTick: state.tick + ticks });
  }, [loopPeriodMs]);

  const currentTick = useCallback(() => stateRef.current?.tick ?? 0, []);

  // Reset when the sim is turned on, or when the diagram's structure or
  // loop period changes in a way that the existing buffers/state no
  // longer model. Simulation state is solely delay ring buffers, so we
  // fingerprint the FLATTENED delay nodes the plan sees (including those
  // inside compound bodies) rather than the top-level node array. Keying
  // off top-level nodes would miss a compound-body delay edit — which
  // rebuilds the plan but leaves top-level nodes untouched — leaving the
  // buffers desynced from the plan's delay ids until trace is toggled.
  // Deriving from the plan also means node drags/labels don't trash
  // accumulated history (the fingerprint string is unchanged).
  const structureKey = useMemo(() => delayStructureFingerprint(plan), [plan]);
  useEffect(() => {
    if (!enabled) {
      stateRef.current = null;
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    initSim(); // resets sim state (including setCurrent) on enable/structure change — intentional
  }, [enabled, structureKey, loopPeriodMs, initSim]);

  useEffect(() => {
    if (!enabled || paused) return;
    const interval = window.setInterval(() => {
      const state = stateRef.current;
      if (!state) return;
      // The integer tick index is the source of truth; ms time is derived.
      state.tick += 1;
      const t = state.tick * loopPeriodMs;
      timeRef.current = t;

      // Resolve sensor inputs with active pulses overriding the slider.
      const effective: Record<string, number> = { ...sensorValuesRef.current };
      for (const [id, p] of pulsesRef.current) {
        if (state.tick < p.endsAtTick) {
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
        compoundTypesRef.current,
        // null only while disabled, and the interval doesn't run then — the
        // ?? undefined fallback (plan built internally) is just type safety.
        planRef.current ?? undefined,
      );

      // Append to scope buffers and prune the trailing edge.
      const buffers = buffersRef.current;
      const cutoff = t - windowMs;
      for (const node of nodesRef.current) {
        const v = result.nodeValues[node.id] ?? 0;
        let row = buffers.get(node.id);
        if (!row) {
          row = { times: [], values: [] };
          buffers.set(node.id, row);
        }
        row.times.push(t);
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

      // Push to React state at most ~10Hz of sim time, regardless of loop
      // period. Buffers above already captured this tick; only the re-render
      // is throttled.
      if (t - lastDisplayPushRef.current >= DIAGRAM_UPDATE_INTERVAL_MS) {
        lastDisplayPushRef.current = t;
        setCurrent(result);
      }
    }, Math.max(1, loopPeriodMs));
    return () => window.clearInterval(interval);
  }, [enabled, paused, loopPeriodMs, windowMs]);

  return {
    traceResult: enabled ? current : EMPTY,
    buffersRef,
    timeRef,
    running: enabled && !paused,
    paused,
    setPaused,
    clear,
    pulse,
    currentTick,
    seedRef,
  };
}

function delayStructureFingerprint(plan: SimulationPlan | null): string {
  // Sim state consists solely of delay ring buffers, whose ids and sizes
  // derive from the flattened `compute-delay` nodes (id + delayMs; buffer
  // size also depends on loopPeriodMs, already a separate reset dep). No
  // plan (sim off) → empty; the reset effect no-ops while disabled anyway.
  if (!plan) return '';
  return [...plan.delayIds]
    .sort()
    .map((id) => `${id}:${plan.nodeById.get(id)?.delayMs ?? ''}`)
    .join('|');
}
