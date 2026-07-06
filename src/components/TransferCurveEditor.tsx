import { useCallback, useRef, useState } from 'react';
import type { MouseEvent, KeyboardEvent } from 'react';
import type { TransferPoint } from '../types/diagram';
import { NumberInput } from './NumberInput';
import {
  CURVE_X_MIN,
  CURVE_X_MAX,
  CURVE_Y_MIN,
  CURVE_Y_MAX,
  clampInteriorX,
  clampAxisY,
} from '../lib/transferCurve';

interface TransferCurveEditorProps {
  points: TransferPoint[];
  onChange: (points: TransferPoint[]) => void;
}

const SVG_W = 230;
const SVG_H = 220;
const PAD_LEFT = 32;
const PAD_RIGHT = 8;
const PAD_TOP = 8;
const PAD_BOTTOM = 24;
const PLOT_W = SVG_W - PAD_LEFT - PAD_RIGHT;
const PLOT_H = SVG_H - PAD_TOP - PAD_BOTTOM;
const POINT_R = 6;

// A press that moves less than this many pixels counts as a click (select),
// not a drag (move).
const CLICK_SLOP = 3;

// Signal domain: -100 to 100 on both axes.
const X_MIN = CURVE_X_MIN;
const X_MAX = CURVE_X_MAX;
const Y_MIN = CURVE_Y_MIN;
const Y_MAX = CURVE_Y_MAX;

function toSvgX(val: number): number {
  return PAD_LEFT + ((val - X_MIN) / (X_MAX - X_MIN)) * PLOT_W;
}

function toSvgY(val: number): number {
  return PAD_TOP + PLOT_H - ((val - Y_MIN) / (Y_MAX - Y_MIN)) * PLOT_H;
}

function fromSvgX(px: number): number {
  const raw = X_MIN + ((px - PAD_LEFT) / PLOT_W) * (X_MAX - X_MIN);
  return Math.round(Math.max(X_MIN, Math.min(X_MAX, raw)));
}

function fromSvgY(py: number): number {
  const raw = Y_MIN + ((PLOT_H - (py - PAD_TOP)) / PLOT_H) * (Y_MAX - Y_MIN);
  return Math.round(Math.max(Y_MIN, Math.min(Y_MAX, raw)));
}

function sortedPoints(pts: TransferPoint[]): TransferPoint[] {
  return [...pts].sort((a, b) => a.x - b.x);
}

/** Ensure we always have endpoint anchors at x=X_MIN and x=X_MAX. */
function ensureEndpoints(pts: TransferPoint[]): TransferPoint[] {
  const sorted = sortedPoints(pts);
  if (sorted.length === 0) return [{ x: X_MIN, y: Y_MIN }, { x: X_MAX, y: Y_MAX }];
  if (sorted[0].x !== X_MIN) sorted.unshift({ x: X_MIN, y: sorted[0].y });
  if (sorted[sorted.length - 1].x !== X_MAX) sorted.push({ x: X_MAX, y: sorted[sorted.length - 1].y });
  sorted[0] = { ...sorted[0], x: X_MIN };
  sorted[sorted.length - 1] = { ...sorted[sorted.length - 1], x: X_MAX };
  return sorted;
}

function isEndpoint(idx: number, length: number): boolean {
  return idx === 0 || idx === length - 1;
}

