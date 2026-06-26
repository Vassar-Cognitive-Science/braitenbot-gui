// ============================================================================
// BraitenBot hardware bring-up test
// ----------------------------------------------------------------------------
// A standalone diagnostic sketch that exercises every device in the default
// BraitenBot build, one at a time:
//
//   2x ToF distance sensor   (VL53L4CD, I2C)
//   1x RGB color sensor      (TCS34725, I2C)
//   2x photocell board       (analog)
//   4x bump switch           (digital, internal pull-ups)
//   1x 7-segment display     (TM1637, 4 digits)
//   2x continuous servo      (MG996R, the wheels)
//
// HOW TO USE IT
//   - The 7-segment display shows the current test mode as 0001, 0002, 0003 ...
//   - Hold the FRONT-LEFT bump switch to scrub modes: each press steps the
//     mode number forward and previews it (nothing runs while held); RELEASE
//     the switch to start that mode.
//   - A running mode shows that device's live reading. Motor modes spin a
//     wheel briefly (only after release, never while you're previewing).
//   - The USB serial monitor (115200 baud) prints full diagnostics for every
//     device every loop, so nothing is hidden behind the 4-digit display.
//
// All pins live in config.h — edit that file to match your wiring.
// ============================================================================

#include <Wire.h>
#include <vl53l4cd_class.h>   // STM32duino "STM32duino VL53L4CD" library
#include <Servo.h>
#include <TM1637Display.h>

#include "config.h"

// ---------------------------------------------------------------------------
// Test modes. The display shows (index + 1) as 0001, 0002, ...
// ---------------------------------------------------------------------------
enum Mode {
  MODE_PHOTOCELL_LEFT,   // 0001
  MODE_PHOTOCELL_RIGHT,  // 0002
  MODE_TOF1,             // 0003
  MODE_TOF2,             // 0004
  MODE_COLOR,            // 0005
  MODE_BUMPERS,          // 0006
  MODE_SERVO_LEFT,       // 0007
  MODE_SERVO_RIGHT,      // 0008
  MODE_DISPLAY_TEST,     // 0009
  MODE_COUNT
};

// ---------------------------------------------------------------------------
// Device objects
// ---------------------------------------------------------------------------
// xshut = -1: we drive the XSHUT lines ourselves (see setup) so the library's
// InitSensor() never power-cycles a sensor and makes it forget its assigned
// address. The reset sequencing is done manually with the config pins.
VL53L4CD tof1(&Wire, -1);
VL53L4CD tof2(&Wire, -1);
Servo servoLeft;
Servo servoRight;
TM1637Display display(TM1637_CLK_PIN, TM1637_DIO_PIN);

// ---------------------------------------------------------------------------
// TCS34725 color sensor — minimal hand-rolled I2C driver (no extra library).
// Mirrors the driver the BraitenBot code generator emits.
// ---------------------------------------------------------------------------
const uint8_t TCS34725_ADDR = 0x29;

struct ColorSample { uint16_t c, r, g, b; };

void tcs34725_write8(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(TCS34725_ADDR);
  Wire.write(0x80 | reg);  // command bit + register address
  Wire.write(value);
  Wire.endTransmission();
}

void tcs34725_begin(uint8_t gain) {
  tcs34725_write8(0x01, 0xD5);  // ATIME: ~101 ms integration
  tcs34725_write8(0x0F, gain);  // CONTROL: RGBC gain
  tcs34725_write8(0x00, 0x01);  // ENABLE: PON
  delay(3);
  tcs34725_write8(0x00, 0x03);  // ENABLE: PON | AEN
}

