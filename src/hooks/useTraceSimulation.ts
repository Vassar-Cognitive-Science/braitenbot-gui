import { useMemo } from 'react';
import type { CompoundTypeDefinition, DiagramNode, DiagramConnection, TransferPoint } from '../types/diagram';
import { TYPE_BY_ID, getOutputPorts } from '../types/diagram';
import { flattenCompounds } from '../codegen/flatten';
import { toposort } from '../codegen/toposort';

export interface TraceResult {
  /** Computed output value for each node, keyed by node ID. */
  nodeValues: Record<string, number>;
  /** Signal carried on each connection, keyed by connection ID. */
  edgeSignals: Record<string, number>;
  /** Set of node IDs that have no incoming connections (and aren't sources). */
  disconnected: Set<string>;
}

const EMPTY: TraceResult = { nodeValues: {}, edgeSignals: {}, disconnected: new Set() };

/**
 * Per-tick simulation state. When passed to simulateGraph, oscillators
 * derive their phase from the tick index, noise nodes draw from a
 * deterministic PRNG keyed on (seed, node id, tick), and delay nodes draw
 * from / write to the per-node ring buffers. Without state, simulateGraph
 * is a stateless snapshot evaluated at tick 0 with seed 0: delays output 0
 * and oscillator/noise values are fixed — the snapshot is a pure function
 * of its inputs.
 *
 * Determinism contract: two simulations constructed with the same seed and
 * stepped through the same (diagram, inputs, tick) sequence produce
 * bit-identical traces on any JS engine. No wall clock and no
 * Math.random() anywhere in the simulation.
 */
export interface SimulationState {
  /**
   * Integer tick index — the source of truth for simulation time. A late
   * joiner can be handed a tick number and step in lockstep from there
   * (delay ring buffers still need warm-up; see the determinism tests).
   */
  tick: number;
  /** Loop period in ms. Simulation time is derived as tick * loopPeriodMs. */
  loopPeriodMs: number;
  /** PRNG seed (uint32) for noise nodes. */
  seed: number;
  /** Per-delay-node ring buffers. */
  delays: Map<string, { values: number[]; idx: number }>;
}

/** Simulation time in ms — derived from the tick index, never accumulated. */
export function simTimeMs(state: SimulationState): number {
  return state.tick * state.loopPeriodMs;
}

/**
 * Deterministic noise sample in [-1, 1) — a pure function of
 * (seed, nodeId, tick). The node id is folded in with an FNV-1a hash, then
 * seed and tick are each folded through a splitmix32-style avalanche
 * finalizer. Only 32-bit integer ops (Math.imul, xor, unsigned shifts) plus
 * one final division by 2^32 are used — all bit-exact in IEEE-754 doubles,
 * so every JS engine produces the identical value for the same triple.
 */
export function noiseSample(seed: number, nodeId: string, tick: number): number {
  // FNV-1a over the node id.
  let h = 0x811c9dc5;
  for (let i = 0; i < nodeId.length; i++) {
    h = Math.imul(h ^ nodeId.charCodeAt(i), 0x01000193);
  }
  h = mix32(h, seed >>> 0);
  h = mix32(h, tick >>> 0);
  return (h / 0x100000000) * 2 - 1;
}

/** Fold `x` into `h` and avalanche (splitmix32 finalizer constants). */
function mix32(h: number, x: number): number {
  h = (h ^ x) >>> 0;
  h = (h + 0x9e3779b9) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x21f0aaad);
  h ^= h >>> 15;
  h = Math.imul(h, 0x735a2d97);
  h = (h ^ (h >>> 15)) >>> 0;
  return h;
}

/**
 * Build an initial SimulationState for the given diagram. Each delay node
 * gets a zero-filled ring buffer sized from its `delayMs` and the loop
 * period, matching the codegen.
 *
 * The graph is flattened first so that delay nodes living inside compound
 * bodies (whose flattened ids are instance-prefixed, e.g. `inst-1/d1`) get
 * ring buffers too — otherwise `simulateGraph` would look up a missing
 * buffer and report a constant 0 for them, unlike the hardware.
 */
export function createSimulationState(
  nodes: DiagramNode[],
  loopPeriodMs: number,
  connections: DiagramConnection[] = [],
  compoundTypes: CompoundTypeDefinition[] = [],
  seed = 0,
): SimulationState {
  const flat = flattenCompounds(nodes, connections, compoundTypes);
  const delays = new Map<string, { values: number[]; idx: number }>();
  for (const node of flat.nodes) {
    if (node.type === 'compute-delay') {
      const delayMs = node.delayMs ?? 100;
      const size = Math.max(1, Math.round(delayMs / Math.max(1, loopPeriodMs)));
      delays.set(node.id, { values: new Array(size).fill(0), idx: 0 });
    }
  }
  return { tick: 0, loopPeriodMs, seed: seed >>> 0, delays };
}