export function TransferCurveEditor({ points, onChange }: TransferCurveEditorProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  // Tracks the in-progress press so mouseup can tell a click (select) from a
  // drag (move), and so the follow-up svg click can be suppressed.
  const pressRef = useRef<{ idx: number; startX: number; startY: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);

  const sorted = ensureEndpoints(points);

  // Re-derive the selected point from the freshly-sorted array every render so
  // the editor never edits a stale index.
  const selectedPoint =
    selectedIdx !== null && selectedIdx >= 0 && selectedIdx < sorted.length
      ? sorted[selectedIdx]
      : null;
  const selectedIsEndpoint = selectedIdx !== null && isEndpoint(selectedIdx, sorted.length);
  const xBounds =
    selectedPoint && selectedIdx !== null && !selectedIsEndpoint
      ? { min: sorted[selectedIdx - 1].x + 1, max: sorted[selectedIdx + 1].x - 1 }
      : { min: X_MIN, max: X_MAX };

  const getSvgCoords = useCallback((e: MouseEvent): { x: number; y: number } => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const pathD = sorted.map((p, i) => {
    const sx = toSvgX(p.x);
    const sy = toSvgY(p.y);
    return i === 0 ? `M ${sx} ${sy}` : `L ${sx} ${sy}`;
  }).join(' ');

  const handleSvgClick = useCallback((e: MouseEvent) => {
    // A click that concluded a point press was already handled on mouseup.
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (draggingIdx !== null) return;
    // Clicking empty plot deselects any active point.
    setSelectedIdx(null);
    const { x, y } = getSvgCoords(e);
    const domainX = fromSvgX(x);
    const domainY = fromSvgY(y);
    const tooClose = sorted.some(
      (p) => Math.abs(p.x - domainX) < 4 && Math.abs(p.y - domainY) < 6,
    );
    if (tooClose) return;
    if (domainX <= X_MIN || domainX >= X_MAX) return;
    onChange(sortedPoints([...sorted, { x: domainX, y: domainY }]));
  }, [sorted, onChange, draggingIdx, getSvgCoords]);

  const handlePointMouseDown = useCallback((e: MouseEvent, idx: number) => {
    e.stopPropagation();
    setDraggingIdx(idx);
    pressRef.current = { idx, startX: e.clientX, startY: e.clientY, moved: false };
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (draggingIdx === null) return;
    const press = pressRef.current;
    if (press && !press.moved) {
      if (
        Math.abs(e.clientX - press.startX) >= CLICK_SLOP ||
        Math.abs(e.clientY - press.startY) >= CLICK_SLOP
      ) {
        press.moved = true;
      }
    }
    // Hold position until the press crosses the click threshold, so a plain
    // click never nudges the point.
    if (press && !press.moved) return;

    const { x, y } = getSvgCoords(e);
    let domainX = fromSvgX(x);
    const domainY = fromSvgY(y);
    if (isEndpoint(draggingIdx, sorted.length)) {
      domainX = draggingIdx === 0 ? X_MIN : X_MAX;
    } else {
      domainX = clampInteriorX(domainX, sorted[draggingIdx - 1].x, sorted[draggingIdx + 1].x);
    }
    const updated = sorted.map((p, i) =>
      i === draggingIdx ? { x: domainX, y: domainY } : p,
    );
    onChange(updated);
  }, [draggingIdx, sorted, onChange, getSvgCoords]);

  const handleMouseUp = useCallback(() => {
    const press = pressRef.current;
    if (press) {
      // Suppress the click event that fires right after this mouseup.
      suppressClickRef.current = true;
      if (!press.moved) {
        setSelectedIdx(press.idx);
      }
    }
    pressRef.current = null;
    setDraggingIdx(null);
  }, []);

  const handlePointDoubleClick = useCallback((e: MouseEvent, idx: number) => {
    e.stopPropagation();
    if (sorted.length <= 2) return;
    if (isEndpoint(idx, sorted.length)) return;
    // The first click of the double-click already selected this point, so the
    // deleted point is the selected one: just clear the selection.
    setSelectedIdx(null);
    onChange(sorted.filter((_, i) => i !== idx));
  }, [sorted, onChange]);

  const commitSelectedX = useCallback((value: number) => {
    if (selectedIdx === null || selectedIsEndpoint) return;
    const x = clampInteriorX(value, sorted[selectedIdx - 1].x, sorted[selectedIdx + 1].x);
    onChange(sorted.map((p, i) => (i === selectedIdx ? { ...p, x } : p)));
  }, [selectedIdx, selectedIsEndpoint, sorted, onChange]);

  const commitSelectedY = useCallback((value: number) => {
    if (selectedIdx === null) return;
    const y = clampAxisY(value);
    onChange(sorted.map((p, i) => (i === selectedIdx ? { ...p, y } : p)));
  }, [selectedIdx, sorted, onChange]);

  const handleEditorKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') setSelectedIdx(null);
  }, []);

  const xTicks = [-100, -50, 0, 50, 100];
  const yTicks = [-100, -50, 0, 50, 100];

  return (
    <div className="transfer-curve-editor">
      <svg
        ref={svgRef}
        width={SVG_W}
        height={SVG_H}
        className="transfer-curve-svg"
        onClick={handleSvgClick}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Plot background */}
        <rect x={PAD_LEFT} y={PAD_TOP} width={PLOT_W} height={PLOT_H} className="transfer-bg" />

        {/* Grid lines */}
        {xTicks.slice(1, -1).map((v) => (
          <line
            key={`xg-${v}`}
            x1={toSvgX(v)} y1={PAD_TOP}
            x2={toSvgX(v)} y2={PAD_TOP + PLOT_H}
            className={`transfer-grid ${v === 0 ? 'transfer-zero' : ''}`}
          />
        ))}
        {yTicks.slice(1, -1).map((v) => (
          <line
            key={`yg-${v}`}
            x1={PAD_LEFT} y1={toSvgY(v)}
            x2={PAD_LEFT + PLOT_W} y2={toSvgY(v)}
            className={`transfer-grid ${v === 0 ? 'transfer-zero' : ''}`}
          />
        ))}

        {/* X-axis tick labels */}
        {xTicks.map((v) => (
          <text
            key={`xt-${v}`}
            x={toSvgX(v)}
            y={PAD_TOP + PLOT_H + 14}
            className="transfer-tick"
            textAnchor="middle"
          >
            {v}
          </text>
        ))}

        {/* Y-axis tick labels */}
        {yTicks.map((v) => (
          <text
            key={`yt-${v}`}
            x={PAD_LEFT - 4}
            y={toSvgY(v) + 3}
            className="transfer-tick"
            textAnchor="end"
          >
            {v}
          </text>
        ))}

        {/* Axis labels */}
        <text
          x={PAD_LEFT + PLOT_W / 2}
          y={SVG_H - 1}
          className="transfer-axis-label"
          textAnchor="middle"
        >
          Input (-100 to 100)
        </text>
        <text
          x={8}
          y={PAD_TOP + PLOT_H / 2}
          className="transfer-axis-label"
          textAnchor="middle"
          transform={`rotate(-90, 8, ${PAD_TOP + PLOT_H / 2})`}
        >
          Output (-100 to 100)
        </text>

        {/* Curve */}
        <path d={pathD} className="transfer-path" />

        {/* Control points */}
        {sorted.map((p, i) => (
          <circle
            key={i}
            cx={toSvgX(p.x)}
            cy={toSvgY(p.y)}
            r={POINT_R}
            className={`transfer-point ${draggingIdx === i ? 'dragging' : ''} ${selectedIdx === i ? 'selected' : ''} ${isEndpoint(i, sorted.length) ? 'endpoint' : ''}`}
            onMouseDown={(e) => handlePointMouseDown(e, i)}
            onDoubleClick={(e) => handlePointDoubleClick(e, i)}
          />
        ))}
      </svg>

      {selectedPoint && (
        <div className="transfer-coord-editor" onKeyDown={handleEditorKeyDown}>
          <label className="transfer-coord-field">
            <span>X</span>
            <NumberInput
              value={selectedPoint.x}
              onChange={commitSelectedX}
              min={xBounds.min}
              max={xBounds.max}
              integer
              disabled={selectedIsEndpoint}
            />
          </label>
          <label className="transfer-coord-field">
            <span>Y</span>
            <NumberInput
              value={selectedPoint.y}
              onChange={commitSelectedY}
              min={Y_MIN}
              max={Y_MAX}
              integer
            />
          </label>
        </div>
      )}

      <div className="transfer-curve-hint">
        Click empty space to add a point. Drag to move. Click a point to edit its
        coordinates. Double-click to remove.
      </div>
    </div>
  );
}
