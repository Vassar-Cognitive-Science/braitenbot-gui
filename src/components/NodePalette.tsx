import { useCallback, useEffect, useRef, useState } from 'react';
import type { DragEvent, PointerEvent } from 'react';
import type {
  CompoundTypeDefinition,
  DiagramNode,
  NodeTypeDefinition,
  NodeTypeId,
} from '../types/diagram';
import { NODE_TYPES } from '../types/diagram';
import { BASIC_COMPUTE_TYPES, KIT_OUTPUTS, KIT_SENSORS } from './palettePresets';
import type { KitPreset } from './palettePresets';

/**
 * Drag payload carried on the dataTransfer when a palette item is dragged onto
 * the canvas. A bare generic item carries only `type` (plus `compoundTypeId`
 * for compound instances); a Basic-tab kit preset also carries a friendly
 * `label` and pre-filled `params` merged into the created node.
 */
export interface NodeDragPayload {
  type: NodeTypeId;
  compoundTypeId?: string;
  label?: string;
  params?: Partial<DiagramNode>;
}

export const NODE_DRAG_MIME = 'application/x-braitenbot-node';

function setDragPayload(event: DragEvent, payload: NodeDragPayload): void {
  event.dataTransfer.setData(NODE_DRAG_MIME, JSON.stringify(payload));
}

/**
 * The small tag rendered under each generic palette item. Sources/computes show
 * their kind, but the Outputs group has heterogeneous hardware — servos, GPIO
 * pins, displays — so we surface what each *is* rather than the common label.
 */
function paletteItemTag(nodeType: NodeTypeDefinition): string {
  if (nodeType.id === 'servo-cr' || nodeType.id === 'servo-positional') return 'servo';
  if (nodeType.id === 'digital-out') return 'output';
  if (nodeType.id === 'display-tm1637') return 'display';
  if (nodeType.kind === 'constant') return 'compute';
  return nodeType.kind;
}

// ---- Advanced-view collapse state -----------------------------------------

type PaletteSection = 'sensor' | 'compute' | 'output' | 'compound';
const PALETTE_COLLAPSED_KEY = 'braitenbot-gui:palette-collapsed:v1';

