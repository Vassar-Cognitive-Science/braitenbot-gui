# BraitenBot GUI

A **Progressive Web Application** for building Braitenberg-style robot wiring
diagrams. Built with TypeScript, React, and Vite.

---

## What is a Braitenberg Vehicle?

[Braitenberg Vehicles](https://en.wikipedia.org/wiki/Braitenberg_vehicle) are
simple thought-experiment robots whose emergent behaviour arises from wiring
sensors to motors. This GUI focuses on composing those circuits visually.

## Features

| Feature | Details |
|---|---|
| **Diagram-first editor** | Main interface is a drag-and-drop vehicle circuit diagram |
| **Extensible sensors** | Analog and digital sensor nodes now, schema supports protocol-specific types (for example I2C) |
| **Connections by dragging** | Drag links from node outputs to valid node inputs |
| **Intermediate compute nodes** | Threshold, comparator, and delay nodes can be inserted between sensors and motors |
| **PWA** | Installable, offline-capable via Workbox service worker |

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
│   └── useVehicle.ts            # Legacy weight/preset hook
└── components/
    ├── BraitenbergDiagram.tsx   # Drag-and-drop node and connection editor
    ├── Header.tsx               # Legacy serial connection header
    ├── ConnectionControls.tsx   # Legacy four-weight control panel
    └── ArduinoPanel.tsx         # Legacy upload UI
```

## Browser Compatibility

All editor features work in modern browsers.

## License

MIT — see [LICENSE](LICENSE).
