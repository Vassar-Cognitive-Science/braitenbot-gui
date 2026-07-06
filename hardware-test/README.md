# BraitenBot hardware bring-up test

A standalone Arduino sketch that exercises every device in the default
BraitenBot build, one at a time: 2× ToF distance sensor, 1× color sensor, 2×
photocells, 4× bump switches, the 7-segment display, and both wheel servos.

- **Hold the front-left bump switch** to scrub through modes — each press steps
  the mode number (`0001`, `0002`, …) and previews it; **release** to start that
  mode.
- A running mode shows that device's live reading on the display. Open the
  Serial Monitor at **115200 baud** for full readings of every device.

Pins are all in [`config.h`](./config.h) — edit them there if your wiring
differs. Nothing is hard-coded in the sketch.

---

## Loading it with the Arduino IDE (no command line)

### 1. Install the board package

**Tools → Board → Boards Manager**, search **`UNO R4`**, install
**“Arduino UNO R4 Boards”** (by Arduino).

### 2. Install the three libraries

**Tools → Manage Libraries…** (or Sketch → Include Library → Manage
Libraries), then search for and install each of these. The exact name/author
matters — there are similarly named look-alikes, especially for TM1637:

| Search for | Install the one by | Notes |
|---|---|---|
| `VL53L4CD` | **STMicroelectronics / SRA** — “STM32duino VL53L4CD” | ToF distance sensors |
| `TM1637`   | **Avishay Orpaz** — “TM1637” | ⚠️ Must be this one — it’s the library that provides `TM1637Display.h`. Ignore the other TM1637 results. |
| `Servo`    | **Arduino** — “Servo” | Usually already installed |

### 3. Open and upload

1. Open **`hardware-test/hardware-test.ino`** (File → Open, or double-click it).
   `config.h` appears automatically as a second tab.
2. Plug in the Arduino UNO R4 Minima over USB.
3. **Tools → Board → Arduino UNO R4 Boards → Arduino UNO R4 Minima**.
4. **Tools → Port →** select the board's port.
5. Click **Upload** (→).

If the board ever gets wedged and won't show up as a port, **double-tap the
RESET button** to force its bootloader, then upload again.

---

## Wiring (defaults in `config.h`)

Target: **Arduino UNO R4 Minima + Sensor Shield V5.0**.

| Device | Pin(s) |
|---|---|
| Bump — front-left (also the MODE button) | D2 |
| Bump — front-right / rear-left / rear-right | D3 / D4 / D7 |
| Left / right wheel servo | D5 / D6 |
| Left / Right ToF XSHUT | D8 / D12 |
| TM1637 display CLK / DIO | D9 / D10 |
| Photocell left / right | A0 / A1 |
| ToF ×2 + color sensor (I2C) | SDA / SCL (shared bus) |

Both ToF sensors **must** have their XSHUT pins wired (D8/D12) — that's how the
sketch gives each one a unique I2C address so they can share the bus with the
color sensor. A ToF that isn't found at boot shows `----` in its mode instead of
a distance.
