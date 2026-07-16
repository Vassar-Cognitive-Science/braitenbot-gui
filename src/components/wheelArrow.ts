import { NODE_H, NODE_W } from './connectionGeometry';

/**
 * Geometry for a motor's "drive bar" — the trace-mode indicator drawn on a
 * wheel/motor block's OUTER flank (left of the left wheel, right of the right
 * wheel, so it never overlaps the connections that run into the block from the
 * centre). The bar is anchored at the block's vertical middle and grows UP for a
 * positive (forward) signal and DOWN for a negative (reverse) one, its length
 * scaled by magnitude. Colour is the caller's job via a CSS class: green up,
 * red down. Shared so the desktop app's robot overlay and the docs embed draw
 * the identical indicator. Purely a readout of the motor's value — real motion
 * still needs the robot.
 *
 * All numbers are in block-space px (multiply by `blockScale`, not zoom). The
 * caller knows which side the block is on and positions the bar accordingly:
 * left flank → `x = blockLeft − gap − thickness`; right flank → `x = blockRight
 * + gap`. Vertically, `top = blockCenterY − length` when positive, else
 * `blockCenterY`.
 */
export interface WheelBarGeometry {
  /** True when the value is forward (bar grows up, green); false for reverse. */
  positive: boolean;
  /** Bar length in block px, measured from the block's vertical middle outward. */
  length: number;
  /** Bar thickness (width) in block px. */
  thickness: number;
  /** Gap in block px between the block's side edge and the bar. */
  gap: number;
}

/**
 * Drive-bar geometry for a raw motor value (−100..100) at a given block scale,
 * or `null` when the wheel is effectively stopped (|value| < 1) and no bar
 * should be drawn.
 */
export function wheelBarGeometry(raw: number, blockScale: number): WheelBarGeometry | null {
  const mag = Math.min(100, Math.abs(raw));
  if (mag < 1) return null;
  const maxLength = NODE_H * blockScale * 0.8;
  const minLength = maxLength * 0.14; // shortest (visible) bar at value 1
  const length = minLength + ((mag - 1) / 99) * (maxLength - minLength);
  const thickness = Math.max(4, NODE_W * blockScale * 0.07);
  const gap = Math.max(2, 5 * blockScale);
  return { positive: raw > 0, length, thickness, gap };
}
