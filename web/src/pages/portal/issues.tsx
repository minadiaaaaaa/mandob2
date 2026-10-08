import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Bike, Camera, CreditCard, Gauge, HelpCircle, MessageSquarePlus, Search, Smartphone, UserRound, X } from 'lucide-react';
import { get, post } from '../../api';
import { fmtBytes, fmtDate, fmtDateTime, useI18n } from '../../i18n';
import { Alert, Badge, Button, cx, Field, Modal, Spinner, useErrorText } from '../../ui/kit';
import { ago, Composer, FileChip, STATUS_TONE, type Msg } from '../ops/Issues';
import { riderFile, useFieldText, useRider } from './shell';

// 12.11 Issues: the rider's conversations with the office. New messages arrive by polling.
const CATS = ['account', 'performance', 'attendance', 'payment', 'vehicle', 'app', 'other'];
const CAT_ICON: Record<string, typeof Bike> = { account: UserRound, performance: Gauge, attendance: Camera, payment: CreditCard, vehicle: Bike, app: Smartphone, other: HelpCircle };
const PRIORITY_DOT: Record<string, string> = { low: 'bg-zinc-300', normal: 'bg-blue-400', high: 'bg-amber-500', urgent: 'bg-red-500' };

export function RiderIssues() {
  const { t } = useI18n();
  const { id } = useParams();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const { refresh } = useRider();
  const [rows, setRows] = useState<any[] | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [online, setOnline] = useState(true);
  const load = useCallback(() => get('/portal/issues', { search: search || undefined, status: status || undefined })
    .then((d) => { setRows(d.rows); setOnline(true); }).catch(() => setOnline(false)), [search, status]);
  useEffect(() => { const h = setTimeout(load, 250); return () => clearTimeout(h); }, [load]);
  useEffect(() => { const h = setInterval(load, 10000); return () => clearInterval(h); }, [load]);
  const changed = useCallback(() => { load(); refresh(); }, [load, refresh]);
  const showNew = params.get('new') === '1';
  // fills the screen down to the bottom bar (phone) or the page margin, whatever bars sit above it
  const box = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    const fit = () => box.current && setHeight(window.innerHeight - box.current.getBoundingClientRect().top - (window.innerWidth >= 1024 ? 24 : 80));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  return (
    <div ref={box} style={{ height }} className="-mx-4 -mt-4 flex min-h-96 overflow-hidden border-zinc-200 bg-white sm:-mx-6 sm:-mt-6 lg:m-0 lg:rounded-xl lg:border dark:border-zinc-800 dark:bg-zinc-900">
      <section className={cx('flex w-full flex-col border-e border-zinc-100 lg:w-96 dark:border-zinc-800', id && 'hidden lg:flex')}>
        <header className="space-y-2 border-b border-zinc-100 p-3 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <h1 className="flex-1 font-semibold">{t('rp.iss.title')}</h1>
            <span className={cx('text-xs', online ? 'text-emerald-600' : 'text-amber-600')}>● {online ? t('iss.live') : t('iss.reconnecting')}</span>
            <Button size="sm" variant="primary" icon={<MessageSquarePlus className="size-4" />} onClick={() => setParams({ new: '1' })}>{t('rp.iss.new')}</Button>
          </div>
          <div className="relative"><Search className="absolute start-2.5 top-2.5 size-4 text-zinc-400" />
            <input className="input ps-8" placeholder={t('rp.iss.search')} value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <div className="flex gap-1">{['', 'open', 'resolved', 'closed'].map((s) => (
            <button key={s} onClick={() => setStatus(s)} className={cx('rounded-full px-3 py-1 text-xs font-medium', status === s ? 'bg-brand text-white' : 'bg-zinc-100 dark:bg-zinc-800')}>{s ? t(`rp.iss.f.${s}`) : t('rp.all')}</button>))}</div>
        </header>
        <div className="scroll-thin flex-1 overflow-y-auto">
          {!rows ? <div className="p-6 text-center"><Spinner /></div> : !rows.length ? <p className="p-6 text-center text-sm text-zinc-500">{t('rp.iss.none')}</p> : rows.map((r) => {
            const Icon = CAT_ICON[r.category] ?? HelpCircle;
            return (
              <Link key={r.id} to={`/rider/issues/${r.id}`} className={cx('flex gap-3 border-b border-zinc-50 p-3 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/50', String(r.id) === id && 'bg-brand/5')}>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800"><Icon className="size-4 text-zinc-500" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><span className={cx('truncate text-sm', r.unread ? 'font-semibold' : 'font-medium')}>{r.subject}</span>
                    <span className="ms-auto shrink-0 text-[11px] text-zinc-500">{ago(t, r.last_activity_at)}</span></div>
                  <div className="flex items-center gap-2"><span className="truncate text-xs text-zinc-500">{r.last_author === 'staff' ? `${t('rp.iss.support')}: ` : ''}{r.last_body || '📎'}</span>
                    {r.unread > 0 && <span className="ms-auto rounded-full bg-red-600 px-1.5 text-[10px] font-semibold leading-4 text-white num">{r.unread}</span>}</div>
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-500">
                    <span className={cx('size-2 rounded-full', PRIORITY_DOT[r.priority])} title={t(`rp.iss.p.${r.priority}`)} />
                    <Badge tone={STATUS_TONE[r.status]}>{t(`rp.iss.s.${r.status}`)}</Badge><span>{t(`rp.iss.cat.${r.category}`)}</span><span className="num">#{r.id}</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>
      <section className={cx('min-w-0 flex-1', !id && 'hidden lg:block')}>
        {id ? <RiderConversation key={id} id={Number(id)} onChanged={changed} onOnline={setOnline} />
          : <div className="flex h-full items-center justify-center p-6 text-center text-sm text-zinc-500">{t('rp.iss.pick')}</div>}
      </section>
      {showNew && <NewIssue onClose={() => setParams({})} onCreated={(nid) => { changed(); nav(`/rider/issues/${nid}`); }} />}
    </div>
  );
}

function RiderConversation({ id, onChanged, onOnline }: { id: number; onChanged: () => void; onOnline: (v: boolean) => void }) {
  const { t } = useI18n();
  const [issue, setIssue] = useState<any>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [more, setMore] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const lastRead = useRef(0);
  const lastId = msgs.filter((m) => !m.local).at(-1)?.id ?? 0;
  useEffect(() => { get(`/portal/issues/${id}`).then((d) => { setIssue(d); setMsgs(d.list); setMore(d.list.length >= 50); }).catch(() => setIssue(false)); }, [id]);
  const pull = useCallback(async () => {
    const { list, ...rest } = await get(`/portal/issues/${id}`, { after: lastId || undefined });
    setIssue(rest);
    if (list.length) setMsgs((m) => [...m.filter((x) => !list.some((y: Msg) => y.id === x.id)), ...list]);
  }, [id, lastId]);
  useEffect(() => { const h = setInterval(() => pull().then(() => onOnline(true)).catch(() => onOnline(false)), 4000); return () => clearInterval(h); }, [pull, onOnline]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs.length]);
  useEffect(() => {
    const mark = () => { if (lastId && lastId !== lastRead.current && document.visibilityState === 'visible') { lastRead.current = lastId; post(`/portal/issues/${id}/read`).then(onChanged).catch(() => {}); } };
    mark();
    document.addEventListener('visibilitychange', mark);
    return () => document.removeEventListener('visibilitychange', mark);
  }, [id, lastId, onChanged]);
  const send = async (fd: FormData, preview: Msg) => {
    const tmp = { ...preview, local: 'sending' as const, retry: fd };
    setMsgs((m) => [...m, tmp]);
    try { await post(`/portal/issues/${id}/messages`, fd); setMsgs((m) => m.filter((x) => x !== tmp)); await pull(); onChanged(); return true; }
    catch { setMsgs((m) => m.map((x) => (x === tmp ? { ...x, local: 'failed' } : x))); return false; }
  };
  const earlier = async () => {
    const d = await get(`/portal/issues/${id}`, { before: msgs.find((m) => !m.local)?.id });
    setMsgs((m) => [...d.list, ...m]); setMore(d.list.length >= 50);
  };
  if (issue === false) return <div className="p-6"><Alert tone="red">{t('err.not_found')}</Alert></div>;
  if (!issue) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  // the rider's first message is the original report; it stays folded above the conversation
  const report = issue.opened_by === 'rider' && !more ? msgs[0] : null;
  const shown = report ? msgs.slice(1) : msgs;
  let lastDay = '';
  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-zinc-100 px-3 py-2.5 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <Link to="/rider/issues" className="rounded-lg p-1.5 hover:bg-zinc-100 lg:hidden dark:hover:bg-zinc-800" title={t('common.back')}><ArrowLeft className="size-5 rtl:rotate-180" /></Link>
          <h2 className="min-w-0 flex-1 truncate font-semibold">{issue.subject}</h2>
          <Badge tone={STATUS_TONE[issue.status]}>{t(`rp.iss.s.${issue.status}`)}</Badge>
        </div>
        <div className="mt-0.5 truncate text-xs text-zinc-500"><span className="num">#{issue.id}</span> · {t(`rp.iss.cat.${issue.category}`)} · {t(`rp.iss.p.${issue.priority}`)} · <span className="num">{fmtDate(issue.created_at)}</span></div>
      </header>
      <div className="scroll-thin flex-1 space-y-2 overflow-y-auto bg-zinc-50/60 p-3 dark:bg-zinc-950/40">
        {report && (
          <div className="rounded-xl border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-700 dark:bg-zinc-900">
            <div className="flex items-center justify-between"><span className="text-xs font-semibold text-zinc-500">{t('rp.iss.original')}</span>
              <button className="text-xs text-brand hover:underline" onClick={() => setShowReport(!showReport)}>{showReport ? t('rp.hide') : t('rp.show')}</button></div>
            {showReport && <><div className="mt-1 whitespace-pre-wrap break-words" dir="auto">{report.body}</div>
              {report.files.length > 0 && <div className="mt-2 space-y-1.5">{report.files.map((f) => <FileChip key={f.id} f={f} href={riderFile} />)}</div>}</>}
          </div>
        )}
        {more && <div className="text-center"><Button size="sm" variant="ghost" onClick={earlier}>{t('iss.earlier')}</Button></div>}
        {shown.map((m, i) => {
          const mine = m.author === 'rider';
          const day = m.created_at.slice(0, 10);
          const sep = day !== lastDay ? (lastDay = day) : null;
          return (
            <div key={m.local ? `l${i}` : m.id}>
              {sep && <div className="my-2 text-center"><span className="rounded-full bg-zinc-200/70 px-2.5 py-0.5 text-[11px] text-zinc-600 num dark:bg-zinc-800 dark:text-zinc-400">{fmtDate(sep)}</span></div>}
              <div className={cx('flex', mine ? 'justify-end' : 'justify-start')}>
                <div className={cx('max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-xs', mine ? 'bg-brand text-white' : 'bg-white ring-1 ring-zinc-200 dark:bg-zinc-800 dark:ring-zinc-700')}>
                  {!mine && <div className="mb-0.5 text-[10px] font-semibold text-brand">{t('rp.iss.support')}</div>}
                  {m.body && <div className="whitespace-pre-wrap break-words" dir="auto">{m.body}</div>}
                  {m.files.length > 0 && <div className="mt-1.5 space-y-1.5">{m.files.map((f) => <FileChip key={f.id} f={f} light={mine} href={riderFile} />)}</div>}
                  <div className={cx('mt-1 flex items-center gap-1 text-[10px]', mine ? 'text-white/70' : 'text-zinc-500')}>
                    <span className="num">{fmtDateTime(m.created_at).slice(11)}</span>
                    {mine && !m.local && <span>· {issue.staff_read_at && issue.staff_read_at >= m.created_at ? t('iss.read') : t('iss.sent')}</span>}
                    {m.local === 'sending' && <span>· {t('iss.sending')}</span>}
                  </div>
                  {m.local === 'failed' && <div className="mt-1 flex items-center gap-2 text-xs"><span className="font-semibold">{t('iss.not_sent')}</span>
                    <button className="underline" onClick={() => { setMsgs((x) => x.filter((y) => y !== m)); send(m.retry!, m); }}>{t('iss.retry')}</button>
                    <button className="underline" onClick={() => setMsgs((x) => x.filter((y) => y !== m))}>{t('iss.discard')}</button></div>}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      {issue.status === 'closed'
        ? <div className="border-t border-zinc-100 p-3 text-center text-sm text-zinc-500 dark:border-zinc-800">{t('rp.iss.closed')} <Link to="/rider/issues?new=1" className="text-brand hover:underline">{t('rp.iss.new')}</Link></div>
        : <Composer staff={false} onSend={send} placeholder={t('rp.iss.write')} />}
    </div>
  );
}

function NewIssue({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const { t } = useI18n();
  const errText = useErrorText();
  const fieldText = useFieldText();
  const [v, setV] = useState({ category: '', subject: '', body: '', priority: 'normal' });
  const [files, setFiles] = useState<File[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [errs, setErrs] = useState<Record<string, string | undefined>>({});
  const [busy, setBusy] = useState(false);
  const add = (list: FileList | null) => {
    const all = [...files, ...Array.from(list ?? [])];
    if (all.length > 10) { setErr(t('iss.max_files')); return; }
    if (all.some((f) => f.size > 25 * 1024 * 1024)) { setErr(t('err.file_too_large', { max: 25 })); return; }
    setErr(null); setFiles(all);
  };
  const start = async () => {
    const fd = new FormData();
    Object.entries(v).forEach(([k, x]) => fd.append(k, x));
    files.forEach((f) => fd.append('files', f));
    setBusy(true); setErr(null); setErrs({});
    try { const r = await post('/portal/issues', fd); onCreated(r.id); }
    catch (e) { const f = Object.fromEntries(['category', 'subject', 'body', 'priority'].map((k) => [k, fieldText(e, k)])); setErrs(f); if (!Object.values(f).some(Boolean)) setErr(errText(e)); }
    finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={t('rp.iss.report')} wide footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={busy} onClick={start}>{t('rp.iss.start')}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('rp.iss.category')} required error={errs.category}><select className="input" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}>
          <option value="">—</option>{CATS.map((c) => <option key={c} value={c}>{t(`rp.iss.cat.${c}`)}</option>)}</select></Field>
        <Field label={t('rp.iss.priority')} required error={errs.priority}><select className="input" value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })}>
          {['low', 'normal', 'high'].map((c) => <option key={c} value={c}>{t(`rp.iss.p.${c}`)}</option>)}</select></Field>
        <Field label={t('rp.iss.subject')} required error={errs.subject} hint={t('rp.iss.subject_hint')} className="sm:col-span-2"><input className="input" maxLength={200} value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} /></Field>
        <Field label={t('rp.iss.details')} required error={errs.body} hint={t('rp.iss.details_hint')} className="sm:col-span-2"><textarea className="input" rows={5} maxLength={5000} dir="auto" value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} /></Field>
        <div className="sm:col-span-2">
          <label onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); add(e.dataTransfer.files); }}
            className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-300 p-4 text-sm hover:border-brand dark:border-zinc-700">
            {t('rp.iss.add_files')}<span className="text-xs text-zinc-500">{t('rp.iss.files_rule')}</span>
            <input type="file" hidden multiple onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
          </label>
          {files.length > 0 && <ul className="mt-2 space-y-1">{files.map((f, i) => <li key={i} className="flex items-center gap-2 text-sm"><span className="min-w-0 flex-1 truncate">{f.name}</span>
            <span className="text-xs text-zinc-500 num">{fmtBytes(f.size)}</span><button title={t('rp.remove')} onClick={() => setFiles(files.filter((_, j) => j !== i))}><X className="size-4" /></button></li>)}</ul>}
        </div>
        {err && <div className="sm:col-span-2"><Alert tone="red">{err}</Alert></div>}
      </div>
    </Modal>
  );
}
