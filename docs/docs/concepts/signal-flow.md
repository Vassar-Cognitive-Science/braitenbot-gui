---
sidebar_position: 2
title: Signal Flow
---

# Signal Flow

Every BraitenBot diagram is a circuit where signals flow in one direction: from sensors through compute nodes to motors. Understanding how signals propagate is key to designing effective behaviors.

## Signal range

All signals in BraitenBot use a **-100 to 100** range:

| Value | Meaning |
|-------|---------|
| 100 | Maximum forward / full activation |
| 0 | Neutral / off |
| -100 | Maximum reverse / full inhibition |

Sensors typically output **0 to 100** (analog) or **0 or 100** (digital). Compute nodes and connections can produce negative values through negative weights or transfer functions.

## Execution order

BraitenBot computes signals in **topological order** — sources first, then downstream consumers. This guarantees that every node reads its inputs after they've been computed for the current loop iteration.

```
Sensor A ──▶ Threshold ──▶ Summation ──▶ Left Motor
Sensor B ─────────────────────┘
```

In this diagram, the execution order would be:
1. Read Sensor A
2. Read Sensor B
3. Compute Threshold (using Sensor A's value)
4. Compute Summation (using Threshold + Sensor B values)
5. Drive Left Motor (using Summation's value)

## Weighted connections

Every connection has a **weight** between -1 and +1. The signal arriving at a node is:

```
received signal = source signal × weight
```

For example, if a sensor outputs 80 and the connection weight is 0.5, the receiving node gets 40.

Negative weights invert the signal: a weight of -1 turns a sensor reading of 80 into -80 at the receiver.

## Input aggregation

When a node has multiple incoming connections, the aggregation depends on the node type:

- **Summation**: adds all weighted inputs together
- **Multiply**: multiplies all weighted inputs together
- **Threshold**: accepts only one input (enforced by the editor)
- **Motors/Servos**: accept only one input

For summation, the formula is:

```
input = Σ (source_i × weight_i)
```

## The Arduino loop

On the hardware, signals are computed in a tight loop:

1. Read all sensor values
2. Compute each node in topological order
3. Write motor outputs
4. Wait until the loop period has elapsed (default 20ms = 50Hz)

The loop period is configurable in the toolbar (1–1000 ms). Shorter periods give faster response but less time for computation; 20ms is a good default.

## Cycles and the delay node

Feedback loops (cycles in the graph) are common in interesting vehicle designs — for example, a motor output feeding back to influence its own input. But a naive cycle has no valid execution order.

BraitenBot breaks cycles with **Delay nodes**. A delay node stores past values and outputs the value from N iterations ago, instead of the current one:

```
        ┌─────────────────────────────┐
        ▼                             │
    Summation ──▶ Motor           Delay
        ▲                             │
        └─────── Sensor ──────────────┘
```

In each loop iteration:
1. The delay node outputs the value it buffered N iterations ago
2. All other nodes compute normally using that value
3. At the end of the loop, the delay node captures its current input for future use

This two-phase execution ensures stable feedback behavior. The delay time is configurable (1–10,000 ms); BraitenBot converts it to a number of loop iterations (delay time ÷ loop period) and buffers that many past values.

Without a delay node in a cycle, BraitenBot reports a validation error and won't generate code.
