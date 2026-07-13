import type { MouseEvent, PointerEvent, ReactNode } from 'react';
import { formatTraceValue } from '../hooks/useTraceSimulation';
import type { ConnectionPathDatum } from './connectionGeometry';
import { signalToStroke, weightToColor } from './connectionGeometry';
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
  selectedConnectionId?: string | null;
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
  selectedConnectionId,
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
                className={`connection-link ${selectedConnectionId === connection.id ? 'selected' : ''}`}
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

      {paths.map((connection) => {
        const edgeSignal = edgeSignals?.[connection.id];
        return (
          <button
            key={`${connection.id}-config`}
            className={`connection-config-trigger ${selectedConnectionId === connection.id ? 'selected' : ''} ${edgeSignal !== undefined ? 'trace-signal' : ''} ${draggingBadgeId === connection.id ? 'dragging' : ''} ${edgeSignal === undefined && connection.transferMode === 'nonlinear' ? 'has-curve' : ''}`}
            style={{ left: `${connection.midX}px`, top: `${connection.midY}px` }}
            onMouseDown={(event: MouseEvent) => event.stopPropagation()}
            onPointerDown={onBadgePointerDown
              ? (event) => onBadgePointerDown(event, connection)
              : undefined}
            onClick={onBadgeClick ? () => onBadgeClick(connection.id) : undefined}
          >
            {edgeSignal !== undefined
              ? formatTraceValue(edgeSignal)
              : connection.transferMode === 'nonlinear'
                ? <MiniTransferCurve points={connection.transferPoints} />
                : `w ${connection.weight.toFixed(2)}`}
          </button>
        );
      })}
    </>
  );
}
