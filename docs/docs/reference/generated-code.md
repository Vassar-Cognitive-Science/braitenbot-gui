---
sidebar_position: 5
title: Generated Code
---

# Generated Code Reference

This page documents the structure and conventions of the Arduino sketches that BraitenBot generates from your diagrams.

## Sketch structure

Every generated sketch follows the same template:

```cpp
// 1. Includes
#include <Servo.h>
// #include <Wire.h>           — if I2C sensors used
// #include <vl53l4cd_class.h> — if ToF distance nodes used
// #include <TM1637Display.h>  — if display nodes used

// 2. Pin constants
const int SENSOR_LEFT_LIGHT = A0;
const int SERVO_LEFT_WHEEL_PIN = 9;

// 3. I2C device drivers (if needed)
// ... TCS34725 driver code ...

// 4. Global declarations
Servo servo_left_wheel;
// ... delay buffers, display objects ...

// 5. Transfer functions (if any non-linear connections)
float transfer_sensor_to_threshold_0(float x) { ... }

// 6. Drive helper (if wheel motors present)
void drive(float left, float right) { ... }

// 7. setup()
void setup() { ... }

// 8. loop()
void loop() { ... }
```

## Naming conventions

### Variables

| Pattern | Example | Meaning |
|---------|---------|---------|
| `sig_<label>` | `sig_left_light` | Output signal of a node |
| `sig_<label>_<port>` | `sig_color_sensor_red` | Output of a specific port |
| `input_<label>` | `input_threshold` | Aggregated input arriving at a node |

Labels are converted to C identifiers by lowercasing and replacing spaces/special characters with underscores.

### Constants

| Pattern | Example | Meaning |
|---------|---------|---------|
| `SENSOR_<LABEL>` | `SENSOR_LEFT_LIGHT` | Sensor pin number |
| `SERVO_<LABEL>_PIN` | `SERVO_LEFT_WHEEL_PIN` | Servo pin number |
| `OUTPUT_<LABEL>_PIN` | `OUTPUT_LED_PIN` | Digital output pin |
| `TM1637_<LABEL>_CLK` | `TM1637_DISPLAY_CLK` | Display clock pin |
| `TM1637_<LABEL>_GPIO` | `TM1637_DISPLAY_GPIO` | Display data pin |
| `XSHUT_<LABEL>` | `XSHUT_LEFT_TOF` | ToF sensor shutdown pin |

## Per-node code generation

### Sensors

**Analog:**
```cpp
float sig_left_light = analogRead(SENSOR_LEFT_LIGHT) * (100.0 / 1023.0);
```

**Digital (no pullup):**
```cpp
float sig_bumper = digitalRead(SENSOR_BUMPER) == HIGH ? 100.0 : 0.0;
```

**Digital (with pullup):**
```cpp
float sig_bumper = digitalRead(SENSOR_BUMPER) == LOW ? 100.0 : 0.0;
```

**Color sensor (I2C):**
```cpp
tcs34725_read(&tcs_color_1);
float sig_color_1_clear = tcs_color_1.clear * (100.0 / 65535.0);
float sig_color_1_red   = tcs_color_1.red   * (100.0 / 65535.0);
float sig_color_1_green = tcs_color_1.green * (100.0 / 65535.0);
float sig_color_1_blue  = tcs_color_1.blue  * (100.0 / 65535.0);
```

**ToF distance (I2C, VL53L4CD):**
```cpp
uint8_t ready_left_tof = 0;
static float dist_left_tof = 500.0;        // distance (mm); no target reads as far
tof_left_tof.VL53L4CD_CheckForDataReady(&ready_left_tof);
if (ready_left_tof) {
  tof_left_tof.VL53L4CD_ClearInterrupt();
  VL53L4CD_Result_t res_left_tof;
  tof_left_tof.VL53L4CD_GetResult(&res_left_tof);
  uint8_t status_left_tof = res_left_tof.range_status;
  if (status_left_tof <= 2) dist_left_tof = res_left_tof.distance_mm; // valid
  else if (status_left_tof == 3) dist_left_tof = 0.0;                 // too close
  else dist_left_tof = 500.0;                                         // wrap/fault → far
}
float sig_left_tof = constrain((1.0 - dist_left_tof / 500.0) * 100.0, 0.0, 100.0);
```

