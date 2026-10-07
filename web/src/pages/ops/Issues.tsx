import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Bell, BellOff, Download, FileText, Info, Mic, Paperclip, Pause, Play, Plus, Send, Square, Trash2, X } from 'lucide-react';
import { get, patch, post } from '../../api';
import { useAuth } from '../../auth';
import { fmtBytes, fmtDateTime, fmtNum, useI18n } from '../../i18n';
import { Alert, Badge, Button, cx, Details, Field, IconButton, Modal, PageHeader, SidePanel, Spinner, StatCard, StatGrid, Switch, Tabs, toneIf, useAction, useErrorText, type Tone } from '../../ui/kit';
import { RiderPicker } from '../../ui/forms';
import { useCityName } from '../../ui/common';

const STATUS_TONE: Record<string, Tone> = { open: 'blue', in_progress: 'amber', resolved: 'green', closed: 'grey' };
const PRIORITY_TONE: Record<string, Tone> = { high: 'amber', urgent: 'red' };
const CATEGORIES = ['account', 'performance', 'attendance', 'payment', 'vehicle', 'app', 'other'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const STATUSES = ['open', 'in_progress', 'resolved', 'closed'];

// Filters stay as long as the tab is open.
function useTabState<T>(key: string, initial: T) {
  const [v, setV] = useState<T>(() => { try { const s = sessionStorage.getItem(key); return s ? JSON.parse(s) : initial; } catch { return initial; } });
  useEffect(() => { try { sessionStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ } }, [key, v]);
  return [v, setV] as const;
}
function ago(t: (k: string, v?: any) => string, at: string) {
  const s = Math.max(0, (Date.now() - Date.parse(at.replace(' ', 'T') + 'Z')) / 1000);
  if (s < 60) return t('iss.just_now');
  if (s < 3600) return t('iss.min_ago', { n: Math.floor(s / 60) });
  if (s < 86400) return t('iss.h_ago', { n: Math.floor(s / 3600) });
  return t('iss.d_ago', { n: Math.floor(s / 86400) });
}
function beep() {
  try {
    const ctx = new AudioContext(); const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = 880; g.gain.value = 0.08; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.18);
  } catch { /* no audio */ }
}

