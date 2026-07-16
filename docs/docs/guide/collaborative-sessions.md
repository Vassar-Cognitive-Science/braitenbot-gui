---
sidebar_position: 7
title: Collaborative Sessions
---

# Collaborative Sessions

Collaborative sessions let multiple people edit one diagram at the same time: the classroom case is an instructor demonstrating, or a lab group co-designing a vehicle and each uploading it to their own robot. Everyone sees the same diagram, the same trace, and the same signal-flow simulation in real time.

## Starting a session (host)

1. Click **Share** in the toolbar and choose **Start session**.
2. Enter a display name (what your guests will see) and click **Start session**.
3. The button now reads **Hosting XXXXXX**: that six-digit code is what guests need to join. Click the button to open the menu, then **Copy** to grab the code.

Your local diagram is what everyone starts editing. It stays on your machine; the relay never stores it.

## Joining a session (guest)

1. Click **Share → Join session…** in the toolbar.
2. Enter the 6-digit code and a display name, then click **Request to join**.
3. Wait for the host to admit you; they see a toast with your name and **Admit** / **Deny** buttons.
4. Your canvas is replaced by the shared diagram. Your own work is preserved; see [Protecting your own diagram](#protecting-your-own-diagram).

If the host has locked the session or ends it before admitting you, you'll see a message and stay on your own diagram.

## While you're in a session

- **Connection status dot** on the Share button indicates synced / reconnecting / offline.
- **Participant list** in the Share menu shows every participant with their color swatch and role.
- **Presence**: everyone's selection outline and drag ghost is drawn in their assigned color, so you can tell whose hand is on the node you're watching.
- **Diagram preferences** (connection-weight cap, sketch loop period, trace pulse duration) are part of the shared diagram, so the **host's** values apply to everyone and are read-only for view-only guests. Your **personal preferences** (e.g. auto-selecting an identified board) stay on your own device.

### Roles: Edit vs. View

The host sets each participant's role from the participant list:

- **Edit**: full editing, including trace-mode sensor inputs.
- **View**: no document mutations, no trace inputs. Good for demonstrations where the class watches without interfering.

### Follow the host

Guests get a **Follow host** toggle in the Share menu. Turning it on locks your pan and zoom to the host's viewport, which is useful when the host is walking through a diagram and pointing at things. Panning or zooming manually stops following.

Follow becomes available once the host has published a viewport; if the host hasn't panned or zoomed yet, the option is disabled.

## Trace mode is shared

When you enter [trace mode](./simulation) during a session, trace flips on for everyone. Sensor sliders, the shared seed, and pulse buttons all sync: every participant sees the same numbers and the same 200 ms pulse blips at the same instant.

The trace state is session-ephemeral. It is never persisted to your file, and it clears when you exit trace mode.

## Host controls

The Share menu shows these host-only actions once a session is running:

- **Copy code**: copy the six-digit join code.
- **Change a participant's role**: the dropdown next to each name.
- **Remove a participant** (✕): kicks them out of the session. They're offered a copy of the shared diagram.
- **Lock session**: stop accepting new join requests. Toggle **Unlock session** to accept again.
- **End session…**: ends the session for everyone. Each guest is offered a copy of the shared diagram; your diagram stays on your canvas.

If you (as host) leave, the session ends the same way.

## Protecting your own diagram

Joining a session replaces your canvas with the host's diagram, but your own work is safe:

- The session diagram lives in a **separate autosave slot**, so nothing you do in the session touches your personal diagram.
- If you had unsaved changes before joining, the Join dialog offers **Export my diagram…** to write a `.bbot` file first.
- When you leave (or the host ends the session), you're prompted to **Keep a copy** of the shared diagram (saves as your personal diagram), **Export .bbot** (writes a file), or **Don't keep** (return to your personal diagram unchanged).

If the host removes you or the session ends unexpectedly, you get the same keep-a-copy prompt.

## Reconnecting

If your network drops mid-session, a banner appears: **Connection lost, reconnecting to the session…**. BraitenBot GUI keeps trying, and any edits you make while offline merge cleanly with everyone else's when you come back: the underlying CRDT sync (Yjs) means concurrent edits from different people converge without a "last write wins" fight.

## Requirements

- **Same app version.** The host and all guests must run the same BraitenBot GUI version. A mismatched guest is refused at handshake with a clear message; update to match, then rejoin.
- **Outbound WebSocket to the relay.** Sessions run over `wss://` to the project's ephemeral relay. Locked-down networks that block WebSockets will block sessions.

## Self-hosting the relay

The relay is a small standalone WebSocket server that only brokers session traffic: it holds each room's live diagram in memory (a Yjs document) for the life of the session and never writes it to disk. If you'd rather not depend on the project's relay (for a classroom on an isolated network, or to keep session traffic on your own infrastructure) you can run your own.

### Run the server

The relay lives in the `relay/` directory of the [source repository](https://github.com/Vassar-Cognitive-Science/braitenbot-gui) and has no dependency on the desktop app. From a checkout:

```bash
npm install
npm run relay:dev          # dev: runs relay/src/index.ts on ws://localhost:1234
# or, for a build:
npm run relay:build        # compiles to relay/dist/
node relay/dist/index.js   # runs the compiled server
```

Environment variables:

- `RELAY_PORT` (or `PORT`): port to listen on (default `1234`).
- `RELAY_HOST`: interface to bind (default: all interfaces).
- `RELAY_TRUST_PROXY=1`: trust the `X-Forwarded-For` header for the client IP. Set this **only** when the relay sits behind a reverse proxy (Apache/nginx) that overwrites the header; otherwise clients could spoof it to bypass the per-IP rate limits.

For anything beyond localhost, put the relay behind a reverse proxy that terminates TLS so clients can reach it over `wss://`. Browsers block insecure `ws://` from a secure page, and the desktop app expects `wss://` for anything off your machine.

### Point the app at it

Open **Settings → Advanced** and set **Collaboration relay URL** to your server's WebSocket URL (e.g. `wss://relay.example.edu/braitenbot` or `ws://localhost:1234` for local testing). Leave it blank to fall back to the built-in relay.

This is a personal, per-device preference: it only affects sessions you start or join from this machine, and it takes effect the next time you host or join. **Everyone in a session must use the same relay**: the host and all guests need matching relay URLs, since a room only exists on the relay that created it.

(The default relay endpoint can also be fixed at build time with the `VITE_RELAY_URL` environment variable if you distribute your own build.)

## What is (and isn't) synced

Shared across the session:

- Nodes, connections, weights, transfer curves
- Compound-node definitions
- Trace mode on/off, sensor inputs, pulses (ephemeral: not persisted, not exported)

Per-user (stays local):

- Pan, zoom, block scale
- Selection and config panel
- Which compound you're viewing inside
- Arduino detection, upload, and serial monitor: **each participant uploads to their own robot**

The last point is a headline classroom feature: the group co-designs one vehicle, and each student uploads it to the robot on their own bench.
