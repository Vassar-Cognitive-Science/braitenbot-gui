# Plan: Diagram-to-Arduino Code Generation — IMPLEMENTED

## Status: Complete

All phases have been implemented and tested.

## What was built

### Phase 0 — Type Extraction
- Extracted `DiagramNode`, `DiagramConnection`, and related types to `src/types/diagram.ts`
- Added `motorPinFwd` and `motorPinRev` fields to `DiagramNode`
- Motor pin config UI added to the config panel

### Phase 1 — Internal Graph Representation
- `src/codegen/graph.ts` — `WiringGraph`, `GraphNode`, `GraphEdge`, `buildGraph()`
- `src/codegen/toposort.ts` — Kahn's algorithm with `CycleError`

### Phase 2 — Validation
- `src/codegen/validate.ts` — 8 validation checks (missing ports, unreachable motors, cycles, comparator inputs, orphan nodes, I2C warnings)

### Phase 3 — Code Generation
- `src/codegen/emitter.ts` — `generateSketch()` producing complete `.ino` files
- Handles analog/digital/I2C sensors, threshold/comparator/delay compute nodes, motor PWM output
- Signal domain: sensors 0–1023, weights [-1,1], PWM 0–255

### Phase 4 — UI Integration
- "Generate Arduino Code" button in palette sidebar
- Code preview dialog with copy-to-clipboard and download-as-.ino
- Validation error display (red errors, yellow warnings)

### Phase 5 — Testing
- 21 tests across toposort, validation, and emitter modules
- All passing via `npx vitest run`

## Resolved Design Decisions

1. **Compiled sketch** (not runtime interpreter) — simpler, more transparent
2. **I2C sensors** — stub with TODO comment for v1
3. **Motor pins** — configurable in UI via Forward Pin / Reverse Pin fields
