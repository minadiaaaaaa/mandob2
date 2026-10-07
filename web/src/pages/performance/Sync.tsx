import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Copy, Download, KeyRound, Puzzle, RefreshCw, Trash2 } from 'lucide-react';
import { del, download, get, patch, post } from '../../api';
import { useAuth } from '../../auth';
import { fmtDateTime, fmtNum, useI18n } from '../../i18n';
import { Alert, Badge, Button, Card, Checkbox, cx, Details, Field, Loading, PageHeader, SidePanel, Switch, useAction, useUi, type Tone } from '../../ui/kit';
import { DataTable, FilterBar, FilterDate, FilterSelect, useList } from '../../ui/table';

const RUN_TONE: Record<string, Tone> = { running: 'blue', succeeded: 'green', failed: 'red', skipped: 'amber', needs_sign_in: 'red' };
const SESSION_TONE: Record<string, Tone> = { none: 'grey', extension: 'green', working: 'green', expired: 'red' };
const iso = (d: Date) => new Intl.DateTimeFormat('en-CA').format(d);

// ======================================================================== 6.5 the sync screen
export function SyncScreen() {
  const { t } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const { toast } = useUi();
  const [d, setD] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<any>(null);
  const runs = useList('/sync/runs');
  const load = () => get('/sync').then(setD);
  useEffect(() => { load(); }, []);
  if (!d) return <Loading />;
  const syncNow = async (body: Record<string, unknown> = {}) => {
    setBusy(true);
    const r = await run(() => post('/sync/run', body));
    setBusy(false);
    if (r) { toast(r.nothing ? t('sync.nothing') : r.runs.map((x: any) => `${t(`sync.src.${x.source}`)} ${x.day}: ${t(`sync.o.${x.status}`)}`).join(' · '), r.nothing ? 'blue' : 'amber'); load(); runs.reload(); }
  };
  const sched = d.schedule;
  return (
    <>
      <PageHeader title={t('sync.title')} actions={<>
        <Button icon={<RefreshCw className="size-4" />} onClick={() => { load(); runs.reload(); }}>{t('common.refresh')}</Button>
        <Link to="/admin/sync/extension"><Button icon={<Puzzle className="size-4" />}>{t('sync.extension_route')}</Button></Link>
        {can('sync.run') && <Button variant="primary" loading={busy || d.running} onClick={() => syncNow()}>{busy ? t('sync.syncing') : t('sync.now')}</Button>}
      </>} />
      {!d.session.server_browser && <div className="mb-4"><Alert tone="amber" title={t('sync.no_browser_title')}>{t('sync.no_browser_text')} <Link className="font-medium underline" to="/admin/sync/extension">{t('sync.extension_route')}</Link></Alert></div>}
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card title={t('sync.google_session')}>
          <div className="flex items-center gap-2"><Badge tone={SESSION_TONE[d.session.state]}>{t(`sync.state.${d.session.state}`)}</Badge>
            {d.session.last_upload && <span className="text-xs text-zinc-500">{t('sync.last_upload')} <span className="num">{fmtDateTime(d.session.last_upload)}</span></span>}</div>
          <p className="mt-2 text-xs text-zinc-500">{t('sync.session_note')}</p>
        </Card>
        {can('live_riders.view') && <LiveSessionCard />}
      </div>
      <Card title={t('sync.schedule')} className="mb-4"><ScheduleForm sched={sched} onSaved={load} /></Card>
      <div className="mb-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {d.sources.map((s: any) => <SourceCard key={s.code} s={s} onChanged={load} onSync={(day) => syncNow({ source: s.code, day })} />)}
      </div>
      <Card title={t('sync.history')} pad={false}>
        <div className="p-3"><FilterBar list={runs} placeholder={t('sync.history_search')}>
          <FilterSelect list={runs} name="status" label={t('sync.status')} options={Object.keys(RUN_TONE).map((k) => ({ value: k, label: t(`sync.o.${k}`) }))} />
          <FilterSelect list={runs} name="source" label={t('sync.source')} options={d.sources.map((s: any) => ({ value: s.code, label: t(`sync.src.${s.code}`) }))} />
          <FilterDate list={runs} name="from" label={t('common.from')} /><FilterDate list={runs} name="to" label={t('common.to')} />
        </FilterBar></div>
        <DataTable list={runs} onRowClick={setOpen} columns={[
          { key: 'day', header: t('sync.report_day'), render: (r) => <div><span className="num">{r.report_day ?? '—'}</span><div className="text-xs text-zinc-500">{t(`sync.src.${r.source}`)}</div></div> },
          { key: 'status', header: t('sync.status'), render: (r) => <Badge tone={RUN_TONE[r.status]}>{t(`sync.o.${r.status}`)}</Badge> },
          { key: 'trigger', header: t('sync.trigger'), render: (r) => t(`sync.t.${r.trigger_type}`) },
          { key: 'started', header: t('sync.started'), render: (r) => <span className="num text-xs">{fmtDateTime(r.started_at)}</span> },
          { key: 'dur', header: t('sync.duration'), render: (r) => (r.seconds == null ? '—' : <span className="num">{r.seconds}s</span>) },
          { key: 'read', header: t('sync.read'), render: (r) => <span className="num">{r.rows_read ?? '—'}</span> },
          { key: 'added', header: t('sync.added'), render: (r) => <span className="num">{r.added ?? '—'}</span> },
          { key: 'replaced', header: t('sync.replaced'), render: (r) => <span className="num">{r.replaced ?? '—'}</span> },
          { key: 'by', header: t('sync.by'), render: (r) => r.user_name ?? '—' },
          { key: 'msg', header: t('sync.message'), render: (r) => <span className="text-xs">{r.message ? (t(`sync.m.${r.message}`) !== `sync.m.${r.message}` ? t(`sync.m.${r.message}`) : r.message) : '—'}</span> },
        ]} />
      </Card>
      <SidePanel open={!!open} onClose={() => setOpen(null)} title={t('sync.run_details')}>
        {open && <div className="space-y-3 text-sm">
          <Details cols={1} rows={[[t('sync.source'), t(`sync.src.${open.source}`)], [t('sync.report_day'), open.report_day], [t('sync.status'), <Badge tone={RUN_TONE[open.status]}>{t(`sync.o.${open.status}`)}</Badge>],
            [t('sync.started'), <span className="num">{fmtDateTime(open.started_at)}</span>], [t('sync.duration'), open.seconds != null && `${open.seconds}s`], [t('sync.message'), open.message]]} />
          {open.message === 'no_server_browser' && <Alert tone="amber">{t('sync.m.no_server_browser_long')}</Alert>}
        </div>}
      </SidePanel>
    </>
  );
}

