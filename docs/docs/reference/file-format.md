---
sidebar_position: 4
title: File Format
---

# File Format

BraitenBot diagrams are saved as JSON files. This page documents the file structure for anyone who wants to inspect, generate, or programmatically modify diagram files.

:::caution Alpha format
BraitenBot is pre-1.0 software. The file format may change between versions without migration support. If a saved diagram fails to load after an update, use **File > New** to reset and re-create the diagram.
:::

## Top-level structure

```json
{
  "loopPeriodMs": 20,
  "nodes": [ ... ],
  "connections": [ ... ],
  "compoundTypes": [ ... ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `loopPeriodMs` | number | Arduino main loop period in milliseconds (1–1000) |
| `nodes` | array | All nodes on the top-level canvas |
| `connections` | array | All connections on the top-level canvas |
| `compoundTypes` | array | Compound type definitions (optional, defaults to `[]`) |

## Node schema

```json
{
  "id": "sensor-analog-a1b2c3d4",
  "type": "sensor-analog",
  "label": "Left Light",
  "x": 150,
  "y": 200,
  "arduinoPort": "A0",
  "pullup": false,
  "invert": false,
  "threshold": 50,
  "delayMs": 100,
  "constantValue": 0,
  "frequencyHz": 1.0,
  "amplitude": 100,
  "servoPin": "",
  "clkPin": "",
  "gpioPin": "",
  "brightness": 3,
  "colorGain": 16,
  "xshutPin": "",
  "maxDistanceMm": 500,
  "compoundTypeId": ""
}
```

Only fields relevant to the node type are meaningful, but all fields are present in the serialized format.

| Field | Used by | Description |
|-------|---------|-------------|
| `id` | all | Unique identifier (`{type}-{uuid}`) |
| `type` | all | Node type ID (see [Node Types](./node-types)) |
| `label` | all | Display name |
| `x`, `y` | all | Canvas position |
| `arduinoPort` | sensors | Pin assignment (e.g., `"A0"`, `"2"`) |
| `pullup` | `sensor-digital` | Enable INPUT_PULLUP |
| `invert` | `sensor-analog`, `sensor-digital`, `sensor-tof` | Invert the signal |
| `threshold` | `compute-threshold`, `digital-out` | Threshold value |
| `delayMs` | `compute-delay` | Delay time in ms |
| `constantValue` | `constant` | Fixed output value (-100 to 100) |
| `frequencyHz` | `compute-oscillator` | Oscillation frequency in Hz |
| `amplitude` | `compute-oscillator`, `compute-noise` | Output amplitude |
| `colorGain` | `sensor-color` | RGBC gain (1, 4, 16, or 60) |
| `xshutPin` | `sensor-tof` | XSHUT control pin |
| `maxDistanceMm` | `sensor-tof` | Distance (mm) that maps to full signal |
| `servoPin` | servos, `digital-out` | Output pin number |
| `clkPin` | `display-tm1637` | Clock pin |
| `gpioPin` | `display-tm1637` | Data pin |
| `brightness` | `display-tm1637` | Display brightness (0–7) |
| `compoundTypeId` | `compound` | Reference to compound type definition |

## Connection schema

```json
{
  "id": "conn-e5f6g7h8",
  "from": "sensor-analog-a1b2c3d4",
  "fromPort": "",
  "to": "compute-threshold-i9j0k1l2",
  "toPort": "",
  "weight": 0.75,
  "transferMode": "linear",
  "transferPoints": []
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier |
| `from` | string | Source node ID |
| `fromPort` | string | Source port (for multi-output nodes; empty string if unused) |
| `to` | string | Target node ID |
| `toPort` | string | Target port (for compound instances; empty string if unused) |
| `weight` | number | Linear weight (-1 to +1) |
| `transferMode` | string | `"linear"` or `"nonlinear"` |
| `transferPoints` | array | Control points for non-linear mode |

### Transfer points

```json
{
  "transferPoints": [
    { "x": -100, "y": 0 },
    { "x": 20, "y": 0 },
    { "x": 100, "y": 100 }
  ]
}
```

Points are sorted by `x`. The `x` and `y` values range from -100 to 100.

## Compound type schema

```json
{
  "id": "compound-type-m3n4o5p6",
  "displayName": "Calibrated Sensor",
  "body": {
    "nodes": [ ... ],
    "connections": [ ... ]
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique type identifier |
| `displayName` | string | Name shown in palette and on instances |
| `body.nodes` | array | Nodes inside the compound (same schema as top-level nodes) |
| `body.connections` | array | Connections inside the compound |

The body may contain `compound-input` and `compound-output` port anchor nodes.

## localStorage

BraitenBot auto-saves to localStorage under the key:

```
braitenbot-gui:diagram:v1
```

The value is the same JSON format as the file. Saving is debounced (300ms delay after the last change).

## File I/O

BraitenBot supports saving and loading diagrams via the system file dialog:

- **Save**: serializes the diagram to JSON and writes to a user-chosen file
- **Load**: reads a JSON file, validates the structure, and replaces the current diagram
- **New**: resets to the default state (empty canvas with two wheel motors)
