---
sidebar_position: 4
title: Assembly
---

# Assembly

Step-by-step instructions for assembling the BraitenBot — mounting the wheel
servos, wiring the servos and sensors to the microcontroller, and connecting
power — with photos and wiring diagrams.

:::note[Coming soon]

The full step-by-step build (with photos and wiring diagrams) is being written
and will be published here once the reference build is finalized. The pin
assignments below are ready to wire against now.
:::

## Pin assignments

This is the reference wiring for the default build, targeting an **Arduino UNO R4
Minima with a Sensor Shield V5.0**. It's the wiring the [hardware test](./testing)
assumes — if you change any pin, update `config.h` in the test sketch to match.

| Device | Pin | Notes |
|--------|-----|-------|
| Front-left bump switch | D2 | Digital input (`INPUT_PULLUP`). Also the **mode button** for the hardware test. |
| Front-right bump switch | D3 | Digital input (`INPUT_PULLUP`) |
| Rear-left bump switch | D4 | Digital input (`INPUT_PULLUP`) |
| Rear-right bump switch | D7 | Digital input (`INPUT_PULLUP`) |
| Left wheel servo | D5 | Continuous-rotation servo (PWM) |
| Right wheel servo | D6 | Continuous-rotation servo (PWM); mounted mirrored, so its direction is inverted in software |
| ToF distance sensor #1 — XSHUT | D8 | Per-sensor reset line for I2C address assignment |
| ToF distance sensor #2 — XSHUT | D12 | Per-sensor reset line for I2C address assignment |
| TM1637 display — CLK | D9 | |
| TM1637 display — DIO | D10 | |
| Left photocell | A0 | Analog input (on-board voltage divider) |
| Right photocell | A1 | Analog input (on-board voltage divider) |

### Shared I2C bus

The two ToF distance sensors and the color sensor all share the dedicated
**SDA / SCL** pins — they're daisy-chained on one bus, not given individual pins.

| Device | I2C address | Notes |
|--------|-------------|-------|
| Color sensor (TCS34725) | `0x29` | Fixed; no GPIO pin to assign |
| ToF distance #1 (VL53L4CD) | `0x2A` | Reassigned at startup via its XSHUT pin (D8) |
| ToF distance #2 (VL53L4CD) | `0x2B` | Reassigned at startup via its XSHUT pin (D12) |

Every VL53L4CD powers up at the default `0x29` — the same address as the color
sensor — so the firmware holds both ToF sensors in reset, then brings them up one
at a time and moves each to a unique address. See [Nodes ▸ ToF Distance](../guide/nodes#tof-distance-vl53l4cd).

### Reserved pins

| Pin | Function |
|-----|----------|
| D0 / D1 | USB serial (the diagnostic log) — never reassign |
| D13 | Built-in LED — heartbeat / motor-safety indicator — never reassign |
