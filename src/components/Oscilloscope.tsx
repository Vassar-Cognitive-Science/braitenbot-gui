import { useEffect, useMemo, useRef } from 'react';
import type { DiagramNode } from '../types/diagram';
import { TYPE_BY_ID } from '../types/diagram';
import type { ScopeRow } from '../hooks/useScopeSimulation';
import { formatTraceValue } from '../hooks/useTraceSimulation';

interface OscilloscopeProps {
  nodes: DiagramNode[];
  buffersRef: React.MutableRefObject<Map<string, ScopeRow>>;
  timeRef: React.MutableRefObject<number>;
  windowSec: number;
  paused: boolean;
  onTogglePause: () => void;
  onClear: () => void;
  open: boolean;
  onToggleOpen: () => void;
}

const ROW_HEIGHT = 30;
const ROW_PADDING = 3;
const CANVAS_WIDTH = 600;

export function Oscilloscope({
  nodes,
  buffersRef,
  timeRef,
  windowSec,
  paused,
  onTogglePause,
  onClear,
  open,
  onToggleOpen,
}: OscilloscopeProps) {
  // Visible signals: every node that's a source or actuator, plus any
  // compute node with at least one wired connection. We keep this stable
  // by sorting; the canvas reads the live buffer for whatever's listed.
  const rows = useMemo(() => visibleRows(nodes), [nodes]);

  return (
    <section className={`oscilloscope ${open ? 'open' : 'collapsed'}`}>
      <header className="oscilloscope-header">
        <button
          type="button"
          className="oscilloscope-toggle"
          onClick={onToggleOpen}
          aria-expanded={open}
        >
          <span className="oscilloscope-chevron">{open ? '▾' : '▸'}</span>
          <span>Scope</span>
          <span className="oscilloscope-window">{windowSec}s window</span>
        </button>
        {open && (
          <div className="oscilloscope-controls">
            <button type="button" onClick={onTogglePause} className="scope-btn">
              {paused ? 'Resume' : 'Pause'}
            </button>
            <button type="button" onClick={onClear} className="scope-btn">
              Clear
            </button>
          </div>
        )}
      </header>
      {open && (
        <div className="oscilloscope-rows">
          {rows.length === 0 ? (
            <div className="oscilloscope-empty">No signals yet. Add a node and enter Trace Mode.</div>
          ) : (
            rows.map((row) => (
              <ScopeRowView
                key={row.id}
                label={row.label}
                accent={row.accent}
                nodeId={row.id}
                buffersRef={buffersRef}
                timeRef={timeRef}
                windowMs={windowSec * 1000}
              />
            ))
          )}
        </div>
      )}
    </section>
  );
}

interface RowDescriptor {
  id: string;
  label: string;
  accent: string;
}

function visibleRows(nodes: DiagramNode[]): RowDescriptor[] {
  const out: RowDescriptor[] = [];
  for (const node of nodes) {
    const t = TYPE_BY_ID[node.type];
    if (!t) continue;
    out.push({
      id: node.id,
      label: node.label,
      accent: accentFor(t.kind),
    });
  }
  return out;
}

function accentFor(kind: string): string {
  switch (kind) {
    case 'sensor':
      return 'var(--sensor-color)';
    case 'compute':
    case 'constant':
      return 'var(--compute-color)';
    case 'motor':
      return 'var(--motor-color)';
    default:
      return 'var(--text)';
  }
}

interface ScopeRowViewProps {
  label: string;
  accent: string;
  nodeId: string;
  buffersRef: React.MutableRefObject<Map<string, ScopeRow>>;
  timeRef: React.MutableRefObject<number>;
  windowMs: number;
}

function ScopeRowView({
  label,
  accent,
  nodeId,
  buffersRef,
  timeRef,
  windowMs,
}: ScopeRowViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const valueRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const row = buffersRef.current.get(nodeId);
        renderRow(canvas, row, timeRef.current, windowMs, accent);
        if (valueRef.current && row && row.values.length > 0) {
          valueRef.current.textContent = formatTraceValue(row.values[row.values.length - 1]);
        } else if (valueRef.current) {
          valueRef.current.textContent = '—';
        }
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [nodeId, buffersRef, timeRef, windowMs, accent]);

  return (
    <div className="scope-row">
      <span className="scope-row-label" title={label}>
        {label}
      </span>
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={ROW_HEIGHT}
        className="scope-row-canvas"
      />
      <span ref={valueRef} className="scope-row-value">—</span>
    </div>
  );
}

function renderRow(
  canvas: HTMLCanvasElement,
  row: ScopeRow | undefined,
  now: number,
  windowMs: number,
  stroke: string,
) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || CANVAS_WIDTH;
  const cssH = canvas.clientHeight || ROW_HEIGHT;
  const targetW = Math.round(cssW * dpr);
  const targetH = Math.round(cssH * dpr);
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const top = ROW_PADDING;
  const bottom = cssH - ROW_PADDING;
  const midY = (top + bottom) / 2;

  // Zero line
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(cssW, midY);
  ctx.stroke();

  if (!row || row.times.length < 2) return;

  // Map t and v to pixel space. Y is fixed range [-100, +100] with clamping.
  const startT = now - windowMs;
  const tToX = (t: number) => ((t - startT) / windowMs) * cssW;
  const vToY = (v: number) => {
    const c = Math.max(-100, Math.min(100, v));
    return midY - ((c / 100) * (bottom - top)) / 2;
  };

  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < row.times.length; i++) {
    const x = tToX(row.times[i]);
    const y = vToY(row.values[i]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}