// Read CDATA/RDATA/GDATA/BDATA (8 bytes from 0x14) in one transaction using
// the command register's auto-increment bit.
ColorSample tcs34725_read() {
  ColorSample s = {0, 0, 0, 0};
  Wire.beginTransmission(TCS34725_ADDR);
  Wire.write(0xA0 | 0x14);  // command + auto-increment, starting at CDATAL
  if (Wire.endTransmission() != 0) return s;
  if (Wire.requestFrom(TCS34725_ADDR, (uint8_t)8) != 8) return s;
  uint8_t cl = Wire.read(), ch = Wire.read();
  uint8_t rl = Wire.read(), rh = Wire.read();
  uint8_t gl = Wire.read(), gh = Wire.read();
  uint8_t bl = Wire.read(), bh = Wire.read();
  s.c = ((uint16_t)ch << 8) | cl;
  s.r = ((uint16_t)rh << 8) | rl;
  s.g = ((uint16_t)gh << 8) | gl;
  s.b = ((uint16_t)bh << 8) | bl;
  return s;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
int currentMode = 0;
unsigned long modeEnteredAt = 0;

// While the MODE button is held after a press, we "preview" the upcoming mode:
// the display shows its number but the mode itself doesn't run yet. Releasing
// the button starts the mode.
bool modePreview = false;

// Which ToF sensors actually answered at boot (set in setup()).
bool tof1Present = false;
bool tof2Present = false;

// Front-left bump switch edge detection (the MODE button).
bool modeBtnPressed = false;          // debounced "currently held" state
unsigned long modeBtnLastChange = 0;

// ---------------------------------------------------------------------------
// Wheels. CR servos: 1500 us = stop, +/- 500 us = full speed either way.
// The right servo is mounted mirrored, so its sign is flipped. speed = -100..100.
// ---------------------------------------------------------------------------
void driveLeft(int speed)  { servoLeft.writeMicroseconds(1500 + constrain(speed, -100, 100) * 5); }
void driveRight(int speed) { servoRight.writeMicroseconds(1500 - constrain(speed, -100, 100) * 5); }

// A bump switch reads LOW when pressed (internal pull-up + switch to GND).
bool bumpPressed(int pin) { return digitalRead(pin) == LOW; }

// Quick I2C presence check: ping a 7-bit address and report whether it ACKs.
// Used to gate the ToF library calls — that library retries failed I2C reads
// in an UNBOUNDED loop (platform.cpp), which hard-hangs the sketch on the R4 if
// a sensor is missing or glitches. We never call into it unless the device is
// answering, so a dead/unplugged sensor just holds its last value instead.
bool i2cResponding(uint8_t addr7) {
  Wire.beginTransmission(addr7);
  return Wire.endTransmission() == 0;
}

// Bounded write of the VL53L4CD I2C-address register (0x0001). The sensor must
// currently be at the default 0x29. The color sensor also sits at 0x29 and
// receives this transaction too, but ignores it (its command byte must have bit
// 7 set; ours doesn't), so only the ToF actually moves to the new address.
bool vl53SetAddress(uint8_t newAddr7) {
  Wire.beginTransmission((uint8_t)0x29);
  Wire.write((uint8_t)0x00);
  Wire.write((uint8_t)0x01);   // register 0x0001
  Wire.write(newAddr7);
  return Wire.endTransmission() == 0;
}

// Bounded, single-shot model-id read (reg 0x010F, expected 0xEBAA) at a given
// 7-bit address. Never retries, so it can't hang the way the library can.
bool vl53ModelIdAt(uint8_t addr7) {
  Wire.beginTransmission(addr7);
  Wire.write((uint8_t)0x01);
  Wire.write((uint8_t)0x0F);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(addr7, (uint8_t)2) != 2) return false;
  uint8_t hi = Wire.read();
  uint8_t lo = Wire.read();
  return hi == 0xEB && lo == 0xAA;
}

