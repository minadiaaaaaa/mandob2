// Fleet → Servicing, Accidents and Vehicle papers (phase 4). The server keeps every rule (domain/fleetLog.ts):
// a service in progress puts its vehicle under maintenance, accident stages are kept in a history, and the papers
// table counts what each vehicle is missing.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ban, CheckCircle2, CreditCard, Flag, History, MapPin, Paperclip, Pencil, Play, Plus, StickyNote, Trash2 } from 'lucide-react';
import { del, get, patch, post } from '../../api';
import { useAuth } from '../../auth';
import { fmtDate, fmtDateTime, fmtMoney, fmtNum, useI18n } from '../../i18n';
import { Badge, Button, Field, IconButton, PageHeader, SidePanel, StatCard, StatGrid, toneIf, useAction, useUi, type Tone } from '../../ui/kit';
import { Grid, RiderInput, SelectInput, TextArea, TextInput, useForm } from '../../ui/forms';
import { DataTable, FilterBar, FilterSelect, useList, type Column } from '../../ui/table';
import { ExportButton, StatusBadge, useOptions } from '../../ui/common';
import { Attachments } from '../../ui/files';

export const SERVICE_STATUS: Record<string, Tone> = { scheduled: 'blue', in_progress: 'amber', completed: 'green', cancelled: 'grey' };
const SERVICE_TYPES = ['periodic', 'repair', 'accident_repair', 'tires', 'battery', 'inspection', 'other'];
export const ACCIDENT_STAGE: Record<string, Tone> = { report_pending: 'red', assessment_pending: 'amber', claim_pending: 'blue', completed: 'green' };
const STAGES = Object.keys(ACCIDENT_STAGE);
const SEVERITY: Record<string, Tone> = { minor: 'grey', moderate: 'amber', severe: 'red' };
const mapLink = (lat: unknown, lng: unknown) => `https://www.google.com/maps?q=${lat},${lng}`;

// The vehicles to choose from (the plate, and who holds it now)
function useVehicleOptions() {
  const rows = useOptions<any>('/vehicles/options');
  return rows.filter((v) => v.status !== 'retired').map((v) => ({ value: v.id, label: [v.plate, v.holder_name].filter(Boolean).join(' · ') }));
}
const Plate = ({ r }: { r: any }) => <div><Link to={`/admin/vehicles/${r.vehicle_id}`} className="font-medium hover:underline">{r.plate}</Link>
  {(r.maker || r.model) && <div className="text-xs text-zinc-500">{[r.maker, r.model].filter(Boolean).join(' ')}</div>}</div>;
const Rider = ({ r }: { r: any }) => (r.rider_id ? <Link to={`/admin/riders/${r.rider_id}`} className="hover:underline">{r.rider_name ?? `#${r.rider_id}`}</Link> : <span className="text-zinc-400">—</span>);

// ======================================================================== servicing
const SVC_EMPTY = { vehicle_id: '', rider_id: '', service_type: 'periodic', details: '', workshop: '', scheduled_for: '', odometer: '', start: false };

