import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FileUp, Pencil, Trash2, X } from 'lucide-react';
import { del, get, patch } from '../../api';
import { useAuth } from '../../auth';
import { fmtNum, useI18n } from '../../i18n';
import { Badge, Button, Card, cx, Field, IconButton, PageHeader, SidePanel, StatCard, StatGrid, Tabs, useAction, useUi, type Tone } from '../../ui/kit';
import { DataTable, FilterBar, FilterDate, FilterSelect, useList, type Column, type ListState } from '../../ui/table';
import { ImportWizard } from '../../ui/importer';
import { ExportButton, latin, useOptions } from '../../ui/common';
import { Bars, Columns, Line } from '../../ui/charts';

// Amounts: two decimals, Latin digits, "SAR"; negative in red with its sign; nothing is a short dash.
export const money = (n: unknown) => (n === null || n === undefined || n === '' ? '—' : `${fmtNum(Number(n), 2)} SAR`);
export function Money({ v, faded, bold }: { v: unknown; faded?: boolean; bold?: boolean }) {
  const n = v === null || v === undefined || v === '' ? null : Number(v);
  return <span className={cx('num whitespace-nowrap', n !== null && n < 0 && 'text-red-600 dark:text-red-400', faded && n === 0 && 'text-zinc-300 dark:text-zinc-600', bold && 'font-semibold')}>{n === null ? '—' : fmtNum(n, 2)}</span>;
}
const FINE_TONE: Record<string, Tone> = { open: 'amber', disputed: 'blue', waived: 'green', deducted: 'red' };

// "This month", "Last month", "Last 3 months", "This year", "All dates"
function QuickRange({ list }: { list: ListState }) {
  const { t } = useI18n();
  const d = new Date();
  const iso = (x: Date) => new Intl.DateTimeFormat('en-CA').format(x);
  const ranges: [string, string | null, string | null][] = [
    ['fin.r.this_month', iso(new Date(d.getFullYear(), d.getMonth(), 1)), null],
    ['fin.r.last_month', iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)), iso(new Date(d.getFullYear(), d.getMonth(), 0))],
    ['fin.r.last_3', iso(new Date(d.getFullYear(), d.getMonth() - 2, 1)), null],
    ['fin.r.this_year', iso(new Date(d.getFullYear(), 0, 1)), null],
    ['fin.r.all', null, null],
  ];
  return (
    <div className="flex flex-wrap gap-1">
      {ranges.map(([k, from, to]) => (
        <button key={k} onClick={() => list.setMany({ from, to })} className={cx('h-9 rounded-lg px-2.5 text-xs font-medium ring-1 ring-inset',
          (list.query.from ?? null) === from && (list.query.to ?? null) === to ? 'bg-brand text-white ring-brand' : 'bg-white text-zinc-600 ring-zinc-300 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-700')}>{t(k)}</button>
      ))}
    </div>
  );
}
function FinanceImport({ base, back, title, open, onClose, onDone }: { base: string; back: string; title: string; open?: boolean; onClose?: () => void; onDone?: () => void }) {
  const { t } = useI18n();
  const body = <ImportWizard base={base} back={back} options={[{ name: 'create_riders', label: t('fin.create_riders'), hint: t('fin.create_riders_hint') }]}
    extraLabels={{ unknown_riders: t('fin.unknown_riders') }} intro={<p className="text-sm text-zinc-500">{t('fin.import_intro')}</p>} onFinished={onDone} />;
  if (onClose) return <SidePanel open={!!open} onClose={onClose} title={title}>{body}</SidePanel>;
  return <><PageHeader title={title} back={back} actions={<Link to={back}><Button variant="ghost">{t('fin.back_to_list')}</Button></Link>} />{body}</>;
}

