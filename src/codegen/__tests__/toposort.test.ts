import { describe, it, expect } from 'vitest';
import { toposort, CycleError } from '../toposort';

describe('toposort', () => {
  it('sorts a linear chain correctly', () => {
    const nodeIds = ['a', 'b', 'c'];
    const edges = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
    ];
    const result = toposort(nodeIds, edges);
    expect(result.indexOf('a')).toBeLessThan(result.indexOf('b'));
    expect(result.indexOf('b')).toBeLessThan(result.indexOf('c'));
  });

  it('sorts a branching graph correctly', () => {
    const nodeIds = ['s', 'c1', 'c2', 'm'];
    const edges = [
      { from: 's', to: 'c1' },
      { from: 's', to: 'c2' },
      { from: 'c1', to: 'm' },
      { from: 'c2', to: 'm' },
    ];
    const result = toposort(nodeIds, edges);
    expect(result.indexOf('s')).toBeLessThan(result.indexOf('c1'));
    expect(result.indexOf('s')).toBeLessThan(result.indexOf('c2'));
    expect(result.indexOf('c1')).toBeLessThan(result.indexOf('m'));
    expect(result.indexOf('c2')).toBeLessThan(result.indexOf('m'));
  });

  it('handles a direct sensor-to-motor connection', () => {
    const nodeIds = ['sensor', 'motor'];
    const edges = [{ from: 'sensor', to: 'motor' }];
    const result = toposort(nodeIds, edges);
    expect(result).toEqual(['sensor', 'motor']);
  });

  it('includes disconnected nodes', () => {
    const nodeIds = ['a', 'b', 'orphan'];
    const edges = [{ from: 'a', to: 'b' }];
    const result = toposort(nodeIds, edges);
    expect(result).toHaveLength(3);
    expect(result).toContain('orphan');
    expect(result.indexOf('a')).toBeLessThan(result.indexOf('b'));
  });

  it('throws CycleError for a cycle', () => {
    const nodeIds = ['a', 'b', 'c'];
    const edges = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'a' },
    ];
    expect(() => toposort(nodeIds, edges)).toThrow(CycleError);
  });

  it('identifies cycle-involved nodes', () => {
    const nodeIds = ['start', 'a', 'b', 'end'];
    const edges = [
      { from: 'start', to: 'a' },
      { from: 'a', to: 'b' },
      { from: 'b', to: 'a' },
      { from: 'a', to: 'end' },
    ];
    try {
      toposort(nodeIds, edges);
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CycleError);
      const cycleErr = err as CycleError;
      expect(cycleErr.involvedNodeIds).toContain('a');
      expect(cycleErr.involvedNodeIds).toContain('b');
      expect(cycleErr.involvedNodeIds).not.toContain('start');
    }
  });
});