export function ServicingPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const { confirm } = useUi();
  const list = useList('/vehicle-services');
  const vehicles = useVehicleOptions();
  const form = useForm<Record<string, any>>(SVC_EMPTY);
  const [edit, setEdit] = useState<any | null>(null);
  const [closing, setClosing] = useState<{ row: any; kind: 'complete' | 'cancel' | 'pay' } | null>(null);
  const s = list.stats ?? {};

  const open = (r?: any) => {
    form.reset(r ? { ...SVC_EMPTY, vehicle_id: r.vehicle_id, rider_id: r.rider_id ?? '', service_type: r.service_type, details: r.details ?? '', workshop: r.workshop ?? '', scheduled_for: r.scheduled_for ?? '', odometer: r.odometer ?? '' } : SVC_EMPTY);
    setEdit(r ?? {});
  };
  const save = async () => {
    const r = await form.submit(() => {
      if (edit.id) { const { start: _s, ...c } = form.changes; return patch(`/vehicle-services/${edit.id}`, c); }
      const { rider_id, ...v } = form.values;
      return post('/vehicle-services', rider_id ? { ...v, rider_id } : v);
    });
    if (r) { setEdit(null); list.reload(); }
  };
  const start = async (r: any) => {
    if (!(await confirm({ title: t('svc.start_q', { plate: r.plate }), body: t('svc.start_body') }))) return;
    if (await run(() => post(`/vehicle-services/${r.id}/start`), t('svc.started'))) list.reload();
  };
  const remove = async (r: any) => {
    if (!(await confirm({ title: t('svc.delete_q'), body: t('common.cannot_undo'), tone: 'warn' }))) return;
    if (await run(() => del(`/vehicle-services/${r.id}`), t('svc.deleted'))) list.reload();
  };
  const status = (v: string) => list.set('status', list.query.status === v ? null : v);

  const columns: Column<any>[] = [
    { key: 'plate', header: t('svc.vehicle'), sort: 'plate', render: (r) => <Plate r={r} /> },
    { key: 'rider', header: t('svc.rider'), render: (r) => <Rider r={r} /> },
    { key: 'type', header: t('svc.type'), render: (r) => <div>{t(`svc.t.${r.service_type}`)}{r.details && <div className="max-w-64 truncate text-xs text-zinc-500" title={r.details}>{r.details}</div>}</div> },
    { key: 'when', header: t('svc.when'), sort: 'scheduled', render: (r) => <div className="num text-xs">
      {r.scheduled_for && <div>{t('svc.scheduled_for')}: {fmtDate(r.scheduled_for)}</div>}
      {r.started_at && <div>{t('svc.started_at')}: {fmtDate(r.started_at)}</div>}
      {r.completed_at && <div>{t('svc.completed_at')}: {fmtDate(r.completed_at)}</div>}</div> },
    { key: 'status', header: t('svc.status'), sort: 'status', render: (r) => <div><StatusBadge map={SERVICE_STATUS} value={r.status} prefix="svc.st" />
      {r.cancel_reason && <div className="text-xs text-zinc-500">{r.cancel_reason}</div>}</div> },
    { key: 'cost', header: t('svc.cost'), sort: 'cost', render: (r) => r.cost == null ? <span className="text-zinc-400">—</span> : <div className="num">{fmtMoney(r.cost)}
      <div className="text-xs">{r.unpaid ? <Badge tone="amber">{t('svc.unpaid')}</Badge> : <Badge tone="green">{t('svc.paid')}</Badge>}</div></div> },
    { key: 'actions', header: t('common.actions'), render: (r) => <div className="flex">
      {r.status === 'scheduled' && can('vehicle_services.update') && <IconButton title={t('svc.start')} onClick={() => start(r)}><Play /></IconButton>}
      {(r.status === 'scheduled' || r.status === 'in_progress') && can('vehicle_services.update') && <>
        <IconButton title={t('svc.complete')} tone="green" onClick={() => setClosing({ row: r, kind: 'complete' })}><CheckCircle2 /></IconButton>
        <IconButton title={t('svc.cancel')} tone="amber" onClick={() => setClosing({ row: r, kind: 'cancel' })}><Ban /></IconButton></>}
      {r.status === 'completed' && r.cost != null && can('vehicle_services.pay') && <IconButton title={t('svc.pay')} onClick={() => setClosing({ row: r, kind: 'pay' })}><CreditCard /></IconButton>}
      {can('vehicle_services.update') && r.status !== 'cancelled' && <IconButton title={t('common.edit')} onClick={() => open(r)}><Pencil /></IconButton>}
      {(r.status === 'scheduled' || r.status === 'cancelled') && can('vehicle_services.delete') && <IconButton title={t('common.delete')} tone="red" onClick={() => remove(r)}><Trash2 /></IconButton>}
    </div> },
  ];
  return (
    <>
      <PageHeader title={t('svc.title')} subtitle={t('svc.intro')} actions={<>
        {can('vehicle_services.export') && <ExportButton path="/vehicle-services/export" query={list.query} />}
        {can('vehicle_services.create') && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => open()}>{t('svc.new')}</Button>}
      </>} />
      <StatGrid>
        <StatCard label={t('svc.s.total')} value={fmtNum(s.total)} onClick={() => list.set('status', null)} active={!list.query.status} />
        {['scheduled', 'in_progress', 'completed', 'cancelled'].map((k) => <StatCard key={k} label={t(`svc.st.${k}`)} value={fmtNum(s[k])} tone={k === 'in_progress' ? toneIf(s[k], 'amber') : k === 'completed' ? 'green' : 'none'} onClick={() => status(k)} active={list.query.status === k} />)}
        <StatCard label={t('svc.s.cost')} value={fmtMoney(s.cost)} />
        <StatCard label={t('svc.s.unpaid')} value={fmtMoney(s.unpaid)} tone={toneIf(Number(s.unpaid), 'amber')} onClick={() => list.set('unpaid', list.query.unpaid ? null : '1')} active={!!list.query.unpaid} />
      </StatGrid>
      <FilterBar list={list} placeholder={t('svc.search_hint')}>
        <FilterSelect list={list} name="type" label={t('svc.type')} options={SERVICE_TYPES.map((k) => ({ value: k, label: t(`svc.t.${k}`) }))} />
        <FilterSelect list={list} name="vehicle" label={t('svc.vehicle')} options={vehicles} />
      </FilterBar>
      <DataTable list={list} columns={columns} emptyText={t('svc.none')} />

      <SidePanel open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? t('svc.edit') : t('svc.new')}
        footer={<><Button onClick={() => setEdit(null)}>{t('common.cancel')}</Button><Button variant="primary" disabled={form.busy} onClick={save}>{t('common.save')}</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); save(); }}>
          <Grid>
            <SelectInput form={form} name="vehicle_id" label={t('svc.vehicle')} required options={vehicles} disabled={!!edit?.id && edit.status !== 'scheduled'} />
            <SelectInput form={form} name="service_type" label={t('svc.type')} empty={false} options={SERVICE_TYPES.map((k) => ({ value: k, label: t(`svc.t.${k}`) }))} />
            <TextInput form={form} name="scheduled_for" type="date" label={t('svc.scheduled_for')} />
            <TextInput form={form} name="workshop" label={t('svc.workshop')} maxLength={150} />
            <TextInput form={form} name="odometer" type="number" label={t('svc.odometer')} dir="ltr" />
          </Grid>
          <RiderInput form={form} name="rider_id" label={t('svc.rider')} hint={t('svc.rider_hint')} />
          <TextArea form={form} name="details" label={t('svc.details')} maxLength={1000} />
          {!edit?.id && <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={!!form.values.start} onChange={(e) => form.set('start', e.target.checked)} />{t('svc.start_now')}</label>}
        </form>
      </SidePanel>
      {closing && <ServiceAction {...closing} onClose={() => setClosing(null)} onDone={() => { setClosing(null); list.reload(); }} />}
    </>
  );
}

