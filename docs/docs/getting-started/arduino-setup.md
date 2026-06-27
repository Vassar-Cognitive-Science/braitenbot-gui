---
sidebar_position: 2
title: Arduino Setup
---

# Arduino Setup

When you launch BraitenBot for the first time, a setup dialog will check that the Arduino toolchain is ready. This page explains what it does and how to troubleshoot.

## What gets installed

BraitenBot bundles its own copy of `arduino-cli` (the official Arduino command-line tool). On first run, it uses this to install:

1. **Board cores** — the software that lets BraitenBot compile sketches for your Arduino
   - Arduino Uno, Nano, and classic boards
   - Arduino Uno R4 boards
2. **Libraries**
   - `Servo` — motor and servo control
   - `TM1637` — 7-segment display driver (if you use display nodes)
   - `STM32duino VL53L4CD` — driver for the ToF Distance sensor nodes

## The setup dialog

BraitenBot checks for the required cores and libraries before showing anything. If everything is already present, you go straight to the editor. If something is missing, the **One-time setup** dialog appears:

1. **Install Arduino toolchains** — click this button to install the missing cores and libraries
2. **Install log** — installation output streams live in the dialog as it runs
3. **Continue** — once setup finishes, click this button to enter the editor
4. **Retry** — if setup fails, an error is shown with a button to try again

This is a one-time process. On subsequent launches, setup completes silently.

## Connecting your Arduino

1. Plug your Arduino into a USB port
2. In the toolbar, look for the **Device** section (right side)
3. The board selector dropdown lists detected Arduinos with their port and name
4. Select your board from the dropdown — BraitenBot auto-detects the board type (Uno, Nano, R4, and so on), so you don't have to choose it manually
5. If your board doesn't appear, click **Refresh** to re-scan serial ports

### Status indicator

The green/gray dot next to the device dropdown shows connection status:

- **Green** — a board is selected and the port is available
- **Gray** — no board selected or the port is unavailable

## Test your hardware

Before you wire up a diagram, it's worth checking that every device on the robot
actually works. BraitenBot includes a **built-in hardware test** — a sketch that
checks each device in the default build, one at a time: both ToF distance
sensors, the color sensor, both photocells, all four bump switches, the
7-segment display, and both wheel servos.

To run it:

1. Plug in your Arduino and select it in the **Device** dropdown (see
   [Connecting your Arduino](#connecting-your-arduino) above).
2. Open the **Hardware** menu and choose **Upload Test Sketch**.

BraitenBot compiles the test and flashes it to the selected board. It runs
independently of your diagram, so it never changes whatever design you have open.

:::note

If no board is selected, BraitenBot shows *"No board selected. Plug in an
Arduino and click Refresh."* instead of uploading. Select a board first.

:::

### Using the test

The test checks one device at a time, and you pick which one with the front-left
bump switch:

- **Hold the front-left bump switch** to step through the modes. Each press
  advances the mode number (`0001`, `0002`, …) and shows it on the display.
- **Release** to start the mode you landed on.
- Each mode shows that device's live reading on the 7-segment display. To see
  readings from every device at once, open the **Serial Monitor at 115200 baud**.

The two ToF distance sensors share one I2C connection, so the test gives each a
separate address using its XSHUT pin — both XSHUT pins must be wired for this to
work. A ToF sensor the test can't find shows `----` instead of a distance. The
test always starts, even if a sensor is missing or a cable is loose, so a bad
connection won't freeze it.

## Supported boards

| Board | Core | Notes |
|-------|------|-------|
| Arduino Uno | `arduino:avr` | Most widely tested |
| Arduino Nano | `arduino:avr` | Same core as Uno |
| Arduino Uno R4 Minima | `arduino:renesas_uno` | Includes motor safety feature |
| Arduino Uno R4 WiFi | `arduino:renesas_uno` | Same as R4 Minima + WiFi |

### Motor safety (Uno R4 only)

The Uno R4 has a built-in safety feature: while the USB host is actively connected, the wheels are held at zero speed. This prevents the robot from driving off your desk during programming. The built-in LED blinks to indicate safety mode is armed. Unplug the USB cable and the motors engage normally.

## Troubleshooting

### "arduino-cli not found"

This means the bundled CLI binary is missing. If you built from source, run:

```bash
npm run fetch:arduino-cli
```

Then restart the app.

### Board not detected

- Make sure the USB cable supports data (some cables are charge-only)
- Try a different USB port
- On Linux, you may need to add your user to the `dialout` group:
  ```bash
  sudo usermod -aG dialout $USER
  ```
  Then log out and back in.

### Upload fails

- Check that no other program (Arduino IDE, a serial monitor) has the port open — two programs can't use the same serial port at once
- Try clicking **Refresh** and re-selecting the board
- Check the error output — compilation errors are usually caused by invalid pin assignments in your diagram
