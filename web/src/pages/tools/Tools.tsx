// Other tools (phase 8): saved links, print lists with chosen and blank columns, rider ID cards, and the data
// management page (one Excel template and import per section).
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { Bookmark, ExternalLink, FileSpreadsheet, Plus, Printer, Star, Trash2, Upload } from 'lucide-react';
import { del, download, get, post } from '../../api';
import { useAuth } from '../../auth';
import { fmtDate, fmtNum, useI18n } from '../../i18n';
import { localName } from '../../ui/common';
import { Badge, Button, Card, IconButton, PageHeader, SidePanel, useAction, useUi } from '../../ui/kit';
import { Grid, TextInput, useForm } from '../../ui/forms';
import { useOrgOptions } from '../system/Branches';

// ======================================================================== saved links
export function BookmarksPage() {
  const { t } = useI18n();
  const run = useAction();
  const { confirm } = useUi();
  const [d, setD] = useState<{ mine: any[]; community: any[] }>({ mine: [], community: [] });
  const [adding, setAdding] = useState(false);
  const form = useForm<Record<string, any>>({ title: '', url: 'https://', note: '' });
  const load = () => get('/bookmarks').then(setD).catch(() => setD({ mine: [], community: [] }));
  useEffect(() => { load(); }, []);
  const save = async () => { const r = await form.submit(() => post('/bookmarks', form.values)); if (r) { setAdding(false); load(); } };
  const keep = async (c: any) => { if (await run(() => post('/bookmarks', { title: c.title, url: c.url, note: c.note }), t('bm.saved'))) load(); };
  const remove = async (b: any) => { if (!(await confirm({ title: t('bm.delete_q', { title: b.title }), tone: 'warn' }))) return; if (await run(() => del(`/bookmarks/${b.id}`), t('common.deleted'))) load(); };
  const Row = ({ b, actions }: { b: any; actions: React.ReactNode }) => <li className="flex items-center gap-3 py-2">
    <Bookmark className="size-4 shrink-0 text-zinc-400" /><div className="min-w-0 flex-1"><a href={b.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-medium hover:underline">{b.title}<ExternalLink className="size-3" /></a>
      <div className="truncate text-xs text-zinc-500" dir="ltr">{b.url}</div>{b.note && <div className="text-xs text-zinc-500">{b.note}</div>}</div>{actions}</li>;
  const saved = new Set(d.mine.map((b) => b.url));
  return (
    <>
      <PageHeader title={t('bm.title')} subtitle={t('bm.intro')} actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => { form.reset({ title: '', url: 'https://', note: '' }); setAdding(true); }}>{t('bm.add')}</Button>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={<span>{t('bm.mine')} <span className="num text-zinc-500">{fmtNum(d.mine.length)}</span></span>}>
          {!d.mine.length ? <p className="text-sm text-zinc-500">{t('bm.none')}</p> : <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">{d.mine.map((b) => <Row key={b.id} b={b} actions={<IconButton title={t('common.delete')} tone="red" onClick={() => remove(b)}><Trash2 /></IconButton>} />)}</ul>}
        </Card>
        <Card title={t('bm.community')}>
          {!d.community.length ? <p className="text-sm text-zinc-500">{t('bm.no_community')}</p> : <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">{d.community.map((c) => <Row key={c.id} b={c}
            actions={saved.has(c.url) ? <Badge tone="green">{t('bm.in_mine')}</Badge> : <IconButton title={t('bm.save')} onClick={() => keep(c)}><Star /></IconButton>} />)}</ul>}
        </Card>
      </div>
      <SidePanel open={adding} onClose={() => setAdding(false)} title={t('bm.add')}
        footer={<><Button onClick={() => setAdding(false)}>{t('common.cancel')}</Button><Button variant="primary" disabled={form.busy} onClick={save}>{t('common.save')}</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); save(); }}>
          <TextInput form={form} name="title" label={t('bm.name')} required maxLength={150} />
          <TextInput form={form} name="url" label={t('bm.url')} required dir="ltr" maxLength={500} />
          <TextInput form={form} name="note" label={t('common.notes')} maxLength={255} />
        </form>
      </SidePanel>
    </>
  );
}

