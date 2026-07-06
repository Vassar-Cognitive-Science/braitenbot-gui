# Design: Collaborative Sync (multi-user sessions)

## Status: Proposed — not implemented

Decisions below were settled with the project owner in design discussion
(July 2026) and should be treated as constraints, not suggestions — e.g.
"exactly two roles" and "minimal server state" were explicit choices, not
defaults. This doc is the anchor for phasing the implementation; nothing here
ships yet.

## Goal

Google-Docs-style live collaboration on a diagram: a host shares their diagram,
guests join with a code, everyone edits (or watches) the same document in real
time, and everyone sees the same trace-mode simulation. Primary context is a
classroom: an instructor demonstrating, or a lab group co-designing one vehicle
and each uploading it to their own robot.

## Non-goals

- **Async collaboration.** No editing a shared doc while the host is offline.
  The durable copy of record stays the host's local save/export, exactly like
  today's single-user flow.
- **Accounts.** No sign-in, no user database. Joiners pick a display name.
- **Server-side documents.** No document storage, history, or versioning on
  the server. See "Server" below — this is a hard requirement, not a cut.
- **Handoff.** Host leaving ends the session (guests are prompted to keep a
  copy). Host migration is a possible v2.

## Rejected alternatives

- **Follow/broadcast mode** (one writer, N viewers over a WebSocket — roughly
  20% of this effort): rejected because true simultaneous editing is the
  goal. It remains the fallback if scope must shrink drastically.
- **OT / central-authority sync** (Google Docs' actual mechanism): requires
  the server to hold and transform the authoritative document, which
  conflicts with the minimal-server requirement. CRDTs move all merge logic
  to clients.
- **WebRTC peer-to-peer** and **host-broadcast trace simulation**: see the
  Server and Trace sections respectively.

## Architecture

### CRDT client-side merge (Yjs)

The shared document is a Yjs `Y.Doc`. Merging happens entirely client-side;
the server never interprets document content. Proposed doc structure:

| Yjs container | Contents |
|---|---|
| `nodes: Y.Map<Y.Map>` | keyed by node ID; each node's properties as individual entries so concurrent edits to different properties of one node merge cleanly |
| `connections: Y.Map<Y.Map>` | keyed by connection ID; weight, transferMode, transferPoints, labelT as entries |
| `compoundTypes: Y.Map<Y.Map>` | user-defined compound definitions |
| `trace: Y.Map` | session-ephemeral shared trace state (see "Trace mode"); **never exported to `.bbot`** and cleared when trace exits |

CRDTs guarantee convergence, not validity. A repair pass (run identically on
every client after each remote transaction) enforces semantic invariants:
connections whose endpoints were concurrently deleted are dropped, the
motor-left/motor-right singletons are preserved, transfer-curve endpoint
anchors stay at x = ±100.

### Server: an ephemeral relay, nothing more

A single small process (off-the-shelf `y-websocket`/Hocuspocus with
persistence **disabled**, a managed provider like PartyKit/y-sweet/Liveblocks
if operating a process is unwanted, or a ~100-line equivalent):

- Knows only "these WebSocket connections are in room `ABC123`" and relays
  Yjs update/awareness messages between them.
- Holds each room's `Y.Doc` in RAM only while the room is occupied (this makes
  late-join sync trivial and tolerates a brief host disconnect); drops it when
  the last client leaves. Diagrams are kilobytes — no database, no storage
  growth, no backups.
- Additionally handles the tiny session protocol: room creation, join
  requests, admit/deny, role flags, version handshake.

**Transport is plain WebSocket, not WebRTC.** Campus networks routinely block
WebRTC/NAT traversal; a WebSocket relay works everywhere HTTPS works.

