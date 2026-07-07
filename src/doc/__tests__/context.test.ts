import { describe, it, expect, beforeEach } from 'vitest';
import { DiagramStore } from '../DiagramStore';
import type { CompoundTypeDefinition, DiagramNode } from '../../types/diagram';

function node(id: string, type: DiagramNode['type'] = 'sensor-analog'): DiagramNode {
  return { id, type, label: id, x: 0, y: 0 };
}

function compoundDef(id: string): CompoundTypeDefinition {
  return {
    id,
    displayName: 'Comp',
    body: {
      nodes: [node('in', 'compound-input'), node('mid', 'compute-summation'), node('out', 'compound-output')],
      connections: [],
    },
  };
}

describe('compound-body context routing', () => {
  let store: DiagramStore;
  beforeEach(() => {
    store = new DiagramStore();
    store.replaceAll({
      nodes: [node('motor-left', 'servo-cr'), node('motor-right', 'servo-cr')],
      connections: [],
      loopPeriodMs: 20,
      compoundTypes: [compoundDef('comp-1')],
    });
  });

  it('routes node mutations into the active compound body', () => {
    store.setEditingContext('comp-1');
    store.addNode(node('inside'));
    const top = store.getSnapshot().topNodes.map((n) => n.id);
    const body = store.getSnapshot().compoundTypes[0].body.nodes.map((n) => n.id);
    expect(top).not.toContain('inside');
    expect(body).toContain('inside');
  });

  it('routes back to the top level when context is cleared', () => {
    store.setEditingContext('comp-1');
    store.addNode(node('inside'));
    store.setEditingContext(null);
    store.addNode(node('outside'));
    expect(store.getSnapshot().topNodes.map((n) => n.id)).toContain('outside');
    expect(store.getSnapshot().compoundTypes[0].body.nodes.map((n) => n.id)).not.toContain('outside');
  });

  it('patchNode targets the body node when editing a compound', () => {
    store.setEditingContext('comp-1');
    store.patchNode('mid', { label: 'Middle' });
    const bodyMid = store.getSnapshot().compoundTypes[0].body.nodes.find((n) => n.id === 'mid');
    expect(bodyMid?.label).toBe('Middle');
  });

  it('renameCompound updates the definition and instance labels', () => {
    store.setEditingContext(null);
    store.addNode({ id: 'inst', type: 'compound', label: 'Comp', x: 0, y: 0, compoundTypeId: 'comp-1' });
    store.renameCompound('comp-1', 'Fancy');
    expect(store.getSnapshot().compoundTypes[0].displayName).toBe('Fancy');
    const inst = store.getSnapshot().topNodes.find((n) => n.id === 'inst');
    expect(inst?.label).toBe('Fancy');
  });
});