// ======================================================================== print lists
const RIDER_COLS = ['id', 'branch', 'status', 'alias', 'full_name', 'name_en', 'phone', 'national_id', 'iqama_expiry', 'nationality', 'designation', 'company', 'hire_date', 'vehicle', 'iban', 'license_expiry', 'health_expiry', 'passport_number', 'sponsor_name'];
const VEHICLE_COLS = ['plate', 'plate_en', 'vehicle_type', 'maker', 'model', 'year', 'color', 'chassis', 'status', 'branch', 'odometer', 'ownership', 'rider', 'registration_serial', 'registration_expiry', 'card_number', 'card_expiry'];
const DATE_COLS = new Set(['iqama_expiry', 'hire_date', 'license_expiry', 'health_expiry', 'registration_expiry', 'card_expiry']);

export function PrintListsPage({ kind }: { kind: 'riders' | 'vehicles' }) {
  const { t } = useI18n();
  const all = kind === 'riders' ? RIDER_COLS : VEHICLE_COLS;
  const store = `lsp.plist.${kind}`;
  const [cols, setCols] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(store) ?? '') ?? all.slice(0, 5); } catch { return all.slice(0, 5); } });
  const [blanks, setBlanks] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [branch, setBranch] = useState('');
  const [data, setData] = useState<any | null>(null);
  const branches = useOrgOptions('branches');
  useEffect(() => { try { localStorage.setItem(store, JSON.stringify(cols)); } catch { /* ignore */ } }, [cols, store]);
  const query = useMemo(() => ({ cols: cols.join(','), blanks: blanks.join('|'), branch: branch || undefined, title: title || undefined }), [cols, blanks, branch, title]);
  useEffect(() => { if (!cols.length) { setData(null); return; } const h = setTimeout(() => get(`/print-lists/${kind}`, query).then(setData).catch(() => setData(null)), 250); return () => clearTimeout(h); }, [query, kind, cols.length]);
  const toggle = (c: string) => setCols(cols.includes(c) ? cols.filter((x) => x !== c) : all.filter((x) => x === c || cols.includes(x)));
  const cell = (c: string, v: any) => (v == null || v === '' ? '' : DATE_COLS.has(c) ? fmtDate(v) : c === 'status' ? t(`${kind === 'riders' ? 'rider' : 'vehicle'}.status.${v}`) : String(v));
  return (
    <>
      <div className="print:hidden"><PageHeader title={t(`plist.${kind}`)} subtitle={t('plist.intro')} actions={<>
        <Button icon={<FileSpreadsheet className="size-4" />} disabled={!cols.length} onClick={() => download(`/print-lists/${kind}/export`, query)}>{t('common.export_excel')}</Button>
        <Button variant="primary" icon={<Printer className="size-4" />} disabled={!cols.length} onClick={() => window.print()}>{t('pay.print')}</Button>
      </>} />
        <Card>
          <Grid cols={3}>
            <label className="text-sm">{t('plist.title_field')}<input className="input mt-1" value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} placeholder={t(`plist.${kind}`)} /></label>
            <label className="text-sm">{t('pay.branch')}<select className="input mt-1" value={branch} onChange={(e) => setBranch(e.target.value)}><option value="">{t('pay.all_branches')}</option>{branches.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}</select></label>
            <div className="text-sm">{t('plist.blank_cols')}<div className="mt-1 flex gap-1"><input className="input" id="blank-name" maxLength={40} placeholder={t('plist.blank_hint')} />
              <Button size="sm" onClick={() => { const el = document.getElementById('blank-name') as HTMLInputElement; const v = el.value.trim(); if (v && blanks.length < 6) setBlanks([...blanks, v]); el.value = ''; }}>{t('plist.add')}</Button></div>
              <div className="mt-1 flex flex-wrap gap-1">{blanks.map((b, i) => <button key={i} type="button" className="rounded bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800" onClick={() => setBlanks(blanks.filter((_, j) => j !== i))}>{b} ×</button>)}</div></div>
          </Grid>
          <div className="mt-3 text-sm font-medium">{t('plist.columns')}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">{all.map((c) => <button key={c} type="button" onClick={() => toggle(c)}
            className={`rounded-full border px-2.5 py-1 text-xs ${cols.includes(c) ? 'border-brand bg-brand text-white' : 'border-zinc-200 dark:border-zinc-700'}`}>{t(`plist.c.${c}`)}</button>)}</div>
        </Card></div>
      {data && <div className="mt-4">
        <h2 className="mb-2 text-center text-lg font-semibold">{title || t(`plist.${kind}`)}</h2>
        <div className="mb-2 text-center text-xs text-zinc-500 num">{fmtDate(new Date().toISOString())} · {fmtNum(data.rows.length)}</div>
        <div className="overflow-x-auto"><table className="w-full border-collapse text-xs">
          <thead><tr><th className="border border-zinc-300 px-2 py-1 dark:border-zinc-700">#</th>{data.cols.map((c: string) => <th key={c} className="border border-zinc-300 px-2 py-1 text-start dark:border-zinc-700">{t(`plist.c.${c}`)}</th>)}
            {data.blanks.map((b: string, i: number) => <th key={`b${i}`} className="min-w-24 border border-zinc-300 px-2 py-1 text-start dark:border-zinc-700">{b}</th>)}</tr></thead>
          <tbody>{data.rows.map((r: any, i: number) => <tr key={i}><td className="num border border-zinc-300 px-2 py-1 dark:border-zinc-700">{i + 1}</td>
            {data.cols.map((c: string) => <td key={c} className="border border-zinc-300 px-2 py-1 dark:border-zinc-700" dir={['iban', 'phone', 'plate_en', 'chassis'].includes(c) ? 'ltr' : undefined}>{cell(c, r[c])}</td>)}
            {data.blanks.map((_: string, j: number) => <td key={`b${j}`} className="border border-zinc-300 px-2 py-1 dark:border-zinc-700" />)}</tr>)}</tbody></table></div>
      </div>}
    </>
  );
}

