---
sidebar_position: 5
title: Testing
---

# Testing

Once your robot is assembled, it's worth checking that every device works before
you start designing behaviors. BraitenBot includes a **built-in hardware test** —
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

The test checks one device at a time, and you pick which one with the front-left
bump switch:

- **Hold the front-left bump switch** to step through the modes. Each press
  advances the mode number (`0001`, `0002`, …) and shows it on the display.
- **Release** to start the mode you landed on.
- Each mode shows that device's live reading on the 7-segment display. To see
  readings from every device at once, open the **Serial Monitor at 115200 baud**.

There are nine modes, one per device:

| # | Mode | What it shows on the display |
|---|------|------|
| `0001` | Left photocell | Raw light reading, 0–1023 (A0). Cover/uncover the sensor and watch it change. |
| `0002` | Right photocell | Raw light reading, 0–1023 (A1). |
| `0003` | ToF distance #1 | Distance in millimeters. `9999` means nothing in range; `----` means the sensor wasn't found at boot. |
| `0004` | ToF distance #2 | Same as above, for the second distance sensor. |
| `0005` | Color sensor | The clear-light channel. The Serial Monitor also prints the red, green, and blue values. |
| `0006` | Bump switches | Four digits, one per switch — front-left, front-right, rear-left, rear-right — each `1` when pressed, `0` when open. (Pressing front-left changes the mode, so test it by navigating; watch the other three here.) |
| `0007` | Left wheel | Spins the left wheel forward → stop → reverse → stop on a repeating cycle. The display shows the commanded speed (e.g. `60`, `-60`). |
| `0008` | Right wheel | Same drive pattern for the right wheel. |
| `0009` | Display self-test | Lights every segment (`8888` plus the colon) to confirm the display itself works. |

The two ToF distance sensors share one I2C connection, so the test gives each a
separate address using its XSHUT pin — both XSHUT pins must be wired for this to
work. A ToF sensor the test can't find shows `----` instead of a distance. The
test always starts, even if a sensor is missing or a cable is loose, so a bad
connection won't freeze it.
