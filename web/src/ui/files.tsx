import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Copy, Download, ExternalLink, Eye, EyeOff, FileText, Maximize2, Minimize2, Paperclip, RefreshCw, ScanLine, Star, Trash2, Upload, X } from 'lucide-react';
import { del, get, post } from '../api';
import { useAuth } from '../auth';
import { fmtBytes, fmtDateTime, useI18n } from '../i18n';
import { Alert, Badge, Button, Card, cx, IconButton, Spinner, useAction, useErrorText, useUi } from './kit';

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,application/pdf';
type Att = { id: number; attachment_type: string | null; file_name: string; mime: string; size: number; note: string | null; is_current: number; created_at: string; uploaded_by_name?: string };

export function FilePreview({ src, mime, onClose }: { src: string; mime: string; onClose?: () => void }) {
  const { t } = useI18n();
  const [big, setBig] = useState(false);
  return (
    <div className="mt-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-950">
      <div className="mb-2 flex justify-end gap-1">
        <IconButton title={big ? t('files.shrink') : t('files.enlarge')} onClick={() => setBig(!big)}>{big ? <Minimize2 /> : <Maximize2 />}</IconButton>
        {onClose && <IconButton title={t('files.hide_preview')} onClick={onClose}><EyeOff /></IconButton>}
      </div>
      {mime === 'application/pdf'
        ? <iframe src={src} className={cx('w-full rounded bg-white', big ? 'h-[80vh]' : 'h-96')} />
        : <img src={src} alt="" className={cx('mx-auto rounded object-contain', big ? 'max-h-[80vh]' : 'max-h-80')} />}
    </div>
  );
}

