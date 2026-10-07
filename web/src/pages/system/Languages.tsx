import { useEffect, useRef, useState } from 'react';
import { Download, Hammer, Pencil, Plus, RotateCcw, Trash2, Upload } from 'lucide-react';
import { del, download, get, post, put } from '../../api';
import { useAuth } from '../../auth';
import { fmtDateTime, fmtNum, useI18n } from '../../i18n';
import { Alert, Badge, Button, Card, Field, IconButton, Loading, PageHeader, SidePanel, StatCard, StatGrid, useAction, useErrorText, useUi } from '../../ui/kit';

// 11.10 Languages & translations.
export function Languages() {
  const { t } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const { confirm, toast } = useUi();
  const [d, setD] = useState<any>(null);
  const [keysOf, setKeysOf] = useState<string | null>(null);
  const [uploadTo, setUploadTo] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const load = () => get('/languages').then(setD);
  useEffect(() => { load(); }, []);
  if (!d) return <Loading />;
  const manage = can('languages.manage');
  const avg = d.languages.length ? d.languages.reduce((s: number, l: any) => s + l.completeness, 0) / d.languages.length : 0;
  return (
    <>
      <PageHeader title={t('lng.title')} subtitle={<span className="flex items-center gap-2">{t('lng.build')}: <Badge tone={d.build.status === 'succeeded' ? 'green' : 'grey'}>{t(`lng.b.${d.build.status}`)}</Badge>{d.build.pending && <Badge tone="amber">{t('lng.unpublished')}</Badge>}</span>} actions={manage && <>
        <Button icon={<Hammer className="size-4" />} variant={d.build.pending ? 'primary' : 'secondary'} onClick={async () => { if (await run(() => post('/languages/rebuild'), t('lng.rebuilt'))) load(); }}>{t('lng.rebuild')}</Button>
        <Button icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>{t('lng.add')}</Button>
      </>} />
      {!manage && <div className="mb-4"><Alert tone="blue">{t('lng.view_only')}</Alert></div>}
      <StatGrid>
        <StatCard label={t('lng.s.languages')} value={fmtNum(d.languages.length)} /><StatCard label={t('lng.s.keys')} value={fmtNum(d.keys)} />
        <StatCard label={t('lng.s.avg')} value={`${fmtNum(avg, 1)}%`} /><StatCard label={t('lng.s.overrides')} value={fmtNum(d.languages.reduce((s: number, l: any) => s + l.overrides, 0))} />
        <StatCard label={t('lng.s.last_build')} value={d.build.at ? <span className="text-sm num">{fmtDateTime(d.build.at)}</span> : '—'} />
      </StatGrid>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {d.languages.map((l: any) => (
          <Card key={l.code} title={<span>{l.flag && `${l.flag} `}{l.name_native} <span className="text-xs font-normal text-zinc-500">{l.name_en} · <code>{l.code}</code></span></span>}
            actions={<><Badge tone="grey">{l.dir === 'rtl' ? t('lng.rtl') : t('lng.ltr')}</Badge><Badge tone={l.builtin ? 'blue' : 'green'}>{l.builtin ? t('lng.builtin') : t('lng.custom')}</Badge>{l.code === 'ar' && <Badge tone="amber">{t('lng.reference')}</Badge>}</>}>
            <div className="mb-1 flex justify-between text-xs"><span>{t('lng.completeness')}</span><span className="num">{l.completeness}%</span></div>
            <div className="h-2 rounded-full bg-zinc-100 dark:bg-zinc-800"><div className="h-2 rounded-full bg-brand" style={{ width: `${l.completeness}%` }} /></div>
            <div className="mt-2 flex gap-4 text-xs text-zinc-500"><span>{t('lng.translated')}: <b className="num">{l.translated}</b></span><span>{t('lng.missing')}: <b className="num">{l.missing}</b></span><span>{t('lng.overrides')}: <b className="num">{l.overrides}</b></span></div>
            <div className="mt-3 flex flex-wrap gap-1">
              <Button size="sm" onClick={() => setKeysOf(l.code)}>{t('lng.view_keys')}</Button>
              {['xlsx', 'csv', 'json'].map((f) => <Button key={f} size="sm" variant="ghost" icon={<Download className="size-3.5" />} onClick={() => run(() => download(`/languages/${l.code}/export`, { format: f }))}>{f.toUpperCase()}</Button>)}
              {manage && l.code !== 'ar' && <Button size="sm" variant="ghost" icon={<Upload className="size-3.5" />} onClick={() => setUploadTo(l.code)}>{t('lng.upload')}</Button>}
              {manage && !l.builtin && <Button size="sm" variant="ghost" className="text-red-600" icon={<Trash2 className="size-3.5" />} onClick={async () => {
                if (!(await confirm({ title: t('lng.delete_q'), confirm: t('lng.yes_delete') }))) return; if (await run(() => del(`/languages/${l.code}`), t('common.deleted'))) { toast(t('lng.rebuild_hint'), 'blue'); load(); } }}>{t('common.delete')}</Button>}
            </div>
          </Card>
        ))}
      </div>
      {keysOf && <KeysPanel code={keysOf} onClose={() => { setKeysOf(null); load(); }} />}
      {uploadTo && <UploadPanel code={uploadTo} onClose={() => { setUploadTo(null); load(); }} />}
      {adding && <AddLanguage onClose={() => { setAdding(false); load(); }} />}
    </>
  );
}

