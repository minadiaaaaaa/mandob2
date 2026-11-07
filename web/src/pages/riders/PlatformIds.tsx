// Riders → Platform IDs (phase 3): the account numbers the delivery platforms issued to the company, who owns each
// one and who works on it now. The worker changes only through a transfer, which the history keeps. "Shared IDs"
// lists the IDs more than one rider worked on in a month. The server holds every rule (routes/platformIds.ts).
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeftRight, Copy, History, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { del, get, patch, post } from '../../api';
import { useAuth } from '../../auth';
import { fmtDateTime, fmtNum, useI18n } from '../../i18n';
import { Badge, Button, Field, IconButton, PageHeader, SidePanel, StatCard, StatGrid, Tabs, toneIf, useAction, useUi, type Tone } from '../../ui/kit';
import { Grid, RiderInput, RiderPicker, SelectInput, TextArea, TextInput, useForm } from '../../ui/forms';
import { DataTable, FilterBar, FilterSelect, useList, type Column } from '../../ui/table';
import { ExportButton, StatusBadge, useOptions } from '../../ui/common';
import { ImportWizard } from '../../ui/importer';

export const PID_STATUS: Record<string, Tone> = { active: 'green', pending: 'amber', blocked: 'red', expired: 'grey' };
const STATUSES = Object.keys(PID_STATUS);
const EMPTY = { id_number: '', company_id: '', contract_id: '', owner_rider_id: '', worker_rider_id: '', other_worker: false, status: 'active', notes: '' };

// "Name" or "Self" for the worker
function Who({ id, name, self, t }: { id: number | null; name: string | null; self?: boolean; t: (k: string) => string }) {
  if (id == null) return <span className="text-zinc-400">{t('pids.nobody')}</span>;
  return <div><Link to={`/admin/riders/${id}`} className="hover:underline">{name ?? `#${id}`}</Link> {self && <Badge tone="blue">{t('pids.self')}</Badge>}
    <div className="num text-xs text-zinc-500">#{id}</div></div>;
}

