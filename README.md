# BraitenBot GUI

A **Tauri desktop application** for designing Braitenberg-style robot wiring
diagrams and uploading them to Arduino-compatible hardware. A web build for
GitHub Pages is also available for demo/classroom use.

---

## What is a Braitenberg Vehicle?

[Braitenberg Vehicles](https://en.wikipedia.org/wiki/Braitenberg_vehicle) are
simple thought-experiment robots whose emergent behaviour arises from wiring
sensors to motors. This GUI focuses on composing those circuits visually.

## Features

| Feature | Details |
|---|---|
| **Diagram-first editor** | Drag-and-drop vehicle circuit diagram |
| **Extensible sensors** | Analog, digital, and I2C sensor nodes |
| **Connections by dragging** | Drag links from node outputs to valid node inputs |
| **Intermediate compute nodes** | Threshold, delay, summation, and multiply nodes |
| **Arduino code generation** | Emit a `.ino` sketch from the diagram |
| **Desktop upload** | Upload to the robot via bundled `arduino-cli` (Tauri build) |
| **Web fallback** | Installable PWA build for browsers with Web Serial support |

## Getting Started

### Prerequisites

- Node.js ≥ 18
- npm ≥ 9
- Rust toolchain (for the Tauri desktop build — see [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/))

### Desktop (primary)

```bash
npm install
npm run tauri:dev     # run the desktop app in development
npm run tauri:build   # produce a distributable desktop bundle
```

`npm run tauri:dev` automatically runs the frontend dev server via Vite; you do
not need to run `npm run dev` separately.

### Web build (secondary, for GitHub Pages)

```bash
npm run dev:web       # Vite dev server with the PWA plugin enabled
npm run build:web     # static site output in dist/ (base path /braitenbot-gui/)
npm run preview       # preview the built site locally
```

## Project Structure

```
src/
├── main.tsx                     # React entry point
├── App.tsx                      # Root layout
├── App.css                      # Global styles
├── vite-env.d.ts                # Vite client type reference
├── types/
│   └── diagram.ts               # Core diagram types (nodes, connections, transfer curves)
├── components/
│   ├── BraitenbergDiagram.tsx   # Drag-and-drop node and connection editor
│   ├── SetupModal.tsx           # First-run Arduino setup dialog
│   └── TransferCurveEditor.tsx  # Per-connection transfer curve editor
├── hooks/
│   ├── useArduino.ts            # Arduino detect/compile/upload via Tauri
│   ├── useDiagramPersistence.ts # Local-storage persistence for the diagram
│   └── useTraceSimulation.ts    # Signal-flow simulation/tracing
├── codegen/                     # Diagram → .ino sketch emitter + validation
├── lib/
│   ├── diagramFile.ts           # Diagram import/export helpers
│   └── tauri.ts                 # Tauri environment detection + invoke helpers
src-tauri/                       # Rust Tauri shell (bundles arduino-cli)
```

## License

MIT — see [LICENSE](LICENSE).
