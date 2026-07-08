---
"braitenbot-gui": patch
---

Duplicate node names no longer block upload. The generated sketch already disambiguates repeated names with numeric suffixes (`Constant_1`, `Constant_2`, …), so the duplicate-name check is now a non-blocking warning that nudges toward distinct names for readability. Diagrams with several unnamed constants upload without renaming each one.