function IdList() {
  const { t } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const { confirm } = useUi();
  const list = useList('/platform-ids');
  const platforms = useOptions<any>('/lookups/companies?all=1');
  const form = useForm<Record<string, any>>(EMPTY);
  const contracts = useOptions<any>(form.values.company_id ? `/lookups/contracts?company=${form.values.company_id}` : null, [form.values.company_id]);
  const [edit, setEdit] = useState<any | null>(null);
  const [move, setMove] = useState<any | null>(null);
  const [hist, setHist] = useState<any | null>(null);
  const s = list.stats ?? {};

  const open = (r?: any) => {
    form.reset(r ? { ...EMPTY, id_number: r.id_number, company_id: r.company_id, contract_id: r.contract_id ?? '', owner_rider_id: r.owner_rider_id ?? '', status: r.status, notes: r.notes ?? '' } : EMPTY);
    setEdit(r ?? {});
  };
  const save = async () => {
    const r = await form.submit(() => {
      if (edit.id) {
        const { other_worker: _o, worker_rider_id: _w, ...changes } = form.changes;
        return patch(`/platform-ids/${edit.id}`, changes);
      }
      const { other_worker, worker_rider_id, ...v } = form.values;
      // left alone, the owner works on it; ticked, the rider chosen (or nobody)
      return post('/platform-ids', other_worker ? { ...v, worker_rider_id: worker_rider_id || null } : v);
    });
    if (r) { setEdit(null); list.reload(); }
  };
  const remove = async (r: any) => {
    if (!(await confirm({ title: t('pids.delete_q', { number: r.id_number }), body: t('pids.delete_body'), tone: 'warn' }))) return;
    if (await run(() => del(`/platform-ids/${r.id}`), t('pids.deleted'))) list.reload();
  };
  const copy = (v: string) => run(() => navigator.clipboard.writeText(v), t('pids.copied'));
  const status = (v: string) => list.set('status', list.query.status === v ? null : v);

  const columns: Column<any>[] = [
    { key: 'id_number', header: t('pids.id_number'), sort: 'id_number', render: (r) => <span className="inline-flex items-center gap-1">
      <span className="num font-medium" dir="ltr">{r.id_number}</span>
      <IconButton title={t('pids.copy')} onClick={() => copy(r.id_number)}><Copy /></IconButton></span> },
    { key: 'platform', header: t('pids.platform'), sort: 'platform', render: (r) => <div>{r.platform}{r.contract && <div className="text-xs text-zinc-500">{r.contract}</div>}</div> },
    { key: 'owner', header: t('pids.owner'), sort: 'owner', render: (r) => <Who id={r.owner_rider_id} name={r.owner_name} t={t} /> },
    { key: 'worker', header: t('pids.worker'), sort: 'worker', render: (r) => <Who id={r.worker_rider_id} name={r.worker_name} self={!!r.is_self} t={t} /> },
    { key: 'status', header: t('pids.status'), sort: 'status', render: (r) => <StatusBadge map={PID_STATUS} value={r.status} prefix="pids.st" /> },
    { key: 'actions', header: t('common.actions'), render: (r) => <div className="flex">
      {can('platform_ids.transfer') && <IconButton title={t('pids.transfer')} onClick={() => setMove(r)}><ArrowLeftRight /></IconButton>}
      <IconButton title={t('pids.history')} onClick={() => setHist(r)}><History /></IconButton>
      {can('platform_ids.update') && <IconButton title={t('common.edit')} onClick={() => open(r)}><Pencil /></IconButton>}
      {can('platform_ids.delete') && <IconButton title={t('common.delete')} tone="red" onClick={() => remove(r)}><Trash2 /></IconButton>}
    </div> },
  ];
  const platformOpts = platforms.map((p) => ({ value: p.id, label: p.name, disabled: !p.is_active }));
  return (
    <>
      <StatGrid>
        <StatCard label={t('pids.s.total')} value={fmtNum(s.total)} onClick={() => list.set('status', null)} active={!list.query.status} />
        {STATUSES.map((k) => <StatCard key={k} label={t(`pids.st.${k}`)} value={fmtNum(s[k])} tone={k === 'active' ? 'green' : toneIf(s[k], PID_STATUS[k])} onClick={() => status(k)} active={list.query.status === k} />)}
        <StatCard label={t('pids.s.other_worker')} value={fmtNum(s.other_worker)} tone="blue" onClick={() => list.set('worker', list.query.worker === 'other' ? null : 'other')} active={list.query.worker === 'other'} />
      </StatGrid>
      <FilterBar list={list} placeholder={t('pids.search_hint')} actions={<>
        {can('platform_ids.export') && <ExportButton path="/platform-ids/export" query={list.query} />}
        {can('platform_ids.import') && <Link to="/admin/platform-ids/import"><Button icon={<Upload className="size-4" />}>{t('pids.import_btn')}</Button></Link>}
        {can('platform_ids.create') && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => open()}>{t('pids.new')}</Button>}
      </>}>
        <FilterSelect list={list} name="platform" label={t('pids.platform')} options={platformOpts} />
        <FilterSelect list={list} name="worker" label={t('pids.worked_by')} options={[{ value: 'self', label: t('pids.w.self') }, { value: 'other', label: t('pids.w.other') }, { value: 'none', label: t('pids.w.none') }]} />
        <div className="w-60"><RiderPicker value={list.query.rider} onChange={(id) => list.set('rider', id ? String(id) : null)} placeholder={t('pids.rider_filter')} /></div>
      </FilterBar>
      <DataTable list={list} columns={columns} emptyText={t('pids.none')} />

      <SidePanel open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? t('pids.edit') : t('pids.new')}
        footer={<><Button onClick={() => setEdit(null)}>{t('common.cancel')}</Button><Button variant="primary" disabled={form.busy} onClick={save}>{t('common.save')}</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); save(); }}>
          <Grid>
            <TextInput form={form} name="id_number" label={t('pids.id_number')} required dir="ltr" maxLength={50} />
            <SelectInput form={form} name="status" label={t('pids.status')} empty={false} options={STATUSES.map((k) => ({ value: k, label: t(`pids.st.${k}`) }))} />
            <SelectInput form={form} name="company_id" label={t('pids.platform')} required options={platformOpts}
              onChange={() => form.set('contract_id', '')} />
            <SelectInput form={form} name="contract_id" label={t('pids.contract')} disabled={!form.values.company_id}
              options={contracts.map((c) => ({ value: c.id, label: c.name, disabled: !c.is_active }))} />
          </Grid>
          <RiderInput form={form} name="owner_rider_id" label={t('pids.owner')} activeOnly hint={t('pids.owner_hint')} />
          {!edit?.id && <>
            <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={!!form.values.other_worker} onChange={(e) => form.set('other_worker', e.target.checked)} />{t('pids.other_worker_q')}</label>
            {form.values.other_worker && <RiderInput form={form} name="worker_rider_id" label={t('pids.worker')} activeOnly hint={t('pids.worker_hint')} />}
          </>}
          {edit?.id && <p className="mt-2 text-xs text-zinc-500">{t('pids.worker_by_transfer')}</p>}
          <TextArea form={form} name="notes" label={t('common.notes')} maxLength={500} />
        </form>
      </SidePanel>
      {move && <TransferPanel row={move} onClose={() => setMove(null)} onDone={() => { setMove(null); list.reload(); }} />}
      {hist && <HistoryPanel row={hist} onClose={() => setHist(null)} />}
    </>
  );
}

