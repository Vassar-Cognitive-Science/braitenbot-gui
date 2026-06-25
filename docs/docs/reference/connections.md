---
sidebar_position: 2
title: Connections
---

# Connections Reference

Connections are the weighted links between nodes. Each connection carries a signal from one node's output to another node's input, transforming it along the way.

## Connection properties

| Property | Type | Description |
|----------|------|-------------|
| `id` | string | Unique identifier |
| `from` | string | Source node ID |
| `fromPort` | string (optional) | Source port name (for multi-output nodes) |
| `to` | string | Target node ID |
| `toPort` | string (optional) | Target port name (for compound instances) |
| `weight` | number | Linear scaling factor, -1 to +1 |
| `transferMode` | `'linear'` or `'nonlinear'` | Transfer function type |
| `transferPoints` | array | Control points for non-linear transfer |

## Creating connections

1. Hover over a node's **output handle** (bottom circle)
2. Click and drag toward a target node's **input handle** (top circle)
3. Release when the target handle glows

### Validation rules

The editor prevents invalid connections:

- **No self-loops** — a node can't connect to itself
- **No duplicates** — only one connection allowed for a given (source node, source port, target node) combination; the target port is not part of the uniqueness check
- **Input limits** — nodes with `maxInputs: 1` (Threshold, Delay, servos, digital output, display) reject a second incoming connection
- **Type compatibility** — output-only nodes can't be connection sources (they have no output signal)

## Transfer modes

### Linear (default)

```
output = input × weight
```

The **weight** is a value from -1 to +1, set via slider or numeric input in the config panel.

| Weight | Effect |
|--------|--------|
| 1.0 | Pass-through (no change) |
| 0.5 | Halve the signal |
| 0.0 | Block the signal entirely |
| -0.5 | Halve and invert |
| -1.0 | Full inversion |

### Non-linear (custom curve)

A custom curve defined by control points in the range (-100, -100) to (100, 100). The output is interpolated in straight-line segments between consecutive points.

Control points:

| Property | Type | Description |
|----------|------|-------------|
| `x` | number | Input value (-100 to 100) |
| `y` | number | Output value (-100 to 100) |

The curve must include endpoints at x = -100 and x = 100.

See [Transfer Functions](../concepts/transfer-functions) for detailed usage.

## Multi-port connections

Some nodes have multiple output or input ports. Connections to/from these nodes must specify which port to use.

### Output ports

The **Color Sensor** has four output ports: `clear`, `red`, `green`, `blue`. Each outgoing connection specifies `fromPort` to select which channel it reads.

**Compound instances** have one output port per Compound Output anchor in their body.

### Input ports

**Compound instances** have one input port per Compound Input anchor in their body. Incoming connections specify `toPort` to select which input to feed.

## Input aggregation

When multiple connections feed into the same node, the aggregation depends on the node type:

| Node type | Aggregation |
|-----------|------------|
| Summation | Sum: `Σ(input_i × weight_i)` |
| Multiply | Product: `∏(input_i × weight_i)` |
| Threshold | Single input only (max 1) |
| Delay | Single input only (max 1) |
| Servos | Single input only (max 1) |
| Digital Output | Single input only (max 1) |
| Display | Single input only (max 1) |

## Visual representation

Connections are rendered as cubic Bezier curves with control points offset vertically from the source and target nodes.

### In normal mode

- **Color**: varies by weight (green for positive, rust/red for negative)
- **Opacity**: 0.85 (1.0 when selected)
- **Weight badge**: displayed at the midpoint of the curve

### In trace mode

- **Color**: varies by signal magnitude and sign
- **Width**: thicker for stronger signals
- **Signal badge**: shows the actual signal value (after weight/transfer)
- **Animation**: subtle flow animation indicates signal direction

## Connection in generated code

Each connection becomes a weighted term in the target node's input aggregation:

```cpp
// Linear transfer
float input_target = sig_source * 0.7500;

// Non-linear transfer
float input_target = transfer_source_to_target_0(sig_source);
```

For summation nodes with multiple inputs:
```cpp
float input_sum_node = sig_a * 0.5000 + sig_b * -1.0000 + sig_c * 1.0000;
```
