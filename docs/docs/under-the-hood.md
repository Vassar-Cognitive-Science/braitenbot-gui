---
sidebar_position: 5
title: Under the Hood
---

# Under the Hood

You don't need anything on this page to use BraitenBot. The editor and lessons
cover everything at the diagram level. This is for the curious: what the app
actually produces when you generate or upload a sketch, and how your work is saved.

## From diagram to sketch

When you click **Upload to robot** or **Generate code only**, BraitenBot turns your visual diagram into a complete
Arduino sketch (a `.ino` file) in four steps:

1. **Validate**: check the diagram for problems that would stop it from running
   (no sensors, missing or reserved pins, a node with too many inputs, a feedback
   cycle with no delay to break it, outputs not reachable from any sensor). If
   anything fails, BraitenBot shows the errors instead of generating code.
2. **Flatten**: expand every [compound node](./guide/compound-nodes) into its
   underlying nodes, so what's left is one flat circuit.
3. **Sort**: order the nodes so each one is computed after the nodes that feed
   it (see [execution order](./guide/connections#execution-order)).
4. **Emit**: write out the C++ code.

The result is a normal Arduino sketch with a `setup()` that initializes the
hardware and a `loop()` that, once per cycle, reads the sensors, computes each
node in order, and drives the wheels, then waits out the rest of the loop period
so timing stays consistent. Signals follow one convention throughout: sensors
read `0`–`100`, and internal values run `-100`–`100`.

A couple of details worth knowing:

- **Wheels** are driven through a small `drive()` helper. The right wheel is
  inverted because the two servos face opposite directions on the chassis. On
  Arduino Uno R4 (Renesas) boards, `drive()` also holds the wheels still and
  blinks the built-in LED while a USB cable is connected, so the robot can't
  drive off the bench while you're programming it.
- **Delay nodes** read the value they buffered a few iterations ago at the top of
  the loop, then store the new value at the end: the two-phase trick that lets
  feedback [cycles](./guide/connections#cycles-and-the-delay-node) work.

### Viewing and editing the sketch

The generated code is shown in the app, and you can copy it into the Arduino IDE
to read or modify it by hand. It's plain, readable Arduino: node labels become
variable names (e.g. a node labeled "Left Light" becomes `sig_Left_Light`), so
you can follow the diagram through the code. Per-node behavior (how each sensor,
compute node, and output is computed) follows directly from the
[node reference](./guide/nodes); the generated code and a few hardware-specific
details for some nodes are below.

### Analog Sensor

```cpp
// Without invert
float sig_sensor = analogRead(SENSOR_PIN) * (100.0 / 1023.0);

// With invert
float sig_sensor = 100.0 - (analogRead(SENSOR_PIN) * (100.0 / 1023.0));
```

### Digital Sensor

Pin support for **Catch brief pulses** differs by board: classic Uno R3 / Nano
boards support every pin (via pin-change interrupts), but the UNO R4 can only
attach interrupts on pins 2, 3, 8, 12, and A1–A5. Pins 3 + A4 (and A3 + A5)
share an interrupt channel, so only one pulse-capture sensor can use each
pair. The diagram validator warns about both cases. Because every brief spike
now counts, a signal chattering near the sensor's comparator threshold reads
high more often; adjust the sensor's sensitivity pot if that happens.

```cpp
// Without pullup
float sig_sensor = digitalRead(PIN) * 100.0;

// With pullup (inverted)
float sig_sensor = (1 - digitalRead(PIN)) * 100.0;

// With "catch brief pulses": an interrupt sets pulse_sensor between reads;
// the live read is OR'd in so a held signal stays high after the latch clears
noInterrupts();
bool pulsed_sensor = pulse_sensor;
pulse_sensor = false;
interrupts();
float sig_sensor = (pulsed_sensor || digitalRead(PIN) == HIGH) ? 100.0 : 0.0;
```

### ToF Distance (VL53L4CD)

Every VL53L4CD powers up at the same default I2C address (`0x52`, or `0x29`
in 7-bit notation, the same address written two ways), which also collides
with the TCS34725 color sensor at 0x29. To use more than one, or to pair one
with a color sensor, the generated `setup()` follows the library's documented
procedure: it drives **every** sensor's XSHUT line low to hold them all in
reset, then brings them up **one at a time**, reassigning each to a unique
address (0x2A, 0x2B, …) before the next powers on. This runs before the
TCS34725 is initialized, so the shared bus is unambiguous. The only wiring
requirement is a distinct XSHUT pin per sensor.

```cpp
uint8_t ready_tof = 0;
static float dist_tof = 500.0;            // distance (mm); no target reads as far
tof.VL53L4CD_CheckForDataReady(&ready_tof);
if (ready_tof) {
  tof.VL53L4CD_ClearInterrupt();
  VL53L4CD_Result_t res_tof;
  tof.VL53L4CD_GetResult(&res_tof);
  uint8_t status_tof = res_tof.range_status;
  if (status_tof <= 2) dist_tof = res_tof.distance_mm; // valid / low-confidence
  else if (status_tof == 3) dist_tof = 0.0;            // below min range → closest
  else dist_tof = 500.0;                               // wraparound/fault → far
}
float sig_tof = constrain((1.0 - dist_tof / 500.0) * 100.0, 0.0, 100.0);
```

The read is non-blocking: the main loop runs faster than a ranging cycle, so
when no new frame is ready the sensor keeps its previous distance. Every
frame that *is* ready is resolved to a usable distance so robot logic never
has to handle a faulty reading:

- **`range_status` 0–2** (valid, plus the sigma/signal-low warnings: a weak
  return from a real wall a few hundred mm away) → the measured distance is
  used.
- **`range_status` 3** (target below the minimum detection range, i.e. right
  up against the sensor) → treated as 0 mm, the closest possible reading.
- **`range_status` 4–7** (wraparound, out of range, hardware fault: bogus
  distances) → treated as the configured max distance, i.e. "nothing
  detected."

These resolve to *distances*, so the node's **Invert** setting still applies:
in the default near-reads-high orientation, status 3 yields signal 100 and
status 4–7 yield 0; with Invert on, they flip.

## Saving and sharing diagrams

Diagrams are saved as **`.bbot` files** (plain JSON inside) you can share, email,
or check into version control. BraitenBot also autosaves your current diagram to the browser's
local storage, so it's still there when you reopen the app. **File ▸ New** resets
to an empty canvas (with the two wheels), and **Save** / **Open** use a normal
file dialog.

:::caution[Alpha format]

BraitenBot is pre-1.0 software, and the file format may change between versions
without migration support. If a saved diagram fails to load after an update, use
**File ▸ New** and re-create it.

:::
