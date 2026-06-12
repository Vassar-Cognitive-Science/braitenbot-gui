---
sidebar_position: 1
title: Node Types
---

# Node Types Reference

Every node in BraitenBot belongs to a **kind** (sensor, compute, output, constant, compound, or port) and has a specific **type** that defines its behavior. This page documents all available node types.

## Sensors

Sensor nodes read values from the physical world and output signals into the diagram.

### Analog Sensor

| Property | Value |
|----------|-------|
| Type ID | `sensor-analog` |
| Kind | sensor |
| Inputs | 0 |
| Outputs | 1 |
| Protocol | analog |

Reads an analog pin (0–1023) and scales the value to **0–100**.

**Configuration:**
- **Arduino Port** — the analog pin (e.g., `A0`, `A1`, ..., `A5`)

**Generated code:**
```cpp
float sig_sensor = analogRead(SENSOR_PIN) * (100.0 / 1023.0);
```

---

### Digital Sensor

| Property | Value |
|----------|-------|
| Type ID | `sensor-digital` |
| Kind | sensor |
| Inputs | 0 |
| Outputs | 1 |
| Protocol | digital |

Reads a digital pin and outputs **0** (LOW) or **100** (HIGH).

**Configuration:**
- **Arduino Port** — the digital pin number (e.g., `2`, `3`, ..., `13`)
- **INPUT_PULLUP** — checkbox to enable the internal pull-up resistor. When enabled, the pin reads HIGH by default and LOW when grounded. The output is inverted: LOW → 100, HIGH → 0.

**Generated code:**
```cpp
// Without pullup
float sig_sensor = digitalRead(PIN) == HIGH ? 100.0 : 0.0;

// With pullup (inverted)
float sig_sensor = digitalRead(PIN) == LOW ? 100.0 : 0.0;
```

---

### Color Sensor (TCS34725)

| Property | Value |
|----------|-------|
| Type ID | `sensor-color` |
| Kind | sensor |
| Inputs | 0 |
| Outputs | 4 (clear, red, green, blue) |
| Protocol | i2c |

Reads a TCS34725 color sensor over I2C and outputs four channels, each scaled to **0–100**:

- `clear` — ambient light intensity
- `red` — red channel
- `green` — green channel
- `blue` — blue channel

**Configuration:** None (I2C address is fixed).

Each outgoing connection specifies which port it reads from via the `fromPort` field. You can route each channel to different targets independently.

---

## Compute Nodes

Compute nodes process signals between sensors and outputs.

### Threshold

| Property | Value |
|----------|-------|
| Type ID | `compute-threshold` |
| Kind | compute |
| Inputs | 1 (max) |
| Outputs | 1 |

Binary decision node. Outputs **100** if the input exceeds the threshold, otherwise **0**.

**Configuration:**
- **Threshold** — value from -100 to 100 (default: 50)

**Generated code:**
```cpp
float sig_node = (input > 50.0) ? 100.0 : 0.0;
```

---

### Delay

| Property | Value |
|----------|-------|
| Type ID | `compute-delay` |
| Kind | compute |
| Inputs | 1 (max) |
| Outputs | 1 |

Delays the input signal by a configurable time. Uses a ring buffer to store past values. Critically, **Delay is the only node type that can break feedback cycles** — it reads from the previous iteration, allowing cycles in the graph.

**Configuration:**
- **Delay** — time in milliseconds, 1–10000 (default: 100)

The buffer size is calculated as `ceil(delay_ms / loop_period_ms)`.

**Execution:** Two-phase:
1. **Read phase** (normal order): output the buffered value from N iterations ago
2. **Write phase** (end of loop): capture current input, advance buffer index

---

### Summation

| Property | Value |
|----------|-------|
| Type ID | `compute-summation` |
| Kind | compute |
| Inputs | unlimited |
| Outputs | 1 |

Adds all weighted inputs together.

**Formula:** `output = Σ(input_i × weight_i)`

No configuration beyond connection weights.

---

### Multiply

| Property | Value |
|----------|-------|
| Type ID | `compute-multiply` |
| Kind | compute |
| Inputs | unlimited |
| Outputs | 1 |

Multiplies all weighted inputs together. Useful as a gate: if any input is 0, the output is 0.

