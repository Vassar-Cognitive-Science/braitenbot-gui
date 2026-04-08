import { useEffect, useRef, useState, useCallback } from 'react';
import type { Vec2, VehicleWeights } from '../types';

// ── Simulation constants ────────────────────────────────────────────────────

const CANVAS_W = 560;
const CANVAS_H = 420;

/** Base speed added to every motor before applying weights (pixels / second) */
const BASE_SPEED = 60;
/** Maximum combined motor speed (pixels / second) */
const MAX_SPEED = 180;
/** Distance between the two wheels (pixels) */
const WHEELBASE = 20;
/** Light intensity decay constant (larger = faster decay) */
const LIGHT_DECAY = 0.002;
/** Max trail length (number of recorded positions) */
const MAX_TRAIL = 600;
/** Simulation steps per animation frame (1 = real-time at 60 fps) */
const STEPS_PER_FRAME = 2;
/** Seconds per simulation step */
const DT = 1 / 60 / STEPS_PER_FRAME;

// ── Helpers ─────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** Perceived light intensity at `pos` from a point light at `light`. */
function lightIntensity(pos: Vec2, light: Vec2): number {
  const dx = pos.x - light.x;
  const dy = pos.y - light.y;
  const d2 = dx * dx + dy * dy;
  return 1 / (1 + LIGHT_DECAY * d2);
}

/** Distance (px) of each sensor ahead of the vehicle centre. */
const SENSOR_FWD = 12;
/** Lateral distance (px) of each sensor from the vehicle centre-line. */
const SENSOR_LAT = 10;

/** Sensor position relative to the vehicle centre. */
function sensorPos(cx: number, cy: number, heading: number, side: 'left' | 'right'): Vec2 {
  const sign = side === 'left' ? -1 : 1;
  return {
    x: cx + SENSOR_FWD * Math.cos(heading) + sign * SENSOR_LAT * Math.sin(heading),
    y: cy + SENSOR_FWD * Math.sin(heading) - sign * SENSOR_LAT * Math.cos(heading),
  };
}

interface VehiclePhysics {
  x: number;
  y: number;
  heading: number;
}

function stepVehicle(
  v: VehiclePhysics,
  weights: VehicleWeights,
  light: Vec2,
): VehiclePhysics {
  const lSensor = sensorPos(v.x, v.y, v.heading, 'left');
  const rSensor = sensorPos(v.x, v.y, v.heading, 'right');

  const lI = lightIntensity(lSensor, light);
  const rI = lightIntensity(rSensor, light);

  // Motor speeds: base ± weighted sensor input
  const leftSpeed = clamp(
    BASE_SPEED + (weights.ll * lI + weights.rl * rI) * BASE_SPEED,
    0,
    MAX_SPEED,
  );
  const rightSpeed = clamp(
    BASE_SPEED + (weights.lr * lI + weights.rr * rI) * BASE_SPEED,
    0,
    MAX_SPEED,
  );

  // Differential-drive kinematics
  const v_lin = (leftSpeed + rightSpeed) / 2;
  const omega = (rightSpeed - leftSpeed) / WHEELBASE;

  const newHeading = v.heading + omega * DT;
  const newX = v.x + v_lin * Math.cos(newHeading) * DT;
  const newY = v.y + v_lin * Math.sin(newHeading) * DT;

  // Wrap around canvas edges
  return {
    x: ((newX % CANVAS_W) + CANVAS_W) % CANVAS_W,
    y: ((newY % CANVAS_H) + CANVAS_H) % CANVAS_H,
    heading: newHeading,
  };
}

// ── Drawing ──────────────────────────────────────────────────────────────────