Optional later hardening: clients encrypt updates end-to-end so the relay
handles opaque bytes (Excalidraw's model). Minimal state *and* minimal trust.

## Session model & UX

### Hosting and joining

- Toolbar menu entry (e.g. **Share → Start session**). Host gets a 6-digit
  code, valid only while the session is live; it dies with the session.
- Guests choose **Join session**, enter the code and a display name.
- **Confirm-admit**: the host sees a non-blocking toast/queue ("Sam wants to
  join — Admit / Deny"), never a modal that interrupts a drag. The display
  name is what makes admission meaningful. Host can also **lock** the session
  (stop accepting requests) and **remove** a participant.
- 6 digits (~1M codes) is acceptable *because* of confirm-admit plus
  server-side rate limiting on join attempts.

### Protecting the guest's own work

Joining replaces the guest's canvas with the host's diagram:

- Before joining: "Save your current diagram first?" prompt.
- The session document lives in a **separate persistence slot** from the
  guest's personal autosave — leaving a session must never clobber their own
  project.
- On leave or session end: "Keep a copy?" offer (saves into their own slot /
  exports a `.bbot`).

### Session lifecycle

- Host leaves or ends the session → session ends for everyone (with the
  keep-a-copy prompt). Every CRDT peer holds a full copy, so a host crash
  loses nothing for connected guests.
- Host file operations mid-session (New / Open / Import) are either disabled
  or gated behind "this will replace the shared diagram for all participants."
- **Connection status indicator** in the toolbar: synced / reconnecting /
  offline, with a banner on disconnect. CRDTs merge offline edits on
  reconnect, but users must know which state they're in.

### Roles

Host-controlled permission per session (per-participant later if needed):

1. **Edit** — full diagram editing, including trace-mode inputs.
2. **View-only** — no document mutations at all, trace inputs included.

### Presence

- Each participant gets a display name and an assigned color.
- Participant list in the session menu.
- **Remote selection outlines and live drag positions rendered in each
  user's color are required**, not optional — without them nodes appear to
  move by themselves. Remote mouse cursors are optional polish.
- **Follow-the-host mode** (guests' pan/zoom tracks the host's viewport) is
  cheap once awareness exists and is the single most classroom-valuable
  presence feature. Target for phase 3.

## Shared vs. per-user state

| Shared (in Y.Doc) | Per-user (local React state) |
|---|---|
| Nodes, connections, weights, transfer curves | Pan, zoom, block scale |
| Compound type definitions | Selection, config panel target |
| Trace mode on/off | Which compound sub-diagram you're inside |
| Trace sensor/input values (ephemeral) | Arduino detection, port, upload, serial monitor |
| Trace pulse events (ephemeral) | Oscilloscope panel open/closed |

Per-robot upload from a shared design is a headline classroom feature: the
group designs one vehicle, each student uploads to their own board. Surface
this in the UI rather than leaving it implicit.

## Trace mode: shared, via deterministic lockstep simulation

**Decision: trace mode syncs — everyone sees the same trace.** Entering trace
flips it for all participants; sensor slider values live in the shared
`trace` map. The known wrinkle that the in-node constant slider writes
`constantValue` (shared document state) is accepted — presence colors make
"whose hand is on the slider" visible and people negotiate socially.

"Same trace" requires cross-client determinism. Two node types currently
break it: noise nodes call `Math.random()`, and oscillators/delays depend on
local wall-clock timing. **Chosen approach: deterministic lockstep** —

- The session establishes a shared PRNG seed and a shared tick counter
  (epoch + tick length; ticks are counted, not measured).
- Noise nodes draw from a PRNG keyed on (seed, node ID, tick index).
- Oscillators and delays compute from tick count, not elapsed wall time.
- Every client runs the simulation locally and produces bit-identical traces;
  no simulation traffic on the wire, and a lagging client degrades gracefully.
- The pulse button becomes a shared timestamped event in the `trace` map so
  everyone sees the same 200 ms blip.

Rejected alternative: host simulates and broadcasts samples — simpler
mentally, but streams data continuously and the trace dies when the host
hiccups.

Side benefit: seeded, tick-based simulation makes single-user traces
reproducible (good for teaching and for tests). Worth landing as its own
refactor even before sync.

## Undo

Ctrl+Z undoes **your** edits only, never another participant's last action.
`Y.UndoManager` scoped by transaction origin provides this; it replaces the
current whole-diagram snapshot stack (which cannot survive the CRDT refactor
anyway).

## Versioning & compatibility

- The very first handshake message carries a protocol/app version.
- Mismatch → reject the join with a clear message ("host is running v0.5.2 —
  update to join"). Warn + require upgrade; no compatibility shims.
- This is consistent with the alpha no-migrations policy (CLAUDE.md): two app
  versions with different node schemas must never co-edit one document.

## Code touchpoints (as of July 2026 — verify against current code)

What the current implementation looks like where sync will land:

- `src/components/BraitenbergDiagram.tsx` (~1900 lines) owns `nodes`,
  `connections`, and `compoundTypes` as plain React arrays mutated wholesale
  via `setNodes(prev => ...)`-style updates. Every one of these mutation
  paths becomes a granular Yjs transaction in phase 1.
- Undo/redo is a **whole-diagram snapshot stack** inside the same component
  (`pushUndo` before each mutation). It cannot survive the CRDT refactor and
  is replaced by `Y.UndoManager`.
- `src/hooks/useDiagramPersistence.ts` handles localStorage autosave — the
  place to add the separate session-document slot.
- `src/hooks/useScopeSimulation.ts` and `src/hooks/useTraceSimulation.ts` run
  the trace/scope simulation; noise nodes use `Math.random()` and timing is
  wall-clock — the phase-2 determinism refactor lands here.
- `src/components/DiagramNodeView.tsx` renders the in-node trace sliders.
  Sensor sliders write local `sensorValues` state, but the **constant**
  slider writes `node.constantValue` into the document — the shared/local
  boundary runs through this file.
- Trace-input state is `sensorValues: Record<string, number>` in
  BraitenbergDiagram (keyed by node ID, or `nodeId:channel` for color
  sensors); this is what moves into the shared ephemeral `trace` map.
- View-only enforcement has no existing hook — mutations are scattered event
  handlers, so a role check likely belongs in a single mutation layer
  introduced by the phase-1 refactor rather than per-handler guards.

## Implementation phases

1. **Refactor diagram state onto a Y.Doc (single-user).** The dominant cost.
   Every mutation path in `BraitenbergDiagram.tsx` (drag, connect, delete,
   config edits, compound editing, palette drops, trace constant slider,
   keyboard nudges) becomes a granular Yjs transaction; React state derives
   from the doc; undo moves to `Y.UndoManager`; invariant repair pass added.
   Ships invisibly — app behaves identically. *(weeks)*
2. **Deterministic simulation.** Seeded PRNG + tick-based
   `useScopeSimulation`/`useTraceSimulation`. Also ships invisibly, useful on
   its own. *(days)*
3. **Relay server + session UX.** Deploy relay; host/join/admit/lock/remove
   flows; separate session persistence slot; save-a-copy prompts; connection
   indicator; version handshake. *(days, given off-the-shelf provider)*
4. **Presence, roles, shared trace.** Colors, selection outlines, drag
   ghosts, participant list; edit/view-only toggle; shared trace map + pulse
   events; follow-the-host. *(1–2 weeks of accumulating polish)*

MVP cut line: phases 1–3 plus selection outlines and the edit/view-only
toggle. Remote cursors and follow mode layer on after.

## Open questions

- Where does the relay run (institutional host vs. cheap PaaS), and who
  operates it?
- Session persistence slot UX: does a guest's kept copy become "Untitled
  (from session)" or prompt for a name?
- Should the host's autosave keep writing during a session (it is the copy of
  record), and how is that surfaced?
- Tick length for lockstep simulation (current sim tick vs. a coarser shared
  tick), and how scope buffers align across late joiners.