function KeysPanel({ code, onClose }: { code: string; onClose: () => void }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const errText = useErrorText();
  const [d, setD] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [show, setShow] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const load = () => get(`/languages/${code}/keys`, { search, show, page }).then(setD);
  useEffect(() => { const h = setTimeout(load, 250); return () => clearTimeout(h); }, [search, show, page]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (key: string) => {
    try { await put(`/languages/${code}/keys/${key}`, { value }); setEditing(null); setErr(null); load(); } catch (e) { setErr(errText(e)); }
  };
  return (
    <SidePanel open onClose={onClose} title={<>{t('lng.keys_title')} <code>{code}</code></>}>
      <div className="mb-3 flex gap-2"><input type="search" className="input" placeholder={t('lng.search')} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <select className="input w-auto" value={show} onChange={(e) => { setShow(e.target.value); setPage(1); }}><option value="">{t('common.all')}</option><option value="missing">{t('lng.missing_only')}</option><option value="overridden">{t('lng.overridden_only')}</option></select></div>
      {!d ? <Loading /> : <>
        <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">{d.rows.map((r: any) => (
          <li key={r.key} className="py-2">
            <div className="flex items-start gap-2"><code className="flex-1 text-[11px] text-zinc-500" dir="ltr">{r.key}</code>{r.overridden && <Badge tone="blue">{t('lng.overridden')}</Badge>}
              {can('languages.manage') && <IconButton title={t('lng.edit')} onClick={() => { setEditing(r.key); setValue(r.value ?? ''); setErr(null); }}><Pencil /></IconButton>}
              {can('languages.manage') && r.overridden && <IconButton title={t('lng.revert')} onClick={async () => { await del(`/languages/${code}/keys/${r.key}`); load(); }}><RotateCcw /></IconButton>}</div>
            <div className="text-xs" dir="rtl">{r.ar}</div><div className="text-xs text-zinc-500" dir="ltr">{r.en}</div>
            {editing === r.key ? <div className="mt-1"><textarea className="input" rows={2} autoFocus value={value} onChange={(e) => setValue(e.target.value)} dir="auto"
              onKeyDown={(e) => { if (e.key === 'Enter' && e.ctrlKey) save(r.key); if (e.key === 'Escape') setEditing(null); }} />
              {err && <p className="text-xs text-red-600">{err}</p>}<div className="mt-1 flex gap-2"><Button size="sm" variant="primary" onClick={() => save(r.key)}>{t('common.save')}</Button><Button size="sm" onClick={() => setEditing(null)}>{t('common.cancel')}</Button></div></div>
              : <div className={r.value ? 'mt-0.5 font-medium' : 'mt-0.5 text-xs text-amber-600'} dir="auto">{r.value || t('lng.missing')}</div>}
          </li>))}</ul>
        <div className="mt-3 flex items-center justify-between text-xs"><span className="num">{d.total}</span>
          <div className="flex gap-1"><Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('table.previous')}</Button><Button size="sm" disabled={page * 50 >= d.total} onClick={() => setPage(page + 1)}>{t('table.next')}</Button></div></div>
      </>}
    </SidePanel>
  );
}

