---
sidebar_position: 6
title: Supported Hardware
---

# Supported Hardware

## Arduino Boards

BraitenBot supports the following Arduino boards:

| Board | Core | Processor | USB | Tested |
|-------|------|-----------|-----|--------|
| Arduino Uno R4 Minima | `arduino:renesas_uno` | RA4M1 | Type-C | Primary |
| Arduino Uno R4 WiFi | `arduino:renesas_uno` | RA4M1 | Type-C | Yes |
| Arduino Uno | `arduino:avr` | ATmega328P | Type-B | Yes |
| Arduino Nano | `arduino:avr` | ATmega328P | Mini-B | Yes |

### Motor safety (Uno R4)

The Uno R4 boards include a motor safety feature: while the USB host is actively connected and enumerating the device, wheel motors are held at zero speed and the built-in LED blinks. This prevents the robot from driving off your desk during programming. Disconnect USB to enable the motors.

## Pin reference

### Reserved pins

| Pin | Function | Notes |
|-----|----------|-------|
| 0 | Serial RX | Used by USB communication — **never assign to sensors/outputs** |
| 1 | Serial TX | Used by USB communication — **never assign to sensors/outputs** |
| 13 | Built-in LED | Wired directly to the onboard LED, which distorts signals on the pin and is used by the motor safety indicator — **never assign to sensors/outputs** |

BraitenBot's validation will report an error if you assign pin 0, 1, or 13 to a digital pin field.

### Analog pins

| Pin | Available on |
|-----|-------------|
| A0–A5 | Uno, Nano, Uno R4 |

Used by: Analog Sensor nodes. Reads 10-bit values (0–1023), scaled to 0–100 in the diagram.

### Digital pins

| Pin | Available on | Notes |
|-----|-------------|-------|
| 2–13 | All boards | General purpose |
| A0–A5 | All boards | Can also be used as digital pins |

Used by: Digital Sensor, Continuous Servo, Positional Servo, Digital Output nodes.

### I2C pins

| Pin | Function | Board |
|-----|----------|-------|
| A4 | SDA | Uno, Nano |
| A5 | SCL | Uno, Nano |
| SDA | SDA | Uno R4 (dedicated header) |
| SCL | SCL | Uno R4 (dedicated header) |

Used by: Color Sensor (TCS34725), ToF Distance (VL53L4CD), TM1637 Display. The I2C bus is shared — multiple I2C devices use the same two pins (SDA/SCL); they are daisy-chained, not given individual ports.

Because the bus is addressed rather than pinned, devices must have distinct I2C addresses. The VL53L4CD ships at the same address (0x29) as every other VL53L4CD **and** as the TCS34725, so BraitenBot reassigns each ToF sensor to a unique address at startup using its XSHUT pin (see [ToF Distance](node-types#tof-distance-vl53l4cd)). Each ToF node therefore needs its own digital XSHUT pin in addition to the shared SDA/SCL lines.

### Servo pins

Servo control typically uses PWM (pulse-width modulation) pins. On most Arduinos, these are pins 3, 5, 6, 9, 10, 11. However, the Servo library can drive servos on **any** digital pin using software timing, so you can use any available pin.

## Sensors

### Analog sensors

Any sensor that outputs a 0–5V analog signal can be used with an Analog Sensor node:

- **Photoresistor** (LDR) — light intensity, typically with a voltage divider
- **IR distance sensor** (Sharp GP2Y0A21) — distance as analog voltage
- **Potentiometer** — manual input / calibration
- **Force sensitive resistor** (FSR) — pressure sensing
- **Thermistor** — temperature (with voltage divider)

### Digital sensors

Any sensor with a HIGH/LOW output works with a Digital Sensor node:

- **IR proximity sensor** (e.g., TCRT5000 module) — obstacle detection
- **Line following sensor** — black/white line detection
- **Bumper / limit switch** — mechanical contact (use INPUT_PULLUP)
- **PIR motion sensor** — motion detection
- **Ultrasonic sensor trigger** — if wired as digital threshold

### I2C sensors

Currently supported:

- **TCS34725** — RGB color sensor (via Color Sensor node)
- **VL53L4CD** — time-of-flight distance sensor (via ToF Distance node). Multiple units are supported on the same bus; each needs its own XSHUT pin for the startup address-assignment sequence.

## Outputs

### Continuous rotation servos

The wheel motors use continuous rotation servos:

- **Standard range**: 1000–2000 µs pulse width
- **Neutral**: 1500 µs (stopped)
- **Full forward**: 2000 µs (left wheel) / 1000 µs (right wheel, inverted)
- **Full reverse**: 1000 µs (left wheel) / 2000 µs (right wheel, inverted)

Compatible servos: any continuous rotation servo that responds to standard 1000–2000 µs PWM signals. The reference build uses the **MG996R** (continuous-rotation variant); smaller options like the FS90R or SpringRC SM-S4303R work too.

### Positional servos

Standard hobby servos with 0°–180° range. BraitenBot maps -100 to 100 input range to 0°–180°.

### Digital outputs

Any device that can be driven by a HIGH/LOW digital pin:

- **LEDs** (with appropriate resistor)
- **Buzzers** (passive or active)
- **Relays**
- **Transistor-switched loads**

### TM1637 display

4-digit 7-segment LED display modules using the TM1637 driver chip. Displays integer values from -999 to 9999. Requires two digital pins (CLK and DIO).

## Libraries

BraitenBot automatically installs the following libraries during [Arduino setup](../getting-started/arduino-setup):

| Library | Version | Used by |
|---------|---------|---------|
| Servo | (bundled with core) | All servo and motor nodes |
| TM1637 | latest | TM1637 Display nodes |
| STM32duino VL53L4CD | latest | ToF Distance nodes |
| Wire | (bundled with core) | I2C sensors |