// Bring up ONE ToF (caller guarantees the other is held in reset). Power it on
// at 0x29, move it to its unique address, and verify the model id THERE — a
// clean read, clear of the color sensor that also answers at 0x29. Only then
// hand it to the library to finish init. A missing/unplugged sensor fails the
// verify and is left in reset, so it can never trip the library's unbounded
// I2C retry loop (which would hang setup and blank the display).
bool bringUpTof(VL53L4CD &sensor, int xshutPin, uint8_t addr8) {
  uint8_t addr7 = addr8 >> 1;
  digitalWrite(xshutPin, HIGH);    // power on; boots at the default 0x29
  delay(10);
  vl53SetAddress(addr7);           // move it off 0x29, clear of the color sensor
  delay(2);
  if (!vl53ModelIdAt(addr7)) {     // nobody answered at the new address
    digitalWrite(xshutPin, LOW);   // back to reset; keep the bus clean
    return false;
  }
  sensor.InitSensor(addr8);        // confirmed present; library finishes init
  sensor.VL53L4CD_SetRangeTiming(50, 0);
  sensor.VL53L4CD_StartRanging();
  return true;
}

// ---------------------------------------------------------------------------
// setup()
// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);

  pinMode(BUMP_FRONT_LEFT_PIN,  INPUT_PULLUP);
  pinMode(BUMP_FRONT_RIGHT_PIN, INPUT_PULLUP);
  pinMode(BUMP_REAR_LEFT_PIN,   INPUT_PULLUP);
  pinMode(BUMP_REAR_RIGHT_PIN,  INPUT_PULLUP);
  pinMode(LED_BUILTIN, OUTPUT);

  servoLeft.attach(SERVO_LEFT_PIN);
  servoRight.attach(SERVO_RIGHT_PIN);
  driveLeft(0);
  driveRight(0);

  // Light the display immediately (all dashes) so it's obvious the screen and
  // sketch are alive BEFORE any I2C work — if a sensor misbehaves later, you
  // still see this and the serial log instead of a black screen.
  display.setBrightness(DISPLAY_BRIGHTNESS);
  uint8_t dashes[] = {0x40, 0x40, 0x40, 0x40};
  display.setSegments(dashes);
  Serial.println(F("Booting BraitenBot hardware test..."));

  Wire.begin();
  Wire.setClock(100000);  // 100 kHz — conservative, robust over jumper wires

  // --- ToF bring-up. Both sensors share the default address, so we hold both
  // in reset (XSHUT low), then bring up one at a time, readdress it, and verify
  // it before touching the next. bringUpTof() refuses to call the (hang-prone)
  // library on a sensor that isn't responding, so a missing ToF or a loose
  // Qwiic/XSHUT cable can't freeze setup. ---
  pinMode(TOF1_XSHUT_PIN, OUTPUT); digitalWrite(TOF1_XSHUT_PIN, LOW);
  pinMode(TOF2_XSHUT_PIN, OUTPUT); digitalWrite(TOF2_XSHUT_PIN, LOW);
  delay(10);

  Serial.print(F("ToF #1 (XSHUT pin ")); Serial.print(TOF1_XSHUT_PIN); Serial.print(F("): "));
  tof1Present = bringUpTof(tof1, TOF1_XSHUT_PIN, TOF1_I2C_ADDR);
  Serial.println(tof1Present ? F("OK") : F("NOT FOUND"));

  Serial.print(F("ToF #2 (XSHUT pin ")); Serial.print(TOF2_XSHUT_PIN); Serial.print(F("): "));
  tof2Present = bringUpTof(tof2, TOF2_XSHUT_PIN, TOF2_I2C_ADDR);
  Serial.println(tof2Present ? F("OK") : F("NOT FOUND"));

  // --- Color sensor (fixed at 0x29; ToFs are off 0x29 now). ---
  tcs34725_begin(COLOR_GAIN_REG);
  Serial.print(F("Color sensor (0x29): "));
  Serial.println(i2cResponding(0x29) ? F("responding") : F("NOT FOUND"));

  modeEnteredAt = millis();
  Serial.println(F("Ready. Press the front-left bumper to change mode."));
}

