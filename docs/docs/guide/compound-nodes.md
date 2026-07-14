---
sidebar_position: 5
title: Compound Nodes
---

# Compound Nodes

Compound nodes let you encapsulate a sub-circuit into a reusable module. Instead of rebuilding the same pattern of nodes every time, you group them once and reuse the compound as a single node.

## Creating a compound

1. **Select** two or more nodes on the canvas (Shift+click to multi-select)
2. Click **Group** in the toolbar
3. BraitenBot creates a new compound type and replaces the selected nodes with a single compound instance

### What happens during grouping

- A new **compound type** is created with a unique name (e.g., "Compound 1")
- The selected nodes move into the compound's **body**, an internal diagram
- Connections that crossed the selection boundary become **port anchors**:
  - Connections entering the selection become **input ports**
  - Connections leaving the selection become **output ports**
- The original connection weights and transfer functions are preserved on the outer edges

### Restrictions

- **Wheel motors** (left/right) cannot be grouped; they're excluded silently
- You need at least 2 nodes to create a compound

## Editing a compound body

**Double-click** a compound instance to enter its body editor. The canvas switches to show the compound's internal diagram, with a breadcrumb trail at the top for navigation.

Inside the body, you'll see:

- **Input port** nodes (green, labeled with the port name): these receive signals from the outer diagram
- **Output port** nodes: these send signals out to the outer diagram
- **Internal nodes**: the original grouped nodes and their connections

You can add, remove, and rewire nodes inside the body just like the main canvas. Changes apply to all instances of this compound type.

Click the **Top** segment (or any earlier segment) in the breadcrumb trail to return to the main diagram.

## Using compound instances

Once created, the compound type appears in the **Compounds** section of the node palette. Drag it onto the canvas to create additional instances.

Each compound instance shows its input and output ports as connection handles. Wire them up just like any other node, specifying which port you're connecting to.

## Ungrouping

To expand a compound instance back into its constituent nodes:

1. Select the compound instance
2. Click **Ungroup** in the toolbar

The body nodes reappear on the main diagram, and their connections (both inside the former compound and to the rest of the diagram) are restored automatically.

## How compounds work under the hood

Both the trace simulation and the code generator **flatten** compound instances before processing them: each instance is recursively expanded into its body nodes, with IDs prefixed to avoid collisions. The result is a single flat graph with no compound or port nodes. This means compounds are purely an organizational tool: there's no runtime overhead, and each instance gets its own copy of the internal computation. For details on how this flattening works in the generated Arduino sketch, see the [code generation reference](../under-the-hood).

### Recursion prevention

A compound type cannot contain an instance of itself (directly or indirectly). BraitenBot detects recursive compound references and reports a validation error.

## Design patterns with compounds

### Sensor preprocessor

Group a sensor with a threshold or transfer curve into a compound. Now you can drop calibrated sensors without reconfiguring each one.

### Behavior module

Group a complete sensor-to-motor pathway (minus the wheel motors themselves) into a compound. Use this to build subsumption layers; see the [subsumption architecture lesson](../lessons/subsumption-architecture).

### Signal filter

Group delay + summation nodes into a compound to create a reusable latch circuit. See [latches with delay](../lessons/latches-with-delay).
