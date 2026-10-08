import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Activity, ArrowRight, CalendarDays, Camera, CheckCircle2, FilePen, FileText, IdCard, Image as ImageIcon, Info, Lock, Mail, MessagesSquare, Phone, ShieldCheck, Star, UserRound, X,
} from 'lucide-react';
import { get, post } from '../../api';
import { fmtBytes, fmtDate, fmtDateTime, fmtNum, useI18n } from '../../i18n';
import { Alert, Badge, Button, Card, cx, Field, Loading, PageHeader, StatCard, useErrorText, useUi, type Tone } from '../../ui/kit';
import { PasswordFields, passwordOk, riderFile, useCountdown, useFieldText, useRider } from './shell';
import { DOCS } from './home';

const STATUS_TONE: Record<string, Tone> = { pending: 'amber', approved: 'green', rejected: 'red', cancelled: 'grey' };
const STATUSES = ['pending', 'approved', 'rejected', 'cancelled'];
function StatusFilter({ value, onChange, prefix }: { value: string; onChange: (v: string) => void; prefix: string }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap gap-1">
      {['', ...STATUSES].map((s) => (
        <button key={s} onClick={() => onChange(s)} className={cx('rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset', value === s ? 'bg-brand text-white ring-brand' : 'ring-zinc-200 hover:bg-zinc-100 dark:ring-zinc-700 dark:hover:bg-zinc-800')}>
          {s ? t(`${prefix}${s}`) : t('rp.all')}</button>
      ))}
    </div>
  );
}

// ======================================================================== 12.9 update requests
const DOC_TYPES = [...DOCS, 'other'];
const DOC_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';
const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp';
function checkFiles(files: File[], accept: string, max: number, t: (k: string, v?: any) => string) {
  if (files.length > max) return t('rp.req.max_files', { n: max });
  if (files.some((f) => !accept.split(',').includes(f.type))) return t('rp.req.bad_type');
  if (files.some((f) => f.size > 10 * 1024 * 1024)) return t('rp.req.too_big');
  return null;
}

