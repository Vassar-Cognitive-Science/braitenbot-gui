import React, { useMemo } from 'react';
import './DiagramView.css';

type NodeKind = 'sensor' | 'compute' | 'output' | 'constant' | 'compound' | 'port';

type NodeTypeId =
  | 'sensor-analog'
  | 'sensor-digital'
  | 'sensor-color'
  | 'compute-threshold'
  | 'compute-delay'
  | 'compute-summation'
  | 'compute-multiply'
  | 'compute-oscillator'
  | 'compute-noise'
  | 'constant'
  | 'servo-cr'
  | 'servo-positional'
  | 'digital-out'
  | 'display-tm1637'
  | 'compound'
  | 'compound-input'
  | 'compound-output';

interface NodeTypeDef {
  kind: NodeKind;
  displayName: string;
  metaLabel: string;
  canOutput: boolean;
  canInput: boolean;
  outputPorts?: string[];
}

const NODE_TYPE_DEFS: Record<NodeTypeId, NodeTypeDef> = {
  'sensor-analog':     { kind: 'sensor',   displayName: 'Analog Sensor',    metaLabel: 'analog',           canOutput: true,  canInput: false },
  'sensor-digital':    { kind: 'sensor',   displayName: 'Digital Sensor',   metaLabel: 'digital',          canOutput: true,  canInput: false },
  'sensor-color':      { kind: 'sensor',   displayName: 'Color Sensor',     metaLabel: 'TCS34725',         canOutput: true,  canInput: false, outputPorts: ['clear', 'red', 'green', 'blue'] },
  'compute-threshold': { kind: 'compute',  displayName: 'Threshold',        metaLabel: 'threshold',        canOutput: true,  canInput: true },
  'compute-delay':     { kind: 'compute',  displayName: 'Delay',            metaLabel: 'delay',            canOutput: true,  canInput: true },
  'compute-summation': { kind: 'compute',  displayName: 'Summation',        metaLabel: 'sum',              canOutput: true,  canInput: true },
  'compute-multiply':  { kind: 'compute',  displayName: 'Multiply',         metaLabel: 'multiply',         canOutput: true,  canInput: true },
  'compute-oscillator':{ kind: 'compute',  displayName: 'Oscillator',       metaLabel: 'oscillator',       canOutput: true,  canInput: false },
  'compute-noise':     { kind: 'compute',  displayName: 'Noise',            metaLabel: 'noise',            canOutput: true,  canInput: false },
  'constant':          { kind: 'constant', displayName: 'Constant',         metaLabel: 'constant',         canOutput: true,  canInput: false },
  'servo-cr':          { kind: 'output',   displayName: 'Continuous Servo', metaLabel: 'continuous servo',  canOutput: false, canInput: true },
  'servo-positional':  { kind: 'output',   displayName: 'Positional Servo', metaLabel: 'positional servo', canOutput: false, canInput: true },
  'digital-out':       { kind: 'output',   displayName: 'Digital Output',   metaLabel: 'digital out',      canOutput: false, canInput: true },
  'display-tm1637':    { kind: 'output',   displayName: '7-Segment Display',metaLabel: 'TM1637 4-digit',   canOutput: false, canInput: true },
  'compound':          { kind: 'compound', displayName: 'Compound',         metaLabel: 'compound',         canOutput: true,  canInput: true },
  'compound-input':    { kind: 'port',     displayName: 'Compound Input',   metaLabel: 'input port',       canOutput: true,  canInput: false },
  'compound-output':   { kind: 'port',     displayName: 'Compound Output',  metaLabel: 'output port',      canOutput: false, canInput: true },
};

export interface DiagramNode {
  id: string;
  type: NodeTypeId;
  label: string;
  x: number;
  y: number;
  meta?: string;
}

export interface DiagramConnection {
  from: string;
  to: string;
  fromPort?: string;
  toPort?: string;
  weight: number;
  label?: string;
}

export interface RobotOverlay {
  x: number;
  y: number;
  radius: number;
}

export interface DiagramViewProps {
  nodes: DiagramNode[];
  connections: DiagramConnection[];
  robot?: RobotOverlay;
  width?: number;
  height?: number;
  caption?: string;
}

const NODE_W = 148;
const NODE_H = 64;

function weightToColor(weight: number): string {
  if (weight >= 0) {
    const t = weight;
    const r = Math.round(70 + 10 * (1 - t));
    const g = Math.round(80 + 90 * t);
    const b = Math.round(50 + 20 * (1 - t));
    return `rgb(${r},${g},${b})`;
  } else {
    const t = -weight;
    const r = Math.round(90 + 110 * t);
    const g = Math.round(80 * (1 - t));
    const b = Math.round(50 * (1 - t));
    return `rgb(${r},${g},${b})`;
  }
}

function makePath(x1: number, y1: number, x2: number, y2: number): string {
  const c1 = y1 + 60;
  const c2 = y2 - 60;
  return `M ${x1} ${y1} C ${x1} ${c1}, ${x2} ${c2}, ${x2} ${y2}`;
}

function portOffsetX(ports: string[] | undefined, portId?: string): number {
  if (!ports || ports.length === 0) return NODE_W / 2;
  const idx = portId ? ports.indexOf(portId) : -1;
  const i = idx >= 0 ? idx : 0;
  return ((i + 0.5) / ports.length) * NODE_W;
}

