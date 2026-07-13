import React, { useEffect, useRef, useState } from 'react';
import type { CSSProperties, Dispatch, MouseEvent, MutableRefObject, SetStateAction } from 'react';
import type { ColorChannel, CompoundTypeDefinition, DiagramNode, OutputPortId } from '../types/diagram';
import { COLOR_CHANNEL_LABELS, TYPE_BY_ID, getInputPorts, getOutputPorts, getPortLabel } from '../types/diagram';
import { canInput, canOutput, supportsArduinoPort } from './diagramShared';
import type { ConfigTarget } from './diagramShared';
import type { NodeTypeId } from '../types/diagram';
import type { IconProps } from './icons';
import {
  AsteriskIcon,
  ChevronsDownIcon,
  ChevronsUpIcon,
  FilterIcon,
  GaugeIcon,
  HashIcon,
  LayersIcon,
  LogInIcon,
  LogOutIcon,
  MonitorIcon,
  NoiseIcon,
  PaletteIcon,
  PowerIcon,
  RotateIcon,
  RulerIcon,
  SigmaIcon,
  SineWaveIcon,
  SunIcon,
  TimerIcon,
  ToggleIcon,
} from './icons';

// A small glyph shown before each node's label, so its type is legible at a
// glance without reading the text. Keyed by node type; every type has one.
const NODE_TYPE_ICONS: Record<NodeTypeId, (props: IconProps) => React.ReactElement> = {
  'sensor-analog': SunIcon,
  'sensor-digital': ToggleIcon,
  'sensor-color': PaletteIcon,
  'sensor-tof': RulerIcon,
  'compute-threshold': FilterIcon,
  'compute-delay': TimerIcon,
  'compute-summation': SigmaIcon,
  'compute-multiply': AsteriskIcon,
  'compute-min': ChevronsDownIcon,
  'compute-max': ChevronsUpIcon,
  'compute-oscillator': SineWaveIcon,
  'compute-noise': NoiseIcon,
  constant: HashIcon,
  'servo-cr': RotateIcon,
  'servo-positional': GaugeIcon,
  'digital-out': PowerIcon,
  'display-tm1637': MonitorIcon,
  compound: LayersIcon,
  'compound-input': LogInIcon,
  'compound-output': LogOutIcon,
};

interface DiagramNodeViewProps {
  node: DiagramNode;
  // Pre-computed world position (in canvas px), passed as primitives so the
  // memo comparison stays cheap and stable during drags of other nodes.
  // The trace props below follow the same philosophy: the parent extracts
  // this node's own displayed values from the per-update TraceResult / trace
  // input record and passes them as primitives (pre-formatted to display
  // precision), so a simulation tick only re-renders the nodes whose
  // displayed data actually changed.
  worldX: number;
  worldY: number;
  isSelected: boolean;
  isMultiSelected: boolean;
  traceMode: boolean;
  // This node's formatted output value; undefined outside trace mode or when
  // the node has no computed value.
  traceValue?: string;
  // Trace mode flagged this node as having no incoming connections.
  isDisconnected: boolean;
  // Comma-joined formatted output-port values in getOutputPorts order; an
  // empty slot means that port has no value. Undefined outside trace mode or
  // when the node has no output ports.
  outputPortValues?: string;
  // Same encoding for a compound instance's input ports.
  inputPortValues?: string;
  compoundTypes: CompoundTypeDefinition[];
  // This node's own trace input (sensor / compound-input slider state).
  sensorValue?: number;
  // Comma-joined per-channel trace inputs for a color sensor, in
  // getOutputPorts('sensor-color') order. Undefined outside trace mode.
  colorSensorValues?: string;
  isPulsing: boolean;
  // Duration of the "▶" sensor pulse — shown in the button tooltip.
  pulseDurationMs: number;
  beginNodeDrag: (event: MouseEvent, nodeId: string) => void;
  // Set by beginNodeDrag when a multi-node drag moves; the node's onClick
  // reads and clears it to swallow the click that ends the drag.
  clickSuppressRef: MutableRefObject<boolean>;
  beginLinkDrag: (event: MouseEvent, nodeId: string, port?: OutputPortId) => void;
  completeLink: (toId: string, toPort?: string) => void;
  enterCompound: (compoundTypeId: string) => void;
  // Double-click the label to rename; omitted (or readOnly) disables it.
  onRename?: (id: string, label: string) => void;
  // Right-click the node body; the host opens a context menu at the point.
  onContextMenu?: (id: string, clientX: number, clientY: number) => void;
  pulseSensor: (id: string) => void;
  setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
  setConfigTarget: Dispatch<SetStateAction<ConfigTarget | null>>;
  // Trace-mode sensor inputs. Writes the shared `trace` map (keyed nodeId or
  // nodeId:channel) via an untracked store mutation — carries no undo entry.
  setSensorValue: (key: string, value: number) => void;
  // Trace-mode constant slider. Writes node.constantValue (shared document
  // state) via an untracked store mutation — carries no undo entry.
  setConstantValue: (id: string, value: number) => void;
  // View-only role: disable every trace input (slider, toggle, pulse).
  readOnly: boolean;
  // A remote peer selecting/dragging this node — outline it in their color.
  remoteColor?: string;
  remoteLabel?: string;
}