export function IssuesInbox() {
  const { id } = useParams();
  const { t, dir } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useTabState('lsp.issues.filters', { search: '', assignee: '', status: '', category: '', priority: '', unread: false, page: 1 });
  const [showFilters, setShowFilters] = useState(false);
  const [data, setData] = useState<any>(null);
  const [alerts, setAlerts] = useState(() => { try { return localStorage.getItem('lsp.issue_alerts') === '1'; } catch { return false; } });
  const [creating, setCreating] = useState(false);
  const lastUnread = useRef<number | null>(null);
  const load = useCallback(async () => {
    const d = await get('/issues', { search: f.search, assignee: f.assignee, status: f.status, category: f.category, priority: f.priority, unread: f.unread ? 1 : undefined, page: f.page }).catch(() => null);
    if (!d) return;
    setData(d);
    // a new rider message while the tab is in the background
    if (alerts && lastUnread.current !== null && d.stats.unread > lastUnread.current && document.hidden) {
      beep();
      const title = document.title; let n = 0;
      const h = setInterval(() => { document.title = n++ % 2 ? title : `● ${t('iss.new_message')}`; if (!document.hidden || n > 20) { clearInterval(h); document.title = title; } }, 1000);
      if ('Notification' in window && Notification.permission === 'granted') new Notification(t('iss.new_message'));
    }
    lastUnread.current = d.stats.unread;
  }, [f, alerts, t]);
  useEffect(() => { const h = setTimeout(load, 200); const p = setInterval(load, 10000); return () => { clearTimeout(h); clearInterval(p); }; }, [load]);
  const set = (patch: Partial<typeof f>) => setF({ ...f, page: 1, ...patch });
  const toggleAlerts = async () => {
    const on = !alerts;
    if (on && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission().catch(() => {});
    setAlerts(on);
    try { localStorage.setItem('lsp.issue_alerts', on ? '1' : '0'); } catch { /* ignore */ }
  };
  const s = data?.stats ?? {};
  const card = (k: string, label: string, tone: Tone) => <StatCard label={label} value={fmtNum(s[k])} tone={toneIf(s[k], tone)}
    active={k === 'unread' ? f.unread : f.status === k} onClick={() => (k === 'unread' ? set({ unread: !f.unread }) : set({ status: f.status === k ? '' : k }))} />;
  const pages = data ? Math.max(1, Math.ceil(data.total / 30)) : 1;
  const Back = dir === 'rtl' ? ArrowRight : ArrowLeft;
  return (
    <>
      <PageHeader title={t('iss.title')} actions={<>
        <Button icon={alerts ? <Bell className="size-4" /> : <BellOff className="size-4" />} onClick={toggleAlerts}>{alerts ? t('iss.alerts_on') : t('iss.alerts_off')}</Button>
        {can('rider_portal.manage_issues') && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>{t('iss.new')}</Button>}
      </>} />
      <StatGrid>{card('open', t('iss.s.open'), 'blue')}{card('in_progress', t('iss.s.in_progress'), 'amber')}{card('unread', t('iss.c.unread'), 'red')}{card('resolved', t('iss.s.resolved'), 'green')}</StatGrid>
      <div className="grid gap-4 lg:grid-cols-[minmax(300px,380px)_1fr]">
        <aside className={cx('flex min-h-[60vh] flex-col overflow-hidden rounded-xl border border-zinc-200/80 bg-white shadow-xs dark:border-zinc-800 dark:bg-zinc-900', id && 'hidden lg:flex')}>
          <div className="space-y-2 border-b border-zinc-100 p-3 dark:border-zinc-800">
            <input type="search" className="input" placeholder={t('iss.search_hint')} value={f.search} onChange={(e) => set({ search: e.target.value })} />
            <div className="flex flex-wrap items-center gap-1">
              {[['', t('common.all')], ['mine', t('iss.mine')], ['unassigned', t('iss.unassigned')]].map(([k, l]) => (
                <button key={k} onClick={() => set({ assignee: k })} className={cx('rounded-md px-2.5 py-1 text-xs font-medium', f.assignee === k ? 'bg-brand text-white' : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800')}>{l}</button>
              ))}
              <Button size="sm" variant="ghost" className="ms-auto" onClick={() => setShowFilters(!showFilters)}>{t('iss.filters')}</Button>
            </div>
            {showFilters && (
              <div className="grid grid-cols-2 gap-2 text-xs">
                {([['status', STATUSES, 'iss.s'], ['category', CATEGORIES, 'iss.cat'], ['priority', PRIORITIES, 'iss.p']] as const).map(([k, opts, pre]) => (
                  <select key={k} className="input py-1.5" value={(f as any)[k]} onChange={(e) => set({ [k]: e.target.value } as any)}>
                    <option value="">{t(`iss.${k}`)}: {t('common.all')}</option>{opts.map((o) => <option key={o} value={o}>{t(`${pre}.${o}`)}</option>)}
                  </select>
                ))}
                <label className="flex items-center gap-2"><input type="checkbox" checked={f.unread} onChange={(e) => set({ unread: e.target.checked })} />{t('iss.unread_only')}</label>
                <Button size="sm" variant="ghost" className="col-span-2 text-red-600" onClick={() => set({ status: '', category: '', priority: '', unread: false, assignee: '', search: '' })}>{t('table.clear_filters')}</Button>
              </div>
            )}
          </div>
          <ul className="scroll-thin flex-1 divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-800">
            {!data && <li className="flex justify-center p-6"><Spinner /></li>}
            {data?.rows.length === 0 && <li className="p-6 text-center text-sm text-zinc-500">{t('iss.none')}</li>}
            {data?.rows.map((r: any) => (
              <li key={r.id}>
                <button onClick={() => nav(`/admin/rider-issues/${r.id}`)} className={cx('block w-full px-3 py-2.5 text-start transition hover:bg-zinc-50 dark:hover:bg-zinc-800/50', String(r.id) === id && 'bg-brand-soft')}>
                  <div className="flex items-center gap-2">
                    <span className={cx('truncate text-sm', r.unread ? 'font-semibold' : 'font-medium')}>{r.full_name}</span>
                    <span className="text-xs text-zinc-500 num">#{r.rider_id}</span>
                    <span className="ms-auto shrink-0 text-[11px] text-zinc-500">{ago(t, r.last_activity_at)}</span>
                  </div>
                  <div className="truncate text-xs font-medium text-zinc-700 dark:text-zinc-300">{r.subject}</div>
                  <div className="truncate text-xs text-zinc-500" dir="auto">{r.last_internal ? `🔒 ${r.last_body}` : r.last_body || '📎'}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <Badge tone={STATUS_TONE[r.status]}>{t(`iss.s.${r.status}`)}</Badge>
                    {PRIORITY_TONE[r.priority] && <Badge tone={PRIORITY_TONE[r.priority]}>{t(`iss.p.${r.priority}`)}</Badge>}
                    <span className="text-[11px] text-zinc-500">{t(`iss.cat.${r.category}`)}{r.assignee_name && ` · ${r.assignee_name}`}</span>
                    {r.unread > 0 && <span className="ms-auto rounded-full bg-red-600 px-1.5 text-[10px] font-semibold text-white num">{r.unread}</span>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
          {pages > 1 && <div className="flex items-center justify-between border-t border-zinc-100 p-2 text-xs dark:border-zinc-800">
            <Button size="sm" disabled={f.page <= 1} onClick={() => setF({ ...f, page: f.page - 1 })}>{t('table.previous')}</Button>
            <span>{t('table.page_of', { page: f.page, totalPages: pages })}</span>
            <Button size="sm" disabled={f.page >= pages} onClick={() => setF({ ...f, page: f.page + 1 })}>{t('table.next')}</Button>
          </div>}
        </aside>
        <section className={cx('min-h-[60vh] overflow-hidden rounded-xl border border-zinc-200/80 bg-white shadow-xs dark:border-zinc-800 dark:bg-zinc-900', !id && 'hidden lg:block')}>
          {id ? <Conversation key={id} id={Number(id)} onChanged={load} back={<Button size="sm" variant="ghost" className="lg:hidden" icon={<Back className="size-3.5" />} onClick={() => nav('/admin/rider-issues')}>{t('iss.back')}</Button>} />
            : <div className="flex h-full min-h-[60vh] items-center justify-center p-6 text-sm text-zinc-500">{t('iss.pick')}</div>}
        </section>
      </div>
      {creating && <NewConversation onClose={() => setCreating(false)} onCreated={(nid) => { setCreating(false); load(); nav(`/admin/rider-issues/${nid}`); }} />}
    </>
  );
}

type Msg = { id: number; author: 'rider' | 'staff'; body: string | null; internal: number; created_at: string; user_name?: string; files: any[]; local?: 'sending' | 'failed'; retry?: FormData };

function Conversation({ id, onChanged, back }: { id: number; onChanged: () => void; back: ReactNode }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const [issue, setIssue] = useState<any>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [more, setMore] = useState(true);
  const [panel, setPanel] = useState(false);
  const [online, setOnline] = useState(true);
  const end = useRef<HTMLDivElement>(null);
  const lastRead = useRef(0);
  const lastId = msgs.filter((m) => !m.local).at(-1)?.id ?? 0;
  const load = useCallback(async () => {
    const d = await get(`/issues/${id}`);
    setIssue(d); setMsgs(d.list); setMore(d.list.length >= 50);
  }, [id]);
  useEffect(() => { load().catch(() => {}); }, [load]);
  // new messages arrive by polling
  useEffect(() => {
    const h = setInterval(async () => {
      try {
        const d = await get(`/issues/${id}`, { after: lastId || undefined });
        setOnline(true);
        const { list, ...rest } = d;
        setIssue(rest);
        if (list.length) setMsgs((m) => [...m.filter((x) => !list.some((y: Msg) => y.id === x.id)), ...list]);
      } catch { setOnline(false); }
    }, 4000);
    return () => clearInterval(h);
  }, [id, lastId]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs.length]);
  // read when the last message is on screen and the tab is visible
  useEffect(() => {
    const mark = () => { if (lastId && lastId !== lastRead.current && document.visibilityState === 'visible') { lastRead.current = lastId; post(`/issues/${id}/read`).then(onChanged).catch(() => {}); } };
    mark();
    document.addEventListener('visibilitychange', mark);
    return () => document.removeEventListener('visibilitychange', mark);
  }, [id, lastId, onChanged]);
  const earlier = async () => {
    const first = msgs.find((m) => !m.local)?.id;
    const d = await get(`/issues/${id}`, { before: first });
    setMsgs((m) => [...d.list, ...m]); setMore(d.list.length >= 50);
  };
  const send = async (fd: FormData, preview: Msg) => {
    const tmp = { ...preview, local: 'sending' as const, retry: fd };
    setMsgs((m) => [...m, tmp]);
    try {
      await post(`/issues/${id}/messages`, fd);
      setMsgs((m) => m.filter((x) => x !== tmp));
      const d = await get(`/issues/${id}`, { after: lastId || undefined });
      const { list, ...rest } = d;
      setIssue(rest); setMsgs((m) => [...m.filter((x) => !list.some((y: Msg) => y.id === x.id)), ...list]);
      onChanged();
      return true;
    } catch { setMsgs((m) => m.map((x) => (x === tmp ? { ...x, local: 'failed' } : x))); return false; }
  };
  if (!issue) return <div className="flex h-full min-h-[60vh] items-center justify-center"><Spinner /></div>;
  const readByRider = (m: Msg) => issue.rider_read_at && issue.rider_read_at >= m.created_at;
  return (
    <div className="flex h-[70vh] flex-col">
      <header className="flex items-center gap-2 border-b border-zinc-100 px-3 py-2.5 dark:border-zinc-800">
        {back}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><span className="truncate font-semibold">{issue.full_name}</span><span className="text-xs text-zinc-500 num">#{issue.rider_id}</span><Badge tone={STATUS_TONE[issue.status]}>{t(`iss.s.${issue.status}`)}</Badge></div>
          <div className="truncate text-xs text-zinc-500"><span className="num">#{issue.id}</span> · {issue.subject} · <span className={online ? 'text-emerald-600' : 'text-amber-600'}>{online ? t('iss.live') : t('iss.reconnecting')}</span></div>
        </div>
        <IconButton title={t('iss.details')} onClick={() => setPanel(true)}><Info /></IconButton>
      </header>
      <div className="scroll-thin flex-1 space-y-3 overflow-y-auto bg-zinc-50/60 p-3 dark:bg-zinc-950/40">
        {more && <div className="text-center"><Button size="sm" variant="ghost" onClick={earlier}>{t('iss.earlier')}</Button></div>}
        {msgs.map((m, i) => {
          const mine = m.author === 'staff';
          return (
            <div key={m.local ? `l${i}` : m.id} className={cx('flex', mine ? 'justify-end' : 'justify-start')}>
              <div className={cx('max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-xs', m.internal ? 'border border-dashed border-amber-400 bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100'
                : mine ? 'bg-brand text-white' : 'bg-white ring-1 ring-zinc-200 dark:bg-zinc-800 dark:ring-zinc-700')}>
                {m.internal ? <div className="mb-0.5 text-[10px] font-semibold uppercase">{t('iss.internal_note')}</div> : null}
                {m.body && <div className="whitespace-pre-wrap break-words" dir="auto">{m.body}</div>}
                {m.files.length > 0 && <div className="mt-1.5 space-y-1.5">{m.files.map((f) => <FileChip key={f.id} f={f} light={mine && !m.internal} />)}</div>}
                <div className={cx('mt-1 flex items-center gap-1.5 text-[10px]', mine && !m.internal ? 'text-white/70' : 'text-zinc-500')}>
                  {mine && m.user_name && <span>{m.user_name} ·</span>}<span className="num">{fmtDateTime(m.created_at)}</span>
                  {mine && !m.internal && !m.local && <span>· {readByRider(m) ? t('iss.read') : t('iss.sent')}</span>}
                  {m.local === 'sending' && <span>· {t('iss.sending')}</span>}
                </div>
                {m.local === 'failed' && <div className="mt-1 flex items-center gap-2 text-xs"><span className="font-semibold">{t('iss.not_sent')}</span>
                  <button className="underline" onClick={() => { setMsgs((x) => x.filter((y) => y !== m)); send(m.retry!, m); }}>{t('iss.retry')}</button>
                  <button className="underline" onClick={() => setMsgs((x) => x.filter((y) => y !== m))}>{t('iss.discard')}</button></div>}
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      {can('rider_portal.manage_issues') ? <Composer onSend={send} /> : <div className="border-t border-zinc-100 p-3 text-xs text-zinc-500 dark:border-zinc-800">{t('iss.no_manage')}</div>}
      <DetailsPanel open={panel} issue={issue} files={msgs.flatMap((m) => m.files)} onClose={() => setPanel(false)} onChanged={() => { load(); onChanged(); }} />
    </div>
  );
}

function FileChip({ f, light }: { f: any; light?: boolean }) {
  const { t } = useI18n();
  const src = `/api/attachments/${f.id}/file`;
  if (f.mime.startsWith('image/')) return <a href={src} target="_blank" rel="noreferrer"><img src={src} alt={f.file_name} className="max-h-56 rounded-lg" /></a>;
  if (f.mime.startsWith('audio/')) return <div><audio controls src={src} className="h-9 max-w-64" />{f.attachment_type === 'voice' && <div className="text-[10px] opacity-70">{t('iss.voice_message')} · {t('iss.no_transcript')}</div>}</div>;
  if (f.mime.startsWith('video/')) return <video controls src={src} className="max-h-56 rounded-lg" />;
  return <a href={src} target="_blank" rel="noreferrer" className={cx('flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs', light ? 'bg-white/15' : 'bg-zinc-100 dark:bg-zinc-700')}>
    <FileText className="size-4 shrink-0" /><span className="truncate">{f.file_name}</span><span className="shrink-0 opacity-70 num">{fmtBytes(f.size)}</span><Download className="size-3.5 shrink-0" /></a>;
}

function Composer({ onSend }: { onSend: (fd: FormData, preview: Msg) => Promise<boolean> }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [internal, setInternal] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const rec = useRecorder();
  const add = (list: FileList | File[]) => {
    const all = [...files, ...Array.from(list)];
    if (all.length > 10) { setErr(t('iss.max_files')); return; }
    if (all.some((f) => f.size > 25 * 1024 * 1024)) { setErr(t('err.file_too_large', { max: 25 })); return; }
    setErr(null); setFiles(all);
  };
  const submit = async (voice?: Blob) => {
    if (!voice && !text.trim() && !files.length) return;
    if (text.length > 5000) { setErr(t('err.too_long')); return; }
    const fd = new FormData();
    if (!voice) fd.append('body', text);
    if (internal && !voice) fd.append('internal', '1');
    const sent = voice ? [new File([voice], `voice-${Date.now()}.webm`, { type: voice.type || 'audio/webm' })] : files;
    for (const f of sent) fd.append('files', f);
    const preview: Msg = { id: 0, author: 'staff', body: voice ? null : text, internal: internal && !voice ? 1 : 0, created_at: new Date().toISOString().slice(0, 19).replace('T', ' '), files: sent.map((f, i) => ({ id: -i, file_name: f.name, mime: 'application/octet-stream', size: f.size })) };
    if (!voice) { setText(''); setFiles([]); }
    await onSend(fd, preview);
  };
  if (rec.state !== 'idle') return (
    <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 p-3 dark:border-zinc-800">
      <span className="flex items-center gap-1.5 text-sm"><span className={cx('size-2.5 rounded-full', rec.state === 'recording' ? 'animate-pulse bg-red-500' : 'bg-zinc-400')} /><span className="num">{rec.time}</span></span>
      {rec.state === 'recording' && <Button size="sm" icon={<Pause className="size-3.5" />} onClick={rec.pause}>{t('iss.pause')}</Button>}
      {rec.state === 'paused' && <Button size="sm" icon={<Play className="size-3.5" />} onClick={rec.resume}>{t('iss.resume')}</Button>}
      {rec.state !== 'stopped' && <Button size="sm" icon={<Square className="size-3.5" />} onClick={rec.stop}>{t('iss.stop_listen')}</Button>}
      {rec.state === 'stopped' && rec.url && <audio controls src={rec.url} className="h-9" />}
      <div className="ms-auto flex gap-2">
        <Button size="sm" variant="ghost" className="text-red-600" icon={<Trash2 className="size-3.5" />} onClick={rec.reset}>{t('iss.delete_recording')}</Button>
        {rec.state === 'stopped' && <Button size="sm" variant="primary" icon={<Send className="size-3.5" />} onClick={async () => { const b = rec.blob; rec.reset(); if (b) await submit(b); }}>{t('iss.send_voice')}</Button>}
      </div>
    </div>
  );
  return (
    <div className={cx('border-t p-3', internal ? 'border-amber-300 bg-amber-50/50 dark:bg-amber-950/20' : 'border-zinc-100 dark:border-zinc-800')}
      onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) add(e.dataTransfer.files); }}>
      {files.length > 0 && <div className="mb-2 flex flex-wrap gap-1.5">{files.map((f, i) => (
        <span key={i} className="flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-1 text-xs dark:bg-zinc-800">{f.name}<button onClick={() => setFiles(files.filter((_, j) => j !== i))}><X className="size-3" /></button></span>
      ))}</div>}
      {err && <p className="mb-1 text-xs text-red-600">{err}</p>}
      <div className="flex items-end gap-2">
        <IconButton title={t('iss.attach')} onClick={() => input.current?.click()}><Paperclip /></IconButton>
        <textarea className="input max-h-40 min-h-10 flex-1 resize-y" rows={1} maxLength={5000} dir="auto" placeholder={internal ? t('iss.internal_placeholder') : t('iss.reply_placeholder')} value={text}
          onChange={(e) => setText(e.target.value)} onPaste={(e) => { const imgs = Array.from(e.clipboardData.files); if (imgs.length) { e.preventDefault(); add(imgs); } }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }} />
        {!text && !files.length && !internal && rec.supported
          ? <IconButton title={t('iss.record_voice')} onClick={async () => { if (!(await rec.start())) setErr(t('iss.mic_blocked')); }}><Mic /></IconButton>
          : <Button variant={internal ? 'warn' : 'primary'} icon={<Send className="size-4" />} onClick={() => submit()}>{internal ? t('iss.save_note') : t('iss.send')}</Button>}
      </div>
      <div className="mt-2"><Switch checked={internal} onChange={setInternal} label={<span className="text-xs">{t('iss.internal_note')}</span>} /></div>
      <input ref={input} type="file" hidden multiple onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ''; }} />
    </div>
  );
}

// Voice messages: pause, resume, listen before sending; stops by itself at five minutes.
function useRecorder() {
  const [state, setState] = useState<'idle' | 'recording' | 'paused' | 'stopped'>('idle');
  const [secs, setSecs] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const r = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const supported = typeof window !== 'undefined' && 'MediaRecorder' in window && !!navigator.mediaDevices;
  useEffect(() => {
    if (state !== 'recording') return;
    const h = setInterval(() => setSecs((s) => { if (s + 1 >= 300) r.current?.stop(); return s + 1; }), 1000);
    return () => clearInterval(h);
  }, [state]);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  useEffect(() => { if (!blob) { setBlobUrl(null); return; } const u = URL.createObjectURL(blob); setBlobUrl(u); return () => URL.revokeObjectURL(u); }, [blob]);
  return {
    supported, state, blob, url: blobUrl, time: `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`,
    start: async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const m = new MediaRecorder(stream);
        chunks.current = [];
        m.ondataavailable = (e) => chunks.current.push(e.data);
        m.onstop = () => { setBlob(new Blob(chunks.current, { type: m.mimeType || 'audio/webm' })); setState('stopped'); stream.getTracks().forEach((tr) => tr.stop()); };
        r.current = m; m.start(); setSecs(0); setState('recording');
        return true;
      } catch { return false; }
    },
    pause: () => { r.current?.pause(); setState('paused'); },
    resume: () => { r.current?.resume(); setState('recording'); },
    stop: () => r.current?.stop(),
    reset: () => { if (r.current?.state !== 'inactive') { r.current!.onstop = null; r.current?.stop(); r.current?.stream.getTracks().forEach((tr) => tr.stop()); } setBlob(null); setState('idle'); setSecs(0); },
  };
}

function DetailsPanel({ open, issue, files, onClose, onChanged }: { open: boolean; issue: any; files: any[]; onClose: () => void; onChanged: () => void }) {
  const { t } = useI18n();
  const { can, me } = useAuth();
  const run = useAction();
  const errText = useErrorText();
  const city = useCityName();
  const [tab, setTab] = useState('details');
  const [users, setUsers] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) get('/issues/assignees').then(setUsers).catch(() => setUsers([])); }, [open]);
  const manage = can('rider_portal.manage_issues');
  const change = async (k: string, v: unknown) => {
    setErr(null);
    try { await patch(`/issues/${issue.id}`, { [k]: v }); onChanged(); } catch (e) { setErr(errText(e)); onChanged(); }
  };
  const opts = [...users, ...(issue.assignee_id && !users.some((u) => u.id === issue.assignee_id) ? [{ id: issue.assignee_id, full_name: issue.assignee_name }] : [])];
  return (
    <SidePanel open={open} onClose={onClose} title={t('iss.details')}>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'details', label: t('iss.tab_details') }, { key: 'files', label: t('iss.tab_files') }]} />
      {tab === 'details' ? (
        <div className="space-y-5 text-sm">
          <section className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
            <div className="font-semibold">{issue.full_name} <span className="text-xs text-zinc-500 num">#{issue.rider_id}</span></div>
            <div className="mt-1 text-xs text-zinc-500">{t(`rider.status.${issue.rider_status}`)} · <span className="num">{issue.phone ?? '—'}</span> · {issue.company_name ?? '—'} · {issue.city_ar ? city(issue) : '—'}</div>
            <div className="mt-2 flex flex-wrap gap-3 text-xs">
              <Link className="text-brand hover:underline" to={`/admin/riders/${issue.rider_id}`}>{t('iss.rider_profile')}</Link>
              <Link className="text-brand hover:underline" to={`/admin/rider-change-requests?rider=${issue.rider_id}&status=any`}>{t('iss.change_requests')}</Link>
            </div>
          </section>
          {manage && (
            <section className="space-y-3">
              <h4 className="font-semibold">{t('iss.handling')}</h4>
              {err && <Alert tone="red">{err}</Alert>}
              <Field label={t('iss.status')}><select className="input" value={issue.status} onChange={(e) => change('status', e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{t(`iss.s.${s}`)}</option>)}</select></Field>
              <Field label={t('iss.priority')}><select className="input" value={issue.priority} onChange={(e) => change('priority', e.target.value)}>{PRIORITIES.map((s) => <option key={s} value={s}>{t(`iss.p.${s}`)}</option>)}</select></Field>
              <Field label={t('iss.assignee')}>
                <div className="flex gap-2">
                  <select className="input" value={issue.assignee_id ?? ''} onChange={(e) => change('assignee_id', e.target.value || null)}>
                    <option value="">{t('iss.unassigned')}</option>{opts.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                  </select>
                  {issue.assignee_id !== me?.id && <Button size="sm" onClick={() => run(() => change('assignee_id', me?.id))}>{t('iss.assign_me')}</Button>}
                </div>
              </Field>
            </section>
          )}
          <section>
            <h4 className="mb-2 font-semibold">{t('iss.conversation')}</h4>
            <Details cols={1} rows={[[t('iss.category'), t(`iss.cat.${issue.category}`)], [t('iss.status'), t(`iss.s.${issue.status}`)], [t('iss.priority'), t(`iss.p.${issue.priority}`)],
              [t('iss.assignee'), issue.assignee_name ?? t('iss.unassigned')], [t('iss.opened_by'), t(`iss.by.${issue.opened_by}`)],
              [t('iss.created'), <span className="num">{fmtDateTime(issue.created_at)}</span>], [t('iss.last_activity'), <span className="num">{fmtDateTime(issue.last_activity_at)}</span>],
              [t('iss.resolved_at'), issue.resolved_at && <span className="num">{fmtDateTime(issue.resolved_at)}</span>], [t('iss.closed_at'), issue.closed_at && <span className="num">{fmtDateTime(issue.closed_at)}</span>],
              [t('iss.messages'), fmtNum(issue.messages)]]} />
          </section>
        </div>
      ) : (
        <ul className="space-y-2 text-sm">
          {files.length === 0 && <li className="text-zinc-500">{t('files.none')}</li>}
          {[...files].reverse().filter((f) => f.id > 0).map((f) => (
            <li key={f.id} className="flex items-center gap-2"><FileText className="size-4 text-zinc-400" /><span className="min-w-0 flex-1 truncate">{f.file_name}</span>
              <a className="text-brand" href={`/api/attachments/${f.id}/file?download=1`}><Download className="size-4" /></a></li>
          ))}
        </ul>
      )}
    </SidePanel>
  );
}

