---
"braitenbot-gui": patch
---

Allow diagrams with unconnected outputs to build. The "output not connected to any sensor" check is now a non-blocking warning instead of a blocking error, so you can (for example) wire up just the display and leave the wheels unsignaled for testing.
