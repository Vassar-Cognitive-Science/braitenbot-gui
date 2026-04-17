# BraitenBot GUI — Claude Code Configuration

## Project Overview

BraitenBot GUI is a Tauri desktop application for visually designing
Braitenberg vehicle wiring diagrams. Users drag-and-drop sensor, compute, and
motor nodes onto a canvas, connect them with weighted links, and upload
generated Arduino sketches to the robot via a bundled `arduino-cli`. A
secondary PWA build targets GitHub Pages for browser-based demo use.

## Tech Stack

- **Framework**: React 18 + TypeScript 5
- **Shell**: Tauri 2 (Rust) — primary distribution target
- **Build**: Vite 5 (default = Tauri frontend; `--mode web` enables `vite-plugin-pwa`)
- **Styling**: Plain CSS (dark theme, CSS variables in `src/App.css`)
- **Rendering**: DOM-based (positioned divs + SVG paths for connections — no `<canvas>`)

## Commands

```bash
npm install          # install dependencies
npm run tauri:dev    # run the desktop app (primary dev workflow)
npm run tauri:build  # produce a distributable desktop bundle
npm run dev          # frontend-only Vite dev server (Tauri mode, no shell)
npm run build        # frontend-only production build for Tauri
npm run dev:web      # PWA/web build dev server
npm run build:web    # PWA/web production build for GitHub Pages
```

## Architecture

### Key Files

| File | Purpose |
|---|---|
| `src/components/BraitenbergDiagram.tsx` | Core diagram editor — node/connection state, drag-drop, robot overlay, config panel |
| `src/components/SetupModal.tsx` | First-run Arduino detection/setup dialog |
| `src/components/TransferCurveEditor.tsx` | Per-connection transfer curve editor |
| `src/App.css` | All styling (layout, nodes, robot overlay, config panel) |
| `src/App.tsx` | Root component wiring the diagram and setup modal |
| `src/hooks/useArduino.ts` | Arduino detection + compile/upload via Tauri |
| `src/hooks/useDiagramPersistence.ts` | Local-storage persistence for diagrams |
| `src/hooks/useTraceSimulation.ts` | Signal-flow simulation/tracing |
| `src/lib/tauri.ts` | Tauri environment detection + invoke helpers |
| `src/lib/diagramFile.ts` | Diagram import/export |
| `src/codegen/` | Diagram → `.ino` sketch emitter, validation, topo sort |
| `src/types/diagram.ts` | Core TypeScript interfaces |
| `src-tauri/` | Rust Tauri shell (bundles `arduino-cli`) |

### Node Types

- **Sensors**: `sensor-analog`, `sensor-digital`, `sensor-i2c` — configurable Arduino port
- **Compute**: `compute-threshold`, `compute-delay`, `compute-summation`, `compute-multiply` — intermediate signal processing
- **Constants**: `constant` — fixed-value input
- **Actuators**: `motor`, `servo` — outputs (two motors per diagram anchor to the wheels)

### Diagram Data Model

- `DiagramNode[]` — positioned nodes with type, label, and type-specific parameters
- `DiagramConnection[]` — weighted edges with per-edge transfer curves (weight range: −1 to +1)

### Robot Overlay

The robot is rendered as a top-down view in the center of the canvas:
- Circular body
- Two rounded-rectangle wheels at the left/right edges
- Motor nodes anchored to wheel positions

## Conventions

- Strict TypeScript (`strict: true` in tsconfig)
- CSS class names use kebab-case (e.g., `.diagram-node`, `.robot-wheel`)
- Node IDs use `{type}-{uuid}` format
- No external UI library — all components are hand-rolled
- Dark theme with CSS variables (`--bg`, `--surface`, `--accent`, etc.)
