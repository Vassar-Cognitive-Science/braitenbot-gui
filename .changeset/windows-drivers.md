---
"braitenbot-gui": minor
---

Windows USB driver installation is now handled by the app instead of silently skipped.

- The one-time toolchain setup passes `--run-post-install` to `arduino-cli core install`, so each platform's bundled driver installer actually runs (arduino-cli skips it in non-interactive sessions, which a GUI-spawned sidecar always is). Windows shows an administrator prompt during install; the setup dialog now says to expect it.
- While no board is detected, the app probes Windows PnP for a plugged-in Arduino-compatible USB device stuck without a driver — the state that previously looked identical to "no board plugged in."
- When one is found, a "USB driver missing — install" prompt in the Device toolbar runs the Arduino driver installers elevated, then rescans for the board.