/**
 * Propagate sensor/constant input values through the wiring graph and
 * return the computed value at every node plus the signal carried on every
 * edge.
 *
 * When `state` is omitted this is a stateless snapshot evaluated at
 * tick 0 / seed 0 — delay nodes output 0 (no history) and oscillator/noise
 * values are fixed, making the snapshot a pure function of its inputs.
 * When `state` is supplied, it represents one tick of a running
 * simulation: oscillator phase and noise samples derive from `state.tick`,
 * delays read from / write to the ring buffers in `state.delays`.
 * `state.delays` is mutated in place.
 */
export function simulateGraph(
  nodes: DiagramNode[],
  connections: DiagramConnection[],
  sensorValues: Record<string, number>,
  state?: SimulationState,
  compoundTypes: CompoundTypeDefinition[] = [],
): TraceResult {
  if (nodes.length === 0) return EMPTY;

  // Inline compound instances so simulation sees the same flat graph
  // that codegen emits.
  const flat = flattenCompounds(nodes, connections, compoundTypes);
  nodes = flat.nodes;
  connections = flat.connections;

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const delayIds = new Set(
    nodes.filter((n) => n.type === 'compute-delay').map((n) => n.id),
  );

  let order: string[];
  try {
    // Mirror the codegen: edges into delay nodes don't impose ordering,
    // since the delay's output is taken from a previous iteration.
    order = toposort(
      nodes.map((n) => n.id),
      connections
        .filter((c) => !delayIds.has(c.to))
        .map((c) => ({ from: c.from, to: c.to })),
    );
  } catch {
    return EMPTY;
  }
  const nodeValues: Record<string, number> = {};
  const edgeSignals: Record<string, number> = {};
  const disconnected = new Set<string>();

  // Resolve the value an edge draws from its source. Multi-output sources
  // (the color sensor's r/g/b/c channels) publish per-port values keyed
  // `${id}:${port}`; an edge with a matching fromPort reads that channel.
  // Edges without a fromPort (or with a stale one) fall back to the node's
  // single value — which mirrors the emitter's srcPortSuffix, whose default
  // is the first declared port (the value we store at nodeValues[id]).
  const readSource = (edge: DiagramConnection): number => {
    if (edge.fromPort) {
      const key = `${edge.from}:${edge.fromPort}`;
      if (key in nodeValues) return nodeValues[key];
    }
    return nodeValues[edge.from] ?? 0;
  };

  // Time and randomness derive exclusively from the integer tick index so
  // two clients stepping the same tick sequence compute bit-identical
  // values. Stateless snapshots evaluate at tick 0 with seed 0.
  const tick = state?.tick ?? 0;
  const seed = state?.seed ?? 0;
  const phaseMs = state ? simTimeMs(state) : 0;

  for (const nodeId of order) {
    const node = nodeById.get(nodeId);
    if (!node) continue;
    const typeDef = TYPE_BY_ID[node.type];

    if (typeDef.kind === 'sensor') {
      if (node.type === 'sensor-color') {
        // The color sensor exposes four channels; the emitter reads each as
        // its own sig_<id>_<port> variable. Mirror that with per-port values
        // keyed `${id}:${port}` fed from per-channel sliders. The bare
        // nodeValues[id] holds the first port (clear) so the scope row and
        // node output display show a real channel, and portless edges match
        // the emitter's first-port default.
        const ports = getOutputPorts('sensor-color')!;
        for (const ch of ports) {
          nodeValues[`${nodeId}:${ch}`] = sensorValues[`${nodeId}:${ch}`] ?? 0;
        }
        nodeValues[nodeId] = nodeValues[`${nodeId}:${ports[0]}`];
        continue;
      }
      if (node.type === 'sensor-digital') {
        // digitalRead in codegen yields 0 or 100 (HIGH/LOW * 100). Mirror
        // that here so the trace and scope show a square wave, not a ramp.
        const raw = sensorValues[nodeId] ?? 0;
        nodeValues[nodeId] = raw >= 50 ? 100 : 0;
      } else {
        const raw = sensorValues[nodeId] ?? 50;
        nodeValues[nodeId] = node.invert ? 100 - raw : raw;
      }
      continue;
    }

    if (typeDef.kind === 'constant') {
      nodeValues[nodeId] = node.constantValue ?? 0;
      continue;
    }

    // Compound input anchors source their value from outside the body. When
    // the user is editing a body in isolation there's no outer scope, so we
    // treat them as sensor-like and read from sensorValues — that lets the
    // editor offer a slider on each input anchor in trace mode.
    if (node.type === 'compound-input') {
      nodeValues[nodeId] = sensorValues[nodeId] ?? 0;
      continue;
    }

    if (node.type === 'compute-oscillator') {
      const freq = node.frequencyHz ?? 1.0;
      const amp = node.amplitude ?? 100;
      nodeValues[nodeId] = amp * Math.sin(2 * Math.PI * freq * (phaseMs / 1000));
      continue;
    }

    if (node.type === 'compute-noise') {
      const amp = node.amplitude ?? 50;
      // Deterministic: same (seed, node id, tick) → same sample on any
      // client. Flattened compound noise nodes get instance-prefixed ids
      // (`inst-1/n1`), which are identical across clients too.
      nodeValues[nodeId] = amp * noiseSample(seed, nodeId, tick);
      continue;
    }

    if (node.type === 'compute-delay') {
      const buf = state?.delays.get(nodeId);
      // With state: read the value buffered N iterations ago. Without
      // state: 0 (no history available). Incoming edge signals are
      // computed in the second pass below, after all upstream values
      // are known.
      nodeValues[nodeId] = buf ? buf.values[buf.idx] : 0;
      continue;
    }

    // Gather weighted inputs and record per-edge signals
    const incomingEdges = connections.filter((c) => c.to === nodeId);

    if (incomingEdges.length === 0) {
      nodeValues[nodeId] = 0;
      disconnected.add(nodeId);
      continue;
    }

    const inputs: number[] = [];
    for (const edge of incomingEdges) {
      const raw = readSource(edge);
      const signal = applyTransfer(raw, edge);
      edgeSignals[edge.id] = signal;
      inputs.push(signal);
    }

    const sum = inputs.reduce((a, b) => a + b, 0);

    if (node.type === 'digital-out') {
      const thresh = node.threshold ?? 50;
      nodeValues[nodeId] = sum > thresh ? 100 : 0;
    } else if (node.type === 'display-tm1637') {
      // Emitter: constrain((int)lround(input), -999, 9999). The display shows
      // a 4-digit signed integer, not a ±100 signal — clamp to its range.
      nodeValues[nodeId] = clamp(lround(sum), -999, 9999);
    } else if (typeDef.kind === 'output') {
      nodeValues[nodeId] = clamp(sum, -100, 100);
    } else if (typeDef.mode === 'threshold') {
      const thresh = node.threshold ?? 50;
      nodeValues[nodeId] = sum > thresh ? 100 : 0;
    } else if (typeDef.mode === 'multiply') {
      nodeValues[nodeId] = inputs.reduce((a, b) => a * b, 1);
    } else if (typeDef.mode === 'min') {
      // inputs is non-empty here (the no-incoming case returned above), so
      // Math.min has a defined result rather than +Infinity.
      nodeValues[nodeId] = Math.min(...inputs);
    } else if (typeDef.mode === 'max') {
      nodeValues[nodeId] = Math.max(...inputs);
    } else if (typeDef.mode === 'delay') {
      nodeValues[nodeId] = sum;
    } else if (typeDef.mode === 'summation') {
      nodeValues[nodeId] = sum;
    } else {
      nodeValues[nodeId] = sum;
    }
  }

  // Second pass: compute outgoing edge signals for source nodes
  // (sensors/constants/oscillator/noise) and for edges feeding delay
  // nodes, both of which were skipped above.
  for (const edge of connections) {
    if (!(edge.id in edgeSignals)) {
      edgeSignals[edge.id] = applyTransfer(readSource(edge), edge);
    }
  }

  // Deferred delay-buffer write: aggregate current-iteration inputs and
  // push them into the ring buffer for next tick's read. This is the
  // simulator equivalent of emitDelayCapture in the codegen.
  if (state) {
    for (const node of nodes) {
      if (node.type !== 'compute-delay') continue;
      const buf = state.delays.get(node.id);
      if (!buf) continue;
      let sum = 0;
      for (const edge of connections) {
        if (edge.to !== node.id) continue;
        sum += applyTransfer(readSource(edge), edge);
      }
      buf.values[buf.idx] = sum;
      buf.idx = (buf.idx + 1) % buf.values.length;
    }
  }

  return { nodeValues, edgeSignals, disconnected };
}

