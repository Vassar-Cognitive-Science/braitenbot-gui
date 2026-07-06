import { useEffect, useState } from 'react';
import type { DragEvent } from 'react';
import type {
  CompoundTypeDefinition,
  DiagramNode,
  NodeTypeDefinition,
  NodeTypeId,
} from '../types/diagram';
import { NODE_TYPES } from '../types/diagram';

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

// ---- Kit presets -----------------------------------------------------------

/**
 * A Basic-tab preset: a friendly kit name that drops a normal node of an
 * existing type with its pins/params pre-filled to match the reference build
 * (see docs/docs/hardware/assembly.md). `kind` selects the accent color;
 * `meta` is the small pin label shown under the name.
 */
interface KitPreset {
  key: string;
  type: NodeTypeId;
  label: string;
  meta: string;
  kind: 'sensor' | 'output';
  params?: Partial<DiagramNode>;
}

const KIT_SENSORS: KitPreset[] = [
  { key: 'photocell-left', type: 'sensor-analog', label: 'Left Photocell', meta: 'A0', kind: 'sensor', params: { arduinoPort: 'A0' } },
  { key: 'photocell-right', type: 'sensor-analog', label: 'Right Photocell', meta: 'A1', kind: 'sensor', params: { arduinoPort: 'A1' } },
  { key: 'bump-fl', type: 'sensor-digital', label: 'Bump Front-Left', meta: 'D2', kind: 'sensor', params: { arduinoPort: '2', pullup: true } },
  { key: 'bump-fr', type: 'sensor-digital', label: 'Bump Front-Right', meta: 'D3', kind: 'sensor', params: { arduinoPort: '3', pullup: true } },
  { key: 'bump-rl', type: 'sensor-digital', label: 'Bump Rear-Left', meta: 'D4', kind: 'sensor', params: { arduinoPort: '4', pullup: true } },
  { key: 'bump-rr', type: 'sensor-digital', label: 'Bump Rear-Right', meta: 'D7', kind: 'sensor', params: { arduinoPort: '7', pullup: true } },
  { key: 'color', type: 'sensor-color', label: 'Color Sensor', meta: 'I2C', kind: 'sensor' },
  { key: 'tof-1', type: 'sensor-tof', label: 'ToF Distance 1', meta: 'XSHUT D8', kind: 'sensor', params: { xshutPin: '8' } },
  { key: 'tof-2', type: 'sensor-tof', label: 'ToF Distance 2', meta: 'XSHUT D12', kind: 'sensor', params: { xshutPin: '12' } },
];

const KIT_OUTPUTS: KitPreset[] = [
  { key: 'display', type: 'display-tm1637', label: '7-Segment Display', meta: 'CLK D9 / DIO D10', kind: 'output', params: { clkPin: '9', gpioPin: '10' } },
];

/** Generic starter compute nodes shown on the Basic tab (no preset params). */
const BASIC_COMPUTE_TYPES: NodeTypeId[] = ['compute-threshold', 'compute-summation', 'compute-delay'];

interface NodePaletteProps {
  compoundTypes: CompoundTypeDefinition[];
  isEditingCompound: boolean;
}

export function NodePalette({ compoundTypes, isEditingCompound }: NodePaletteProps) {
  const [tab, setTab] = useState<PaletteTab>(loadPaletteTab);
  const [collapsedPaletteSections, setCollapsedPaletteSections] = useState<
    Record<PaletteSection, boolean>
  >(loadCollapsedPaletteSections);

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
