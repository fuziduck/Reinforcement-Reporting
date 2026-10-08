/** Lightweight dependency-free SVG charts for commercial trend analysis. */
import type { ReactNode } from 'react';

export interface Series {
  name: string;
  color: string;
  values: (number | null)[];
  dashed?: boolean;
}

interface ChartProps {
  title: string;
  sub?: string;
  labels: string[];
  series: Series[];
  format: (v: number) => string;
  height?: number;
}

const W = 720;
const H = 240;
const PAD = { l: 62, r: 14, t: 12, b: 30 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (v <= m * mag) return m * mag;
  }
  return 10 * mag;
}

type Coords = { x: (i: number) => number; y: (v: number) => number };

function Frame({
  title, sub, labels, series, format, children, yMax, yMin = 0,
}: ChartProps & { children: (c: Coords) => ReactNode; yMax: number; yMin?: number }) {
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const yTicks = 4;
  const xStep = labels.length > 1 ? iw / (labels.length - 1) : 0;
  const y = (v: number) => PAD.t + ih - ((v - yMin) / (yMax - yMin || 1)) * ih;
  const x = (i: number) => PAD.l + (labels.length > 1 ? i * xStep : iw / 2);
  const labelEvery = Math.ceil(labels.length / 10);
  return (
    <div className="chart-card">
      <h3>{title}</h3>
      {sub && <div className="sub">{sub}</div>}
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
        {Array.from({ length: yTicks + 1 }, (_, t) => {
          const v = yMin + ((yMax - yMin) * t) / yTicks;
          return (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="#e4e7eb" strokeWidth={1} />
              <text x={PAD.l - 8} y={y(v) + 3.5} textAnchor="end" fontSize={10} fill="#6b7280">
                {format(v)}
              </text>
            </g>
          );
        })}
        {labels.map((l, i) =>
          i % labelEvery === 0 ? (
            <text key={i} x={x(i)} y={H - 10} textAnchor="middle" fontSize={10} fill="#6b7280">
              {l}
            </text>
          ) : null,
        )}
        {children({ x, y })}
      </svg>
      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.name}>
            <span className="sw" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

export function LineChart(props: ChartProps & { yMin?: number }) {
  const { series, labels, format, yMin = 0 } = props;
  const all = series.flatMap((s) => s.values).filter((v): v is number => v != null);
  const yMax = niceMax(Math.max(1, ...all) * 1.08);
  return (
    <Frame {...props} yMax={yMax} yMin={yMin}>
      {({ x, y }) => (
        <>
          {series.map((s) => {
            const pts = s.values
              .map((v, i) => (v == null ? null : `${x(i)},${y(v)}`))
              .filter(Boolean)
              .join(' ');
            return (
              <g key={s.name}>
                <polyline
                  points={pts}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2.2}
                  strokeDasharray={s.dashed ? '6 4' : undefined}
                  strokeLinejoin="round"
                />
                {s.values.map((v, i) =>
                  v == null ? null : (
                    <circle key={i} cx={x(i)} cy={y(v)} r={2.6} fill="#fff" stroke={s.color} strokeWidth={1.6}>
                      <title>{`${labels[i]} — ${s.name}: ${format(v)}`}</title>
                    </circle>
                  ),
                )}
              </g>
            );
          })}
        </>
      )}
    </Frame>
  );
}

export function BarChart(props: ChartProps) {
  const { series, labels, format } = props;
  const all = series.flatMap((s) => s.values).filter((v): v is number => v != null);
  const yMax = niceMax(Math.max(1, ...all) * 1.08);
  const iw = W - PAD.l - PAD.r;
  const slot = labels.length > 1 ? iw / labels.length : iw;
  const barW = Math.min(28, (slot * 0.72) / series.length);
  return (
    <Frame {...props} yMax={yMax}>
      {({ x, y }) => (
        <>
          {labels.map((_, i) =>
            series.map((s, si) => {
              const v = s.values[i];
              if (v == null) return null;
              const cx = x(i) - (series.length * barW) / 2 + si * barW;
              const top = y(Math.max(0, v));
              const h = Math.abs(y(v) - y(0));
              return (
                <rect
                  key={`${i}-${s.name}`}
                  x={cx}
                  y={top}
                  width={barW - 2}
                  height={Math.max(1, h)}
                  fill={s.color}
                  rx={1.5}
                >
                  <title>{`${labels[i]} — ${s.name}: ${format(v)}`}</title>
                </rect>
              );
            }),
          )}
        </>
      )}
    </Frame>
  );
}
