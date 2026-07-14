---
sidebar_position: 1
slug: /
title: Introduction
---

# BraitenBot

**BraitenBot** is a visual editor for designing [Braitenberg vehicle](https://en.wikipedia.org/wiki/Braitenberg_vehicle) wiring diagrams. You drag sensors, compute nodes, and motors onto a canvas, connect them with weighted links, and upload the result as an Arduino sketch to a two-wheeled robot.

The idea is simple: wire a sensor directly to a motor and you get a vehicle that reacts to the world. Add more nodes, feedback loops, and transfer functions, and you can build complex behaviors: light-following, obstacle avoidance, even subsumption architectures, without writing any code.

## What can you build?

- **Light seekers**: a robot that steers toward brightness with two wires
- **Obstacle avoiders**: threshold-based steering away from walls
- **Latch circuits**: delay + summation feedback to "remember" events
- **Subsumption architectures**: layered behaviors with priority arbitration
- **Custom modules**: compound nodes that encapsulate and reuse sub-circuits

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
3. **Generate** an Arduino sketch automatically, or upload it directly to the robot

## Finding your way around

- **Lessons**: start here. Six hands-on builds that run right in your browser,
  no install required. Play first.
- **Teaching with BraitenBot**: planning a class? The course overview links the
  lesson arc and the hardware build in one place.
- **Getting Started**: when you're ready to build your own, install the app,
  set up Arduino, and learn the editor.
- **Designing Vehicles**: reference for the building blocks (nodes, connections,
  transfer functions, compounds, the simulator, and collaborative sessions).
- **On the Robot**: put your vehicles on real hardware.
- **Under the Hood**: optional. What the generated Arduino sketch looks like and
  how diagrams are stored.

The separate **Hardware** section covers building the physical robot.

## Next steps

- [Play your first lesson](./lessons/your-first-vehicle): nothing to install
- [Teaching this as a course?](./teaching-with-braitenbot): the educator overview
- [Install BraitenBot](./getting-started/installation) when you want to build your own
- [Explore the building blocks](./guide/nodes)
