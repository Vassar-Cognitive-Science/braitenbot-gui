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
//   - Pick which device to test over the USB serial monitor (115200 baud):
//     send a mode number (1-9), or "n" / "p" for next / previous.
//   - The 7-segment display shows the current mode's live reading; the serial
//     monitor prints full diagnostics for every device each loop.
//   - Motor modes (7, 8) spin a wheel forward/stop/reverse on a repeating cycle.
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

// ADC full-scale count at the ~101 ms integration time set below. A channel at
// this value maps to 100. Matches TCS34725_FULL_SCALE in the code generator, so
// the test sketch reports the same 0-100 scale a generated diagram would.
const float TCS34725_FULL_SCALE = 44032.0;

struct ColorSample { uint16_t c, r, g, b; };

// Scale a raw 16-bit channel count to the 0-100 signal range (saturated = 100).
int colorPercent(uint16_t raw) {
  return (int)(constrain(raw * (100.0 / TCS34725_FULL_SCALE), 0.0, 100.0) + 0.5);
}

// Scale a raw analog reading (0-1023) to 0-100, like an Analog Sensor node
// (before any invert option).
int analogPercent(int raw) {
  return (int)(constrain(raw * (100.0 / 1023.0), 0.0, 100.0) + 0.5);
}

// Distance (mm) that maps to full scale for the ToF readout — matches the ToF
// Distance node's default Max Distance, so the test shows the same 0-100 a
// default node would.
const float TOF_MAX_MM = 500.0;

// Scale a ToF distance (mm) to 0-100 the way a ToF Distance node does: a closer
// object reads higher, ramping to 0 at TOF_MAX_MM.
int tofPercent(int distMm) {
  return (int)(constrain((1.0 - distMm / TOF_MAX_MM) * 100.0, 0.0, 100.0) + 0.5);
}

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

// Which ToF sensors actually answered at boot (set in setup()).
bool tof1Present = false;
bool tof2Present = false;

// Line buffer for mode-selection commands typed over USB serial.
char serialCmdBuf[16];
uint8_t serialCmdLen = 0;

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

  Serial.print(F("Left ToF (XSHUT pin ")); Serial.print(TOF1_XSHUT_PIN); Serial.print(F("): "));
  tof1Present = bringUpTof(tof1, TOF1_XSHUT_PIN, TOF1_I2C_ADDR);
  Serial.println(tof1Present ? F("OK") : F("NOT FOUND"));

  Serial.print(F("Right ToF (XSHUT pin ")); Serial.print(TOF2_XSHUT_PIN); Serial.print(F("): "));
  tof2Present = bringUpTof(tof2, TOF2_XSHUT_PIN, TOF2_I2C_ADDR);
  Serial.println(tof2Present ? F("OK") : F("NOT FOUND"));

  // --- Color sensor (fixed at 0x29; ToFs are off 0x29 now). ---
  tcs34725_begin(COLOR_GAIN_REG);
  Serial.print(F("Color sensor (0x29): "));
  Serial.println(i2cResponding(0x29) ? F("responding") : F("NOT FOUND"));

  modeEnteredAt = millis();
  Serial.println(F("Ready. Select a mode over serial: 1-9 = mode number,"));
  Serial.println(F("n = next, p = previous."));
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

// Jump straight to a mode (used by serial commands). Modes are selected only
// over serial — the front-left bumper is a normal switch again (tested in the
// bumpers mode).
void startMode(int mode) {
  currentMode = ((mode % MODE_COUNT) + MODE_COUNT) % MODE_COUNT;
  modeEnteredAt = millis();
  driveLeft(0);
  driveRight(0);
  Serial.print(F("--- Mode "));
  Serial.print(currentMode + 1);
  Serial.println(F(" started ---"));
}

// Read mode-selection commands from USB serial (newline-terminated):
//   1..9  -> jump to that mode number
//   n / + -> next mode
//   p / - -> previous mode
void handleSerialCommand() {
  while (Serial.available() > 0) {
    char ch = (char)Serial.read();
    if (ch == '\n' || ch == '\r') {
      if (serialCmdLen > 0) {
        serialCmdBuf[serialCmdLen] = '\0';
        char c = serialCmdBuf[0];
        if (c == 'n' || c == 'N' || c == '+') {
          startMode(currentMode + 1);
        } else if (c == 'p' || c == 'P' || c == '-') {
          startMode(currentMode + MODE_COUNT - 1);
        } else {
          int n = atoi(serialCmdBuf);
          if (n >= 1 && n <= MODE_COUNT) startMode(n - 1);
        }
      }
      serialCmdLen = 0;
    } else if (serialCmdLen < sizeof(serialCmdBuf) - 1) {
      serialCmdBuf[serialCmdLen++] = ch;
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
  handleSerialCommand();

  unsigned long sinceEnter = loopStart - modeEnteredAt;

  switch (currentMode) {
    case MODE_PHOTOCELL_LEFT: {
      int v = analogPercent(analogRead(PHOTOCELL_LEFT_PIN));
      showValue(v);
      Serial.print(F("Photocell L (0-100): ")); Serial.println(v);
      break;
    }
    case MODE_PHOTOCELL_RIGHT: {
      int v = analogPercent(analogRead(PHOTOCELL_RIGHT_PIN));
      showValue(v);
      Serial.print(F("Photocell R (0-100): ")); Serial.println(v);
      break;
    }
    case MODE_TOF1: {
      if (!tof1Present) {
        showDashes();
        Serial.println(F("Left ToF: not found at boot"));
        break;
      }
      static int held = 9999;
      readTof(tof1, TOF1_I2C_ADDR >> 1, held);  // 8-bit addr -> 7-bit
      int pct = tofPercent(held);
      showValue(pct);
      Serial.print(F("Left ToF (0-100): ")); Serial.print(pct);
      Serial.print(F("  (dist mm: ")); Serial.print(held); Serial.println(F(")"));
      break;
    }
    case MODE_TOF2: {
      if (!tof2Present) {
        showDashes();
        Serial.println(F("Right ToF: not found at boot"));
        break;
      }
      static int held = 9999;
      readTof(tof2, TOF2_I2C_ADDR >> 1, held);  // 8-bit addr -> 7-bit
      int pct = tofPercent(held);
      showValue(pct);
      Serial.print(F("Right ToF (0-100): ")); Serial.print(pct);
      Serial.print(F("  (dist mm: ")); Serial.print(held); Serial.println(F(")"));
      break;
    }
    case MODE_COLOR: {
      ColorSample s = tcs34725_read();
      int c = colorPercent(s.c);
      int r = colorPercent(s.r);
      int g = colorPercent(s.g);
      int b = colorPercent(s.b);
      showValue(c);   // display the clear channel, scaled to 0-100
      Serial.print(F("Color (0-100)  C:")); Serial.print(c);
      Serial.print(F(" R:"));               Serial.print(r);
      Serial.print(F(" G:"));               Serial.print(g);
      Serial.print(F(" B:"));               Serial.println(b);
      break;
    }
    case MODE_BUMPERS: {
      // One digit per switch: FL FR RL RR (1 = pressed, 0 = open). All four are
      // tested live here — the front-left switch is no longer a mode button.
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