// ======================================================================== rider ID cards
function CardQr({ text }: { text: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => { QRCode.toDataURL(text, { margin: 0, width: 96 }).then(setSrc).catch(() => setSrc('')); }, [text]);
  return src ? <img src={src} alt="" className="size-14" /> : null;
}
export function IdCardsPage() {
  const { t, lang } = useI18n();
  const [rows, setRows] = useState<any[]>([]);
  const [branch, setBranch] = useState('');
  const [style, setStyle] = useState<'standard' | 'platform'>('standard');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const branches = useOrgOptions('branches');
  useEffect(() => { get<any[]>('/id-cards', branch ? { branch } : {}).then((r) => { setRows(r); setPicked(new Set(r.map((x) => x.id))); }).catch(() => setRows([])); }, [branch]);
  const cards = rows.filter((r) => picked.has(r.id));
  const accent = style === 'platform' ? 'bg-orange-500' : 'bg-brand';
  return (
    <>
      <div className="print:hidden"><PageHeader title={t('idc.title')} subtitle={t('idc.intro')} actions={<Button variant="primary" icon={<Printer className="size-4" />} disabled={!cards.length} onClick={() => window.print()}>{t('idc.print', { n: cards.length })}</Button>} />
        <Card><div className="flex flex-wrap items-end gap-3 text-sm">
          <label>{t('pay.branch')}<select className="input mt-1" value={branch} onChange={(e) => setBranch(e.target.value)}><option value="">{t('pay.all_branches')}</option>{branches.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}</select></label>
          <label>{t('idc.style')}<select className="input mt-1" value={style} onChange={(e) => setStyle(e.target.value as any)}><option value="standard">{t('idc.s.standard')}</option><option value="platform">{t('idc.s.platform')}</option></select></label>
          <Button size="sm" onClick={() => setPicked(new Set(rows.map((r) => r.id)))}>{t('idc.all')}</Button><Button size="sm" onClick={() => setPicked(new Set())}>{t('idc.none')}</Button>
        </div>
          <div className="mt-3 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">{rows.map((r) => <button key={r.id} type="button" onClick={() => { const s = new Set(picked); s.has(r.id) ? s.delete(r.id) : s.add(r.id); setPicked(s); }}
            className={`rounded-full border px-2.5 py-1 text-xs ${picked.has(r.id) ? 'border-brand bg-brand text-white' : 'border-zinc-200 dark:border-zinc-700'}`}>{r.alias || r.full_name}</button>)}</div>
          {!rows.length && <p className="mt-2 text-sm text-zinc-500">{t('rpap.none')}</p>}
        </Card></div>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 print:grid-cols-2 print:gap-3">
        {cards.map((r) => <div key={r.id} className="break-inside-avoid overflow-hidden rounded-xl border border-zinc-300 bg-white text-zinc-900" style={{ aspectRatio: '85.6 / 54' }}>
          <div className={`flex items-center justify-between px-3 py-1.5 text-white ${accent}`}>
            <img src="/api/public/logo/logo" alt="" className="h-6 max-w-24 object-contain" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
            <span className="text-[11px] font-semibold">{style === 'platform' && r.platform ? r.platform : t('idc.card_label')}</span></div>
          <div className="flex gap-3 p-3">
            <div className="h-24 w-20 shrink-0 overflow-hidden rounded bg-zinc-100">{r.photo_id ? <img src={`/api/attachments/${r.photo_id}/file`} alt="" className="size-full object-cover" /> : <div className="flex size-full items-center justify-center text-[10px] text-zinc-400">{t('idc.no_photo')}</div>}</div>
            <div className="min-w-0 flex-1 text-[11px] leading-snug">
              <div className="text-sm font-bold">{r.full_name}</div>{r.name_en && <div className="text-zinc-600" dir="ltr">{r.name_en}</div>}
              <div className="mt-1">{localName(lang, r.designation_ar, r.designation_en)}</div>
              <div className="num mt-1">{t('idc.rider_no')}: {r.id}</div>{r.national_id && <div className="num">{t('riders.national_id')}: {r.national_id}</div>}
              {r.branch_ar && <div className="text-zinc-600">{r.branch_ar}</div>}</div>
            <CardQr text={`${r.id}`} />
          </div></div>)}
      </div>
    </>
  );
}