export function Requests() {
  const { t } = useI18n();
  const { toast, confirm } = useUi();
  const errText = useErrorText();
  const fieldText = useFieldText();
  const [params, setParams] = useSearchParams();
  const [profile, setProfile] = useState<any>(null);
  const [list, setList] = useState<any>(null);
  const [filter, setFilter] = useState('');
  const type = params.get('type') ?? '';
  const [v, setV] = useState({ email: '', phone: '', doc_type: params.get('doc') ?? 'license', doc_number: '', issue_date: '', expiry_date: '', rider_note: '' });
  const [files, setFiles] = useState<File[]>([]);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [errs, setErrs] = useState<Record<string, string | undefined>>({});
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const loadList = useCallback(() => get('/portal/requests', { status: filter || undefined }).then(setList).catch(() => {}), [filter]);
  useEffect(() => { get('/portal/profile').then(setProfile).catch(() => {}); }, []);
  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { const d = params.get('doc'); if (d) setV((x) => ({ ...x, doc_type: d })); }, [params]);
  const pick = (k: string) => { setFiles([]); setFileErr(null); setErrs({}); setParams(k ? { type: k } : {}, { replace: true }); };
  const addFiles = (fl: FileList | null) => {
    const all = [...files, ...Array.from(fl ?? [])];
    const err = checkFiles(all, type === 'photo' ? PHOTO_ACCEPT : DOC_ACCEPT, type === 'photo' ? 1 : 4, t);
    setFileErr(err);
    if (!err) setFiles(all);
  };
  const send = async () => {
    const fd = new FormData();
    fd.append('type', type);
    if (v.rider_note) fd.append('rider_note', v.rider_note);
    if (type === 'contact') { if (v.email) fd.append('email', v.email); if (v.phone) fd.append('phone', v.phone); }
    if (type === 'document') for (const k of ['doc_type', 'doc_number', 'issue_date', 'expiry_date'] as const) if (v[k] && !(k === 'doc_number' && v.doc_type === 'id')) fd.append(k, v[k]);
    files.forEach((f) => fd.append('files', f));
    setBusy(true); setErrs({});
    try {
      await post('/portal/requests', fd);
      toast(t('rp.req.sent'));
      setV({ ...v, email: '', phone: '', doc_number: '', issue_date: '', expiry_date: '', rider_note: '' }); setFiles([]);
      pick(''); setFilter(''); loadList();
      setTimeout(() => listRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch (e) {
      const f = Object.fromEntries(['email', 'phone', 'doc_type', 'doc_number', 'issue_date', 'expiry_date', 'files', 'rider_note'].map((k) => [k, fieldText(e, k)]));
      setErrs(f);
      if (!Object.values(f).some(Boolean)) toast(errText(e), 'red');
    } finally { setBusy(false); }
  };
  const cancel = async (id: number) => {
    if (!(await confirm({ title: t('rp.cancel_q'), confirm: t('rp.yes_cancel') }))) return;
    try { await post(`/portal/requests/${id}/cancel`); loadList(); } catch (e) { toast(errText(e), 'red'); }
  };
  const current = profile?.documents?.find((d: any) => d.doc_type === v.doc_type);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => { setV({ ...v, [k]: e.target.value }); setErrs({ ...errs, [k]: undefined }); };
  const fileLabel = (i: number) => type === 'photo' ? t('rp.req.new_photo') : i === 0 ? t('rp.req.front') : i === 1 ? t('rp.req.back') : t('rp.req.attachment');
  return (
    <div className="space-y-5">
      <PageHeader title={t('rp.nav.requests')} />
      <Card title={t('rp.req.new')}>
        <Alert tone="blue">{t('rp.req.notice')}</Alert>
        <p className="mb-2 mt-4 text-sm font-medium">{t('rp.req.what')}</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {([['contact', Phone], ['document', IdCard], ['photo', Camera]] as const).map(([k, Icon]) => (
            <button key={k} onClick={() => pick(type === k ? '' : k)} className={cx('flex items-center gap-3 rounded-xl border p-3 text-start text-sm transition',
              type === k ? 'border-brand bg-brand/5 ring-2 ring-brand/20' : 'border-zinc-200 hover:border-brand/50 dark:border-zinc-800')}>
              <span className="flex size-9 items-center justify-center rounded-lg bg-brand/10 text-brand"><Icon className="size-5" /></span><span className="font-medium">{t(`rp.req.t.${k}`)}</span>
            </button>
          ))}
        </div>
        {type && (
          <div className="mt-5 space-y-3">
            {type === 'contact' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('rp.req.new_email')} error={errs.email} hint={t('rp.req.current', { v: profile?.email || t('rp.not_provided') })}><input className="input" type="email" dir="ltr" maxLength={150} value={v.email} onChange={set('email')} /></Field>
                <Field label={t('rp.req.new_phone')} error={errs.phone} hint={t('rp.req.current', { v: profile?.phone || t('rp.not_provided') })}><input className="input num" inputMode="tel" dir="ltr" maxLength={16} value={v.phone} onChange={set('phone')} /></Field>
              </div>
            )}
            {type === 'document' && (
              <>
                <Field label={t('rp.req.doc_type')} required error={errs.doc_type}>
                  <select className="input" value={v.doc_type} onChange={set('doc_type')}>{DOC_TYPES.map((d) => <option key={d} value={d}>{t(`rp.doc.${d}`)}</option>)}</select>
                </Field>
                {current && <div className="rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-800/60"><div className="mb-1 text-xs font-medium text-zinc-500">{t('rp.req.current_doc')}</div>
                  <span className="num" dir="ltr">{current.doc_number ?? '—'}</span> · {t('rp.pf.issue_date')}: <span className="num">{fmtDate(current.issue_date)}</span> · {t('rp.pf.expiry_date')}: <span className="num">{fmtDate(current.expiry_date)}</span></div>}
                <div className="grid gap-3 sm:grid-cols-3">
                  {v.doc_type !== 'id' && <Field label={t('rp.req.doc_number')} error={errs.doc_number} hint={t('rp.req.leave_empty')}><input className="input num" dir="ltr" maxLength={50} value={v.doc_number} onChange={set('doc_number')} /></Field>}
                  <Field label={t('rp.pf.issue_date')} error={errs.issue_date}><input className="input" type="date" value={v.issue_date} onChange={set('issue_date')} /></Field>
                  <Field label={t('rp.pf.expiry_date')} error={errs.expiry_date}><input className="input" type="date" min={v.issue_date || undefined} value={v.expiry_date} onChange={set('expiry_date')} /></Field>
                </div>
              </>
            )}
            {type === 'photo' && (
              <div className="flex flex-wrap items-start gap-4">
                <div className="text-center text-xs text-zinc-500"><div className="mb-1">{t('rp.req.current_photo')}</div>
                  {profile?.photo_id ? <img src={riderFile(profile.photo_id)} alt="" className="size-24 rounded-xl object-cover" /> : <div className="flex size-24 items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-800"><UserRound className="size-8 text-zinc-400" /></div>}</div>
                <p className="flex-1 rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400">{t('rp.req.photo_tips')}</p>
              </div>
            )}
            {type !== 'contact' && (
              <div>
                <label onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
                  className={cx('flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed p-5 text-center text-sm', fileErr || errs.files ? 'border-red-300' : 'border-zinc-300 hover:border-brand dark:border-zinc-700')}>
                  <ImageIcon className="size-6 text-zinc-400" />
                  <span className="font-medium">{type === 'photo' ? t('rp.req.new_photo') : t('rp.req.doc_files')}</span>
                  <span className="text-xs text-zinc-500">{type === 'photo' ? t('rp.req.photo_rule') : t('rp.req.files_rule')}</span>
                  <input type="file" hidden multiple={type !== 'photo'} accept={type === 'photo' ? PHOTO_ACCEPT : DOC_ACCEPT} onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
                </label>
                {(fileErr || errs.files) && <p className="mt-1 text-xs text-red-600">{fileErr || errs.files}</p>}
                {files.length > 0 && <ul className="mt-2 space-y-1">{files.map((f, i) => (
                  <li key={i} className="flex items-center gap-2 rounded-lg bg-zinc-50 px-3 py-1.5 text-sm dark:bg-zinc-800/60"><Badge tone="blue">{fileLabel(i)}</Badge><span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <span className="text-xs text-zinc-500 num">{fmtBytes(f.size)}</span><button title={t('rp.remove')} onClick={() => setFiles(files.filter((_, j) => j !== i))}><X className="size-4" /></button></li>))}</ul>}
              </div>
            )}
            <Field label={t('rp.req.note')} error={errs.rider_note}><textarea className="input" rows={2} maxLength={1000} value={v.rider_note} onChange={set('rider_note')} /></Field>
            <div className="flex justify-end"><Button variant="primary" loading={busy} onClick={send}
              disabled={type === 'contact' ? !v.email && !v.phone : !files.length}>{t('rp.send_request')}</Button></div>
          </div>
        )}
      </Card>
      <div ref={listRef}>
        <Card title={t('rp.req.mine')} subtitle={list ? t('rp.req.under_review', { n: list.pending }) : undefined} actions={<StatusFilter value={filter} onChange={setFilter} prefix="rp.req.s." />}>
          {!list ? <Loading /> : !list.rows.length ? <p className="py-6 text-center text-sm text-zinc-500">{t('rp.req.none')}</p> : (
            <div className="space-y-3">{list.rows.map((r: any) => <RequestCard key={r.id} r={r} onCancel={() => cancel(r.id)} />)}</div>
          )}
        </Card>
      </div>
    </div>
  );
}
function RequestCard({ r, onCancel }: { r: any; onCancel: () => void }) {
  const { t } = useI18n();
  const fields = r.type === 'contact' ? ['email', 'phone'] : r.type === 'document' ? ['doc_number', 'issue_date', 'expiry_date'] : [];
  const changed = fields.filter((f) => r.payload?.[f]);
  return (
    <div className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{t(`rp.req.t.${r.type}`)}{r.doc_type && ` · ${t(`rp.doc.${r.doc_type}`)}`}</span>
        <Badge tone={STATUS_TONE[r.status]}>{t(`rp.req.s.${r.status}`)}</Badge>
        <span className="ms-auto text-xs text-zinc-500"><span className="num">#{r.id}</span> · <span className="num">{fmtDateTime(r.created_at)}</span></span>
      </div>
      {changed.length > 0 && (
        <table className="mt-2 w-full text-sm"><tbody>{changed.map((f) => (
          <tr key={f}><td className="w-1/3 py-1 text-xs text-zinc-500">{t(`rp.req.f.${f}`)}</td>
            <td className="py-1"><span className="text-zinc-400 line-through num" dir="ltr">{r.snapshot?.[f] ?? '—'}</span> <ArrowRight className="mx-1 inline size-3 rtl:rotate-180" /> <b className="num" dir="ltr">{r.payload[f]}</b></td></tr>))}</tbody></table>
      )}
      {r.files.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{r.files.map((f: any) => (
        <a key={f.id} href={riderFile(f.id)} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-lg bg-zinc-100 px-2 py-1 text-xs dark:bg-zinc-800">
          {f.mime.startsWith('image/') ? <img src={riderFile(f.id)} alt="" className="size-8 rounded object-cover" /> : <FileText className="size-4" />}{t(`rp.req.${f.attachment_type === 'photo' ? 'new_photo' : f.attachment_type}`)}</a>))}</div>}
      {r.rider_note && <p className="mt-2 text-sm"><span className="text-xs text-zinc-500">{t('rp.req.your_note')}:</span> {r.rider_note}</p>}
      {r.review_note && <p className={cx('mt-2 rounded-lg p-2 text-sm', r.status === 'rejected' ? 'bg-red-50 dark:bg-red-950/30' : 'bg-zinc-50 dark:bg-zinc-800/60')}><span className="text-xs font-medium">{t('rp.req.office_note')}:</span> {r.review_note}</p>}
      {r.status === 'pending' && <div className="mt-2 text-end"><Button size="sm" variant="ghost" className="text-red-600" onClick={onCancel}>{t('rp.cancel_request')}</Button></div>}
    </div>
  );
}

