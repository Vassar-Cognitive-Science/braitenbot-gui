import type { MouseEvent, PointerEvent, ReactNode } from 'react';
import { formatTraceValue } from '../hooks/useTraceSimulation';
import type { ConnectionPathDatum } from './connectionGeometry';
import { signalToStroke, weightLinePoints, weightToColor } from './connectionGeometry';
import { MiniTransferCurve } from './MiniTransferCurve';

/**
 * Presentational connection layer: the `.diagram-links` SVG (one bézier path
 * per connection, trace-stroked when edge signals are present) plus the
 * weight/signal badge buttons. Extracted from BraitenbergDiagram so the docs
 * site renders connections through the exact same component; all editing
 * interactions arrive via optional callbacks, so a read-only embed simply
 * omits them.
 */
export interface ConnectionLayerProps {
  paths: ConnectionPathDatum[];
  /** Per-edge trace signals; undefined when trace mode is off. */
  edgeSignals?: Record<string, number>;
  /** Per-edge raw source values (before weight/curve); undefined off-trace.
   *  Only consulted when `advancedWeightViz` is on. */
  edgeInputs?: Record<string, number>;
  /** When true, trace badges show the full `input × weight = output` (or, for
   *  curve edges, `input → output`) calculation instead of just the output. */
  advancedWeightViz?: boolean;
  selectedConnectionId?: string | null;
  /** Connections incident to a selected node — drawn emphasized so they're
   *  easy to trace. `null` when nothing is selected. */
  emphasizedConnectionIds?: ReadonlySet<string> | null;
  /** Dashed overlays for wire spans hidden behind opaque node boxes, drawn on
   *  a layer above the nodes so they stay visible. */
  occludedPaths?: Array<{ id: string; d: string }>;
  /** Peer-selection highlight per connection id (collab sessions). */
  remoteHighlight?: ReadonlyMap<string, { color: string }>;
  /** Connection whose badge is currently being dragged along its curve. */
  draggingBadgeId?: string | null;
  /** Begin a badge drag (app: repositions labelT along the curve). */
  onBadgePointerDown?: (event: PointerEvent<HTMLButtonElement>, conn: ConnectionPathDatum) => void;
  /** Badge clicked (app: opens the connection config panel). */
  onBadgeClick?: (connectionId: string) => void;
  /** Extra SVG children rendered above the connection paths (draft link). */
  svgChildren?: ReactNode;
}

export function ConnectionLayer({
  paths,
  edgeSignals,
  edgeInputs,
  advancedWeightViz,
  selectedConnectionId,
  emphasizedConnectionIds,
  occludedPaths,
  remoteHighlight,
  draggingBadgeId,
  onBadgePointerDown,
  onBadgeClick,
  svgChildren,
}: ConnectionLayerProps) {
  return (
    <>
      <svg className="diagram-links" aria-hidden="true">
        {paths.map((connection) => {
          const edgeSignal = edgeSignals?.[connection.id];
          const stroke = edgeSignal !== undefined ? signalToStroke(edgeSignal) : null;
          const remote = remoteHighlight?.get(connection.id);
          const emphasized = emphasizedConnectionIds?.has(connection.id) ?? false;
          const dimmed = emphasizedConnectionIds != null && !emphasized;
          return (
            <g key={connection.id}>
              {remote && (
                <path
                  className="connection-remote-select"
                  d={connection.d}
                  style={{ stroke: remote.color }}
                />
              )}
              <path
                className={`connection-link ${selectedConnectionId === connection.id ? 'selected' : ''} ${emphasized ? 'emphasized' : ''} ${dimmed ? 'dimmed' : ''}`}
                d={connection.d}
                style={stroke
                  ? { stroke: stroke.color, strokeWidth: stroke.width, opacity: stroke.opacity }
                  : { stroke: weightToColor(connection.weight) }
                }
              />
            </g>
          );
        })}
        {svgChildren}
      </svg>

      {/* Dashed overlays for spans hidden behind opaque nodes, above the node
          layer so an occluded wire stays traceable. */}
      {occludedPaths && occludedPaths.length > 0 && (
        <svg className="diagram-links-occluded" aria-hidden="true">
          {occludedPaths.map(({ id, d }, i) => (
            <path
              key={`${id}-occ-${i}`}
              className={`connection-occluded ${emphasizedConnectionIds?.has(id) ? 'emphasized' : ''}`}
              d={d}
            />
          ))}
        </svg>
      )}

      {paths.map((connection) => {
        const edgeSignal = edgeSignals?.[connection.id];
        const isCurve = connection.transferMode === 'nonlinear';
        const inTrace = edgeSignal !== undefined;
        // Advanced calc badge: shown only in trace, only when the setting is on,
        // and only once we actually have an input value for this edge.
        const edgeInput = edgeInputs?.[connection.id];
        const showCalc = inTrace && advancedWeightViz && edgeInput !== undefined;
        const badgeEmphasized = emphasizedConnectionIds?.has(connection.id) ?? false;
        const badgeDimmed = emphasizedConnectionIds != null && !badgeEmphasized;
        return (
          <button
            key={`${connection.id}-config`}
            className={`connection-config-trigger ${selectedConnectionId === connection.id ? 'selected' : ''} ${inTrace ? 'trace-signal' : ''} ${draggingBadgeId === connection.id ? 'dragging' : ''} ${!inTrace ? 'has-curve' : ''} ${showCalc ? 'advanced-weight' : ''} ${badgeEmphasized ? 'emphasized' : ''} ${badgeDimmed ? 'dimmed' : ''}`}
            style={{ left: `${connection.midX}px`, top: `${connection.midY}px` }}
            onMouseDown={(event: MouseEvent) => event.stopPropagation()}
            onPointerDown={onBadgePointerDown
              ? (event) => onBadgePointerDown(event, connection)
              : undefined}
            onClick={onBadgeClick ? () => onBadgeClick(connection.id) : undefined}
          >
            {inTrace ? (
              // Trace mode shows the live signal. The curve/weight badge is a
              // design-time affordance, so it's replaced by the value while
              // simulating (matching how plain weights behave). With advanced
              // weight visualization on, spell out the whole calculation.
              showCalc ? (
                isCurve ? (
                  <span className="badge-calc">
                    {formatTraceValue(edgeInput)} <span className="badge-calc-op">↝</span>{' '}
                    {formatTraceValue(edgeSignal)}
                  </span>
                ) : (
                  <span className="badge-calc">
                    {formatTraceValue(edgeInput)} <span className="badge-calc-op">×</span>{' '}
                    {connection.weight.toFixed(2)} <span className="badge-calc-op">=</span>{' '}
                    {formatTraceValue(edgeSignal)}
                  </span>
                )
              ) : (
                formatTraceValue(edgeSignal)
              )
            ) : (
              // Design mode: every edge shows its transfer graph — a curve for
              // non-linear edges, a line through the origin (slope = weight) for
              // plain weights — so the two read as the same kind of thing.
              <MiniTransferCurve
                points={isCurve ? connection.transferPoints : weightLinePoints(connection.weight)}
                weight={isCurve ? undefined : connection.weight}
              />
            )}
          </button>
        );
      })}
    </>
  );
}
