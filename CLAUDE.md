# BraitenBot GUI — Claude Code Configuration
 
## Project Overview
 
BraitenBot GUI is a Progressive Web Application for visually designing Braitenberg vehicle wiring diagrams. Users drag-and-drop sensor, compute, and motor nodes onto a canvas, connect them with weighted links, and upload configurations to Arduino-compatible robots via the Web Serial API.
 
## Tech Stack
 
- **Framework**: React 18 + TypeScript 5
- **Build**: Vite 5 with `vite-plugin-pwa`
- **Styling**: Plain CSS (dark theme, CSS variables in `src/App.css`)
- **Rendering**: DOM-based (positioned divs + SVG paths for connections — no `<canvas>`)
- **Deployment**: Static site served from `/braitenbot-gui/` base path
 
## Commands
 
```bash
npm install        # install dependencies
npm run dev        # start Vite dev server (localhost:5173)
npm run build      # typecheck then production build (tsc && vite build)
npm run preview    # preview production build locally
npm run lint       # ESLint with strict TypeScript rules (zero warnings)
```
 
## Architecture
 
### Key Files
 
| File | Purpose |
|---|---|
| `src/components/BraitenbergDiagram.tsx` | Core diagram editor — node/connection state, drag-drop, robot overlay, config panel |
| `src/App.css` | All styling (layout, nodes, robot overlay, config panel) |
| `src/App.tsx` | Root component wrapping `BraitenbergDiagram` |
| `src/serial/ArduinoSerial.ts` | Web Serial API wrapper for Arduino communication |
| `src/hooks/useVehicle.ts` | Legacy vehicle weight/preset management |
| `src/hooks/useSerial.ts` | Serial connection lifecycle hook |
| `src/types/index.ts` | Core TypeScript interfaces |
 
### Node Types
 
- **Sensors**: `analog`, `digital`, `i2c` — configurable Arduino port
- **Compute**: `threshold` (threshold value), `comparator` (comparison operator), `delay` (delay in ms) — intermediate signal processing
- **Motors**: `motor` — two per diagram (left/right), anchored to robot wheels
 
### Diagram Data Model
 
- `DiagramNode[]` — positioned nodes with type, label, and type-specific parameters
- `DiagramConnection[]` — weighted edges between node outputs and inputs (weight range: −1 to +1)
 
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