import React, { useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import type {
  CompoundTypeDefinition,
  DiagramConnection,
  DiagramNode,
} from '@app/types/diagram';
import {
  TYPE_BY_ID,
  getInputPorts,
  getOutputPorts,
} from '@app/types/diagram';
import { canOutput } from '@app/components/diagramShared';
import { useScopeSimulation } from '@app/hooks/useScopeSimulation';
import { formatTraceValue } from '@app/hooks/useTraceSimulation';
import { DiagramNodeView } from '@app/components/DiagramNodeView';
import { ConnectionLayer } from '@app/components/ConnectionLayer';
import { NODE_H, NODE_W, computeConnectionPaths } from '@app/components/connectionGeometry';
// The app's diagram presentation layer (nodes, connections, trace UI). Scoped
// under `.bb-diagram`, so it renders as a self-contained dark panel and leaks
// nothing into the Docusaurus theme. Aliased CSS import resolves through the
// `@app` webpack alias defined in docusaurus.config.ts.
import '@app/components/diagram.css';
import './styles.css';

/**
 * An always-on, embeddable trace-mode diagram for the docs site. It reuses BOTH
 * the desktop app's simulation core (`useScopeSimulation` — see `@app/hooks/*`)
 * AND the app's rendering layer (`DiagramNodeView` / `ConnectionLayer` / the
 * `.bb-diagram` stylesheet), so an embedded diagram looks and behaves exactly
 * like the app's trace mode and can never drift from it. Nothing here is
 * re-implemented; only layout/embed chrome (panel frame, scaling, caption) is
 * docs-local.
 *
 * The `diagram` prop is the app's EXPORT format, so a diagram built in the app
 * can be pasted straight into MDX.
 */
export interface InteractiveDiagramProps {
  diagram: {
    loopPeriodMs?: number;
    nodes: DiagramNode[];
    connections: DiagramConnection[];
    compoundTypes?: CompoundTypeDefinition[];
  };
  caption?: string;
  /** Canvas height in px; content is scaled to fit the available width. */
  height?: number;
  /**
   * Initial sensor values keyed exactly as the simulation keys them: the node
   * id for analog/digital/tof/constant/compound-input, and `${id}:${channel}`
   * (channel ∈ clear|red|green|blue) for color sensors.
   */
  initialInputs?: Record<string, number>;
  /** Default pulse length (ms) for the per-sensor pulse buttons. */
  pulseDurationMs?: number;
}

const PAD = 48;

// ── Static layout shared by SSR fallback and live component ────────────────

interface Layout {
  offsetX: number;
  offsetY: number;
  contentW: number;
  contentH: number;
}

function computeLayout(nodes: DiagramNode[]): Layout {
  if (nodes.length === 0) {
    return { offsetX: PAD, offsetY: PAD, contentW: 400, contentH: 300 };
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + NODE_W);
    maxY = Math.max(maxY, n.y + NODE_H);
  }
  return {
    offsetX: -minX + PAD,
    offsetY: -minY + PAD,
    contentW: maxX - minX + PAD * 2,
    contentH: maxY - minY + PAD * 2,
  };
}

// No-op editing callbacks: the docs embed is view-only w.r.t. graph structure
// (no dragging nodes, drawing links, opening config panels), but its trace
// inputs (sliders / toggles / pulse) stay live. `readOnly={false}` on the node
// view keeps those inputs enabled; the structural callbacks below simply do
// nothing.
const NOOP = () => {};
const NOOP_SET_SELECTED: Dispatch<SetStateAction<Set<string>>> = () => {};

// ── Rendering core, shared by the live and static (SSR) variants ───────────

