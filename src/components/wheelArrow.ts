import { NODE_H } from './connectionGeometry';

/**
 * Geometry for a motor's "drive arrow" — the trace-mode indicator that grows
 * straight out of a wheel/motor block: up from the top edge for a positive
 * (forward) signal, down from the bottom for a negative (reverse) one, scaled
 * by magnitude. Shared so the desktop app's robot overlay and the docs embed
 * draw the identical arrow. Purely a readout of the motor's value — real motion
 * still needs the robot.
 *
 * All numbers are in block-space px (multiply by `blockScale`, not zoom). The
 * caller positions the SVG at the wheel center: left = cx − svgHalfW, top =
 * cy − reach, width = svgHalfW·2, height = reach·2.
 */
export interface WheelArrowGeometry {
  forward: boolean;
  svgHalfW: number;
  reach: number;
  /** Horizontal center of the shaft within the SVG. */
  cx: number;
  /** Shaft start (at the block edge). */
  base: number;
  /** Arrow tip. */
  tipY: number;
  /** Where the shaft meets the arrowhead. */
  shaftEndY: number;
  strokeW: number;
  headHalf: number;
}

/**
 * Arrow geometry for a raw motor value (−100..100) at a given block scale, or
 * `null` when the wheel is effectively stopped (|value| < 1) and no arrow
 * should be drawn.
 */
export function wheelArrowGeometry(raw: number, blockScale: number): WheelArrowGeometry | null {
  const mag = Math.min(100, Math.abs(raw));
  if (mag < 1) return null;
  const blockHalfH = (NODE_H / 2) * blockScale;
  const maxLen = NODE_H * blockScale * 1.3;
  const minLen = maxLen * 0.16; // shortest (visible) arrow at value 1
  const len = minLen + ((mag - 1) / 99) * (maxLen - minLen);
  // Arrowhead and shaft scale with length so it reads as an arrow at every size
  // instead of a fixed head swamping a short shaft.
  const headLen = len * 0.32;
  const headHalf = Math.max(2, len * 0.22);
  const strokeW = Math.max(1.5, len * 0.14);
  const dir = raw > 0 ? -1 : 1; // screen-y: up (forward) is negative
  const reach = blockHalfH + maxLen + 2;
  const svgHalfW = maxLen * 0.22 + 4;
  const cx = svgHalfW;
  const centerY = reach; // block center within the SVG
  const base = centerY + dir * blockHalfH; // start at the block edge
  const tipY = base + dir * len;
  const shaftEndY = tipY - dir * headLen;
  return { forward: raw > 0, svgHalfW, reach, cx, base, tipY, shaftEndY, strokeW, headHalf };
}
