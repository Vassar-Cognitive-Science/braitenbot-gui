---
"braitenbot-gui": patch
---

Customizable trace-mode pulse duration. The sensor "▶" pulse button previously always held the pulse for 200ms; a new "Pulse" setting in the Simulate toolbar group (visible while trace mode is active) lets you set the duration from 10ms to 5000ms. The pulse-button tooltips show the configured duration, and the effective pulse still rounds to whole simulation ticks (minimum one loop period), matching how the real board samples inputs.
