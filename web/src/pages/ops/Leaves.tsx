import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Ban, Check, Download, FileText, Pencil, Plus, Printer, RefreshCw, Settings, Trash2, Upload, X } from 'lucide-react';
import { del, download, get, patch, post } from '../../api';
import { useAuth } from '../../auth';
import { fmtDate, fmtDateTime, fmtNum, useI18n } from '../../i18n';
import { Alert, Badge, Button, By, Card, Details, Field, IconButton, Loading, PageHeader, StatCard, StatGrid, Switch, toneIf, useAction, useUi, type Tone } from '../../ui/kit';
import { Grid, RiderInput, SaveBar, SelectInput, TextArea, TextInput, useForm } from '../../ui/forms';
import { DataTable, FilterBar, FilterDate, FilterSelect, useList, type Column } from '../../ui/table';
import { ExportButton } from '../../ui/common';

export const LEAVE_TYPES = ['emergency', 'annual', 'sick', 'unpaid', 'other'];
export const LEAVE_TONE: Record<string, Tone> = { pending: 'amber', approved: 'green', rejected: 'red', cancelled: 'grey' };
const todayStr = () => new Intl.DateTimeFormat('en-CA').format(new Date());
const daysOf = (a: string, b: string) => (a && b && b >= a ? Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1 : a ? 1 : 0);

// The letter on A4, shown inside the page. `html` for an unsaved preview, `src` for a saved letter.
function LetterFrame({ html, src, frameRef }: { html?: string; src?: string; frameRef?: React.RefObject<HTMLIFrameElement | null> }) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100 p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <iframe ref={frameRef} title="letter" srcDoc={html} src={src} className="aspect-[210/297] w-full rounded bg-white shadow-md" />
    </div>
  );
}

