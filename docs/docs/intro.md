---
sidebar_position: 1
slug: /
title: Introduction
---

# BraitenBot

**BraitenBot** is a visual editor for designing [Braitenberg vehicle](https://en.wikipedia.org/wiki/Braitenberg_vehicle) wiring diagrams. You drag sensors, compute nodes, and motors onto a canvas, connect them with weighted links, and upload the result as an Arduino sketch to a two-wheeled robot.

The idea is simple: wire a sensor directly to a motor and you get a vehicle that reacts to the world. Add more nodes, feedback loops, and transfer functions and you can build surprisingly complex behaviors — from light-following to obstacle avoidance to subsumption architectures — all without writing a single line of code.

## What can you build?

- **Light seekers** — a robot that steers toward brightness with just two wires
- **Obstacle avoiders** — threshold-based steering away from walls
- **Latch circuits** — delay + summation feedback to "remember" events
- **Subsumption architectures** — layered behaviors with priority arbitration
- **Custom modules** — compound nodes that encapsulate and reuse sub-circuits

## How it works

```
┌─────────┐     ┌──────────┐     ┌─────────┐
│ Sensors │ ──▶ │ Compute  │ ──▶ │ Motors  │
└─────────┘     └──────────┘     └─────────┘
                     │
              weights & curves
              shape the signal
```

1. **Design** your circuit on the visual canvas
2. **Simulate** signal flow to verify behavior
3. **Generate** an Arduino sketch automatically
4. **Upload** to your robot with one click

## Next steps

- [Install BraitenBot](./getting-started/installation)
- [Build your first vehicle](./tutorials/your-first-vehicle)
- [Explore the node reference](./reference/node-types)
