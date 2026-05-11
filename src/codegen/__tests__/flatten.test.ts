import { describe, it, expect } from 'vitest';
import { flattenCompounds, CompoundCycleError } from '../flatten';
import type {
  CompoundTypeDefinition,
  DiagramConnection,
  DiagramNode,
} from '../../types/diagram';

function makeConn(
  overrides: Partial<DiagramConnection> & { id: string; from: string; to: string },
): DiagramConnection {
  return {
    weight: 1,
    transferMode: 'linear',
    transferPoints: [
      { x: -100, y: -100 },
      { x: 100, y: 100 },
    ],
    ...overrides,
  };
}

function sensor(id: string, label = id): DiagramNode {
  return { id, type: 'sensor-analog', label, x: 0, y: 0, arduinoPort: 'A0' };
}

function motor(id: string, label = id): DiagramNode {
  return { id, type: 'servo-cr', label, x: 0, y: 0, servoPin: '9' };
}

describe('flattenCompounds', () => {
  it('passes a compound-free graph through unchanged', () => {
    const nodes = [sensor('s1'), motor('m1')];
    const connections = [makeConn({ id: 'c1', from: 's1', to: 'm1' })];
    const result = flattenCompounds(nodes, connections, []);
    expect(result.nodes).toEqual(nodes);
    expect(result.connections).toEqual(connections);
  });

  it('inlines a single compound with one input and one output port', () => {
    const def: CompoundTypeDefinition = {
      id: 'passthrough',
      displayName: 'Passthrough',
      body: {
        nodes: [
          { id: 'in', type: 'compound-input', label: 'in', x: 0, y: 0 },
          { id: 'sum', type: 'compute-summation', label: 'Sum', x: 0, y: 0 },
          { id: 'out', type: 'compound-output', label: 'out', x: 0, y: 0 },
        ],
        connections: [
          makeConn({ id: 'b1', from: 'in', to: 'sum' }),
          makeConn({ id: 'b2', from: 'sum', to: 'out' }),
        ],
      },
    };
    const nodes: DiagramNode[] = [
      sensor('s1'),
      {
        id: 'inst-1',
        type: 'compound',
        compoundTypeId: 'passthrough',
        label: 'Passthrough',
        x: 0, y: 0,
      },
      motor('m1'),
    ];
    const connections: DiagramConnection[] = [
      makeConn({ id: 'e1', from: 's1', to: 'inst-1', toPort: 'in' }),
      makeConn({ id: 'e2', from: 'inst-1', to: 'm1', fromPort: 'out' }),
    ];
    const result = flattenCompounds(nodes, connections, [def]);

    // Body's port anchors are emitted as summation pass-throughs.
    expect(result.nodes.map((n) => n.id)).toEqual([
      's1',
      'inst-1/in',
      'inst-1/sum',
      'inst-1/out',
      'm1',
    ]);
    expect(result.nodes.find((n) => n.id === 'inst-1/in')?.type).toBe(
      'compute-summation',
    );
    expect(result.nodes.find((n) => n.id === 'inst-1/out')?.type).toBe(
      'compute-summation',
    );

    // External edges are retargeted onto the prefixed port-anchor nodes.
    expect(
      result.connections.find((c) => c.from === 's1')?.to,
    ).toBe('inst-1/in');
    expect(
      result.connections.find((c) => c.to === 'm1')?.from,
    ).toBe('inst-1/out');

    // No compound instances or port anchors remain.
    expect(result.nodes.some((n) => n.type === 'compound')).toBe(false);
    expect(
      result.nodes.some(
        (n) => n.type === 'compound-input' || n.type === 'compound-output',
      ),
    ).toBe(false);
  });

  it('preserves edge weight and transfer mode on the boundary edges', () => {
    const def: CompoundTypeDefinition = {
      id: 'amp',
      displayName: 'Amp',
      body: {
        nodes: [
          { id: 'in', type: 'compound-input', label: 'in', x: 0, y: 0 },
          { id: 'out', type: 'compound-output', label: 'out', x: 0, y: 0 },
        ],
        connections: [makeConn({ id: 'b1', from: 'in', to: 'out', weight: 0.5 })],
      },
    };
    const nodes: DiagramNode[] = [
      sensor('s1'),
      {
        id: 'inst-1', type: 'compound', compoundTypeId: 'amp',
        label: 'Amp', x: 0, y: 0,
      },
      motor('m1'),
    ];
    const connections: DiagramConnection[] = [
      makeConn({ id: 'e1', from: 's1', to: 'inst-1', toPort: 'in', weight: 0.7 }),
      makeConn({ id: 'e2', from: 'inst-1', to: 'm1', fromPort: 'out', weight: -0.4 }),
    ];
    const result = flattenCompounds(nodes, connections, [def]);

    // External weights are preserved unchanged on the boundary edges;
    // composition with the internal 0.5 weight happens at runtime via the
    // pass-through summation anchors.
    expect(result.connections.find((c) => c.id === 'e1')?.weight).toBe(0.7);
    expect(result.connections.find((c) => c.id === 'e2')?.weight).toBe(-0.4);
    expect(result.connections.find((c) => c.id === 'inst-1/b1')?.weight).toBe(
      0.5,
    );
  });

  it('inlines nested compounds with id prefixes preserving uniqueness', () => {
    const inner: CompoundTypeDefinition = {
      id: 'inner',
      displayName: 'Inner',
      body: {
        nodes: [
          { id: 'in', type: 'compound-input', label: 'in', x: 0, y: 0 },
          { id: 'sum', type: 'compute-summation', label: 'Sum', x: 0, y: 0 },
          { id: 'out', type: 'compound-output', label: 'out', x: 0, y: 0 },
        ],
        connections: [
          makeConn({ id: 'i1', from: 'in', to: 'sum' }),
          makeConn({ id: 'i2', from: 'sum', to: 'out' }),
        ],
      },
    };
    const outer: CompoundTypeDefinition = {
      id: 'outer',
      displayName: 'Outer',
      body: {
        nodes: [
          { id: 'in', type: 'compound-input', label: 'in', x: 0, y: 0 },
          {
            id: 'nested', type: 'compound', compoundTypeId: 'inner',
            label: 'Inner', x: 0, y: 0,
          },
          { id: 'out', type: 'compound-output', label: 'out', x: 0, y: 0 },
        ],
        connections: [
          makeConn({ id: 'o1', from: 'in', to: 'nested', toPort: 'in' }),
          makeConn({ id: 'o2', from: 'nested', to: 'out', fromPort: 'out' }),
        ],
      },
    };
    const nodes: DiagramNode[] = [
      sensor('s1'),
      {
        id: 'top', type: 'compound', compoundTypeId: 'outer',
        label: 'Outer', x: 0, y: 0,
      },
      motor('m1'),
    ];
    const connections: DiagramConnection[] = [
      makeConn({ id: 'e1', from: 's1', to: 'top', toPort: 'in' }),
      makeConn({ id: 'e2', from: 'top', to: 'm1', fromPort: 'out' }),
    ];
    const result = flattenCompounds(nodes, connections, [inner, outer]);

    // Two levels of prefixing: top/nested/sum
    expect(result.nodes.map((n) => n.id)).toContain('top/nested/sum');
    // No compound or port-anchor nodes remain anywhere.
    expect(
      result.nodes.some(
        (n) =>
          n.type === 'compound' ||
          n.type === 'compound-input' ||
          n.type === 'compound-output',
      ),
    ).toBe(false);
  });

  it('throws CompoundCycleError on mutually recursive compound types', () => {
    const a: CompoundTypeDefinition = {
      id: 'A', displayName: 'A',
      body: {
        nodes: [
          { id: 'inst', type: 'compound', compoundTypeId: 'B', label: 'B', x: 0, y: 0 },
        ],
        connections: [],
      },
    };
    const b: CompoundTypeDefinition = {
      id: 'B', displayName: 'B',
      body: {
        nodes: [
          { id: 'inst', type: 'compound', compoundTypeId: 'A', label: 'A', x: 0, y: 0 },
        ],
        connections: [],
      },
    };
    const nodes: DiagramNode[] = [
      {
        id: 'top', type: 'compound', compoundTypeId: 'A',
        label: 'A', x: 0, y: 0,
      },
    ];
    expect(() => flattenCompounds(nodes, [], [a, b])).toThrow(
      CompoundCycleError,
    );
  });

  it('drops compound-touching edges that have no port specified', () => {
    const def: CompoundTypeDefinition = {
      id: 'passthrough', displayName: 'Passthrough',
      body: {
        nodes: [
          { id: 'in', type: 'compound-input', label: 'in', x: 0, y: 0 },
          { id: 'out', type: 'compound-output', label: 'out', x: 0, y: 0 },
        ],
        connections: [makeConn({ id: 'b1', from: 'in', to: 'out' })],
      },
    };
    const nodes: DiagramNode[] = [
      sensor('s1'),
      {
        id: 'inst', type: 'compound', compoundTypeId: 'passthrough',
        label: 'P', x: 0, y: 0,
      },
      motor('m1'),
    ];
    // Edges without fromPort/toPort: ambiguous, should be dropped.
    const connections: DiagramConnection[] = [
      makeConn({ id: 'bad1', from: 's1', to: 'inst' }),
      makeConn({ id: 'bad2', from: 'inst', to: 'm1' }),
    ];
    const result = flattenCompounds(nodes, connections, [def]);
    expect(result.connections.some((c) => c.id === 'bad1')).toBe(false);
    expect(result.connections.some((c) => c.id === 'bad2')).toBe(false);
  });

  it('silently drops compound instances with no matching type definition', () => {
    const nodes: DiagramNode[] = [
      sensor('s1'),
      {
        id: 'inst', type: 'compound', compoundTypeId: 'does-not-exist',
        label: '?', x: 0, y: 0,
      },
      motor('m1'),
    ];
    const result = flattenCompounds(nodes, [], []);
    expect(result.nodes.some((n) => n.id === 'inst')).toBe(false);
    expect(result.nodes.map((n) => n.id)).toEqual(['s1', 'm1']);
  });
});