**Formula:** `output = ∏(input_i × weight_i)`

:::tip
Since signals range from -100 to 100, multiplying two raw signals produces values up to 10,000. Use small weights (e.g., 0.01) on inputs to keep the product in a useful range.
:::

---

### Oscillator

| Property | Value |
|----------|-------|
| Type ID | `compute-oscillator` |
| Kind | compute |
| Inputs | 0 |
| Outputs | 1 |

Generates a sine wave signal. This is a source node — it has no inputs.

**Configuration:**
- **Frequency** — Hz, 0–50 (default: 1.0)
- **Amplitude** — 0–100 (default: 100)

**Formula:** `output = amplitude × sin(2π × frequency × t / 1000)`

Where `t` is the elapsed time in milliseconds.

---

### Noise

| Property | Value |
|----------|-------|
| Type ID | `compute-noise` |
| Kind | compute |
| Inputs | 0 |
| Outputs | 1 |

Generates a random signal each loop iteration. This is a source node.

**Configuration:**
- **Amplitude** — 0–100 (default: 50)

**Formula:** `output = amplitude × random(-1, 1)`

---

## Constants

### Constant

| Property | Value |
|----------|-------|
| Type ID | `constant` |
| Kind | constant |
| Inputs | 0 |
| Outputs | 1 |

Emits a fixed value every loop iteration. This is a source node.

**Configuration:**
- **Value** — -100 to 100

---

## Outputs

Output nodes consume signals and drive physical hardware. They have no signal output.

### Continuous Servo

| Property | Value |
|----------|-------|
| Type ID | `servo-cr` |
| Kind | output |
| Inputs | 1 (max) |
| Outputs | 0 |

Controls a continuous rotation servo. Maps the input signal (-100 to 100) to a pulse width (1000–2000 microseconds).

**Configuration:**
- **Servo Pin** — the digital pin the servo signal wire is connected to

**Wheel motors** (Left Motor, Right Motor) are special instances of this type:
- The left wheel maps directly: `1500 + input × 5` µs
- The right wheel is inverted: `1500 - input × 5` µs (motors face opposite directions)

---

### Positional Servo

| Property | Value |
|----------|-------|
| Type ID | `servo-positional` |
| Kind | output |
| Inputs | 1 (max) |
| Outputs | 0 |

Controls a standard positional servo. Maps the input signal (-100 to 100) to an angle (0°–180°).

**Configuration:**
- **Servo Pin** — the digital pin

**Formula:** `angle = constrain((input + 100) × 0.9, 0, 180)`

---

### Digital Output

| Property | Value |
|----------|-------|
| Type ID | `digital-out` |
| Kind | output |
| Inputs | 1 (max) |
| Outputs | 0 |

Drives a digital pin HIGH or LOW based on a threshold comparison. Useful for LEDs, relays, and buzzers.

**Configuration:**
- **Pin** — the digital pin
- **Threshold** — value from -100 to 100 (default: 50). Output is HIGH when input exceeds threshold.

---

### TM1637 Display

| Property | Value |
|----------|-------|
| Type ID | `display-tm1637` |
| Kind | output |
| Inputs | 1 (max) |
| Outputs | 0 |

Drives a 4-digit 7-segment TM1637 display. Rounds the input to the nearest integer, clamped to -999–9999.

**Configuration:**
- **CLK Pin** — the clock pin
- **GPIO Pin** — the data pin
- **Brightness** — 0–7 (default: 3)

---

## Port Anchors (compound body only)

These nodes only appear inside compound bodies. They define the interface between a compound's interior and the outer diagram.

### Compound Input

| Property | Value |
|----------|-------|
| Type ID | `compound-input` |
| Kind | port |
| Inputs | 0 |
| Outputs | 1 |

Receives a signal from the outer diagram and makes it available inside the compound body. Each Compound Input corresponds to one input port on the compound instance.

### Compound Output

| Property | Value |
|----------|-------|
| Type ID | `compound-output` |
| Kind | port |
| Inputs | 1 (max) |
| Outputs | 0 |

Sends a signal from inside the compound body out to the outer diagram. Each Compound Output corresponds to one output port on the compound instance.