// ======================================================================== 12.10 leaves
const LEAVE_TYPES = ['emergency', 'annual', 'sick', 'unpaid', 'other'];
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
export function Leaves() {
  const { t } = useI18n();
  const { toast, confirm } = useUi();
  const errText = useErrorText();
  const fieldText = useFieldText();
  const [filter, setFilter] = useState('');
  const [d, setD] = useState<any>(null);
  const [v, setV] = useState({ leave_type: 'emergency', start_date: '', end_date: '', reason: '' });
  const [errs, setErrs] = useState<Record<string, string | undefined>>({});
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => get('/portal/leaves', { status: filter || undefined }).then(setD).catch(() => {}), [filter]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <Loading />;
  const days = v.start_date ? Math.round((Date.parse(v.end_date || v.start_date) - Date.parse(v.start_date)) / 86400000) + 1 : 0;
  const send = async () => {
    setBusy(true); setErrs({});
    try {
      const r = await post('/portal/leaves', { ...v, end_date: v.end_date || undefined });
      toast(t('rp.lv.sent', { n: r.letter_no }));
      setV({ leave_type: 'emergency', start_date: '', end_date: '', reason: '' }); load();
    } catch (e) {
      const f = Object.fromEntries(['leave_type', 'start_date', 'end_date', 'reason'].map((k) => [k, fieldText(e, k)]));
      setErrs(f);
      if (!Object.values(f).some(Boolean)) toast(errText(e), 'red');
    } finally { setBusy(false); }
  };
  const cancel = async (id: number) => {
    if (!(await confirm({ title: t('rp.cancel_q'), confirm: t('rp.yes_cancel') }))) return;
    try { await post(`/portal/leaves/${id}/cancel`); load(); } catch (e) { toast(errText(e), 'red'); }
  };
  return (
    <div className="space-y-5">
      <PageHeader title={t('rp.nav.leaves')} />
      {d.on_leave && <Alert tone="green" title={t('rp.lv.on_leave')}><span className="num">{fmtDate(d.on_leave.start_date)} → {fmtDate(d.on_leave.end_date)}</span></Alert>}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label={t('rp.lv.pending')} value={fmtNum(d.stats.pending)} tone={d.stats.pending ? 'amber' : 'none'} />
        <StatCard label={t('rp.lv.approved_days')} value={fmtNum(d.stats.approved_days)} />
        <div className="rounded-xl border border-zinc-200/80 bg-white px-3.5 py-3 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          <div className="mb-1 font-medium text-zinc-500">{t('rp.lv.rules')}</div>{t('rp.lv.rules_text')}</div>
      </div>
      <Card title={t('rp.lv.new')}>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label={t('rp.lv.type')} required error={errs.leave_type}><select className="input" value={v.leave_type} onChange={(e) => setV({ ...v, leave_type: e.target.value })}>{LEAVE_TYPES.map((x) => <option key={x} value={x}>{t(`rp.lv.t.${x}`)}</option>)}</select></Field>
          <Field label={t('rp.from')} required error={errs.start_date}><input className="input" type="date" min={d.today} max={addDays(d.today, 90)} value={v.start_date} onChange={(e) => setV({ ...v, start_date: e.target.value })} /></Field>
          <Field label={t('rp.to')} error={errs.end_date} hint={t('rp.lv.single_day')}><input className="input" type="date" min={v.start_date || d.today} max={v.start_date ? addDays(v.start_date, 29) : undefined} value={v.end_date} onChange={(e) => setV({ ...v, end_date: e.target.value })} /></Field>
          <Field label={t('rp.lv.days')}><div className="input flex items-center bg-zinc-50 num dark:bg-zinc-800/60">{days || '—'}</div></Field>
        </div>
        <Field className="mt-3" label={t('rp.lv.reason')} required error={errs.reason} hint={t('rp.lv.reason_hint')}><textarea className="input" rows={2} maxLength={500} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Field>
        <div className="mt-3 flex justify-end"><Button variant="primary" loading={busy} disabled={!v.start_date || !v.reason.trim()} onClick={send}>{t('rp.send_request')}</Button></div>
      </Card>
      <Card title={t('rp.lv.mine')} actions={<StatusFilter value={filter} onChange={setFilter} prefix="rp.lv.s." />}>
        {!d.rows.length ? <p className="py-6 text-center text-sm text-zinc-500">{t('rp.lv.none')}</p> : (
          <div className="space-y-3">{d.rows.map((l: any) => (
            <div key={l.id} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{t(`rp.lv.t.${l.leave_type}`)}</span><Badge tone={STATUS_TONE[l.status]}>{t(`rp.lv.s.${l.status}`)}</Badge>
                <span className="text-sm text-zinc-500">{t('rp.lv.n_days', { n: l.days })}</span>
                <span className="ms-auto text-xs text-zinc-500 num">{l.letter_no}</span>
              </div>
              <div className="mt-1 text-sm num">{fmtDate(l.start_date)}{l.end_date !== l.start_date && <> → {fmtDate(l.end_date)}</>}</div>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{l.reason}</p>
              {l.source === 'office' && <p className="mt-1 text-xs text-zinc-500">{t('rp.lv.by_office')}</p>}
              {l.answer && <p className="mt-2 rounded-lg bg-zinc-50 p-2 text-sm dark:bg-zinc-800/60"><span className="text-xs font-medium">{t('rp.lv.answer')}:</span> {l.answer}</p>}
              {l.status === 'pending' && <div className="mt-2 text-end"><Button size="sm" variant="ghost" className="text-red-600" onClick={() => cancel(l.id)}>{t('rp.cancel_request')}</Button></div>}
            </div>
          ))}</div>
        )}
      </Card>
    </div>
  );
}

