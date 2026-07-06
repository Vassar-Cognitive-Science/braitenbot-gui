---
sidebar_position: 1
title: Installation
---

# Installation

## Download

The app includes everything you need: the visual editor, signal simulation, and built-in Arduino upload.

The easiest way to get the latest build is the [**Install page**](/install),
which links directly to the newest downloads for each platform. You can also
browse every release on the [GitHub releases page](https://github.com/Vassar-Cognitive-Science/braitenbot-gui/releases).

| Platform | File |
|----------|------|
| macOS (Apple Silicon) | `BraitenBot.GUI_<version>_aarch64.dmg` |
| macOS (Intel) | `BraitenBot.GUI_<version>_x64.dmg` |
| Windows (installer) | `BraitenBot.GUI_<version>_x64-setup.exe` (an MSI, `BraitenBot.GUI_<version>_x64_en-US.msi`, is also provided) |
| Linux (AppImage) | `BraitenBot.GUI_<version>_amd64.AppImage` |
| Linux (Debian/Ubuntu) | `BraitenBot.GUI_<version>_amd64.deb` |
| Linux (RPM) | `BraitenBot.GUI-<version>-1.x86_64.rpm` |

`<version>` is the release version embedded in each filename (for example, `0.1.0`), so it changes from release to release. The [**Install page**](/install) is generated from the latest GitHub release and always links the current release's assets automatically, so you don't have to track the exact filenames.

### macOS

1. Open the `.dmg` file and drag **BraitenBot GUI** into Applications.
2. If you see *"BraitenBot GUI is damaged"* or *"cannot be opened"*, open Terminal and run:
   ```
   xattr -cr "/Applications/BraitenBot GUI.app"
   ```
3. Alternatively, go to **System Settings → Privacy & Security** and click **Open Anyway** after the first launch attempt.

### Windows

Run the `-setup.exe` installer and follow the prompts. BraitenBot will be added to your Start menu. (The `.msi` is an alternative for managed/silent installs.)

### Linux

For Debian/Ubuntu:
```bash
sudo dpkg -i BraitenBot.GUI_<version>_amd64.deb
```

Or use the AppImage directly:
```bash
chmod +x BraitenBot.GUI_<version>_amd64.AppImage
./BraitenBot.GUI_<version>_amd64.AppImage
```

## Building from source

If you want to build BraitenBot yourself:

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) toolchain
- Platform-specific build dependencies — see the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/)

### Steps

```bash
git clone https://github.com/Vassar-Cognitive-Science/braitenbot-gui.git
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
