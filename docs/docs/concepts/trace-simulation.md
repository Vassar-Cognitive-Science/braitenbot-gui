---
sidebar_position: 6
title: Trace Simulation
---

# Trace Simulation

Trace mode lets you simulate your diagram's signal flow without hardware. It's the fastest way to verify that your wiring produces the behavior you expect.

## Activating trace mode

Click **Trace Signal Flow** in the toolbar. The canvas switches to simulation mode:

- Every node displays its current output value
- Every connection shows the signal flowing through it (after weight/transfer)
- Connection lines change color and thickness based on signal magnitude
- Disconnected nodes (motors or compute nodes that expect an input but have none) are highlighted
- Sensor sliders appear so you can inject test values

Click the button again to exit trace mode.

## Sensor controls

When tracing is active, each sensor gets interactive controls:

| Sensor type | Control | Range |
|-------------|---------|-------|
| Analog | Range slider | 0–100 |
| Digital | Toggle button (HIGH/LOW) | 0 or 100 |
| Color (each channel) | Range slider | 0–100 |
| Constant | Range slider | -100–100 |
| Compound input | Range slider | 0–100 |

### Pulse injection

Each sensor also has a **pulse button** (▶). Clicking it injects the value 100 (full activation) for 200 ms, then returns to the slider value. This is useful for testing edge-triggered behaviors like latches — you can "tap" a sensor briefly and watch how the circuit responds.

## Signal visualization

### Node values

Each node badge shows the current output value, formatted smartly (whole numbers when possible, decimals when needed).

### Connection signals

Connection badges show the signal after weight/transfer application. The connection stroke itself encodes signal information:

- **Color**: interpolates from green (positive) through neutral to red/rust (negative)
- **Width**: thicker lines carry stronger signals
- **Opacity**: active connections are more opaque

### Oscilloscope

The oscilloscope panel at the bottom shows a rolling history (**5 seconds by default**) of all signal values plotted over time, so you can see how signals change across iterations. Controls:

- **Pause/Resume** — freeze the display to inspect values
- **Clear** — reset the history buffer

The oscilloscope samples at the configured loop period (matching what the hardware would do), so the time axis is accurate to the real-time behavior.

## How simulation works

On each loop iteration, the trace simulation runs the same four steps the hardware does:

1. **Flatten** compound instances into their body nodes
2. **Topologically sort** the graph (excluding delay inputs)
3. **Forward pass**: compute each node in order using current sensor values
4. **Deferred phase**: update delay ring buffers

The simulation matches the hardware behavior exactly — the same execution order, the same transfer functions, the same delay semantics. What you see in trace mode is what the robot will do.

### Delay nodes in simulation

Delay nodes maintain state across simulation ticks. They use ring buffers sized to the configured delay time and loop period. On each tick:

1. Read the buffered value from N ticks ago
2. After all nodes compute, write the current input to the buffer

This two-phase approach ensures that feedback cycles produce stable, predictable results.

### Oscillator and noise nodes

- **Oscillator** nodes generate a sine wave based on simulation time, using the configured frequency and amplitude
- **Noise** nodes generate a new random value each tick

## Tips for effective tracing

- **Start simple**: trace a direct sensor-to-motor connection first, then add complexity
- **Use pulse** for testing latches and state-holding circuits — a brief tap reveals whether the circuit "remembers"
- **Watch the oscilloscope** for timing-dependent behaviors like oscillators and delays
- **Compare linear vs. non-linear transfer** by switching modes on a connection and watching how the output changes
- **Test extremes**: slide sensors to 0 and 100 to verify the circuit behaves correctly at the boundaries