function loadCollapsedPaletteSections(): Record<PaletteSection, boolean> {
  const fallback: Record<PaletteSection, boolean> = {
    sensor: false,
    compute: false,
    output: false,
    compound: false,
  };
  try {
    const raw = localStorage.getItem(PALETTE_COLLAPSED_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return fallback;
    return {
      sensor: !!parsed.sensor,
      compute: !!parsed.compute,
      output: !!parsed.output,
      compound: !!parsed.compound,
    };
  } catch {
    return fallback;
  }
}

// ---- Basic / Advanced tab state -------------------------------------------

type PaletteTab = 'basic' | 'advanced';
const PALETTE_TAB_KEY = 'braitenbot-gui:palette-tab:v1';

function loadPaletteTab(): PaletteTab {
  try {
    return localStorage.getItem(PALETTE_TAB_KEY) === 'advanced' ? 'advanced' : 'basic';
  } catch {
    return 'basic';
  }
}

// ---- Palette width ---------------------------------------------------------

const PALETTE_WIDTH_KEY = 'braitenbot-gui:palette-width:v1';
const PALETTE_WIDTH_DEFAULT = 200;
const PALETTE_WIDTH_MIN = 180;
const PALETTE_WIDTH_MAX = 420;

function loadPaletteWidth(): number {
  try {
    const raw = localStorage.getItem(PALETTE_WIDTH_KEY);
    if (!raw) return PALETTE_WIDTH_DEFAULT;
    const n = Number(raw);
    if (!Number.isFinite(n)) return PALETTE_WIDTH_DEFAULT;
    return Math.min(PALETTE_WIDTH_MAX, Math.max(PALETTE_WIDTH_MIN, n));
  } catch {
    return PALETTE_WIDTH_DEFAULT;
  }
}

function savePaletteWidth(width: number): void {
  try {
    localStorage.setItem(PALETTE_WIDTH_KEY, String(width));
  } catch {
    /* private mode / quota — ignore */
  }
}

// Kit presets live in palettePresets.ts (data-only module, keeps this file
// component-only for fast refresh).

interface NodePaletteProps {
  compoundTypes: CompoundTypeDefinition[];
  isEditingCompound: boolean;
}

export function NodePalette({ compoundTypes, isEditingCompound }: NodePaletteProps) {
  const [tab, setTab] = useState<PaletteTab>(loadPaletteTab);
  const [collapsedPaletteSections, setCollapsedPaletteSections] = useState<
    Record<PaletteSection, boolean>
  >(loadCollapsedPaletteSections);
  const [paletteWidth, setPaletteWidth] = useState<number>(loadPaletteWidth);
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);
  const [isDraggingHandle, setIsDraggingHandle] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(PALETTE_TAB_KEY, tab);
    } catch {
      /* private mode / quota — ignore */
    }
  }, [tab]);

  useEffect(() => {
    try {
      localStorage.setItem(
        PALETTE_COLLAPSED_KEY,
        JSON.stringify(collapsedPaletteSections),
      );
    } catch {
      /* private mode / quota — ignore */
    }
  }, [collapsedPaletteSections]);

  // Sync palette width to a CSS variable on :root so the grid layout tracks it.
  useEffect(() => {
    document.documentElement.style.setProperty('--palette-width', `${paletteWidth}px`);
  }, [paletteWidth]);

  const handleResizePointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    dragState.current = { startX: e.clientX, startWidth: paletteWidth };
    setIsDraggingHandle(true);
  }, [paletteWidth]);

  const handleResizePointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (!dragState.current) return;
    const delta = e.clientX - dragState.current.startX;
    const newWidth = Math.min(
      PALETTE_WIDTH_MAX,
      Math.max(PALETTE_WIDTH_MIN, dragState.current.startWidth + delta),
    );
    setPaletteWidth(newWidth);
  }, []);

  const handleResizePointerUp = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (!dragState.current) return;
    const delta = e.clientX - dragState.current.startX;
    const newWidth = Math.min(
      PALETTE_WIDTH_MAX,
      Math.max(PALETTE_WIDTH_MIN, dragState.current.startWidth + delta),
    );
    dragState.current = null;
    setIsDraggingHandle(false);
    savePaletteWidth(newWidth);
  }, []);

  const handleResizeDoubleClick = useCallback(() => {
    dragState.current = null;
    setIsDraggingHandle(false);
    setPaletteWidth(PALETTE_WIDTH_DEFAULT);
    savePaletteWidth(PALETTE_WIDTH_DEFAULT);
  }, []);

  const renderPreset = (preset: KitPreset) => (
    <div
      key={preset.key}
      className={`palette-item palette-item-${preset.kind}`}
      draggable
      onDragStart={(event) =>
        setDragPayload(event, { type: preset.type, label: preset.label, params: preset.params })
      }
    >
      <span>{preset.label}</span>
      <small>{preset.meta}</small>
    </div>
  );

  return (
    <aside className="node-palette">
      {/* Drag handle on the right (canvas-facing) edge */}
      <div
        className={`palette-resize-handle${isDraggingHandle ? ' dragging' : ''}`}
        aria-hidden="true"
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerUp}
        onPointerCancel={handleResizePointerUp}
        onDoubleClick={handleResizeDoubleClick}
      />
      <div className="palette-tabs" role="tablist" aria-label="Palette mode">
        {(['basic', 'advanced'] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`palette-tab ${tab === id ? 'active' : ''}`}
            onClick={() => setTab(id)}
          >
            {id === 'basic' ? 'Basic' : 'Advanced'}
          </button>
        ))}
      </div>

      {tab === 'basic' ? (
        <>
          <div className="palette-group">
            <h2 className="palette-category">
              <span className="palette-category-dot palette-dot-sensor" aria-hidden="true" />
              Kit sensors
            </h2>
            <div className="palette-group-items">{KIT_SENSORS.map(renderPreset)}</div>
          </div>
          <div className="palette-group">
            <h2 className="palette-category">
              <span className="palette-category-dot palette-dot-output" aria-hidden="true" />
              Kit outputs
            </h2>
            <div className="palette-group-items">{KIT_OUTPUTS.map(renderPreset)}</div>
          </div>
          <div className="palette-group">
            <h2 className="palette-category">
              <span className="palette-category-dot palette-dot-compute" aria-hidden="true" />
              Compute
            </h2>
            <div className="palette-group-items">
              {BASIC_COMPUTE_TYPES.map((typeId) => {
                const nodeType = NODE_TYPES.find((n) => n.id === typeId);
                if (!nodeType) return null;
                return (
                  <div
                    key={nodeType.id}
                    className={`palette-item palette-item-${nodeType.kind}`}
                    draggable
                    onDragStart={(event) => setDragPayload(event, { type: nodeType.id })}
                  >
                    <span>{nodeType.displayName}</span>
                    <small>{paletteItemTag(nodeType)}</small>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        <>
          {(['sensor', 'compute', 'output'] as const).map((kind) => {
            const nodesOfKind = kind === 'compute'
              ? NODE_TYPES.filter((n) => n.kind === 'compute' || n.kind === 'constant')
              : NODE_TYPES.filter((n) => n.kind === kind);
            if (nodesOfKind.length === 0) return null;
            const kindLabels: Record<string, string> = {
              sensor: 'Sensors',
              compute: 'Compute',
              output: 'Outputs',
            };
            const collapsed = collapsedPaletteSections[kind];
            return (
              <div key={kind} className="palette-group">
                <h2 className={`palette-category palette-category-${kind}`}>
                  <button
                    type="button"
                    className="palette-category-toggle"
                    aria-expanded={!collapsed}
                    aria-controls={`palette-group-${kind}`}
                    onClick={() =>
                      setCollapsedPaletteSections((prev) => ({ ...prev, [kind]: !prev[kind] }))
                    }
                  >
                    <span
                      className={`palette-chevron ${collapsed ? 'collapsed' : ''}`}
                      aria-hidden="true"
                    >
                      ▾
                    </span>
                    <span
                      className={`palette-category-dot palette-dot-${kind}`}
                      aria-hidden="true"
                    />
                    {kindLabels[kind]}
                  </button>
                </h2>
                {!collapsed && (
                  <div id={`palette-group-${kind}`} className="palette-group-items">
                    {nodesOfKind.map((nodeType) => (
                      <div
                        key={nodeType.id}
                        className={`palette-item palette-item-${nodeType.kind}`}
                        draggable
                        onDragStart={(event) => setDragPayload(event, { type: nodeType.id })}
                      >
                        <span>{nodeType.displayName}</span>
                        <small>{paletteItemTag(nodeType)}</small>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {(compoundTypes.length > 0 || isEditingCompound) && (
            <div className="palette-group">
              <h2 className="palette-category palette-category-compound">
                <button
                  type="button"
                  className="palette-category-toggle"
                  aria-expanded={!collapsedPaletteSections.compound}
                  aria-controls="palette-group-compound"
                  onClick={() =>
                    setCollapsedPaletteSections((prev) => ({ ...prev, compound: !prev.compound }))
                  }
                >
                  <span
                    className={`palette-chevron ${collapsedPaletteSections.compound ? 'collapsed' : ''}`}
                    aria-hidden="true"
                  >
                    ▾
                  </span>
                  <span className="palette-category-dot palette-dot-compound" aria-hidden="true" />
                  Compounds
                </button>
              </h2>
              {!collapsedPaletteSections.compound && (
                <div id="palette-group-compound" className="palette-group-items">
                  {isEditingCompound && (
                    <>
                      <div
                        className="palette-item palette-item-port"
                        draggable
                        onDragStart={(event) => setDragPayload(event, { type: 'compound-input' })}
                        title="Drop inside a compound body — exposes one input port to the outer diagram."
                      >
                        <span>Compound Input</span>
                        <small>input port</small>
                      </div>
                      <div
                        className="palette-item palette-item-port"
                        draggable
                        onDragStart={(event) => setDragPayload(event, { type: 'compound-output' })}
                        title="Drop inside a compound body — exposes one output port to the outer diagram."
                      >
                        <span>Compound Output</span>
                        <small>output port</small>
                      </div>
                    </>
                  )}
                  {compoundTypes.map((def) => (
                    <div
                      key={def.id}
                      className="palette-item palette-item-compound"
                      draggable
                      onDragStart={(event) =>
                        setDragPayload(event, { type: 'compound', compoundTypeId: def.id })
                      }
                    >
                      <span>{def.displayName}</span>
                      <small>compound</small>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </aside>
  );
}
