import { useCallback, useMemo, useRef, useState } from 'react';
import type { Dispatch, MouseEvent, PointerEvent, SetStateAction } from 'react';
import type {
  CompoundTypeDefinition,
  DiagramConnection,
  DiagramNode,
  OutputPortId,
} from '../types/diagram';
import { TYPE_BY_ID, getInputPorts, getOutputPorts } from '../types/diagram';
import { canInput, canOutput, isWheelNode } from './diagramShared';
import type { ConfigTarget } from './diagramShared';
import { formatTraceValue } from '../hooks/useTraceSimulation';
import { DiagramNodeView } from './DiagramNodeView';
import { ConnectionLayer } from './ConnectionLayer';
import {
  NODE_H,
  computeConnectionPaths,
  makePath,
  nearestTOnCurve,
  portOffsetX,
} from './connectionGeometry';

/**
 * State-agnostic diagram canvas: the world-layer contents shared by the desktop
 * editor and the docs site. It renders the {@link ConnectionLayer} (plus the
 * in-flight draft link) and the {@link DiagramNodeView} loop (with the trace
 * prop extraction that used to be duplicated in both places), and owns the
 * pointer-based editing interactions — node dragging, link creation and weight-
 * badge dragging. Selection is controlled by the host (`selectedNodeIds` /
 * `configTarget`); Delete/Backspace deletion stays in the host's global keydown
 * handler, which already knows the selected target and its delete mutations.
 *
 * It owns NO document state: nodes/connections/compoundTypes arrive as props and
 * every mutation is emitted through a callback. The host wires those callbacks
 * to whatever backing store it uses (the app's Yjs DiagramStore, or plain docs
 * useState). Editing is fully optional — omit a mutation callback and that
 * interaction is disabled, so a view-only embed omits them all and the canvas
 * behaves as a read-only trace view.
 *
 * Coordinate systems are supplied by the host so the same interaction math works
 * under the app's pan/zoom/wheel-anchoring and the docs' fit-to-width scaling:
 *   - `nodeWorldPos(node)` → the node's position in render (world-div) px.
 *   - `clientToWorld(clientX, clientY)` → unscaled world coords (for node moves,
 *     matching `node.x`/`node.y`).
 *   - `clientToLayer(clientX, clientY)` → render (world-div) px (link draft
 *     endpoint + badge projection), the same space `nodeWorldPos` renders into.
 */
export interface DiagramCanvasProps {
  nodes: DiagramNode[];
  connections: DiagramConnection[];
  compoundTypes: CompoundTypeDefinition[];
  /** Block-size scale baked into connection geometry (app view preference; docs pass 1). */
  blockScale?: number;

  // ── coordinate resolvers (see the interface doc comment) ────────────────
  nodeWorldPos: (node: DiagramNode) => { x: number; y: number };
  /** Required for node dragging (`onNodeMove`); a read-only view can omit it. */
  clientToWorld?: (clientX: number, clientY: number) => { x: number; y: number };
  /** Required for link creation and badge dragging; a read-only view can omit it. */
  clientToLayer?: (clientX: number, clientY: number) => { x: number; y: number };

  // ── trace-mode passthrough (rendered, never owned here) ─────────────────
  traceMode: boolean;
  traceResult?: {
    nodeValues: Record<string, number>;
    edgeSignals: Record<string, number>;
    disconnected: Set<string>;
  };
  /** Sensor slider/toggle inputs, keyed nodeId or `${id}:${channel}`. */
  sensorValues: Record<string, number>;
  setSensorValue: (key: string, value: number) => void;
  setConstantValue: (id: string, value: number) => void;
  pulseSensor: (id: string) => void;
  pulsingId: string | null;
  pulseDurationMs: number;
  /** View-only role: disable every trace input (slider/toggle/pulse). */
  readOnly?: boolean;

  // ── selection (controlled by the host) ──────────────────────────────────
  selectedNodeIds: Set<string>;
  setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
  configTarget: ConfigTarget | null;
  setConfigTarget: Dispatch<SetStateAction<ConfigTarget | null>>;

  // ── editing callbacks (omit → that interaction is disabled) ─────────────
  /** Continuous node move (world coords). Omit to disable node dragging. */
  onNodeMove?: (id: string, x: number, y: number) => void;
  /** First actual movement of a drag — the app captures one undo snapshot here. */
  onNodeDragStart?: (id: string) => void;
  /** Drag ended (pointer up). */
  onNodeDragEnd?: (id: string) => void;
  /** Create a connection. Omit to disable link drawing. */
  onConnectionCreate?: (edge: {
    from: string;
    fromPort?: OutputPortId;
    to: string;
    toPort?: string;
  }) => void;
  /** A link drag ended on a target that can't accept it (app shows a toast). */
  onConnectionRejected?: (reason: {
    toId: string;
    fromId: string;
    fromPort?: OutputPortId;
  }) => void;
  /** Reposition a connection's weight badge along its curve. Omit to disable. */
  onConnectionLabelT?: (id: string, labelT: number) => void;
  /** Double-click a compound instance to enter its body. */
  onEnterCompound?: (compoundTypeId: string) => void;
  /** A link draft started (true) or ended (false) — app toggles `.linking` chrome. */
  onLinkDraftChange?: (active: boolean) => void;

