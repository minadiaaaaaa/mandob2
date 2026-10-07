import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CalendarRange, Columns3, Eye, FileUp, Pencil, Plus, RefreshCw, Trash2, Users } from 'lucide-react';
import { del, get, patch, post } from '../../api';
import { useAuth } from '../../auth';
import { fmtDateTime, fmtNum, useI18n } from '../../i18n';
import { Alert, Badge, Button, Card, Checkbox, cx, Details, Field, IconButton, Loading, PageHeader, SidePanel, StatCard, StatGrid, toneText, useAction, useUi, type Tone } from '../../ui/kit';
import { Grid, RiderInput, SaveBar, TextInput, useForm } from '../../ui/forms';
import { DataTable, FilterBar, FilterDate, FilterNumber, FilterSelect, useList, type Column, type ListState } from '../../ui/table';
import { ImportWizard } from '../../ui/importer';
import { ExportButton, useCityName, useOptions } from '../../ui/common';

// The measures, in the order the screens show them. Rates are fractions of one.
export const MEASURES: [string, 'text' | 'int' | 'num' | 'rate'][] = [
  ['batch', 'text'], ['tga_status', 'text'], ['error_codes', 'text'], ['shifts', 'int'], ['working_days', 'int'], ['planned_hours', 'num'], ['actual_hours', 'num'],
  ['avg_hours', 'num'], ['attendance_rate', 'rate'], ['break_hours', 'num'], ['lost_hours', 'num'], ['acceptance_rate', 'rate'], ['contact_rate', 'rate'],
  ['no_shows', 'int'], ['no_show_rate', 'rate'], ['notified', 'int'], ['accepted', 'int'], ['completed', 'int'], ['stacked', 'int'], ['declined', 'int'],
  ['cancelled', 'int'], ['deductions', 'int'], ['not_accepted', 'int'], ['manual_undispatched', 'int'], ['chat_response_rate', 'rate'],
];
const KIND = Object.fromEntries(MEASURES);
const OPTIONAL = ['company_name', 'city', 'contract_name', 'vehicle', ...MEASURES.map(([k]) => k)];
const DEFAULT_COLS = ['company_name', 'city', 'contract_name', 'vehicle', 'tga_status', 'planned_hours', 'actual_hours', 'attendance_rate', 'lost_hours', 'acceptance_rate', 'notified', 'completed', 'declined'];

// Rates are truncated, not rounded, so 95% never sits on a cell below 95%.
export const pct = (v: unknown) => (v == null ? '—' : `${(Math.floor(Number(v) * 1000) / 10).toFixed(1)}%`);
export const toneFor = (k: string, v: unknown): Tone => {
  if (v == null || v === '') return 'none';
  const n = Number(v);
  switch (k) {
    case 'completed': return n < 10 ? 'red' : n < 15 ? 'amber' : 'green';
    case 'attendance_rate': return n < 0.7 ? 'red' : n < 0.95 ? 'amber' : 'green';
    case 'acceptance_rate': return n < 0.85 ? 'red' : n < 0.95 ? 'amber' : 'green';
    case 'actual_hours': case 'avg_hours': return n < 6 ? 'red' : n < 8 ? 'amber' : 'green';
    case 'lost_hours': return n >= 2.5 ? 'red' : n >= 1 ? 'amber' : 'none';
    case 'no_shows': return n > 0 ? 'red' : 'none';
    case 'tga_status': return String(v).toLowerCase() === 'compliant' ? 'green' : 'amber';
    default: return 'none';
  }
};
export function Measure({ k, v }: { k: string; v: unknown }) {
  const kind = KIND[k];
  const text = v == null || v === '' ? '—' : kind === 'rate' ? pct(v) : kind === 'num' ? fmtNum(Number(v), 1) : kind === 'int' ? fmtNum(Number(v)) : String(v);
  return <span className={cx('num whitespace-nowrap', toneText(toneFor(k, v)), toneFor(k, v) !== 'none' && 'font-medium')}>{text}</span>;
}
const iso = (d: Date) => new Intl.DateTimeFormat('en-CA').format(d);
const ago = (n: number) => iso(new Date(Date.now() - n * 86400000));

