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