function ScheduleForm({ sched, onSaved }: { sched: any; onSaved: () => void }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const [v, setV] = useState(sched);
  const edit = can('sync.update');
  return (
    <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <Switch checked={v.enabled} disabled={!edit} onChange={(x) => setV({ ...v, enabled: x })} label={<span>{t('sync.auto')} <Badge tone={v.enabled ? 'green' : 'grey'}>{v.enabled ? t('sync.on') : t('sync.off')}</Badge></span>} />
      <Field label={t('sync.reports_time')}><input type="time" className="input" disabled={!edit} value={v.reports_time} onChange={(e) => setV({ ...v, reports_time: e.target.value })} /></Field>
      <Field label={t('sync.photos_time')}><input type="time" className="input" disabled={!edit} value={v.photos_time} onChange={(e) => setV({ ...v, photos_time: e.target.value })} /></Field>
      <Field label={t('sync.max_days')}><input type="number" min={1} max={366} className="input" disabled={!edit} value={v.max_days} onChange={(e) => setV({ ...v, max_days: e.target.value })} /></Field>
      {edit && <Button variant="primary" onClick={async () => { if (await run(() => patch('/sync/schedule', v), t('sync.schedule_saved'))) onSaved(); }}>{t('sync.save_schedule')}</Button>}
    </div>
  );
}

function SourceCard({ s, onChanged, onSync }: { s: any; onChanged: () => void; onSync: (day: string) => void }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const [from, setFrom] = useState(s.sync_from ?? '');
  const [day, setDay] = useState('');
  const yesterday = iso(new Date(Date.now() - 86400000));
  const save = (body: Record<string, unknown>) => run(() => patch(`/sync/sources/${s.code}`, body), t('common.saved')).then((r) => r && onChanged());
  return (
    <Card title={t(`sync.src.${s.code}`)} actions={<><Badge tone={s.enabled ? 'green' : 'grey'}>{s.enabled ? t('sync.active') : t('sync.off')}</Badge>
      <Badge tone={s.pending ? 'amber' : 'green'}>{s.pending ? t('sync.n_pending', { n: s.pending }) : t('sync.nothing_pending')}</Badge></>}>
      <Details cols={1} rows={[[t('sync.feeds'), <Link className="text-brand hover:underline" to={s.feeds}>{s.feeds}</Link>], [t('sync.group'), t(`sync.g.${s.group}`)],
        [t('sync.report'), s.report_url ? <a className="text-brand hover:underline" href={s.report_url} target="_blank" rel="noreferrer">{t('sync.open_report')}</a> : '—'],
        [t('sync.last_day'), s.last_day && <span className="num">{s.last_day}</span>], [t('sync.next_day'), s.next_day && <span className="num">{s.next_day}</span>],
        [t('sync.last_run'), s.last_run ? <span><Badge tone={RUN_TONE[s.last_run.status]}>{t(`sync.o.${s.last_run.status}`)}</Badge> <span className="num text-xs">{fmtDateTime(s.last_run.started_at)}</span></span> : t('sync.never'), true]]} />
      {can('sync.update') && <div className="mt-3 space-y-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
        <div className="flex items-end gap-2"><Field label={t('sync.sync_from')} className="flex-1"><input type="date" className="input" max={yesterday} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Button size="sm" onClick={() => save({ sync_from: from })}>{t('common.save')}</Button></div>
        <div className="flex flex-wrap gap-3">
          <Checkbox checked={s.enabled} onChange={(v) => save({ enabled: v })} label={t('sync.enable')} />
          <Checkbox checked={s.create_riders} onChange={(v) => save({ create_riders: v })} label={t('sync.create_riders')} />
        </div>
        <Field label={t('sync.report_url')}><input className="input" dir="ltr" defaultValue={s.report_url ?? ''} onBlur={(e) => e.target.value !== (s.report_url ?? '') && save({ report_url: e.target.value })} /></Field>
      </div>}
      {can('sync.run') && <div className="mt-3 flex items-end gap-2"><Field label={t('sync.specific_day')} className="flex-1"><input type="date" className="input" max={yesterday} value={day} onChange={(e) => setDay(e.target.value)} /></Field>
        <Button size="sm" disabled={!day} onClick={() => onSync(day)}>{t('sync.sync_day')}</Button></div>}
    </Card>
  );
}

