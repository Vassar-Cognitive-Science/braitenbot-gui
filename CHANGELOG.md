# braitenbot-gui

## 0.2.0

### Minor Changes

- 905870f: Add a hardware bring-up test sketch and a Hardware ▸ Upload Test Sketch menu
  item. The sketch exercises every device in the default build (2× ToF, color
  sensor, 2× photocells, 4× bump switches, TM1637 display, both wheel servos),
  cycling through per-device modes via the front-left bump switch. The same
  sketch ships as a standalone `hardware-test/` folder (with a README) for users
  who prefer the Arduino IDE.

## 0.1.1

### Patch Changes

- a2fb555: Ship the BraitenBot vehicle mark as the desktop app icon, replacing the default Tauri icon in the bundle.
