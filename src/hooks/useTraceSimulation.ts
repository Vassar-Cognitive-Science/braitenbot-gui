import { useMemo } from 'react';
import type { DiagramNode, DiagramConnection, TransferPoint } from '../types/diagram';
import { TYPE_BY_ID } from '../types/diagram';
import { toposort } from '../codegen/toposort';

/**
 * Given sensor/constant input values set by the user, propagate signals
 * through the wiring graph and return the computed value at every node.
 *
 * This is a *static* trace — delay nodes simply pass their input through
 * since there is no time dimension.
 */
export function useTraceSimulation(
  nodes: DiagramNode[],
  connections: DiagramConnection[],
  sensorValues: Record<string, number>,
): Record<string, number> {
  return useMemo(() => {
    if (nodes.length === 0) return {};

    // Build topo order; if there's a cycle just return empty.
    let order: string[];
    try {
      order = toposort(
        nodes.map((n) => n.id),
        connections.map((c) => ({ from: c.from, to: c.to })),
      );
    } catch {
      return {};
    }

    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const values: Record<string, number> = {};

    for (const nodeId of order) {
      const node = nodeById.get(nodeId);
      if (!node) continue;
      const typeDef = TYPE_BY_ID[node.type];

      if (typeDef.kind === 'sensor') {
        values[nodeId] = sensorValues[nodeId] ?? 0.5;
        continue;
      }

      if (typeDef.kind === 'constant') {
        values[nodeId] = node.constantValue ?? 0.5;
        continue;
      }

      // Gather weighted inputs
      const incomingEdges = connections.filter((c) => c.to === nodeId);
      const inputs = incomingEdges.map((edge) => {
        const raw = values[edge.from] ?? 0;
        return applyTransfer(raw, edge);
      });

      if (inputs.length === 0) {
        values[nodeId] = 0;
        continue;
      }

      const sum = inputs.reduce((a, b) => a + b, 0);

      if (typeDef.kind === 'motor') {
        // Clamp motor output to [-1, 1]
        values[nodeId] = clamp(sum, -1, 1);
      } else if (typeDef.mode === 'threshold') {
        const thresh = node.threshold ?? 0.5;
        values[nodeId] = sum >= thresh ? sum : 0;
      } else if (typeDef.mode === 'comparator') {
        // Comparator expects exactly 2 inputs; compare first vs second
        if (inputs.length >= 2) {
          values[nodeId] = compare(inputs[0], inputs[1], node.comparatorOp ?? '>') ? 1 : 0;
        } else {
          values[nodeId] = 0;
        }
      } else if (typeDef.mode === 'delay') {
        // Static trace: delay just passes through
        values[nodeId] = sum;
      } else if (typeDef.mode === 'summation') {
        values[nodeId] = sum;
      } else {
        values[nodeId] = sum;
      }
    }

    return values;
  }, [nodes, connections, sensorValues]);
}

function applyTransfer(input: number, edge: DiagramConnection): number {
  if (edge.transferMode === 'nonlinear' && edge.transferPoints.length >= 2) {
    return interpolateTransfer(input, edge.transferPoints);
  }
  return input * edge.weight;
}

function interpolateTransfer(input: number, points: TransferPoint[]): number {
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const clamped = clamp(input, 0, 1);

  if (clamped <= sorted[0].x) return sorted[0].y;
  if (clamped >= sorted[sorted.length - 1].x) return sorted[sorted.length - 1].y;

  for (let i = 0; i < sorted.length - 1; i++) {
    if (clamped >= sorted[i].x && clamped <= sorted[i + 1].x) {
      const t = (clamped - sorted[i].x) / (sorted[i + 1].x - sorted[i].x);
      return sorted[i].y + t * (sorted[i + 1].y - sorted[i].y);
    }
  }

  return sorted[sorted.length - 1].y;
}

function compare(a: number, b: number, op: string): boolean {
  switch (op) {
    case '>': return a > b;
    case '<': return a < b;
    case '>=': return a >= b;
    case '<=': return a <= b;
    case '==': return a === b;
    case '!=': return a !== b;
    default: return false;
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
