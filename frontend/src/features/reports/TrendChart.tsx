"use client";

import { useState } from "react";

import type { TrendPoint } from "./dashboard";

const WIDTH = 640;
const HEIGHT = 200;
const PAD = { top: 12, right: 8, bottom: 26, left: 32 };

/** A readable "Nov 10" for the first day of a week. */
function shortDay(iso: string): string {
  const [, month, day] = iso.split("-").map(Number);
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[(month ?? 1) - 1]} ${day}`;
}

/** Round the top of the scale up to 4, 5, 10, 20, 50... so the grid lines fall on whole numbers. */
function niceMax(value: number): number {
  if (value <= 4) return 4;
  const step = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / step) * step;
}

/**
 * Tasks created and completed in each week: two bars side by side, on one axis. "Completed" is
 * the series that matters (the brand colour); "created" is the grey context next to it. The same
 * numbers are available as a table, and each bar says its value when pointed at.
 */
export function TrendChart({ points }: { points: TrendPoint[] }) {
  const [asTable, setAsTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const top = niceMax(Math.max(1, ...points.flatMap((p) => [p.created, p.completed])));
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const slot = plotW / Math.max(1, points.length);
  const bar = Math.min(18, (slot - 6) / 2);
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const ticks = [0, top / 2, top];

  return (
    <figure className="m-0 grid gap-2" aria-label="Tasks created and completed per week">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ul className="m-0 flex list-none gap-4 p-0 text-[13px]">
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-sm bg-line-strong" /> Created
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-sm bg-primary" /> Completed
          </li>
        </ul>
        <button
          type="button"
          onClick={() => setAsTable((v) => !v)}
          className="text-[13px] text-primary underline-offset-2 hover:underline"
        >
          {asTable ? "Show chart" : "Show as table"}
        </button>
      </div>
      {asTable ? (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="m-0">
            <thead>
              <tr>
                <th scope="col">Week of</th>
                <th scope="col" className="text-right">Created</th>
                <th scope="col" className="text-right">Completed</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.week}>
                  <td>{p.week}</td>
                  <td className="text-right tabular-nums">{p.created}</td>
                  <td className="text-right tabular-nums">{p.completed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="img"
            aria-label={`Weekly tasks: ${points.map((p) => `${shortDay(p.week)} ${p.created} created, ${p.completed} completed`).join("; ")}`}
            className="h-auto w-full"
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(t)} y2={y(t)} className="stroke-line" strokeWidth={1} />
                <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" className="fill-muted text-[10px]">
                  {t}
                </text>
              </g>
            ))}
            {points.map((p, i) => {
              const cx = PAD.left + slot * i + slot / 2;
              const rect = (value: number, x: number, cls: string) =>
                value > 0 ? (
                  <rect x={x} y={y(value)} width={bar} height={y(0) - y(value)} rx={3} className={cls} />
                ) : null;
              return (
                <g key={p.week} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                  {/* A wider invisible target than the bars, so they are easy to point at. */}
                  <rect x={cx - slot / 2} y={PAD.top} width={slot} height={plotH} fill="transparent" />
                  {rect(p.created, cx - bar - 1, "fill-line-strong")}
                  {rect(p.completed, cx + 1, "fill-primary")}
                  <text x={cx} y={HEIGHT - 8} textAnchor="middle" className="fill-muted text-[10px]">
                    {shortDay(p.week)}
                  </text>
                </g>
              );
            })}
          </svg>
          {hover !== null && points[hover] && (
            <div
              role="status"
              className="pointer-events-none absolute top-0 right-0 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs shadow-sm"
            >
              <b>Week of {shortDay(points[hover].week)}</b>
              <br />
              Created: {points[hover].created} · Completed: {points[hover].completed}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