// ======================================================================== 12.12 security
export function Security() {
  const { t } = useI18n();
  const { me, refresh } = useRider();
  const { toast } = useUi();
  const errText = useErrorText();
  const fieldText = useFieldText();
  const [params, setParams] = useSearchParams();
  const [s, setS] = useState<any>(null);
  const [email, setEmail] = useState('');
  const [changing, setChanging] = useState(false);
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [left, setLeft] = useCountdown();
  const [codeErr, setCodeErr] = useState<string | null>(null);
  const [emailErr, setEmailErr] = useState<string | null>(null);
  const [current, setCurrent] = useState('');
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [pwErrs, setPwErrs] = useState<Record<string, string | undefined>>({});
  const [busy, setBusy] = useState('');
  const load = useCallback(async () => {
    const x = await get('/portal/security');
    setS(x);
    if (x.pending) { setSentTo(x.pending.email); setLeft(Number(x.pending.resend_in)); }
  }, [setLeft]);
  useEffect(() => { load().catch(() => {}); }, [load]);
  const verify = useCallback(async (c: string) => {
    setBusy('verify'); setCodeErr(null);
    try {
      await post('/portal/security/email/verify', { code: c });
      toast(t('rp.sec.verified_ok')); setSentTo(null); setCode(''); setChanging(false); await load(); refresh();
    } catch (e) { setCodeErr(fieldText(e, 'code') ?? fieldText(e, 'email') ?? errText(e)); }
    finally { setBusy(''); }
  }, [errText, fieldText, load, refresh, t, toast]);
  // the link in the email opens this page with its code
  const linkCode = params.get('code');
  useEffect(() => { if (linkCode && /^\d{6}$/.test(linkCode)) { setParams({}, { replace: true }); verify(linkCode); } }, [linkCode]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!s) return <Loading />;
  const sendCode = async () => {
    setBusy('send'); setEmailErr(null);
    try { const r = await post('/portal/security/email', { email: email || sentTo }); setSentTo(r.email); setLeft(r.resend_in); setCode(''); setCodeErr(null); }
    catch (e) { setEmailErr(fieldText(e, 'email') ?? errText(e)); }
    finally { setBusy(''); }
  };
  const savePw = async () => {
    setBusy('pw'); setPwErrs({});
    try {
      await post('/portal/security/password', { current, password: pw, confirm: pw2 });
      toast(s.has_password ? t('rp.sec.pw_changed') : t('rp.sec.pw_set')); setCurrent(''); setPw(''); setPw2(''); await load(); refresh();
    } catch (e) {
      const f = { current: fieldText(e, 'current'), password: fieldText(e, 'password'), confirm: fieldText(e, 'confirm') };
      setPwErrs(f);
      if (!Object.values(f).some(Boolean)) toast(errText(e), 'red');
    } finally { setBusy(''); }
  };
  const verified = !!s.verified_email;
  const done = Number(verified) + Number(s.has_password);
  const codeBox = sentTo && (
    <div className="space-y-2 rounded-xl bg-zinc-50 p-3 dark:bg-zinc-800/60">
      <p className="text-sm">{t('rp.sec.code_sent', { email: sentTo })}</p>
      <div className="flex gap-2">
        <input className="input max-w-40 text-center text-lg tracking-[0.4em] num" inputMode="numeric" maxLength={6} dir="ltr" autoComplete="one-time-code" value={code}
          onChange={(e) => { const c = e.target.value.replace(/\D/g, ''); setCode(c); if (c.length === 6) verify(c); }} />
        <Button variant="primary" loading={busy === 'verify'} disabled={code.length !== 6} onClick={() => verify(code)}>{t('rp.sec.verify')}</Button>
      </div>
      {codeErr && <p className="text-xs text-red-600">{codeErr}</p>}
      <p className="text-xs">{left > 0 ? <span className="text-zinc-500">{t('rp.resend_in', { n: left })}</span> : <button className="text-brand hover:underline" onClick={sendCode}>{t('rp.resend')}</button>}</p>
    </div>
  );
  const pwBadge: [Tone, string] = !verified ? ['grey', 'locked'] : s.has_password ? ['green', 'protected'] : ['amber', 'not_protected'];
  return (
    <div className="space-y-5">
      <PageHeader title={t('rp.nav.security')} />
      {params.get('welcome') && <Alert tone="green" title={t('rp.sec.welcome', { name: me.full_name })}>{t('rp.sec.welcome_text')}</Alert>}
      <Card>
        <div className="flex items-center justify-between text-sm"><span className="font-semibold">{done === 2 ? t('rp.sec.fully') : t('rp.secure.title')}</span><span className="num">{done} / 2</span></div>
        <div className="mt-2 h-2 rounded-full bg-zinc-100 dark:bg-zinc-800"><div className={cx('h-2 rounded-full transition-all', done === 2 ? 'bg-emerald-500' : 'bg-amber-500')} style={{ width: `${done * 50}%` }} /></div>
      </Card>
      {!s.email_available && <Alert tone="red" title={t('rp.sec.email_unavailable')}>{t('rp.sec.email_unavailable_text')} {[s.support.phone, s.support.email].filter(Boolean).join(' · ')}</Alert>}
      <Card title={<span className="flex items-center gap-2"><Mail className="size-4" />{t('rp.sec.step1')}</span>} actions={<Badge tone={verified ? 'green' : 'amber'}>{verified ? t('rp.sec.verified') : t('rp.sec.not_verified')}</Badge>}>
        {verified && !changing ? (
          <div className="flex flex-wrap items-center gap-3 text-sm"><CheckCircle2 className="size-5 text-emerald-600" /><span className="flex-1" dir="ltr">{s.verified_email}</span>
            <Button size="sm" onClick={() => { setChanging(true); setEmail(''); }}>{t('rp.sec.change_email')}</Button></div>
        ) : (
          <div className="space-y-3">
            <Field label={changing ? t('rp.sec.new_email') : t('rp.sec.email')} error={emailErr ?? undefined}>
              <div className="flex gap-2"><input className="input" type="email" dir="ltr" maxLength={150} value={email} onChange={(e) => setEmail(e.target.value)} disabled={!s.email_available} />
                <Button loading={busy === 'send'} disabled={!email || !s.email_available || (left > 0 && email === sentTo)} onClick={sendCode}>{t('rp.send_code')}</Button></div>
            </Field>
            {codeBox}
            {changing && <Button size="sm" variant="ghost" onClick={() => { setChanging(false); setSentTo(null); }}>{t('rp.sec.keep_email')}</Button>}
          </div>
        )}
      </Card>
      <Card title={<span className="flex items-center gap-2"><Lock className="size-4" />{s.has_password ? t('rp.sec.change_pw') : t('rp.sec.step2')}</span>} actions={<Badge tone={pwBadge[0]}>{t(`rp.sec.${pwBadge[1]}`)}</Badge>}>
        {!verified ? <p className="text-sm text-zinc-500">{t('err.verify_email_first')}</p> : (
          <div className="max-w-md space-y-3">
            {s.has_password && <Field label={t('rp.sec.current_pw')} error={pwErrs.current}><input className="input" type="password" dir="ltr" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>}
            <PasswordFields value={pw} confirm={pw2} onChange={setPw} onConfirm={setPw2} errors={pwErrs} />
            <Button variant="primary" loading={busy === 'pw'} disabled={!passwordOk(pw) || pw !== pw2 || (s.has_password && !current)} onClick={savePw}>{s.has_password ? t('rp.sec.change_pw') : t('rp.sec.set_pw')}</Button>
          </div>
        )}
      </Card>
      <Card title={t('rp.sec.tips')}>
        <ul className="space-y-2 text-sm">{[1, 2, 3, 4, 5].map((i) => <li key={i} className="flex gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" />{t(`rp.sec.tip${i}`)}</li>)}</ul>
      </Card>
    </div>
  );
}

