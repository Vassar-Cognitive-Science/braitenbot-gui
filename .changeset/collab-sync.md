---
"braitenbot-gui": minor
---

Multi-user collaborative sessions: share a diagram with a 6-digit code and edit it together in real time.

- Diagram state now lives on a Yjs CRDT document (`src/doc/`); undo is per-user via `Y.UndoManager` and an invariant repair pass keeps concurrent edits semantically valid.
- Deterministic lockstep simulation: noise nodes draw from a PRNG keyed on (seed, node, tick) and oscillators/delays are tick-indexed, so every participant sees the same trace (and solo traces are reproducible).
- Ephemeral WebSocket relay (`relay/`, deployed at wss://cogsciresearch.vassar.edu/braitenbot-relay): rooms in RAM only, host confirm-admit, lock/remove, version handshake, per-IP rate limits.
- Session UX: Share menu, join-request toasts, connection indicator, separate autosave slot for guests plus keep-a-copy prompts so a guest's own diagram is never clobbered.
- Presence and roles: participant colors, remote selection outlines and drag ghosts, remote cursors, follow-the-host viewport, and a host-controlled edit/view-only role enforced at the document mutation layer.
- Shared trace mode: trace on/off, sensor inputs, seed, and pulses sync to all participants and are never persisted or exported.
