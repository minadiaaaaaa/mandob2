// Phase 5: a rider's bank accounts (on the rider's profile), the exited riders with their exit record, and the
// rider papers table. The server keeps the rules (domain/employees.ts): IBAN check, one main account, exit dates.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Plus, Star, Trash2, Paperclip } from 'lucide-react';
import { del, get, patch, post } from '../../api';
import { useAuth } from '../../auth';
import { fmtDate, fmtMoney, fmtNum, useI18n } from '../../i18n';
import { Badge, Button, IconButton, PageHeader, SidePanel, StatCard, StatGrid, toneIf, useAction, useUi, type Tone } from '../../ui/kit';
import { Grid, SelectInput, TextArea, TextInput, useForm } from '../../ui/forms';
import { DataTable, FilterBar, FilterSelect, useList, type Column } from '../../ui/table';
import { ExportButton, StatusBadge, localName } from '../../ui/common';
import { Attachments } from '../../ui/files';

// IBAN shown in groups of four, as printed on bank papers
const groupIban = (s: string) => s.replace(/(.{4})/g, '$1 ').trim();

// ======================================================================== bank accounts (rider profile)
export function RiderBankAccounts({ riderId }: { riderId: number | string }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const { confirm } = useUi();
  const [rows, setRows] = useState<any[] | null>(null);
  const [edit, setEdit] = useState<any | null>(null);
  const form = useForm<Record<string, any>>({ bank_name: '', iban: '', account_holder: '', is_primary: false, notes: '' });
  const load = () => get<any[]>(`/riders/${riderId}/bank-accounts`).then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, [riderId]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = (r?: any) => { form.reset(r ? { bank_name: r.bank_name, iban: r.iban, account_holder: r.account_holder ?? '', is_primary: !!r.is_primary, notes: r.notes ?? '' } : { bank_name: '', iban: '', account_holder: '', is_primary: false, notes: '' }); setEdit(r ?? {}); };
  const save = async () => {
    const r = await form.submit(() => (edit.id ? patch(`/rider-bank-accounts/${edit.id}`, form.changes) : post(`/riders/${riderId}/bank-accounts`, form.values)));
    if (r) { setEdit(null); load(); }
  };
  const makeMain = async (r: any) => { if (await run(() => patch(`/rider-bank-accounts/${r.id}`, { is_primary: true }), t('bank.made_main'))) load(); };
  const remove = async (r: any) => {
    if (!(await confirm({ title: t('bank.delete_q', { bank: r.bank_name }), tone: 'warn' }))) return;
    if (await run(() => del(`/rider-bank-accounts/${r.id}`), t('bank.deleted'))) load();
  };
  if (!rows) return null;
  return (
    <div className="text-sm">
      {!rows.length ? <p className="text-zinc-500">{t('bank.none')}</p> : <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">{rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
          <div className="min-w-0 flex-1"><div className="font-medium">{r.bank_name} {!!r.is_primary && <Badge tone="blue">{t('bank.main')}</Badge>}</div>
            <div className="num text-xs" dir="ltr">{groupIban(r.iban)}</div>{r.account_holder && <div className="text-xs text-zinc-500">{r.account_holder}</div>}</div>
          {can('riders.update') && <div className="flex">
            {!r.is_primary && <IconButton title={t('bank.make_main')} onClick={() => makeMain(r)}><Star /></IconButton>}
            <IconButton title={t('common.edit')} onClick={() => open(r)}><Pencil /></IconButton>
            <IconButton title={t('common.delete')} tone="red" onClick={() => remove(r)}><Trash2 /></IconButton></div>}
        </li>))}</ul>}
      {can('riders.update') && <div className="mt-2"><Button size="sm" icon={<Plus className="size-4" />} onClick={() => open()}>{t('bank.add')}</Button></div>}
      <SidePanel open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? t('bank.edit') : t('bank.add')}
        footer={<><Button onClick={() => setEdit(null)}>{t('common.cancel')}</Button><Button variant="primary" disabled={form.busy} onClick={save}>{t('common.save')}</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); save(); }}>
          <Grid>
            <TextInput form={form} name="bank_name" label={t('bank.bank_name')} required maxLength={100} />
            <TextInput form={form} name="account_holder" label={t('bank.account_holder')} maxLength={150} />
          </Grid>
          <TextInput form={form} name="iban" label={t('bank.iban')} required dir="ltr" maxLength={40} hint={t('bank.iban_hint')} />
          <label className="mt-3 flex items-center gap-2"><input type="checkbox" checked={!!form.values.is_primary} onChange={(e) => form.set('is_primary', e.target.checked)} />{t('bank.make_main')}</label>
          <TextArea form={form} name="notes" label={t('common.notes')} maxLength={255} />
        </form>
      </SidePanel>
    </div>
  );
}

