import React from 'react';
import type { Dispatch, MouseEvent, SetStateAction } from 'react';
import type { CompoundTypeDefinition, DiagramNode, OutputPortId } from '../types/diagram';
import { TYPE_BY_ID, getInputPorts, getOutputPorts, getPortLabel } from '../types/diagram';
import type { TraceResult } from '../hooks/useTraceSimulation';
import { formatTraceValue } from '../hooks/useTraceSimulation';
import { canInput, canOutput, supportsArduinoPort } from './diagramShared';
import type { ConfigTarget } from './diagramShared';

interface DiagramNodeViewProps {
  node: DiagramNode;
  // Pre-computed world position (in canvas px), passed as primitives so the
  // memo comparison stays cheap and stable during drags of other nodes.
  worldX: number;
  worldY: number;
  isSelected: boolean;
  isMultiSelected: boolean;
  traceMode: boolean;
  traceResult: TraceResult;
  compoundTypes: CompoundTypeDefinition[];
  sensorValues: Record<string, number>;
  pulsingId: string | null;
  beginNodeDrag: (event: MouseEvent, nodeId: string) => void;
  beginLinkDrag: (event: MouseEvent, nodeId: string, port?: OutputPortId) => void;
  completeLink: (toId: string, toPort?: string) => void;
  enterCompound: (compoundTypeId: string) => void;
  pulseSensor: (id: string) => void;
  lookupPortValue: (nodeId: string, portId: string) => number | undefined;
  setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
  setConfigTarget: Dispatch<SetStateAction<ConfigTarget | null>>;
  setSensorValues: Dispatch<SetStateAction<Record<string, number>>>;
  setNodes: Dispatch<SetStateAction<DiagramNode[]>>;
}

function DiagramNodeViewInner({
  node,
  worldX,
  worldY,
  isSelected,
  isMultiSelected,
  traceMode,
  traceResult,
  compoundTypes,
  sensorValues,
  pulsingId,
  beginNodeDrag,
  beginLinkDrag,
  completeLink,
  enterCompound,
  pulseSensor,
  lookupPortValue,
  setSelectedNodeIds,
  setConfigTarget,
  setSensorValues,
  setNodes,
}: DiagramNodeViewProps) {
  const nodeType = TYPE_BY_ID[node.type];
  const traceVal = traceMode ? traceResult.nodeValues[node.id] : undefined;
  const isDisconnected = traceMode && traceResult.disconnected.has(node.id);
  const isCompoundInput = node.type === 'compound-input';
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
  } else if (traceVal !== undefined) {
    nodeMeta = `output: ${formatTraceValue(traceVal)}`;
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
      ].filter(Boolean).join(' ')}
      style={{ left: `${worldX}px`, top: `${worldY}px` }}
      onMouseDown={(event) => beginNodeDrag(event, node.id)}
      onClick={(event) => {
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
      <div className="node-label">{node.label}</div>
      <div className={`node-meta ${traceVal !== undefined ? 'node-meta-trace' : ''}`}>{nodeMeta}</div>
      {hasSlider && node.type === 'sensor-digital' && (
        <div className="trace-slider-row">
          <button
            type="button"
            className={`trace-digital-toggle ${
              (sensorValues[node.id] ?? 0) >= 50 ? 'high' : 'low'
            }`}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              const isHigh = (sensorValues[node.id] ?? 0) >= 50;
              setSensorValues((prev) => ({
                ...prev,
                [node.id]: isHigh ? 0 : 100,
              }));
            }}
            title="Toggle digital input (LOW / HIGH)"
          >
            {(sensorValues[node.id] ?? 0) >= 50 ? 'HIGH' : 'LOW'}
          </button>
          <button
            type="button"
            className={`trace-pulse-btn ${pulsingId === node.id ? 'pulsing' : ''}`}
            title="Pulse this sensor HIGH for 200ms"
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
      {hasSlider && node.type === 'sensor-color' && (
        <div className="trace-color-sliders">
          {getOutputPorts('sensor-color')!.map((ch) => (
            <div className="trace-slider-row" key={ch}>
              <span className={`trace-slider-label output-port-label-${ch}`}>
                {ch[0].toUpperCase()}
              </span>
              <input
                type="range"
                className="trace-slider"
                min="0"
                max="100"
                step="1"
                value={sensorValues[`${node.id}:${ch}`] ?? 0}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  setSensorValues((prev) => ({
                    ...prev,
                    [`${node.id}:${ch}`]: v,
                  }));
                }}
              />
            </div>
          ))}
        </div>
      )}
      {hasSlider && node.type !== 'sensor-digital' && node.type !== 'sensor-color' && (() => {
        const sliderMin = nodeType.kind === 'constant' || isCompoundInput ? -100 : 0;
        const sliderValue = nodeType.kind === 'sensor'
          ? (sensorValues[node.id] ?? 50)
          : isCompoundInput
            ? (sensorValues[node.id] ?? 0)
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
            value={sliderValue}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (nodeType.kind === 'sensor' || isCompoundInput) {
                setSensorValues((prev) => ({ ...prev, [node.id]: v }));
              } else {
                setNodes((prev) =>
                  prev.map((n) =>
                    n.id === node.id ? { ...n, constantValue: v } : n,
                  ),
                );
              }
            }}
          />
          <span className="trace-slider-label">100</span>
          {(nodeType.kind === 'sensor' || isCompoundInput) && (
            <button
              type="button"
              className={`trace-pulse-btn ${pulsingId === node.id ? 'pulsing' : ''}`}
              title="Pulse to 100 for 200ms"
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
        return ports.map((port, i) => {
          const leftPct = ((i + 0.5) / ports.length) * 100;
          const label = isCompound ? getPortLabel(port, node, compoundTypes) : port[0].toUpperCase();
          const portValue = !traceMode
            ? undefined
            : isCompound
              ? lookupPortValue(node.id, port)
              : traceResult.nodeValues[`${node.id}:${port}`];
          return (
            <span key={port}>
              <button
                className={`node-handle output-handle output-handle-port output-handle-${port}`}
                style={{ left: `${leftPct}%` }}
                title={port}
                aria-label={`Start ${port} connection from ${node.label}`}
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
                  {formatTraceValue(portValue)}
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
        return inputs.map((port, i) => {
          const leftPct = ((i + 0.5) / inputs.length) * 100;
          const portValue = node.type === 'compound' && traceMode
            ? lookupPortValue(node.id, port)
            : undefined;
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
                  {formatTraceValue(portValue)}
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