function QuickDays({ list, ranges }: { list: ListState; ranges: [string, number, number][] }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap gap-1">
      {ranges.map(([k, a, b]) => { const from = ago(a); const to = ago(b); const on = list.query.from === from && list.query.to === to; return (
        <button key={k} onClick={() => list.setMany({ from, to })} className={cx('h-9 rounded-lg px-2.5 text-xs font-medium ring-1 ring-inset', on ? 'bg-brand text-white ring-brand' : 'bg-white text-zinc-600 ring-zinc-300 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-700')}>{t(k)}</button>
      ); })}
    </div>
  );
}

// ======================================================================== 6.1 the daily table
export function PerformanceList() {
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const run = useAction();
  const { confirm } = useUi();
  const city = useCityName();
  const today = iso(new Date());
  const list = useList('/performance', { from: today, to: today });
  const companies = useOptions<any>('/lookups/companies');
  const contracts = useOptions<any>(list.query.company ? `/lookups/contracts?company=${list.query.company}` : '/lookups/contracts');
  const cities = useOptions<any>('/lookups/cities');
  const [cols, setCols] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('lsp.perf.cols') ?? '') ?? DEFAULT_COLS; } catch { return DEFAULT_COLS; } });
  const [picking, setPicking] = useState(false);
  useEffect(() => { try { localStorage.setItem('lsp.perf.cols', JSON.stringify(cols)); } catch { /* ignore */ } }, [cols]);
  const s = list.stats ?? {};
  const remove = async (ids: (string | number)[]) => {
    if (!(await confirm({ title: t('perf.delete_q', { n: ids.length }), body: t('perf.delete_body'), confirm: t('common.delete') }))) return;
    if (await run(() => (ids.length > 1 ? post('/performance/bulk-delete', { ids }) : del(`/performance/${ids[0]}`)), t('common.deleted'))) { list.setSelected(new Set()); list.reload(); }
  };
  const cell = (k: string, r: any): ReactNode => (k === 'company_name' ? r.company_name : k === 'city' ? (r.city_ar ? city(r) : '—') : k === 'contract_name' ? r.contract_name : k === 'vehicle' ? r.vehicle : <Measure k={k} v={r[k]} />);
  const columns: Column<any>[] = [
    { key: 'rider', header: t('perf.rider'), sort: 'rider', render: (r) => <div className="min-w-40"><Link to={`/admin/performance/riders/${r.rider_id}?from=${list.query.from ?? ''}&to=${list.query.to ?? ''}`} className="font-medium hover:text-brand">{r.full_name}</Link><div className="text-xs text-zinc-500">{r.alias ?? r.contract_name ?? ''}</div></div> },
    { key: 'date', header: t('perf.date'), sort: 'date', render: (r) => <span className="num">{r.work_date}</span> },
    ...cols.map((k) => ({ key: k, header: t(`perf.m.${k === 'city' ? 'city_ar' : k}`), title: t(`perf.h.${k}`), sort: ['completed', 'attendance_rate', 'acceptance_rate', 'actual_hours'].includes(k) ? ({ attendance_rate: 'attendance', acceptance_rate: 'acceptance', actual_hours: 'hours' } as any)[k] ?? k : undefined, render: (r: any) => cell(k, r) ?? '—' })),
    { key: 'actions', header: t('common.actions'), render: (r) => <div className="flex">
      <IconButton title={t('common.view')} onClick={() => nav(`/admin/performance/${r.id}`)}><Eye /></IconButton>
      {can('performance.update') && <IconButton title={t('common.edit')} onClick={() => nav(`/admin/performance/${r.id}/edit`)}><Pencil /></IconButton>}
      {can('performance.delete') && <IconButton title={t('common.delete')} tone="red" onClick={() => remove([r.id])}><Trash2 /></IconButton>}</div> },
  ];
  return (
    <>
      <PageHeader title={t('perf.title')} actions={<>
        <Link to={`/admin/performance/riders?from=${list.query.from ?? ''}&to=${list.query.to ?? ''}`}><Button icon={<Users className="size-4" />}>{t('perf.scorecard')}</Button></Link>
        <Button icon={<Columns3 className="size-4" />} onClick={() => setPicking(true)}>{t('perf.columns')} <span className="num text-zinc-500">{cols.length}/{OPTIONAL.length}</span></Button>
        {can('performance.export') && <ExportButton path="/performance/export" query={{ ...list.query, cols: cols.join(',') }} />}
        {can('performance.import') && <Link to="/admin/performance/import"><Button icon={<FileUp className="size-4" />}>{t('perf.import')}</Button></Link>}
        {can('sync.run') && <Link to="/admin/sync"><Button icon={<RefreshCw className="size-4" />}>{t('perf.sync_hs')}</Button></Link>}
        {can('performance.create') && <Link to="/admin/performance/new"><Button variant="primary" icon={<Plus className="size-4" />}>{t('perf.add')}</Button></Link>}
      </>} />
      <StatGrid>
        <StatCard label={t('perf.s.records')} value={fmtNum(s.records)} /><StatCard label={t('perf.s.riders')} value={fmtNum(s.riders)} />
        <StatCard label={t('perf.s.completed')} value={fmtNum(s.completed)} tone="green" /><StatCard label={t('perf.s.notified')} value={fmtNum(s.notified)} />
        <StatCard label={t('perf.s.hours')} value={fmtNum(s.hours, 1)} /><StatCard label={t('perf.s.lost')} value={fmtNum(s.lost, 1)} tone={s.lost > 0 ? 'amber' : 'none'} />
        <StatCard label={t('perf.s.attendance')} value={pct(s.attendance)} /><StatCard label={t('perf.s.acceptance')} value={pct(s.acceptance)} />
        <StatCard label={t('perf.s.not_compliant')} value={fmtNum(s.not_compliant)} tone={s.not_compliant ? 'red' : 'none'} />
      </StatGrid>
      <FilterBar list={list} placeholder={t('perf.search_hint')}>
        <FilterDate list={list} name="from" label={t('common.from')} />
        <FilterDate list={list} name="to" label={t('common.to')} />
        <QuickDays list={list} ranges={[['perf.r.today', 0, 0], ['perf.r.yesterday', 1, 1], ['perf.r.last7', 7, 1], ['perf.r.last30', 30, 1]]} />
        <FilterSelect list={list} name="company" label={t('perf.m.company_name')} options={companies.map((c: any) => ({ value: c.id, label: c.name }))} />
        <FilterSelect list={list} name="contract" label={t('perf.m.contract_name')} options={contracts.map((c: any) => ({ value: c.id, label: c.name }))} />
        <FilterSelect list={list} name="city" label={t('perf.m.city_ar')} options={cities.map((c: any) => ({ value: c.id, label: city(c) }))} />
        <FilterSelect list={list} name="tga" label={t('perf.m.tga_status')} options={(list.data?.facets?.tga ?? []).map((v: string) => ({ value: v, label: v }))} />
        <FilterSelect list={list} name="band" label={t('perf.band')} options={['critical', 'warning', 'good'].map((v) => ({ value: v, label: t(`perf.band.${v}`) }))} />
        <FilterNumber list={list} name="del_min" label={t('perf.del_from')} min={0} />
        <FilterNumber list={list} name="del_max" label={t('perf.del_to')} min={0} />
      </FilterBar>
      <DataTable list={list} columns={columns} onRowClick={(r) => nav(`/admin/performance/${r.id}`)} selectable={can('performance.delete')} emptyText={t('perf.empty')}
        bulk={can('performance.delete') && <Button size="sm" variant="danger" onClick={() => remove([...list.selected])}>{t('common.delete_selected')}</Button>} />
      <SidePanel open={picking} onClose={() => setPicking(false)} title={t('perf.visible_columns')} footer={<>
        <Button size="sm" variant="ghost" onClick={() => setCols(DEFAULT_COLS)}>{t('perf.cols_default')}</Button>
        <Button size="sm" variant="ghost" onClick={() => setCols(OPTIONAL)}>{t('perf.cols_all')}</Button>
        <Button size="sm" variant="ghost" onClick={() => setCols([])}>{t('perf.cols_none')}</Button></>}>
        <ul className="space-y-2">{OPTIONAL.map((k) => <li key={k}><Checkbox checked={cols.includes(k)} onChange={(v) => setCols(v ? OPTIONAL.filter((x) => x === k || cols.includes(x)) : cols.filter((x) => x !== k))}
          label={<span>{t(`perf.m.${k === 'city' ? 'city_ar' : k}`)}<span className="block text-xs text-zinc-500">{t(`perf.h.${k}`)}</span></span>} /></li>)}</ul>
      </SidePanel>
    </>
  );
}

