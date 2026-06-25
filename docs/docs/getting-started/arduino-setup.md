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
4. Select your board — BraitenBot auto-detects the board type
5. If your board doesn't appear, click **Refresh** to re-scan serial ports

### Status indicator

The green/gray dot next to the device dropdown shows connection status:

- **Green** — a board is selected and the port is available
- **Gray** — no board selected or the port is unavailable

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

- Check that no other program (Arduino IDE, serial monitor) has the port open
- Try clicking **Refresh** and re-selecting the board
- Check the error output — compilation errors are usually caused by invalid pin assignments in your diagram