// ======================================================================== 12.13 how to use the app
export function Help() {
  const { t } = useI18n();
  const nav = useNavigate();
  const steps: [string, typeof Activity][] = [['attendance', Camera], ['profile', UserRound], ['performance', Activity], ['leaves', CalendarDays], ['issues', MessagesSquare], ['requests', FilePen], ['security', ShieldCheck]];
  return (
    <div className="space-y-5">
      <PageHeader title={t('rp.nav.help')} subtitle={t('rp.help.subtitle')} />
      <ol className="space-y-2">{steps.map(([k, Icon], i) => (
        <li key={k} className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white num">{i + 1}</span>
          <Icon className="size-5 shrink-0 text-brand" />
          <div className="min-w-0 flex-1"><div className="font-medium">{t(`rp.nav.${k}`)}</div><div className="text-sm text-zinc-500">{t(`rp.help.s.${k}`)}</div></div>
          <Button size="sm" onClick={() => nav(`/rider/${k}`)}>{t('rp.open')}</Button>
        </li>))}</ol>
      <Card title={t('rp.help.rules')}>
        <ul className="space-y-2 text-sm">{[1, 2, 3, 4].map((i) => <li key={i} className="flex gap-2"><Info className="mt-0.5 size-4 shrink-0 text-brand" />{t(`rp.help.rule${i}`)}</li>)}</ul>
      </Card>
      <Card title={t('rp.help.faq')}>
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">{[1, 2, 3, 4, 5].map((i) => (
          <details key={i} className="group py-2"><summary className="cursor-pointer list-none text-sm font-medium">{t(`rp.help.q${i}`)}</summary><p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t(`rp.help.a${i}`)}</p></details>))}</div>
      </Card>
      <Card>
        <div className="flex flex-wrap items-center gap-3"><Star className="size-5 text-brand" /><p className="flex-1 text-sm">{t('rp.help.closing')}</p>
          <Link to="/rider/issues?new=1"><Button variant="primary">{t('rp.help.write_now')}</Button></Link></div>
      </Card>
    </div>
  );
}