// ---------------------------------------------------------------------------
// ToF helper: non-blocking poll, holding the last good distance (mm) between
// reads. Returns -1 if no fresh sample this loop. Range-status handling matches
// the generated firmware: 0-2 valid, 3 = too close (0 mm), 4+ = nothing/fault.
// ---------------------------------------------------------------------------
int readTof(VL53L4CD &sensor, uint8_t addr7, int &held) {
  // Don't touch the (hang-prone) library unless the sensor is actually there.
  if (!i2cResponding(addr7)) return -1;
  uint8_t ready = 0;
  sensor.VL53L4CD_CheckForDataReady(&ready);
  if (!ready) return -1;
  sensor.VL53L4CD_ClearInterrupt();
  VL53L4CD_Result_t res;
  sensor.VL53L4CD_GetResult(&res);
  if (res.range_status <= 2)      held = res.distance_mm;
  else if (res.range_status == 3) held = 0;
  else                            held = 9999;  // nothing in range
  return held;
}

// ---------------------------------------------------------------------------
// MODE button (front-left bumper), debounced:
//   press   -> advance to the next mode and PREVIEW it (show its number only)
//   release -> START that mode (it begins running)
// Hold the button to scrub through mode numbers; let go on the one you want.
// ---------------------------------------------------------------------------
void updateModeButton() {
  bool raw = bumpPressed(BUMP_FRONT_LEFT_PIN);
  unsigned long now = millis();
  if (raw != modeBtnPressed && (now - modeBtnLastChange) > MODE_DEBOUNCE_MS) {
    modeBtnLastChange = now;
    modeBtnPressed = raw;
    if (raw) {                          // pressed -> preview the next mode
      currentMode = (currentMode + 1) % MODE_COUNT;
      modePreview = true;
      driveLeft(0);                     // hold motors still while previewing
      driveRight(0);
      display.clear();
      Serial.print(F("--- Mode "));
      Serial.print(currentMode + 1);
      Serial.println(F(" (release to start) ---"));
    } else {                            // released -> start the mode now
      modePreview = false;
      modeEnteredAt = now;
    }
  }
}

// Show a 0..9999 value with leading zeros (e.g. 42 -> "0042").
void showValue(int value) {
  display.showNumberDec(constrain(value, 0, 9999), true);
}

// "----" — used when a device under test isn't present.
void showDashes() {
  uint8_t dashes[] = {0x40, 0x40, 0x40, 0x40};
  display.setSegments(dashes);
}

