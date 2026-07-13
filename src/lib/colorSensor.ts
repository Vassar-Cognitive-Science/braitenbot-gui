/**
 * Helpers for the color-sensor (TCS34725) trace input. The simulation reads
 * four 0–100 channel values per node (red / green / blue / clear-"white"), but
 * dragging four sliders to dial in a color is fiddly. These map between the
 * four channels and a friendlier hue + brightness model backing a color picker.
 *
 * The White/Clear channel is the unfiltered total-light photodiode. We can't
 * know it from RGB alone, so we ESTIMATE it as the color's luminance — good
 * enough to explore behavior in the browser, but the note in the UI tells
 * students to verify against the real sensor.
 */
import type { ColorChannel } from '../types/diagram';

export interface ColorChannels {
  red: number;
  green: number;
  blue: number;
  clear: number;
}

const clampByte = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const clamp100 = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** Rec. 709 luminance of 0–100 channel values, used to estimate the clear
 *  (total-light) channel from red/green/blue. */
export function estimateClear(red: number, green: number, blue: number): number {
  return clamp100(0.2126 * red + 0.7152 * green + 0.0722 * blue);
}

/** Parse a `#rrggbb` string into 0–255 components. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return { r: 0, g: 0, b: 0 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => clampByte(n).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/**
 * A picker hue (`#rrggbb`, full-brightness) plus a 0–100 brightness → the four
 * channel values. Brightness scales the hue's channels; clear is estimated.
 */
export function hueToChannels(hex: string, brightness: number): ColorChannels {
  const { r, g, b } = hexToRgb(hex);
  const scale = clamp100(brightness) / 100;
  const red = clamp100((r / 255) * 100 * scale);
  const green = clamp100((g / 255) * 100 * scale);
  const blue = clamp100((b / 255) * 100 * scale);
  return { red, green, blue, clear: estimateClear(red, green, blue) };
}

/**
 * The inverse: current channel values → the picker's hue hex and brightness.
 * Brightness is the strongest color channel; the hue normalizes the channels
 * back to full brightness so the swatch shows the color, not its dimness. A
 * fully dark reading shows as white hue at brightness 0.
 */
export function channelsToHue(ch: ColorChannels): { hex: string; brightness: number } {
  const maxc = Math.max(ch.red, ch.green, ch.blue);
  if (maxc <= 0) return { hex: '#ffffff', brightness: 0 };
  const norm = (v: number) => (v / maxc) * 255;
  return { hex: rgbToHex(norm(ch.red), norm(ch.green), norm(ch.blue)), brightness: clamp100(maxc) };
}

/** Order channels back into the sensor's port order for encoding. */
export function channelValue(ch: ColorChannels, channel: ColorChannel): number {
  return channel === 'clear' ? ch.clear : ch[channel];
}

/**
 * Impure rainbow swatches for quick color selection. Real surfaces never
 * reflect a single pure primary — a "red" patch still bounces some green and
 * blue — so each swatch is deliberately off-primary, closer to what the sensor
 * actually sees. Applied at full brightness (the swatch's own value).
 */
export const COLOR_SWATCHES: ReadonlyArray<{ name: string; hex: string }> = [
  { name: 'Red', hex: '#c8443a' },
  { name: 'Orange', hex: '#c47a34' },
  { name: 'Yellow', hex: '#bfae44' },
  { name: 'Green', hex: '#4f9a4a' },
  { name: 'Teal', hex: '#3f9691' },
  { name: 'Blue', hex: '#4661b8' },
  { name: 'Purple', hex: '#8154ac' },
  { name: 'White', hex: '#cfcbc0' },
];
