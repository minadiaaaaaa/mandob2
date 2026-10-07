import { useEffect, useRef, useState } from 'react';
import { Copy, DatabaseBackup, Download, Play, RotateCcw, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { del, download, get, post, put } from '../../api';
import { useAuth } from '../../auth';
import { fmtBytes, fmtDateTime, fmtNum, useI18n } from '../../i18n';
import { Alert, Badge, Button, Card, Checkbox, Details, Field, Loading, PageHeader, SidePanel, Switch, useAction, useErrorText, useUi, type Tone } from '../../ui/kit';
import { DataTable, FilterBar, FilterDate, FilterSelect, useList } from '../../ui/table';
import { ExportButton } from '../../ui/common';

// ======================================================================== 11.7 system errors
const LVL: Record<string, Tone> = { info: 'blue', warning: 'amber', error: 'red', critical: 'red' };
export function SystemErrors() {
  const { t } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const { confirm, toast } = useUi();
  const list = useList('/logs/errors');
  const [open, setOpen] = useState<any>(null);
  return (
    <>
      <PageHeader title={t('err_log.title')} actions={can('logs.export') && <ExportButton path="/logs/errors/export" query={list.query} label={t('common.export_csv')} />} />
      <FilterBar list={list}>
        <FilterSelect list={list} name="level" label={t('err_log.level')} options={Object.keys(LVL).map((k) => ({ value: k, label: t(`err_log.l.${k}`) }))} />
        <FilterSelect list={list} name="method" label={t('err_log.method')} options={['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].map((m) => ({ value: m, label: m }))} />
        <FilterDate list={list} name="from" label={t('common.from_date')} /><FilterDate list={list} name="to" label={t('common.to_date')} />
      </FilterBar>
      <DataTable list={list} onRowClick={setOpen} emptyText={t('err_log.none')} columns={[
        { key: 'time', header: t('err_log.time'), render: (r) => <span className="num text-xs">{fmtDateTime(r.created_at)}</span> },
        { key: 'level', header: t('err_log.level'), render: (r) => <Badge tone={LVL[r.level]}>{t(`err_log.l.${r.level}`)}</Badge> },
        { key: 'code', header: t('err_log.code'), render: (r) => <code className="text-xs" dir="ltr">{r.code}</code> },
        { key: 'module', header: t('err_log.module'), render: (r) => r.module },
        { key: 'message', header: t('err_log.message'), render: (r) => <span className="line-clamp-2 max-w-96 text-xs" dir="ltr">{r.message}</span> },
        { key: 'route', header: t('err_log.route'), render: (r) => <code className="text-xs" dir="ltr">{r.method} {r.route}</code> },
        { key: 'user', header: t('err_log.user'), render: (r) => r.user_name ?? '—' },
      ]} />
      <SidePanel open={!!open} onClose={() => setOpen(null)} title={t('err_log.details')} footer={open && <>
        <Button icon={<Copy className="size-4" />} onClick={() => navigator.clipboard.writeText(JSON.stringify(open, null, 2)).then(() => toast(t('files.copied')))}>{t('err_log.copy')}</Button>
        {can('logs.delete') && <Button variant="danger" onClick={async () => { if (!(await confirm({ title: t('err_log.delete_q'), confirm: t('err_log.yes_delete') }))) return; if (await run(() => del(`/logs/errors/${open.id}`), t('common.deleted'))) { setOpen(null); list.reload(); } }}>{t('err_log.delete')}</Button>}</>}>
        {open && <div className="space-y-3 text-sm">
          <Details cols={1} rows={[[t('err_log.time'), fmtDateTime(open.created_at)], [t('err_log.level'), t(`err_log.l.${open.level}`)], [t('err_log.code'), open.code], [t('err_log.module'), open.module],
            [t('err_log.message'), <span dir="ltr">{open.message}</span>], [t('err_log.route'), <span dir="ltr">{open.method} {open.route}</span>], [t('err_log.user'), open.user_name], [t('err_log.request'), open.request_id]]} />
          <div><div className="mb-1 text-xs text-zinc-500">{t('err_log.stack')}</div><pre className="max-h-96 overflow-auto rounded-lg bg-zinc-950 p-3 text-[11px] text-zinc-100" dir="ltr">{open.stack || '—'}</pre></div>
        </div>}
      </SidePanel>
    </>
  );
}

// ======================================================================== 11.8 scheduled jobs
const OUT: Record<string, Tone> = { running: 'blue', completed: 'green', failed: 'red' };
export function CronJobs() {
  const { t } = useI18n();
  const { can } = useAuth();
  const { toast } = useUi();
  const errText = useErrorText();
  const [jobs, setJobs] = useState<any[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<any>(null);
  const runs = useList('/cron-jobs/runs');
  const load = () => get('/cron-jobs').then(setJobs);
  useEffect(() => { load(); }, []);
  if (!jobs) return <Loading />;
  return (
    <>
      <PageHeader title={t('cron.title')} actions={can('cron_jobs.export') && <ExportButton path="/cron-jobs/runs/export" query={runs.query} label={t('common.export_csv')} />} />
      <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {jobs.map((j) => (
          <Card key={j.name} title={<code dir="ltr">{j.name}</code>} subtitle={t(`cron.d.${j.name}`)} actions={<>
            <Badge tone={j.enabled ? 'green' : 'grey'}>{j.enabled ? t('cron.enabled') : t('cron.disabled')}</Badge>
            <Badge tone={j.next ? 'blue' : 'grey'}>{j.next ? t('cron.scheduled') : t('cron.not_scheduled')}</Badge>{j.running && <Badge tone="amber">{t('cron.running_now')}</Badge>}</>}>
            <Details cols={2} rows={[[t('cron.expr'), <code dir="ltr">{j.expr}</code>], [t('cron.key'), <code className="text-xs" dir="ltr">{j.key}</code>],
              [t('cron.next'), j.next && <span className="num text-xs">{fmtDateTime(j.next)}</span>, true],
              [t('cron.last'), j.last ? <span><Badge tone={OUT[j.last.outcome]}>{t(`cron.o.${j.last.outcome}`)}</Badge> <span className="num text-xs">{fmtDateTime(j.last.started_at)}</span></span> : '—', true],
              ...(j.last ? [[t('cron.counters'), <span className="num text-xs">{j.last.records} · {j.last.notifications} · {j.last.emails}</span>] as [string, React.ReactNode]] : [])]} />
            {can('cron_jobs.run') && <Button size="sm" className="mt-3" icon={<Play className="size-3.5" />} loading={busy === j.name} onClick={async () => {
              setBusy(j.name);
              try { const r = await post(`/cron-jobs/${j.name}/run`); toast(r.outcome === 'completed' ? t('cron.done') : t('cron.failed_x', { e: r.error }), r.outcome === 'completed' ? 'green' : 'red'); }
              catch (e) { toast(errText(e), 'red'); }
              setBusy(null); load(); runs.reload();
            }}>{busy === j.name ? t('cron.running') : t('cron.run_now')}</Button>}
          </Card>
        ))}
      </div>
      <Card title={t('cron.history')} pad={false}>
        <div className="p-3"><FilterBar list={runs} placeholder={t('cron.search')}>
          <FilterSelect list={runs} name="job" label={t('cron.job')} options={jobs.map((j) => ({ value: j.name, label: j.name }))} />
          <FilterSelect list={runs} name="outcome" label={t('cron.outcome')} options={Object.keys(OUT).map((k) => ({ value: k, label: t(`cron.o.${k}`) }))} />
          <FilterDate list={runs} name="from" label={t('common.from_date')} /><FilterDate list={runs} name="to" label={t('common.to_date')} />
        </FilterBar></div>
        <DataTable list={runs} onRowClick={setOpen} columns={[
          { key: 'started', header: t('cron.started'), render: (r) => <span className="num text-xs">{fmtDateTime(r.started_at)}</span> },
          { key: 'job', header: t('cron.job'), render: (r) => <code className="text-xs" dir="ltr">{r.job}</code> },
          { key: 'outcome', header: t('cron.outcome'), render: (r) => <Badge tone={OUT[r.outcome]}>{t(`cron.o.${r.outcome}`)}</Badge> },
          { key: 'dur', header: t('cron.duration'), render: (r) => (r.seconds == null ? '—' : <span className="num">{r.seconds}s</span>) },
          { key: 'records', header: t('cron.records'), render: (r) => <span className="num">{r.records}</span> },
          { key: 'notes', header: t('cron.notifications'), render: (r) => <span className="num">{r.notifications}</span> },
          { key: 'emails', header: t('cron.emails'), render: (r) => <span className="num">{r.emails}</span> },
          { key: 'error', header: t('cron.error'), render: (r) => <span className="text-xs text-red-600">{r.error ?? ''}</span> },
        ]} />
      </Card>
      <SidePanel open={!!open} onClose={() => setOpen(null)} title={t('cron.run_details')}>
        {open && <div className="space-y-3 text-sm"><Details cols={1} rows={[[t('cron.job'), open.job], [t('cron.outcome'), t(`cron.o.${open.outcome}`)], [t('cron.started'), fmtDateTime(open.started_at)],
          [t('cron.finished'), fmtDateTime(open.finished_at)], [t('cron.records'), String(open.records), true], [t('cron.notifications'), String(open.notifications), true], [t('cron.emails'), String(open.emails), true], [t('cron.error'), open.error]]} />
          <div><div className="mb-1 text-xs text-zinc-500">{t('cron.recorded')}</div><pre className="rounded-lg bg-zinc-50 p-2 text-xs dark:bg-zinc-800" dir="ltr">{JSON.stringify(open.details, null, 2)}</pre></div></div>}
      </SidePanel>
    </>
  );
}

// ======================================================================== 11.9 backups
const BST: Record<string, Tone> = { running: 'blue', completed: 'green', failed: 'red' };
export function Backups() {
  const { t } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const { confirm, toast } = useUi();
  const [d, setD] = useState<any>(null);
  const [type, setType] = useState('full');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [restore, setRestore] = useState<any>(null);
  const [pct, setPct] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const load = () => get('/backups').then(setD);
  useEffect(() => { load(); }, []);
  if (!d) return <Loading />;
  const uploadFile = (f: File) => {
    // XHR shows the upload percentage
    const x = new XMLHttpRequest(); const fd = new FormData(); fd.append('file', f);
    x.upload.onprogress = (e) => setPct(Math.round((e.loaded / e.total) * 100));
    x.onload = () => { setPct(null); const r = JSON.parse(x.responseText || '{}'); if (x.status >= 400) toast(t(`err.${r.error}`), 'red'); else { toast(r.other_key ? t('bk.other_key') : t('bk.uploaded'), r.other_key ? 'amber' : 'green'); load(); } };
    x.onerror = () => { setPct(null); toast(t('err.network'), 'red'); };
    x.open('POST', '/api/backups/upload'); x.send(fd);
  };
  return (
    <>
      <PageHeader title={t('bk.title')} />
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Schedule s={d.schedule} onSaved={load} />
        {can('backups.create') && <Card title={t('bk.create')}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('bk.type')}><select className="input" value={type} onChange={(e) => setType(e.target.value)}>{['full', 'db', 'files'].map((x) => <option key={x} value={x}>{t(`bk.t.${x}`)}</option>)}</select></Field>
            <Field label={t('bk.note')}><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" icon={<DatabaseBackup className="size-4" />} loading={busy} onClick={async () => { setBusy(true); if (await run(() => post('/backups', { type, note }), t('bk.created'))) { setNote(''); load(); } setBusy(false); }}>{busy ? t('bk.creating') : t('bk.create_btn')}</Button>
            <Button icon={<Upload className="size-4" />} onClick={() => input.current?.click()}>{pct != null ? `${pct}%` : t('bk.upload')}</Button>
            <input ref={input} type="file" accept=".zip" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadFile(f); }} />
          </div>
          <p className="mt-2 text-xs text-zinc-500">{t('bk.key_note', { fp: d.key_fp })}</p>
        </Card>}
      </div>
      {d.orphans.length > 0 && <Card title={t('bk.orphans')} className="mb-4"><ul className="space-y-1 text-sm">{d.orphans.map((o: any) => (
        <li key={o.name} className="flex items-center gap-2"><code dir="ltr" className="flex-1 text-xs">{o.name}</code><span className="num text-xs text-zinc-500">{fmtBytes(o.size)}</span>
          {can('backups.create') && <Button size="sm" onClick={async () => { if (await run(() => post('/backups/register', { name: o.name }), t('common.saved'))) load(); }}>{t('bk.register')}</Button>}</li>))}</ul></Card>}
      <h2 className="mb-2 text-sm font-semibold text-zinc-500">{t('bk.available')}</h2>
      <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {d.rows.length === 0 && <p className="text-sm text-zinc-500">{t('table.no_records')}</p>}
        {d.rows.map((b: any) => (
          <Card key={b.id} title={<code className="text-xs" dir="ltr">{b.file_name}</code>} actions={<><Badge tone={BST[b.status]}>{t(`bk.s.${b.status}`)}</Badge><Badge tone={b.encrypted ? 'green' : 'amber'}>{b.encrypted ? t('bk.encrypted') : t('bk.not_encrypted')}</Badge></>}>
            <div className="mb-2 flex flex-wrap gap-1 text-xs"><Badge tone="grey">{t(`bk.t.${b.type}`)}</Badge><Badge tone="grey">{t(`bk.k.${b.kind}`)}</Badge><span className="num text-zinc-500">{fmtDateTime(b.created_at)}</span></div>
            <div className="grid grid-cols-4 gap-2 text-center text-xs">{[['tables_n', 'bk.tables'], ['rows_n', 'bk.rows'], ['files_n', 'bk.files']].map(([k, l]) => <div key={k}><div className="font-semibold num">{fmtNum(b[k])}</div><div className="text-zinc-500">{t(l)}</div></div>)}
              <div><div className="font-semibold num">{b.size ? fmtBytes(b.size) : '—'}</div><div className="text-zinc-500">{t('bk.size')}</div></div></div>
            {b.note && <p className="mt-2 text-xs text-zinc-500">{b.note}</p>}
            {b.missing_files > 0 && <div className="mt-2"><Alert tone="amber">{t('bk.missing', { n: b.missing_files })}</Alert></div>}
            {b.other_key && <div className="mt-2"><Alert tone="amber">{t('bk.other_key')}</Alert></div>}
            {!b.on_disk && <div className="mt-2"><Alert tone="red">{t('bk.not_on_disk')}</Alert></div>}
            {b.last_restore && <p className="mt-2 text-xs text-zinc-500">{t('bk.last_restore')}: {b.last_restore.split('|')[0]} · <span className="num">{fmtDateTime(b.last_restore.split('|')[1])}</span></p>}
            <p className="mt-1 truncate text-[10px] text-zinc-400" dir="ltr" title={b.checksum}>{b.checksum}</p>
            {b.on_disk && <div className="mt-3 flex flex-wrap gap-1">
              {can('backups.verify') && <Button size="sm" icon={<ShieldCheck className="size-3.5" />} onClick={async () => { const r = await run(() => post(`/backups/${b.id}/verify`)); if (r) toast(r.ok ? t('bk.checksum_ok') : t('bk.checksum_bad'), r.ok ? 'green' : 'red'); }}>{t('bk.verify')}</Button>}
              {can('backups.download') && <Button size="sm" icon={<Download className="size-3.5" />} onClick={() => run(() => download(`/backups/${b.id}/download`))}>{t('bk.download')}</Button>}
              {can('backups.restore') && b.status === 'completed' && <Button size="sm" variant="warn" icon={<RotateCcw className="size-3.5" />} onClick={() => setRestore(b)}>{t('bk.restore')}</Button>}
            </div>}
            {can('backups.delete') && <Button size="sm" variant="ghost" className="mt-1 text-red-600" icon={<Trash2 className="size-3.5" />} onClick={async () => {
              if (!(await confirm({ title: t('bk.delete_q', { name: b.file_name }), confirm: t('bk.yes_delete') }))) return; if (await run(() => del(`/backups/${b.id}`), t('common.deleted'))) load(); }}>{t('common.delete')}</Button>}
          </Card>
        ))}
      </div>
      <Card title={t('bk.restore_history')} pad={false}>
        <table className="w-full text-sm"><thead className="bg-zinc-50/80 text-xs text-zinc-500 dark:bg-zinc-800/30"><tr>{['when', 'archive', 'status', 'by', 'details'].map((k) => <th key={k} className="px-3 py-2 text-start font-medium">{t(`bk.h.${k}`)}</th>)}</tr></thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{d.restores.length === 0 ? <tr><td colSpan={5} className="p-6 text-center text-zinc-500">{t('table.no_records')}</td></tr> : d.restores.map((r: any) => (
            <tr key={r.id}><td className="px-3 py-2 num text-xs">{fmtDateTime(r.created_at)}</td><td className="px-3 py-2"><code className="text-xs" dir="ltr">{r.file_name}</code></td>
              <td className="px-3 py-2"><Badge tone={BST[r.status]}>{t(`bk.s.${r.status}`)}</Badge></td><td className="px-3 py-2">{r.user_name ?? '—'}</td><td className="px-3 py-2 text-xs" dir="ltr">{r.details}</td></tr>))}</tbody></table>
      </Card>
      {restore && <RestorePanel b={restore} onClose={() => setRestore(null)} onDone={() => { setRestore(null); load(); }} />}
    </>
  );
}
function Schedule({ s, onSaved }: { s: any; onSaved: () => void }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const daily = /^(\d+) (\d+) \* \* \*$/.exec(s.cron);
  const [v, setV] = useState({ enabled: s.enabled, type: s.type, time: daily ? `${daily[2].padStart(2, '0')}:${daily[1].padStart(2, '0')}` : '', cron: daily ? '' : s.cron, keep: s.keep });
  const edit = can('backups.settings');
  return (
    <Card title={t('bk.auto')} actions={<Badge tone={s.enabled ? 'green' : 'grey'}>{s.enabled ? t('sync.on') : t('sync.off')}</Badge>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Switch checked={v.enabled} disabled={!edit} onChange={(x) => setV({ ...v, enabled: x })} label={t('bk.auto_switch')} /></div>
        <Field label={t('bk.type')}><select className="input" disabled={!edit} value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })}>{['full', 'db', 'files'].map((x) => <option key={x} value={x}>{t(`bk.t.${x}`)}</option>)}</select></Field>
        <Field label={t('bk.daily_time')}><input type="time" className="input" disabled={!edit} value={v.time} onChange={(e) => setV({ ...v, time: e.target.value, cron: '' })} /></Field>
        <Field label={t('bk.cron')}><input className="input" dir="ltr" disabled={!edit} value={v.cron} placeholder="0 3 * * *" onChange={(e) => setV({ ...v, cron: e.target.value })} /></Field>
        <Field label={t('bk.keep')}><input type="number" min={1} max={365} className="input" disabled={!edit} value={v.keep} onChange={(e) => setV({ ...v, keep: e.target.value })} /></Field>
      </div>
      <p className="mt-2 text-xs text-zinc-500">{s.next ? <>{t('cron.next')}: <span className="num">{fmtDateTime(s.next)}</span></> : t('bk.no_next')}</p>
      {edit && <Button variant="primary" size="sm" className="mt-3" onClick={async () => { if (await run(() => put('/backups/schedule', { ...v, cron: v.cron || undefined, time: v.cron ? undefined : v.time || undefined }), t('bk.schedule_saved'))) onSaved(); }}>{t('sync.save_schedule')}</Button>}
    </Card>
  );
}
function RestorePanel({ b, onClose, onDone }: { b: any; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const errText = useErrorText();
  const [c, setC] = useState<any>(null);
  const [replace, setReplace] = useState(false);
  const [override, setOverride] = useState(false);
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { get(`/backups/${b.id}/contents`).then(setC).catch(() => setC({ ok: false })); }, [b.id]);
  return (
    <SidePanel open onClose={onClose} title={t('bk.restore_title')} footer={!result && <><Button onClick={onClose}>{t('common.cancel')}</Button>
      <Button variant="danger" disabled={word !== 'RESTORE' || busy} loading={busy} onClick={async () => {
        setBusy(true); setErr(null);
        try { setResult(await post(`/backups/${b.id}/restore`, { confirm: word, replace_files: replace, override_checksum: override })); } catch (e: any) { setErr(errText(e)); if (e?.code === 'checksum_mismatch') setC({ ...c, mismatch: true }); }
        setBusy(false);
      }}>{t('bk.run_restore')}</Button></>}>
      <div className="space-y-4 text-sm">
        <Alert tone="red" title={t('bk.restore_warn_title')}>{t('bk.restore_warn')}</Alert>
        {!c ? <Loading /> : c.ok ? <Details cols={2} rows={[[t('bk.taken_on'), <span className="num">{fmtDateTime(c.manifest.created_at)}</span>], [t('bk.type'), t(`bk.t.${c.manifest.type}`)],
          [t('bk.tables'), fmtNum(c.manifest.tables?.length)], [t('bk.rows'), fmtNum(c.manifest.rows)], [t('bk.files'), fmtNum(c.manifest.files)]]} /> : <Alert tone="amber">{t('bk.other_key')}</Alert>}
        <Checkbox checked={replace} onChange={setReplace} label={t('bk.replace_files')} />
        {c?.mismatch && <Checkbox checked={override} onChange={setOverride} label={t('bk.override_checksum')} />}
        <Field label={t('bk.confirm_word')}><input className="input font-mono" dir="ltr" value={word} onChange={(e) => setWord(e.target.value)} /></Field>
        {busy && <Alert tone="blue">{t('bk.restoring')}</Alert>}
        {err && <Alert tone="red">{err}</Alert>}
        {result && <Alert tone="green" title={t('bk.restore_done')}>{t('bk.restore_result', { tables: result.tables, files: result.files, seconds: result.seconds, safety: result.safety })}
          {!result.session_kept && <div className="mt-1">{t('bk.sign_in_again')}</div>}<div className="mt-2"><Button size="sm" onClick={() => (result.session_kept ? onDone() : location.assign('/admin/login'))}>{t('common.ok')}</Button></div></Alert>}
      </div>
    </SidePanel>
  );
}
