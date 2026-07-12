import type { DiagramConnection, DiagramNode } from '../types/diagram';
import type { DiagramState } from '../lib/diagramFile';
import { parse } from '../lib/diagramFile';

/**
 * Starter diagrams the docs playground can load by name (`?preset=<key>`). Each
 * is a self-contained {@link DiagramState}, so an `<EditorEmbed preset="…">`
 * drops the reader straight into a wired vehicle they can poke at. The two wheel
 * motors (`motor-left` / `motor-right`) must always be present — the robot
 * overlay snaps them to the wheels and the editor treats them as fixtures.
 */

// Approximate world positions; the robot overlay re-snaps the wheels on mount,
// so these only matter for the split-second before the first layout pass.
const LEFT_WHEEL_X = 812;
const RIGHT_WHEEL_X = 1036;
const WHEEL_Y = 556;
const SENSOR_Y = 250;

function wheels(): DiagramNode[] {
  return [
    { id: 'motor-left', type: 'servo-cr', label: 'Left Wheel', x: LEFT_WHEEL_X, y: WHEEL_Y, arduinoPort: '5' },
    { id: 'motor-right', type: 'servo-cr', label: 'Right Wheel', x: RIGHT_WHEEL_X, y: WHEEL_Y, arduinoPort: '6' },
  ];
}

function photocell(side: 'left' | 'right'): DiagramNode {
  const isLeft = side === 'left';
  return {
    id: isLeft ? 'sensor-left' : 'sensor-right',
    type: 'sensor-analog',
    label: isLeft ? 'Left Photocell' : 'Right Photocell',
    x: isLeft ? 720 : 1128,
    y: SENSOR_Y,
    arduinoPort: isLeft ? 'A0' : 'A1',
    invert: true,
  };
}

// A plain weighted edge (linear transfer, the editor's default).
function link(from: string, to: string, weight: number): DiagramConnection {
  return {
    id: `${from}__${to}`,
    from,
    to,
    weight,
    transferMode: 'linear',
    transferPoints: [],
  };
}

/** Just the robot and its two wheels — an empty canvas to build on. */
function blank(): DiagramState {
  return { nodes: wheels(), connections: [], loopPeriodMs: 20, compoundTypes: [], comments: [] };
}

// Two photocells feeding the two wheels, wired straight vs. crossed. These are
// the canonical Braitenberg vehicles 2a/2b and the inhibitory 3a.
function twoSensorVehicle(cross: boolean, weight: number): DiagramState {
  const left = photocell('left');
  const right = photocell('right');
  const leftTarget = cross ? 'motor-right' : 'motor-left';
  const rightTarget = cross ? 'motor-left' : 'motor-right';
  return {
    nodes: [...wheels(), left, right],
    connections: [link(left.id, leftTarget, weight), link(right.id, rightTarget, weight)],
    loopPeriodMs: 20,
    compoundTypes: [],
    comments: [],
  };
}

const PRESETS: Record<string, () => DiagramState> = {
  // Empty robot — drag nodes from the palette.
  blank,
  // Vehicle 2a "fear/coward": same-side excitatory. More light on one side
  // speeds that side's wheel, steering away from the light.
  coward: () => twoSensorVehicle(false, 1),
  // Vehicle 2b "aggression": crossed excitatory. Turns toward the light and
  // charges it.
  aggressor: () => twoSensorVehicle(true, 1),
  // Vehicle 3a "love": crossed inhibitory. Slows as it nears the light and
  // settles facing it.
  love: () => twoSensorVehicle(true, -1),
};

/**
 * Resolve a playground diagram from URL params. Prefers an inline `diagram`
 * (URL-encoded JSON), then a named `preset`, then a blank canvas.
 */
export function resolvePreset(params: URLSearchParams): DiagramState {
  const inline = params.get('diagram');
  if (inline) {
    try {
      // parse() returns the validated file shape (a superset of DiagramState).
      const file = parse(decodeURIComponent(inline));
      return {
        nodes: file.nodes,
        connections: file.connections,
        loopPeriodMs: file.loopPeriodMs ?? 20,
        compoundTypes: file.compoundTypes ?? [],
        comments: file.comments ?? [],
      };
    } catch (err) {
      console.warn('[playground] failed to parse inline diagram, falling back to blank:', err);
      return blank();
    }
  }
  const key = params.get('preset');
  const make = key ? PRESETS[key] : undefined;
  return (make ?? blank)();
}

export const PRESET_KEYS = Object.keys(PRESETS);
