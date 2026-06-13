import { useMemo } from 'react';
import type { CompoundTypeDefinition, DiagramNode, DiagramConnection, TransferPoint } from '../types/diagram';
import { TYPE_BY_ID } from '../types/diagram';
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
 * Per-tick simulation state. When passed to simulateGraph, oscillators use
 * `t` as their phase clock and delay nodes draw from / write to the per-node
 * ring buffers. Without state, simulateGraph is a stateless snapshot:
 * delays output 0 and oscillators fall back to Date.now() for phase.
 */
export interface SimulationState {
  /** Virtual time in ms since the simulation started. */
  t: number;
  /** Per-delay-node ring buffers. */
  delays: Map<string, { values: number[]; idx: number }>;
}

/**
 * Build an initial SimulationState for the given diagram. Each delay node
 * gets a zero-filled ring buffer sized from its `delayMs` and the loop
 * period, matching the codegen.
 */
export function createSimulationState(
  nodes: DiagramNode[],
  loopPeriodMs: number,
): SimulationState {
  const delays = new Map<string, { values: number[]; idx: number }>();
  for (const node of nodes) {
    if (node.type === 'compute-delay') {
      const delayMs = node.delayMs ?? 100;
      const size = Math.max(1, Math.round(delayMs / Math.max(1, loopPeriodMs)));
      delays.set(node.id, { values: new Array(size).fill(0), idx: 0 });
    }
  }
  return { t: 0, delays };
}

/**
 * Propagate sensor/constant input values through the wiring graph and
 * return the computed value at every node plus the signal carried on every
 * edge.
 *
 * When `state` is omitted this is a stateless snapshot — delay nodes
 * output 0 (no history) and oscillator/noise phase samples Date.now().
 * When `state` is supplied, it represents one tick of a running
 * simulation: oscillators use `state.t`, delays read from / write to the
 * ring buffers in `state.delays`. `state.delays` is mutated in place.
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

  // Phase clock for oscillator/noise — use simulation time when running
  // tick-stepped, otherwise wall clock so the static trace still animates
  // between unrelated re-renders.
  const phaseMs = state ? state.t : Date.now();

  for (const nodeId of order) {
    const node = nodeById.get(nodeId);
    if (!node) continue;
    const typeDef = TYPE_BY_ID[node.type];

    if (typeDef.kind === 'sensor') {
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
      nodeValues[nodeId] = amp * (Math.random() * 2 - 1);
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
      const raw = nodeValues[edge.from] ?? 0;
      const signal = applyTransfer(raw, edge);
      edgeSignals[edge.id] = signal;
      inputs.push(signal);
    }

    const sum = inputs.reduce((a, b) => a + b, 0);

    if (node.type === 'digital-out') {
      const thresh = node.threshold ?? 50;
      nodeValues[nodeId] = sum > thresh ? 100 : 0;
    } else if (typeDef.kind === 'output') {
      nodeValues[nodeId] = clamp(sum, -100, 100);
    } else if (typeDef.mode === 'threshold') {
      const thresh = node.threshold ?? 50;
      nodeValues[nodeId] = sum > thresh ? 100 : 0;
    } else if (typeDef.mode === 'multiply') {
      nodeValues[nodeId] = inputs.reduce((a, b) => a * b, 1);
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
      const raw = nodeValues[edge.from] ?? 0;
      edgeSignals[edge.id] = applyTransfer(raw, edge);
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
        const raw = nodeValues[edge.from] ?? 0;
        sum += applyTransfer(raw, edge);
      }
      buf.values[buf.idx] = sum;
      buf.idx = (buf.idx + 1) % buf.values.length;
    }
  }

  return { nodeValues, edgeSignals, disconnected };
}

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

/** Format a trace value smartly — fewer decimals for clean values. */
export function formatTraceValue(v: number): string {
  if (Number.isInteger(v)) return v.toString();
  const s = v.toFixed(2);
  // strip trailing zero: "0.50" → "0.5"
  return s.replace(/0$/, '');
}