function DiagramCanvas({
  nodes,
  connections,
  compoundTypes,
  height,
  sensorValues,
  setSensor,
  setConstant,
  pulse,
  pulsingId,
  pulseDurationMs,
  traceResult,
}: {
  nodes: DiagramNode[];
  connections: DiagramConnection[];
  compoundTypes: CompoundTypeDefinition[];
  height: number;
  sensorValues: Record<string, number>;
  setSensor: (key: string, value: number) => void;
  setConstant: (id: string, value: number) => void;
  pulse: (id: string) => void;
  pulsingId: string | null;
  pulseDurationMs: number;
  /** Live trace values; undefined slots in the static SSR fallback. */
  traceResult?: {
    nodeValues: Record<string, number>;
    edgeSignals: Record<string, number>;
    disconnected: Set<string>;
  };
}) {
  const layout = useMemo(() => computeLayout(nodes), [nodes]);
  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const scale = Math.min(1, height / layout.contentH);
  const worldW = layout.contentW * scale;

  // Reuse the app's connection geometry. Node world position = raw node
  // coordinate + layout offset (docs have no zoom / block-scale).
  const paths = useMemo(
    () =>
      computeConnectionPaths(
        connections,
        (id) => nodeMap.get(id),
        (node) => ({ x: node.x + layout.offsetX, y: node.y + layout.offsetY }),
        compoundTypes,
        1,
      ),
    [connections, nodeMap, compoundTypes, layout],
  );

  const nodeValues = traceResult?.nodeValues ?? {};

  return (
    <div className="id-canvas" style={{ height, width: worldW || undefined }}>
      <div
        className="id-world bb-diagram"
        style={{
          transform: `scale(${scale})`,
          transformOrigin: '0 0',
          width: layout.contentW,
          height: layout.contentH,
        }}
      >
        <ConnectionLayer
          paths={paths}
          edgeSignals={traceResult?.edgeSignals}
          selectedConnectionId={null}
        />

        {nodes.map((node) => {
          const nodeType = TYPE_BY_ID[node.type];
          const isCompound = node.type === 'compound';
          const rawTraceValue = traceResult ? nodeValues[node.id] : undefined;

          const outputPorts = traceResult && canOutput(nodeType)
            ? getOutputPorts(nodeType.id, node, compoundTypes)
            : undefined;
          const outputPortValues = outputPorts && outputPorts.length > 0
            ? outputPorts
                .map((port) => {
                  const v = nodeValues[
                    isCompound ? `${node.id}/${port}` : `${node.id}:${port}`
                  ];
                  return v === undefined ? '' : formatTraceValue(v);
                })
                .join(',')
            : undefined;
          const inputPorts = traceResult && isCompound
            ? getInputPorts(nodeType.id, node, compoundTypes)
            : undefined;
          const inputPortValues = inputPorts && inputPorts.length > 0
            ? inputPorts
                .map((port) => {
                  const v = nodeValues[`${node.id}/${port}`];
                  return v === undefined ? '' : formatTraceValue(v);
                })
                .join(',')
            : undefined;
          const colorSensorValues = node.type === 'sensor-color'
            ? getOutputPorts('sensor-color')!
                .map((ch) => sensorValues[`${node.id}:${ch}`] ?? 0)
                .join(',')
            : undefined;

          return (
            <DiagramNodeView
              key={node.id}
              node={node}
              worldX={node.x + layout.offsetX}
              worldY={node.y + layout.offsetY}
              isSelected={false}
              isMultiSelected={false}
              traceMode
              traceValue={rawTraceValue !== undefined ? formatTraceValue(rawTraceValue) : undefined}
              isDisconnected={traceResult?.disconnected.has(node.id) ?? false}
              outputPortValues={outputPortValues}
              inputPortValues={inputPortValues}
              compoundTypes={compoundTypes}
              sensorValue={sensorValues[node.id]}
              colorSensorValues={colorSensorValues}
              isPulsing={pulsingId === node.id}
              pulseDurationMs={pulseDurationMs}
              beginNodeDrag={NOOP}
              beginLinkDrag={NOOP}
              completeLink={NOOP}
              enterCompound={NOOP}
              pulseSensor={pulse}
              setSelectedNodeIds={NOOP_SET_SELECTED}
              setConfigTarget={NOOP}
              setSensorValue={setSensor}
              setConstantValue={setConstant}
              readOnly={traceResult === undefined}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── Live (browser-only) implementation ─────────────────────────────────────

function LiveDiagram({
  diagram,
  height,
  initialInputs,
  pulseDurationMs,
}: {
  diagram: InteractiveDiagramProps['diagram'];
  height: number;
  initialInputs: Record<string, number>;
  pulseDurationMs: number;
}) {
  const compoundTypes = useMemo(() => diagram.compoundTypes ?? [], [diagram.compoundTypes]);
  const loopPeriodMs = diagram.loopPeriodMs ?? 50;

  const [sensorValues, setSensorValues] = useState<Record<string, number>>(initialInputs);
  // Trace-mode constant edits (constant nodes' slider) apply as an override on
  // top of the diagram's declared constantValue.
  const [constantOverrides, setConstantOverrides] = useState<Record<string, number>>({});
  const [pulsingId, setPulsingId] = useState<string | null>(null);

  const setSensor = (key: string, value: number) =>
    setSensorValues((prev) => ({ ...prev, [key]: value }));
  const setConstant = (id: string, value: number) =>
    setConstantOverrides((prev) => ({ ...prev, [id]: value }));

  const nodes = useMemo(() => {
    if (Object.keys(constantOverrides).length === 0) return diagram.nodes;
    return diagram.nodes.map((n) =>
      constantOverrides[n.id] !== undefined
        ? { ...n, constantValue: constantOverrides[n.id] }
        : n,
    );
  }, [diagram.nodes, constantOverrides]);
  const connections = diagram.connections;

  const { traceResult, pulse } = useScopeSimulation(
    nodes,
    connections,
    sensorValues,
    /* enabled */ true,
    loopPeriodMs,
    compoundTypes,
  );

  // Flash the pulse button + drive a real pulse through the simulation.
  const pulseSensor = (id: string) => {
    pulse(id, 100, pulseDurationMs);
    setPulsingId(id);
    window.setTimeout(() => {
      setPulsingId((cur) => (cur === id ? null : cur));
    }, pulseDurationMs);
  };

  return (
    <DiagramCanvas
      nodes={nodes}
      connections={connections}
      compoundTypes={compoundTypes}
      height={height}
      sensorValues={sensorValues}
      setSensor={setSensor}
      setConstant={setConstant}
      pulse={pulseSensor}
      pulsingId={pulsingId}
      pulseDurationMs={pulseDurationMs}
      traceResult={traceResult}
    />
  );
}

// ── Static SSR fallback (nodes + edges, no live values) ────────────────────

function StaticDiagram({
  diagram,
  height,
  pulseDurationMs,
}: {
  diagram: InteractiveDiagramProps['diagram'];
  height: number;
  pulseDurationMs: number;
}) {
  return (
    <DiagramCanvas
      nodes={diagram.nodes}
      connections={diagram.connections}
      compoundTypes={diagram.compoundTypes ?? []}
      height={height}
      sensorValues={{}}
      setSensor={NOOP}
      setConstant={NOOP}
      pulse={NOOP}
      pulsingId={null}
      pulseDurationMs={pulseDurationMs}
      traceResult={undefined}
    />
  );
}

export default function InteractiveDiagram({
  diagram,
  caption,
  height = 360,
  initialInputs = {},
  pulseDurationMs = 200,
}: InteractiveDiagramProps) {
  return (
    <figure className="id-figure">
      <BrowserOnly
        fallback={
          <StaticDiagram diagram={diagram} height={height} pulseDurationMs={pulseDurationMs} />
        }
      >
        {() => (
          <LiveDiagram
            diagram={diagram}
            height={height}
            initialInputs={initialInputs}
            pulseDurationMs={pulseDurationMs}
          />
        )}
      </BrowserOnly>
      {caption && <figcaption className="id-caption">{caption}</figcaption>}
    </figure>
  );
}
