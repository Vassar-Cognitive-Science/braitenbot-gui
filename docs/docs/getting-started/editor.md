---
sidebar_position: 3
title: The Editor
---

# The Editor

The BraitenBot editor is a single-screen workspace with four main areas.

## Landing screen

Launching the desktop app always opens on a landing screen first, before
either the editor or the lessons load — this is deliberate, so a student
picking up the app isn't dropped straight into the Arduino setup gate before
deciding what they're there to do.

Two large cards choose where to go:

- **Editor**: build and upload wiring diagrams to your robot. Opens the
  workspace described on this page.
- **Lessons**: the same hands-on tutorials from the [Lessons](../lessons/your-first-vehicle)
  section of this site, bundled into the app so they work fully offline —
  no network connection needed once the app is installed.

Below the cards, a row of low-emphasis links opens in your system's default
browser: **GitHub** (the source repository), **Documentation** (this site),
and **Report an issue**. The installed app version is shown alongside them.

The landing screen appears on every launch; it's never skipped or
remembered. Once you're inside the Editor or Lessons, a **Home** button
(see below) takes you back to it without losing your place — the editor
keeps your diagram and undo history, and Lessons keeps your scroll position
and current page.

## Lessons (offline, in the app)

Choosing **Lessons** from the landing screen opens the same lessons you'd
read on the website, rendered in a bundled, offline copy with a slim toolbar
above it (a **Home** button, to return to the landing screen, joined by an
**Editor** button once you've unlocked the editor — see below). Every
lesson's interactive diagrams work exactly as they do on the public site —
drag nodes, wire connections, run the simulation — with one addition: each
editable diagram gets an **Upload to bot** button that isn't shown on the
website. Clicking it opens a small board-picker dialog and puts the circuit
you just wired straight onto the robot, without leaving the lesson or
opening the Editor. See [Your First Vehicle](../lessons/your-first-vehicle)
for where that button first appears.

The Editor itself stays out of reach from Lessons until [8. First
Upload](../on-the-robot/first-upload) explicitly unlocks it with an "Open the
Editor" button. After that, an **Editor** button appears in the Lessons
toolbar and a **Lessons** button appears in the canvas toolbar, so switching
between the two is a single click from then on — before that point, the
landing screen is the only way between them.

## Layout

```
┌──────────────┬──────────────────────────────────────┬──────────────┐
│              │            Canvas Toolbar            │              │
│  Node        ├──────────────────────────────────────┤  Config      │
│  Palette     │            Diagram Canvas            │  Panel       │
│              │           (Robot Overlay)            │              │
│              │                                      │              │
│              ├──────────────────────────────────────┤              │
│              │      Oscilloscope (trace mode)       │              │
└──────────────┴──────────────────────────────────────┴──────────────┘
```

- **Node palette** (left) and **config panel** (right) span the full height.
- The **canvas toolbar** sits above the **diagram canvas** (with the robot
  overlay at its center); the **oscilloscope** slides in below the canvas in
  trace mode.

## Node palette (left sidebar)

The palette has two tabs, **Basic** and **Advanced**, so you can start simple and reach for the full toolbox only when you need it. Your choice is remembered between sessions.

### Basic tab

The Basic tab lists the reference kit's hardware by friendly name, with pins and options pre-filled to match the standard build:

- **Kit sensors**: Left/Right Photocell, four Bump switches, Color Sensor, Left/Right ToF Distance
- **Kit outputs**: 7-Segment Display
- **Compute**: a starter set of Threshold, Summation, Multiply, Delay

Dragging **Left Photocell**, for example, drops an analog sensor already set to pin A0 with its signal inverted, so you don't have to type pin numbers for standard kit parts.

### Advanced tab

The Advanced tab lists **every** node type, grouped into collapsible sections:

- **Sensors**: Analog Sensor, Digital Sensor, Color Sensor, ToF Distance
- **Compute**: Threshold, Delay, Summation, Multiply, Minimum, Maximum, Oscillator, Noise, Constant
- **Outputs**: Continuous Servo, Positional Servo, Digital Output, 7-Segment Display
- **Compounds**: your custom compound node types (appears when you've created at least one)

Nodes dropped from the Advanced tab are generic: you assign their pins yourself in the config panel (the field shows a suggested pin as a placeholder). Fixed-wiring parts still pre-fill: the 7-Segment Display comes in with CLK 9 / DIO 10.

Each section is color-coded to match the node kind:
- Orange for sensors
- Blue for compute
- Green for outputs
- Purple for compounds

On the canvas, every node also shows a small type glyph before its label (a sun for an analog sensor, a timer for a delay, a sigma for summation, and so on), tinted to the node's kind so you can read a diagram at a glance without reading each label.

**To add a node:** drag it from either tab and drop it onto the canvas.

The palette is resizable: drag the handle on its right edge to make it wider or narrower. Double-clicking the handle resets it to the default width.

## Diagram canvas (center)

The canvas is where you build your circuit. It shows:

- **Nodes**: rectangular blocks representing sensors, compute elements, and outputs
- **Connections**: curved lines linking node outputs to inputs
- **Robot overlay**: a top-down view of the robot body and wheels in the center of the canvas

### Navigation

- **Pan**: click and drag on empty canvas space
- **Zoom**: Ctrl/Cmd + scroll wheel, or use the zoom buttons in the bottom-right corner
- **Reset view**: click the reset button to return to 100% zoom
- **Fit to view**: click the fit button (four corner brackets) to frame every block in the current diagram

### Working with nodes

- **Select a node**: click it to open the config panel on the right
- **Select all**: `Ctrl/Cmd+A`
- **Multi-select**: Shift+click to add/remove nodes from the selection
- **Clear the selection**: press `Escape` (also closes the config panel)
- **Move nodes**: drag a selected node to reposition it
- **Rename a node**: double-click its label and type a new name (Enter to confirm, Escape to cancel)
- **Right-click a node** for a quick menu: **Duplicate**, **Disconnect** (remove all its links), or **Delete**
- **Delete**: select a node and press Delete or Backspace

### Making connections

1. Hover over a node's **output handle** (circle at the bottom)
2. Click and drag toward another node's **input handle** (circle at the top)
3. Valid targets glow when you hover over them
4. Release to create the connection

The editor prevents invalid connections: you can't connect a node to itself, exceed a node's input limit, or create duplicate connections.

### The robot overlay

The robot appears as a circle in the center of the canvas with two wheels (rounded rectangles) on the left and right edges. The two motor nodes (left wheel, right wheel) are always snapped to the wheel positions: you can't drag them away from the robot body. All other nodes can be positioned freely.

In **trace mode**, each wheel's motor block also grows a drive arrow straight out of it: up from the top edge (green) for a positive, forward signal and down from the bottom edge (tan) for a negative, reverse one, scaled by magnitude, giving a quick read on which way each wheel would turn. (It's an indicator only; to actually watch the robot move, upload to the real hardware.)

## Canvas toolbar (top)

The toolbar is divided into functional groups:

### Home
- **Home**: at the far left of the toolbar, returns to the [landing screen](#landing-screen). Your diagram and undo history aren't lost — the editor keeps running in the background and picks up exactly where you left it when you come back.
- **Lessons**: shown next to Home once you've unlocked the editor (see [Lessons](#lessons-offline-in-the-app)), switches straight to the Lessons view without losing your place in either.

### Group
- **Group**: select 2 or more nodes, then click to combine them into a compound node
- **Ungroup**: select a compound instance to expand it back into its constituent nodes

### Annotate
- **Comment**: drop a gray note box on the canvas to explain what a cluster of nodes is doing. Comments sit behind the nodes, are editable, movable, and resizable, and are saved with the diagram, but they carry no signal and are ignored when generating code. (Comments live on the top-level diagram only, so the button is disabled while you're editing inside a compound.)

### Simulate
- **Trace Signal Flow**: toggle the real-time signal simulation overlay

(The ▶ pulse duration used in trace mode is set in **Settings**; see below.)

### Sketch
- **Upload to robot / Generate** (split button): the primary segment runs the selected action; click the **▾** chevron to switch between **Upload to robot** (compile and upload to the connected board) and **Generate code only** (show the generated sketch without needing a board). The chosen action is remembered. "Generate code only" works without any board connected.

During an upload, a **progress bar** appears at the top of the canvas showing the current phase (compiling, then uploading, with a percentage once the uploader reports one), next to a **Cancel** button.

The Arduino **loop period** is no longer in this group; it now lives in **Settings** (see below).

### Device
- **Board selector**: dropdown showing detected Arduino boards
- **Refresh**: re-scan serial ports
- **Monitor**: open the serial monitor to watch live output from the board, and send lines back to it using the text box at the bottom of the panel (for example, to drive the [hardware test sketch](../hardware/testing) over serial)

### Share
- **Share**: start or join a real-time collaborative session. See [Collaborative Sessions](../guide/collaborative-sessions).

### Settings
- **⚙ (gear)**: at the far right of the toolbar, opens the Settings dialog. It is split into two groups. *(On macOS, Settings is also reachable from the app menu, ⌘,.)*
  - **Personal preferences** are yours alone, stored per device and never shared in a session:
    - **Auto-select an identified board**: when your board-picker selection is an unidentified port, automatically switch to a newly detected board with a known type (FQBN). Turn it off to keep whatever board you picked.
  - **Diagram preferences** are saved with the diagram and shared live, so in a collaborative session the **host** controls them (they are read-only for view-only guests):
    - **Connection-weight cap**: keep weights in the conventional −1…1 Braitenberg range, or turn it off for arbitrary weights.
    - **Sketch loop period** (1–1000 ms): how often the generated loop reads sensors and updates motors.
    - **Trace pulse duration** (10–5000 ms): how long the ▶ button holds a sensor at full value in trace mode.
  - **Advanced** (collapsed by default) holds one more personal preference:
    - **Collaboration relay URL**: the server that carries [live sessions](../guide/collaborative-sessions#self-hosting-the-relay). Leave it blank to use the built-in relay; set it to your own `ws://`/`wss://` endpoint to run sessions on your own server.

## Application menu (desktop app)

The desktop build adds a native menu bar with the usual app-level actions:

- **File**: New Diagram, Save…, Load…
- **View**
  - **Go to Main View** (`Ctrl/Cmd+0`): recenter the canvas and reset the zoom to 100%
  - **Check for Errors / Warnings**: open the diagram check, a list of everything worth fixing, split into problems that block upload (**errors**) and things worth a look (**warnings**: unnamed or unconnected nodes, pin conflicts, and so on). Nothing needs to be uploaded to see it.
- **Hardware**: Upload Test Sketch

## Config panel (right sidebar)

When you select a node or connection, the config panel shows its editable properties.

### Node config

Depending on the node type, you'll see:

- **Label**: the node's display name
- **Arduino Port**: pin assignment (sensors and outputs)
- **Parameters**: threshold value, delay time, frequency, amplitude, etc.
- **Delete Node** button

### Connection config

- **Transfer function**: choose between Linear (simple weight) or Non-linear (custom curve)
- **Weight**: for linear mode, a numeric input plus (when the weight cap is on) a −1…+1 slider. Turn the cap off in Settings to enter any weight; the slider then hides and only the numeric field remains.
- **Curve editor**: for non-linear mode, an interactive point editor
- **Delete Connection** button

## Oscilloscope (bottom, trace mode only)

When signal tracing is active (toggled with **Trace Signal Flow**), a collapsible oscilloscope panel appears at the bottom of the canvas. It plots a rolling 5-second history of signal values at each node over time, so you can see how signals change. Controls include pause/resume and clear history. For the full picture of what trace mode does, see [Simulating & Tracing](../guide/simulation).

## Keyboard & mouse

| Input | Action |
|----------|--------|
| **Click** node | Select node, open config panel |
| **Shift+Click** node | Toggle node in multi-selection |
| **Right-click** node | Open the node menu (Duplicate / Disconnect / Delete) |
| **Double-click** node label | Rename the node inline |
| **Click** connection | Select connection, open config panel |
| **Click** empty canvas | Deselect all |
| **Drag** on empty canvas | Pan the view |
| **Scroll** / two-finger swipe | Pan the view |
| **Ctrl/Cmd + Scroll** | Zoom in/out (0.3× to 3×) |
| **Ctrl/Cmd + 0** | Go to main view (recenter, reset zoom to 100%) |
| **Ctrl/Cmd + A** | Select every node in the current diagram |
| **Escape** | Clear the selection and close the config panel |
| **Delete** or **Backspace** | Delete the selected node or connection |
| **Ctrl/Cmd + Z** | Undo |
| **Ctrl/Cmd + Shift + Z** or **Ctrl/Cmd + Y** | Redo |
| **Double-click** compound | Enter the compound body editor |

There are no keyboard shortcuts for toolbar actions (Group, Trace, Upload to robot / Generate); those are buttons, described above.

## Next steps

Now that you know the layout, [build your first vehicle](../lessons/your-first-vehicle).
