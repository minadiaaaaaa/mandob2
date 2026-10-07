import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Bell, CarFront, Check, ChevronLeft, ChevronRight, Eye, FileClock, HandCoins, RefreshCw, Settings2, Trash2, Users, ExternalLink } from 'lucide-react';
import { del, get, post, put } from '../../api';
import { useAuth } from '../../auth';
import { fmtDateTime, fmtNum, useI18n } from '../../i18n';
import { Alert, Badge, Button, Card, Checkbox, cx, Details, IconButton, Loading, PageHeader, SidePanel, StatCard, StatGrid, useAction, useUi, type Tone } from '../../ui/kit';
import { DataTable, FilterBar, FilterDate, FilterSelect, useList, type Column } from '../../ui/table';
import { ExportButton, useCityName, useOptions } from '../../ui/common';
import { useNoteText } from '../../ui/notes';

// ======================================================================== 9.2 reports
const REPORTS = [['vehicles', CarFront], ['riders', Users], ['documents', FileClock], ['advances', HandCoins]] as const;

export function ReportsIndex() {
  const { t, dir } = useI18n();
  const Chevron = dir === 'rtl' ? ChevronLeft : ChevronRight;
  return (
    <>
      <PageHeader title={t('rep.title')} subtitle={t('rep.subtitle')} />
      <Card title={t('rep.available')}>
        <div className="grid gap-3 sm:grid-cols-2">
          {REPORTS.map(([k, Icon]) => (
            <Link key={k} to={`/admin/reports/${k}`} className="group flex items-center gap-3 rounded-xl border border-zinc-200 p-4 transition hover:border-brand hover:bg-brand-soft dark:border-zinc-800">
              <span className="flex size-11 items-center justify-center rounded-lg bg-brand-soft text-brand"><Icon className="size-5" /></span>
              <div className="min-w-0 flex-1"><div className="font-semibold">{t(`rep.${k}.title`)}</div><div className="text-xs text-zinc-500">{t(`rep.${k}.desc`)}</div></div>
              <Chevron className="size-4 text-zinc-400 group-hover:text-brand" />
            </Link>
          ))}
        </div>
      </Card>
    </>
  );
}

