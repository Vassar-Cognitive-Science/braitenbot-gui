---
sidebar_position: 5
title: Under the Hood
---

# Under the Hood

You don't need anything on this page to use BraitenBot — the editor and lessons
cover everything at the diagram level. This is for the curious: what the app
actually produces when you generate or upload a sketch, and how your work is saved.

## From diagram to sketch

When you click **Upload to robot** or **Generate code only**, BraitenBot turns your visual diagram into a complete
Arduino sketch (a `.ino` file) in four steps:

1. **Validate** — check the diagram for problems that would stop it from running
   (no sensors, missing or reserved pins, a node with too many inputs, a feedback
   cycle with no delay to break it, outputs not reachable from any sensor). If
   anything fails, BraitenBot shows the errors instead of generating code.
2. **Flatten** — expand every [compound node](./guide/compound-nodes) into its
   underlying nodes, so what's left is one flat circuit.
3. **Sort** — order the nodes so each one is computed after the nodes that feed
   it (see [execution order](./guide/connections#execution-order)).
4. **Emit** — write out the C++ code.

The result is a normal Arduino sketch with a `setup()` that initializes the
hardware and a `loop()` that, once per cycle, reads the sensors, computes each
node in order, and drives the wheels — then waits out the rest of the loop period
so timing stays consistent. Signals follow one convention throughout: sensors
read `0`–`100`, and internal values run `-100`–`100`.

A couple of details worth knowing:

- **Wheels** are driven through a small `drive()` helper. The right wheel is
  inverted because the two servos face opposite directions on the chassis. On
  Arduino Uno R4 (Renesas) boards, `drive()` also holds the wheels still and
  blinks the built-in LED while a USB cable is connected, so the robot can't
  drive off the bench while you're programming it.
- **Delay nodes** read the value they buffered a few iterations ago at the top of
  the loop, then store the new value at the end — the two-phase trick that lets
  feedback [cycles](./guide/connections#cycles-and-the-delay-node) work.

### Viewing and editing the sketch

The generated code is shown in the app, and you can copy it into the Arduino IDE
to read or modify it by hand. It's plain, readable Arduino — node labels become
variable names (e.g. a node labeled "Left Light" becomes `sig_Left_Light`), so
you can follow the diagram through the code. Per-node behavior (how each sensor,
compute node, and output is computed) follows directly from the
[node reference](./guide/nodes).

## Saving and sharing diagrams

Diagrams are saved as **`.bbot` files** (plain JSON inside) you can share, email,
or check into version control. BraitenBot also autosaves your current diagram to the browser's
local storage, so it's still there when you reopen the app. **File ▸ New** resets
to an empty canvas (with the two wheels), and **Save** / **Open** use a normal
file dialog.

:::caution[Alpha format]

BraitenBot is pre-1.0 software, and the file format may change between versions
without migration support. If a saved diagram fails to load after an update, use
**File ▸ New** and re-create it.

:::