function UploadPanel({ code, onClose }: { code: string; onClose: () => void }) {
  const { t } = useI18n();
  const errText = useErrorText();
  const [file, setFile] = useState<File | null>(null);
  const [a, setA] = useState<any>(null);
  const [done, setDone] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  return (
    <SidePanel open onClose={onClose} title={<>{t('lng.upload')} <code>{code}</code></>}>
      <div className="space-y-3 text-sm">
        <p className="text-zinc-500">{t('lng.upload_hint')}</p>
        <Button icon={<Upload className="size-4" />} onClick={() => input.current?.click()}>{file ? file.name : t('lng.choose_file')}</Button>
        <input ref={input} type="file" hidden accept=".json,.xlsx,.csv" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setA(null); setDone(null); }} />
        {file && !a && <Button variant="primary" onClick={async () => { const fd = new FormData(); fd.append('file', file); try { setA(await post(`/languages/${code}/import/analyse`, fd)); setErr(null); } catch (e) { setErr(errText(e)); } }}>{t('lng.analyse')}</Button>}
        {err && <Alert tone="red">{err}</Alert>}
        {a && <div className="grid grid-cols-2 gap-2">{['values', 'new', 'changed', 'unchanged', 'unknown', 'empty', 'placeholder_errors', 'missing_after'].map((k) => <StatCard key={k} label={t(`lng.a.${k}`)} value={fmtNum(a[k])} tone={k === 'placeholder_errors' && a[k] ? 'red' : 'none'} />)}</div>}
        {a && done === null && <Button variant="primary" onClick={async () => { try { const r = await post(`/languages/${code}/import/apply`, { token: a.token }); setDone(r.applied); } catch (e) { setErr(errText(e)); } }}>{t('lng.apply')}</Button>}
        {done !== null && <Alert tone="green" title={t('lng.applied', { n: done })}>{t('lng.rebuild_hint')}</Alert>}
      </div>
    </SidePanel>
  );
}

function AddLanguage({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const errText = useErrorText();
  const SUGGEST = [['fr', 'ltr', 'Français', 'French', '🇫🇷'], ['tr', 'ltr', 'Türkçe', 'Turkish', '🇹🇷'], ['hi', 'ltr', 'हिन्दी', 'Hindi', '🇮🇳'], ['id', 'ltr', 'Bahasa Indonesia', 'Indonesian', '🇮🇩'], ['fa', 'rtl', 'فارسی', 'Persian', '🇮🇷']];
  const [v, setV] = useState({ code: '', dir: 'ltr', name_native: '', name_en: '', font: '', flag: '' });
  const [err, setErr] = useState<string | null>(null);
  return (
    <SidePanel open onClose={onClose} title={t('lng.add')} footer={<><Button onClick={onClose}>{t('common.cancel')}</Button>
      <Button variant="primary" onClick={async () => { try { await post('/languages', v); onClose(); } catch (e) { setErr(errText(e)); } }}>{t('lng.add')}</Button></>}>
      <div className="space-y-3">
        {err && <Alert tone="red">{err}</Alert>}
        <div><div className="mb-1 text-xs text-zinc-500">{t('lng.suggestions')}</div><div className="flex flex-wrap gap-1">{SUGGEST.map(([code, dir, nn, ne, flag]) => <Button key={code} size="sm" onClick={() => setV({ code, dir, name_native: nn, name_en: ne, font: '', flag })}>{flag} {nn}</Button>)}</div></div>
        <Field label={t('lng.code')} required hint="fr, ur, pt-BR"><input className="input" dir="ltr" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} /></Field>
        <Field label={t('lng.direction')} required><select className="input" value={v.dir} onChange={(e) => setV({ ...v, dir: e.target.value })}><option value="ltr">{t('lng.ltr')}</option><option value="rtl">{t('lng.rtl')}</option></select></Field>
        <Field label={t('lng.name_native')} required><input className="input" dir="auto" value={v.name_native} onChange={(e) => setV({ ...v, name_native: e.target.value })} /></Field>
        <Field label={t('lng.name_en')} required><input className="input" dir="ltr" value={v.name_en} onChange={(e) => setV({ ...v, name_en: e.target.value })} /></Field>
        <Field label={t('lng.font')}><input className="input" dir="ltr" value={v.font} onChange={(e) => setV({ ...v, font: e.target.value })} /></Field>
        <Field label={t('lng.flag')}><input className="input" value={v.flag} maxLength={8} onChange={(e) => setV({ ...v, flag: e.target.value })} /></Field>
        <p className="text-xs text-zinc-500">{t('lng.new_hint')}</p>
      </div>
    </SidePanel>
  );
}
