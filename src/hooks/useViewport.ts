import { useCallback, useEffect, useReducer } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';

export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 3;
export const ZOOM_STEP = 1.25;

function clampZoom(z: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}

interface Point {
  x: number;
  y: number;
}

interface ViewportState {
  zoom: number;
  pan: Point;
}

type ViewportAction =
  | { type: 'zoomAtPoint'; nextZoom: number; screenX: number; screenY: number }
  | { type: 'reset' }
  | { type: 'setPan'; value: SetStateAction<Point> };

const INITIAL_VIEWPORT: ViewportState = { zoom: 1, pan: { x: 0, y: 0 } };

// Zoom and pan move together as a single pure transition. Folding pan into the
// zoom update (rather than nesting a setPan inside a setZoom updater) keeps the
// reducer pure, so React StrictMode's double-invocation in dev can't drift the
// ctrl+wheel zoom anchor.
function viewportReducer(state: ViewportState, action: ViewportAction): ViewportState {
  switch (action.type) {
    case 'zoomAtPoint': {
      const clamped = clampZoom(action.nextZoom);
      if (clamped === state.zoom) return state;
      const worldX = (action.screenX - state.pan.x) / state.zoom;
      const worldY = (action.screenY - state.pan.y) / state.zoom;
      return {
        zoom: clamped,
        pan: { x: action.screenX - worldX * clamped, y: action.screenY - worldY * clamped },
      };
    }
    case 'reset':
      return INITIAL_VIEWPORT;
    case 'setPan': {
      const next =
        typeof action.value === 'function'
          ? (action.value as (prev: Point) => Point)(state.pan)
          : action.value;
      if (next === state.pan) return state;
      return { ...state, pan: next };
    }
  }
}

export interface Viewport {
  zoom: number;
  pan: Point;
  setPan: Dispatch<SetStateAction<Point>>;
  zoomAtPoint: (nextZoom: number, screenX: number, screenY: number) => void;
  resetView: () => void;
  zoomByStep: (factor: number) => void;
}

export function useViewport(canvasRef: RefObject<HTMLDivElement | null>): Viewport {
  const [state, dispatch] = useReducer(viewportReducer, INITIAL_VIEWPORT);
  const { zoom, pan } = state;

  const zoomAtPoint = useCallback((nextZoom: number, screenX: number, screenY: number) => {
    dispatch({ type: 'zoomAtPoint', nextZoom, screenX, screenY });
  }, []);

  const resetView = useCallback(() => {
    dispatch({ type: 'reset' });
  }, []);

  const setPan = useCallback<Dispatch<SetStateAction<Point>>>((value) => {
    dispatch({ type: 'setPan', value });
  }, []);

  const zoomByStep = useCallback(
    (factor: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      zoomAtPoint(zoom * factor, rect.width / 2, rect.height / 2);
    },
    [zoom, zoomAtPoint, canvasRef],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      // Let the config panel scroll its own overflow; don't hijack the wheel
      // to pan/zoom the canvas when the pointer is over it.
      if ((event.target as Element | null)?.closest('.diagram-config-panel')) return;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const cursorX = event.clientX - rect.left;
        const cursorY = event.clientY - rect.top;
        zoomAtPoint(zoom * Math.exp(-event.deltaY * 0.0015), cursorX, cursorY);
      } else {
        event.preventDefault();
        setPan((p) => ({ x: p.x - event.deltaX, y: p.y - event.deltaY }));
      }
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [zoom, zoomAtPoint, setPan, canvasRef]);

  return { zoom, pan, setPan, zoomAtPoint, resetView, zoomByStep };
}