// ---------------------------------------------------------------------------
// loop()
// ---------------------------------------------------------------------------
void loop() {
  unsigned long loopStart = millis();
  updateModeButton();

  // While the button is held, just show the upcoming mode number and don't run
  // the mode (motors stay still). The mode starts when the button is released.
  if (modePreview) {
    display.showNumberDec(currentMode + 1, true);  // 0001, 0002, ...
    digitalWrite(LED_BUILTIN, (loopStart / 500) % 2);
    unsigned long held = millis() - loopStart;
    if (held < LOOP_PERIOD_MS) delay(LOOP_PERIOD_MS - held);
    return;
  }

  unsigned long sinceEnter = loopStart - modeEnteredAt;

  switch (currentMode) {
    case MODE_PHOTOCELL_LEFT: {
      int v = analogRead(PHOTOCELL_LEFT_PIN);
      showValue(v);
      Serial.print(F("Photocell L (A0 raw 0-1023): ")); Serial.println(v);
      break;
    }
    case MODE_PHOTOCELL_RIGHT: {
      int v = analogRead(PHOTOCELL_RIGHT_PIN);
      showValue(v);
      Serial.print(F("Photocell R (A1 raw 0-1023): ")); Serial.println(v);
      break;
    }
    case MODE_TOF1: {
      if (!tof1Present) {
        showDashes();
        Serial.println(F("ToF #1: not found at boot"));
        break;
      }
      static int held = 9999;
      readTof(tof1, TOF1_I2C_ADDR >> 1, held);  // 8-bit addr -> 7-bit
      showValue(held);
      Serial.print(F("ToF #1 distance (mm): ")); Serial.println(held);
      break;
    }
    case MODE_TOF2: {
      if (!tof2Present) {
        showDashes();
        Serial.println(F("ToF #2: not found at boot"));
        break;
      }
      static int held = 9999;
      readTof(tof2, TOF2_I2C_ADDR >> 1, held);  // 8-bit addr -> 7-bit
      showValue(held);
      Serial.print(F("ToF #2 distance (mm): ")); Serial.println(held);
      break;
    }
    case MODE_COLOR: {
      ColorSample s = tcs34725_read();
      showValue(s.c);   // display the clear channel
      Serial.print(F("Color  C:")); Serial.print(s.c);
      Serial.print(F(" R:"));       Serial.print(s.r);
      Serial.print(F(" G:"));       Serial.print(s.g);
      Serial.print(F(" B:"));       Serial.println(s.b);
      break;
    }
    case MODE_BUMPERS: {
      // One digit per switch: FL FR RL RR (1 = pressed, 0 = open). Pressing FL
      // advances the mode, so it's verified by navigation; FR/RL/RR are the
      // ones you watch live here.
      bool fl = bumpPressed(BUMP_FRONT_LEFT_PIN);
      bool fr = bumpPressed(BUMP_FRONT_RIGHT_PIN);
      bool rl = bumpPressed(BUMP_REAR_LEFT_PIN);
      bool rr = bumpPressed(BUMP_REAR_RIGHT_PIN);
      int code = fl * 1000 + fr * 100 + rl * 10 + rr;
      showValue(code);
      Serial.print(F("Bumpers FL:")); Serial.print(fl);
      Serial.print(F(" FR:"));        Serial.print(fr);
      Serial.print(F(" RL:"));        Serial.print(rl);
      Serial.print(F(" RR:"));        Serial.println(rr);
      break;
    }
    case MODE_SERVO_LEFT: {
      int speed = motorTestSpeed(sinceEnter);
      driveLeft(speed);
      driveRight(0);
      showSignedSpeed(speed);
      Serial.print(F("Left servo commanded speed: ")); Serial.println(speed);
      break;
    }
    case MODE_SERVO_RIGHT: {
      int speed = motorTestSpeed(sinceEnter);
      driveRight(speed);
      driveLeft(0);
      showSignedSpeed(speed);
      Serial.print(F("Right servo commanded speed: ")); Serial.println(speed);
      break;
    }
    case MODE_DISPLAY_TEST: {
      // Light every segment of all four digits ("8888" + colon) to confirm
      // the display itself, then nothing else to test here.
      display.showNumberDecEx(8888, 0x40, true);
      Serial.println(F("Display self-test: all segments on (8888 + colon)"));
      break;
    }
  }

  // Heartbeat so a hung sketch is obvious at a glance.
  digitalWrite(LED_BUILTIN, (loopStart / 500) % 2);

  unsigned long elapsed = millis() - loopStart;
  if (elapsed < LOOP_PERIOD_MS) delay(LOOP_PERIOD_MS - elapsed);
}

// ---------------------------------------------------------------------------
// Motor test pattern (non-blocking): forward, stop, reverse, stop, on a 4 s
// loop, so the MODE button stays responsive while a wheel is spinning.
// ---------------------------------------------------------------------------
int motorTestSpeed(unsigned long sinceEnter) {
  unsigned long t = sinceEnter % 4000;
  if (t < 1500)      return  MOTOR_TEST_SPEED;  // forward
  else if (t < 2000) return  0;                 // stop
  else if (t < 3500) return -MOTOR_TEST_SPEED;  // reverse
  else               return  0;                 // stop
}

// Show a signed speed on the display, e.g. -60 or 60, right-aligned.
void showSignedSpeed(int speed) {
  display.showNumberDec(speed, false);
}
