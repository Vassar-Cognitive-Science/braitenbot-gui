import { describe, it, expect } from 'vitest';
import type {
  CompoundTypeDefinition,
  DiagramNode,
  DiagramConnection,
} from '../../types/diagram';
import { validateGraph } from '../validate';
import { buildGraph } from '../graph';
import { generateSketch } from '../emitter';

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

  it('reports unreachable actuator as a non-blocking warning', () => {
    const nodes = [
      makeSensor(),
      makeMotor(),
      makeMotor({ id: 'motor-right', label: 'Right Wheel' }),
    ];
    const connections = [makeConnection()]; // only connects to motor-left
    const errors = validateGraph(nodes, connections);
    // An unconnected output is allowed (e.g. testing the display with the
    // wheels unsignaled) — surfaced as a warning so it never blocks the build.
    const unreachable = errors.find(
      (e) => e.message.includes('Right Wheel') && e.message.includes('no signal reaching it'),
    );
    expect(unreachable).toBeDefined();
    expect(unreachable?.severity).toBe('warning');
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

  it('rejects digital pin 0 or 1 (reserved by Serial)', () => {
    for (const pin of ['0', '1']) {
      const nodes: DiagramNode[] = [
        makeSensor({
          id: 'dig-1',
          type: 'sensor-digital',
          label: 'Bumper',
          arduinoPort: pin,
        }),
        makeMotor(),
      ];
      const errors = validateGraph(nodes, [
        makeConnection({ from: 'dig-1' }),
      ]);
      expect(
        errors.some(
          (e) => e.severity === 'error' && e.message.includes('reserved by Serial'),
        ),
        `pin ${pin} should have been flagged`,
      ).toBe(true);
    }
  });

  it('allows analog pin "0" because it maps to A0, not the Serial RX pin', () => {
    const nodes = [makeSensor({ arduinoPort: '0' }), makeMotor()];
    const errors = validateGraph(nodes, [makeConnection()]);
    expect(errors.some((e) => e.message.includes('reserved by Serial'))).toBe(false);
  });

  it('flags servo and TM1637 pin fields on pins 0/1 too', () => {
    const display: DiagramNode = {
      id: 'disp-1', type: 'display-tm1637', label: 'Display',
      x: 0, y: 0, clkPin: '0', gpioPin: '7',
    };
    const nodes = [makeSensor(), makeMotor({ servoPin: '1' }), display];
    const errors = validateGraph(nodes, [makeConnection()]);
    const serialErrors = errors.filter((e) => e.message.includes('reserved by Serial'));
    expect(serialErrors.some((e) => e.message.includes('Left Wheel'))).toBe(true);
    expect(serialErrors.some((e) => e.message.includes('Display'))).toBe(true);
  });

  it('rejects digital pin 13 (built-in LED)', () => {
    const display: DiagramNode = {
      id: 'disp-1', type: 'display-tm1637', label: 'Display',
      x: 0, y: 0, clkPin: '13', gpioPin: '12',
    };
    const nodes = [makeSensor(), makeMotor({ servoPin: '13' }), display];
    const errors = validateGraph(nodes, [makeConnection()]);
    const ledErrors = errors.filter(
      (e) => e.severity === 'error' && e.message.includes('built-in LED'),
    );
    expect(ledErrors.some((e) => e.message.includes('Left Wheel'))).toBe(true);
    expect(ledErrors.some((e) => e.message.includes('Display'))).toBe(true);
  });

  it('allows analog pin "13" because A13 is not the LED pin', () => {
    const nodes = [makeSensor({ arduinoPort: '13' }), makeMotor()];
    const errors = validateGraph(nodes, [makeConnection()]);
    expect(errors.some((e) => e.message.includes('built-in LED'))).toBe(false);
  });

  it('flags an analog sensor on A4 when a color sensor is present (I2C SDA conflict)', () => {
    const colorSensor: DiagramNode = {
      id: 'color-1', type: 'sensor-color', label: 'Front Color', x: 0, y: 0,
    };
    const nodes = [makeSensor({ arduinoPort: 'A4' }), colorSensor, makeMotor()];
    const errors = validateGraph(nodes, [makeConnection()]);
    const conflict = errors.find(
      (e) => e.severity === 'error' && e.message.includes('I2C SDA'),
    );
    expect(conflict).toBeDefined();
    expect(conflict?.message).toContain('Sensor 1');
    expect(conflict?.message).toContain('A4');
  });

  it('does NOT flag A4 when there is no I2C node in the graph', () => {
    const nodes = [makeSensor({ arduinoPort: 'A4' }), makeMotor()];
    const errors = validateGraph(nodes, [makeConnection()]);
    expect(errors.some((e) => e.message.includes('I2C SDA'))).toBe(false);
  });

  it('flags an analog sensor on A5 when a color sensor is present (I2C SCL conflict)', () => {
    const colorSensor: DiagramNode = {
      id: 'color-1', type: 'sensor-color', label: 'Front Color', x: 0, y: 0,
    };
    const nodes = [makeSensor({ arduinoPort: 'A5' }), colorSensor, makeMotor()];
    const errors = validateGraph(nodes, [makeConnection()]);
    const conflict = errors.find(
      (e) => e.severity === 'error' && e.message.includes('I2C SCL'),
    );
    expect(conflict).toBeDefined();
    expect(conflict?.message).toContain('A5');
  });

  it('flags the A4/A5 conflict for a ToF sensor too', () => {
    const tof: DiagramNode = {
      id: 'tof-1', type: 'sensor-tof', label: 'Distance', x: 0, y: 0, xshutPin: '7',
    };
    const nodes = [makeSensor({ arduinoPort: 'A4' }), tof, makeMotor()];
    const errors = validateGraph(nodes, [makeConnection()]);
    expect(
      errors.some((e) => e.severity === 'error' && e.message.includes('I2C SDA')),
    ).toBe(true);
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

  it('reports compound instance referencing unknown type', () => {
    const nodes: DiagramNode[] = [
      makeSensor(),
      {
        id: 'inst-1', type: 'compound', compoundTypeId: 'does-not-exist',
        label: 'Mystery', x: 0, y: 0,
      },
      makeMotor(),
    ];
    const errors = validateGraph(nodes, []);
    expect(
      errors.some(
        (e) => e.severity === 'error' && e.message.includes("unknown type 'does-not-exist'"),
      ),
    ).toBe(true);
  });

  it('reports compound-touching edge with no port specified', () => {
    const typeDef = {
      id: 'pass',
      displayName: 'Pass',
      body: {
        nodes: [
          { id: 'in', type: 'compound-input' as const, label: 'in', x: 0, y: 0 },
          { id: 'out', type: 'compound-output' as const, label: 'out', x: 0, y: 0 },
        ],
        connections: [],
      },
    };
    const nodes: DiagramNode[] = [
      makeSensor(),
      {
        id: 'inst-1', type: 'compound', compoundTypeId: 'pass',
        label: 'Pass', x: 0, y: 0,
      },
    ];
    const connections: DiagramConnection[] = [
      // Missing toPort — would silently drop at flatten time without this rule.
      {
        id: 'c1', from: 'sensor-1', to: 'inst-1', weight: 1,
        transferMode: 'linear',
        transferPoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      },
    ];
    const errors = validateGraph(nodes, connections, [typeDef]);
    expect(
      errors.some((e) => e.severity === 'error' && e.message.includes('must specify which input port')),
    ).toBe(true);
  });

  it('detects compound-type recursion', () => {
    const a = {
      id: 'A', displayName: 'A',
      body: {
        nodes: [
          { id: 'inner', type: 'compound' as const, compoundTypeId: 'B', label: 'B', x: 0, y: 0 },
        ],
        connections: [],
      },
    };
    const b = {
      id: 'B', displayName: 'B',
      body: {
        nodes: [
          { id: 'inner', type: 'compound' as const, compoundTypeId: 'A', label: 'A', x: 0, y: 0 },
        ],
        connections: [],
      },
    };
    const errors = validateGraph([], [], [a, b]);
    expect(
      errors.some((e) => e.severity === 'error' && e.message.includes('Compound type recursion')),
    ).toBe(true);
  });

  it('allows compound instances of the same type to share a label', () => {
    const typeDef = {
      id: 'pass',
      displayName: 'Pass',
      body: {
        nodes: [
          { id: 'in', type: 'compound-input' as const, label: 'in', x: 0, y: 0 },
          { id: 'out', type: 'compound-output' as const, label: 'out', x: 0, y: 0 },
        ],
        connections: [],
      },
    };
    const nodes: DiagramNode[] = [
      makeSensor(),
      {
        id: 'inst-1', type: 'compound', compoundTypeId: 'pass',
        label: 'Pass', x: 0, y: 0,
      },
      {
        id: 'inst-2', type: 'compound', compoundTypeId: 'pass',
        label: 'Pass', x: 100, y: 0,
      },
      makeMotor(),
    ];
    const connections = [
      makeConnection({ id: 'c1', from: 'sensor-1', to: 'inst-1', toPort: 'in' }),
      makeConnection({ id: 'c2', from: 'inst-1', to: 'motor-left', fromPort: 'out' }),
    ];
    const errors = validateGraph(nodes, connections, [typeDef]);
    expect(errors.some((e) => e.message.includes('Duplicate'))).toBe(false);
  });

  it('reports duplicate labels between non-compound nodes as a non-blocking warning', () => {
    const nodes = [
      makeSensor({ id: 'sensor-1', label: 'Foo' }),
      makeSensor({ id: 'sensor-2', label: 'Foo', arduinoPort: 'A1' }),
      makeMotor(),
    ];
    const errors = validateGraph(nodes, []);
    expect(
      errors.filter((e) => e.severity === 'warning' && e.message.includes('Duplicate')),
    ).toHaveLength(2);
    // The emitter suffixes duplicate labels, so this must never block upload.
    expect(
      errors.some((e) => e.severity === 'error' && e.message.includes('Duplicate')),
    ).toBe(false);
  });

  // --- Dangling edges (C6) ---------------------------------------------------

  it('reports a connection that references a deleted/unknown node', () => {
    const nodes = [makeSensor(), makeMotor()];
    const connections = [
      makeConnection(),
      makeConnection({ id: 'dangling', from: 'ghost-node', to: 'motor-left' }),
    ];
    const errors = validateGraph(nodes, connections);
    expect(
      errors.some(
        (e) => e.severity === 'error' && e.message.includes('deleted or unknown node'),
      ),
    ).toBe(true);
  });

  it('does not throw from codegen when an edge has an unknown endpoint', () => {
    const nodes = [makeSensor(), makeMotor()];
    const connections = [
      makeConnection(),
      makeConnection({ id: 'dangling-from', from: 'ghost', to: 'motor-left' }),
      makeConnection({ id: 'dangling-to', from: 'sensor-1', to: 'phantom' }),
    ];
    expect(() => generateSketch(buildGraph(nodes, connections))).not.toThrow();
  });

  // --- Duplicate pins (C8) ---------------------------------------------------

  it('flags two nodes claiming the same digital pin', () => {
    const nodes = [
      makeSensor(),
      makeMotor({ id: 'motor-left', label: 'Left Wheel', servoPin: '9' }),
      makeMotor({ id: 'motor-right', label: 'Right Wheel', servoPin: '9' }),
    ];
    const connections = [
      makeConnection({ id: 'c1', to: 'motor-left' }),
      makeConnection({ id: 'c2', to: 'motor-right' }),
    ];
    const errors = validateGraph(nodes, connections);
    const conflict = errors.find(
      (e) => e.severity === 'error' && e.message.includes('Pin conflict') && e.message.includes('pin 9'),
    );
    expect(conflict).toBeDefined();
    expect(conflict!.message).toContain('Left Wheel');
    expect(conflict!.message).toContain('Right Wheel');
  });

  it('flags a pin shared across different field types (servo vs display CLK)', () => {
    const display: DiagramNode = {
      id: 'disp-1', type: 'display-tm1637', label: 'Display',
      x: 0, y: 0, clkPin: '9', gpioPin: '7',
    };
    const nodes = [makeSensor(), makeMotor({ servoPin: '9' }), display];
    const errors = validateGraph(nodes, [makeConnection()]);
    expect(
      errors.some(
        (e) => e.severity === 'error' && e.message.includes('Pin conflict') &&
          e.message.includes('Left Wheel') && e.message.includes('Display'),
      ),
    ).toBe(true);
  });

  it('does not flag an analog pin against the same-numbered digital pin', () => {
    // Analog sensor on A0 (i.e. "0" on an analog field) and a servo on digital 0.
    const nodes = [
      makeSensor({ arduinoPort: '0' }),
      makeMotor({ servoPin: '0' }),
    ];
    const errors = validateGraph(nodes, [makeConnection()]);
    expect(errors.some((e) => e.message.includes('Pin conflict'))).toBe(false);
  });

  it('flags a display whose CLK and DIO pins are the same', () => {
    const display: DiagramNode = {
      id: 'disp-1', type: 'display-tm1637', label: 'Display',
      x: 0, y: 0, clkPin: '5', gpioPin: '5',
    };
    const nodes = [makeSensor(), makeMotor(), display];
    const errors = validateGraph(nodes, [makeConnection()]);
    expect(
      errors.some(
        (e) => e.severity === 'error' && e.message.includes('Display') &&
          e.message.includes('CLK pin') && e.message.includes('GPIO pin'),
      ),
    ).toBe(true);
  });

  // --- Compound-body per-node checks (C9) ------------------------------------

  it('catches a missing pin inside a compound body', () => {
    const amp: CompoundTypeDefinition = {
      id: 'amp',
      displayName: 'Amp',
      body: {
        nodes: [
          // Inner analog sensor with no arduinoPort configured.
          { id: 'inner', type: 'sensor-analog', label: 'Inner', x: 0, y: 0 },
          { id: 'out', type: 'compound-output', label: 'out', x: 0, y: 0 },
        ],
        connections: [
          makeConnection({ id: 'b1', from: 'inner', to: 'out' }),
        ],
      },
    };
    const nodes: DiagramNode[] = [
      { id: 'inst-1', type: 'compound', compoundTypeId: 'amp', label: 'Amp', x: 0, y: 0 },
      makeMotor(),
    ];
    const connections = [
      makeConnection({ id: 'e1', from: 'inst-1', to: 'motor-left', fromPort: 'out' }),
    ];
    const errors = validateGraph(nodes, connections, [amp]);
    expect(
      errors.some(
        (e) => e.severity === 'error' && e.message.includes('no Arduino port') &&
          e.message.includes('Amp ▸ Inner'),
      ),
    ).toBe(true);
  });

  it('catches a reserved (LED) pin inside a compound body', () => {
    const amp: CompoundTypeDefinition = {
      id: 'amp',
      displayName: 'Amp',
      body: {
        nodes: [
          { id: 'in', type: 'compound-input', label: 'in', x: 0, y: 0 },
          // Inner servo wired to pin 13 (built-in LED).
          { id: 'buzzer', type: 'servo-cr', label: 'Buzzer', x: 0, y: 0, servoPin: '13' },
        ],
        connections: [
          makeConnection({ id: 'b1', from: 'in', to: 'buzzer' }),
        ],
      },
    };
    const nodes: DiagramNode[] = [
      makeSensor(),
      { id: 'inst-1', type: 'compound', compoundTypeId: 'amp', label: 'Amp', x: 0, y: 0 },
    ];
    const connections = [
      makeConnection({ id: 'e1', from: 'sensor-1', to: 'inst-1', toPort: 'in' }),
    ];
    const errors = validateGraph(nodes, connections, [amp]);
    expect(
      errors.some(
        (e) => e.severity === 'error' && e.message.includes('built-in LED') &&
          e.message.includes('Amp ▸ Buzzer'),
      ),
    ).toBe(true);
  });

  // --- Structural checks on the flattened graph (C10) ------------------------

  it('does not falsely report "no source" / "unreachable" for a compound-provided source', () => {
    // A compound whose body is an oscillator feeding an output port is a
    // legitimate source, even though the top level has no sensor.
    const oscSrc: CompoundTypeDefinition = {
      id: 'osc-src',
      displayName: 'Oscillator Source',
      body: {
        nodes: [
          { id: 'osc', type: 'compute-oscillator', label: 'Osc', x: 0, y: 0, frequencyHz: 1, amplitude: 100 },
          { id: 'out', type: 'compound-output', label: 'out', x: 0, y: 0 },
        ],
        connections: [
          makeConnection({ id: 'b1', from: 'osc', to: 'out' }),
        ],
      },
    };
    const nodes: DiagramNode[] = [
      { id: 'inst-1', type: 'compound', compoundTypeId: 'osc-src', label: 'Clock', x: 0, y: 0 },
      makeMotor(),
    ];
    const connections = [
      makeConnection({ id: 'e1', from: 'inst-1', to: 'motor-left', fromPort: 'out' }),
    ];
    const errors = validateGraph(nodes, connections, [oscSrc]);
    expect(errors.some((e) => e.message.includes('no source nodes'))).toBe(false);
    expect(errors.some((e) => e.message.includes('no signal reaching it'))).toBe(false);
    expect(errors.filter((e) => e.severity === 'error')).toHaveLength(0);
  });

  it('does not falsely report a cycle broken by a delay inside a compound body', () => {
    // A delay inside the compound breaks the feedback loop; on the unflattened
    // graph the compound instance looks like a plain cycle participant.
    const del: CompoundTypeDefinition = {
      id: 'del',
      displayName: 'Delay',
      body: {
        nodes: [
          { id: 'in', type: 'compound-input', label: 'in', x: 0, y: 0 },
          { id: 'd', type: 'compute-delay', label: 'D', x: 0, y: 0, delayMs: 100 },
          { id: 'out', type: 'compound-output', label: 'out', x: 0, y: 0 },
        ],
        connections: [
          makeConnection({ id: 'b1', from: 'in', to: 'd' }),
          makeConnection({ id: 'b2', from: 'd', to: 'out' }),
        ],
      },
    };
    const sum: DiagramNode = { id: 'sum-1', type: 'compute-summation', label: 'Sum', x: 0, y: 0 };
    const nodes: DiagramNode[] = [
      makeSensor(),
      sum,
      { id: 'inst-1', type: 'compound', compoundTypeId: 'del', label: 'Feedback', x: 0, y: 0 },
      makeMotor(),
    ];
    const connections = [
      makeConnection({ id: 'e1', from: 'sensor-1', to: 'sum-1' }),
      makeConnection({ id: 'e2', from: 'sum-1', to: 'motor-left' }),
      makeConnection({ id: 'e3', from: 'sum-1', to: 'inst-1', toPort: 'in' }),
      makeConnection({ id: 'e4', from: 'inst-1', to: 'sum-1', fromPort: 'out' }),
    ];
    const errors = validateGraph(nodes, connections, [del]);
    expect(errors.some((e) => e.message.includes('Cycle detected'))).toBe(false);
    expect(errors.filter((e) => e.severity === 'error')).toHaveLength(0);
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
      (e) => e.severity === 'warning' && e.message.includes('needs an'),
    );
    expect(orphanWarning).toBeDefined();
  });

  describe('pulse capture pin support', () => {
    function makePulseSensor(overrides: Partial<DiagramNode> = {}): DiagramNode {
      return makeSensor({
        id: 'dig-1',
        type: 'sensor-digital',
        label: 'Mic',
        arduinoPort: '4',
        pulseCapture: true,
        ...overrides,
      });
    }

    it('warns when pulse capture is on a pin with no UNO R4 interrupt', () => {
      // Pin 4 has no IRQ channel on the R4; works on classic AVR only.
      const nodes = [makePulseSensor(), makeMotor()];
      const errors = validateGraph(nodes, [makeConnection({ from: 'dig-1' })]);
      const warning = errors.find(
        (e) => e.severity === 'warning' && e.message.includes('cannot attach an interrupt'),
      );
      expect(warning).toBeDefined();
      expect(warning?.nodeId).toBe('dig-1');
    });

    it('treats digital aliases 14–19 as the A-bank pins (14 = A0 → warn)', () => {
      const nodes = [makePulseSensor({ arduinoPort: '14' }), makeMotor()];
      const errors = validateGraph(nodes, [makeConnection({ from: 'dig-1' })]);
      expect(errors.some((e) => e.message.includes('cannot attach an interrupt'))).toBe(true);
    });

    it('does not warn on interrupt-capable pins (2, A1, alias 15)', () => {
      for (const pin of ['2', 'A1', '15']) {
        const nodes = [makePulseSensor({ arduinoPort: pin }), makeMotor()];
        const errors = validateGraph(nodes, [makeConnection({ from: 'dig-1' })]);
        expect(errors.filter((e) => e.message.includes('cannot attach an interrupt'))).toHaveLength(0);
      }
    });

    it('does not warn when pulse capture is off', () => {
      const nodes = [makePulseSensor({ pulseCapture: false }), makeMotor()];
      const errors = validateGraph(nodes, [makeConnection({ from: 'dig-1' })]);
      expect(errors.filter((e) => e.message.includes('interrupt'))).toHaveLength(0);
    });

    it('warns when two pulse-capture sensors share a UNO R4 interrupt channel', () => {
      // Pin 3 and A4 both map to IRQ channel 1 on the R4 Minima.
      const nodes = [
        makePulseSensor({ id: 'dig-1', label: 'Mic', arduinoPort: '3' }),
        makePulseSensor({ id: 'dig-2', label: 'Clap', arduinoPort: 'A4' }),
        makeMotor(),
      ];
      const connections = [
        makeConnection({ id: 'c1', from: 'dig-1' }),
        makeConnection({ id: 'c2', from: 'dig-2' }),
      ];
      const errors = validateGraph(nodes, connections);
      const warning = errors.find(
        (e) => e.severity === 'warning' && e.message.includes('share a single interrupt channel'),
      );
      expect(warning).toBeDefined();
      expect(warning?.message).toContain('Mic');
      expect(warning?.message).toContain('Clap');
    });

    it('does not warn about channel sharing for sensors on distinct channels', () => {
      const nodes = [
        makePulseSensor({ id: 'dig-1', label: 'Mic', arduinoPort: '2' }),
        makePulseSensor({ id: 'dig-2', label: 'Clap', arduinoPort: '8' }),
        makeMotor(),
      ];
      const connections = [
        makeConnection({ id: 'c1', from: 'dig-1' }),
        makeConnection({ id: 'c2', from: 'dig-2' }),
      ];
      const errors = validateGraph(nodes, connections);
      expect(errors.filter((e) => e.message.includes('share a single interrupt channel'))).toHaveLength(0);
    });
  });

});
