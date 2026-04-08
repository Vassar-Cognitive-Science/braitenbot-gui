import type { VehicleWeights } from '../types';

interface BraitenbergDiagramProps {
  weights: VehicleWeights;
}

// Layout constants for the SVG schematic
const W = 320;
const H = 340;
const SENSOR_CY = 60;
const MOTOR_CY = 270;
const LEFT_X = 90;
const RIGHT_X = 230;
const BODY_Y = 90;
const BODY_H = 200;

/** Maps a connection weight to a stroke color. */
function weightColor(w: number): string {
  if (w > 0) return '#4ecca3'; // excitatory – teal
  if (w < 0) return '#e94560'; // inhibitory – red
  return '#444'; // no connection – grey
}

/** Maps a connection weight magnitude to a stroke width. */
function weightWidth(w: number): number {
  return 1 + Math.abs(w) * 6;
}

/** Renders a Bezier curve between a sensor and a motor, styled by weight. */
function ConnectionLine({
  x1,
  y1,
  x2,
  y2,
  weight,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  weight: number;
}) {
  if (Math.abs(weight) < 0.001) return null;

  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const d = `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`;
  const color = weightColor(weight);
  const width = weightWidth(weight);

  return (
    <path
      d={d}
      stroke={color}
      strokeWidth={width}
      fill="none"
      opacity={0.8}
      strokeLinecap="round"
    />
  );
}

/**
 * SVG schematic of a Braitenberg vehicle showing four sensor-to-motor
 * connections (LL, LR, RL, RR) styled by weight.
 */
export function BraitenbergDiagram({ weights }: BraitenbergDiagramProps) {
  return (
    <div className="diagram-wrapper">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        role="img"
        aria-label="Braitenberg vehicle connection diagram"
      >
        {/* Vehicle body */}
        <rect
          x={LEFT_X - 30}
          y={BODY_Y}
          width={RIGHT_X - LEFT_X + 60}
          height={BODY_H}
          rx="16"
          fill="#16213e"
          stroke="#334"
          strokeWidth="2"
        />

        {/* Motor (wheel) labels */}
        <rect x={LEFT_X - 14} y={MOTOR_CY - 14} width={28} height={28} rx="6" fill="#0f3460" stroke="#4ecca3" strokeWidth="2" />
        <rect x={RIGHT_X - 14} y={MOTOR_CY - 14} width={28} height={28} rx="6" fill="#0f3460" stroke="#4ecca3" strokeWidth="2" />

        {/* Sensor circles */}
        <circle cx={LEFT_X} cy={SENSOR_CY} r={20} fill="#0f3460" stroke="#e94560" strokeWidth="3" />
        <circle cx={RIGHT_X} cy={SENSOR_CY} r={20} fill="#0f3460" stroke="#e94560" strokeWidth="3" />

        {/* ── Connection lines ── */}
        {/* LL: left sensor → left motor */}
        <ConnectionLine x1={LEFT_X} y1={SENSOR_CY + 20} x2={LEFT_X} y2={MOTOR_CY - 14} weight={weights.ll} />
        {/* LR: left sensor → right motor */}
        <ConnectionLine x1={LEFT_X} y1={SENSOR_CY + 20} x2={RIGHT_X} y2={MOTOR_CY - 14} weight={weights.lr} />
        {/* RL: right sensor → left motor */}
        <ConnectionLine x1={RIGHT_X} y1={SENSOR_CY + 20} x2={LEFT_X} y2={MOTOR_CY - 14} weight={weights.rl} />
        {/* RR: right sensor → right motor */}
        <ConnectionLine x1={RIGHT_X} y1={SENSOR_CY + 20} x2={RIGHT_X} y2={MOTOR_CY - 14} weight={weights.rr} />

        {/* ── Labels ── */}
        <text x={LEFT_X} y={SENSOR_CY + 5} textAnchor="middle" fill="#e94560" fontSize="11" fontWeight="bold">LS</text>
        <text x={RIGHT_X} y={SENSOR_CY + 5} textAnchor="middle" fill="#e94560" fontSize="11" fontWeight="bold">RS</text>
        <text x={LEFT_X} y={MOTOR_CY + 5} textAnchor="middle" fill="#4ecca3" fontSize="11" fontWeight="bold">LM</text>
        <text x={RIGHT_X} y={MOTOR_CY + 5} textAnchor="middle" fill="#4ecca3" fontSize="11" fontWeight="bold">RM</text>

        {/* ── Legend ── */}
        <g transform={`translate(10, ${H - 50})`}>
          <text x="0" y="0" fill="#888" fontSize="9">Legend:</text>
          <line x1="0" y1="10" x2="20" y2="10" stroke="#4ecca3" strokeWidth="3" />
          <text x="24" y="14" fill="#888" fontSize="9">Excitatory (+)</text>
          <line x1="0" y1="25" x2="20" y2="25" stroke="#e94560" strokeWidth="3" />
          <text x="24" y="29" fill="#888" fontSize="9">Inhibitory (−)</text>
        </g>
      </svg>
    </div>
  );
}