// ---------- one record ----------
export function PerformanceView() {
  const { id } = useParams();
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const run = useAction();
  const { confirm } = useUi();
  const city = useCityName();
  const [p, setP] = useState<any>(null);
  useEffect(() => { get(`/performance/${id}`).then(setP); }, [id]);
  if (!p) return <Loading />;
  const none = <span className="text-zinc-400">{t('perf.no_value')}</span>;
  const val = (k: string) => (p[k] == null || p[k] === '' ? none : <Measure k={k} v={p[k]} />);
  return (
    <>
      <PageHeader title={t('perf.record')} subtitle={<span>{p.full_name} · <span className="num">{p.work_date}</span></span>} back="/admin/performance" actions={<>
        {can('performance.update') && <Link to={`/admin/performance/${id}/edit`}><Button icon={<Pencil className="size-4" />}>{t('common.edit')}</Button></Link>}
        <Link to={`/admin/performance/riders/${p.rider_id}`}><Button icon={<CalendarRange className="size-4" />}>{t('perf.scorecard')}</Button></Link>
      </>} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {['completed', 'notified', 'actual_hours', 'attendance_rate', 'acceptance_rate', 'lost_hours'].map((k) => (
          <div key={k} className="rounded-xl border border-zinc-200/80 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"><div className="text-xs text-zinc-500">{t(`perf.m.${k}`)}</div><div className="mt-1 text-xl font-semibold">{val(k)}</div></div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('perf.the_rider')}><Details rows={[[t('perf.rider'), <Link className="text-brand hover:underline" to={`/admin/riders/${p.rider_id}`}>{p.full_name}</Link>], [t('riders.rider_id'), <span className="num">{p.rider_id}</span>],
          [t('perf.m.company_name'), p.company_name], [t('perf.m.contract_name'), p.contract_name], [t('perf.m.city_ar'), p.city_ar ? city(p) : null], [t('perf.m.vehicle'), p.vehicle]]} /></Card>
        <Card title={t('perf.the_day')}><Details rows={[[t('perf.date'), <span className="num">{p.work_date}</span>], [t('perf.m.batch'), val('batch')], [t('perf.m.tga_status'), val('tga_status')],
          [t('perf.m.error_codes'), val('error_codes')], [t('perf.recorded_by'), p.created_by_name ?? t(`perf.src.${p.source}`), true], [t('perf.recorded'), <span className="num">{fmtDateTime(p.created_at)}</span>]]} /></Card>
      </div>
      <Card title={t('perf.every_column')} className="mt-4" pad={false}>
        <table className="w-full text-sm"><tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {MEASURES.map(([k]) => <tr key={k}><td className="w-1/4 px-4 py-2 font-medium">{t(`perf.m.${k}`)}</td><td className="w-32 px-4 py-2">{val(k)}</td><td className="px-4 py-2 text-xs text-zinc-500">{t(`perf.h.${k}`)}</td></tr>)}
        </tbody></table>
      </Card>
      {can('performance.delete') && <Card title={t('common.delete')} className="mt-4"><Button variant="danger" icon={<Trash2 className="size-4" />} onClick={async () => {
        if (!(await confirm({ title: t('perf.delete_q', { n: 1 }), body: t('perf.delete_body') }))) return;
        if (await run(() => del(`/performance/${id}`), t('common.deleted'))) nav('/admin/performance');
      }}>{t('common.delete')}</Button></Card>}
    </>
  );
}

export function PerformanceForm() {
  const { id } = useParams();
  const { t } = useI18n();
  const nav = useNavigate();
  const { toast } = useUi();
  const city = useCityName();
  const empty = { rider_id: '', work_date: iso(new Date()), ...Object.fromEntries(MEASURES.filter(([k]) => k !== 'avg_hours').map(([k]) => [k, ''])) };
  const form = useForm<Record<string, any>>(empty);
  const [loaded, setLoaded] = useState<any>(id ? null : {});
  const [fromRider, setFromRider] = useState<any>(null);
  useEffect(() => { if (id) get(`/performance/${id}`).then((p) => { setLoaded(p); form.reset(Object.fromEntries(Object.keys(empty).map((k) => [k, p[k] ?? '']))); }); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (form.values.rider_id) get(`/performance-rider/${form.values.rider_id}`, { day: form.values.work_date }).then(setFromRider).catch(() => setFromRider(null)); else setFromRider(null); }, [form.values.rider_id, form.values.work_date]);
  if (!loaded) return <Loading />;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await form.submit(() => (id ? patch(`/performance/${id}`, form.changes) : post('/performance', form.values)));
    if (r) { toast(id ? t('perf.saved') : t('perf.added')); nav(`/admin/performance/${id ?? r.id}`); }
  };
  return (
    <form onSubmit={submit}>
      <PageHeader title={id ? t('perf.edit') : t('perf.new')} back={id ? `/admin/performance/${id}` : '/admin/performance'} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><Grid><RiderInput form={form} name="rider_id" label={t('perf.rider')} required /><TextInput form={form} name="work_date" label={t('perf.report_date')} type="date" required /></Grid></Card>
        <Card title={t('perf.from_rider_record')}>{fromRider ? <Details rows={[[t('perf.m.company_name'), fromRider.company_name, true], [t('perf.m.contract_name'), fromRider.contract_name, true],
          [t('perf.m.city_ar'), fromRider.city_ar ? city(fromRider) : null, true], [t('perf.m.vehicle'), fromRider.vehicle, true]]} /> : <p className="text-sm text-zinc-500">{t('perf.pick_rider')}</p>}</Card>
      </div>
      <Card title={t('perf.measures')} subtitle={t('perf.measures_hint')} className="mt-4"><Grid cols={4}>
        {MEASURES.filter(([k]) => k !== 'avg_hours').map(([k, kind]) => <TextInput key={k} form={form} name={k} label={t(`perf.m.${k}`)} dir="ltr" maxLength={kind === 'text' ? 50 : 12}
          hint={kind === 'rate' ? t('perf.rate_hint') : undefined} />)}
      </Grid></Card>
      <SaveBar form={form} editing={!!id} label={id ? t('common.save') : t('perf.save_record')} onCancel={() => nav(-1)} />
    </form>
  );
}

export function PerformanceImport() {
  const { t } = useI18n();
  const companies = useOptions<any>('/lookups/companies');
  const [day, setDay] = useState(ago(1));
  const [company, setCompany] = useState('');
  const [missing, setMissing] = useState<string[]>([]);
  useEffect(() => { get<string[]>('/performance/missing-days', { day }).then(setMissing).catch(() => setMissing([])); }, [day]);
  return (
    <>
      <PageHeader title={t('perf.import')} back="/admin/performance" />
      <Card className="mb-4" title={t('perf.file_and_day')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('perf.file_is_for')} required><input type="date" className="input" value={day} max={iso(new Date())} onChange={(e) => setDay(e.target.value)} /></Field>
          <Field label={t('perf.sent_by')} hint={t('perf.sent_by_hint')}><select className="input" value={company} onChange={(e) => setCompany(e.target.value)}><option value="">{t('common.choose')}</option>{companies.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        </div>
        {missing.length > 0 && <div className="mt-3"><Alert tone="amber">{t('perf.missing_days', { n: missing.length })} <span className="num">{missing.slice(0, 10).join('، ')}</span></Alert></div>}
      </Card>
      <ImportWizard key={`${day}|${company}`} base="/performance-import" back="/admin/performance" values={{ day, company_id: company }}
        options={[{ name: 'create_riders', label: t('perf.create_riders') }, { name: 'create_contracts', label: t('perf.create_contracts'), defaultOn: true }]}
        extraLabels={{ new_rows: t('perf.new_rows'), recorded: t('perf.recorded_day'), unknown_riders: t('perf.unknown_riders') }}
        modeLabels={{ question: t('perf.dup_question'), skip: t('import.skip'), replace: t('import.replace') }} />
    </>
  );
}

// ======================================================================== 6.2 the scorecard
const GRADE_TONE: Record<string, Tone> = { negligent: 'red', weak: 'amber', fair: 'blue', strong: 'green' };
function Why({ reasons }: { reasons: string[] }) {
  const { t } = useI18n();
  return reasons.length ? <div className="flex flex-wrap gap-1">{reasons.map((r) => <Badge key={r} tone="grey">{t(`score.r.${r}`)}</Badge>)}</div> : <span className="text-xs text-zinc-500">{t('score.nothing')}</span>;
}
export function Scorecard() {
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const list = useList('/performance-scorecard', { from: ago(14), to: ago(1) });
  const companies = useOptions<any>('/lookups/companies');
  const s = list.stats ?? {};
  const span = list.data?.span ?? 14;
  const absTone = (r: any): Tone => (r.absent_net / span >= 0.15 ? 'red' : r.absent_net / span >= 0.05 ? 'amber' : 'green');
  const columns: Column<any>[] = [
    { key: 'grade', header: t('score.grade'), render: (r) => <div><Badge tone={GRADE_TONE[r.grade]}>{t(`score.g.${r.grade}`)}</Badge>{r.points != null && <div className="mt-0.5 text-xs text-zinc-500 num">{t('score.of6', { n: r.points })}</div>}</div> },
    { key: 'rider', header: t('score.rider'), render: (r) => <div><Link to={`/admin/performance/riders/${r.id}?from=${list.data?.from}&to=${list.data?.to}`} className="font-medium hover:text-brand">{r.full_name}</Link><div className="text-xs text-zinc-500">{[r.alias, r.company_name].filter(Boolean).join(' · ')}</div></div> },
    { key: 'absent', header: t('score.absent_days'), render: (r) => <div><span className={cx('num font-medium', toneText(absTone(r)))}>{r.absent}</span><div className="text-xs text-zinc-500">{t('score.of_days', { n: span })}{r.leave_days > 0 && ` · ${t('score.leave_x', { n: r.leave_days })}`}</div></div> },
    { key: 'days', header: t('score.days_worked'), render: (r) => <span className="num">{r.days}</span> },
    { key: 'hours', header: t('score.actual_hours'), render: (r) => <div><span className={cx('num', toneText(toneFor('avg_hours', r.hours / Math.max(1, r.days))))}>{fmtNum(r.hours, 1)}</span><div className="text-xs text-zinc-500 num">{fmtNum(r.planned, 1)}</div></div> },
    { key: 'missed', header: t('score.missed_hours'), render: (r) => <span className={cx('num', toneText(toneFor('lost_hours', r.missed_hours / Math.max(1, r.days))))}>{fmtNum(r.missed_hours, 1)}</span> },
    { key: 'orders', header: t('score.orders'), render: (r) => <div><span className="num">{fmtNum(r.orders)}</span><div className={cx('text-xs num', toneText(toneFor('completed', r.per_day)))}>{fmtNum(r.per_day, 1)} / {t('score.day')}</div></div> },
    { key: 'att', header: t('score.attendance'), render: (r) => <Measure k="attendance_rate" v={r.att} /> },
    { key: 'acc', header: t('score.acceptance'), render: (r) => <span className={cx('num', r.acc != null && toneText(r.acc >= 0.95 ? 'green' : 'amber'))}>{pct(r.acc)}</span> },
    { key: 'no_shows', header: t('score.missed_shifts'), render: (r) => <Measure k="no_shows" v={r.no_shows} /> },
    { key: 'why', header: t('score.why'), render: (r) => <Why reasons={r.reasons} /> },
  ];
  const grades = ['negligent', 'weak', 'fair', 'strong'];
  return (
    <>
      <PageHeader title={t('score.title')} subtitle={list.data && <span className="num">{list.data.from} → {list.data.to}</span>} back="/admin/performance"
        actions={can('performance.export') && <ExportButton path="/performance-scorecard/export" query={list.query} />} />
      <StatGrid>
        <StatCard label={t('score.s.riders')} value={fmtNum(s.riders)} />
        <StatCard label={t('score.s.attention')} value={fmtNum(s.attention)} tone={s.attention ? 'red' : 'none'} />
        {grades.map((g) => <StatCard key={g} label={t(`score.g.${g}`)} value={fmtNum(s[g])} sub={t(`score.d.${g}`)} tone={GRADE_TONE[g]} onClick={() => list.set('grade', list.query.grade === g ? null : g)} active={list.query.grade === g} />)}
      </StatGrid>
      <Card className="mb-4" title={t('score.how_to_read')}><p className="text-sm text-zinc-600 dark:text-zinc-300">{t('score.how_text')}</p></Card>
      <FilterBar list={list} placeholder={t('score.search_hint')}>
        <FilterDate list={list} name="from" label={t('common.from')} />
        <FilterDate list={list} name="to" label={t('common.to')} />
        <QuickDays list={list} ranges={[['perf.r.last7', 7, 1], ['perf.r.last30', 30, 1]]} />
        <FilterSelect list={list} name="company" label={t('perf.m.company_name')} options={companies.map((c: any) => ({ value: c.id, label: c.name }))} />
        <FilterSelect list={list} name="sort" label={t('score.sort')} allLabel={t('score.sort.worst')} options={['absent', 'hours', 'attendance', 'orders', 'no_shows'].map((k) => ({ value: k, label: t(`score.sort.${k}`) }))} />
        <FilterNumber list={list} name="hours_min" label={t('score.hours_min')} min={0} />
        <FilterNumber list={list} name="hours_max" label={t('score.hours_max')} min={0} />
        <FilterNumber list={list} name="absent_min" label={t('score.absent_min')} min={0} />
        <FilterNumber list={list} name="noshow_min" label={t('score.noshow_min')} min={0} />
      </FilterBar>
      <div className="mb-3 flex flex-wrap gap-1">
        <Button size="sm" variant="ghost" onClick={() => list.setMany({ sort: 'absent' })}>{t('score.q.most_absent')}</Button>
        <Button size="sm" variant="ghost" onClick={() => list.setMany({ sort: 'hours' })}>{t('score.q.fewest_hours')}</Button>
        <Button size="sm" variant="ghost" onClick={() => list.setMany({ hours_max: '0' })}>{t('score.q.no_hours')}</Button>
      </div>
      <DataTable list={list} columns={columns} rowKey="id" onRowClick={(r) => nav(`/admin/performance/riders/${r.id}?from=${list.data?.from}&to=${list.data?.to}`)} />
    </>
  );
}

export function ScorecardRider() {
  const { id } = useParams();
  const { t } = useI18n();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [d, setD] = useState<any>(null);
  const [missing, setMissing] = useState(false);
  const query = useMemo(() => Object.fromEntries(params), [params]);
  useEffect(() => { setD(null); get(`/performance-scorecard/${id}`, query).then(setD).catch(() => setMissing(true)); }, [id, query]);
  if (missing) return <Alert tone="amber">{t('err.rider_not_found')}</Alert>;
  if (!d) return <Loading />;
  const sc = d.score;
  return (
    <>
      <PageHeader title={d.rider.full_name} subtitle={sc && <Badge tone={GRADE_TONE[sc.grade]}>{t(`score.g.${sc.grade}`)}{sc.points != null && ` · ${t('score.of6', { n: sc.points })}`}</Badge>} back="/admin/performance/riders" actions={<>
        <Link to={`/admin/riders/${id}`}><Button>{t('score.rider_file')}</Button></Link>
        <Link to={`/admin/performance?rider=${id}&from=${d.from}&to=${d.to}`}><Button>{t('score.in_daily')}</Button></Link>
        <Link to={`/admin/performance/riders?from=${d.from}&to=${d.to}`}><Button variant="ghost">{t('score.title')}</Button></Link>
      </>} />
      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card title={t('score.period')}>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('common.from')}><input type="date" className="input" value={d.from} onChange={(e) => setParams({ ...query, from: e.target.value })} /></Field>
            <Field label={t('common.to')}><input type="date" className="input" value={d.to} onChange={(e) => setParams({ ...query, to: e.target.value })} /></Field>
          </div>
        </Card>
        <Card title={t('score.rider')} className="lg:col-span-2"><Details cols={3} rows={[[t('riders.rider_id'), <span className="num">{d.rider.id}</span>], [t('riders.contract'), d.rider.contract_name],
          [t('riders.mobile'), d.rider.phone && <span className="num">{d.rider.phone}</span>], [t('riders.national_id'), d.rider.national_id], [t('riders.hire_date'), d.rider.hire_date]]} /></Card>
      </div>
      {!sc ? <Alert tone="amber">{t('score.no_perf')}</Alert> : <>
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label={t('score.days_worked')} value={fmtNum(sc.days)} sub={t('score.of_days', { n: d.span })} />
          <StatCard label={t('score.per_day')} value={fmtNum(sc.per_day, 1)} tone={toneFor('completed', sc.per_day)} />
          <StatCard label={t('score.total_deliveries')} value={fmtNum(sc.orders)} />
          <StatCard label={t('score.attendance')} value={pct(sc.att)} tone={toneFor('attendance_rate', sc.att)} />
          <StatCard label={t('score.acceptance')} value={pct(sc.acc)} tone={toneFor('acceptance_rate', sc.acc)} />
          <StatCard label={t('score.missed_shifts')} value={fmtNum(sc.no_shows)} tone={sc.no_shows ? 'red' : 'none'} />
          <StatCard label={t('score.hours_worked')} value={fmtNum(sc.hours, 1)} />
          <StatCard label={t('score.lost_per_day')} value={fmtNum(sc.lost / Math.max(1, sc.days), 1)} tone={toneFor('lost_hours', sc.lost / Math.max(1, sc.days))} />
        </div>
        <Card title={t('score.why')} className="mb-4"><Why reasons={sc.reasons} /></Card>
      </>}
      <Card title={t('score.days_in_period')} pad={false}>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-zinc-50/80 text-xs text-zinc-500 dark:bg-zinc-800/30"><tr>{['perf.date', 'perf.m.completed', 'perf.m.notified', 'perf.m.actual_hours', 'perf.m.lost_hours', 'perf.m.attendance_rate', 'perf.m.acceptance_rate', 'perf.m.no_shows', ''].map((h) => <th key={h} className="px-3 py-2 text-start font-medium">{h && t(h)}</th>)}</tr></thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{d.days.map((x: any) => (
            <tr key={x.id}><td className="px-3 py-2 num">{x.work_date}</td>{['completed', 'notified', 'actual_hours', 'lost_hours', 'attendance_rate', 'acceptance_rate', 'no_shows'].map((k) => <td key={k} className="px-3 py-2"><Measure k={k} v={x[k]} /></td>)}
              <td className="px-3 py-2"><IconButton title={t('score.open_day')} onClick={() => nav(`/admin/performance/${x.id}`)}><Eye /></IconButton></td></tr>
          ))}</tbody>
        </table></div>
      </Card>
      <p className="mt-2 text-xs text-zinc-500">{t('score.one_week')}</p>
    </>
  );
}
