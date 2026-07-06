// Signal domain shared by the transfer-curve editor: -100..100 on both axes.
export const CURVE_X_MIN = -100;
export const CURVE_X_MAX = 100;
export const CURVE_Y_MIN = -100;
export const CURVE_Y_MAX = 100;

/**
 * Clamp an interior control point's X between its neighbours (±1) and round to
 * an integer. Because the result always stays strictly between the neighbours,
 * committing it never reorders the points — the selected index stays valid.
 */
export function clampInteriorX(value: number, prevX: number, nextX: number): number {
  return Math.max(prevX + 1, Math.min(nextX - 1, Math.round(value)));
}

/** Clamp a control point's Y to the signal domain and round to an integer. */
export function clampAxisY(value: number): number {
  return Math.max(CURVE_Y_MIN, Math.min(CURVE_Y_MAX, Math.round(value)));
}