function ServiceAction({ row, kind, onClose, onDone }: { row: any; kind: 'complete' | 'cancel' | 'pay'; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const left = row.cost == null ? '' : String(Math.max(0, Number(row.cost) - Number(row.paid_amount ?? 0)));
  const form = useForm<Record<string, any>>(kind === 'complete' ? { cost: row.cost ?? '', odometer: '', done: '', details: '' }
    : kind === 'cancel' ? { reason: '' } : { amount: row.paid_amount ?? (left || row.cost), paid_on: '', ref: row.payment_ref ?? '' });
  const save = async () => {
    const r = await form.submit(() => post(`/vehicle-services/${row.id}/${kind}`, form.values));
    if (r) onDone();
  };
  return (
    <SidePanel open onClose={onClose} title={t(`svc.${kind}_title`, { plate: row.plate })}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant={kind === 'cancel' ? 'danger' : 'primary'} disabled={form.busy} onClick={save}>{t(`svc.${kind}`)}</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); save(); }}>
        {kind === 'complete' && <><Grid>
          <TextInput form={form} name="cost" type="number" label={t('svc.cost')} dir="ltr" />
          <TextInput form={form} name="odometer" type="number" label={t('svc.odometer')} dir="ltr" />
          <TextInput form={form} name="done" type="date" label={t('svc.completed_at')} hint={t('svc.done_hint')} />
        </Grid><TextArea form={form} name="details" label={t('svc.details')} maxLength={1000} /></>}
        {kind === 'cancel' && <TextInput form={form} name="reason" label={t('svc.cancel_reason')} required maxLength={255} />}
        {kind === 'pay' && <><p className="mb-3 text-sm">{t('svc.cost')}: <span className="num font-medium">{fmtMoney(row.cost)}</span></p><Grid>
          <TextInput form={form} name="amount" type="number" label={t('svc.paid_amount')} required dir="ltr" />
          <TextInput form={form} name="paid_on" type="date" label={t('svc.paid_on')} hint={t('svc.paid_on_hint')} />
        </Grid><TextInput form={form} name="ref" label={t('svc.payment_ref')} maxLength={100} /></>}
      </form>
    </SidePanel>
  );
}

