import { useEffect, useMemo, useRef, useState } from 'react';
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
const MIN_HEIGHT = 120;
const DEFAULT_HEIGHT = 280;

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
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());

  const toggleHidden = (id: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const hasHidden = rows.some((r) => hidden.has(r.id));
  const toggleAll = () => {
    if (hasHidden) setHidden(new Set());
    else setHidden(new Set(rows.map((r) => r.id)));
  };

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev: PointerEvent) => {
      const dy = startY - ev.clientY;
      const maxH = window.innerHeight - 80;
      const next = Math.max(MIN_HEIGHT, Math.min(maxH, startH + dy));
      setHeight(next);
    };
    const onUp = () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <section
      className={`oscilloscope ${open ? 'open' : 'collapsed'}`}
      style={open ? { height } : undefined}
    >
      {open && (
        <div
          className="oscilloscope-resize-handle"
          onPointerDown={startResize}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize scope"
        />
      )}
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
            {rows.length > 0 && (
              <button
                type="button"
                onClick={toggleAll}
                className="scope-btn"
                title={hasHidden ? 'Show all signals' : 'Hide all signals'}
              >
                {hasHidden ? 'Show all' : 'Hide all'}
              </button>
            )}
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
                hidden={hidden.has(row.id)}
                onToggleHidden={() => toggleHidden(row.id)}
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
      return '--trace-sensor';
    case 'compute':
    case 'constant':
      return '--trace-compute';
    case 'output':
      return '--trace-output';
    default:
      return '--text';
  }
}

interface ScopeRowViewProps {
  label: string;
  accent: string;
  nodeId: string;
  buffersRef: React.MutableRefObject<Map<string, ScopeRow>>;
  timeRef: React.MutableRefObject<number>;
  windowMs: number;
  hidden: boolean;
  onToggleHidden: () => void;
}

function ScopeRowView({
  label,
  accent,
  nodeId,
  buffersRef,
  timeRef,
  windowMs,
  hidden,
  onToggleHidden,
}: ScopeRowViewProps) {
  if (hidden) {
    return (
      <div className="scope-row scope-row-hidden">
        <EyeButton hidden onClick={onToggleHidden} label={label} />
        <span className="scope-row-label muted" title={label}>
          {label}
        </span>
      </div>
    );
  }
  return (
    <ScopeRowVisible
      label={label}
      accent={accent}
      nodeId={nodeId}
      buffersRef={buffersRef}
      timeRef={timeRef}
      windowMs={windowMs}
      onToggleHidden={onToggleHidden}
    />
  );
}

interface ScopeRowVisibleProps {
  label: string;
  accent: string;
  nodeId: string;
  buffersRef: React.MutableRefObject<Map<string, ScopeRow>>;
  timeRef: React.MutableRefObject<number>;
  windowMs: number;
  onToggleHidden: () => void;
}

function ScopeRowVisible({
  label,
  accent,
  nodeId,
  buffersRef,
  timeRef,
  windowMs,
  onToggleHidden,
}: ScopeRowVisibleProps) {
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
      <EyeButton hidden={false} onClick={onToggleHidden} label={label} />
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

function EyeButton({
  hidden,
  onClick,
  label,
}: {
  hidden: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className="scope-row-eye"
      onClick={onClick}
      aria-label={hidden ? `Show ${label}` : `Hide ${label}`}
      title={hidden ? 'Show signal' : 'Hide signal'}
      aria-pressed={hidden}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        {hidden ? (
          <>
            <path d="M2 8 s2.5 -4 6 -4 c1.4 0 2.6 0.6 3.6 1.4" />
            <path d="M14 8 s-2.5 4 -6 4 c-1.4 0 -2.6 -0.6 -3.6 -1.4" />
            <path d="M2 2 l12 12" />
          </>
        ) : (
          <>
            <path d="M2 8 s2.5 -4 6 -4 s6 4 6 4 s-2.5 4 -6 4 s-6 -4 -6 -4 Z" />
            <circle cx="8" cy="8" r="1.7" />
          </>
        )}
      </svg>
    </button>
  );
}

function renderRow(
  canvas: HTMLCanvasElement,
  row: ScopeRow | undefined,
  now: number,
  windowMs: number,
  strokeVar: string,
) {
  const stroke =
    getComputedStyle(canvas).getPropertyValue(strokeVar).trim() || '#e8e4d8';
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
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < row.times.length; i++) {
    const x = tToX(row.times[i]);
    const y = vToY(row.values[i]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}
