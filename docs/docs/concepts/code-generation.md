---
sidebar_position: 5
title: Code Generation
---

# Code Generation

When you click **Generate** in the toolbar, BraitenBot translates your visual diagram into a complete Arduino sketch (`.ino` file) that can be compiled and uploaded to the robot. You don't need to understand this process to use BraitenBot — the tutorials cover everything at the diagram level — but if you're curious about what the generated code looks like or want to modify it by hand, this page explains the full pipeline.

## The pipeline

```
Diagram ──▶ Validate ──▶ Flatten ──▶ Sort ──▶ Emit C Code
```

### 1. Validation

Before generating code, BraitenBot checks for problems:

**Errors** (block code generation):
- No source nodes (sensors, constants, oscillators, or noise) in the diagram
- Missing or invalid pin assignments
- Duplicate node labels
- Pins 0 or 1 used on a digital pin field (reserved for Serial RX/TX)
- Pin 13 used on a digital pin field (wired to the built-in LED)
- A node exceeds its maximum number of inputs
- Cycles without a Delay node to break them
- Output nodes not reachable from any sensor
- Invalid compound references

**Warnings** (code still generates):
- Orphan compute nodes (no inputs or no outputs)
- Stale port references on connections

If validation fails, the error messages are shown in a dialog. Fix the issues and try again.

### 2. Compound flattening

All compound instances are expanded into their body nodes. The flattening process:

1. Recursively expands nested compounds
2. Prefixes internal node IDs with the instance ID to avoid collisions
3. Replaces port anchor nodes with summation pass-throughs
4. Rewires boundary edges to connect to the correct internal nodes

The result is a flat graph with no compound or port nodes.

### 3. Topological sort

The flat graph is sorted into execution order. Edges into delay nodes are excluded from the sort (they read from the previous iteration), which is what allows cycles with delay nodes to work.

### 4. Code emission

The sorted graph is translated into C/C++ code following a structured template.

## Generated sketch structure

```cpp
// ── Includes (each emitted only if used) ──
#include <Wire.h>            // any I2C sensor (color or ToF)
#include <vl53l4cd_class.h>  // any ToF distance node
#include <Servo.h>           // any servo or wheel motor
#include <TM1637Display.h>   // any display node

// ── Pin constants ──
const int SENSOR_Left = A0;
const int SERVO_Left_Wheel_PIN = 9;
// ...

// ── Global declarations ──
Servo servo_Left_Wheel;
// I2C drivers, ToF instances, display objects, etc.

// ── Drive helper ──
void drive(float left, float right) { ... }

// ── Transfer functions ──
float transfer_Left_Sensor_Thresh_0(float x) { ... }

// ── Setup ──
void setup() {
  Serial.begin(115200);
  servo_Left_Wheel.attach(SERVO_Left_Wheel_PIN);
  // ...
}

// ── Loop ──
void loop() {
  unsigned long _loopStart = millis();

  // Sensors
  float sig_Left_Sensor = analogRead(SENSOR_Left) * (100.0 / 1023.0);

  // Compute nodes (in topological order). Inputs accumulate into an
  // input_<label> variable, one line per incoming connection.
  float input_Thresh = 0.0;
  input_Thresh += sig_Left_Sensor * 0.5000;
  float sig_Thresh = (input_Thresh > 50.0000) ? 100.0 : 0.0;

  // Wheel inputs
  float input_Left_Wheel = 0.0;
  input_Left_Wheel += sig_Thresh * 1.0000;

  // Deferred: delay buffer writes
  // ...

  // Drive
  drive(input_Left_Wheel, input_Right_Wheel);

  // Timing
  unsigned long _elapsed = millis() - _loopStart;
  if (_elapsed < 20) delay(20 - _elapsed);
}
```

See the [Generated Code reference](../reference/generated-code) for the verbatim `drive()` helper (including the Renesas USB safety block) and per-node snippets.

## Signal variable naming

The generated code uses consistent naming:

| Pattern | Meaning |
|---------|---------|
| `sig_<label>` | Output signal of a single-output node |
| `sig_<label>_<port>` | Output signal of a specific port (e.g., color sensor channels) |
| `input_<label>` | Aggregated input arriving at a node |
| `SENSOR_<label>` | Pin constant for a sensor |
| `SERVO_<label>_PIN` | Pin constant for a servo/motor |

Labels keep their original case — only spaces and other non-alphanumeric characters become underscores (e.g. `Left Light` → `Left_Light`).

## Wheel motor handling

The two wheel motors get special treatment:

- A `drive(left, right)` helper function handles both motors
- The **left** wheel maps input directly: `1500 + input × 5` microseconds
- The **right** wheel is **inverted**: `1500 - input × 5` microseconds (because the motors face opposite directions on the chassis)
- Both values are constrained to the -100 to 100 range before conversion
- On Arduino Uno R4 (Renesas) boards, `drive()` also holds the wheels neutral and blinks the built-in LED while a USB host is connected, so the robot can't drive off the bench during upload

## Delay node two-phase execution

Delay nodes use a ring buffer and execute in two phases per loop:

1. **Read phase** (in normal execution order): output the value from N iterations ago
2. **Write phase** (at end of loop): capture the current input value and advance the buffer index

This separation ensures that feedback cycles produce stable, predictable behavior.

## Libraries

The generated sketch may include:

| Library | When included |
|---------|--------------|
| `Wire.h` | Any I2C sensor (color or ToF distance) |
| `vl53l4cd_class.h` | Any ToF distance node |
| `Servo.h` | Any servo or motor node |
| `TM1637Display.h` | Any TM1637 display node |

These libraries are automatically installed during [Arduino setup](../getting-started/arduino-setup).
