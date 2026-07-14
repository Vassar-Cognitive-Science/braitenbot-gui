---
sidebar_position: 5
title: Testing
---

# Testing

Once your robot is assembled, it's worth checking that every device works before
you start designing behaviors. BraitenBot includes a **built-in hardware test**:
a sketch that checks each device in the default build, one at a time: both ToF
distance sensors, the color sensor, both photocells, all four bump switches, the
7-segment display, and both wheel servos.

To run it:

1. Plug in your Arduino and select it in the **Device** dropdown (see
   [Connecting your Arduino](../getting-started/arduino-setup#connecting-your-arduino)).
2. Open the **Hardware** menu and choose **Upload Test Sketch**.

BraitenBot compiles the test and flashes it to the selected board. It runs
independently of your diagram, so it never changes whatever design you have open.

:::note

If no board is selected, BraitenBot shows *"No board selected. Plug in an
Arduino and click Refresh."* instead of uploading. Select a board first.

:::

## Using the test

Once the upload finishes, the **Serial Monitor** opens automatically (115200
baud). You pick which device to test, and read its live values, entirely over
serial. In the monitor's send box, type:

- A **mode number** `1`–`9` to jump straight to that device's mode.
- **`n`** for the next mode, **`p`** for the previous one.

The current mode's reading also shows on the 7-segment display, but the Serial
Monitor prints full diagnostics for every device each loop, so nothing is
hidden behind the 4-digit display.

There are nine modes, one per device:

| # | Mode | What it shows on the display |
|---|------|------|
| `0001` | Left photocell | Light level scaled to 0–100 (A0). Cover/uncover the sensor and watch it change. |
| `0002` | Right photocell | Light level scaled to 0–100 (A1). |
| `0003` | Left ToF distance | Proximity scaled to 0–100: closer reads higher, ramping to 0 by about 500 mm (the same scale a ToF Distance node uses). `----` means the sensor wasn't found at boot. The Serial Monitor also prints the raw distance in mm. |
| `0004` | Right ToF distance | Same as above, for the right-side sensor. |
| `0005` | Color sensor | The clear-light channel, scaled to 0–100 (a saturated channel reads 100; the same scale a Color Sensor node uses). The Serial Monitor also prints red, green, and blue on the same 0–100 scale. |
| `0006` | Bump switches | Four digits, one per switch (front-left, front-right, rear-left, rear-right), each `1` when pressed, `0` when open. All four are testable directly (the front-left switch is no longer a mode button). |
| `0007` | Left wheel | Spins the left wheel forward → stop → reverse → stop on a repeating cycle. The display shows the commanded speed (e.g. `60`, `-60`). |
| `0008` | Right wheel | Same drive pattern for the right wheel. |
| `0009` | Display self-test | Lights every segment (`8888` plus the colon) to confirm the display itself works. |

The two ToF distance sensors share one I2C bus; see [Supported Hardware ▸ I2C
pins](./supported-hardware#i2c-pins) for how the test tells them
apart. A ToF sensor the test can't find shows `----` instead of a distance. The
test always starts, even if a sensor is missing or a cable is loose, so a bad
connection won't freeze it.