// ======================================================================== accidents
const ACC_EMPTY = { vehicle_id: '', rider_id: '', occurred_at: '', severity: 'minor', authority: 'najm', report_number: '', location: '', lat: '', lng: '', details: '', assessment_amount: '', claim_amount: '', rider_share: '' };

export function AccidentsPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const { confirm } = useUi();
  const list = useList('/vehicle-accidents');
  const vehicles = useVehicleOptions();
  const form = useForm<Record<string, any>>(ACC_EMPTY);
  const [edit, setEdit] = useState<any | null>(null);
  const [view, setView] = useState<any | null>(null);
  const s = list.stats ?? {};

  const open = (r?: any) => {
    form.reset(r ? Object.fromEntries(Object.keys(ACC_EMPTY).map((k) => [k, k === 'occurred_at' ? String(r.occurred_at ?? '').slice(0, 16).replace(' ', 'T') : r[k] ?? ''])) : ACC_EMPTY);
    setEdit(r ?? {});
  };
  const save = async () => {
    const r = await form.submit(() => {
      if (edit.id) return patch(`/vehicle-accidents/${edit.id}`, form.changes);
      const { rider_id, ...v } = form.values;
      return post('/vehicle-accidents', rider_id ? { ...v, rider_id } : v);
    });
    if (r) { setEdit(null); list.reload(); }
  };
  const remove = async (r: any) => {
    if (!(await confirm({ title: t('acc.delete_q'), body: t('common.cannot_undo'), tone: 'warn' }))) return;
    if (await run(() => del(`/vehicle-accidents/${r.id}`), t('acc.deleted'))) list.reload();
  };
  const stage = (v: string) => list.set('stage', list.query.stage === v ? null : v);

  const columns: Column<any>[] = [
    { key: 'occurred', header: t('acc.occurred_at'), sort: 'occurred', render: (r) => <span className="num text-xs">{String(r.occurred_at).slice(0, 16)}</span> },
    { key: 'plate', header: t('acc.vehicle'), sort: 'plate', render: (r) => <Plate r={r} /> },
    { key: 'rider', header: t('acc.rider'), render: (r) => <Rider r={r} /> },
    { key: 'accident', header: t('acc.accident'), sort: 'severity', render: (r) => <div className="space-x-1 rtl:space-x-reverse">
      <Badge tone={SEVERITY[r.severity]}>{t(`acc.sev.${r.severity}`)}</Badge><Badge tone="grey">{t(`acc.auth.${r.authority}`)}</Badge>
      {r.report_number && <div className="num text-xs text-zinc-500">{r.report_number}</div>}</div> },
    { key: 'details', header: t('acc.details'), render: (r) => <div className="max-w-64">{r.location && <div className="text-xs">{r.lat != null && r.lng != null
      ? <a href={mapLink(r.lat, r.lng)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline"><MapPin className="size-3" />{r.location}</a> : r.location}</div>}
      {r.details && <div className="truncate text-xs text-zinc-500" title={r.details}>{r.details}</div>}</div> },
    { key: 'stage', header: t('acc.stage'), sort: 'stage', render: (r) => <StatusBadge map={ACCIDENT_STAGE} value={r.stage} prefix="acc.stg" /> },
    { key: 'actions', header: t('common.actions'), render: (r) => <div className="flex">
      <IconButton title={t('acc.open')} onClick={() => setView(r)}><Flag /></IconButton>
      {can('vehicle_accidents.update') && <IconButton title={t('common.edit')} onClick={() => open(r)}><Pencil /></IconButton>}
      {can('vehicle_accidents.delete') && <IconButton title={t('common.delete')} tone="red" onClick={() => remove(r)}><Trash2 /></IconButton>}
    </div> },
  ];
  return (
    <>
      <PageHeader title={t('acc.title')} subtitle={t('acc.intro')} actions={<>
        {can('vehicle_accidents.export') && <ExportButton path="/vehicle-accidents/export" query={list.query} />}
        {can('vehicle_accidents.create') && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => open()}>{t('acc.new')}</Button>}
      </>} />
      <StatGrid>
        <StatCard label={t('acc.s.total')} value={fmtNum(s.total)} onClick={() => list.set('stage', null)} active={!list.query.stage} />
        {STAGES.map((k) => <StatCard key={k} label={t(`acc.stg.${k}`)} value={fmtNum(s[k])} tone={k === 'completed' ? 'green' : toneIf(s[k], ACCIDENT_STAGE[k])} onClick={() => stage(k)} active={list.query.stage === k} />)}
        <StatCard label={t('acc.s.severe')} value={fmtNum(s.severe)} tone={toneIf(s.severe, 'red')} onClick={() => list.set('severity', list.query.severity === 'severe' ? null : 'severe')} active={list.query.severity === 'severe'} />
      </StatGrid>
      <FilterBar list={list} placeholder={t('acc.search_hint')}>
        <FilterSelect list={list} name="severity" label={t('acc.severity')} options={Object.keys(SEVERITY).map((k) => ({ value: k, label: t(`acc.sev.${k}`) }))} />
        <FilterSelect list={list} name="authority" label={t('acc.authority')} options={['najm', 'murur'].map((k) => ({ value: k, label: t(`acc.auth.${k}`) }))} />
        <FilterSelect list={list} name="vehicle" label={t('acc.vehicle')} options={vehicles} />
      </FilterBar>
      <DataTable list={list} columns={columns} emptyText={t('acc.none')} />

      <SidePanel open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? t('acc.edit') : t('acc.new')}
        footer={<><Button onClick={() => setEdit(null)}>{t('common.cancel')}</Button><Button variant="primary" disabled={form.busy} onClick={save}>{t('common.save')}</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); save(); }}>
          <Grid>
            <SelectInput form={form} name="vehicle_id" label={t('acc.vehicle')} required options={vehicles} />
            <TextInput form={form} name="occurred_at" type="datetime-local" label={t('acc.occurred_at')} required />
            <SelectInput form={form} name="severity" label={t('acc.severity')} empty={false} options={Object.keys(SEVERITY).map((k) => ({ value: k, label: t(`acc.sev.${k}`) }))} />
            <SelectInput form={form} name="authority" label={t('acc.authority')} empty={false} options={['najm', 'murur'].map((k) => ({ value: k, label: t(`acc.auth.${k}`) }))} />
            <TextInput form={form} name="report_number" label={t('acc.report_number')} dir="ltr" maxLength={60} />
            <TextInput form={form} name="location" label={t('acc.location')} maxLength={255} />
            <TextInput form={form} name="lat" type="number" label={t('acc.lat')} dir="ltr" />
            <TextInput form={form} name="lng" type="number" label={t('acc.lng')} dir="ltr" />
          </Grid>
          <RiderInput form={form} name="rider_id" label={t('acc.rider')} hint={t('acc.rider_hint')} />
          <TextArea form={form} name="details" label={t('acc.details')} maxLength={2000} />
          <Grid cols={3}>
            <TextInput form={form} name="assessment_amount" type="number" label={t('acc.assessment_amount')} dir="ltr" />
            <TextInput form={form} name="claim_amount" type="number" label={t('acc.claim_amount')} dir="ltr" />
            <TextInput form={form} name="rider_share" type="number" label={t('acc.rider_share')} dir="ltr" />
          </Grid>
        </form>
      </SidePanel>
      {view && <AccidentPanel id={view.id} onClose={() => setView(null)} onChanged={list.reload} />}
    </>
  );
}

