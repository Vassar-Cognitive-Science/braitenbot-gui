# braitenbot-gui

## 0.4.0

### Minor Changes

- 426d301: Toolbar and palette usability improvements.

  - The Generate and Upload buttons are merged into a single split button: the ▾ menu switches the primary action between "Upload to robot" and "Generate code only" (remembered across sessions). Generating code still works with no board connected.
  - The node palette sidebar is resizable — drag its edge; double-click to reset.
  - Kit ToF presets are now named by position: "Left ToF Distance" (XSHUT D8) and "Right ToF Distance" (XSHUT D12). The assembly, testing, and hardware-test sketch labels use the same left/right naming.
  - Toolbar buttons gained icons: a magnifying glass on Monitor, group/ungroup glyphs on those buttons, and a waypoints icon on Trace.

## 0.3.0

### Minor Changes

- 2fee2b3: Correctness, safety, and UX overhaul from a full repository review.

  **New features**

  - Serial monitor: watch your robot's serial output in a slide-up panel — no Arduino IDE needed. Pair it with the new "Serial debug prints" checkbox in the code dialog to stream live signal values from generated sketches.
  - Basic / Advanced palette tabs: the Basic tab drops kit parts pre-wired to the reference build (photocells A0/A1, bump switches D2/D3/D4/D7, color sensor, ToF sensors XSHUT 8/12, display CLK 9/DIO 10). Wheels now default to pins D5/D6.
  - Redo (Cmd+Shift+Z / Cmd+Y), undoable node moves and config edits, and connection weight badges that sit on the wire, never overlap on parallel edges, and can be dragged along their own connection.
  - Upload lifecycle: live compile/upload phase reporting, automatic board detection with hotplug polling, and a Cancel button for stuck uploads.

  **Fixes**

  - Generated transfer functions now clamp outside their curve domain; the default 2-point curve previously produced undefined behavior in C++ for out-of-range inputs.
  - Undoing while editing a compound body no longer corrupts the top-level diagram; loading a file while inside a compound no longer freezes the editor.
  - Trace simulation now matches hardware: delays inside compound bodies work, color-sensor channels route independently (with per-channel sliders), and the display shows its real −999..9999 range.
  - Validation covers compound bodies (pins, duplicate pins, reachability, cycles) and reports dangling connections instead of crashing; sources and delays inside compounds no longer trigger false errors.
  - Setup and upload errors show their real message instead of `[object Object]`.
  - Stray text selection during canvas drags is gone; the config panel scrolls on short windows; Backspace behind a dialog no longer deletes nodes.

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
