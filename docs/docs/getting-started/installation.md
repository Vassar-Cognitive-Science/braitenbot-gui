---
sidebar_position: 1
title: Installation
---

# Installation

## Download

The app includes everything you need: the visual editor, signal simulation, and built-in Arduino upload.

### Download

Download the latest release for your platform from the [GitHub releases page](https://github.com/jspsych/braitenbot-gui/releases).

| Platform | File |
|----------|------|
| macOS (Apple Silicon) | `BraitenBot_aarch64.dmg` |
| macOS (Intel) | `BraitenBot_x64.dmg` |
| Windows | `BraitenBot_x64-setup.exe` |
| Linux (Debian/Ubuntu) | `BraitenBot_amd64.deb` |
| Linux (AppImage) | `BraitenBot_amd64.AppImage` |

### macOS

1. Open the `.dmg` file
2. Drag BraitenBot to your Applications folder
3. On first launch, right-click the app and select **Open** (macOS Gatekeeper requires this for unsigned apps)

### Windows

Run the installer `.exe` and follow the prompts. BraitenBot will be added to your Start menu.

### Linux

For Debian/Ubuntu:
```bash
sudo dpkg -i BraitenBot_amd64.deb
```

Or use the AppImage directly:
```bash
chmod +x BraitenBot_amd64.AppImage
./BraitenBot_amd64.AppImage
```

## Building from source

If you want to build BraitenBot yourself:

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) toolchain
- Platform-specific build dependencies — see the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/)

### Steps

```bash
git clone https://github.com/jspsych/braitenbot-gui.git
cd braitenbot-gui
npm install
npm run fetch:arduino-cli    # download arduino-cli binary for your platform
npm run tauri:dev             # launch the dev build
```

### Build commands

| Command | What it does |
|---------|-------------|
| `npm run tauri:dev` | Run the desktop app in development mode |
| `npm run tauri:build` | Build a distributable desktop binary |
| `npm run dev` | Frontend-only dev server (no desktop shell) |
