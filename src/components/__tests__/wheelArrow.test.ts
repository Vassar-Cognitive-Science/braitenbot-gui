import { describe, expect, it } from 'vitest';
import { wheelBarGeometry } from '../wheelArrow';

describe('wheelBarGeometry', () => {
  it('returns null for an effectively stopped wheel', () => {
    expect(wheelBarGeometry(0, 1)).toBeNull();
    expect(wheelBarGeometry(0.5, 1)).toBeNull();
    expect(wheelBarGeometry(-0.9, 1)).toBeNull();
  });

  it('marks positive values forward and negative reverse', () => {
    expect(wheelBarGeometry(50, 1)!.positive).toBe(true);
    expect(wheelBarGeometry(-50, 1)!.positive).toBe(false);
  });

  it('grows the bar with magnitude', () => {
    const small = wheelBarGeometry(5, 1)!;
    const big = wheelBarGeometry(100, 1)!;
    expect(big.length).toBeGreaterThan(small.length);
  });

  it('scales with block scale', () => {
    const small = wheelBarGeometry(100, 0.5)!;
    const big = wheelBarGeometry(100, 1)!;
    expect(big.length).toBeGreaterThan(small.length);
    expect(big.thickness).toBeGreaterThanOrEqual(small.thickness);
  });
});
