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
export function Donut({ data, center, empty }: { data: Datum[]; center?: ReactNode; empty?: ReactNode }) {
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
          <li key={d.label} className="flex items-center gap-2"><span className="size-2.5 shrink-0 rounded-sm" style={{ background: COLORS[d.tone ?? 'brand'] }} />
            <span className="flex-1 truncate">{d.label}</span><span className="font-medium num">{fmtNum(d.value)}</span></li>
        ))}
      </ul>
    </div>
  );
}