export default function DiagramView({
  nodes,
  connections,
  robot,
  width,
  height: heightProp,
  caption,
}: DiagramViewProps) {
  const nodeMap = useMemo(
    () => Object.fromEntries(nodes.map((n) => [n.id, n])),
    [nodes],
  );

  const bounds = useMemo(() => {
    if (nodes.length === 0) return { minX: 0, minY: 0, maxX: 400, maxY: 300 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + NODE_W);
      maxY = Math.max(maxY, n.y + NODE_H);
    }
    if (robot) {
      minX = Math.min(minX, robot.x - robot.radius);
      minY = Math.min(minY, robot.y - robot.radius);
      maxX = Math.max(maxX, robot.x + robot.radius);
      maxY = Math.max(maxY, robot.y + robot.radius);
    }
    return { minX, minY, maxX, maxY };
  }, [nodes, robot]);

  const pad = 40;
  const contentW = bounds.maxX - bounds.minX + pad * 2;
  const contentH = bounds.maxY - bounds.minY + pad * 2;
  const canvasW = width ?? contentW;
  const canvasH = heightProp ?? contentH;
  const scale = Math.min(1, canvasW / contentW, canvasH / contentH);
  const offsetX = -bounds.minX + pad + (canvasW / scale - contentW) / 2;
  const offsetY = -bounds.minY + pad + (canvasH / scale - contentH) / 2;

  const paths = useMemo(() => {
    return connections.map((conn, i) => {
      const fromNode = nodeMap[conn.from];
      const toNode = nodeMap[conn.to];
      if (!fromNode || !toNode) return null;

      const fromDef = NODE_TYPE_DEFS[fromNode.type];
      const x1 = fromNode.x + portOffsetX(fromDef?.outputPorts, conn.fromPort);
      const y1 = fromNode.y + NODE_H;
      const x2 = toNode.x + NODE_W / 2;
      const y2 = toNode.y;

      return {
        key: `${conn.from}-${conn.to}-${i}`,
        d: makePath(x1, y1, x2, y2),
        weight: conn.weight,
        label: conn.label ?? `w ${conn.weight.toFixed(2)}`,
        midX: (x1 + x2) / 2,
        midY: (y1 + y2) / 2,
      };
    }).filter(Boolean);
  }, [connections, nodeMap]);

  return (
    <figure className="dv-figure">
      <div
        className="dv-canvas"
        style={{ width: canvasW, height: canvasH }}
      >
        <div
          className="dv-world"
          style={{
            transform: `scale(${scale})`,
            transformOrigin: '0 0',
          }}
        >
          {/* Robot overlay */}
          {robot && (
            <>
              <div
                className="dv-robot-body"
                style={{
                  left: robot.x + offsetX,
                  top: robot.y + offsetY,
                  width: robot.radius * 2,
                  height: robot.radius * 2,
                }}
              />
              <div
                className="dv-robot-wheel"
                style={{
                  left: robot.x + offsetX - robot.radius,
                  top: robot.y + offsetY,
                  width: robot.radius * 0.18 * 2,
                  height: robot.radius * 0.55 * 2,
                }}
              />
              <div
                className="dv-robot-wheel"
                style={{
                  left: robot.x + offsetX + robot.radius,
                  top: robot.y + offsetY,
                  width: robot.radius * 0.18 * 2,
                  height: robot.radius * 0.55 * 2,
                }}
              />
            </>
          )}

          {/* Connections (SVG) */}
          <svg className="dv-links">
            {paths.map((p) => (
              <path
                key={p.key}
                d={p.d}
                style={{ stroke: weightToColor(p.weight) }}
                transform={`translate(${offsetX}, ${offsetY})`}
              />
            ))}
          </svg>

          {/* Weight badges */}
          {paths.map((p) => (
            <span
              key={`badge-${p.key}`}
              className="dv-weight-badge"
              style={{
                left: p.midX + offsetX,
                top: p.midY + offsetY,
              }}
            >
              {p.label}
            </span>
          ))}

          {/* Nodes */}
          {nodes.map((node) => {
            const def = NODE_TYPE_DEFS[node.type];
            if (!def) return null;
            const kindClass = def.kind === 'constant' ? 'dv-node-constant' : `dv-node-${def.kind}`;
            const meta = node.meta ?? def.metaLabel;
            return (
              <div
                key={node.id}
                className={`dv-node ${kindClass}`}
                style={{ left: node.x + offsetX, top: node.y + offsetY }}
              >
                <div className="dv-node-label">{node.label}</div>
                <div className="dv-node-meta">{meta}</div>

                {def.canOutput && !def.outputPorts && (
                  <span className="dv-handle dv-output-handle" />
                )}
                {def.canOutput && def.outputPorts && (
                  <>
                    {def.outputPorts.map((port, i) => (
                      <span
                        key={port}
                        className={`dv-handle dv-output-handle dv-output-port dv-output-${port}`}
                        style={{ left: `${((i + 0.5) / def.outputPorts!.length) * 100}%` }}
                      />
                    ))}
                  </>
                )}
                {def.canInput && (
                  <span className="dv-handle dv-input-handle" />
                )}
              </div>
            );
          })}
        </div>
      </div>
      {caption && <figcaption className="dv-caption">{caption}</figcaption>}
    </figure>
  );
}
