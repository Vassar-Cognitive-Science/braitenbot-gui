# BraitenBot GUI — Claude Code Configuration

## Project Overview

BraitenBot GUI is a Tauri desktop application for visually designing
Braitenberg vehicle wiring diagrams. Users drag-and-drop sensor, compute, and
motor nodes onto a canvas, connect them with weighted links, and upload
generated Arduino sketches to the robot via a bundled `arduino-cli`. A
Docusaurus documentation site in `docs/` is published to GitHub Pages as the
project's main website.

## Tech Stack

- **Framework**: React 18 + TypeScript 5
- **Shell**: Tauri 2 (Rust) — primary distribution target
- **Build**: Vite 8 (Tauri frontend)
- **Styling**: Plain CSS (dark theme, CSS variables in `src/App.css`)
- **Rendering**: DOM-based (positioned divs + SVG paths for connections — no `<canvas>`)

## Commands

```bash
npm install          # install dependencies
npm run tauri:dev    # run the desktop app (primary dev workflow)
npm run tauri:build  # produce a distributable desktop bundle
npm run dev          # frontend-only Vite dev server (Tauri mode, no shell)
npm run build        # frontend-only production build for Tauri
npm run typecheck    # tsc --noEmit (fast type check, no output)
npm run lint         # ESLint (flat config, --max-warnings 0)
npm test             # vitest run (unit tests)
```

## Architecture

### Key Files

| File | Purpose |
|---|---|
| `src/components/BraitenbergDiagram.tsx` | Core diagram editor — node/connection state, drag-drop, robot overlay, config panel |
| `src/components/Oscilloscope.tsx` | Real-time signal oscilloscope panel driven by `useScopeSimulation` |
| `src/components/NumberInput.tsx` | Controlled numeric input with keyboard/scroll increment |
| `src/components/SetupModal.tsx` | First-run Arduino detection/setup dialog |
| `src/components/TransferCurveEditor.tsx` | Per-connection transfer curve editor |
| `src/App.css` | All styling (layout, nodes, robot overlay, config panel) |
| `src/App.tsx` | Root component wiring the diagram and setup modal |
| `src/hooks/useArduino.ts` | Arduino detection + compile/upload via Tauri |
| `src/hooks/useDiagramPersistence.ts` | Local-storage persistence for diagrams |
| `src/hooks/useScopeSimulation.ts` | Tick-stepped simulation loop with rolling scope buffers |
| `src/hooks/useTraceSimulation.ts` | Signal-flow simulation/tracing |
| `src/lib/tauri.ts` | Tauri environment detection + invoke helpers |
| `src/lib/diagramFile.ts` | Diagram import/export |
| `src/codegen/` | Diagram → `.ino` sketch emitter, validation, topo sort |
| `src/types/diagram.ts` | Core TypeScript interfaces |
| `src-tauri/` | Rust Tauri shell (bundles `arduino-cli`) |

### Node Types

- **Sensors**: `sensor-analog`, `sensor-digital`, `sensor-color` (TCS34725 RGBC), `sensor-tof` (VL53L4CD ToF distance)
- **Compute**: `compute-threshold`, `compute-delay`, `compute-summation`, `compute-multiply`, `compute-oscillator`, `compute-noise`
- **Constants**: `constant` — fixed-value input
- **Outputs**: `servo-cr` (continuous servo), `servo-positional`, `digital-out`, `display-tm1637` (7-segment)
- **Compound**: `compound` — user-defined sub-diagram instance; `compound-input` / `compound-output` port anchors (body-only)

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

## Alpha-stage policy: no migrations

This is a pre-1.0 alpha. The diagram file format and localStorage schema are
not stable, and there are no real users with persisted data to protect. Do
**not** add migration code, version fields, legacy-shape adapters, or
defensive clamps for "old" values when changing the data model. If a schema
change breaks existing saved diagrams, the answer is to clear localStorage
or re-export the file — not to write migration scaffolding. Revisit this
policy when we cut a 1.0.