function DiagramNodeViewInner({
  node,
  worldX,
  worldY,
  isSelected,
  isMultiSelected,
  traceMode,
  traceValue,
  isDisconnected,
  outputPortValues,
  inputPortValues,
  compoundTypes,
  sensorValue,
  colorSensorValues,
  isPulsing,
  pulseDurationMs,
  beginNodeDrag,
  clickSuppressRef,
  beginLinkDrag,
  completeLink,
  enterCompound,
  onRename,
  onContextMenu,
  pulseSensor,
  setSelectedNodeIds,
  setConfigTarget,
  setSensorValue,
  setConstantValue,
  readOnly,
  remoteColor,
  remoteLabel,
}: DiagramNodeViewProps) {
  const nodeType = TYPE_BY_ID[node.type];
  const isCompoundInput = node.type === 'compound-input';
  // Inline label rename (double-click the label text). Disabled in read-only
  // views or when the host doesn't supply an onRename callback.
  const canRename = !readOnly && onRename !== undefined;
  const [renaming, setRenaming] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  // On open, focus the field and select its text (file-rename behavior), so the
  // caret is live and typing replaces the old label immediately.
  useEffect(() => {
    if (!renaming) return;
    const el = renameInputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [renaming]);
  const commitRename = (raw: string) => {
    setRenaming(false);
    const next = raw.trim();
    if (next && next !== node.label) onRename?.(node.id, next);
  };
  const hasSlider =
    traceMode &&
    (nodeType.kind === 'sensor' ||
      nodeType.kind === 'constant' ||
      isCompoundInput);

  let nodeMeta: string;
  if (nodeType.id === 'sensor-color') {
    // Multi-channel source: the per-channel values live on the output
    // handles, so keep the node meta as the channel legend rather than
    // a single "output" value.
    nodeMeta = `${nodeType.metaLabel} • RGBC outputs`;
  } else if (traceValue !== undefined) {
    nodeMeta = `output: ${traceValue}`;
  } else if (supportsArduinoPort(nodeType) && node.arduinoPort?.trim()) {
    nodeMeta = `${nodeType.metaLabel} • port ${node.arduinoPort.trim()}`;
  } else if (nodeType.mode === 'threshold' && node.threshold !== undefined) {
    nodeMeta = `${nodeType.metaLabel} • ${node.threshold}`;
  } else if (nodeType.mode === 'delay' && node.delayMs !== undefined) {
    nodeMeta = `${nodeType.metaLabel} • ${node.delayMs}ms`;
  } else if (nodeType.mode === 'oscillator' && node.frequencyHz !== undefined) {
    nodeMeta = `${nodeType.metaLabel} • ${node.frequencyHz} Hz`;
  } else if (nodeType.mode === 'noise' && node.amplitude !== undefined) {
    nodeMeta = `${nodeType.metaLabel} • ±${node.amplitude}`;
  } else if (nodeType.kind === 'constant' && node.constantValue !== undefined) {
    nodeMeta = `${nodeType.metaLabel} • ${node.constantValue}`;
  } else if (nodeType.id === 'display-tm1637' && node.clkPin?.trim() && node.gpioPin?.trim()) {
    nodeMeta = `${nodeType.metaLabel} • CLK ${node.clkPin.trim()} / GPIO ${node.gpioPin.trim()}`;
  } else if (nodeType.kind === 'output' && nodeType.id !== 'display-tm1637' && node.servoPin?.trim()) {
    nodeMeta = `${nodeType.metaLabel} • pin ${node.servoPin.trim()}`;
  } else if (nodeType.id === 'sensor-tof' && node.xshutPin?.trim()) {
    nodeMeta = `${nodeType.metaLabel} • XSHUT ${node.xshutPin.trim()}`;
  } else {
    nodeMeta = nodeType.metaLabel;
  }

  return (
    <div
      className={[
        'diagram-node',
        `node-${nodeType.kind}`,
        isSelected ? 'selected' : '',
        isMultiSelected ? 'multi-selected' : '',
        isDisconnected ? 'trace-disconnected' : '',
        hasSlider ? 'trace-expanded' : '',
        hasSlider && node.type === 'sensor-color' ? 'trace-color-expanded' : '',
        remoteColor ? 'remote-selected' : '',
        renaming ? 'renaming' : '',
      ].filter(Boolean).join(' ')}
      style={{
        left: `${worldX}px`,
        top: `${worldY}px`,
        ...(remoteColor
          ? ({ '--remote-color': remoteColor } as CSSProperties)
          : null),
      }}
      onMouseDown={(event) => beginNodeDrag(event, node.id)}
      onContextMenu={
        onContextMenu
          ? (event) => {
              event.preventDefault();
              event.stopPropagation();
              setSelectedNodeIds(new Set([node.id]));
              setConfigTarget({ kind: 'node', id: node.id });
              onContextMenu(node.id, event.clientX, event.clientY);
            }
          : undefined
      }
      onClick={(event) => {
        // A multi-node drag just ended: swallow this click so it doesn't
        // collapse the selection down to only the grabbed node.
        if (clickSuppressRef.current) {
          clickSuppressRef.current = false;
          return;
        }
        if (event.shiftKey) {
          // Toggle this node in the multi-select set without
          // disturbing the rest.
          setSelectedNodeIds((prev) => {
            const next = new Set(prev);
            if (next.has(node.id)) next.delete(node.id);
            else next.add(node.id);
            return next;
          });
        } else {
          setSelectedNodeIds(new Set([node.id]));
        }
        setConfigTarget({ kind: 'node', id: node.id });
      }}
      onDoubleClick={
        node.type === 'compound' && node.compoundTypeId
          ? (event) => {
              event.stopPropagation();
              enterCompound(node.compoundTypeId!);
              setConfigTarget(null);
            }
          : undefined
      }
    >
      {remoteColor && remoteLabel && (
        <span className="remote-owner-tag" style={{ background: remoteColor }} aria-hidden="true">
          {remoteLabel}
        </span>
      )}
      <div
        className="node-label"
        onDoubleClick={
          canRename
            ? (event) => {
                // Rename on label double-click; stop it reaching the node's
                // enter-compound double-click handler.
                event.stopPropagation();
                setRenaming(true);
              }
            : undefined
        }
      >
        {(() => {
          const TypeIcon = NODE_TYPE_ICONS[node.type];
          return TypeIcon ? (
            <span className="node-type-icon" aria-hidden="true">
              <TypeIcon size={13} />
            </span>
          ) : null;
        })()}
        {renaming ? (
          <input
            ref={renameInputRef}
            className="node-label-input"
            type="text"
            defaultValue={node.label}
            spellCheck={false}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onBlur={(e) => commitRename(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitRename((e.target as HTMLInputElement).value);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setRenaming(false);
              }
            }}
          />
        ) : (
          node.label
        )}
      </div>
      <div className={`node-meta ${traceValue !== undefined ? 'node-meta-trace' : ''}`}>{nodeMeta}</div>
      {hasSlider && node.type === 'sensor-digital' && (
        <div className="trace-slider-row">
          <button
            type="button"
            className={`trace-digital-toggle ${
              (sensorValue ?? 0) >= 50 ? 'high' : 'low'
            }`}
            disabled={readOnly}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              const isHigh = (sensorValue ?? 0) >= 50;
              setSensorValue(node.id, isHigh ? 0 : 100);
            }}
            title="Toggle digital input (LOW / HIGH)"
          >
            {(sensorValue ?? 0) >= 50 ? 'HIGH' : 'LOW'}
          </button>
          <button
            type="button"
            className={`trace-pulse-btn ${isPulsing ? 'pulsing' : ''}`}
            title={`Pulse this sensor HIGH for ${pulseDurationMs}ms`}
            disabled={readOnly}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              pulseSensor(node.id);
            }}
          >
            ▶
          </button>
        </div>
      )}
      {hasSlider && node.type === 'sensor-color' && (() => {
        // Decode the comma-joined per-channel values (same port order the
        // parent used to encode them).
        const channelValues = colorSensorValues?.split(',');
        return (
        <div className="trace-color-sliders">
          {getOutputPorts('sensor-color')!.map((ch, i) => (
            <div className="trace-slider-row" key={ch}>
              <span
                className={`trace-slider-label output-port-label-${ch}`}
                title={COLOR_CHANNEL_LABELS[ch as ColorChannel].name}
              >
                {COLOR_CHANNEL_LABELS[ch as ColorChannel].short}
              </span>
              <input
                type="range"
                className="trace-slider"
                min="0"
                max="100"
                step="1"
                disabled={readOnly}
                value={Number(channelValues?.[i] ?? 0)}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  setSensorValue(`${node.id}:${ch}`, v);
                }}
              />
            </div>
          ))}
        </div>
        );
      })()}
      {hasSlider && node.type !== 'sensor-digital' && node.type !== 'sensor-color' && (() => {
        const sliderMin = nodeType.kind === 'constant' || isCompoundInput ? -100 : 0;
        const sliderValue = nodeType.kind === 'sensor'
          ? (sensorValue ?? 50)
          : isCompoundInput
            ? (sensorValue ?? 0)
            : (node.constantValue ?? 0);
        return (
        <div className="trace-slider-row">
          <span className="trace-slider-label">{sliderMin}</span>
          <input
            type="range"
            className="trace-slider"
            min={sliderMin}
            max="100"
            step="1"
            disabled={readOnly}
            value={sliderValue}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (nodeType.kind === 'sensor' || isCompoundInput) {
                setSensorValue(node.id, v);
              } else {
                setConstantValue(node.id, v);
              }
            }}
          />
          <span className="trace-slider-label">100</span>
          {(nodeType.kind === 'sensor' || isCompoundInput) && (
            <button
              type="button"
              className={`trace-pulse-btn ${isPulsing ? 'pulsing' : ''}`}
              title={`Pulse to 100 for ${pulseDurationMs}ms`}
              disabled={readOnly}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                pulseSensor(node.id);
              }}
            >
              ▶
            </button>
          )}
        </div>
        );
      })()}
      {canOutput(nodeType) && (() => {
        const ports = getOutputPorts(nodeType.id, node, compoundTypes);
        if (!ports || ports.length === 0) {
          return (
            <button
              className="node-handle output-handle"
              aria-label={`Start connection from ${node.label}`}
              onMouseDown={(event) => beginLinkDrag(event, node.id)}
            />
          );
        }
        const isCompound = node.type === 'compound';
        const isColorSensor = node.type === 'sensor-color';
        // Pre-formatted per-port values from the parent; '' = no value.
        const portValues = outputPortValues?.split(',');
        return ports.map((port, i) => {
          const leftPct = ((i + 0.5) / ports.length) * 100;
          // Color channels get a friendly display name (White/Red/…); the
          // clear/unfiltered diode reads total light, hence "White" (short "W"
          // so it doesn't collide with Red/Green/Blue on the handle).
          const colorChannel = isColorSensor ? COLOR_CHANNEL_LABELS[port as ColorChannel] : undefined;
          const label = isCompound
            ? getPortLabel(port, node, compoundTypes)
            : colorChannel
              ? colorChannel.short
              : port[0].toUpperCase();
          const portTitle = colorChannel ? colorChannel.name : port;
          const portValue = portValues?.[i] || undefined;
          return (
            <span key={port}>
              <button
                className={`node-handle output-handle output-handle-port output-handle-${port}`}
                style={{ left: `${leftPct}%` }}
                title={portTitle}
                aria-label={`Start ${portTitle} connection from ${node.label}`}
                onMouseDown={(event) => beginLinkDrag(event, node.id, port)}
              />
              <span
                className={`output-port-label ${
                  isCompound ? 'output-port-label-compound' : `output-port-label-${port}`
                }`}
                style={{ left: `${leftPct}%` }}
                aria-hidden="true"
              >
                {label}
              </span>
              {portValue !== undefined && (
                <span
                  className="output-port-value"
                  style={{ left: `${leftPct}%` }}
                  aria-hidden="true"
                >
                  {portValue}
                </span>
              )}
            </span>
          );
        });
      })()}
      {canInput(nodeType) && (() => {
        const inputs = getInputPorts(nodeType.id, node, compoundTypes);
        if (!inputs || inputs.length === 0) {
          return (
            <button
              className="node-handle input-handle"
              aria-label={`Connect to ${node.label}`}
              onMouseDown={(event) => event.stopPropagation()}
              onMouseUp={() => completeLink(node.id)}
            />
          );
        }
        // Pre-formatted per-port values from the parent (compound instances
        // only); '' = no value.
        const portValues = inputPortValues?.split(',');
        return inputs.map((port, i) => {
          const leftPct = ((i + 0.5) / inputs.length) * 100;
          const portValue = portValues?.[i] || undefined;
          return (
            <span key={port}>
              <button
                className="node-handle input-handle input-handle-port"
                style={{ left: `${leftPct}%` }}
                title={port}
                aria-label={`Connect to ${node.label} (${port})`}
                onMouseDown={(event) => event.stopPropagation()}
                onMouseUp={() => completeLink(node.id, port)}
              />
              <span
                className="input-port-label"
                style={{ left: `${leftPct}%` }}
                aria-hidden="true"
              >
                {getPortLabel(port, node, compoundTypes)}
              </span>
              {portValue !== undefined && (
                <span
                  className="input-port-value"
                  style={{ left: `${leftPct}%` }}
                  aria-hidden="true"
                >
                  {portValue}
                </span>
              )}
            </span>
          );
        });
      })()}
    </div>
  );
}

export const DiagramNodeView = React.memo(DiagramNodeViewInner);