/**
 * Static (stateless) trace of the diagram — a pure function of its inputs,
 * evaluated at tick 0 with seed 0. Delay nodes read as 0 and
 * oscillator/noise values are fixed; use useScopeSimulation for a running,
 * tick-stepped trace.
 */
export function useTraceSimulation(
  nodes: DiagramNode[],
  connections: DiagramConnection[],
  sensorValues: Record<string, number>,
  compoundTypes: CompoundTypeDefinition[] = [],
): TraceResult {
  return useMemo(
    () => simulateGraph(nodes, connections, sensorValues, undefined, compoundTypes),
    [nodes, connections, sensorValues, compoundTypes],
  );
}

function applyTransfer(input: number, edge: DiagramConnection): number {
  if (edge.transferMode === 'nonlinear' && edge.transferPoints.length >= 2) {
    return interpolateTransfer(input, edge.transferPoints);
  }
  return input * edge.weight;
}

function interpolateTransfer(input: number, points: TransferPoint[]): number {
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

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Round half away from zero, matching C's lround (JS Math.round is half-up). */
function lround(v: number): number {
  return Math.sign(v) * Math.round(Math.abs(v));
}

/** Format a trace value smartly — fewer decimals for clean values. */
export function formatTraceValue(v: number): string {
  if (Number.isInteger(v)) return v.toString();
  const s = v.toFixed(2);
  // strip trailing zero: "0.50" → "0.5"
  return s.replace(/0$/, '');
}
