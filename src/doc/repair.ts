import * as Y from 'yjs';
import { CURVE_X_MAX, CURVE_X_MIN } from '../lib/transferCurve';
import { defaultMotorNodes } from './defaults';
import { nodeToYMap } from './yconvert';

type YNode = Y.Map<unknown>;
type YConn = Y.Map<unknown>;
type Container = Y.Map<YNode>;

// A compound instance's port must still exist as an anchor in its definition
// body. Non-compound ports (color-sensor channels) are always accepted — they
// aren't described in `compoundTypes`, so we never drop them here.
function hasCompoundPort(
  node: YNode,
  port: string,
  anchorType: 'compound-input' | 'compound-output',
  compoundTypes: Container,
): boolean {
  if (node.get('type') !== 'compound') return true;
  const typeId = node.get('compoundTypeId') as string | undefined;
  if (!typeId) return true;
  const def = compoundTypes.get(typeId) as Y.Map<unknown> | undefined;
  if (!def) return true;
  const anchors = def.get('nodes') as Container | undefined;
  const anchor = anchors?.get(port) as YNode | undefined;
  return !!anchor && anchor.get('type') === anchorType;
}

function fixTransferEndpoints(conn: YConn): void {
  const points = conn.get('transferPoints');
  if (!Array.isArray(points) || points.length < 2) return;
  const first = points[0] as { x: number };
  const last = points[points.length - 1] as { x: number };
  if (first.x === CURVE_X_MIN && last.x === CURVE_X_MAX) return;
  const fixed = points.map((p) => ({ ...(p as object) })) as Array<{ x: number }>;
  fixed[0] = { ...fixed[0], x: CURVE_X_MIN };
  fixed[fixed.length - 1] = { ...fixed[fixed.length - 1], x: CURVE_X_MAX };
  conn.set('transferPoints', fixed);
}

// Drop connections whose endpoints (or compound ports) no longer exist in this
// container, and clamp transfer-curve endpoint anchors back to x = ±100.
function repairConnectionContainer(
  nodes: Container,
  connections: Container,
  compoundTypes: Container,
): void {
  for (const [id, conn] of [...connections.entries()]) {
    const from = conn.get('from') as string;
    const to = conn.get('to') as string;
    if (!nodes.has(from) || !nodes.has(to)) {
      connections.delete(id);
      continue;
    }
    const fromPort = conn.get('fromPort') as string | undefined;
    const toPort = conn.get('toPort') as string | undefined;
    if (fromPort && !hasCompoundPort(nodes.get(from)!, fromPort, 'compound-output', compoundTypes)) {
      connections.delete(id);
      continue;
    }
    if (toPort && !hasCompoundPort(nodes.get(to)!, toPort, 'compound-input', compoundTypes)) {
      connections.delete(id);
      continue;
    }
    fixTransferEndpoints(conn);
  }
}

/**
 * Enforce semantic invariants CRDTs can't guarantee. Must run inside a
 * transaction (the store uses an untracked 'repair' origin). Idempotent, so it
 * is safe to run after every undo/redo and — later — every remote transaction.
 */
export function repairDiagram(
  nodes: Container,
  connections: Container,
  compoundTypes: Container,
): void {
  // (b) The two wheel-motor singletons always exist at the top level.
  for (const motor of defaultMotorNodes()) {
    if (!nodes.has(motor.id)) nodes.set(motor.id, nodeToYMap(motor) as YNode);
  }

  // (a)+(c) Top level, then every compound body.
  repairConnectionContainer(nodes, connections, compoundTypes);
  for (const def of compoundTypes.values()) {
    const bodyNodes = def.get('nodes') as Container | undefined;
    const bodyConnections = def.get('connections') as Container | undefined;
    if (bodyNodes && bodyConnections) {
      repairConnectionContainer(bodyNodes, bodyConnections, compoundTypes);
    }
  }
}
