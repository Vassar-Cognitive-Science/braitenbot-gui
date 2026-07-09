# braitenbot-gui

## 0.6.2

### Patch Changes

- 8aa4de1: Validate pulse-capture pin support. The diagram validator now warns when a digital sensor's "Catch brief pulses" option is enabled on a pin the UNO R4 cannot attach an interrupt to (only pins 2, 3, 8, 12, and A1–A5 have IRQ channels on the RA4M1; elsewhere `attachInterrupt` silently does nothing and the sensor degrades to plain polling). It also warns when two pulse-capture sensors sit on pins that share a single UNO R4 interrupt channel (e.g. 3 + A4, or A3 + A5), since only one pin per channel can attach. Both are warnings rather than errors because classic AVR boards (Uno R3 / Nano) cover every pin via pin-change interrupts.

## 0.6.1

### Patch Changes

- bae6cfd: Add a "Catch brief pulses" option to digital sensor nodes. When enabled, the generated sketch attaches a pin interrupt that latches pulses shorter than the loop period (e.g. a clap on a KY-037 sound sensor's digital output), so they register as high for one full tick instead of being missed between polls. The scheduled read consumes the latch and ORs it with a live `digitalRead`, so steady signals behave exactly as with plain polling. On classic AVR boards (Uno R3/Nano) the sketch uses pin-change interrupts so any pin works — not just the external-interrupt pins 2/3; on boards where `attachInterrupt` covers every pin (UNO R4) it emits a per-sensor edge-triggered ISR. With INPUT_PULLUP enabled the latch triggers on the falling edge to match the inverted active level.

## 0.6.0

### Minor Changes

- fba57d0: Add Minimum and Maximum compute nodes (Advanced palette). Each reduces over its incoming weighted signals — `min`/`max` respectively — enabling winner/loser-take-all wiring and constant-based floors/ceilings that summation and multiply can't express. Faithful in both the trace simulator and generated Arduino code.
- cb344c6: Add a Settings panel (opened from the native menu — macOS app menu ⌘, or File ▸ Settings… elsewhere) with an option to turn off the −1…1 connection-weight cap, allowing arbitrary weight values.
- 388463b: Windows USB driver installation is now handled by the app instead of silently skipped.

  - The one-time toolchain setup passes `--run-post-install` to `arduino-cli core install`, so each platform's bundled driver installer actually runs (arduino-cli skips it in non-interactive sessions, which a GUI-spawned sidecar always is). Windows shows an administrator prompt during install; the setup dialog now says to expect it.
  - While no board is detected, the app probes Windows PnP for a plugged-in Arduino-compatible USB device stuck without a driver — the state that previously looked identical to "no board plugged in."
  - When one is found, a "USB driver missing — install" prompt in the Device toolbar runs the Arduino driver installers elevated, then rescans for the board.

### Patch Changes

- 4452141: Allow diagrams with unconnected outputs to build. The "output not connected to any sensor" check is now a non-blocking warning instead of a blocking error, so you can (for example) wire up just the display and leave the wheels unsignaled for testing.
- 388463b: The Basic palette tab now includes the Multiply compute node alongside Threshold, Summation, and Delay.
- c44c615: Duplicate node names no longer block upload. The generated sketch already disambiguates repeated names with numeric suffixes (`Constant_1`, `Constant_2`, …), so the duplicate-name check is now a non-blocking warning that nudges toward distinct names for readability. Diagrams with several unnamed constants upload without renaming each one.
- 23a92c9: Harden I2C color/ToF sensor handling. Validation now errors if any pin (analog A4/A5 or their digital aliases 18/19) collides with the I2C SDA/SCL pins while a color or ToF sensor is in the diagram. The generated TCS34725 driver is also more robust against the "color reads drop to 0" failure: it caps blocking I2C reads on AVR (`Wire.setWireTimeout`, guarded by `WIRE_HAS_TIMEOUT` so it still compiles on the UNO R4), holds the last good sample on a transient read failure instead of returning zeros, and after 10 consecutive failures runs a bus-clear + sensor re-init recovery routine. The driver now also defends against a physically wired but undiagrammed VL53L4CD ToF sensor, which powers up at the color sensor's shared 0x29 address and silently corrupts every read: before init (and on recovery), it probes the TCS ID register and, only if the response is wrong, evicts the stray ToF by writing its I2C address register to park it at 0x33, and it re-runs this eviction whenever a read returns all zeros with a bad ID.
- e0a7b4b: The kit photocell presets (Left/Right Photocell on the Basic tab) now drop with "Invert signal" enabled, so new users get the expected more light → more signal behavior for simple vehicles. The photocells are wired as voltage dividers where the raw reading drops as light increases; the checkbox can still be unticked for the raw reading.
- 9007aa7: Trace mode is much faster on large diagrams. The simulation now compiles a structural plan (flattened graph, topo order, edge adjacency, pre-sorted transfer curves) once per edit instead of rebuilding it every tick — removing an O(nodes × edges) per-tick cost — and diagram nodes only re-render when their displayed value actually changes, with on-canvas numbers updating at ~10Hz while the simulation and oscilloscope keep full tick rate. Traces are bit-identical to before.

## 0.5.0

### Minor Changes

- 6f37983: Multi-user collaborative sessions: share a diagram with a 6-digit code and edit it together in real time.

  - Diagram state now lives on a Yjs CRDT document (`src/doc/`); undo is per-user via `Y.UndoManager` and an invariant repair pass keeps concurrent edits semantically valid.
  - Deterministic lockstep simulation: noise nodes draw from a PRNG keyed on (seed, node, tick) and oscillators/delays are tick-indexed, so every participant sees the same trace (and solo traces are reproducible).
  - Ephemeral WebSocket relay (`relay/`, deployed at wss://cogsciresearch.vassar.edu/braitenbot-relay): rooms in RAM only, host confirm-admit, lock/remove, version handshake, per-IP rate limits.
  - Session UX: Share menu, join-request toasts, connection indicator, separate autosave slot for guests plus keep-a-copy prompts so a guest's own diagram is never clobbered.
  - Presence and roles: participant colors, remote selection outlines and drag ghosts, remote cursors, follow-the-host viewport, and a host-controlled edit/view-only role enforced at the document mutation layer.
  - Shared trace mode: trace on/off, sensor inputs, seed, and pulses sync to all participants and are never persisted or exported.

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
