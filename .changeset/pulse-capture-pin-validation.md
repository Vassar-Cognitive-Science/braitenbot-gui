---
"braitenbot-gui": patch
---

Validate pulse-capture pin support. The diagram validator now warns when a digital sensor's "Catch brief pulses" option is enabled on a pin the UNO R4 cannot attach an interrupt to (only pins 2, 3, 8, 12, and A1–A5 have IRQ channels on the RA4M1; elsewhere `attachInterrupt` silently does nothing and the sensor degrades to plain polling). It also warns when two pulse-capture sensors sit on pins that share a single UNO R4 interrupt channel (e.g. 3 + A4, or A3 + A5), since only one pin per channel can attach. Both are warnings rather than errors because classic AVR boards (Uno R3 / Nano) cover every pin via pin-change interrupts.