function LiveSessionCard() {
  const { t } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const [d, setD] = useState<any>(null);
  const [v, setV] = useState<any>(null);
  const load = () => get('/live/session').then((x) => { setD(x); setV({ enabled: x.settings.enabled, cities: x.settings.cities, interval: x.settings.interval, radius_m: x.settings.radius, min_stop_min: x.settings.min_stop, keep_days: x.settings.keep_days }); });
  useEffect(() => { load(); }, []);
  if (!d || !v) return null;
  const manage = can('live_riders.manage');
  const num = (k: string, label: string, min: number, max: number) => <Field label={label}><input type="number" min={min} max={max} className="input" disabled={!manage} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></Field>;
  return (
    <Card title={t('live.session_title')}>
      <div className="flex items-center gap-2"><Badge tone={SESSION_TONE[d.state]}>{t(`live.st.${d.state}`)}</Badge></div>
      <Details cols={2} rows={[[t('live.last_read'), d.last_read && <span className="num">{fmtDateTime(d.last_read)}</span>, true], [t('live.today_points'), fmtNum(d.today_points)], [t('live.riders_last'), fmtNum(d.riders)]]} />
      <p className="mt-2 text-xs text-zinc-500">{t('live.session_note')}</p>
      <div className="mt-3 grid gap-2 border-t border-zinc-100 pt-3 sm:grid-cols-2 dark:border-zinc-800">
        <Switch checked={!!v.enabled} disabled={!manage} onChange={(x) => setV({ ...v, enabled: x })} label={t('live.read_auto')} />
        <Field label={t('live.cities')}><input className="input" dir="ltr" disabled={!manage} value={v.cities} onChange={(e) => setV({ ...v, cities: e.target.value })} /></Field>
        {num('interval', t('live.interval'), 30, 600)}{num('radius_m', t('live.radius'), 50, 2000)}{num('min_stop_min', t('live.min_stop'), 5, 600)}{num('keep_days', t('live.keep'), 7, 730)}
      </div>
      {manage && <div className="mt-3 flex gap-2"><Button variant="primary" size="sm" onClick={async () => { if (await run(() => patch('/live/settings', v), t('common.saved'))) load(); }}>{t('live.save_settings')}</Button>
        <Button size="sm" variant="ghost" className="text-red-600" onClick={async () => { if (await run(() => del('/live/session'))) load(); }}>{t('live.remove_session')}</Button></div>}
    </Card>
  );
}