function drawScene(
  ctx: CanvasRenderingContext2D,
  vehicle: VehiclePhysics,
  light: Vec2,
  trail: Vec2[],
  weights: VehicleWeights,
) {
  // Background
  ctx.fillStyle = '#0f0f23';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Trail
  if (trail.length > 1) {
    ctx.beginPath();
    ctx.moveTo(trail[0].x, trail[0].y);
    for (let i = 1; i < trail.length; i++) {
      ctx.lineTo(trail[i].x, trail[i].y);
    }
    ctx.strokeStyle = 'rgba(78,204,163,0.3)';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  // Light source glow
  const grd = ctx.createRadialGradient(light.x, light.y, 2, light.x, light.y, 60);
  grd.addColorStop(0, 'rgba(255,220,100,0.95)');
  grd.addColorStop(0.3, 'rgba(255,180,50,0.4)');
  grd.addColorStop(1, 'rgba(255,150,0,0)');
  ctx.beginPath();
  ctx.arc(light.x, light.y, 60, 0, Math.PI * 2);
  ctx.fillStyle = grd;
  ctx.fill();

  // Light source centre
  ctx.beginPath();
  ctx.arc(light.x, light.y, 7, 0, Math.PI * 2);
  ctx.fillStyle = '#ffe566';
  ctx.fill();

  // Sensors
  const lSensor = sensorPos(vehicle.x, vehicle.y, vehicle.heading, 'left');
  const rSensor = sensorPos(vehicle.x, vehicle.y, vehicle.heading, 'right');

  [lSensor, rSensor].forEach((s) => {
    ctx.beginPath();
    ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#e94560';
    ctx.fill();
  });

  // Vehicle body (triangle pointing in heading direction)
  ctx.save();
  ctx.translate(vehicle.x, vehicle.y);
  ctx.rotate(vehicle.heading);

  ctx.beginPath();
  ctx.moveTo(15, 0);
  ctx.lineTo(-10, 8);
  ctx.lineTo(-10, -8);
  ctx.closePath();
  ctx.fillStyle = '#4ecca3';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.fill();
  ctx.stroke();

  // Left/right motor indicators
  ctx.fillStyle = weights.ll !== 0 || weights.rl !== 0 ? '#4ecca3' : '#334';
  ctx.fillRect(-12, -12, 6, 8);
  ctx.fillStyle = weights.lr !== 0 || weights.rr !== 0 ? '#4ecca3' : '#334';
  ctx.fillRect(-12, 4, 6, 8);

  ctx.restore();
}

// ── Component ─────────────────────────────────────────────────────────────────

interface SimulationCanvasProps {
  weights: VehicleWeights;
}

function defaultVehicle(): VehiclePhysics {
  return { x: CANVAS_W / 2, y: CANVAS_H / 2 + 80, heading: -Math.PI / 2 };
}

function defaultLight(): Vec2 {
  return { x: CANVAS_W / 2, y: CANVAS_H / 2 - 60 };
}

/**
 * Interactive canvas that runs a real-time Braitenberg vehicle physics
 * simulation.  The light source can be dragged to reposition it.
 */
export function SimulationCanvas({ weights }: SimulationCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vehicleRef = useRef<VehiclePhysics>(defaultVehicle());
  const lightRef = useRef<Vec2>(defaultLight());
  const trailRef = useRef<Vec2[]>([]);
  const runningRef = useRef(false);
  const rafRef = useRef<number>(0);
  const draggingLight = useRef(false);
  const weightsRef = useRef<VehicleWeights>(weights);

  const [running, setRunning] = useState(false);

  // Keep weightsRef in sync without restarting the animation loop
  useEffect(() => {
    weightsRef.current = weights;
  }, [weights]);

  const tick = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (runningRef.current) {
      for (let i = 0; i < STEPS_PER_FRAME; i++) {
        vehicleRef.current = stepVehicle(
          vehicleRef.current,
          weightsRef.current,
          lightRef.current,
        );
        trailRef.current.push({ ...vehicleRef.current });
        if (trailRef.current.length > MAX_TRAIL) trailRef.current.shift();
      }
    }

    drawScene(
      ctx,
      vehicleRef.current,
      lightRef.current,
      trailRef.current,
      weightsRef.current,
    );
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  // Start animation loop once on mount
  useEffect(() => {
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [tick]);

  const handlePlayPause = () => {
    runningRef.current = !runningRef.current;
    setRunning(runningRef.current);
  };

  const handleReset = () => {
    vehicleRef.current = defaultVehicle();
    trailRef.current = [];
  };

  const handleClearTrail = () => {
    trailRef.current = [];
  };

  // Light-source dragging
  const canvasPos = useCallback(
    (e: React.MouseEvent | React.TouchEvent): Vec2 => {
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const scaleX = CANVAS_W / rect.width;
      const scaleY = CANVAS_H / rect.height;
      if ('touches' in e) {
        const t = e.touches[0];
        return {
          x: (t.clientX - rect.left) * scaleX,
          y: (t.clientY - rect.top) * scaleY,
        };
      }
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    },
    [],
  );

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const pos = canvasPos(e);
      const l = lightRef.current;
      const dist = Math.hypot(pos.x - l.x, pos.y - l.y);
      if (dist < 20) draggingLight.current = true;
    },
    [canvasPos],
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!draggingLight.current) return;
      lightRef.current = canvasPos(e);
    },
    [canvasPos],
  );

  const onMouseUp = useCallback(() => {
    draggingLight.current = false;
  }, []);

  return (
    <div className="simulation-section">
      <div className="simulation-header">
        <h2 className="section-title">Simulation</h2>
        <span className="simulation-hint">Drag the ☀ light source to move it</span>
      </div>
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        className="simulation-canvas"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      />
      <div className="simulation-controls">
        <button className="btn btn-primary" onClick={handlePlayPause}>
          {running ? '⏸ Pause' : '▶ Play'}
        </button>
        <button className="btn btn-outline" onClick={handleReset}>
          ↺ Reset
        </button>
        <button className="btn btn-outline" onClick={handleClearTrail}>
          Clear Trail
        </button>
      </div>
    </div>
  );
}
