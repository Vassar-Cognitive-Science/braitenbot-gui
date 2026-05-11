import { describe, it, expect } from 'vitest';
import type { DiagramNode, DiagramConnection } from '../../types/diagram';
import { validateGraph } from '../validate';

function makeSensor(overrides: Partial<DiagramNode> = {}): DiagramNode {
  return {
    id: 'sensor-1',
    type: 'sensor-analog',
    label: 'Sensor 1',
    x: 0,
    y: 0,
    arduinoPort: 'A0',
    ...overrides,
  };
}

function makeMotor(overrides: Partial<DiagramNode> = {}): DiagramNode {
  return {
    id: 'motor-left',
    type: 'servo-cr',
    label: 'Left Wheel',
    x: 0,
    y: 0,
    servoPin: '9',
    ...overrides,
  };
}

function makeConnection(overrides: Partial<DiagramConnection> = {}): DiagramConnection {
  return {
    id: 'conn-1',
    from: 'sensor-1',
    to: 'motor-left',
    weight: 1,
    transferMode: 'linear',
    transferPoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    ...overrides,
  };
}

describe('validateGraph', () => {
  it('returns no errors for a valid simple graph', () => {
    const nodes = [makeSensor(), makeMotor()];
    const connections = [makeConnection()];
    const errors = validateGraph(nodes, connections);
    expect(errors.filter((e) => e.severity === 'error')).toHaveLength(0);
  });

  it('reports missing sensor nodes', () => {
    const nodes = [makeMotor()];
    const errors = validateGraph(nodes, []);
    expect(errors.some((e) => e.message.includes('no source nodes'))).toBe(true);
  });

  it('reports sensor missing arduino port', () => {
    const nodes = [makeSensor({ arduinoPort: '' }), makeMotor()];
    const connections = [makeConnection()];
    const errors = validateGraph(nodes, connections);
    expect(errors.some((e) => e.message.includes('no Arduino port'))).toBe(true);
  });

  it('reports actuator missing pins', () => {
    const nodes = [makeSensor(), makeMotor({ servoPin: '' })];
    const connections = [makeConnection()];
    const errors = validateGraph(nodes, connections);
    expect(errors.some((e) => e.message.includes('no pin configured'))).toBe(true);
  });

  it('reports unreachable actuator', () => {
    const nodes = [
      makeSensor(),
      makeMotor(),
      makeMotor({ id: 'motor-right', label: 'Right Wheel' }),
    ];
    const connections = [makeConnection()]; // only connects to motor-left
    const errors = validateGraph(nodes, connections);
    expect(errors.some((e) => e.message.includes('Right Wheel') && e.message.includes('not connected'))).toBe(true);
  });

  it('rejects pin strings that are not plain pin references', () => {
    const nodes = [makeSensor({ arduinoPort: '13); evil()' }), makeMotor()];
    const connections = [makeConnection()];
    const errors = validateGraph(nodes, connections);
    expect(errors.some((e) => e.message.includes('invalid Arduino port'))).toBe(true);
  });

  it('accepts numeric and analog pin strings', () => {
    for (const port of ['0', '13', 'A0', 'A6']) {
      const nodes = [makeSensor({ arduinoPort: port }), makeMotor()];
      const errors = validateGraph(nodes, [makeConnection()]);
      expect(
        errors.some((e) => e.message.includes('invalid Arduino port')),
        `port "${port}" rejected unexpectedly`,
      ).toBe(false);
    }
  });

  it('warns on edges with unknown fromPort', () => {
    const colorSensor: DiagramNode = {
      id: 'color-1',
      type: 'sensor-color',
      label: 'Front Color',
      x: 0,
      y: 0,
    };
    const connections: DiagramConnection[] = [
      {
        id: 'conn-1',
        from: 'color-1',
        fromPort: 'ultraviolet' as unknown as 'clear',
        to: 'motor-left',
        weight: 1,
        transferMode: 'linear',
        transferPoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      },
    ];
    const errors = validateGraph([colorSensor, makeMotor()], connections);
    expect(
      errors.some(
        (e) => e.severity === 'warning' && e.message.includes("unknown output port 'ultraviolet'"),
      ),
    ).toBe(true);
  });

  it('reports orphan compute node as warning', () => {
    const compute: DiagramNode = {
      id: 'thresh-1',
      type: 'compute-threshold',
      label: 'Threshold 1',
      x: 0,
      y: 0,
      threshold: 512,
    };
    const nodes = [makeSensor(), compute, makeMotor()];
    const connections = [makeConnection()]; // compute not connected
    const errors = validateGraph(nodes, connections);
    const orphanWarning = errors.find(
      (e) => e.severity === 'warning' && e.message.includes('not connected'),
    );
    expect(orphanWarning).toBeDefined();
  });

});
