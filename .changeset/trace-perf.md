---
"braitenbot-gui": patch
---

Trace mode is much faster on large diagrams. The simulation now compiles a structural plan (flattened graph, topo order, edge adjacency, pre-sorted transfer curves) once per edit instead of rebuilding it every tick — removing an O(nodes × edges) per-tick cost — and diagram nodes only re-render when their displayed value actually changes, with on-canvas numbers updating at ~10Hz while the simulation and oscilloscope keep full tick rate. Traces are bit-identical to before.