// ======================================================================== data management
const SECTIONS: { key: string; base: string; page: string; perm: string }[] = [
  { key: 'riders', base: '/riders/import', page: '/admin/riders/import', perm: 'riders.import' },
  { key: 'vehicles', base: '/vehicles/import', page: '/admin/vehicles/import', perm: 'vehicles.import' },
  { key: 'platform_ids', base: '/platform-ids/import', page: '/admin/platform-ids/import', perm: 'platform_ids.import' },
  { key: 'applicants', base: '/applicants/import', page: '/admin/rider-applicants/import', perm: 'applicants.import' },
  { key: 'performance', base: '/performance/import', page: '/admin/performance/import', perm: 'performance.import' },
  { key: 'fines', base: '/finance/fines/import', page: '/admin/finance/fines/import', perm: 'finance.import' },
  { key: 'operation_cards', base: '/operation-cards/import', page: '/admin/operation-cards/import', perm: 'operation_cards.import' },
];
export function DataManagementPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  return (
    <>
      <PageHeader title={t('dm.title')} subtitle={t('dm.intro')} />
      <div className="grid gap-3 md:grid-cols-2">{SECTIONS.filter((s) => can(s.perm)).map((s) => <Card key={s.key} title={t(`dm.s.${s.key}`)}>
        <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">{t('dm.steps')}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={<FileSpreadsheet className="size-4" />} onClick={() => download(`${s.base}/template`)}>{t('dm.template')}</Button>
          <Link to={s.page}><Button size="sm" variant="primary" icon={<Upload className="size-4" />}>{t('dm.upload')}</Button></Link>
        </div></Card>)}</div>
    </>
  );
}
