---
sidebar_position: 3
title: The Editor
---

# The Editor

The BraitenBot editor is a single-screen workspace with four main areas.

## Layout

```
┌──────────────┬──────────────────────────────────────┬──────────────┐
│              │          Canvas Toolbar               │              │
│   Node       ├──────────────────────────────────────┤  Config      │
│   Palette    │                                      │  Panel       │
│              │         Diagram Canvas                │              │
│              │        (Robot Overlay)                │              │
│              │                                      │              │
│              ├──────────────────────────────────────┤              │
│              │       Oscilloscope (trace mode)       │              │
└──────────────┴──────────────────────────────────────┴──────────────┘
```

## Node palette (left sidebar)

The palette lists every node type you can add to your diagram, organized into collapsible sections:

- **Sensors** — Analog Sensor, Digital Sensor, Color Sensor, ToF Distance
- **Compute** — Threshold, Delay, Summation, Multiply, Oscillator, Noise, Constant
- **Outputs** — Continuous Servo, Positional Servo, Digital Output, 7-Segment Display
- **Compounds** — your custom compound node types (appears when you've created at least one)

Each section is color-coded to match the node kind:
- Orange for sensors
- Blue for compute
- Green for outputs

**To add a node:** drag it from the palette and drop it onto the canvas.

## Diagram canvas (center)

The canvas is where you build your circuit. It shows:

- **Nodes** — rectangular blocks representing sensors, compute elements, and outputs
- **Connections** — curved lines linking node outputs to inputs
- **Robot overlay** — a top-down view of the robot body and wheels in the center of the canvas

### Navigation

- **Pan**: click and drag on empty canvas space
- **Zoom**: Ctrl/Cmd + scroll wheel, or use the zoom buttons in the bottom-right corner
- **Reset view**: click the reset button to return to 100% zoom

### Working with nodes

- **Select a node**: click it — the config panel opens on the right
- **Multi-select**: Shift+click to add/remove nodes from the selection
- **Move nodes**: drag a selected node to reposition it
- **Delete**: select a node and press Delete or Backspace

### Making connections

1. Hover over a node's **output handle** (circle at the bottom)
2. Click and drag toward another node's **input handle** (circle at the top)
3. Valid targets glow when you hover over them
4. Release to create the connection

The editor prevents invalid connections: you can't connect a node to itself, exceed a node's input limit, or create duplicate connections.

### The robot overlay

The robot appears as a circle in the center of the canvas with two wheels (rounded rectangles) on the left and right edges. The two motor nodes (left wheel, right wheel) are always snapped to the wheel positions — you can't drag them away from the robot body. All other nodes can be positioned freely.

## Canvas toolbar (top)

The toolbar is divided into functional groups:

### Group
- **Group** — select 2 or more nodes, then click to combine them into a compound node
- **Ungroup** — select a compound instance to expand it back into its constituent nodes

### Simulate
- **Trace Signal Flow** — toggle the real-time signal simulation overlay

### Sketch
- **Loop period** — set the Arduino main loop timing (1–1000 ms)
- **Generate** — validate the diagram and generate Arduino code

### Device
- **Board selector** — dropdown showing detected Arduino boards
- **Refresh** — re-scan serial ports
- **Upload to Arduino** — compile and upload the generated sketch

## Config panel (right sidebar)

When you select a node or connection, the config panel shows its editable properties.

### Node config

Depending on the node type, you'll see:

- **Label** — the node's display name
- **Arduino Port** — pin assignment (sensors and outputs)
- **Parameters** — threshold value, delay time, frequency, amplitude, etc.
- **Delete Node** button

### Connection config

- **Transfer function** — choose between Linear (simple weight) or Non-linear (custom curve)
- **Weight** — for linear mode, a slider and numeric input from -1 to +1
- **Curve editor** — for non-linear mode, an interactive point editor
- **Delete Connection** button

## Oscilloscope (bottom, trace mode only)

When signal tracing is active (toggled with **Trace Signal Flow**), a collapsible oscilloscope panel appears at the bottom of the canvas. It plots a rolling 5-second history of signal values at each node over time, so you can see how signals change. Controls include pause/resume and clear history. For the full picture of what trace mode does, see [Simulating & Tracing](../guide/simulation).

## Keyboard & mouse

| Input | Action |
|----------|--------|
| **Click** node | Select node, open config panel |
| **Shift+Click** node | Toggle node in multi-selection |
| **Click** connection | Select connection, open config panel |
| **Click** empty canvas | Deselect all |
| **Drag** on empty canvas | Pan the view |
| **Scroll** / two-finger swipe | Pan the view |
| **Ctrl/Cmd + Scroll** | Zoom in/out (0.3× to 3×) |
| **Delete** or **Backspace** | Delete the selected node or connection |
| **Ctrl/Cmd + Z** | Undo |
| **Double-click** compound | Enter the compound body editor |

There are no keyboard shortcuts for toolbar actions (Group, Trace, Generate,
Upload) — those are buttons, described above.

## Next steps

Now that you know the layout, [build your first vehicle](../tutorials/your-first-vehicle).