// "Attached files": every record's view screen has one. The newest file of a type is "Current".
export function Attachments({ entityType, entityId, title, attachmentType, downloadName, canUpload = true }: {
  entityType: string; entityId: string | number; title?: ReactNode; attachmentType?: string; downloadName?: string; canUpload?: boolean;
}) {
  const { t } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const { confirm } = useUi();
  const [files, setFiles] = useState<Att[] | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const load = useCallback(() => get<Att[]>('/attachments', { entity_type: entityType, entity_id: entityId }).then(setFiles).catch(() => setFiles([])), [entityType, entityId]);
  useEffect(() => { if (can('attachments.view')) load(); }, [load, can]);
  if (!can('attachments.view')) return null;

  const uploadFile = async (f: File) => {
    const fd = new FormData();
    fd.append('file', f); fd.append('entity_type', entityType); fd.append('entity_id', String(entityId));
    if (attachmentType) fd.append('attachment_type', attachmentType);
    if (note) fd.append('note', note);
    setBusy(true);
    const ok = await run(() => post('/attachments', fd), t('files.uploaded'));
    setBusy(false);
    if (ok) { setNote(''); load(); }
  };
  const url = (a: Att, dl = false) => `/api/attachments/${a.id}/file${dl ? `?download=1${downloadName ? `&name=${encodeURIComponent(downloadName)}` : ''}` : ''}`;
  const copyImage = async (a: Att) => {
    await run(async () => {
      const blob = await (await fetch(url(a))).blob();
      const png = blob.type === 'image/png' ? blob : await toPng(blob);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    }, t('files.copied'));
  };
  const list = (files ?? []).filter((f) => !attachmentType || f.attachment_type === attachmentType);

  return (
    <Card title={title ?? t('files.attached_files')} actions={canUpload && can('attachments.upload') && (
      <div className="flex flex-wrap items-center gap-2">
        <input className="input w-48 py-1.5 text-xs" placeholder={t('files.note')} value={note} maxLength={255} onChange={(e) => setNote(e.target.value)} />
        <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadFile(f); }} />
        <Button size="sm" icon={<Paperclip className="size-3.5" />} loading={busy} onClick={() => input.current?.click()}>{t('files.attach')}</Button>
      </div>
    )}>
      {files === null ? <Spinner /> : list.length === 0 ? <p className="text-sm text-zinc-500">{t('files.none')}</p> : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {list.map((a) => (
            <li key={a.id} className="py-2">
              <div className="flex flex-wrap items-center gap-2">
                <FileText className="size-4 text-zinc-400" />
                <span className="min-w-0 flex-1 truncate text-sm">{a.file_name}</span>
                {!!a.is_current && <Badge tone="green">{t('files.current')}</Badge>}
                <span className="text-xs text-zinc-500 num">{fmtBytes(a.size)} · {fmtDateTime(a.created_at)}</span>
                <IconButton title={preview === a.id ? t('files.hide_preview') : t('files.preview')} onClick={() => setPreview(preview === a.id ? null : a.id)}>{preview === a.id ? <EyeOff /> : <Eye />}</IconButton>
                {can('attachments.download') && <a href={url(a, true)}><IconButton title={t('files.download')}><Download /></IconButton></a>}
                {a.mime.startsWith('image/') && <IconButton title={t('files.copy_image')} onClick={() => copyImage(a)}><Copy /></IconButton>}
                <a href={url(a)} target="_blank" rel="noreferrer"><IconButton title={t('files.open')}><ExternalLink /></IconButton></a>
                {!a.is_current && can('attachments.upload') && (
                  <IconButton title={t('files.make_current')} onClick={async () => { if (await run(() => post(`/attachments/${a.id}/current`))) load(); }}><Star /></IconButton>
                )}
                {can('attachments.delete') && (
                  <IconButton title={t('files.delete')} tone="red" onClick={async () => {
                    if (!(await confirm({ title: t('files.delete_q'), body: a.file_name, confirm: t('files.delete_permanently') }))) return;
                    if (await run(() => del(`/attachments/${a.id}`), t('files.deleted'))) load();
                  }}><Trash2 /></IconButton>
                )}
              </div>
              {a.note && <p className="ms-6 text-xs text-zinc-500">{a.note}</p>}
              {preview === a.id && <FilePreview src={url(a)} mime={a.mime} onClose={() => setPreview(null)} />}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
async function toPng(blob: Blob) {
  const img = await createImageBitmap(blob);
  const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
  c.getContext('2d')!.drawImage(img, 0, 0);
  return new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
}

// ---------- a document scan attached inside a form, read to fill the fields ----------
export type Scan = { token: string; name: string; size: number; mime: string };
export function ScanUpload({ value, onChange, title, autoRead = true, disabled }: { value: Scan | null; onChange: (s: Scan | null) => void; title?: ReactNode; autoRead?: boolean; disabled?: boolean }) {
  const { t } = useI18n();
  const errText = useErrorText();
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [readState, setReadState] = useState<null | 'unavailable' | 'nothing' | string>(null);
  const [preview, setPreview] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const read = async (s: Scan) => {
    setReading(true);
    try {
      const r = await post<{ status: string; fields: unknown[] }>(`/scans/${s.token}/read`);
      setReadState(r.status === 'ok' ? (r.fields.length ? null : 'nothing') : r.status);
    } catch (e) { setErr(errText(e)); }
    finally { setReading(false); }
  };
  const uploadFile = async (f: File) => {
    setErr(null); setReadState(null);
    const fd = new FormData();
    fd.append('file', f);
    setBusy(true);
    try {
      const s = await post<Scan>('/scans', fd);
      onChange(s);
      if (autoRead) read(s);
    } catch (e) { setErr(errText(e)); }
    finally { setBusy(false); }
  };
  return (
    <div>
      {!value ? (
        <button type="button" disabled={disabled || busy}
          onClick={() => input.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) uploadFile(f); }}
          className="flex w-full flex-col items-center gap-1 rounded-lg border-2 border-dashed border-zinc-300 px-4 py-5 text-center text-sm text-zinc-600 transition hover:border-brand hover:bg-brand-soft disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300">
          {busy ? <Spinner /> : <Upload className="size-5 text-zinc-400" />}
          <span className="font-medium">{title ?? t('scan.choose')}</span>
          <span className="text-xs text-zinc-500">{t('scan.hint')}</span>
        </button>
      ) : (
        <div className="rounded-lg border border-zinc-200 p-2 dark:border-zinc-700">
          <div className="flex items-center gap-2 text-sm">
            <ScanLine className="size-4 text-zinc-400" />
            <span className="min-w-0 flex-1 truncate">{value.name}</span>
            <span className="text-xs text-zinc-500 num">{fmtBytes(value.size)}</span>
            <IconButton title={t('scan.read_again')} onClick={() => read(value)} disabled={reading}><RefreshCw /></IconButton>
            <IconButton title={preview ? t('files.hide_preview') : t('files.preview')} onClick={() => setPreview(!preview)}>{preview ? <EyeOff /> : <Eye />}</IconButton>
            <IconButton title={t('scan.remove')} tone="red" onClick={() => { del(`/scans/${value.token}`).catch(() => {}); onChange(null); setReadState(null); }}><X /></IconButton>
          </div>
          {reading && <div className="mt-2 h-1.5 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-800"><div className="h-full w-1/3 animate-pulse rounded bg-brand" /></div>}
          {readState === 'unavailable' && <div className="mt-2"><Alert tone="amber">{t('scan.unavailable')}</Alert></div>}
          {readState === 'nothing' && <div className="mt-2"><Alert tone="amber">{t('scan.nothing_read')}</Alert></div>}
          {preview && <FilePreview src={`/api/scans/${value.token}`} mime={value.mime} />}
        </div>
      )}
      <input ref={input} type="file" hidden accept={ACCEPT} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadFile(f); }} />
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
    </div>
  );
}
