import { describe, expect, it } from 'vitest';
import {
  COLOR_SWATCHES,
  channelsToHue,
  estimateClear,
  hexToRgb,
  hueToChannels,
  rgbToHex,
} from '../colorSensor';

describe('colorSensor', () => {
  it('parses and formats hex', () => {
    expect(hexToRgb('#ff8000')).toEqual({ r: 255, g: 128, b: 0 });
    expect(rgbToHex(255, 128, 0)).toBe('#ff8000');
  });

  it('maps a full-brightness hue to proportional channels', () => {
    const ch = hueToChannels('#ff0000', 100);
    expect(ch.red).toBe(100);
    expect(ch.green).toBe(0);
    expect(ch.blue).toBe(0);
  });

  it('scales channels by brightness', () => {
    const ch = hueToChannels('#ffffff', 40);
    expect(ch.red).toBe(40);
    expect(ch.green).toBe(40);
    expect(ch.blue).toBe(40);
  });

  it('estimates the clear channel as luminance (green-weighted)', () => {
    // Pure green should read a higher clear than pure blue of equal channel.
    expect(estimateClear(0, 100, 0)).toBeGreaterThan(estimateClear(0, 0, 100));
  });

  it('round-trips a full-value hue + brightness through the channels', () => {
    // brightness is HSV "value" (max channel / 255), so the fixed point is a
    // full-value hue (max component 255) — how swatches and the slider work.
    const original = { hex: '#ff8040', brightness: 80 };
    const ch = hueToChannels(original.hex, original.brightness);
    const back = channelsToHue(ch);
    expect(back.brightness).toBe(80);
    // Hue recovers within rounding tolerance.
    const a = hexToRgb(original.hex);
    const b = hexToRgb(back.hex);
    expect(Math.abs(a.r - b.r)).toBeLessThanOrEqual(6);
    expect(Math.abs(a.g - b.g)).toBeLessThanOrEqual(6);
    expect(Math.abs(a.b - b.b)).toBeLessThanOrEqual(6);
  });

  it('a fully dark reading shows as white hue at brightness 0', () => {
    expect(channelsToHue({ red: 0, green: 0, blue: 0, clear: 0 })).toEqual({
      hex: '#ffffff',
      brightness: 0,
    });
  });

  it('rainbow swatches are impure (never a pure primary)', () => {
    for (const s of COLOR_SWATCHES) {
      const { r, g, b } = hexToRgb(s.hex);
      // No channel is 0 or 255 — real surfaces reflect a bit of everything.
      expect(Math.min(r, g, b)).toBeGreaterThan(0);
      expect(Math.max(r, g, b)).toBeLessThan(255);
    }
  });
});