// ======================================================================== 6.6 the browser extension
export function ExtensionPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const { confirm, toast } = useUi();
  const [token, setToken] = useState<string | null>(null);
  const [issued, setIssued] = useState(false);
  useEffect(() => { get('/sync').then((d) => setIssued(d.session.token)).catch(() => {}); }, []);
  const address = `${location.origin}/api/sync/ingest`;
  const copy = (s: string) => navigator.clipboard.writeText(s).then(() => toast(t('files.copied')));
  return (
    <>
      <PageHeader title={t('ext.title')} subtitle={t('ext.purpose')} back="/admin/sync" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={t('ext.step1')}>
          <Button variant="primary" icon={<Download className="size-4" />} onClick={() => run(() => download('/sync/extension.zip'))}>{t('ext.download')}</Button>
          <ol className="mt-3 list-decimal space-y-1 ps-5 text-sm text-zinc-600 dark:text-zinc-300">{[1, 2, 3, 4, 5].map((n) => <li key={n}>{t(`ext.install.${n}`)}</li>)}</ol>
        </Card>
        <Card title={t('ext.step2')}>
          <Field label={t('ext.address')}><div className="flex gap-1"><input className="input" dir="ltr" readOnly value={address} /><Button size="sm" icon={<Copy className="size-3.5" />} onClick={() => copy(address)} /></div></Field>
          {can('sync.manage_session') ? <div className="mt-3 space-y-2">
            <Button icon={<KeyRound className="size-4" />} onClick={async () => {
              if (issued && !(await confirm({ title: t('ext.reissue_q'), body: t('ext.reissue_body'), tone: 'warn' }))) return;
              const r = await run(() => post('/sync/token')); if (r) { setToken(r.token); setIssued(true); }
            }}>{issued ? t('ext.issue_new') : t('ext.issue')}</Button>
            {token && <Alert tone="amber" title={t('ext.copy_now')}><div className="mt-1 flex gap-1"><input className="input text-xs" dir="ltr" readOnly value={token} /><Button size="sm" icon={<Copy className="size-3.5" />} onClick={() => copy(token)} /></div></Alert>}
            {issued && <Button variant="ghost" className="text-red-600" icon={<Trash2 className="size-4" />} onClick={async () => {
              if (!(await confirm({ title: t('ext.revoke_q'), body: t('ext.revoke_body') }))) return;
              if (await run(() => del('/sync/token'), t('common.saved'))) { setIssued(false); setToken(null); }
            }}>{t('ext.revoke')}</Button>}
          </div> : <p className="mt-3 text-xs text-zinc-500">{t('ext.no_manage')}</p>}
        </Card>
        <Card title={t('ext.step3')}>
          <ol className="list-decimal space-y-1 ps-5 text-sm text-zinc-600 dark:text-zinc-300">{[1, 2, 3, 4, 5].map((n) => <li key={n}>{t(`ext.use.${n}`)}</li>)}</ol>
          <p className="mt-3 text-xs text-zinc-500">{t('ext.privacy')}</p>
        </Card>
      </div>
    </>
  );
}

// ======================================================================== 6.7 the top-bar button
export function SyncButton() {
  const { t } = useI18n();
  const { can } = useAuth();
  const [d, setD] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const load = () => get('/sync/status').then(setD).catch(() => {});
  useEffect(() => { if (!can('sync.view')) return; load(); const h = setInterval(load, 5 * 60000); return () => clearInterval(h); }, [can]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    load();
    const h = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!can('sync.view') || !d) return null;
  const needsSignIn = d.session.state === 'none' && d.pending > 0;
  return (
    <div className="relative" ref={box}>
      <button onClick={() => setOpen(!open)} title={t('sync.title')} className="relative rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
        <RefreshCw className={cx('size-4', (d.running || busy) && 'animate-spin')} />
        {needsSignIn ? <AlertTriangle className="absolute -end-0.5 -top-0.5 size-3.5 text-red-600" /> : d.pending > 0 && <span className="absolute -end-0.5 -top-0.5 min-w-4 rounded-full bg-amber-400 px-1 text-center text-[10px] font-semibold leading-4 text-amber-950 num">{d.pending > 99 ? '99+' : d.pending}</span>}
      </button>
      {open && (
        <div className="pop-in absolute end-0 mt-1 w-72 rounded-xl border border-zinc-200 bg-white p-3 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <Details cols={1} rows={[[t('sync.google_session'), <Badge tone={SESSION_TONE[d.session.state]}>{t(`sync.state.${d.session.state}`)}</Badge>],
            [t('sync.last_day'), d.last_day ?? '—', true], [t('sync.last_run'), d.last_run ? <span><Badge tone={RUN_TONE[d.last_run.status]}>{t(`sync.o.${d.last_run.status}`)}</Badge> <span className="num text-xs">{fmtDateTime(d.last_run.started_at)}</span></span> : t('sync.never'), true]]} />
          {result && <div className="mt-2"><Alert tone="amber">{result}</Alert></div>}
          <div className="mt-3 flex gap-2">
            {can('sync.run') && <Button size="sm" variant="primary" loading={busy} onClick={async () => {
              setBusy(true);
              try { const r = await post('/sync/run', {}); setResult(r.nothing ? t('sync.nothing') : t('sync.needs_sign_in_hint')); } catch { setResult(t('err.server_error')); }
              setBusy(false); load();
            }}>{t('sync.now')}</Button>}
            <Link to="/admin/sync" onClick={() => setOpen(false)}><Button size="sm">{t('sync.screen')}</Button></Link>
          </div>
        </div>
      )}
    </div>
  );
}
