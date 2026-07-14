import type { TransferPoint } from '../types/diagram';
import {
  CURVE_X_MIN,
  CURVE_X_MAX,
  CURVE_Y_MIN,
  CURVE_Y_MAX,
} from '../lib/transferCurve';

// A tiny, non-interactive thumbnail of a connection's transfer function, shown
// on the connection badge (and, scaled up, in read-only popovers). A curve is
// drawn from its points; a plain weight is the straight line y = weight·x. When
// the weight's slope is too steep to fit the box (|weight| > 1) the line is
// capped with an out-of-range arrow. In trace mode an operating-point dot marks
// the current (input, output) on the graph.
const SIZE = 18;
const PAD = 2;
const INNER = SIZE - 2 * PAD;

function mapX(x: number): number {
  return PAD + ((x - CURVE_X_MIN) / (CURVE_X_MAX - CURVE_X_MIN)) * INNER;
}

function mapY(y: number): number {
  // SVG y grows downward, so a higher signal maps to a smaller y.
  return PAD + ((CURVE_Y_MAX - y) / (CURVE_Y_MAX - CURVE_Y_MIN)) * INNER;
}

function clampDomain(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** A little V-shaped arrowhead at (ex,ey) pointing away from (ox,oy). */
function arrowHead(ex: number, ey: number, ox: number, oy: number, size = 3.2): string {
  const a = Math.atan2(ey - oy, ex - ox);
  const spread = 0.5;
  const p1x = ex - size * Math.cos(a - spread);
  const p1y = ey - size * Math.sin(a - spread);
  const p2x = ex - size * Math.cos(a + spread);
  const p2y = ey - size * Math.sin(a + spread);
  return `M ${p1x.toFixed(1)} ${p1y.toFixed(1)} L ${ex.toFixed(1)} ${ey.toFixed(1)} L ${p2x.toFixed(1)} ${p2y.toFixed(1)}`;
}

interface MiniTransferCurveProps {
  points: TransferPoint[];
  /** When set (a plain weight), enables the out-of-range arrow for |weight|>1. */
  weight?: number;
  /** Live (input, output) to mark on the graph during trace; null/undefined hides it. */
  operatingPoint?: { x: number; y: number } | null;
}

export function MiniTransferCurve({ points, weight, operatingPoint }: MiniTransferCurveProps) {
  const sorted = [...points].sort((a, b) => a.x - b.x);
  if (sorted.length === 0) return null;

  const d = sorted
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${mapX(p.x).toFixed(1)} ${mapY(p.y).toFixed(1)}`)
    .join(' ');
  const zeroX = mapX(0);
  const zeroY = mapY(0);

  const outOfRange = weight !== undefined && Math.abs(weight) > 1;
  const arrows = outOfRange
    ? [sorted[0], sorted[sorted.length - 1]].map((p) =>
        arrowHead(mapX(p.x), mapY(p.y), zeroX, zeroY),
      )
    : [];

  const op = operatingPoint
    ? {
        x: mapX(clampDomain(operatingPoint.x, CURVE_X_MIN, CURVE_X_MAX)),
        y: mapY(clampDomain(operatingPoint.y, CURVE_Y_MIN, CURVE_Y_MAX)),
      }
    : null;

  return (
    <svg
      className="mini-transfer-curve"
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      aria-hidden="true"
    >
      <line className="mini-curve-axis" x1={zeroX} y1={PAD} x2={zeroX} y2={SIZE - PAD} />
      <line className="mini-curve-axis" x1={PAD} y1={zeroY} x2={SIZE - PAD} y2={zeroY} />
      <path className="mini-curve-path" d={d} fill="none" />
      {arrows.map((a, i) => (
        <path key={i} className="mini-curve-arrow" d={a} fill="none" />
      ))}
      {op && <circle className="mini-curve-point" cx={op.x} cy={op.y} r={2.2} />}
    </svg>
  );
}