function NewConversation({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const { t } = useI18n();
  const errText = useErrorText();
  const [v, setV] = useState({ rider_id: '' as string | number, category: 'other', priority: 'normal', subject: '', body: '' });
  const [files, setFiles] = useState<File[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const start = async () => {
    const fd = new FormData();
    Object.entries(v).forEach(([k, x]) => fd.append(k, String(x)));
    files.forEach((f) => fd.append('files', f));
    setBusy(true); setErr(null);
    try { const r = await post('/issues', fd); onCreated(r.id); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={t('iss.new')} wide footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={busy} onClick={start}>{t('iss.start')}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {err && <div className="sm:col-span-2"><Alert tone="red">{err}</Alert></div>}
        <Field label={t('iss.rider')} required className="sm:col-span-2"><RiderPicker value={v.rider_id} onChange={(id) => setV({ ...v, rider_id: id ?? '' })} /></Field>
        <Field label={t('iss.category')}><select className="input" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c} value={c}>{t(`iss.cat.${c}`)}</option>)}</select></Field>
        <Field label={t('iss.priority')}><select className="input" value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })}>{PRIORITIES.map((c) => <option key={c} value={c}>{t(`iss.p.${c}`)}</option>)}</select></Field>
        <Field label={t('iss.subject')} required hint={t('iss.subject_hint')} className="sm:col-span-2"><input className="input" maxLength={200} value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} /></Field>
        <Field label={t('iss.message')} className="sm:col-span-2"><textarea className="input" rows={4} maxLength={5000} dir="auto" value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} /></Field>
        <div className="sm:col-span-2"><input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 10))} className="text-sm" /></div>
      </div>
    </Modal>
  );
}
