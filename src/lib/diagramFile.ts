import type { DiagramConnection, DiagramNode } from '../types/diagram';

export interface DiagramFile {
  loopPeriodMs: number;
  nodes: DiagramNode[];
  connections: DiagramConnection[];
}

export interface DiagramState {
  nodes: DiagramNode[];
  connections: DiagramConnection[];
  loopPeriodMs: number;
}

export function serialize(state: DiagramState): string {
  const file: DiagramFile = {
    loopPeriodMs: state.loopPeriodMs,
    nodes: state.nodes,
    connections: state.connections,
  };
  return JSON.stringify(file, null, 2);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validateNode(raw: unknown, index: number): DiagramNode {
  if (!isObject(raw)) {
    throw new Error(`nodes[${index}] is not an object`);
  }
  const { id, type, label, x, y } = raw;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`nodes[${index}].id must be a non-empty string`);
  }
  if (typeof type !== 'string') {
    throw new Error(`nodes[${index}].type must be a string`);
  }
  if (typeof label !== 'string') {
    throw new Error(`nodes[${index}].label must be a string`);
  }
  if (typeof x !== 'number' || typeof y !== 'number') {
    throw new Error(`nodes[${index}].x and .y must be numbers`);
  }
  return raw as unknown as DiagramNode;
}

function validateConnection(raw: unknown, index: number): DiagramConnection {
  if (!isObject(raw)) {
    throw new Error(`connections[${index}] is not an object`);
  }
  const { id, from, to, weight } = raw;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`connections[${index}].id must be a non-empty string`);
  }
  if (typeof from !== 'string' || typeof to !== 'string') {
    throw new Error(`connections[${index}].from and .to must be strings`);
  }
  if (typeof weight !== 'number') {
    throw new Error(`connections[${index}].weight must be a number`);
  }
  return raw as unknown as DiagramConnection;
}

export function parse(text: string): DiagramFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`Not a valid JSON file: ${(err as Error).message}`);
  }
  if (!isObject(raw)) {
    throw new Error('Diagram file must be a JSON object');
  }
  if (typeof raw.loopPeriodMs !== 'number' || !Number.isFinite(raw.loopPeriodMs)) {
    throw new Error('loopPeriodMs must be a finite number');
  }
  if (!Array.isArray(raw.nodes)) {
    throw new Error('nodes must be an array');
  }
  if (!Array.isArray(raw.connections)) {
    throw new Error('connections must be an array');
  }
  const nodes = raw.nodes.map(validateNode);
  const connections = raw.connections.map(validateConnection);
  return {
    loopPeriodMs: raw.loopPeriodMs,
    nodes,
    connections,
  };
}
