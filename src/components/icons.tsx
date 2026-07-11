// Small inline-SVG icon set, hand-drawn in the lucide style: 24x24 viewBox,
// currentColor stroke, 2px round-capped/round-joined strokes, no fill. Sized
// ~15px in buttons via the `size` prop (see the `.lucide-icon` CSS). Faithful
// recreations of the named lucide icons from their public designs. No runtime
// dependency on the lucide package.

import type { ReactNode, SVGProps } from 'react';

export type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 15, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      className="lucide-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

// lucide "search" — magnifying glass. Used on the Monitor button.
export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </Icon>
  );
}

// lucide "group" — overlapping boxes inside a bracketed container.
export function GroupIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 7V5c0-1.1.9-2 2-2h2" />
      <path d="M17 3h2c1.1 0 2 .9 2 2v2" />
      <path d="M21 17v2c0 1.1-.9 2-2 2h-2" />
      <path d="M7 21H5c-1.1 0-2-.9-2-2v-2" />
      <rect width="7" height="5" x="7" y="7" rx="1" />
      <rect width="7" height="5" x="10" y="12" rx="1" />
    </Icon>
  );
}

// lucide "ungroup" — two separated rounded boxes.
export function UngroupIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect width="8" height="6" x="5" y="4" rx="1" />
      <rect width="8" height="6" x="11" y="14" rx="1" />
    </Icon>
  );
}

// lucide "waypoints" — three nodes linked by curved paths. Used on Trace.
export function WaypointsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="5" cy="6" r="2.5" />
      <circle cx="19" cy="6" r="2.5" />
      <circle cx="12" cy="19" r="2.5" />
      <path d="M7 7.4c1.8 3.6 3 5.8 4.6 9.2" />
      <path d="M17 7.4c-1.8 3.6-3 5.8-4.6 9.2" />
    </Icon>
  );
}

// lucide "chevron-down" — split-button disclosure caret.
export function ChevronDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}

// lucide "settings" — gear with center hole. Used on the Settings button.
export function SettingsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  );
}

// lucide "message-square-text" — speech box with lines. Used on the Comment button.
export function CommentIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M7 9h10" />
      <path d="M7 13h6" />
    </Icon>
  );
}

// lucide "layers" — stacked sheets. Marks compound (subdiagram) nodes.
export function LayersIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
      <path d="m6.08 9.5-3.48 1.59a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83L17.92 9.5" />
      <path d="m6.08 14.5-3.48 1.59a1 1 0 0 0 0 1.83l8.58 3.9a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83l-3.48-1.59" />
    </Icon>
  );
}

// ── Per-node-type glyphs (shown inline before the node label) ──

// lucide "sun" — analog light sensor.
export function SunIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" /><path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" /><path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />
    </Icon>
  );
}

// lucide "toggle-right" — digital (on/off) sensor.
export function ToggleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect width="20" height="12" x="2" y="6" rx="6" ry="6" />
      <circle cx="16" cy="12" r="2" />
    </Icon>
  );
}

// lucide "palette" — color sensor.
export function PaletteIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
    </Icon>
  );
}

// lucide "ruler" — time-of-flight distance sensor.
export function RulerIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z" />
      <path d="m14.5 12.5 2-2" /><path d="m11.5 9.5 2-2" />
      <path d="m8.5 6.5 2-2" /><path d="m17.5 15.5 2-2" />
    </Icon>
  );
}

// lucide "filter" — threshold (funnels a smooth signal into a decision).
export function FilterIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </Icon>
  );
}

// lucide "timer" — delay.
export function TimerIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <line x1="10" x2="14" y1="2" y2="2" />
      <line x1="12" x2="15" y1="14" y2="11" />
      <circle cx="12" cy="14" r="8" />
    </Icon>
  );
}

// lucide "sigma" — summation.
export function SigmaIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M18 7V5a1 1 0 0 0-1-1H6.5a.5.5 0 0 0-.4.8l4.5 6a2 2 0 0 1 0 2.4l-4.5 6a.5.5 0 0 0 .4.8H17a1 1 0 0 0 1-1v-2" />
    </Icon>
  );
}

// lucide "asterisk" — multiply (gate).
export function AsteriskIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 6v12" />
      <path d="M17.196 9 6.804 15" />
      <path d="m6.804 9 10.392 6" />
    </Icon>
  );
}

// lucide "chevrons-down" — minimum.
export function ChevronsDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m7 6 5 5 5-5" />
      <path d="m7 13 5 5 5-5" />
    </Icon>
  );
}

// lucide "chevrons-up" — maximum.
export function ChevronsUpIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m17 11-5-5-5 5" />
      <path d="m17 18-5-5-5 5" />
    </Icon>
  );
}

// A single sine wave — oscillator (smooth periodic signal).
export function SineWaveIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 12c1.5 -6 4.5 -6 6 0s4.5 6 6 0 4.5 -6 6 0" />
    </Icon>
  );
}

// A jagged, erratic trace — noise (random signal). Pairs with the smooth sine
// of the oscillator to read as "the random one".
export function NoiseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2 12l2.5 -6 2.5 9 2.5 -11 2.5 8 2.5 -7 2.5 10 2.5 -9 2.5 6" />
    </Icon>
  );
}

// lucide "hash" — constant (a fixed value).
export function HashIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <line x1="4" x2="20" y1="9" y2="9" />
      <line x1="4" x2="20" y1="15" y2="15" />
      <line x1="10" x2="8" y1="3" y2="21" />
      <line x1="16" x2="14" y1="3" y2="21" />
    </Icon>
  );
}

// lucide "rotate-cw" — continuous-rotation servo (a driven wheel).
export function RotateIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </Icon>
  );
}

// lucide "gauge" — positional servo (points to an angle).
export function GaugeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m12 14 4-4" />
      <path d="M3.34 19a10 10 0 1 1 17.32 0" />
    </Icon>
  );
}

// lucide "power" — digital output (drives a pin high/low).
export function PowerIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 2v10" />
      <path d="M18.4 6.6a9 9 0 1 1-12.77.04" />
    </Icon>
  );
}

// lucide "monitor" — 7-segment display output.
export function MonitorIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <line x1="8" x2="16" y1="21" y2="21" />
      <line x1="12" x2="12" y1="17" y2="21" />
    </Icon>
  );
}

// lucide "log-in" — compound input port (signal entering a subdiagram).
export function LogInIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <polyline points="10 17 15 12 10 7" />
      <line x1="15" x2="3" y1="12" y2="12" />
    </Icon>
  );
}

// lucide "log-out" — compound output port (signal leaving a subdiagram).
export function LogOutIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" x2="9" y1="12" y2="12" />
    </Icon>
  );
}

// lucide "share-2" — three linked circles. Used on the Share menu button.
export function ShareIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.59 13.51 6.83 3.98" />
      <path d="m15.41 6.51-6.82 3.98" />
    </Icon>
  );
}
