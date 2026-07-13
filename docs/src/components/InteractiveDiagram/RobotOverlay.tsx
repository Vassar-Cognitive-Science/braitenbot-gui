import React from 'react';
import type { DiagramNode } from '@app/types/diagram';
import { NODE_H, NODE_W } from '@app/components/connectionGeometry';
import { wheelArrowGeometry } from '@app/components/wheelArrow';

/**
 * A top-down robot chassis drawn behind the wheel nodes, mirroring the desktop
 * app's robot overlay so the embedded diagrams read as a little vehicle rather
 * than free-floating boxes. Rendered when the diagram has at least two
 * continuous-servo wheel nodes; the body spans between the outermost two, with
 * each wheel node sitting on a wheel. In trace mode each wheel also grows the
 * shared drive arrow (forward/reverse, scaled by the motor value).
 *
 * Coordinates are world px — this renders inside the scaled `.id-world`, so the
 * parent transform handles zoom.
 */
interface RobotOverlayProps {
  nodes: DiagramNode[];
  /** Same node→world mapping the canvas uses (applies the epoch offset). */
  worldPos: (n: DiagramNode) => { x: number; y: number };
  traceMode: boolean;
  traceResult?: { nodeValues: Record<string, number> };
}

export function RobotOverlay({ nodes, worldPos, traceMode, traceResult }: RobotOverlayProps) {
  const wheels = nodes.filter((n) => n.type === 'servo-cr');
  if (wheels.length < 2) return null;

  const center = (n: DiagramNode) => {
    const w = worldPos(n);
    return { cx: w.x + NODE_W / 2, cy: w.y + NODE_H / 2 };
  };
  const centers = wheels.map(center);
  const xs = centers.map((c) => c.cx);
  const leftCx = Math.min(...xs);
  const rightCx = Math.max(...xs);
  const bodyCx = (leftCx + rightCx) / 2;
  const bodyCy = centers.reduce((s, c) => s + c.cy, 0) / centers.length;
  const bodyRadius = Math.max(60, (rightCx - leftCx) / 2);
  const wheelWidth = bodyRadius * 0.18;
  const wheelHeight = bodyRadius * 0.55;

  return (
    <div className="id-robot" aria-hidden="true">
      <div
        className="id-robot-body"
        style={{ left: bodyCx, top: bodyCy, width: bodyRadius * 2, height: bodyRadius * 2 }}
      />
      {centers.map((c, i) => (
        <div
          key={`wheel-${i}`}
          className="id-robot-wheel"
          style={{ left: c.cx, top: c.cy, width: wheelWidth, height: wheelHeight }}
        />
      ))}
      {traceMode &&
        wheels.map((n) => {
          const raw = traceResult?.nodeValues[n.id];
          if (raw === undefined) return null;
          const g = wheelArrowGeometry(raw, 1);
          if (!g) return null;
          const { cx, cy } = center(n);
          return (
            <svg
              key={`${n.id}-drive`}
              className={`id-wheel-arrow ${g.forward ? 'forward' : 'reverse'}`}
              style={{ left: cx - g.svgHalfW, top: cy - g.reach, width: g.svgHalfW * 2, height: g.reach * 2 }}
            >
              <line x1={g.cx} y1={g.base} x2={g.cx} y2={g.shaftEndY} strokeWidth={g.strokeW} />
              <polygon
                points={`${g.cx},${g.tipY} ${g.cx - g.headHalf},${g.shaftEndY} ${g.cx + g.headHalf},${g.shaftEndY}`}
              />
            </svg>
          );
        })}
    </div>
  );
}