// ======================================================================== list
export function LeavesList() {
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const list = useList('/leaves');
  const s = list.stats ?? {};
  const toggle = (k: string, v: string) => list.set(k, list.query[k] === v ? null : v);
  const columns: Column<any>[] = [
    { key: 'letter', header: t('leaves.letter_no'), sort: 'letter', render: (r) => <span className="num font-medium">{r.letter_no}</span> },
    { key: 'rider', header: t('leaves.rider'), sort: 'rider', render: (r) => <div><Link to={`/admin/riders/${r.rider_id}`} className="font-medium hover:text-brand">{r.full_name}</Link><div className="text-xs text-zinc-500"><span className="num">#{r.rider_id}</span>{r.company_name && ` · ${r.company_name}`}</div></div> },
    { key: 'type', header: t('leaves.type'), render: (r) => t(`leaves.t.${r.leave_type}`) },
    { key: 'date', header: t('leaves.dates'), sort: 'date', render: (r) => <div className="num"><div>{r.start_date === r.end_date ? r.start_date : `${r.start_date} → ${r.end_date}`}</div><div className="text-xs text-zinc-500">{t('leaves.n_days', { n: r.days })}</div></div> },
    { key: 'reason', header: t('leaves.reason'), render: (r) => <span className="line-clamp-2 max-w-60" title={r.reason}>{r.reason}</span> },
    { key: 'status', header: t('leaves.status'), sort: 'status', render: (r) => <div><Badge tone={LEAVE_TONE[r.status]}>{t(`leaves.s.${r.status}`)}</Badge>{r.answered_at && <div className="mt-0.5 text-xs text-zinc-500"><By name={r.answered_by_name} at={fmtDate(r.answered_at)} /></div>}</div> },
    { key: 'created', header: t('leaves.created'), sort: 'created', render: (r) => <div><div className="num text-xs">{fmtDateTime(r.created_at)}</div><div className="text-xs text-zinc-500">{r.source === 'rider' ? <Badge tone="blue">{t('leaves.from_rider')}</Badge> : r.created_by_name}</div></div> },
  ];
  return (
    <>
      <PageHeader title={t('leaves.title')} actions={<>
        {can('leaves.settings', 'leaves.stamp') && <Link to="/admin/leaves/settings"><Button icon={<Settings className="size-4" />}>{t('leaves.letter_settings')}</Button></Link>}
        {can('leaves.create') && <Link to="/admin/leaves/new"><Button variant="primary" icon={<Plus className="size-4" />}>{t('leaves.new')}</Button></Link>}
      </>} />
      <StatGrid>
        <StatCard label={t('leaves.c.awaiting')} value={fmtNum(s.awaiting)} tone={toneIf(s.awaiting, 'amber')} onClick={() => toggle('status', 'pending')} active={list.query.status === 'pending'} />
        <StatCard label={t('leaves.c.rider_pending')} value={fmtNum(s.rider_pending)} tone={toneIf(s.rider_pending, 'blue')} onClick={() => list.setMany({ status: 'pending', source: list.query.source === 'rider' ? null : 'rider' })} active={list.query.source === 'rider'} />
        <StatCard label={t('leaves.c.on_leave')} value={fmtNum(s.on_leave)} tone="blue" />
        <StatCard label={t('leaves.c.starting')} value={fmtNum(s.starting_soon)} />
        <StatCard label={t('leaves.c.approved')} value={fmtNum(s.approved)} tone="green" onClick={() => toggle('status', 'approved')} active={list.query.status === 'approved'} />
        <StatCard label={t('leaves.c.rejected')} value={fmtNum(s.rejected)} tone={toneIf(s.rejected, 'red')} onClick={() => toggle('status', 'rejected')} active={list.query.status === 'rejected'} />
      </StatGrid>
      <FilterBar list={list} placeholder={t('leaves.search_hint')} actions={can('leaves.export') && <ExportButton path="/leaves/export" query={list.query} label={t('common.export_csv')} />}>
        <FilterSelect list={list} name="status" label={t('leaves.status')} options={Object.keys(LEAVE_TONE).map((k) => ({ value: k, label: t(`leaves.s.${k}`) }))} />
        <FilterSelect list={list} name="type" label={t('leaves.type')} options={LEAVE_TYPES.map((k) => ({ value: k, label: t(`leaves.t.${k}`) }))} />
        <FilterSelect list={list} name="source" label={t('leaves.source')} options={[{ value: 'rider', label: t('leaves.from_rider') }, { value: 'office', label: t('leaves.office') }]} />
        <FilterDate list={list} name="from" label={t('common.from_date')} />
        <FilterDate list={list} name="to" label={t('common.to_date')} />
      </FilterBar>
      <DataTable list={list} columns={columns} onRowClick={(r) => nav(`/admin/leaves/${r.id}`)} />
      <p className="mt-3 text-xs text-zinc-500">{t('leaves.how_it_works')}</p>
    </>
  );
}

// ======================================================================== create / edit
export function LeaveForm() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { t } = useI18n();
  const nav = useNavigate();
  const { toast } = useUi();
  const form = useForm<Record<string, any>>({ rider_id: params.get('rider') ?? '', start_date: todayStr(), end_date: '', leave_type: 'emergency', reason: '', reason_paragraph: '', internal_note: '' });
  const [loaded, setLoaded] = useState<any>(id ? null : {});
  const [html, setHtml] = useState('');
  useEffect(() => {
    if (id) get(`/leaves/${id}`).then((l) => { setLoaded(l); form.reset({ rider_id: l.rider_id, start_date: l.start_date, end_date: l.end_date, leave_type: l.leave_type, reason: l.reason, reason_paragraph: l.reason_paragraph ?? '', internal_note: l.internal_note ?? '' }); });
    else get('/leaves/settings').then((s) => form.set('reason', s.default_reason)).catch(() => {});
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const v = form.values;
  // the preview follows the typing
  useEffect(() => {
    const h = setTimeout(() => {
      fetch('/api/leaves/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...v, letter_no: loaded?.letter_no, stamped: loaded?.stamped }) })
        .then((r) => (r.ok ? r.text() : '')).then(setHtml).catch(() => {});
    }, 350);
    return () => clearTimeout(h);
  }, [v.rider_id, v.start_date, v.end_date, v.leave_type, v.reason, v.reason_paragraph, loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!loaded) return <Loading />;
  const answered = id && loaded.status !== 'pending';
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await form.submit(() => (id ? patch(`/leaves/${id}`, form.changes) : post('/leaves', v)));
    if (r) { if (!id) toast(t('leaves.created_msg', { letter: r.letter_no })); nav(`/admin/leaves/${id ?? r.id}`); }
  };
  return (
    <form onSubmit={submit}>
      <PageHeader title={id ? (answered ? t('leaves.edit_wording') : t('leaves.edit')) : t('leaves.new')} subtitle={loaded.letter_no && <span className="num">{loaded.letter_no}</span>} back={id ? `/admin/leaves/${id}` : '/admin/leaves'} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title={t('leaves.request_details')}>
          <div className="space-y-4">
            {answered && <Alert tone="amber">{t('leaves.texts_only')}</Alert>}
            <RiderInput form={form} name="rider_id" label={t('leaves.rider')} required activeOnly disabled={!!id} />
            <Grid cols={3}>
              <TextInput form={form} name="start_date" label={t('leaves.from')} type="date" required disabled={!!answered} />
              <TextInput form={form} name="end_date" label={t('leaves.to')} type="date" disabled={!!answered} hint={t('leaves.to_hint')} />
              <Field label={t('leaves.days')}><input className="input num" readOnly value={daysOf(v.start_date, v.end_date || v.start_date)} /></Field>
            </Grid>
            <SelectInput form={form} name="leave_type" label={t('leaves.type')} required empty={false} disabled={!!answered} options={LEAVE_TYPES.map((k) => ({ value: k, label: t(`leaves.t.${k}`) }))} />
            <TextArea form={form} name="reason" label={t('leaves.reason')} required maxLength={500} rows={2} />
            <TextArea form={form} name="reason_paragraph" label={t('leaves.paragraph')} maxLength={1000} rows={3} hint={t('leaves.paragraph_hint')} />
            <TextArea form={form} name="internal_note" label={t('leaves.internal_note')} maxLength={4000} rows={2} hint={t('leaves.internal_hint')} />
          </div>
        </Card>
        <Card title={t('leaves.letter')} subtitle={t('leaves.preview_live')}><LetterFrame html={html} /></Card>
      </div>
      <SaveBar form={form} editing={!!id} label={id ? t('common.save') : t('leaves.create')} onCancel={() => nav(-1)} />
    </form>
  );
}

// ======================================================================== one request
export function LeaveView() {
  const { id } = useParams();
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const run = useAction();
  const { confirm, toast } = useUi();
  const [l, setL] = useState<any>(null);
  const [note, setNote] = useState('');
  const [v, setV] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const load = useCallback(() => get(`/leaves/${id}`).then(setL), [id]);
  useEffect(() => { load(); }, [load]);
  if (!l) return <Loading />;
  const answer = async (decision: 'approved' | 'rejected') => {
    if (!(await confirm({ title: t(decision === 'approved' ? 'leaves.approve_q' : 'leaves.reject_q'), confirm: t(decision === 'approved' ? 'leaves.record_approval' : 'leaves.record_rejection'), tone: decision === 'approved' ? 'primary' : 'danger' }))) return;
    if (await run(() => post(`/leaves/${id}/answer`, { decision, note }), t('common.saved'))) { setNote(''); load(); setV(v + 1); }
  };
  const cancel = async () => {
    const r = await confirm({ title: t('leaves.cancel_q'), body: t('leaves.cancel_body'), confirm: t('leaves.cancel'), tone: 'warn', input: { label: t('leaves.answer_note') } });
    if (r && (await run(() => post(`/leaves/${id}/cancel`, { note: r.text }), t('common.saved')))) { load(); setV(v + 1); }
  };
  const remove = async () => {
    if (!(await confirm({ title: t('leaves.delete_q'), body: t('common.cannot_undo'), confirm: t('leaves.delete') }))) return;
    if (await run(() => del(`/leaves/${id}`), t('common.deleted'))) nav('/admin/leaves');
  };
  const print = () => { get(`/leaves/${id}/letter?print=1`).catch(() => {}); frame.current?.contentWindow?.print(); };
  return (
    <>
      <PageHeader title={<span className="num">{l.letter_no}</span>} back="/admin/leaves" subtitle={<span className="flex items-center gap-2"><Badge tone={LEAVE_TONE[l.status]}>{t(`leaves.s.${l.status}`)}</Badge>{l.source === 'rider' && <Badge tone="blue">{t('leaves.from_rider')}</Badge>}</span>}
        actions={<>
          {can('leaves.update') && <Link to={`/admin/leaves/${id}/edit`}><Button icon={<Pencil className="size-4" />}>{l.status === 'pending' ? t('common.edit') : t('leaves.edit_wording')}</Button></Link>}
          {can('leaves.cancel') && ['pending', 'approved'].includes(l.status) && <Button variant="warn" icon={<Ban className="size-4" />} onClick={cancel}>{t('leaves.cancel')}</Button>}
          {can('leaves.delete') && l.status === 'pending' && <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={remove}>{t('leaves.delete')}</Button>}
        </>} />
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          <Card title={t('leaves.request_details')}>
            <Details rows={[
              [t('leaves.rider'), <Link className="text-brand hover:underline" to={`/admin/riders/${l.rider_id}`}>{l.full_name} <span className="num">#{l.rider_id}</span></Link>],
              [t('riders.national_id'), l.national_id && <span className="num">{l.national_id}</span>], [t('riders.company'), l.company_name],
              [t('leaves.type'), t(`leaves.t.${l.leave_type}`)], [t('leaves.dates'), <span className="num">{l.start_date === l.end_date ? l.start_date : `${l.start_date} → ${l.end_date}`}</span>],
              [t('leaves.days'), fmtNum(l.days)], [t('leaves.reason'), l.reason], [t('leaves.paragraph'), l.reason_paragraph || <span className="text-zinc-500">{t('leaves.automatic')}</span>],
              [t('leaves.internal_note'), l.internal_note], [t('leaves.created'), <By name={l.source === 'rider' ? t('leaves.from_rider') : l.created_by_name} at={fmtDateTime(l.created_at)} />],
            ]} />
          </Card>
          <Card title={t('leaves.company_answer')}>
            {l.status === 'pending' ? (can('leaves.approve') ? (
              <div className="space-y-3">
                <Field label={t('leaves.answer_note')}><textarea className="input" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" icon={<Check className="size-4" />} onClick={() => answer('approved')}>{t('leaves.record_approval')}</Button>
                  <Button variant="danger" icon={<X className="size-4" />} onClick={() => answer('rejected')}>{t('leaves.record_rejection')}</Button>
                </div>
              </div>
            ) : <p className="text-sm text-zinc-500">{t('leaves.awaiting_answer')}</p>) : (
              <Details rows={[[t('leaves.status'), <Badge tone={LEAVE_TONE[l.status]}>{t(`leaves.s.${l.status}`)}</Badge>], [t('leaves.answered_by'), l.answered_by_name],
                [t('leaves.answered_at'), fmtDateTime(l.answered_at)], [t('leaves.answer_note'), l.answer_note]]} />
            )}
          </Card>
        </div>
        <Card title={t('leaves.letter')} actions={<>
          <IconButton title={t('common.refresh')} onClick={() => setV(v + 1)}><RefreshCw /></IconButton>
          <Button size="sm" icon={<Printer className="size-3.5" />} onClick={print}>{t('leaves.print')}</Button>
          {can('leaves.print') && <Button size="sm" icon={<FileText className="size-3.5" />} onClick={() => { print(); toast(t('leaves.pdf_hint'), 'blue'); }}>{t('leaves.download_pdf')}</Button>}
          {can('leaves.print') && <Button size="sm" icon={<Download className="size-3.5" />} onClick={() => run(() => download(`/leaves/${id}/letter`, { download: 'doc' }))}>{t('leaves.download_word')}</Button>}
        </>}>
          <LetterFrame key={v} src={`/api/leaves/${id}/letter`} frameRef={frame} />
        </Card>
      </div>
    </>
  );
}

// ======================================================================== letter settings
export function LeaveSettings() {
  const { t } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const [s, setS] = useState<any>(null);
  const [v, setV] = useState(0);
  const form = useForm<Record<string, any>>({ establishment_name: '', default_reason: '' });
  useEffect(() => { get('/leaves/settings').then((x) => { setS(x); form.reset({ establishment_name: x.establishment_name, default_reason: x.default_reason }); }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!s) return <Loading />;
  const done = (x: any) => { if (x) { setS(x); setV(v + 1); } return x; };
  const toggle = (k: string, val: boolean) => run(() => patch('/leaves/settings', { [k]: val }), t('common.saved')).then(done);
  const Img = ({ type, max }: { type: 'logo' | 'stamp' | 'signature'; max: number }) => {
    const input = useRef<HTMLInputElement>(null);
    const id = s[type];
    const upload = async (f: File) => { const fd = new FormData(); fd.append('file', f); done(await run(() => post(`/leaves/settings/image/${type}`, fd), t('files.uploaded'))); };
    return (
      <div className="flex items-center gap-3">
        <div className="flex h-20 w-32 items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900">
          {id ? <img src={`/api/attachments/${id}/file`} alt="" className="max-h-16 max-w-28 object-contain" /> : <span className="text-xs text-zinc-400">—</span>}
        </div>
        <div className="space-y-1.5">
          <div className="font-medium text-sm">{t(`leaves.img.${type}`)}</div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={<Upload className="size-3.5" />} onClick={() => input.current?.click()}>{id ? t('leaves.replace_image') : t('leaves.upload_image')}</Button>
            {id && <Button size="sm" variant="ghost" className="text-red-600" onClick={() => run(() => del(`/leaves/settings/image/${type}`), t('common.deleted')).then(done)}>{type === 'logo' ? t('leaves.use_org_logo') : t('common.delete')}</Button>}
          </div>
          <div className="text-xs text-zinc-500">{t('leaves.img_formats', { max })}</div>
        </div>
        <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f); }} />
      </div>
    );
  };
  const canSet = can('leaves.settings');
  return (
    <>
      <PageHeader title={t('leaves.letter_settings')} back="/admin/leaves" />
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          <Card title={t('leaves.card.logo')}>{canSet ? <Img type="logo" max={2} /> : <p className="text-sm text-zinc-500">{t('leaves.view_only')}</p>}</Card>
          <Card title={t('leaves.card.email')}>
            <Switch checked={s.email_requires_file} disabled={!canSet} onChange={(x) => toggle('email_requires_file', x)} label={t('leaves.email_requires_file')} />
          </Card>
          <Card title={t('leaves.card.stamp')}>
            {can('leaves.stamp') ? (
              <div className="space-y-4">
                <Img type="stamp" max={5} /><Img type="signature" max={5} />
                <Switch checked={s.auto_stamp} disabled={!(s.stamp && s.signature)} onChange={(x) => toggle('auto_stamp', x)} label={t('leaves.auto_stamp')} />
                {!(s.stamp && s.signature) && <p className="text-xs text-zinc-500">{t('leaves.stamp_needs_both')}</p>}
              </div>
            ) : <Alert tone="amber">{t('leaves.no_stamp_perm')}</Alert>}
          </Card>
          <form onSubmit={async (e) => { e.preventDefault(); done(await form.submit(() => patch('/leaves/settings', form.changes))); form.reset(form.values); }}>
            <Card title={t('leaves.card.wording')}>
              <div className="space-y-4">
                <TextInput form={form} name="establishment_name" label={t('leaves.establishment_name')} maxLength={150} disabled={!canSet} hint={t('leaves.establishment_hint')} />
                <TextArea form={form} name="default_reason" label={t('leaves.default_reason')} required maxLength={500} disabled={!canSet} />
                {canSet && <div className="flex justify-end"><Button type="submit" variant="primary" loading={form.busy} disabled={!form.changed.length}>{t('common.save')}</Button></div>}
              </div>
            </Card>
          </form>
        </div>
        <Card title={t('leaves.sample')}><LetterFrame key={v} src="/api/leaves/settings/sample" /></Card>
      </div>
    </>
  );
}