// ======================================================================== exited riders
const CLEARANCE: Record<string, Tone> = { clear: 'green', in_debt: 'red', settled: 'blue' };

export function ExitedPage() {
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const list = useList('/riders-exited');
  const [edit, setEdit] = useState<any | null>(null);
  const form = useForm<Record<string, any>>({ exit_date: '', exit_reason: '', exit_clearance: '', exit_note: '' });
  const s = list.stats ?? {};
  const open = (r: any) => { form.reset({ exit_date: r.exit_date ?? '', exit_reason: r.exit_reason ?? '', exit_clearance: r.exit_clearance ?? '', exit_note: r.exit_note ?? '' }); setEdit(r); };
  const save = async () => { const r = await form.submit(() => patch(`/riders/${edit.id}/exit`, form.changes)); if (r) { setEdit(null); list.reload(); } };
  const filter = (v: string) => list.set('clearance', list.query.clearance === v ? null : v);
  const columns: Column<any>[] = [
    { key: 'name', header: t('exited.rider'), sort: 'name', render: (r) => <div><Link to={`/admin/riders/${r.id}`} className="font-medium hover:underline">{r.full_name}</Link>
      <div className="num text-xs text-zinc-500">#{r.id}{r.designation_ar ? ` · ${localName(lang, r.designation_ar, r.designation_en)}` : ''}</div></div> },
    { key: 'hire', header: t('riders.hire_date'), sort: 'hire', render: (r) => <span className="num">{fmtDate(r.hire_date)}</span> },
    { key: 'exit', header: t('exited.exit_date'), sort: 'exit', render: (r) => <span className="num">{fmtDate(r.exit_date)}</span> },
    { key: 'clearance', header: t('exited.clearance'), render: (r) => r.exit_clearance ? <StatusBadge map={CLEARANCE} value={r.exit_clearance} prefix="exited.c" /> : <span className="text-zinc-400">{t('exited.c.none')}</span> },
    { key: 'due', header: t('exited.advances_due'), render: (r) => Number(r.advances_due) ? <span className="num text-red-600">{fmtMoney(r.advances_due)}</span> : <span className="num text-zinc-400">0</span> },
    { key: 'note', header: t('exited.note'), render: (r) => <div className="max-w-72 text-xs">{r.exit_reason && <div className="font-medium">{r.exit_reason}</div>}{r.exit_note && <div className="text-zinc-500">{r.exit_note}</div>}</div> },
    { key: 'actions', header: t('common.actions'), render: (r) => can('riders.update') ? <IconButton title={t('common.edit')} onClick={() => open(r)}><Pencil /></IconButton> : null },
  ];
  return (
    <>
      <PageHeader title={t('exited.title')} subtitle={t('exited.intro')} actions={can('riders.export') ? <ExportButton path="/riders-exited/export" query={list.query} /> : undefined} />
      <StatGrid>
        <StatCard label={t('exited.s.total')} value={fmtNum(s.total)} onClick={() => list.set('clearance', null)} active={!list.query.clearance} />
        {['clear', 'in_debt', 'settled'].map((k) => <StatCard key={k} label={t(`exited.c.${k}`)} value={fmtNum(s[k])} tone={k === 'in_debt' ? toneIf(s[k], 'red') : CLEARANCE[k]} onClick={() => filter(k)} active={list.query.clearance === k} />)}
        <StatCard label={t('exited.c.none')} value={fmtNum(s.none)} tone={toneIf(s.none, 'amber')} onClick={() => filter('none')} active={list.query.clearance === 'none'} />
      </StatGrid>
      <FilterBar list={list} placeholder={t('exited.search_hint')}>
        <FilterSelect list={list} name="clearance" label={t('exited.clearance')} options={['clear', 'in_debt', 'settled', 'none'].map((k) => ({ value: k, label: t(`exited.c.${k}`) }))} />
      </FilterBar>
      <DataTable list={list} columns={columns} emptyText={t('exited.none')} />
      <SidePanel open={!!edit} onClose={() => setEdit(null)} title={t('exited.edit', { name: edit?.full_name ?? '' })}
        footer={<><Button onClick={() => setEdit(null)}>{t('common.cancel')}</Button><Button variant="primary" disabled={form.busy} onClick={save}>{t('common.save')}</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); save(); }}>
          <Grid>
            <TextInput form={form} name="exit_date" type="date" label={t('exited.exit_date')} required />
            <SelectInput form={form} name="exit_clearance" label={t('exited.clearance')} options={['clear', 'in_debt', 'settled'].map((k) => ({ value: k, label: t(`exited.c.${k}`) }))} />
          </Grid>
          <TextInput form={form} name="exit_reason" label={t('exited.reason')} maxLength={255} />
          <TextArea form={form} name="exit_note" label={t('exited.note')} maxLength={500} hint={t('exited.note_hint')} />
        </form>
      </SidePanel>
    </>
  );
}