  // ── presence / collab passthrough (app only) ────────────────────────────
  /** Peer selection/drag highlight, per node/connection id. */
  remoteHighlight?: ReadonlyMap<string, { color: string; name: string }>;
  /** Fired on every world-space pointer move during a drag (app publishes cursor presence). */
  onPointerWorldMove?: (world: { x: number; y: number }, draggingNodeId: string | null) => void;
}

const EMPTY_HIGHLIGHT: ReadonlyMap<string, { color: string; name: string }> = new Map();
const NOOP_ENTER = () => {};

export function DiagramCanvas({
  nodes,
  connections,
  compoundTypes,
  blockScale = 1,
  nodeWorldPos,
  clientToWorld,
  clientToLayer,
  traceMode,
  traceResult,
  sensorValues,
  setSensorValue,
  setConstantValue,
  pulseSensor,
  pulsingId,
  pulseDurationMs,
  readOnly = false,
  selectedNodeIds,
  setSelectedNodeIds,
  configTarget,
  setConfigTarget,
  onNodeMove,
  onNodeDragStart,
  onNodeDragEnd,
  onConnectionCreate,
  onConnectionRejected,
  onConnectionLabelT,
  onEnterCompound,
  onLinkDraftChange,
  remoteHighlight = EMPTY_HIGHLIGHT,
  onPointerWorldMove,
}: DiagramCanvasProps) {
  const nodeMap = useMemo(
    () => Object.fromEntries(nodes.map((n) => [n.id, n])) as Record<string, DiagramNode>,
    [nodes],
  );

  // Transient interaction UI state. This is view state, not document state:
  // the in-flight link draft (source + rubber-band endpoint, in layer px) and
  // the connection whose badge is being dragged (for the grabbing cursor).
  const [linkDraft, setLinkDraft] = useState<{ id: string; port?: OutputPortId } | null>(null);
  const [draftPoint, setDraftPoint] = useState({ x: 0, y: 0 });
  const [draggingBadgeId, setDraggingBadgeId] = useState<string | null>(null);

  // Live volatile values mirrored into a ref, so the drag / link handlers below
  // stay referentially stable (empty deps) and don't bust DiagramNodeView's
  // memo during a drag, when nodeMap / connections change every frame. Handlers
  // read at call time (after commit), so values are always current.
  const stateRef = useRef({
    nodeMap,
    connections,
    compoundTypes,
    blockScale,
    clientToWorld,
    clientToLayer,
    nodeWorldPos,
    onNodeMove,
    onNodeDragStart,
    onNodeDragEnd,
    onConnectionCreate,
    onConnectionRejected,
    onConnectionLabelT,
    onLinkDraftChange,
    onPointerWorldMove,
  });
  // eslint-disable-next-line react-hooks/refs
  stateRef.current = {
    nodeMap,
    connections,
    compoundTypes,
    blockScale,
    clientToWorld,
    clientToLayer,
    nodeWorldPos,
    onNodeMove,
    onNodeDragStart,
    onNodeDragEnd,
    onConnectionCreate,
    onConnectionRejected,
    onConnectionLabelT,
    onLinkDraftChange,
    onPointerWorldMove,
  };

  // The active link draft is mirrored into a ref so completeLink (a stable
  // callback that fires on the input handle's mouseup) reads the value set by
  // this same interaction, not a possibly-stale render's.
  const linkDraftRef = useRef<{ id: string; port?: OutputPortId } | null>(null);
  // Set true when a badge drag crosses the threshold, so the trailing click on
  // pointer-up doesn't also open the connection config.
  const badgeClickSuppressRef = useRef(false);

  // ── node dragging ───────────────────────────────────────────────────────

  const beginNodeDrag = useCallback((event: MouseEvent, nodeId: string) => {
    if (event.button !== 0) return;
    if (isWheelNode(nodeId)) return;
    const s0 = stateRef.current;
    if (!s0.onNodeMove || !s0.clientToWorld) return;
    const node = s0.nodeMap[nodeId];
    if (!node) return;
    // Grab offset within the node, in world coords: clientToWorld is affine,
    // so `world − offset` tracks the cursor exactly under any pan/zoom/scale.
    const grab = s0.clientToWorld(event.clientX, event.clientY);
    const offsetX = grab.x - node.x;
    const offsetY = grab.y - node.y;
    let started = false;
    const move = (e: globalThis.MouseEvent) => {
      const s = stateRef.current;
      if (!s.clientToWorld) return;
      const world = s.clientToWorld(e.clientX, e.clientY);
      // Defer onNodeDragStart to the first actual movement, so a bare click
      // (mousedown without a drag) doesn't spam the host's undo stack.
      if (!started) {
        started = true;
        s.onNodeDragStart?.(nodeId);
      }
      s.onNodeMove?.(nodeId, world.x - offsetX, world.y - offsetY);
      s.onPointerWorldMove?.(world, nodeId);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      stateRef.current.onNodeDragEnd?.(nodeId);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, []);

  // ── link creation ───────────────────────────────────────────────────────

  const beginLinkDrag = useCallback((event: MouseEvent, nodeId: string, port?: OutputPortId) => {
    event.stopPropagation();
    const s0 = stateRef.current;
    if (!s0.onConnectionCreate || !s0.clientToLayer) return;
    const draft = { id: nodeId, port };
    linkDraftRef.current = draft;
    setLinkDraft(draft);
    setDraftPoint(s0.clientToLayer(event.clientX, event.clientY));
    s0.onLinkDraftChange?.(true);
    const move = (e: globalThis.MouseEvent) => {
      if (!linkDraftRef.current) return;
      const s = stateRef.current;
      if (!s.clientToLayer) return;
      setDraftPoint(s.clientToLayer(e.clientX, e.clientY));
      if (s.clientToWorld) {
        s.onPointerWorldMove?.(s.clientToWorld(e.clientX, e.clientY), null);
      }
    };
    // completeLink (the input handle's mouseup) runs before this window-level
    // mouseup and nulls the draft, so this only cancels an unfinished draft.
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      if (linkDraftRef.current) {
        linkDraftRef.current = null;
        setLinkDraft(null);
        stateRef.current.onLinkDraftChange?.(false);
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, []);

  const canConnect = useCallback((fromId: string, toId: string, fromPort?: OutputPortId): boolean => {
    if (fromId === toId) return false;
    const { nodeMap, connections } = stateRef.current;
    const from = nodeMap[fromId];
    const to = nodeMap[toId];
    if (!from || !to) return false;
    const fromType = TYPE_BY_ID[from.type];
    const toType = TYPE_BY_ID[to.type];
    if (!canOutput(fromType) || !canInput(toType)) return false;
    if (
      connections.some(
        (connection) =>
          connection.from === fromId &&
          connection.to === toId &&
          (connection.fromPort ?? undefined) === fromPort,
      )
    )
      return false;
    if (toType.maxInputs !== undefined) {
      const existing = connections.filter((c) => c.to === toId).length;
      if (existing >= toType.maxInputs) return false;
    }
    return true;
  }, []);

  const completeLink = useCallback(
    (toId: string, toPort?: string) => {
      const s = stateRef.current;
      const draft = linkDraftRef.current;
      if (!draft) return;
      // Null the draft so the window mouseup that follows becomes a no-op and
      // unbinds its own listeners.
      linkDraftRef.current = null;
      setLinkDraft(null);
      s.onLinkDraftChange?.(false);
      if (!canConnect(draft.id, toId, draft.port)) {
        s.onConnectionRejected?.({ toId, fromId: draft.id, fromPort: draft.port });
        return;
      }
      const { id: fromId, port: fromPort } = draft;
      s.onConnectionCreate?.({
        from: fromId,
        ...(fromPort ? { fromPort } : {}),
        to: toId,
        ...(toPort ? { toPort } : {}),
      });
    },
    [canConnect],
  );

  // ── weight-badge dragging ────────────────────────────────────────────────

  const beginBadgeDrag = useCallback(
    (
      event: PointerEvent<HTMLButtonElement>,
      conn: { id: string; x1: number; y1: number; x2: number; y2: number },
    ) => {
      event.stopPropagation();
      if (event.button !== 0) return;
      const s = stateRef.current;
      if (!s.onConnectionLabelT || !s.clientToLayer) return;
      const target = event.currentTarget;
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      let dragged = false;
      target.setPointerCapture(pointerId);

      const move = (e: globalThis.PointerEvent) => {
        if (!dragged && Math.hypot(e.clientX - startX, e.clientY - startY) < 4) return;
        if (!dragged) {
          dragged = true;
          badgeClickSuppressRef.current = true;
          setDraggingBadgeId(conn.id);
        }
        const toLayer = stateRef.current.clientToLayer;
        if (!toLayer) return;
        const p = toLayer(e.clientX, e.clientY);
        const t = nearestTOnCurve(conn.x1, conn.y1, conn.x2, conn.y2, p.x, p.y);
        stateRef.current.onConnectionLabelT?.(conn.id, t);
      };
      const up = () => {
        target.releasePointerCapture(pointerId);
        target.removeEventListener('pointermove', move);
        target.removeEventListener('pointerup', up);
        setDraggingBadgeId(null);
      };
      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', up);
    },
    [],
  );

  // ── render ────────────────────────────────────────────────────────────────

  const selectedConnectionId = configTarget?.kind === 'connection' ? configTarget.id : null;

  const connectionPaths = useMemo(
    () => computeConnectionPaths(connections, (id) => nodeMap[id], nodeWorldPos, compoundTypes, blockScale),
    [connections, nodeMap, nodeWorldPos, compoundTypes, blockScale],
  );

  const draftSrc = linkDraft ? nodeMap[linkDraft.id] : undefined;

  return (
    <>
      <ConnectionLayer
        paths={connectionPaths}
        edgeSignals={traceMode ? traceResult?.edgeSignals : undefined}
        selectedConnectionId={selectedConnectionId}
        remoteHighlight={remoteHighlight}
        draggingBadgeId={draggingBadgeId}
        onBadgePointerDown={onConnectionLabelT ? beginBadgeDrag : undefined}
        onBadgeClick={(connectionId) => {
          // A drag just ended: swallow the trailing click so it doesn't also
          // open the config panel.
          if (badgeClickSuppressRef.current) {
            badgeClickSuppressRef.current = false;
            return;
          }
          setConfigTarget({ kind: 'connection', id: connectionId });
        }}
        svgChildren={
          draftSrc &&
          (() => {
            const srcWorld = nodeWorldPos(draftSrc);
            return (
              <path
                className="draft-link"
                d={makePath(
                  srcWorld.x + portOffsetX(draftSrc, linkDraft!.port, compoundTypes, blockScale),
                  srcWorld.y + NODE_H * blockScale,
                  draftPoint.x,
                  draftPoint.y,
                )}
              />
            );
          })()
        }
      />

      {nodes.map((node) => {
        const worldPos = nodeWorldPos(node);
        const remote = remoteHighlight.get(node.id);
        const nodeType = TYPE_BY_ID[node.type];
        const isCompound = node.type === 'compound';
        const rawTraceValue = traceMode ? traceResult?.nodeValues[node.id] : undefined;
        const outputPorts =
          traceMode && traceResult && canOutput(nodeType)
            ? getOutputPorts(nodeType.id, node, compoundTypes)
            : undefined;
        const outputPortValues =
          outputPorts && outputPorts.length > 0
            ? outputPorts
                .map((port) => {
                  const v =
                    traceResult!.nodeValues[isCompound ? `${node.id}/${port}` : `${node.id}:${port}`];
                  return v === undefined ? '' : formatTraceValue(v);
                })
                .join(',')
            : undefined;
        const inputPorts =
          traceMode && traceResult && isCompound
            ? getInputPorts(nodeType.id, node, compoundTypes)
            : undefined;
        const inputPortValues =
          inputPorts && inputPorts.length > 0
            ? inputPorts
                .map((port) => {
                  const v = traceResult!.nodeValues[`${node.id}/${port}`];
                  return v === undefined ? '' : formatTraceValue(v);
                })
                .join(',')
            : undefined;
        const colorSensorValues =
          traceMode && node.type === 'sensor-color'
            ? getOutputPorts('sensor-color')!
                .map((ch) => sensorValues[`${node.id}:${ch}`] ?? 0)
                .join(',')
            : undefined;
        return (
          <DiagramNodeView
            key={node.id}
            node={node}
            worldX={worldPos.x}
            worldY={worldPos.y}
            isSelected={configTarget?.kind === 'node' && configTarget.id === node.id}
            isMultiSelected={selectedNodeIds.has(node.id)}
            traceMode={traceMode}
            traceValue={rawTraceValue !== undefined ? formatTraceValue(rawTraceValue) : undefined}
            isDisconnected={traceMode && (traceResult?.disconnected.has(node.id) ?? false)}
            outputPortValues={outputPortValues}
            inputPortValues={inputPortValues}
            compoundTypes={compoundTypes}
            sensorValue={sensorValues[node.id]}
            colorSensorValues={colorSensorValues}
            isPulsing={pulsingId === node.id}
            pulseDurationMs={pulseDurationMs}
            beginNodeDrag={beginNodeDrag}
            beginLinkDrag={beginLinkDrag}
            completeLink={completeLink}
            enterCompound={onEnterCompound ?? NOOP_ENTER}
            pulseSensor={pulseSensor}
            setSelectedNodeIds={setSelectedNodeIds}
            setConfigTarget={setConfigTarget}
            setSensorValue={setSensorValue}
            setConstantValue={setConstantValue}
            readOnly={readOnly}
            remoteColor={remote?.color}
            remoteLabel={remote?.name}
          />
        );
      })}
    </>
  );
}
