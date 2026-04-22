import { useMemo } from 'react';
import type { DiagramNode, DiagramConnection, TransferPoint } from '../types/diagram';
import { TYPE_BY_ID } from '../types/diagram';
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
 * Pure simulation function — propagates sensor/constant input values through
 * the wiring graph and returns the computed value at every node plus the
 * signal carried on every edge.
 *
 * This is a *static* trace — delay nodes simply pass their input through
 * since there is no time dimension.
 *
 * Exposed separately from the hook so tests can call it without React.
 */
export function simulateGraph(
  nodes: DiagramNode[],
  connections: DiagramConnection[],
  sensorValues: Record<string, number>,
): TraceResult {
  if (nodes.length === 0) return EMPTY;

  let order: string[];
  try {
    order = toposort(
      nodes.map((n) => n.id),
      connections.map((c) => ({ from: c.from, to: c.to })),
    );
  } catch {
    return EMPTY;
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const nodeValues: Record<string, number> = {};
  const edgeSignals: Record<string, number> = {};
  const disconnected = new Set<string>();

  for (const nodeId of order) {
    const node = nodeById.get(nodeId);
    if (!node) continue;
    const typeDef = TYPE_BY_ID[node.type];

    if (typeDef.kind === 'sensor') {
      nodeValues[nodeId] = sensorValues[nodeId] ?? 50;
      continue;
    }

    if (typeDef.kind === 'constant') {
      nodeValues[nodeId] = node.constantValue ?? 0;
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

    if (typeDef.kind === 'motor') {
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

  // Also compute outgoing edge signals for source nodes (sensors/constants)
  for (const edge of connections) {
    if (!(edge.id in edgeSignals)) {
      const raw = nodeValues[edge.from] ?? 0;
      edgeSignals[edge.id] = applyTransfer(raw, edge);
    }
  }

  return { nodeValues, edgeSignals, disconnected };
}

export function useTraceSimulation(
  nodes: DiagramNode[],
  connections: DiagramConnection[],
  sensorValues: Record<string, number>,
): TraceResult {
  return useMemo(
    () => simulateGraph(nodes, connections, sensorValues),
    [nodes, connections, sensorValues],
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
