import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowDownUp, ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
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
  if (list.error?.status === 403) empty = t('table.no_permission');
  else if (list.error?.status === 401) empty = t('table.session_ended');
  else if (list.error) empty = t('err.server_error');
  else if (!list.loading && rows.length === 0) empty = emptyText ?? (list.hasFilters ? t('table.no_match') : t('table.no_records'));

  return (
    <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      {selectable && list.selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-brand/20 bg-brand-soft px-3 py-2 text-sm">
          <span className="font-medium">{t('table.selected', { n: list.selected.size })}</span>
          <div className="flex flex-wrap gap-2">{bulk}</div>
          <Button size="sm" variant="ghost" className="ms-auto" onClick={() => list.setSelected(new Set())}>{t('table.clear_selection')}</Button>
        </div>
      )}
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60">
            <tr>
              {selectable && (
                <th className="w-10 px-3 py-2.5"><Checkbox checked={allOn} onChange={(v) => list.setSelected(v ? new Set(ids) : new Set())} /></th>
              )}
              {columns.map((c) => (
                <th key={c.key} className={cx('px-3 py-2.5 text-start font-medium whitespace-nowrap', c.className)} title={c.title}>
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
                className={cx('align-top', onRowClick && 'cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50', list.selected.has(r[rowKey]) && 'bg-brand-soft')}>
                {selectable && <td className="px-3 py-2.5"><Checkbox checked={list.selected.has(r[rowKey])} onChange={() => toggle(r[rowKey])} /></td>}
                {columns.map((c) => <td key={c.key} className={cx('px-3 py-2.5', c.className)}>{c.render ? c.render(r) : r[c.key] ?? '—'}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {list.loading && rows.length === 0 && <div className="flex justify-center py-10"><Spinner /></div>}
        {empty && <div className="px-4 py-10 text-center text-sm text-zinc-500">{empty}</div>}
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
export function FilterBar({ list, placeholder, children, actions }: { list: ListState; placeholder?: string; children?: ReactNode; actions?: ReactNode }) {
  const { t } = useI18n();
  const [term, setTerm] = useState(list.query.search ?? '');
  useEffect(() => setTerm(list.query.search ?? ''), [list.query.search]);
  return (
    <div className="mb-3 flex flex-wrap items-end gap-2">
      <div className="relative min-w-56 flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute start-2.5 top-2.5 size-4 text-zinc-400" />
        <input className="input ps-8" placeholder={placeholder ?? t('table.search')} value={term}
          onChange={(e) => { setTerm(e.target.value); list.set('search', e.target.value); }} />
      </div>
      {children}
      {list.hasFilters && <Button variant="ghost" size="sm" icon={<X className="size-3.5" />} onClick={list.clear}>{t('table.clear_filters')}</Button>}
      {actions && <div className="ms-auto flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function FilterSelect({ list, name, label, options, allLabel }: { list: ListState; name: string; label: string; options: { value: string | number; label: ReactNode }[]; allLabel?: string }) {
  const { t } = useI18n();
  return (
    <label className="text-xs">
      <span className="mb-1 block text-zinc-500">{label}</span>
      <select className="input w-auto min-w-32 py-2" value={list.query[name] ?? ''} onChange={(e) => list.set(name, e.target.value)}>
        <option value="">{allLabel ?? t('common.all')}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label as string}</option>)}
      </select>
    </label>
  );
}
export function FilterDate({ list, name, label }: { list: ListState; name: string; label: string }) {
  return (
    <label className="text-xs">
      <span className="mb-1 block text-zinc-500">{label}</span>
      <input type="date" className="input w-auto py-1.5" value={list.query[name] ?? ''} onChange={(e) => list.set(name, e.target.value)} />
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
          className={cx('rounded-lg px-2.5 py-1.5 text-xs font-medium ring-1 ring-inset transition',
            on.has(o.value) ? (o.tone ?? 'bg-brand text-white ring-brand') : 'bg-white text-zinc-600 ring-zinc-300 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-700')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