// ======================================================================== 8.1 fines
export function FinesList() {
  const { t } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const { confirm } = useUi();
  const list = useList('/finance/fines');
  const categories = useOptions<string>('/finance/fines/categories');
  const [edit, setEdit] = useState<any>(null);
  const [v, setV] = useState({ status: 'open', amount: '', internal_note: '' });
  const s = list.stats ?? {};
  const charts = list.data?.charts ?? { months: [], categories: [] };
  const remove = async (r: any) => {
    if (!(await confirm({ title: t('fin.delete_q'), confirm: t('common.delete') }))) return;
    if (await run(() => del(`/finance/fines/${r.id}`), t('fin.deleted'))) list.reload();
  };
  const columns: Column<any>[] = [
    { key: 'date', header: t('fin.date'), sort: 'date', render: (r) => <span className="num">{r.fine_date}</span> },
    { key: 'rider', header: t('fin.rider'), sort: 'rider', render: (r) => <div><Link to={`/admin/riders/${r.rider_id}`} className="font-medium hover:text-brand">{r.full_name}</Link><div className="text-xs text-zinc-500">{r.company ?? <span className="num">#{r.rider_id}</span>}</div></div> },
    { key: 'category', header: t('fin.category'), sort: 'category', render: (r) => <span className="line-clamp-2 max-w-64" title={r.category}>{r.category}</span> },
    { key: 'invoice', header: t('fin.invoice'), render: (r) => <span className="num">{r.invoice_no || '—'}</span> },
    { key: 'amount', header: t('fin.amount'), sort: 'amount', render: (r) => <Money v={r.amount} bold /> },
    { key: 'status', header: t('fin.status'), sort: 'status', render: (r) => <Badge tone={FINE_TONE[r.status]}>{t(`fin.st.${r.status}`)}</Badge> },
    ...(can('finance.manage') ? [{ key: 'actions', header: t('common.actions'), render: (r: any) => <div className="flex">
      <IconButton title={t('fin.change_status')} onClick={() => { setEdit(r); setV({ status: r.status, amount: String(r.amount), internal_note: r.internal_note ?? '' }); }}><Pencil /></IconButton>
      <IconButton title={t('common.delete')} tone="red" onClick={() => remove(r)}><Trash2 /></IconButton></div> }] : []),
  ];
  return (
    <>
      <PageHeader title={t('fin.fines_title')} actions={<>
        <ExportButton path="/finance/fines/export" query={list.query} />
        {can('finance.import') && <Link to="/admin/finance/fines/import"><Button icon={<FileUp className="size-4" />}>{t('fin.import_fines')}</Button></Link>}
      </>} />
      <StatGrid>
        <StatCard label={t('fin.c.total')} value={money(s.total)} tone={s.total > 0 ? 'red' : 'none'} />
        <StatCard label={t('fin.c.count')} value={fmtNum(s.n)} />
        <StatCard label={t('fin.c.month')} value={money(s.month)} tone="amber" />
        <StatCard label={t('fin.c.top')} value={s.top ? s.top.full_name : t('fin.no_fines_range')} sub={s.top && money(s.top.total)} />
      </StatGrid>
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card title={t('fin.by_month')}><Columns data={charts.months.map((m: any) => ({ label: m.m, value: Number(m.total), tone: 'red' }))} empty={t('fin.no_match')} /></Card>
        <Card title={t('fin.top_categories')}><Bars data={charts.categories.map((c: any, i: number) => ({ label: c.category, value: Number(c.total), tone: ['red', 'amber', 'blue', 'brand', 'green', 'grey'][i] }))} format={money} empty={t('fin.no_match')} /></Card>
      </div>
      <FilterBar list={list} placeholder={t('fin.fines_search')} actions={<ExportButton path="/finance/fines/export" query={list.query} format="csv" label={t('common.export_csv')} />}>
        <FilterSelect list={list} name="status" label={t('fin.status')} options={Object.keys(FINE_TONE).map((k) => ({ value: k, label: t(`fin.st.${k}`) }))} />
        <FilterSelect list={list} name="category" label={t('fin.category')} options={categories.map((c) => ({ value: c, label: c }))} />
        <FilterDate list={list} name="from" label={t('common.from')} />
        <FilterDate list={list} name="to" label={t('common.to')} />
        <QuickRange list={list} />
        <AmountFilter list={list} name="amount_min" label={t('fin.amount_from')} />
        <AmountFilter list={list} name="amount_max" label={t('fin.amount_to')} />
      </FilterBar>
      <DataTable list={list} columns={columns} />
      <SidePanel open={!!edit} onClose={() => setEdit(null)} title={t('fin.fine_details')} footer={<>
        <Button onClick={() => setEdit(null)}>{t('common.cancel')}</Button>
        <Button variant="primary" onClick={async () => { if (await run(() => patch(`/finance/fines/${edit.id}`, { ...v, amount: latin(v.amount) }), t('fin.updated'))) { setEdit(null); list.reload(); } }}>{t('common.save')}</Button></>}>
        {edit && <div className="space-y-4 text-sm">
          <div><div className="text-xs text-zinc-500">{t('fin.rider')}</div><div className="font-medium">{edit.full_name}</div><div className="text-xs text-zinc-500"><span className="num">{edit.fine_date}</span> · {edit.category}</div></div>
          <Field label={t('fin.status')} required><select className="input" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}>{Object.keys(FINE_TONE).map((k) => <option key={k} value={k}>{t(`fin.st.${k}`)}</option>)}</select></Field>
          <Field label={t('fin.amount_sar')} hint={t('fin.amount_hint')}><input className="input" dir="ltr" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></Field>
          <Field label={t('fin.internal_note')} hint={t('fin.note_hint')}><textarea className="input" rows={4} maxLength={500} value={v.internal_note} onChange={(e) => setV({ ...v, internal_note: e.target.value })} /></Field>
        </div>}
      </SidePanel>
    </>
  );
}
function AmountFilter({ list, name, label }: { list: ListState; name: string; label: string }) {
  const [v, setV] = useState(list.query[name] ?? '');
  useEffect(() => setV(list.query[name] ?? ''), [list.query[name]]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label className={cx('flex h-9 items-center gap-1 rounded-lg border ps-2.5 text-xs', v ? 'border-brand/50 bg-brand-soft' : 'border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900')}>
      <span className="whitespace-nowrap text-zinc-500">{label}:</span>
      <input className="h-full w-20 bg-transparent pe-2 text-sm outline-none" dir="ltr" value={v} onChange={(e) => { setV(e.target.value); list.set(name, latin(e.target.value)); }} />
    </label>
  );
}
export function FinesImport() {
  const { t } = useI18n();
  return <FinanceImport base="/finance/fines/import" back="/admin/finance/fines" title={t('fin.import_fines')} />;
}

// ======================================================================== 8.2 wallet
export function Wallet() {
  const { t } = useI18n();
  const { can } = useAuth();
  const [tab, setTab] = useState<'balances' | 'entries'>('balances');
  const [rider, setRider] = useState<{ id: number; name: string } | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [importing, setImporting] = useState(false);
  const [stats, setStats] = useState<any>({});
  const list = useList(tab === 'balances' ? '/finance/wallet/balances' : '/finance/wallet/entries');
  const loadStats = () => get('/finance/wallet/balances', { pageSize: 10 }).then((d) => setStats(d.stats)).catch(() => {});
  useEffect(() => { loadStats(); }, []);
  useEffect(() => { if (rider) get(`/finance/wallet/history/${rider.id}`).then(setHistory).catch(() => setHistory([])); else setHistory([]); }, [rider]);
  // the entries tab opens on the last three months, narrowed to the selected rider
  const switchTab = (k: 'balances' | 'entries') => {
    setTab(k);
    list.clear();
    if (k === 'entries') { const d = new Date(); list.setMany({ from: new Intl.DateTimeFormat('en-CA').format(new Date(d.getFullYear(), d.getMonth() - 2, 1)), rider: rider ? String(rider.id) : null }); }
  };
  const balCols: Column<any>[] = [
    { key: 'rider', header: t('fin.rider'), sort: 'rider', render: (r) => <div><div className="font-medium">{r.full_name}</div><div className="text-xs text-zinc-500 num">#{r.rider_id}</div></div> },
    { key: 'balance', header: t('fin.current_balance'), sort: 'balance', render: (r) => <Money v={r.balance} bold /> },
    { key: 'date', header: t('fin.as_of'), sort: 'date', render: (r) => <span className="num">{r.snapshot_date}</span> },
  ];
  const entCols: Column<any>[] = [
    { key: 'date', header: t('fin.date'), sort: 'date', render: (r) => <span className="num">{r.entry_date}</span> },
    { key: 'rider', header: t('fin.rider'), sort: 'rider', render: (r) => r.full_name },
    { key: 'note', header: t('fin.entry_note'), render: (r) => <span className="line-clamp-2 max-w-80" title={r.description}>{r.description || '—'}</span> },
    { key: 'amount', header: t('fin.amount'), sort: 'amount', render: (r) => <span className={cx('num font-medium', r.amount < 0 ? 'text-red-600' : 'text-emerald-700 dark:text-emerald-400')}>{r.amount > 0 ? '+' : ''}{fmtNum(r.amount, 2)}</span> },
  ];
  const reload = () => { list.reload(); loadStats(); };
  return (
    <>
      <PageHeader title={t('fin.wallet_title')} actions={<>
        <ExportButton path="/finance/wallet/export" query={{ ...list.query, tab }} />
        {can('finance.import') && <Button icon={<FileUp className="size-4" />} onClick={() => setImporting(true)}>{t('fin.import_wallet')}</Button>}
      </>} />
      <StatGrid>
        <StatCard label={t('fin.c.with_balance')} value={fmtNum(stats.riders)} sub={stats.latest && <span>{t('fin.as_of_x')} <span className="num">{stats.latest}</span></span>} />
        <StatCard label={t('fin.c.net')} value={money(stats.net)} tone={stats.net < 0 ? 'red' : 'green'} />
        <StatCard label={t('fin.c.negative')} value={fmtNum(stats.negative)} tone={stats.negative ? 'red' : 'none'} />
        <StatCard label={t('fin.c.owed')} value={money(stats.owed)} tone={stats.owed < 0 ? 'red' : 'none'} />
      </StatGrid>
      <Tabs value={tab} onChange={(k) => switchTab(k as any)} tabs={[{ key: 'balances', label: t('fin.tab_balances') }, { key: 'entries', label: t('fin.tab_entries') }]} />
      {tab === 'balances' && (
        <Card title={t('fin.balance_over_time')} className="mb-4" actions={rider && <span className="flex items-center gap-1 text-xs">{t('fin.showing')} <b>{rider.name}</b>
          <IconButton title={t('common.clear')} onClick={() => setRider(null)}><X /></IconButton></span>}>
          {rider ? <Line data={history.map((h) => ({ label: h.snapshot_date, value: Number(h.balance) }))} format={money} /> : <p className="py-8 text-center text-sm text-zinc-500">{t('fin.pick_rider')}</p>}
        </Card>
      )}
      <FilterBar list={list} placeholder={tab === 'balances' ? t('fin.balance_search') : t('fin.entry_search')} actions={<ExportButton path="/finance/wallet/export" query={{ ...list.query, tab }} format="csv" label={t('common.export_csv')} />}>
        {tab === 'entries' && rider && list.query.rider && <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={() => list.set('rider', null)}>{rider.name}</Button>}
        {tab === 'entries' && <FilterDate list={list} name="from" label={t('common.from')} />}
        {tab === 'entries' && <FilterDate list={list} name="to" label={t('common.to')} />}
        {tab === 'entries' && <QuickRange list={list} />}
      </FilterBar>
      {tab === 'balances'
        ? <DataTable list={list} columns={balCols} rowKey="rider_id" onRowClick={(r) => { setRider({ id: r.rider_id, name: r.full_name }); list.setSelected(new Set([r.rider_id])); }} emptyText={t('fin.no_balances')} />
        : <DataTable list={list} columns={entCols} />}
      <FinanceImport base="/finance/wallet/import" back="/admin/finance/wallet" title={t('fin.import_wallet')} open={importing} onClose={() => setImporting(false)} onDone={reload} />
    </>
  );
}

// ======================================================================== 8.3 monthly billing
const GROUPS: Record<string, string[]> = {
  payments: ['completed_orders', 'basic_payment', 'distance_payment', 'ftr_bonus', 'rider_payment_basic', 'rider_payment_scoring'],
  fines: ['fine_acceptance', 'fine_contact', 'fine_declined', 'fine_late', 'fine_no_show', 'fine_no_show_special', 'fine_daily_acceptance', 'fine_missed_days'],
  deductions: ['ded_stacking', 'ded_car', 'ded_google', 'total_deductions'],
  total: ['rider_balance', 'pending_balance', 'amount_excl_vat', 'vat', 'amount_incl_vat', 'net_ftr'],
};
const BOLD = new Set(['total_deductions', 'net_ftr']);
const cell = (k: string, v: unknown, total = false): ReactNode => (k === 'completed_orders' ? <span className={cx('num', total && 'font-semibold')}>{v == null ? '—' : fmtNum(Number(v))}</span> : <Money v={v} faded bold={BOLD.has(k) || total} />);

export function Billing() {
  const { t } = useI18n();
  const { can } = useAuth();
  const list = useList('/finance/billing');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<any>(null);
  const [importing, setImporting] = useState(false);
  const d = list.data;
  const s = list.stats ?? {};
  const month = d?.month ?? '';
  const groups = Object.entries(GROUPS).filter(([g]) => !hidden.has(g));
  const pages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;
  return (
    <>
      <PageHeader title={t('fin.billing_title')} subtitle={month && <Badge tone="blue"><span className="num">{month}</span></Badge>} actions={<>
        <ExportButton path="/finance/billing/export" query={{ ...list.query, month }} />
        {can('finance.import') && <Button icon={<FileUp className="size-4" />} onClick={() => setImporting(true)}>{t('fin.import_billing')}</Button>}
      </>} />
      <StatGrid>
        <StatCard label={t('fin.c.billed')} value={fmtNum(s.riders)} sub={t('fin.orders_x', { n: fmtNum(s.orders) })} />
        <StatCard label={t('fin.c.payments')} value={money(s.payments)} tone="green" />
        <StatCard label={t('fin.c.fines')} value={money(s.fines)} tone={s.fines ? 'red' : 'none'} />
        <StatCard label={t('fin.c.deductions')} value={money(s.deductions)} tone={s.deductions ? 'amber' : 'none'} />
        <StatCard label={t('fin.c.net_payable')} value={money(s.net)} tone="blue" />
      </StatGrid>
      <FilterBar list={list} placeholder={t('fin.balance_search')} actions={<ExportButton path="/finance/billing/export" query={{ ...list.query, month }} format="csv" label={t('common.export_csv')} />}>
        <label className="flex h-9 items-center gap-1 rounded-lg border border-zinc-300 bg-white ps-2.5 text-xs dark:border-zinc-700 dark:bg-zinc-900">
          <span className="text-zinc-500">{t('fin.billing_month')}:</span>
          <input type="month" className="h-full bg-transparent pe-2 text-sm outline-none" value={month} onChange={(e) => list.set('month', e.target.value)} />
        </label>
        <div className="flex gap-1">{Object.keys(GROUPS).map((g) => (
          <button key={g} onClick={() => { const n = new Set(hidden); n.has(g) ? n.delete(g) : n.add(g); setHidden(n); }}
            className={cx('h-9 rounded-lg px-2.5 text-xs font-medium ring-1 ring-inset', hidden.has(g) ? 'bg-white text-zinc-400 line-through ring-zinc-300 dark:bg-zinc-900 dark:ring-zinc-700' : 'bg-brand-soft text-brand ring-brand/40')}>{t(`fin.g.${g}`)}</button>
        ))}</div>
      </FilterBar>
      <div className="rounded-xl border border-zinc-200/80 bg-white shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
        {d && !d.rows.length ? (
          <div className="px-4 py-12 text-center text-sm text-zinc-500"><div className="font-medium">{t('fin.no_billing')}</div><div className="mt-1 text-xs">{t('fin.billing_by_import')}</div></div>
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-zinc-50/80 text-zinc-500 dark:bg-zinc-800/30">
                <tr>
                  <th rowSpan={2} className="sticky start-0 z-10 min-w-48 border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-start font-medium dark:border-zinc-800 dark:bg-zinc-900">{t('fin.rider')}</th>
                  {groups.map(([g, cols]) => <th key={g} colSpan={cols.length} className="border-b border-s border-zinc-200 px-3 py-1.5 text-center font-semibold dark:border-zinc-800">{t(`fin.g.${g}`)}</th>)}
                </tr>
                <tr>{groups.flatMap(([, cols]) => cols.map((c, i) => <th key={c} className={cx('whitespace-nowrap border-b border-zinc-200 px-3 py-1.5 text-end font-medium dark:border-zinc-800', i === 0 && 'border-s')}>{t(`fin.b.${c}`)}</th>))}</tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {d?.rows.map((r: any) => (
                  <tr key={r.id} className="group cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50" onClick={() => setOpen(r)}>
                    <td className="sticky start-0 bg-white px-3 py-2 group-hover:bg-zinc-50 dark:bg-zinc-900 dark:group-hover:bg-zinc-800"><div className="text-sm font-medium">{r.full_name}</div><div className="text-zinc-500">{r.contract ?? <span className="num">#{r.rider_id}</span>}</div></td>
                    {groups.flatMap(([, cols]) => cols.map((c, i) => <td key={c} className={cx('px-3 py-2 text-end', i === 0 && 'border-s border-zinc-100 dark:border-zinc-800')}>{cell(c, r[c])}</td>))}
                  </tr>
                ))}
                {d && d.rows.length > 0 && (
                  <tr className="bg-zinc-50 font-semibold dark:bg-zinc-800/50">
                    <td className="sticky start-0 bg-zinc-50 px-3 py-2 dark:bg-zinc-800">{t('fin.month_total')}</td>
                    {groups.flatMap(([, cols]) => cols.map((c, i) => <td key={c} className={cx('px-3 py-2 text-end', i === 0 && 'border-s border-zinc-200 dark:border-zinc-700')}>{cell(c, d.totals[c], true)}</td>))}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {d && d.total > d.pageSize && <div className="flex items-center justify-end gap-2 border-t border-zinc-100 p-2 text-xs dark:border-zinc-800">
          <Button size="sm" disabled={d.page <= 1} onClick={() => list.set('page', String(d.page - 1))}>{t('table.previous')}</Button>
          <span>{t('table.page_of', { page: d.page, totalPages: pages })}</span>
          <Button size="sm" disabled={d.page >= pages} onClick={() => list.set('page', String(d.page + 1))}>{t('table.next')}</Button>
        </div>}
      </div>
      <SidePanel open={!!open} onClose={() => setOpen(null)} title={open && t('fin.billing_for', { name: open.full_name })}>
        {open && <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3"><div><div className="text-xs text-zinc-500">{t('fin.month')}</div><div className="num">{open.month}</div></div><div><div className="text-xs text-zinc-500">{t('fin.contract')}</div><div>{open.contract ?? '—'}</div></div></div>
          {Object.entries(GROUPS).map(([g, cols]) => (
            <section key={g}><h4 className="mb-1 font-semibold">{t(`fin.g.${g}`)}</h4>
              <dl className="divide-y divide-zinc-100 dark:divide-zinc-800">{cols.map((c) => <div key={c} className="flex justify-between py-1.5"><dt className="text-zinc-500">{t(`fin.b.${c}`)}</dt><dd>{cell(c, open[c])}{c !== 'completed_orders' && open[c] != null && <span className="ms-1 text-xs text-zinc-500">SAR</span>}</dd></div>)}</dl>
            </section>
          ))}
        </div>}
      </SidePanel>
      <FinanceImport base="/finance/billing/import" back="/admin/finance/billing" title={t('fin.import_billing')} open={importing} onClose={() => setImporting(false)} onDone={() => list.reload()} />
    </>
  );
}

// ======================================================================== 8.5 the rider file card
export function FinancialSummary({ riderId }: { riderId: number | string }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const [f, setF] = useState<any>(null);
  useEffect(() => { if (can('finance.view')) get(`/finance/rider/${riderId}`).then(setF).catch(() => {}); }, [riderId, can]);
  if (!can('finance.view') || !f) return null;
  return (
    <Card title={t('fin.summary')} actions={<>
      <Link to="/admin/finance/fines"><Button size="sm" variant="ghost">{t('fin.nav_fines')}</Button></Link>
      <Link to="/admin/finance/wallet"><Button size="sm" variant="ghost">{t('fin.nav_wallet')}</Button></Link>
      <Link to="/admin/finance/billing"><Button size="sm" variant="ghost">{t('fin.nav_billing')}</Button></Link>
    </>}>
      {f.empty ? <p className="text-sm text-zinc-500">{t('fin.no_records')}</p> : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label={t('fin.s.wallet')} value={f.wallet ? money(f.wallet.balance) : '—'} tone={f.wallet?.balance < 0 ? 'red' : 'none'}
            sub={f.wallet && (f.wallet.entries ? t('fin.entries_30', { n: f.wallet.entries }) : <span className="num">{f.wallet.snapshot_date}</span>)} />
          <StatCard label={t('fin.s.fines')} value={money(f.fines.total)} tone={f.fines.total > 0 ? 'red' : 'none'} sub={t('fin.n_fines', { n: f.fines.n })} />
          <StatCard label={t('fin.s.last_bill')} value={f.billing ? money(f.billing.amount_incl_vat) : '—'} sub={f.billing && <span>{t('fin.net_for')} <span className="num">{f.billing.month}</span></span>} />
          <StatCard label={t('fin.s.advance')} value={money(f.advance.remaining)} tone={f.advance.remaining > 0 ? 'amber' : 'none'}
            sub={f.advance.next && <span>{t('fin.next_inst')} {money(f.advance.next.amount)}</span>} />
        </div>
      )}
    </Card>
  );
}
