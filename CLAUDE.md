# BraitenBot GUI: Claude Code Configuration

## Project Overview

BraitenBot GUI is a Tauri desktop application for visually designing
Braitenberg vehicle wiring diagrams. Users drag-and-drop sensor, compute, and
motor nodes onto a canvas, connect them with weighted links, and upload
generated Arduino sketches to the robot via a bundled `arduino-cli`. A
Docusaurus documentation site in `docs/` is published to GitHub Pages as the
project's main website.

## Tech Stack

- **Framework**: React 18 + TypeScript 5
- **Shell**: Tauri 2 (Rust), primary distribution target
- **Build**: Vite 8 (Tauri frontend)
- **Styling**: Plain CSS (dark theme, CSS variables in `src/App.css`)
- **Rendering**: DOM-based (positioned divs + SVG paths for connections, no `<canvas>`)

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
| `src/components/BraitenbergDiagram.tsx` | Core diagram editor: node/connection state, drag-drop, robot overlay, config panel |
| `src/components/Oscilloscope.tsx` | Real-time signal oscilloscope panel driven by `useScopeSimulation` |
| `src/components/NumberInput.tsx` | Controlled numeric input with keyboard/scroll increment |
| `src/components/SetupModal.tsx` | First-run Arduino detection/setup dialog |
| `src/components/TransferCurveEditor.tsx` | Per-connection transfer curve editor |
| `src/components/DiagramNodeView.tsx` | Single-node renderer (label, type glyph, handles, trace controls); holds the `NODE_TYPE_ICONS` map |
| `src/components/CommentView.tsx` | Movable/resizable annotation note drawn behind nodes |
| `src/components/SettingsModal.tsx` | App-preferences dialog (weight cap, loop period, trace pulse duration) |
| `src/components/icons.tsx` | Inline-SVG icon set (toolbar buttons + per-node-type glyphs) |
| `src/settings/appSettings.ts` | Cross-diagram app preferences (localStorage) |
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
- **Compute**: `compute-threshold`, `compute-delay`, `compute-summation`, `compute-multiply`, `compute-min`, `compute-max`, `compute-oscillator`, `compute-noise`
- **Constants**: `constant`, fixed-value input
- **Outputs**: `servo-cr` (continuous servo), `servo-positional`, `digital-out`, `display-tm1637` (7-segment)
- **Compound**: `compound`, a user-defined sub-diagram instance; `compound-input` / `compound-output` port anchors (body-only)

### Diagram Data Model

- `DiagramNode[]`: positioned nodes with type, label, and type-specific parameters
- `DiagramConnection[]`: weighted edges with per-edge transfer curves (weight range: −1 to +1)

### Robot Overlay

The robot is rendered as a top-down view in the center of the canvas:
- Circular body
- Two rounded-rectangle wheels at the left/right edges
- Motor nodes anchored to wheel positions

## Adding a new node type

Every node type is expected to be complete on all of these fronts. A new
block that skips one reads as half-finished. When adding one, touch:

1. **`src/types/diagram.ts`**: add the id to the `NodeTypeId` union and an
   entry to the `NODE_TYPES` registry (kind, `displayName`, `metaLabel`,
   `mode`, port flags).
2. **`src/components/icons.tsx`**: add a glyph. *Every node type has a
   per-node icon shown before its label; there are no exceptions.* Follow the
   existing lucide-style convention (24×24 viewBox, `currentColor` stroke).
3. **`src/components/DiagramNodeView.tsx`**: register the glyph in the
   `NODE_TYPE_ICONS` map (the map is keyed by every `NodeTypeId`, so a new
   type won't type-check until it's added).
4. **`src/components/palettePresets.ts`**: add the palette entry (Basic
   and/or Advanced) with any pre-filled pins/params.
5. **`src/codegen/emitter.ts`**: emit the node's Arduino code for its `mode`.
6. **`src/hooks/useTraceSimulation.ts`**: implement its trace-mode behavior
   so simulation matches the generated sketch.
7. **Docs**: add a reference entry in `docs/docs/guide/nodes.md` and list it
   in the palette sections of `docs/docs/getting-started/editor.md`.

Kinds are color-coded consistently across the app and docs: orange sensors,
blue compute, green outputs, purple compounds (CSS vars `--sensor-color`,
`--compute-color`, `--output-color`, `--compound-color`).

## Keeping docs in sync

`docs/` is the public website, so treat user-visible changes as incomplete
until the docs match. When a feature commit changes what the user sees, update
the relevant page in the same change:

- New/changed node type → `guide/nodes.md`, `getting-started/editor.md`
- Toolbar / menu / Settings changes → `getting-started/editor.md`
- Trace / simulation behavior → `guide/simulation.md`
- Connection or weight behavior → `guide/connections.md`

## Website audience story (docs/ homepage)

The homepage splits visitors into two audiences with two CTAs, and the app
should be pitched to each differently:

- **"I'm a student"**: students are who the desktop app is *for*: the whole
  course is bundled in (works offline) and it's the only way to upload a
  circuit onto a real robot. So the app pitch is prominent for them. This CTA
  opens the `InstallModal` (`docs/src/components/InstallModal/`), triggered
  via `openInstallModal()` in `docs/src/lib/installModal.ts`; the modal's
  secondary action ("Continue to lessons") sends them on to `/docs/`.
- **"I'm running a class"**: educators are evaluating/planning, not the ones
  who need the app front-and-center. The app is *mentioned* on the teaching
  page (`docs/docs/teaching-with-braitenbot.md`) but stays subordinate to
  course/curriculum content. This CTA is a plain link, no modal.

The install prompt must **never auto-pop** on load: pitching the app to
everyone before they've said who they are is the intrusiveness we removed.
It only appears on the explicit student CTA. It also never shows inside the
app's Lessons iframe (`isEmbeddedInApp`) or on `/install`.

This student/instructor split carries into navigation too (`docs/sidebars.ts`).
The student sidebar (`softwareSidebar`) is just three sections: Lessons,
Install & Setup, and Keep Building (the renamed Reference category).
The instructor sidebar (`instructorSidebar`) is a superset of those student
docs plus three instructor-only extras: the teaching page (lead), a Quick
Reference of condensed wiring patterns (`docs/docs/quick-reference.md`,
extracted from the old teaching-page cookbook), and Under the Hood (moved out
of the student nav to the end here). The teaching page and Quick Reference
select `instructorSidebar` via `displayed_sidebar` in their frontmatter.
Students are never linked to the teaching page or Quick Reference from
student-reachable pages (intro, lessons) or from in-app content; the only
instructor entry point is the homepage's "I'm running a class" CTA.

## Conventions

- Strict TypeScript (`strict: true` in tsconfig)
- CSS class names use kebab-case (e.g., `.diagram-node`, `.robot-wheel`)
- Node IDs use `{type}-{uuid}` format
- No external UI library: all components are hand-rolled
- Dark theme with CSS variables (`--bg`, `--surface`, `--accent`, etc.)

## Alpha-stage policy: no migrations

This is a pre-1.0 alpha. The diagram file format and localStorage schema are
not stable, and there are no real users with persisted data to protect. Do
**not** add migration code, version fields, legacy-shape adapters, or
defensive clamps for "old" values when changing the data model. If a schema
change breaks existing saved diagrams, the answer is to clear localStorage
or re-export the file, not to write migration scaffolding. Revisit this
policy when we cut a 1.0.
