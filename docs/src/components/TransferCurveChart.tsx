import React from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import './TransferCurveChart.css';

export interface TransferPoint {
  x: number;
  y: number;
}

interface TransferCurveChartProps {
  points: TransferPoint[];
  caption?: string;
  height?: number;
}

function interpolate(points: TransferPoint[], steps = 200): { x: number; y: number }[] {
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const data: { x: number; y: number }[] = [];

  for (let i = 0; i <= steps; i++) {
    const x = -100 + (200 * i) / steps;
    let y = 0;
    if (x <= sorted[0].x) {
      y = sorted[0].y;
    } else if (x >= sorted[sorted.length - 1].x) {
      y = sorted[sorted.length - 1].y;
    } else {
      for (let j = 0; j < sorted.length - 1; j++) {
        if (x >= sorted[j].x && x <= sorted[j + 1].x) {
          const t = (x - sorted[j].x) / (sorted[j + 1].x - sorted[j].x);
          y = sorted[j].y + t * (sorted[j + 1].y - sorted[j].y);
          break;
        }
      }
    }
    data.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
  }
  return data;
}

function Chart({ points, height }: { points: TransferPoint[]; height: number }) {
  const {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
  } = require('recharts');

  const data = interpolate(points);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
        <CartesianGrid
          stroke="rgba(100, 96, 80, 0.2)"
          strokeDasharray="3 3"
        />
        <XAxis
          dataKey="x"
          type="number"
          domain={[-100, 100]}
          ticks={[-100, -50, 0, 50, 100]}
          tick={{ fill: '#908c7e', fontSize: 11 }}
          axisLine={{ stroke: 'rgba(100, 96, 80, 0.4)' }}
          tickLine={{ stroke: 'rgba(100, 96, 80, 0.4)' }}
          label={{
            value: 'Input',
            position: 'insideBottom',
            offset: -10,
            fill: '#908c7e',
            fontSize: 12,
          }}
        />
        <YAxis
          type="number"
          domain={[-100, 100]}
          ticks={[-100, -50, 0, 50, 100]}
          tick={{ fill: '#908c7e', fontSize: 11 }}
          axisLine={{ stroke: 'rgba(100, 96, 80, 0.4)' }}
          tickLine={{ stroke: 'rgba(100, 96, 80, 0.4)' }}
          label={{
            value: 'Output',
            angle: -90,
            position: 'insideLeft',
            offset: 8,
            fill: '#908c7e',
            fontSize: 12,
          }}
        />
        <ReferenceLine x={0} stroke="rgba(100, 96, 80, 0.35)" />
        <ReferenceLine y={0} stroke="rgba(100, 96, 80, 0.35)" />
        <Tooltip
          contentStyle={{
            background: 'rgba(18, 19, 15, 0.95)',
            border: '1px solid #33342b',
            borderRadius: 3,
            fontSize: 12,
            color: '#e8e4d8',
          }}
          formatter={(value: number) => [value, 'Output']}
          labelFormatter={(label: number) => `Input: ${label}`}
        />
        <Line
          type="linear"
          dataKey="y"
          stroke="#6aab7a"
          strokeWidth={2.5}
          dot={false}
          activeDot={{
            r: 4,
            fill: '#6aab7a',
            stroke: '#12130f',
            strokeWidth: 2,
          }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export default function TransferCurveChart({
  points,
  caption,
  height = 260,
}: TransferCurveChartProps) {
  return (
    <figure className="tc-figure">
      <div className="tc-chart-wrapper" style={{ height }}>
        <BrowserOnly fallback={<div style={{ height }} />}>
          {() => <Chart points={points} height={height} />}
        </BrowserOnly>
      </div>
      {caption && <figcaption className="tc-caption">{caption}</figcaption>}
    </figure>
  );
}
