import { describe, expect, it } from 'vitest';
import { prepareQuickUpload } from '../quickUpload';
import { serialize, type DiagramState } from '../diagramFile';

function lessonCircuit(overrides: Partial<DiagramState> = {}): DiagramState {
  return {
    nodes: [
      { id: 'sensor-1', type: 'sensor-analog', label: 'Light', x: 0, y: 0, arduinoPort: 'A0' },
      { id: 'motor-left', type: 'servo-cr', label: 'Left Wheel', x: 100, y: 0, servoPin: '9' },
    ],
    connections: [
      {
        id: 'link-1',
        from: 'sensor-1',
        to: 'motor-left',
        weight: 1,
        transferMode: 'linear',
        transferPoints: [
          { x: -100, y: -100 },
          { x: 100, y: 100 },
        ],
      },
    ],
    loopPeriodMs: 20,
    capWeights: true,
    pulseDurationMs: 200,
    compoundTypes: [],
    comments: [],
    ...overrides,
  };
}

describe('prepareQuickUpload', () => {
  it('generates a sketch for a valid lesson circuit', () => {
    const prep = prepareQuickUpload(serialize(lessonCircuit()));
    expect(prep.kind).toBe('ready');
    if (prep.kind !== 'ready') return;
    expect(prep.code).toContain('void setup()');
    expect(prep.code).toContain('void loop()');
  });

  it('reports blocking validation errors instead of generating code', () => {
    // A sensor with no port configured is a codegen-blocking error.
    const circuit = lessonCircuit();
    delete circuit.nodes[0].arduinoPort;
    const prep = prepareQuickUpload(serialize(circuit));
    expect(prep.kind).toBe('invalid');
    if (prep.kind !== 'invalid') return;
    expect(prep.errors.length).toBeGreaterThan(0);
    expect(prep.errors.every((e) => e.severity === 'error')).toBe(true);
    expect(prep.errors.some((e) => e.message.includes('Arduino port'))).toBe(true);
  });

  it('reports a parse error for a malformed payload', () => {
    const prep = prepareQuickUpload('not a diagram');
    expect(prep.kind).toBe('parse-error');
    if (prep.kind !== 'parse-error') return;
    expect(prep.message).toContain('JSON');
  });
});
