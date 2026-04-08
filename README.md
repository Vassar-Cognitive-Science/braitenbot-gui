# BraitenBot GUI

A **Progressive Web Application** for programming Braitenberg-style robots via
USB.  Built with TypeScript, React, and Vite.

---

## What is a Braitenberg Vehicle?

[Braitenberg Vehicles](https://en.wikipedia.org/wiki/Braitenberg_vehicle) are
simple thought-experiment robots whose emergent behaviour (fear, aggression,
love, curiosity) arises from wiring two sensors directly to two motors with
different connection weights.  This GUI lets you design and visualise such
wiring, simulate the result, and flash the configuration to an Arduino.

## Features

| Feature | Details |
|---|---|
| **Visual schematic** | SVG diagram of sensor → motor connections, styled by weight |
| **Connection editor** | Four sliders (LL, LR, RL, RR) in the range −1 … +1 |
| **Presets** | Vehicle 2a Coward · 2b Aggressor · 3a Lover · 3b Explorer |
| **Physics simulation** | Real-time differential-drive canvas; draggable light source |
| **USB upload** | Web Serial API (Chrome / Edge) uploads JSON weights to an Arduino |
| **PWA** | Installable, offline-capable via Workbox service worker |

## Arduino Protocol

The GUI sends newline-delimited JSON over serial (115 200 baud):

```json
{"ll":0.8,"lr":0.0,"rl":0.0,"rr":0.8}
```

| Field | Meaning |
|---|---|
| `ll` | Left sensor → Left motor weight |
| `lr` | Left sensor → Right motor weight |
| `rl` | Right sensor → Left motor weight |
| `rr` | Right sensor → Right motor weight |

Weights are floats in `[-1, 1]`.  Positive = excitatory; negative = inhibitory.

## Getting Started

### Prerequisites

- Node.js ≥ 18
- npm ≥ 9
- Google Chrome or Microsoft Edge (for Web Serial API)

### Development

```bash
npm install
npm run dev
```

Open <http://localhost:5173> in Chrome or Edge.

### Build (production)

```bash
npm run build
```

The output in `dist/` is a static site that can be served from any web host.

### Preview build

```bash
npm run preview
```

## Project Structure

```
src/
├── main.tsx                     # React entry point + PWA service worker
├── App.tsx                      # Root layout
├── App.css                      # Global styles
├── vite-env.d.ts                # Vite / PWA virtual module types
├── types/
│   ├── index.ts                 # Core TypeScript interfaces
│   └── serial.d.ts              # Web Serial API type declarations
├── serial/
│   └── ArduinoSerial.ts         # Web Serial API wrapper
├── hooks/
│   ├── useSerial.ts             # Serial connection lifecycle hook
│   └── useVehicle.ts            # Vehicle state + preset management hook
└── components/
    ├── Header.tsx               # App header with connection status
    ├── BraitenbergDiagram.tsx   # SVG schematic of sensor-motor wiring
    ├── ConnectionControls.tsx   # Slider panel for four connection weights
    ├── VehiclePresets.tsx       # Preset selector buttons
    ├── SimulationCanvas.tsx     # Canvas-based physics simulation
    └── ArduinoPanel.tsx         # Upload-to-Arduino UI
```

## Browser Compatibility

The **Web Serial API** is required for Arduino upload and is currently
supported in:

- Google Chrome 89+
- Microsoft Edge 89+

All other features (diagram, simulation, presets) work in any modern browser.

## License

MIT — see [LICENSE](LICENSE).
