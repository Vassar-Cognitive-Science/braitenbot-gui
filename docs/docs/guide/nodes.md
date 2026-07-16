---
sidebar_position: 2
title: Nodes
---

# Nodes

Nodes are the building blocks you drag onto the canvas. Every node belongs to a **kind** (sensor, compute, output, constant, compound, or port) and has a specific **type** that defines its behavior. This page documents all available node types.

In the editor, these live in the palette's **Basic** and **Advanced** tabs. The Basic tab lists the reference kit's parts by friendly name with pins pre-filled (dropping "Left Photocell" gives you an analog sensor already set to A0, inverted); the Advanced tab lists every type generically. See [The Editor](../getting-started/editor#node-palette-left-sidebar) for how the palette is organized.

:::note
This page covers what each node does and how to configure it. For the generated Arduino code and hardware-driver internals behind a few nodes, see [Under the Hood](../under-the-hood).
:::

## Sensors

Sensor nodes read values from the physical world and output signals into the diagram.

### Analog Sensor

| Property | Value  |
| -------- | ------ |
| Kind     | sensor |
| Inputs   | 0      |
| Outputs  | 1      |
| Protocol | analog |

Reads an analog pin (0–1023) and scales the value to **0–100**.

**Configuration:**

- **Arduino Port**: a free-text field for the analog pin label (e.g., `A0`)
- **Invert signal**: checkbox that outputs `100 − value`, so a brighter reading produces a higher signal. Useful with a photocell wired as a voltage divider, where the raw reading _drops_ as light increases: inverting flips it so brighter means higher.

---

### Digital Sensor

| Property | Value   |
| -------- | ------- |
| Kind     | sensor  |
| Inputs   | 0       |
| Outputs  | 1       |
| Protocol | digital |

Reads a digital pin and outputs **0** (LOW) or **100** (HIGH).

**Configuration:**

- **Arduino Port**: a free-text field for the digital pin number (e.g., `2`)
- **INPUT_PULLUP**: checkbox to enable the internal pull-up resistor. When enabled, the pin reads HIGH by default and LOW when grounded. The output is inverted: LOW → 100, HIGH → 0.
- **Catch brief pulses**: checkbox that attaches a pin interrupt so pulses shorter than the loop period (e.g., a clap on a sound sensor's digital output) still register. The interrupt latches the pulse, and the next scheduled read reports 100 for that tick, then clears the latch. Steady signals behave exactly as with plain polling.

---

### Color Sensor (TCS34725)

| Property | Value                       |
| -------- | --------------------------- |
| Kind     | sensor                      |
| Inputs   | 0                           |
| Outputs  | 4 (White, Red, Green, Blue) |
| Protocol | i2c                         |

Reads a TCS34725 color sensor over I2C and outputs four channels, each scaled to **0–100** (normalized against the ADC's full-scale count of 44032 at the configured integration time, so a saturated channel reads 100):

- **White** (handle `W`): the sensor's unfiltered "clear" photodiode. It reads the **total** light across all colors, so brighter surroundings give a higher value, and it usually reads higher than any single color channel rather than being their average. Wire it when the robot should react to overall light level regardless of color (light-seeking / light-avoiding behaviors).
- **Red** (`R`): red channel
- **Green** (`G`): green channel
- **Blue** (`B`): blue channel

The three color channels are for telling _colors apart_ (e.g. red line vs. blue line); use **White** when you only care _how much_ light there is.

**Configuration:**

- **Gain**: RGBC gain multiplier: 1×, 4×, 16×, or 60× (default: 16×). Higher gain lifts readings in dim light; lower gain avoids saturation under bright light. The I2C address (0x29) is fixed.

Gain is a device-wide setting: if a diagram has more than one color-sensor node they share the single physical sensor, so the gain is taken from the first one.

Each outgoing connection specifies which port it reads from via the `fromPort` field. You can route each channel to different targets independently.

---

### ToF Distance (VL53L4CD)

| Property | Value  |
| -------- | ------ |
| Kind     | sensor |
| Inputs   | 0      |
| Outputs  | 1      |
| Protocol | i2c    |

Reads a VL53L4CD time-of-flight distance sensor over I2C and outputs a single signal scaled to **0–100**. By default a closer object reads higher, ramping down to 0 at the configured max distance.

**Configuration:**

- **XSHUT Pin**: a digital pin wired to the sensor's XSHUT (shutdown) line. **Each ToF node needs its own XSHUT pin**; this is what lets multiple sensors share the I2C bus (see below).
- **Max Distance (mm)**: the distance that maps to full-scale signal (default: 500). Objects at or beyond this read 0.
- **Invert (far reads higher)**: checkbox that flips the mapping so a farther object produces a higher signal.

**Multiple ToF sensors** (and pairing a ToF with the color sensor) share the I2C bus automatically. You only need to give each ToF node its own **XSHUT pin**; the generated sketch handles the rest (see [Under the Hood](../under-the-hood) for how).

---

## Compute Nodes

Compute nodes process signals between sensors and outputs.

### Threshold

| Property | Value   |
| -------- | ------- |
| Kind     | compute |
| Inputs   | 1 (max) |
| Outputs  | 1       |

Binary decision node. Outputs **100** if the input exceeds the threshold, otherwise **0**.

**Configuration:**

- **Threshold**: value from -100 to 100 (default: 50)

---

### Delay

| Property | Value   |
| -------- | ------- |
| Kind     | compute |
| Inputs   | 1 (max) |
| Outputs  | 1       |

Delays the input signal by a configurable time. Uses a ring buffer to store past values. Critically, **Delay is the only node type that can break feedback cycles**: it reads from the previous iteration, allowing cycles in the graph.

**Configuration:**

- **Delay**: time in milliseconds, 0–10000 (default: 100)

The buffer size is calculated as `max(1, round(delay_ms / loop_period_ms))`.

**Execution:** Two-phase:

1. **Read phase** (normal order): output the buffered value from N iterations ago
2. **Write phase** (end of loop): capture current input, advance buffer index

---

### Summation

| Property | Value     |
| -------- | --------- |
| Kind     | compute   |
| Inputs   | unlimited |
| Outputs  | 1         |

Adds all weighted inputs together.

**Formula:** `output = Σ(input_i × weight_i)`

No configuration beyond connection weights.

---

### Multiply

| Property | Value     |
| -------- | --------- |
| Kind     | compute   |
| Inputs   | unlimited |
| Outputs  | 1         |

Multiplies all weighted inputs together. Useful as a gate: if any input is 0, the output is 0.

**Formula:** `output = ∏(input_i × weight_i)`

:::tip
Since signals range from -100 to 100, multiplying two raw signals produces values up to 10,000. Use small weights (e.g., 0.01) on inputs to keep the product in a useful range.
:::

---

### Minimum

| Property | Value     |
| -------- | --------- |
| Kind     | compute   |
| Inputs   | unlimited |
| Outputs  | 1         |

Outputs the **smallest** of its weighted inputs. Useful for "respond to the nearest/weakest" behaviors, or as a ceiling when one input is a constant (the output can never rise above that constant). With no inputs the output is 0.

**Formula:** `output = min(input_i × weight_i)`

No configuration beyond connection weights.

---

### Maximum

| Property | Value     |
| -------- | --------- |
| Kind     | compute   |
| Inputs   | unlimited |
| Outputs  | 1         |

Outputs the **largest** of its weighted inputs. Useful for "respond to the strongest" behaviors, or as a floor when one input is a constant (the output can never fall below that constant). With no inputs the output is 0.

**Formula:** `output = max(input_i × weight_i)`

No configuration beyond connection weights.

---

### Oscillator

| Property | Value   |
| -------- | ------- |
| Kind     | compute |
| Inputs   | 0       |
| Outputs  | 1       |

Generates a sine wave signal. This is a source node; it has no inputs.

**Configuration:**

- **Frequency**: Hz, 0–50 (default: 1.0)
- **Amplitude**: 0–100 (default: 100)

**Formula:** `output = amplitude × sin(2π × frequency × t / 1000)`

Where `t` is the elapsed time in milliseconds.

---

### Noise

| Property | Value   |
| -------- | ------- |
| Kind     | compute |
| Inputs   | 0       |
| Outputs  | 1       |

Generates a random signal each loop iteration. This is a source node.

**Configuration:**

- **Amplitude**: 0–100 (default: 50)

**Formula:** `output = amplitude × random(-1, 1)`

---

## Constants

### Constant

| Property | Value    |
| -------- | -------- |
| Kind     | constant |
| Inputs   | 0        |
| Outputs  | 1        |

Emits a fixed value every loop iteration. This is a source node.

**Configuration:**

- **Value**: -100 to 100

---

## Outputs

Output nodes consume signals and drive physical hardware. They have no signal output.

### Continuous Servo

| Property | Value   |
| -------- | ------- |
| Kind     | output  |
| Inputs   | 1 (max) |
| Outputs  | 0       |

Controls a continuous rotation servo. Maps the input signal (-100 to 100) to a pulse width (1000–2000 microseconds).

**Configuration:**

- **Servo Pin**: the digital pin the servo signal wire is connected to

**Wheels** (Left Wheel, Right Wheel) are special instances of this type:

- The left wheel maps directly: `1500 + input × 5` µs
- The right wheel is inverted: `1500 - input × 5` µs (motors face opposite directions)

---

### Positional Servo

| Property | Value   |
| -------- | ------- |
| Kind     | output  |
| Inputs   | 1 (max) |
| Outputs  | 0       |

Controls a standard positional servo. Maps the input signal (-100 to 100) to an angle (0°–180°).

**Configuration:**

- **Servo Pin**: the digital pin

**Formula:** `angle = constrain((input + 100) × 0.9, 0, 180)`

---

### Digital Output

| Property | Value   |
| -------- | ------- |
| Kind     | output  |
| Inputs   | 1 (max) |
| Outputs  | 0       |

Drives a digital pin HIGH or LOW based on a threshold comparison. Useful for LEDs, relays, and buzzers.

**Configuration:**

- **Pin**: the digital pin
- **Threshold**: value from -100 to 100 (default: 50). Output is HIGH when input exceeds threshold.

---

### TM1637 Display

| Property | Value   |
| -------- | ------- |
| Kind     | output  |
| Inputs   | 1 (max) |
| Outputs  | 0       |

Drives a 4-digit 7-segment TM1637 display. Rounds the input to the nearest integer, clamped to -999–9999.

**Configuration:**

- **CLK Pin**: the clock pin
- **DIO Pin**: the data pin
- **Brightness**: 0–7 (default: 3)

---

## Port Anchors (compound body only)

These nodes only appear inside compound bodies. They define the interface between a compound's interior and the outer diagram.

### Compound Input

| Property | Value |
| -------- | ----- |
| Kind     | port  |
| Inputs   | 0     |
| Outputs  | 1     |

Receives a signal from the outer diagram and makes it available inside the compound body. Each Compound Input corresponds to one input port on the compound instance.

### Compound Output

| Property | Value   |
| -------- | ------- |
| Kind     | port    |
| Inputs   | 1 (max) |
| Outputs  | 0       |

Sends a signal from inside the compound body out to the outer diagram. Each Compound Output corresponds to one output port on the compound instance.