function TransferPanel({ row, onClose, onDone }: { row: any; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const form = useForm<Record<string, any>>({ to_rider_id: '', date: '', reason: '' });
  const save = async () => {
    const r = await form.submit(() => post(`/platform-ids/${row.id}/transfer`, { ...form.values, to_rider_id: form.values.to_rider_id || null }));
    if (r) onDone();
  };
  return (
    <SidePanel open onClose={onClose} title={t('pids.transfer_title', { number: row.id_number })}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" disabled={form.busy} onClick={save}>{t('pids.transfer')}</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Field label={t('pids.current_worker')}><Who id={row.worker_rider_id} name={row.worker_name} self={!!row.is_self} t={t} /></Field>
        <RiderInput form={form} name="to_rider_id" label={t('pids.to_rider')} activeOnly hint={t('pids.to_rider_hint')} />
        <Grid>
          <TextInput form={form} name="date" type="date" label={t('pids.date')} hint={t('pids.date_hint')} />
        </Grid>
        <TextInput form={form} name="reason" label={t('pids.reason')} maxLength={255} />
      </form>
    </SidePanel>
  );
}

function HistoryPanel({ row, onClose }: { row: any; onClose: () => void }) {
  const { t } = useI18n();
  const [data, setData] = useState<any | null>(null);
  useEffect(() => { get(`/platform-ids/${row.id}`).then(setData).catch(() => setData({ history: [] })); }, [row.id]);
  return (
    <SidePanel open onClose={onClose} title={t('pids.history_title', { number: row.id_number })}>
      {!data ? <p className="text-sm text-zinc-500">{t('pids.loading')}</p> : !data.history.length ? <p className="text-sm text-zinc-500">{t('pids.no_history')}</p> :
        <ol className="space-y-3">{data.history.map((h: any) => (
          <li key={h.id} className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
            <div className="num text-xs text-zinc-500">{fmtDateTime(h.transferred_at)}{h.by_name ? ` · ${h.by_name}` : ''}</div>
            <div className="mt-1">{t('pids.from_to', { from: h.from_rider_id == null ? t('pids.nobody') : `${h.from_name ?? ''} #${h.from_rider_id}`, to: h.to_rider_id == null ? t('pids.nobody') : `${h.to_name ?? ''} #${h.to_rider_id}` })}</div>
            {h.reason && <div className="mt-1 text-zinc-600 dark:text-zinc-400">{h.reason}</div>}
          </li>))}</ol>}
    </SidePanel>
  );
}

function SharedIds() {
  const { t } = useI18n();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<any | null>(null);
  useEffect(() => { setData(null); get('/platform-ids/shared', { month }).then(setData).catch(() => setData({ rows: [] })); }, [month]);
  return (
    <>
      <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">{t('pids.shared_intro')}</p>
      <label className="mb-3 inline-flex items-center gap-2 text-sm">{t('pids.month')}
        <input type="month" className="input h-9" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></label>
      {!data ? <p className="text-sm text-zinc-500">{t('pids.loading')}</p> : !data.rows.length ? <p className="text-sm text-zinc-500">{t('pids.no_shared')}</p> :
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800"><table className="w-full text-sm">
          <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-900"><tr>
            {['pids.id_number', 'pids.platform', 'pids.riders_in_month', 'pids.transfers', 'pids.status'].map((k) => <th key={k} className="px-3 py-2 text-start font-medium">{t(k)}</th>)}</tr></thead>
          <tbody>{data.rows.map((r: any) => (
            <tr key={r.id} className="border-t border-zinc-100 dark:border-zinc-800">
              <td className="num px-3 py-2 font-medium" dir="ltr">{r.id_number}</td><td className="px-3 py-2">{r.platform}</td>
              <td className="px-3 py-2">{r.riders.map((x: any) => <div key={x.id}><Link to={`/admin/riders/${x.id}`} className="hover:underline">{x.full_name ?? `#${x.id}`}</Link> <span className="num text-xs text-zinc-500">#{x.id}</span></div>)}</td>
              <td className="num px-3 py-2">{fmtNum(r.transfers)}</td>
              <td className="px-3 py-2"><StatusBadge map={PID_STATUS} value={r.status} prefix="pids.st" /></td>
            </tr>))}</tbody></table></div>}
    </>
  );
}

export function PlatformIdsPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'shared' ? 'shared' : 'list';
  return (
    <>
      <PageHeader title={t('pids.title')} subtitle={t('pids.intro')} />
      <Tabs value={tab} onChange={(k) => setParams(k === 'shared' ? { tab: 'shared' } : {})} tabs={[{ key: 'list', label: t('pids.tab_list') }, { key: 'shared', label: t('pids.tab_shared') }]} />
      {tab === 'list' ? <IdList /> : <SharedIds />}
    </>
  );
}

export function PlatformIdsImport() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t('pids.import_title')} />
      <ImportWizard base="/platform-ids/import" back="/admin/platform-ids" intro={t('pids.import_intro')}
        modeLabels={{ question: t('pids.when_exists'), skip: t('import.skip'), replace: t('import.replace') }} />
    </>
  );
}

// The rider's IDs on the rider's profile
export function RiderPlatformIds({ riderId }: { riderId: number | string }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { get<any[]>(`/riders/${riderId}/platform-ids`).then(setRows).catch(() => setRows([])); }, [riderId]);
  if (!rows) return null;
  if (!rows.length) return <p className="text-sm text-zinc-500">{t('pids.rider_none')}</p>;
  return (
    <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">{rows.map((r) => (
      <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
        <span className="num font-medium" dir="ltr">{r.id_number}</span><span className="text-zinc-500">{r.platform}{r.contract ? ` · ${r.contract}` : ''}</span>
        <StatusBadge map={PID_STATUS} value={r.status} prefix="pids.st" />
        {Number(r.owner_rider_id) === Number(riderId) && <Badge tone="grey">{t('pids.role_owner')}</Badge>}
        {Number(r.worker_rider_id) === Number(riderId) && <Badge tone="blue">{t('pids.role_worker')}</Badge>}
      </li>))}</ul>
  );
}
