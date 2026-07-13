import { describe, expect, it } from 'vitest';
import { wheelArrowGeometry } from '../wheelArrow';

describe('wheelArrowGeometry', () => {
  it('returns null for an effectively stopped wheel', () => {
    expect(wheelArrowGeometry(0, 1)).toBeNull();
    expect(wheelArrowGeometry(0.5, 1)).toBeNull();
    expect(wheelArrowGeometry(-0.9, 1)).toBeNull();
  });

  it('marks positive values forward and negative reverse', () => {
    expect(wheelArrowGeometry(50, 1)!.forward).toBe(true);
    expect(wheelArrowGeometry(-50, 1)!.forward).toBe(false);
  });

  it('grows the arrow with magnitude', () => {
    const small = wheelArrowGeometry(5, 1)!;
    const big = wheelArrowGeometry(100, 1)!;
    // Tip reaches further from the block edge at full speed.
    expect(Math.abs(big.tipY - big.base)).toBeGreaterThan(Math.abs(small.tipY - small.base));
  });

  it('points the tip up (forward) and down (reverse) from the block', () => {
    const fwd = wheelArrowGeometry(80, 1)!;
    const rev = wheelArrowGeometry(-80, 1)!;
    expect(fwd.tipY).toBeLessThan(fwd.base); // up = smaller y
    expect(rev.tipY).toBeGreaterThan(rev.base); // down = larger y
  });
});