function AccidentPanel({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const [a, setA] = useState<any | null>(null);
  const form = useForm<Record<string, any>>({ to: '', note: '' });
  const load = () => get(`/vehicle-accidents/${id}`).then(setA).catch(() => setA(null));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const move = async () => {
    const r = await form.submit(() => post(`/vehicle-accidents/${id}/stage`, form.values));
    if (r) { form.reset({ to: '', note: '' }); load(); onChanged(); }
  };
  return (
    <SidePanel open onClose={onClose} title={a ? t('acc.panel_title', { plate: a.plate }) : t('acc.open')}>
      {!a ? <p className="text-sm text-zinc-500">{t('pids.loading')}</p> : <div className="space-y-4 text-sm">
        <div className="flex flex-wrap gap-1"><StatusBadge map={ACCIDENT_STAGE} value={a.stage} prefix="acc.stg" /><Badge tone={SEVERITY[a.severity]}>{t(`acc.sev.${a.severity}`)}</Badge><Badge tone="grey">{t(`acc.auth.${a.authority}`)}</Badge></div>
        <div className="num text-xs text-zinc-500">{String(a.occurred_at).slice(0, 16)}{a.report_number ? ` · ${a.report_number}` : ''}</div>
        {a.location && <div>{a.lat != null && a.lng != null ? <a className="inline-flex items-center gap-1 text-brand hover:underline" href={mapLink(a.lat, a.lng)} target="_blank" rel="noreferrer"><MapPin className="size-4" />{a.location}</a> : a.location}</div>}
        {a.details && <p className="whitespace-pre-line">{a.details}</p>}
        {(a.assessment_amount != null || a.claim_amount != null || a.rider_share != null) && <div className="grid grid-cols-3 gap-2 text-xs">
          {[['acc.assessment_amount', a.assessment_amount], ['acc.claim_amount', a.claim_amount], ['acc.rider_share', a.rider_share]].map(([k, v]) => <div key={k}><div className="text-zinc-500">{t(k)}</div><div className="num">{v == null ? '—' : fmtMoney(v)}</div></div>)}</div>}
        {can('vehicle_accidents.update') && <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <div className="mb-2 font-medium">{t('acc.move')}</div>
          <SelectInput form={form} name="to" label={t('acc.to_stage')} options={STAGES.filter((k) => k !== a.stage).map((k) => ({ value: k, label: t(`acc.stg.${k}`) }))} />
          <TextInput form={form} name="note" label={t('acc.note')} hint={t('acc.note_hint')} maxLength={500} />
          <div className="mt-2"><Button variant="primary" disabled={!form.values.to || form.busy} onClick={move}>{t('acc.move_btn')}</Button></div>
        </div>}
        <Attachments entityType="accident" entityId={a.id} title={t('acc.papers')} canUpload={can('vehicle_accidents.update')} />
        {!!a.services?.length && <div><div className="mb-1 font-medium">{t('acc.repairs')}</div>{a.services.map((x: any) => <div key={x.id} className="flex gap-2 text-xs">
          <StatusBadge map={SERVICE_STATUS} value={x.status} prefix="svc.st" /><span>{t(`svc.t.${x.service_type}`)}</span>{x.cost != null && <span className="num">{fmtMoney(x.cost)}</span>}</div>)}</div>}
        <div><div className="mb-1 flex items-center gap-1 font-medium"><History className="size-4" />{t('acc.history')}</div>
          <ol className="space-y-2">{a.events.map((e: any) => <li key={e.id} className="rounded border border-zinc-100 p-2 text-xs dark:border-zinc-800">
            <div className="num text-zinc-500">{fmtDateTime(e.at)}{e.by_name ? ` · ${e.by_name}` : ''}</div>
            <div>{e.from_stage ? t('pids.from_to', { from: t(`acc.stg.${e.from_stage}`), to: t(`acc.stg.${e.to_stage}`) }) : t(`acc.stg.${e.to_stage}`)}</div>
            {e.note && <div className="text-zinc-600 dark:text-zinc-400">{e.note}</div>}</li>)}</ol></div>
      </div>}
    </SidePanel>
  );
}

// ======================================================================== vehicle papers
const PAPERS = ['photo', 'registration', 'key_handover', 'operation_card'] as const;

export function VehiclePapersPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const [q, setQ] = useState({ search: '', missing: '' });
  const [data, setData] = useState<any | null>(null);
  const [upload, setUpload] = useState<{ v: any; type: 'photo' | 'key_handover' } | null>(null);
  const [note, setNote] = useState<any | null>(null);
  const load = () => get('/vehicle-papers', q).then(setData).catch(() => setData({ rows: [], stats: {} }));
  useEffect(() => { const h = setTimeout(load, 250); return () => clearTimeout(h); }, [q.search, q.missing]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = data?.stats ?? {};
  const cell = (v: any, k: (typeof PAPERS)[number]) => {
    const have = v[`${k}_id`] != null;
    const exp = k === 'registration' ? v.registration_expiry : k === 'operation_card' ? v.operation_card_expiry : null;
    const link = k === 'registration' ? (have ? `/admin/vehicle-registrations/${v.registration_id}` : '/admin/vehicle-registrations') : k === 'operation_card' ? (have ? `/admin/operation-cards/${v.operation_card_id}` : '/admin/operation-cards') : null;
    const mark = <span className={have ? 'text-emerald-600' : 'text-red-600'}>{have ? '✓' : '✗'}</span>;
    return <div className="flex items-center gap-1">
      {link ? <Link to={link} className="hover:underline">{mark}</Link> : mark}
      {exp && <span className="num text-xs text-zinc-500">{fmtDate(exp)}</span>}
      {(k === 'photo' || k === 'key_handover') && can('attachments.upload') && <IconButton title={t('vp.upload')} onClick={() => setUpload({ v, type: k })}><Paperclip /></IconButton>}
    </div>;
  };
  const saveNote = async () => {
    if (await run(() => patch(`/vehicles/${note.id}/papers-note`, { papers_note: note.papers_note ?? '' }), t('vp.note_saved'))) { setNote(null); load(); }
  };
  return (
    <>
      <PageHeader title={t('vp.title')} subtitle={t('vp.intro')} />
      <StatGrid>
        <StatCard label={t('vp.s.total')} value={fmtNum(s.total)} onClick={() => setQ({ ...q, missing: '' })} active={!q.missing} />
        <StatCard label={t('vp.s.complete')} value={fmtNum(s.complete)} tone="green" />
        <StatCard label={t('vp.s.missing')} value={fmtNum(s.missing)} tone={toneIf(s.missing, 'red')} onClick={() => setQ({ ...q, missing: q.missing ? '' : '1' })} active={!!q.missing} />
      </StatGrid>
      <input className="input mb-3 max-w-sm" placeholder={t('vp.search_hint')} value={q.search} onChange={(e) => setQ({ ...q, search: e.target.value })} />
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800"><table className="w-full text-sm">
        <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-900"><tr>
          {['vp.vehicle', 'vp.rider', ...PAPERS.map((k) => `vp.p.${k}`), 'vp.note', 'vp.missing'].map((k) => <th key={k} className="px-3 py-2 text-start font-medium">{t(k)}</th>)}</tr></thead>
        <tbody>{(data?.rows ?? []).map((v: any) => (
          <tr key={v.id} className="border-t border-zinc-100 dark:border-zinc-800">
            <td className="px-3 py-2"><Link to={`/admin/vehicles/${v.id}`} className="font-medium hover:underline">{v.plate}</Link></td>
            <td className="px-3 py-2">{v.rider_id ? <Link to={`/admin/riders/${v.rider_id}`} className="hover:underline">{v.rider_name}</Link> : <span className="text-zinc-400">—</span>}</td>
            {PAPERS.map((k) => <td key={k} className="px-3 py-2">{cell(v, k)}</td>)}
            <td className="px-3 py-2"><span className="inline-flex items-center gap-1"><span className="max-w-40 truncate text-xs" title={v.papers_note ?? ''}>{v.papers_note ?? ''}</span>
              {can('vehicles.update') && <IconButton title={t('vp.write_note')} onClick={() => setNote({ id: v.id, plate: v.plate, papers_note: v.papers_note ?? '' })}><StickyNote /></IconButton>}</span></td>
            <td className="px-3 py-2">{v.missing ? <Badge tone="red">{fmtNum(v.missing)}</Badge> : <Badge tone="green">0</Badge>}</td>
          </tr>))}</tbody></table>
        {data && !data.rows.length && <p className="p-4 text-sm text-zinc-500">{t('vp.none')}</p>}</div>
      {upload && <SidePanel open onClose={() => { setUpload(null); load(); }} title={t('vp.upload_title', { paper: t(`vp.p.${upload.type}`), plate: upload.v.plate })}>
        <Attachments entityType="vehicle" entityId={upload.v.id} attachmentType={upload.type} title={t(`vp.p.${upload.type}`)} />
      </SidePanel>}
      {note && <SidePanel open onClose={() => setNote(null)} title={t('vp.note_title', { plate: note.plate })}
        footer={<><Button onClick={() => setNote(null)}>{t('common.cancel')}</Button><Button variant="primary" onClick={saveNote}>{t('common.save')}</Button></>}>
        <Field label={t('vp.note')}><textarea className="input min-h-24" maxLength={500} value={note.papers_note} onChange={(e) => setNote({ ...note, papers_note: e.target.value })} /></Field>
      </SidePanel>}
    </>
  );
}

// ======================================================================== on the vehicle profile
export function VehicleFleetLog({ vehicleId }: { vehicleId: number | string }) {
  const { t } = useI18n();
  const [d, setD] = useState<any | null>(null);
  useEffect(() => { get(`/vehicles/${vehicleId}/fleet-log`).then(setD).catch(() => setD({ services: [], accidents: [] })); }, [vehicleId]);
  if (!d) return null;
  return (
    <div className="grid gap-4 md:grid-cols-2 text-sm">
      <div><div className="mb-1 flex items-center justify-between font-medium">{t('svc.title')}<Link to={`/admin/vehicle-services?vehicle=${vehicleId}`} className="text-xs text-brand hover:underline">{t('vp.all')}</Link></div>
        {!d.services.length ? <p className="text-zinc-500">{t('svc.none')}</p> : <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">{d.services.map((s: any) => <li key={s.id} className="flex flex-wrap items-center gap-2 py-1.5">
          <StatusBadge map={SERVICE_STATUS} value={s.status} prefix="svc.st" /><span>{t(`svc.t.${s.service_type}`)}</span>
          <span className="num text-xs text-zinc-500">{fmtDate(s.completed_at ?? s.started_at ?? s.scheduled_for)}</span>{s.cost != null && <span className="num text-xs">{fmtMoney(s.cost)}</span>}</li>)}</ul>}</div>
      <div><div className="mb-1 flex items-center justify-between font-medium">{t('acc.title')}<Link to={`/admin/vehicle-accidents?vehicle=${vehicleId}`} className="text-xs text-brand hover:underline">{t('vp.all')}</Link></div>
        {!d.accidents.length ? <p className="text-zinc-500">{t('acc.none')}</p> : <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">{d.accidents.map((a: any) => <li key={a.id} className="flex flex-wrap items-center gap-2 py-1.5">
          <StatusBadge map={ACCIDENT_STAGE} value={a.stage} prefix="acc.stg" /><Badge tone={SEVERITY[a.severity]}>{t(`acc.sev.${a.severity}`)}</Badge>
          <span className="num text-xs text-zinc-500">{String(a.occurred_at).slice(0, 10)}</span>{a.rider_name && <span className="text-xs">{a.rider_name}</span>}</li>)}</ul>}</div>
    </div>
  );
}
