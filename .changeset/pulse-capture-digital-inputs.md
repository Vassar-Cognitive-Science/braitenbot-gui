---
"braitenbot-gui": patch
---

Add a "Catch brief pulses" option to digital sensor nodes. When enabled, the generated sketch attaches a pin interrupt that latches pulses shorter than the loop period (e.g. a clap on a KY-037 sound sensor's digital output), so they register as high for one full tick instead of being missed between polls. The scheduled read consumes the latch and ORs it with a live `digitalRead`, so steady signals behave exactly as with plain polling. On classic AVR boards (Uno R3/Nano) the sketch uses pin-change interrupts so any pin works — not just the external-interrupt pins 2/3; on boards where `attachInterrupt` covers every pin (UNO R4) it emits a per-sensor edge-triggered ISR. With INPUT_PULLUP enabled the latch triggers on the falling edge to match the inverted active level.
