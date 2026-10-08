import type { ReactNode } from 'react';
import { fmtNum } from '../i18n';
import { cx } from './kit';

// Small charts drawn with plain elements. Every bar carries its value as a tooltip and a visible label.
export type Datum = { label: string; value: number; tone?: string };
const TONES: Record<string, string> = { brand: 'bg-brand', green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500', blue: 'bg-blue-500', grey: 'bg-zinc-400' };

// Columns over time (months, days).
export function Columns({ data, empty, height = 140 }: { data: Datum[]; empty?: ReactNode; height?: number }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.length) return <div className="py-10 text-center text-sm text-zinc-500">{empty}</div>;
  return (
    <div className="flex items-end gap-1.5" style={{ height: height + 36 }}>
      {data.map((d) => (
        <div key={d.label} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${d.label}: ${fmtNum(d.value)}`}>
          <span className="text-[10px] text-zinc-500 num">{fmtNum(d.value)}</span>
          <div className={cx('w-full max-w-10 rounded-t transition-all', TONES[d.tone ?? 'brand'])} style={{ height: Math.max(2, (d.value / max) * height) }} />
          <span className="w-full truncate text-center text-[10px] text-zinc-500 num">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

// Ranked horizontal bars (reasons, companies, cities).
export function Bars({ data, empty, format = fmtNum }: { data: Datum[]; empty?: ReactNode; format?: (n: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.length) return <div className="py-10 text-center text-sm text-zinc-500">{empty}</div>;
  return (
    <ul className="space-y-2.5">
      {data.map((d) => (
        <li key={d.label} title={`${d.label}: ${format(d.value)}`}>
          <div className="mb-1 flex justify-between gap-2 text-xs"><span className="truncate">{d.label}</span><span className="font-medium num">{format(d.value)}</span></div>
          <div className="h-2 rounded-full bg-zinc-100 dark:bg-zinc-800"><div className={cx('h-2 rounded-full', TONES[d.tone ?? 'brand'])} style={{ width: `${(d.value / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

// A ring split into parts, with its legend.
export function Donut({ data, center, empty, onPick }: { data: Datum[]; center?: ReactNode; empty?: ReactNode; onPick?: (d: Datum) => void }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return <div className="py-10 text-center text-sm text-zinc-500">{empty}</div>;
  const COLORS: Record<string, string> = { brand: 'var(--brand)', green: '#10b981', amber: '#f59e0b', red: '#ef4444', blue: '#3b82f6', grey: '#a1a1aa' };
  let acc = 0;
  const stops = data.map((d) => { const from = (acc / total) * 100; acc += d.value; return `${COLORS[d.tone ?? 'brand']} ${from}% ${(acc / total) * 100}%`; }).join(', ');
  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="relative size-32 shrink-0 rounded-full" style={{ background: `conic-gradient(${stops})` }}>
        <div className="absolute inset-4 flex flex-col items-center justify-center rounded-full bg-white text-center dark:bg-zinc-900">
          <span className="text-lg font-semibold num">{fmtNum(total)}</span>{center && <span className="text-[10px] text-zinc-500">{center}</span>}
        </div>
      </div>
      <ul className="min-w-32 flex-1 space-y-1.5 text-xs">
        {data.map((d) => (
          <li key={d.label} className={onPick ? 'cursor-pointer rounded hover:bg-zinc-100 dark:hover:bg-zinc-800' : undefined} onClick={onPick && (() => onPick(d))}>
            <span className="flex items-center gap-2"><span className="size-2.5 shrink-0 rounded-sm" style={{ background: COLORS[d.tone ?? 'brand'] }} />
            <span className="flex-1 truncate">{d.label}</span><span className="font-medium num">{fmtNum(d.value)}</span></span></li>
        ))}
      </ul>
    </div>
  );
}

// A line over time; the zero line is drawn when the values cross it.
export function Line({ data, empty, format = fmtNum, height = 160 }: { data: Datum[]; empty?: ReactNode; format?: (n: number) => string; height?: number }) {
  if (!data.length) return <div className="py-10 text-center text-sm text-zinc-500">{empty}</div>;
  const W = 1000; const H = height; const P = 6;
  const vals = data.map((d) => d.value);
  const min = Math.min(0, ...vals); const max = Math.max(0, ...vals);
  const span = max - min || 1;
  const x = (i: number) => P + (data.length === 1 ? (W - 2 * P) / 2 : (i * (W - 2 * P)) / (data.length - 1));
  const y = (v: number) => P + ((max - v) / span) * (H - 2 * P);
  const pts = data.map((d, i) => `${x(i)},${y(d.value)}`).join(' ');
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto max-h-56 w-full overflow-visible" role="img">
        {min < 0 && max > 0 && <line x1={0} x2={W} y1={y(0)} y2={y(0)} className="stroke-zinc-300 dark:stroke-zinc-700" strokeDasharray="4 4" />}
        <polyline points={pts} fill="none" stroke="var(--brand)" strokeWidth={2.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {data.map((d, i) => (
          <circle key={i} cx={x(i)} cy={y(d.value)} r={4} className={d.value < 0 ? 'fill-red-500' : 'fill-[var(--brand)]'}><title>{`${d.label}: ${format(d.value)}`}</title></circle>
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-zinc-500" dir="ltr"><span className="num">{data[0].label}</span><span className="num">{data.at(-1)!.label}</span></div>
    </div>
  );
}

// A circular gauge: green from 90%, amber from 70%, red below.
export function Gauge({ value, total, label }: { value: number; total: number; label?: ReactNode }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  const color = pct >= 90 ? '#10b981' : pct >= 70 ? '#f59e0b' : '#ef4444';
  const r = 52; const c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 120 120" className="size-32 shrink-0 -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" strokeWidth="12" className="stroke-zinc-100 dark:stroke-zinc-800" />
        <circle cx="60" cy="60" r={r} fill="none" strokeWidth="12" stroke={color} strokeLinecap="round" strokeDasharray={`${(pct / 100) * c} ${c}`} />
        <text x="60" y="66" textAnchor="middle" className="rotate-90 fill-current text-xl font-semibold" style={{ transformOrigin: '60px 60px' }}>{pct}%</text>
      </svg>
      <div className="text-sm"><div className="text-2xl font-semibold num">{fmtNum(value)} / {fmtNum(total)}</div>{label && <div className="text-xs text-zinc-500">{label}</div>}</div>
    </div>
  );
}
