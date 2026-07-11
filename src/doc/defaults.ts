import type { DiagramNode } from '../types/diagram';
import type { DiagramState } from '../lib/diagramFile';

// The two wheel motors that always exist at the top level. Positions are
// placeholders: motors render at the robot-overlay wheel geometry (see
// nodeWorldPos), and the ResizeObserver layout pass snaps their stored x/y on
// mount — so the initial coordinates here are never shown.
export function defaultMotorNodes(): DiagramNode[] {
  return [
    { id: 'motor-left', type: 'servo-cr', label: 'Left Wheel', x: 0, y: 0, servoPin: '5' },
    { id: 'motor-right', type: 'servo-cr', label: 'Right Wheel', x: 0, y: 0, servoPin: '6' },
  ];
}

export function defaultDiagram(): DiagramState {
  return {
    nodes: defaultMotorNodes(),
    connections: [],
    loopPeriodMs: 20,
    compoundTypes: [],
    comments: [],
  };
}
