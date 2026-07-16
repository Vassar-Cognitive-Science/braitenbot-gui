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

- **Start by installing the app**: grab it from the [Install page](/install),
  open it, and choose **Lessons**. All thirteen hands-on builds are bundled
  into the app (they work offline), and every circuit you wire there has an
  **Upload to bot** button: pick your board and it goes straight onto a real
  robot, no need to open the editor.
- **Can't install it?** iPad, Chromebook, locked-down machine: no problem.
  The same [Lessons](./lessons/your-first-vehicle) run right here in your
  browser, nothing to set up.
- **Lessons**: the full thirteen-lesson course: seven software lessons, five
  more ("On the Robot") that calibrate and tune real sensors, and a closing
  lesson rounding out the toolbox.
- **Install & Setup**: installing the app and setting up Arduino.
- **Keep Building**: go further with the diagram building blocks:
  nodes, connections, transfer functions, compounds, the simulator,
  collaborative sessions, and the editor itself.

The separate **Hardware** section covers building the physical robot.

## Next steps

- [Install BraitenBot](/install) and take the lessons inside the app
- [Play the first lesson in your browser](./lessons/your-first-vehicle) if you
  can't install: nothing to set up
- [Explore the building blocks](./guide/nodes)
