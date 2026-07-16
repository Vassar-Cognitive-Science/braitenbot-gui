import { describe, expect, it } from 'vitest';
import { occludedSpans } from '../connectionGeometry';

describe('occludedSpans', () => {
  it('returns nothing when no rects are given', () => {
    expect(occludedSpans(0, 0, 0, 300, [])).toEqual([]);
  });

  it('returns nothing when the curve misses every rect', () => {
    // A rect far to the side of a straight-down wire.
    const spans = occludedSpans(0, 0, 0, 300, [{ x: 200, y: 100, w: 40, h: 40 }]);
    expect(spans).toEqual([]);
  });

  it('reports a dashed span where the wire passes through a node box', () => {
    // Vertical-ish wire from (0,0) to (0,300); a rect straddling the middle.
    const spans = occludedSpans(0, 0, 0, 300, [{ x: -20, y: 130, w: 40, h: 40 }]);
    expect(spans.length).toBe(1);
    expect(spans[0].startsWith('M')).toBe(true);
    expect(spans[0]).toContain('L');
  });
});
