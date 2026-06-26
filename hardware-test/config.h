#pragma once
// ============================================================================
// BraitenBot hardware bring-up test — pin & tuning configuration
// ----------------------------------------------------------------------------
// Edit the numbers here to match how you actually wired your robot. The sketch
// (hardware-test.ino) never hard-codes a pin; it only refers to the names
// defined below.
//
// Target board: Arduino UNO R4 Minima + Sensor Shield V5.0
//
// Pins to avoid reassigning:
//   D0 / D1  -> USB serial (used for the diagnostic log)
//   D13      -> LED_BUILTIN (used as a heartbeat)
//   SDA/SCL  -> dedicated I2C pins, driven by the Wire library (the two ToF
//               sensors and the color sensor all share this one bus)
// ============================================================================

// --- Bump switches (lever microswitches) ------------------------------------
// Wired as digital inputs using the chip's internal pull-ups, so an unpressed
// switch reads HIGH and a pressed switch reads LOW (it shorts the pin to GND).
// The FRONT-LEFT switch doubles as the MODE button: press it to advance to the
// next test mode (see hardware-test.ino).
#define BUMP_FRONT_LEFT_PIN   2   // <-- also the MODE / NEXT button
#define BUMP_FRONT_RIGHT_PIN  3
#define BUMP_REAR_LEFT_PIN    4
#define BUMP_REAR_RIGHT_PIN   7

// --- Continuous-rotation servos (wheels) ------------------------------------
// MG996R CR servos driven on PWM-capable pins. The right servo is mounted
// mirrored, so its direction is inverted in software (see driveLeft/driveRight).
#define SERVO_LEFT_PIN        5
#define SERVO_RIGHT_PIN       6

// --- ToF distance sensors (VL53L4CD, I2C) -----------------------------------
// Both sensors share the I2C bus and power up at the same default address, so
// each needs its own XSHUT line. setup() holds them all in reset, then brings
// them up one at a time and reassigns each a unique address.
#define TOF1_XSHUT_PIN        8
#define TOF2_XSHUT_PIN        12

// Unique I2C addresses handed out during setup (8-bit form, as the library
// expects). 0x54 -> 7-bit 0x2A, 0x56 -> 7-bit 0x2B. Kept clear of the color
// sensor at 0x29.
#define TOF1_I2C_ADDR         0x54
#define TOF2_I2C_ADDR         0x56

// --- 7-segment display (TM1637, 4 digits) -----------------------------------
#define TM1637_CLK_PIN        9
#define TM1637_DIO_PIN        10
#define DISPLAY_BRIGHTNESS    5    // 0 (dim) .. 7 (bright)

// --- Photocell light-sensor boards (analog) ---------------------------------
// On-board voltage divider, so the signal pin goes straight to an analog input.
#define PHOTOCELL_LEFT_PIN    A0
#define PHOTOCELL_RIGHT_PIN   A1

// --- Color sensor (TCS34725, I2C) -------------------------------------------
// Fixed I2C address 0x29; no GPIO pin to assign. Gain register value:
// 0x00 = 1x, 0x01 = 4x, 0x02 = 16x, 0x03 = 60x. 16x suits indoor light.
#define COLOR_GAIN_REG        0x02

// --- Behavior tuning --------------------------------------------------------
#define MODE_DEBOUNCE_MS      40    // bump-switch debounce window
#define MOTOR_TEST_SPEED      60    // CR servo test speed, -100..100
#define LOOP_PERIOD_MS        20    // target loop period (~50 Hz)