export function ReportView() {
  const { name = '' } = useParams();
  const { t } = useI18n();
  const { can } = useAuth();
  const city = useCityName();
  const [params, setParams] = useSearchParams();
  const query = Object.fromEntries(params);
  const [d, setD] = useState<any>(null);
  const [term, setTerm] = useState(query.search ?? '');
  const cities = useOptions<any>(name === 'riders' ? '/lookups/cities' : null);
  const load = () => { setD(null); get(`/reports/${name}`, query).then(setD).catch(() => setD({ rows: [], stats: {}, error: true })); };
  useEffect(load, [name, params.toString()]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: string, v: string | null) => { const n = new URLSearchParams(params); v ? n.set(k, v) : n.delete(k); setParams(n, { replace: true }); };
  const sel = (k: string, label: string, opts: { value: string; label: string }[]) => (
    <label className="flex h-9 items-center gap-1 rounded-lg border border-zinc-300 bg-white ps-2.5 text-xs dark:border-zinc-700 dark:bg-zinc-900">
      <span className="text-zinc-500">{label}:</span>
      <select className="h-full bg-transparent pe-2 text-sm outline-none" value={query[k] ?? ''} onChange={(e) => set(k, e.target.value || null)}>
        <option value="">{t('common.all')}</option>{opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
  const date = (k: string, label: string) => (
    <label className="flex h-9 items-center gap-1 rounded-lg border border-zinc-300 bg-white ps-2.5 text-xs dark:border-zinc-700 dark:bg-zinc-900">
      <span className="text-zinc-500">{label}:</span><input type="date" className="h-full bg-transparent pe-2 text-sm outline-none" value={query[k] ?? ''} onChange={(e) => set(k, e.target.value || null)} />
    </label>
  );
  const tone = (s: string): Tone => (s === 'expired' ? 'red' : s === 'near' ? 'amber' : 'green');
  const COLS: Record<string, [string, (r: any) => React.ReactNode][]> = {
    vehicles: [[t('vehicles.plate'), (r) => <span className="font-medium">{r.plate}</span>], [t('vehicles.maker'), (r) => r.maker], [t('vehicles.model'), (r) => r.model], [t('vehicles.color'), (r) => r.color],
      [t('vehicles.year'), (r) => <span className="num">{r.year ?? '—'}</span>], [t('vehicles.registration_type'), (r) => r.registration_type], [t('vehicles.ownership'), (r) => t(`vehicle.own.${r.ownership}`)],
      [t('vehicle.status'), (r) => t(`vehicle.status.${r.status}`)], [t('vehicles.card'), (r) => <span className="num">{r.card ?? '—'}</span>],
      [t('vehicles.card_expiry'), (r) => <span className={cx('num', r.card_days < 0 && 'text-red-600')}>{r.card_expiry ?? '—'}</span>],
      [t('rep.v.insurance_expiry'), (r) => <span className={cx('num', r.ins_days < 0 && 'text-red-600')}>{r.insurance_expiry ?? '—'}</span>]],
    riders: [[t('rep.r.rider'), (r) => <div><Link className="font-medium hover:text-brand" to={`/admin/riders/${r.id}`}>{r.full_name}</Link><div className="text-xs text-zinc-500 num">#{r.id}</div></div>],
      [t('rep.r.known_as'), (r) => r.alias], [t('riders.national_id'), (r) => <span className="num">{r.national_id ?? '—'}</span>], [t('riders.nationality'), (r) => r.nationality],
      [t('riders.occupation'), (r) => r.occupation], [t('riders.phone'), (r) => <span className="num">{r.phone ?? '—'}</span>], [t('riders.city'), (r) => (r.city_ar ? city(r) : '—')],
      [t('riders.status'), (r) => t(`rider.status.${r.status}`)], [t('rep.r.hired'), (r) => <span className="num">{r.hire_date ?? '—'}</span>]],
    documents: [[t('alerts.document'), (r) => t(`alerts.kind.${r.kind}`)], [t('alerts.belongs_to'), (r) => r.owner], [t('alerts.number'), (r) => <span className="num">{r.number ?? '—'}</span>],
      [t('alerts.issued'), (r) => <span className="num">{r.issue_date ?? '—'}</span>], [t('alerts.expires'), (r) => <span className="num">{r.expiry_date}</span>],
      [t('alerts.days_left'), (r) => <Badge tone={tone(r.state)}><span className="num">{fmtNum(r.days_left)}</span></Badge>], [t('alerts.status'), (r) => <Badge tone={tone(r.state)}>{t(`alerts.state.${r.state}`)}</Badge>]],
    advances: [[t('rep.a.number'), (r) => <span className="num font-medium">{r.number}</span>], [t('adv.rider'), (r) => r.full_name], [t('adv.amount'), (r) => <span className="num">{fmtNum(r.amount, 2)}</span>],
      [t('rep.a.paid'), (r) => <span className="num">{fmtNum(r.paid, 2)}</span>], [t('rep.a.remaining'), (r) => <span className="num">{fmtNum(r.remaining, 2)}</span>],
      [t('adv.installments'), (r) => <span className="num">{r.installments}</span>], [t('adv.overdue'), (r) => <span className={cx('num', r.overdue > 0 && 'font-semibold text-red-600')}>{r.overdue}</span>],
      [t('adv.next_due'), (r) => <span className="num">{r.next_due ?? '—'}</span>], [t('adv.status'), (r) => t(`adv.s.${r.status}`)], [t('rep.a.requested'), (r) => <span className="num">{r.request_date}</span>]],
  };
  const cols = COLS[name];
  if (!cols) return <Alert tone="amber">{t('err.not_found')}</Alert>;
  const s = d?.stats ?? {};
  return (
    <>
      <PageHeader title={t(`rep.${name}.title`)} subtitle={t(`rep.${name}.desc`)} back="/admin/reports" actions={<>
        <Link to="/admin/reports"><Button variant="ghost">{t('rep.all')}</Button></Link>
        <Button icon={<RefreshCw className="size-4" />} onClick={load}>{t('common.refresh')}</Button>
        {can('reports.export') && <span title={t('rep.export_hint')}><ExportButton path={`/reports/${name}/export`} query={query} label={t('rep.export')} /></span>}
      </>} />
      <StatGrid>{Object.entries(s).map(([k, v]) => <StatCard key={k} label={t(k)} value={typeof v === 'string' ? `${fmtNum(Number(v), 2)} SAR` : fmtNum(v as number)} />)}</StatGrid>
      <Card title={t('rep.search')} className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <input type="search" className="input w-72" placeholder={t('rep.type_enter')} value={term} onChange={(e) => setTerm(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') set('search', term || null); }} />
          {name === 'vehicles' && <>{sel('status', t('vehicle.status'), ['active', 'maintenance', 'retired'].map((v) => ({ value: v, label: t(`vehicle.status.${v}`) })))}
            {sel('ownership', t('vehicles.ownership'), ['owned', 'rented'].map((v) => ({ value: v, label: t(`vehicle.own.${v}`) })))}
            {sel('maker', t('vehicles.maker'), (d?.facets?.makers ?? []).map((m: string) => ({ value: m, label: m })))}</>}
          {name === 'riders' && <>{sel('status', t('riders.status'), ['active', 'inactive', 'suspended'].map((v) => ({ value: v, label: t(`rider.status.${v}`) })))}
            {sel('city', t('riders.city'), cities.map((c: any) => ({ value: String(c.id), label: city(c) })))}</>}
          {name === 'documents' && <>{sel('kind', t('alerts.document'), (d?.facets?.kinds ?? []).map((k: string) => ({ value: k, label: t(`alerts.kind.${k}`) })))}
            {sel('validity', t('rep.validity'), ['expired', 'near', 'valid'].map((v) => ({ value: v, label: t(`alerts.state.${v}`) })))}
            <label className="flex h-9 items-center gap-1 rounded-lg border border-zinc-300 bg-white ps-2.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"><span className="text-zinc-500">{t('rep.within')}:</span>
              <input type="number" min={1} className="h-full w-16 bg-transparent pe-2 text-sm outline-none" value={query.within ?? ''} onChange={(e) => set('within', e.target.value || null)} /></label></>}
          {name === 'advances' && <>{sel('status', t('adv.status'), ['pending', 'disbursed', 'repaying', 'settled'].map((v) => ({ value: v, label: t(`adv.s.${v}`) })))}
            {sel('overdue', t('adv.overdue_only'), [{ value: 'yes', label: t('common.yes') }])}{date('from', t('common.from'))}{date('to', t('common.to'))}</>}
          {params.toString() && <Button size="sm" variant="ghost" className="text-red-600" onClick={() => { setTerm(''); setParams(new URLSearchParams(), { replace: true }); }}>{t('table.clear_filters')}</Button>}
        </div>
      </Card>
      <Card title={<>{t(`rep.${name}.title`)} <span className="ms-2 text-xs font-normal text-zinc-500">{t('rep.records')}: <span className="num">{fmtNum(d?.total)}</span></span></>} pad={false}>
        {!d ? <Loading /> : d.rows.length === 0 ? <div className="py-12 text-center text-sm text-zinc-500"><div className="font-medium">{t('rep.no_data')}</div><div className="text-xs">{t('rep.no_data_sub')}</div></div> : (
          <div className="scroll-thin max-h-[70vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-900"><tr>{cols.map(([h]) => <th key={h} className="whitespace-nowrap px-3 py-2 text-start font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{d.rows.map((r: any, i: number) => <tr key={i}>{cols.map(([h, f]) => <td key={h} className="px-3 py-2">{f(r) ?? '—'}</td>)}</tr>)}</tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

// ======================================================================== 9.3 notification log
const SEV_TONE: Record<string, Tone> = { info: 'blue', warning: 'amber', critical: 'red' };
export const NOTE_CATEGORIES = ['document_expiry', 'oil_change', 'advance_status', 'installment_due', 'performance', 'backup', 'security', 'system', 'general'];

export function NotificationsLog() {
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const run = useAction();
  const { confirm, toast } = useUi();
  const text = useNoteText();
  const list = useList('/notifications');
  const [open, setOpen] = useState<any>(null);
  const s = list.stats ?? {};
  const markRead = async (r: any) => { if (await run(() => post(`/notifications/${r.id}/read`), t('note.marked_read'))) list.reload(); };
  const remove = async (r: any) => {
    if (!(await confirm({ title: t('note.delete_q'), confirm: t('note.delete') }))) return;
    if (await run(() => del(`/notifications/${r.id}`), t('note.deleted'))) { setOpen(null); list.reload(); }
  };
  const columns: Column<any>[] = [
    { key: 'sent', header: t('note.sent'), sort: 'sent', render: (r) => <span className="num text-xs">{fmtDateTime(r.created_at)}</span> },
    { key: 'recipient', header: t('note.recipient'), sort: 'recipient', render: (r) => <div><div>{r.recipient_gone ? t('note.deleted_recipient') : r.recipient}</div><div className="text-xs text-zinc-500">{t(`note.kind.${r.recipient_kind}`)}</div></div> },
    { key: 'category', header: t('note.category'), sort: 'category', render: (r) => t(`note.cat.${r.category}`) },
    { key: 'severity', header: t('note.severity'), sort: 'severity', render: (r) => <Badge tone={SEV_TONE[r.severity]}>{t(`note.sev.${r.severity}`)}</Badge> },
    { key: 'text', header: t('note.notification'), render: (r) => { const x = text(r); return <div className="max-w-96"><div className="font-medium">{x.title}</div>{x.body && <div className="text-xs text-zinc-500">{x.body}</div>}</div>; } },
    { key: 'state', header: t('note.state'), sort: 'state', render: (r) => <Badge tone={r.read_at ? 'grey' : 'blue'}>{r.read_at ? t('note.read') : t('note.unread')}</Badge> },
    { key: 'actions', header: t('common.actions'), render: (r) => <div className="flex">
      <IconButton title={t('note.view')} onClick={() => setOpen(r)}><Eye /></IconButton>
      {!r.read_at && <IconButton title={t('note.mark_read')} tone="green" onClick={() => markRead(r)}><Check /></IconButton>}
      {can('notifications.delete') && <IconButton title={t('note.delete')} tone="red" onClick={() => remove(r)}><Trash2 /></IconButton>}</div> },
  ];
  const x = open && text(open);
  return (
    <>
      <PageHeader title={t('note.title')} actions={<>
        <Button icon={<RefreshCw className="size-4" />} onClick={list.reload}>{t('common.refresh')}</Button>
        {can('notification_prefs.view') && <Link to="/admin/notifications/preferences"><Button icon={<Settings2 className="size-4" />}>{t('note.prefs')}</Button></Link>}
        {can('notifications.send') && <Button variant="primary" icon={<Bell className="size-4" />} onClick={async () => {
          const r = await run(() => post('/notifications/generate'));
          if (r) { toast(r.created ? t('note.generated', { n: r.created }) : t('note.nothing_new'), r.created ? 'green' : 'blue'); list.reload(); }
        }}>{t('note.generate')}</Button>}
      </>} />
      <StatGrid>
        <StatCard label={t('note.s.total')} value={fmtNum(s.total)} />
        <StatCard label={t('note.s.unread')} value={fmtNum(s.unread)} tone={s.unread ? 'blue' : 'none'} />
        <StatCard label={t('note.s.critical')} value={fmtNum(s.critical)} tone={s.critical ? 'red' : 'none'} />
        <StatCard label={t('note.s.warning')} value={fmtNum(s.warning)} tone={s.warning ? 'amber' : 'none'} />
      </StatGrid>
      <FilterBar list={list} placeholder={t('note.search_hint')} actions={can('notifications.export') && <ExportButton path="/notifications/export" query={list.query} label={t('common.export_csv')} />}>
        <FilterSelect list={list} name="kind" label={t('note.recipient_kind')} options={['manager', 'admin', 'rider'].map((k) => ({ value: k, label: t(`note.kind.${k}`) }))} />
        <FilterSelect list={list} name="category" label={t('note.category')} options={NOTE_CATEGORIES.map((k) => ({ value: k, label: t(`note.cat.${k}`) }))} />
        <FilterSelect list={list} name="severity" label={t('note.severity')} options={['info', 'warning', 'critical'].map((k) => ({ value: k, label: t(`note.sev.${k}`) }))} />
        <FilterSelect list={list} name="state" label={t('note.state')} options={[{ value: 'unread', label: t('note.unread') }, { value: 'read', label: t('note.read') }]} />
        <FilterDate list={list} name="from" label={t('common.from')} />
        <FilterDate list={list} name="to" label={t('common.to')} />
      </FilterBar>
      <DataTable list={list} columns={columns} onRowClick={setOpen} />
      <SidePanel open={!!open} onClose={() => setOpen(null)} title={t('note.details')} footer={open && <>
        {open.link && <Button icon={<ExternalLink className="size-4" />} onClick={() => nav(open.link)}>{t('note.open_record')}</Button>}
        {!open.read_at && <Button onClick={() => markRead(open).then(() => setOpen({ ...open, read_at: new Date().toISOString() }))}>{t('note.mark_read')}</Button>}
      </>}>
        {open && <div className="space-y-4 text-sm">
          <h3 className="text-base font-semibold">{x.title}</h3>
          <Details cols={1} rows={[[t('note.recipient'), `${open.recipient_gone ? t('note.deleted_recipient') : open.recipient} · ${t(`note.kind.${open.recipient_kind}`)}`],
            [t('note.category'), t(`note.cat.${open.category}`)], [t('note.severity'), <Badge tone={SEV_TONE[open.severity]}>{t(`note.sev.${open.severity}`)}</Badge>],
            [t('note.sent_at'), <span className="num">{fmtDateTime(open.created_at)}</span>], [t('note.read_at'), open.read_at ? <span className="num">{fmtDateTime(open.read_at)}</span> : t('note.not_read_yet'), true],
            [t('note.about'), open.entity_type && <span dir="ltr">{open.entity_type} #{open.entity_id}</span>]]} />
          <p className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">{x.body ?? t('note.no_text')}</p>
        </div>}
      </SidePanel>
    </>
  );
}

// ======================================================================== 9.4 preferences
export function NotificationPrefs() {
  const { t } = useI18n();
  const { can, me } = useAuth();
  const { toast } = useUi();
  const [rows, setRows] = useState<any[] | null>(null);
  const load = () => get('/notifications/preferences').then(setRows);
  useEffect(() => { load(); }, []);
  const change = async (r: any, k: 'in_app' | 'email', v: boolean) => {
    const before = rows;
    setRows(rows!.map((x) => (x.category === r.category ? { ...x, [k]: v, customised: true } : x)));
    try { await put(`/notifications/preferences/${r.category}`, { [k]: v }); toast(t('note.pref_saved')); } catch { setRows(before); toast(t('note.pref_failed'), 'red'); }
  };
  const editable = can('notification_prefs.update');
  return (
    <>
      <PageHeader title={t('note.prefs')} subtitle={t('note.prefs_sub')} back="/admin/notifications" actions={<>
        <Button icon={<RefreshCw className="size-4" />} onClick={load}>{t('common.refresh')}</Button>
        {can('notifications.view') && <Link to="/admin/notifications"><Button>{t('note.title')}</Button></Link>}
      </>} />
      <Card title={t('note.prefs_for')} subtitle={me?.full_name} pad={false}>
        <div className="p-4"><Alert tone="amber">{t('note.mute_warning')}</Alert></div>
        {!rows ? <Loading /> : (
          <table className="w-full text-sm">
            <thead className="bg-zinc-50/80 text-xs text-zinc-500 dark:bg-zinc-800/30"><tr>{[t('note.category'), t('note.in_app'), t('note.email'), t('note.state')].map((h) => <th key={h} className="px-4 py-2 text-start font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{rows.map((r) => (
              <tr key={r.category}>
                <td className="px-4 py-2.5 font-medium">{t(`note.cat.${r.category}`)}</td>
                <td className="px-4 py-2.5"><Checkbox checked={r.in_app} disabled={!editable} onChange={(v) => change(r, 'in_app', v)} /></td>
                <td className="px-4 py-2.5"><Checkbox checked={r.email} disabled={!editable} onChange={(v) => change(r, 'email', v)} /></td>
                <td className="px-4 py-2.5"><Badge tone={r.customised ? 'blue' : 'grey'}>{r.customised ? t('note.customised') : t('note.default')}</Badge></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
    </>
  );
}
