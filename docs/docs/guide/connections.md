---
sidebar_position: 3
title: Connections & Signal Flow
---

# Connections & Signal Flow

Connections are the weighted links between nodes. Each one carries a signal from
one node's output to another node's input, scaling or reshaping it along the way.
Together they form a circuit in which signals flow in one direction — from
sensors, through compute nodes, to motors.

## Signal range

Every signal in BraitenBot uses a **-100 to 100** range:

| Value | Meaning |
|-------|---------|
| 100 | Maximum forward / full activation |
| 0 | Neutral / off |
| -100 | Maximum reverse / full inhibition |

Sensors typically output **0 to 100** (analog) or **0 or 100** (digital). Compute
nodes and connections can produce negative values through negative weights or
transfer curves.

## Creating connections

1. Hover over a node's **output handle** (the circle at the bottom).
2. Click and drag toward a target node's **input handle** (the circle at the top).
3. Release when the target handle glows.

The editor refuses connections that wouldn't make sense:

- **No self-loops** — a node can't connect to itself.
- **No duplicates** — only one connection is allowed between the same source node +
  source port and the same target node. (The *target* port isn't part of this
  check, so you can't draw two connections from one source port into the same
  target even if they'd land on different input ports.)
- **Input limits** — nodes that take a single input (Threshold, Delay, servos,
  digital output, display) reject a second incoming connection.
- **Type compatibility** — output-only nodes can't be a connection's source, since
  they produce no signal.

## Weights

Every connection has a **weight** between -1 and +1, set with a slider or numeric
input in the config panel. In the default *linear* mode the signal is simply
scaled:

```
output = source signal × weight
```

| Weight | Effect |
|--------|--------|
| 1.0 | Pass-through (no change) |
| 0.5 | Halve the signal |
| 0.0 | Block the signal entirely |
| -0.5 | Halve and invert |
| -1.0 | Full inversion |

For example, a sensor reading of 80 through a weight of 0.5 arrives as 40; through
a weight of -1 it arrives as -80.

A connection can also use a **non-linear curve** instead of a single weight, for
responses that change shape across the input range — see
[Transfer Functions](./transfer-functions).

## Input aggregation

When several connections feed the same node, how they combine depends on the node
type:

| Node type | Aggregation |
|-----------|-------------|
| Summation | Adds all weighted inputs: `Σ(inputᵢ × weightᵢ)` |
| Multiply | Multiplies all weighted inputs together |
| Threshold | Single input only |
| Delay | Single input only |
| Servos / Wheels | Single input only |
| Digital Output | Single input only |
| Display | Single input only |

## Execution order

BraitenBot computes signals in **topological order** — sources first, then the
nodes downstream of them. This guarantees every node reads its inputs only after
they've been computed for the current loop.

```
Sensor A ──▶ Threshold ──▶ Summation ──▶ Left Wheel
Sensor B ─────────────────────┘
```

Here the order is:

1. Read Sensor A
2. Read Sensor B
3. Compute Threshold (from Sensor A)
4. Compute Summation (from Threshold + Sensor B)
5. Drive the Left Wheel (from Summation)

On the robot, this all happens in a tight loop: read every sensor, compute each
node in order, write the wheel outputs, then wait until the loop period has
elapsed (default **20 ms = 50 Hz**). The loop period is configurable in the
toolbar (1–1000 ms); shorter periods respond faster but leave less time for
computation.

## Cycles and the delay node

Feedback loops — where a signal eventually flows back to influence its own input —
make some of the most interesting vehicles possible. But a plain cycle has no
valid execution order: every node would be waiting on another.

BraitenBot breaks cycles with **Delay nodes**. A delay outputs the value from a
few iterations ago instead of the current one:

```
        ┌─────────────────────────────┐
        ▼                             │
    Summation ──▶ Wheel           Delay
        ▲                             │
        └─────── Sensor ──────────────┘
```

Each loop:

1. The delay node outputs the value it buffered N iterations ago.
2. Every other node computes normally using that value.
3. At the end of the loop, the delay node captures its current input for later.

The delay time is configurable (1–10,000 ms); BraitenBot converts it to a number
of loop iterations (delay time ÷ loop period) and buffers that many past values.
A cycle **without** a delay node is a validation error, and BraitenBot won't
generate code for it. To build something that uses this on purpose, see the
[latch tutorial](../tutorials/latches-with-delay).

## Multi-port connections

Some nodes have more than one input or output port, and a connection to them must
say which port it uses:

- The **Color Sensor** has four output ports — `clear`, `red`, `green`, `blue` —
  and each outgoing connection picks one channel.
- **Compound instances** have one input and one output port per port anchor in
  their body. See [Compound Nodes](./compound-nodes).

## How connections look on the canvas

Connections are drawn as curves between nodes. In normal editing, the color shows
the weight (green for positive, rust/red for negative) and a badge at the midpoint
shows its value. In [trace mode](./simulation), the same curve shows the *live*
signal instead — color and thickness track its magnitude and sign, and a badge
shows the value after the weight or curve is applied.
