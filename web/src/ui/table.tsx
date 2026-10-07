import { Children, isValidElement, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowDownUp, ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Inbox, Lock, Search, SearchX, SlidersHorizontal, X } from 'lucide-react';
import { ApiError, get } from '../api';
import { useI18n, fmtNum } from '../i18n';
import { Button, Checkbox, cx, Spinner } from './kit';

// ---------- list state lives in the URL, so a filtered view can be shared ----------
export type ListData<R = any> = { rows: R[]; total: number; page: number; pageSize: number; stats?: any; [k: string]: any };

export function useList<R = any>(endpoint: string | null, defaults: Record<string, string> = {}) {
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => ({ ...defaults, ...Object.fromEntries(params) }), [params]); // eslint-disable-line react-hooks/exhaustive-deps
  const [data, setData] = useState<ListData<R> | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string | number>>(new Set());
  const reqId = useRef(0);

  const load = useCallback(async () => {
    if (!endpoint) return;
    const id = ++reqId.current;
    setLoading(true);
    try {
      const d = await get<ListData<R>>(endpoint, query);
      if (id === reqId.current) { setData(d); setError(null); }
    } catch (e) {
      if (id === reqId.current) setError(e as ApiError);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [endpoint, query]);

  // the search box waits for typing to pause
  useEffect(() => { const h = setTimeout(load, 250); return () => clearTimeout(h); }, [load]);

  // The selection is cleared whenever the search, the filters or the page change.
  const setMany = useCallback((patch: Record<string, string | null | undefined>, keepPage = false) => {
    setParams((p) => {
      const n = new URLSearchParams(p);
      for (const [k, v] of Object.entries(patch)) (v === null || v === undefined || v === '' ? n.delete(k) : n.set(k, v));
      if (!keepPage) n.delete('page');
      return n;
    }, { replace: true });
    setSelected(new Set());
  }, [setParams]);
  const set = useCallback((k: string, v: string | null | undefined) => setMany({ [k]: v }, k === 'page' || k === 'pageSize' ? k === 'page' : false), [setMany]);
  const clear = useCallback(() => { setParams(new URLSearchParams(), { replace: true }); setSelected(new Set()); }, [setParams]);
  const hasFilters = Object.keys(Object.fromEntries(params)).some((k) => !['page', 'pageSize', 'sort'].includes(k));

  return { data, rows: data?.rows ?? [], stats: data?.stats, loading, error, query, set, setMany, clear, reload: load, hasFilters, selected, setSelected };
}
export type ListState = ReturnType<typeof useList>;

// ---------- table ----------
// The actions column stays in view when a wide table scrolls sideways.
const STICKY_END = 'sticky end-0 shadow-[-8px_0_8px_-8px_rgb(0_0_0/.08)] rtl:shadow-[8px_0_8px_-8px_rgb(0_0_0/.08)]';
export type Column<R> = { key: string; header: ReactNode; render?: (r: R) => ReactNode; sort?: string; className?: string; title?: string };

export function DataTable<R extends Record<string, any>>({ list, columns, rowKey = 'id', onRowClick, selectable, bulk, emptyText }: {
  list: ListState; columns: Column<R>[]; rowKey?: string; onRowClick?: (r: R) => void; selectable?: boolean; bulk?: ReactNode; emptyText?: ReactNode;
}) {
  const { t, dir } = useI18n();
  const rows = list.rows as R[];
  const ids = rows.map((r) => r[rowKey]);
  const allOn = ids.length > 0 && ids.every((id) => list.selected.has(id));
  const toggle = (id: string | number) => {
    const n = new Set(list.selected);
    n.has(id) ? n.delete(id) : n.add(id);
    list.setSelected(n);
  };
  const sort = list.query.sort ?? '';
  const sortBy = (key: string) => list.set('sort', sort === key ? `-${key}` : key);
  const d = list.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;
  const Prev = dir === 'rtl' ? ChevronRight : ChevronLeft;
  const Next = dir === 'rtl' ? ChevronLeft : ChevronRight;

  let empty: ReactNode = null;
  let EmptyIcon = Inbox;
  if (list.error?.status === 403) { empty = t('table.no_permission'); EmptyIcon = Lock; }
  else if (list.error?.status === 401) { empty = t('table.session_ended'); EmptyIcon = Lock; }
  else if (list.error) empty = t('err.server_error');
  else if (!list.loading && rows.length === 0) { empty = emptyText ?? (list.hasFilters ? t('table.no_match') : t('table.no_records')); if (list.hasFilters) EmptyIcon = SearchX; }

  return (
    <div className={cx('rounded-xl border border-zinc-200/80 bg-white shadow-xs transition-opacity dark:border-zinc-800 dark:bg-zinc-900', list.loading && rows.length > 0 && 'opacity-60')}>
      {selectable && list.selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-brand/20 bg-brand-soft px-3 py-2 text-sm">
          <span className="font-medium">{t('table.selected', { n: list.selected.size })}</span>
          <div className="flex flex-wrap gap-2">{bulk}</div>
          <Button size="sm" variant="ghost" className="ms-auto" onClick={() => list.setSelected(new Set())}>{t('table.clear_selection')}</Button>
        </div>
      )}
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50/80 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800/30">
            <tr>
              {selectable && (
                <th className="w-10 px-3 py-2.5"><Checkbox checked={allOn} onChange={(v) => list.setSelected(v ? new Set(ids) : new Set())} /></th>
              )}
              {columns.map((c) => (
                <th key={c.key} className={cx('px-3 py-2.5 text-start font-medium whitespace-nowrap', c.key === 'actions' && STICKY_END + ' bg-zinc-50 dark:bg-zinc-900', c.className)} title={c.title}>
                  {c.sort ? (
                    <button className="inline-flex items-center gap-1 hover:text-zinc-900 dark:hover:text-zinc-100" onClick={() => sortBy(c.sort!)}>
                      {c.header}
                      {sort === c.sort ? <ArrowUp className="size-3" /> : sort === `-${c.sort}` ? <ArrowDown className="size-3" /> : <ArrowDownUp className="size-3 opacity-40" />}
                    </button>
                  ) : c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {rows.map((r) => (
              <tr key={r[rowKey]} onClick={onRowClick ? (e) => { if (!(e.target as HTMLElement).closest('button,a,input,label')) onRowClick(r); } : undefined}
                className={cx('group align-top', onRowClick && 'cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50', list.selected.has(r[rowKey]) && 'bg-brand-soft')}>
                {selectable && <td className="px-3 py-2.5"><Checkbox checked={list.selected.has(r[rowKey])} onChange={() => toggle(r[rowKey])} /></td>}
                {columns.map((c) => <td key={c.key} className={cx('px-3 py-2.5', c.key === 'actions' && STICKY_END + ' bg-white group-hover:bg-zinc-50 dark:bg-zinc-900 dark:group-hover:bg-zinc-800', c.className)}>{c.render ? c.render(r) : r[c.key] ?? '—'}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {list.loading && rows.length === 0 && !list.error && (
          <div className="space-y-3 p-4" aria-busy="true">
            {[0, 1, 2, 3, 4].map((i) => <div key={i} className="flex gap-4"><div className="skeleton h-4 w-1/4" /><div className="skeleton h-4 flex-1" /><div className="skeleton h-4 w-1/6" /></div>)}
          </div>
        )}
        {empty && (
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-center text-sm text-zinc-500">
            <span className="flex size-11 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800"><EmptyIcon className="size-5 text-zinc-400" /></span>
            {empty}
            {list.hasFilters && !list.error && <Button size="sm" variant="ghost" onClick={list.clear}>{t('table.clear_filters')}</Button>}
          </div>
        )}
      </div>
      {d && d.total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 px-3 py-2.5 text-xs text-zinc-500 dark:border-zinc-800">
          <span>{t('table.showing', { first: fmtNum((d.page - 1) * d.pageSize + 1), last: fmtNum(Math.min(d.total, d.page * d.pageSize)), total: fmtNum(d.total) })}</span>
          <div className="flex items-center gap-2">
            <span>{t('table.rows_per_page')}</span>
            <select className="input w-auto py-1" value={d.pageSize} onChange={(e) => list.setMany({ pageSize: e.target.value })}>
              {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <span>{t('table.page_of', { page: d.page, totalPages: pages })}</span>
            <Button size="sm" disabled={d.page <= 1} onClick={() => list.set('page', String(d.page - 1))} icon={<Prev className="size-3.5" />}>{t('table.previous')}</Button>
            <Button size="sm" disabled={d.page >= pages} onClick={() => list.set('page', String(d.page + 1))}>{t('table.next')}<Next className="size-3.5" /></Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- filter bar ----------
// The first filters stay in view; the rest open with "More filters". A hidden filter that is in use keeps them open.
const SHOWN = 4;
export function FilterBar({ list, placeholder, children, actions }: { list: ListState; placeholder?: string; children?: ReactNode; actions?: ReactNode }) {
  const { t } = useI18n();
  const [term, setTerm] = useState(list.query.search ?? '');
  useEffect(() => setTerm(list.query.search ?? ''), [list.query.search]);
  const items = Children.toArray(children);
  const extra = items.slice(SHOWN);
  const extraOn = extra.filter((el) => isValidElement<{ name?: string }>(el) && el.props.name && list.query[el.props.name]).length;
  const [more, setMore] = useState(extraOn > 0);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-72">
        <Search className="pointer-events-none absolute start-2.5 top-2.5 size-4 text-zinc-400" />
        <input type="search" className="input ps-8" placeholder={placeholder ?? t('table.search')} value={term}
          onChange={(e) => { setTerm(e.target.value); list.set('search', e.target.value); }} />
      </div>
      {items.slice(0, SHOWN)}
      {more && extra}
      {extra.length > 0 && (
        <Button size="sm" variant="ghost" icon={<SlidersHorizontal className="size-3.5" />} onClick={() => setMore(!more)} aria-expanded={more}>
          {more ? t('table.fewer_filters') : t('table.more_filters')}
          {!more && extraOn > 0 && <span className="rounded-full bg-brand px-1.5 text-[10px] text-white num">{extraOn}</span>}
        </Button>
      )}
      {list.hasFilters && <Button variant="ghost" size="sm" className="text-red-600 dark:text-red-400" icon={<X className="size-3.5" />} onClick={list.clear}>{t('table.clear_filters')}</Button>}
      {actions && <div className="ms-auto flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

// Filters are compact chips with their name inside; a chip in use is tinted.
const chip = (on: boolean) => cx('flex h-9 items-center gap-1 rounded-lg border ps-2.5 text-xs transition focus-within:ring-2 focus-within:ring-brand/20',
  on ? 'border-brand/50 bg-brand-soft' : 'border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900');
export function FilterSelect({ list, name, label, options, allLabel }: { list: ListState; name: string; label: string; options: { value: string | number; label: ReactNode }[]; allLabel?: string }) {
  const { t } = useI18n();
  const v = list.query[name] ?? '';
  return (
    <label className={chip(!!v)}>
      <span className="whitespace-nowrap text-zinc-500">{label}:</span>
      <select className="h-full max-w-48 cursor-pointer bg-transparent pe-2 text-sm font-medium outline-none" value={v} onChange={(e) => list.set(name, e.target.value)}>
        <option value="">{allLabel ?? t('common.all')}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label as string}</option>)}
      </select>
    </label>
  );
}
export function FilterDate({ list, name, label }: { list: ListState; name: string; label: string }) {
  const v = list.query[name] ?? '';
  return (
    <label className={chip(!!v)}>
      <span className="whitespace-nowrap text-zinc-500">{label}:</span>
      <input type="date" className="h-full bg-transparent pe-2 text-sm outline-none" value={v} onChange={(e) => list.set(name, e.target.value)} />
    </label>
  );
}
export function FilterNumber({ list, name, label, min = 1, placeholder }: { list: ListState; name: string; label: string; min?: number; placeholder?: string }) {
  const v = list.query[name] ?? '';
  return (
    <label className={chip(!!v)}>
      <span className="whitespace-nowrap text-zinc-500">{label}:</span>
      <input type="number" min={min} placeholder={placeholder} className="h-full w-16 bg-transparent pe-2 text-sm outline-none" value={v} onChange={(e) => list.set(name, e.target.value)} />
    </label>
  );
}
// Toggle buttons that can be pressed together, e.g. "Expired" + "Near expiry".
export function FilterToggles({ list, name, options }: { list: ListState; name: string; options: { value: string; label: ReactNode; tone?: string }[] }) {
  const on = new Set((list.query[name] ?? '').split(',').filter(Boolean));
  const flip = (v: string) => { const n = new Set(on); n.has(v) ? n.delete(v) : n.add(v); list.set(name, [...n].join(',')); };
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button key={o.value} onClick={() => flip(o.value)}
          className={cx('h-9 rounded-lg px-3 text-xs font-medium ring-1 ring-inset transition',
            on.has(o.value) ? (o.tone ?? 'bg-brand text-white ring-brand') : 'bg-white text-zinc-600 ring-zinc-300 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-700')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
