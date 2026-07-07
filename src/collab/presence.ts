// Presence (awareness) types + deterministic color assignment, shared by the
// SessionManager (publishes/derives awareness), the ShareMenu (participant
// swatches) and the diagram view (remote outlines, cursors, follow-the-host).

export interface Point {
  x: number;
  y: number;
}

/** A peer mid-drag: the node it holds and where (world coords). */
export interface DragPresence {
  nodeId: string;
  x: number;
  y: number;
}

/** The host's viewport, published for follow-the-host. */
export interface ViewportPresence {
  pan: Point;
  zoom: number;
}

/**
 * One client's full awareness state. `user` is stable per session;
 * selection/editingContext/dragging/cursor change as the person works. Only
 * the host publishes `viewport` (guests leave it null).
 */
export interface LocalPresence {
  user: { id: string; name: string; color: string; isHost: boolean };
  selection: string[];
  editingContext: string | null;
  dragging: DragPresence | null;
  cursor: Point | null;
  viewport: ViewportPresence | null;
}

/** A remote peer's presence, as consumed by the diagram view. */
export interface PeerPresence {
  clientId: number;
  id: string;
  name: string;
  color: string;
  isHost: boolean;
  selection: string[];
  editingContext: string | null;
  dragging: DragPresence | null;
  cursor: Point | null;
  viewport: ViewportPresence | null;
}

/** Stable empty snapshot so `getPresence` returns a constant when idle. */
export const EMPTY_PRESENCE: PeerPresence[] = [];

// A curated set of ~8 hues that stay distinguishable on the dark theme.
// Classroom-scale collisions (two people, same color) are acceptable.
const PRESENCE_PALETTE = [
  '#e0913a', // amber
  '#4aa3d5', // sky
  '#c86fd8', // orchid
  '#e05a6d', // coral
  '#57b894', // teal
  '#d9c04a', // gold
  '#8a7ff0', // periwinkle
  '#4ec9b0', // aqua
];

/**
 * Deterministically map a participant id (or fallback string) to a palette
 * color, so every client colors a given peer identically without coordination.
 */
export function presenceColor(id: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  }
  return PRESENCE_PALETTE[(h >>> 0) % PRESENCE_PALETTE.length];
}