Multiple ToF sensors are sequenced in `setup()` — every sensor is held in reset via XSHUT, then brought up one at a time and reassigned to a unique I2C address (0x2A, 0x2B, …) so they don't all collide on the default 0x29. See [ToF Distance](node-types#tof-distance-vl53l4cd).

### Compute nodes

**Threshold:**
```cpp
float input_threshold_1 = sig_left_light * 0.7500;
float sig_threshold_1 = (input_threshold_1 > 50.0000) ? 100.0 : 0.0;
```

**Summation:**
```cpp
float input_sum_1 = sig_a * 1.0000 + sig_b * -0.5000;
float sig_sum_1 = input_sum_1;
```

**Multiply:**
```cpp
float input_mult_1 = sig_a * 0.0100 * sig_b * 0.0100;
float sig_mult_1 = input_mult_1;
```

**Oscillator:**
```cpp
float sig_osc_1 = 100.0000 * sin(2.0 * PI * 1.0000 * millis() / 1000.0);
```

**Noise:**
```cpp
float sig_noise_1 = 50.0000 * (random(-10000, 10001) / 10000.0);
```

**Constant:**
```cpp
float sig_const_1 = 75.0000;
```

### Delay (two-phase)

**Declarations:**
```cpp
#define DELAY_1_BUF_SIZE 5  // ceil(100ms / 20ms)
float delay_1_buf[DELAY_1_BUF_SIZE] = {0};
int delay_1_idx = 0;
```

**Read phase (in loop order):**
```cpp
float sig_delay_1 = delay_1_buf[(delay_1_idx + 1) % DELAY_1_BUF_SIZE];
```

**Write phase (end of loop):**
```cpp
float input_delay_1 = sig_source * 1.0000;
delay_1_buf[delay_1_idx] = input_delay_1;
delay_1_idx = (delay_1_idx + 1) % DELAY_1_BUF_SIZE;
```

### Outputs

**Continuous servo (non-wheel):**
```cpp
float input_servo_1 = sig_source * 1.0000;
input_servo_1 = constrain(input_servo_1, -100.0, 100.0);
servo_1.writeMicroseconds(1500 + (int)(input_servo_1 * 5.0));
```

**Positional servo:**
```cpp
float input_servo_1 = sig_source * 1.0000;
int angle = constrain((int)((input_servo_1 + 100.0) * 0.9), 0, 180);
servo_1.write(angle);
```

**Digital output:**
```cpp
float input_led = sig_source * 1.0000;
digitalWrite(OUTPUT_LED_PIN, input_led > 50.0000 ? HIGH : LOW);
```

**TM1637 display:**
```cpp
float input_display = sig_source * 1.0000;
int display_val = constrain((int)round(input_display), -999, 9999);
tm1637_display.showNumberDec(display_val);
```

## Drive helper

When wheel motors are present, a `drive()` function handles both wheels:

```cpp
void drive(float left, float right) {
  left = constrain(left, -100.0, 100.0);
  right = constrain(right, -100.0, 100.0);
  servo_left_wheel.writeMicroseconds(1500 + (int)(left * 5.0));
  servo_right_wheel.writeMicroseconds(1500 - (int)(right * 5.0));
}
```

The right wheel is inverted because the motors face opposite directions on the chassis. Input range -100 to 100 maps to pulse width 1000–2000 µs (standard continuous servo range).

## Transfer functions

Each non-linear connection generates a piecewise-linear lookup function:

```cpp
float transfer_sensor_to_threshold_0(float x) {
  if (x <= 20.0000) return 0.0000 + (x - (-100.0000)) * (0.0000 - 0.0000) / (20.0000 - (-100.0000));
  return 0.0000 + (x - 20.0000) * (100.0000 - 0.0000) / (100.0000 - 20.0000);
}
```

Applied at the connection site:
```cpp
float input_threshold = transfer_sensor_to_threshold_0(sig_sensor);
```

## Loop timing

Every generated loop ends with a timing guard:

```cpp
unsigned long _elapsed = millis() - _loopStart;
if (_elapsed < 20) delay(20 - _elapsed);
```

The value (20 in this example) matches the configured loop period. This ensures consistent timing regardless of how long the computation takes.
