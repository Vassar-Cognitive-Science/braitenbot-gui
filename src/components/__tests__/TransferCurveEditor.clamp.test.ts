/**
 * The text coordinate editor must enforce the same clamping rules as dragging:
 * interior X stays strictly between its neighbours (±1), Y stays in domain, and
 * everything rounds to integers. These guards keep committed values valid (and,
 * for X, non-reordering so the selected index stays stable).
 */
import { describe, it, expect } from 'vitest';
import { clampInteriorX, clampAxisY } from '../../lib/transferCurve';

describe('clampInteriorX', () => {
  it('keeps a value that already sits between the neighbours', () => {
    expect(clampInteriorX(0, -50, 50)).toBe(0);
  });

  it('clamps below the previous neighbour to prev + 1', () => {
    expect(clampInteriorX(-80, -50, 50)).toBe(-49);
  });

  it('clamps above the next neighbour to next - 1', () => {
    expect(clampInteriorX(80, -50, 50)).toBe(49);
  });

  it('rounds fractional input to an integer', () => {
    expect(clampInteriorX(12.7, -50, 50)).toBe(13);
  });

  it('never reorders past a neighbour (stays strictly between)', () => {
    const prev = 10;
    const next = 12;
    const result = clampInteriorX(999, prev, next);
    expect(result).toBeGreaterThan(prev);
    expect(result).toBeLessThan(next);
    expect(result).toBe(11);
  });
});

describe('clampAxisY', () => {
  it('passes an in-range value through unchanged', () => {
    expect(clampAxisY(42)).toBe(42);
  });

  it('clamps to the -100 floor', () => {
    expect(clampAxisY(-500)).toBe(-100);
  });

  it('clamps to the +100 ceiling', () => {
    expect(clampAxisY(500)).toBe(100);
  });

  it('rounds fractional input to an integer', () => {
    expect(clampAxisY(-33.4)).toBe(-33);
  });
});
