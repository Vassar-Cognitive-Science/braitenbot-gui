export class CycleError extends Error {
  involvedNodeIds: string[];

  constructor(involvedNodeIds: string[]) {
    super(`Cycle detected involving nodes: ${involvedNodeIds.join(', ')}`);
    this.name = 'CycleError';
    this.involvedNodeIds = involvedNodeIds;
  }
}

/**
 * Kahn's algorithm: returns node IDs in topological order.
 * Throws CycleError if the graph contains a cycle.
 */
export function toposort(
  nodeIds: string[],
  edges: { from: string; to: string }[],
): string[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const id of nodeIds) {
    inDegree.set(id, 0);
    adjacency.set(id, []);
  }

  for (const edge of edges) {
    adjacency.get(edge.from)!.push(edge.to);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);
    for (const neighbor of adjacency.get(current)!) {
      const newDeg = inDegree.get(neighbor)! - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  if (sorted.length !== nodeIds.length) {
    const cycleNodes = nodeIds.filter((id) => !sorted.includes(id));
    throw new CycleError(cycleNodes);
  }

  return sorted;
}
