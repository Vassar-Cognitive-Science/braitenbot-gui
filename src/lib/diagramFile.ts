import type {
  CompoundTypeDefinition,
  DiagramComment,
  DiagramConnection,
  DiagramNode,
} from '../types/diagram';

export interface DiagramFile {
  loopPeriodMs: number;
  capWeights: boolean;
  pulseDurationMs: number;
  nodes: DiagramNode[];
  connections: DiagramConnection[];
  compoundTypes: CompoundTypeDefinition[];
  comments: DiagramComment[];
}

export interface DiagramState {
  nodes: DiagramNode[];
  connections: DiagramConnection[];
  loopPeriodMs: number;
  /** Whether connection weights are constrained to [-1, 1]. A diagram-level
   *  preference: it travels with the document (shared live, saved to file). */
  capWeights: boolean;
  /** Trace ▶ pulse hold duration (ms). Diagram-level so a shared/opened diagram
   *  carries the author's chosen timing. */
  pulseDurationMs: number;
  compoundTypes: CompoundTypeDefinition[];
  comments: DiagramComment[];
}

export function serialize(state: DiagramState): string {
  const file: DiagramFile = {
    loopPeriodMs: state.loopPeriodMs,
    capWeights: state.capWeights,
    pulseDurationMs: state.pulseDurationMs,
    nodes: state.nodes,
    connections: state.connections,
    compoundTypes: state.compoundTypes,
    comments: state.comments,
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

function validateCompoundType(raw: unknown, index: number): CompoundTypeDefinition {
  if (!isObject(raw)) {
    throw new Error(`compoundTypes[${index}] is not an object`);
  }
  const { id, displayName, body } = raw;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`compoundTypes[${index}].id must be a non-empty string`);
  }
  if (typeof displayName !== 'string') {
    throw new Error(`compoundTypes[${index}].displayName must be a string`);
  }
  if (!isObject(body) || !Array.isArray(body.nodes) || !Array.isArray(body.connections)) {
    throw new Error(`compoundTypes[${index}].body must be { nodes: [], connections: [] }`);
  }
  body.nodes.forEach((n, i) => validateNode(n, i));
  body.connections.forEach((c, i) => validateConnection(c, i));
  return raw as unknown as CompoundTypeDefinition;
}

function validateComment(raw: unknown, index: number): DiagramComment {
  if (!isObject(raw)) {
    throw new Error(`comments[${index}] is not an object`);
  }
  const { id, x, y, width, height, text } = raw;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`comments[${index}].id must be a non-empty string`);
  }
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof width !== 'number' ||
    typeof height !== 'number'
  ) {
    throw new Error(`comments[${index}].x/.y/.width/.height must be numbers`);
  }
  if (typeof text !== 'string') {
    throw new Error(`comments[${index}].text must be a string`);
  }
  return raw as unknown as DiagramComment;
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
  // compoundTypes is optional — files saved before this field was introduced
  // load as an empty list. Alpha policy: no migration, just a default.
  const compoundTypes = Array.isArray(raw.compoundTypes)
    ? raw.compoundTypes.map(validateCompoundType)
    : [];
  // comments is optional — files saved before this field was introduced load
  // as an empty list. Alpha policy: no migration, just a default.
  const comments = Array.isArray(raw.comments)
    ? raw.comments.map(validateComment)
    : [];
  // capWeights / pulseDurationMs are optional — files saved before these
  // diagram-level prefs existed load with sensible defaults. Alpha policy: no
  // migration, just a default.
  const capWeights = typeof raw.capWeights === 'boolean' ? raw.capWeights : true;
  const pulseDurationMs =
    typeof raw.pulseDurationMs === 'number' && Number.isFinite(raw.pulseDurationMs)
      ? raw.pulseDurationMs
      : 200;
  return {
    loopPeriodMs: raw.loopPeriodMs,
    capWeights,
    pulseDurationMs,
    nodes,
    connections,
    compoundTypes,
    comments,
  };
}