// ======================================================================== rider papers
const PAPERS = ['photo', 'id', 'license', 'passport', 'health', 'driver_card', 'ajeer', 'other'] as const;
const DOC_PAGE: Record<string, string> = { id: 'id-documents', license: 'driving-licenses', health: 'health-certificates', driver_card: 'driver-cards', ajeer: 'ajeer-permits' };
const FILE_TYPES = new Set(['photo', 'passport', 'other']);

export function RiderPapersPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const [q, setQ] = useState({ search: '', missing: '' });
  const [data, setData] = useState<any | null>(null);
  const [upload, setUpload] = useState<{ r: any; type: string } | null>(null);
  const load = () => get('/rider-papers', q).then(setData).catch(() => setData({ rows: [], stats: {} }));
  useEffect(() => { const h = setTimeout(load, 250); return () => clearTimeout(h); }, [q.search, q.missing]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = data?.stats ?? {};
  const cell = (r: any, k: string) => {
    const have = !!r.has?.[k];
    const exp = r[`${k}_expiry`] ?? (k === 'passport' ? r.passport_expiry : null);
    const mark = <span className={have ? 'text-emerald-600' : k === 'other' ? 'text-zinc-300' : 'text-red-600'}>{have ? '✓' : k === 'other' ? '–' : '✗'}</span>;
    return <div className="flex items-center gap-1">
      {DOC_PAGE[k] ? <Link to={`/admin/riders/${DOC_PAGE[k]}?search=${r.id}`} className="hover:underline">{mark}</Link> : mark}
      {exp && <span className="num text-xs text-zinc-500">{fmtDate(exp)}</span>}
      {FILE_TYPES.has(k) && can('attachments.upload') && <IconButton title={t('vp.upload')} onClick={() => setUpload({ r, type: k })}><Paperclip /></IconButton>}
    </div>;
  };
  return (
    <>
      <PageHeader title={t('rpap.title')} subtitle={t('rpap.intro')} />
      <StatGrid>
        <StatCard label={t('rpap.s.total')} value={fmtNum(s.total)} onClick={() => setQ({ ...q, missing: '' })} active={!q.missing} />
        <StatCard label={t('vp.s.complete')} value={fmtNum(s.complete)} tone="green" />
        <StatCard label={t('vp.s.missing')} value={fmtNum(s.missing)} tone={toneIf(s.missing, 'red')} onClick={() => setQ({ ...q, missing: q.missing ? '' : '1' })} active={!!q.missing} />
      </StatGrid>
      <input className="input mb-3 max-w-sm" placeholder={t('rpap.search_hint')} value={q.search} onChange={(e) => setQ({ ...q, search: e.target.value })} />
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800"><table className="w-full text-sm">
        <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-900"><tr>
          {['rpap.rider', ...PAPERS.map((k) => `rpap.p.${k}`), 'vp.missing'].map((k) => <th key={k} className="whitespace-nowrap px-3 py-2 text-start font-medium">{t(k)}</th>)}</tr></thead>
        <tbody>{(data?.rows ?? []).map((r: any) => (
          <tr key={r.id} className="border-t border-zinc-100 dark:border-zinc-800">
            <td className="px-3 py-2"><Link to={`/admin/riders/${r.id}`} className="font-medium hover:underline">{r.alias || r.full_name}</Link><div className="num text-xs text-zinc-500">#{r.id}</div></td>
            {PAPERS.map((k) => <td key={k} className="px-3 py-2">{cell(r, k)}</td>)}
            <td className="px-3 py-2">{r.missing ? <Badge tone="red">{fmtNum(r.missing)}</Badge> : <Badge tone="green">0</Badge>}</td>
          </tr>))}</tbody></table>
        {data && !data.rows.length && <p className="p-4 text-sm text-zinc-500">{t('rpap.none')}</p>}</div>
      {upload && <SidePanel open onClose={() => { setUpload(null); load(); }} title={t('vp.upload_title', { paper: t(`rpap.p.${upload.type}`), plate: upload.r.full_name })}>
        <Attachments entityType="rider" entityId={upload.r.id} attachmentType={upload.type} title={t(`rpap.p.${upload.type}`)} />
      </SidePanel>}
    </>
  );
}
