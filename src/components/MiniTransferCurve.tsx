import type { TransferPoint } from '../types/diagram';
import {
  CURVE_X_MIN,
  CURVE_X_MAX,
  CURVE_Y_MIN,
  CURVE_Y_MAX,
} from '../lib/transferCurve';

// A tiny, non-interactive thumbnail of a connection's non-linear transfer
// curve, shown on the connection badge in place of a numeric weight (which is
// meaningless for non-linear edges). Shares the editor's -100..100 domain, so
// the thumbnail's shape matches the full TransferCurveEditor exactly.
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

interface MiniTransferCurveProps {
  points: TransferPoint[];
}

export function MiniTransferCurve({ points }: MiniTransferCurveProps) {
  const sorted = [...points].sort((a, b) => a.x - b.x);
  if (sorted.length === 0) return null;

  const d = sorted
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${mapX(p.x).toFixed(1)} ${mapY(p.y).toFixed(1)}`)
    .join(' ');
  const zeroX = mapX(0);
  const zeroY = mapY(0);

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
    </svg>
  );
}
