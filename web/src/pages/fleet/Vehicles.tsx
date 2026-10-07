import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, Eye, FileUp, Pencil, Plus, Trash2, Wrench, Play } from 'lucide-react';
import { del, download, get, patch, post } from '../../api';
import { useAuth } from '../../auth';
import { fmtNum, useI18n } from '../../i18n';
import { Badge, Button, Card, Checkbox, Details, IconButton, Loading, PageHeader, StatCard, StatGrid, toneIf, useAction, useErrorText, useUi, type Tone } from '../../ui/kit';
import { Grid, SaveBar, SelectInput, TextArea, TextInput, useForm } from '../../ui/forms';
import { DataTable, FilterBar, FilterSelect, useList, type Column } from '../../ui/table';
import { Attachments, ScanUpload, type Scan } from '../../ui/files';
import { ImportWizard } from '../../ui/importer';
import { ExpiryDate, ExportButton, useCityName, useOptions } from '../../ui/common';

export const VEHICLE_STATUS: Record<string, Tone> = { active: 'green', maintenance: 'amber', retired: 'grey' };
export const VStatus = ({ s }: { s: string }) => { const { t } = useI18n(); return <Badge tone={VEHICLE_STATUS[s]}>{t(`vehicle.status.${s}`)}</Badge>; };
export const VTYPES = ['car', 'motorcycle', 'bicycle', 'scooter', 'van', 'truck'];
export const typeLabel = (t: (k: string) => string, v: string) => (VTYPES.includes(v) ? t(`vehicle.type.${v}`) : v);
const riderList = (s: string | null) => (s ? s.split('\n').map((x) => { const [id, name] = x.split('\t'); return { id, name }; }) : []);

// Shown when deletion is refused: what still points at the record.
export function useDeleteWithBlockers() {
  const { t } = useI18n();
  const { confirm } = useUi();
  const errText = useErrorText();
  return async (fn: () => Promise<unknown>) => {
    try { await fn(); return true; }
    catch (e: any) {
      const b = e?.params?.blockers as { what: string; n: number }[] | undefined;
      const sums = b && Object.entries(b.reduce<Record<string, number>>((m, x) => ({ ...m, [x.what]: (m[x.what] ?? 0) + Number(x.n) }), {}));
      await confirm({ title: t('common.cannot_delete'), tone: 'primary', confirm: t('common.ok'),
        body: <>{errText(e)}{sums && <ul className="mt-2 list-disc ps-5">{sums.map(([w, n]) => <li key={w}>{t(`linked.${w}`)}: {n}</li>)}</ul>}</> });
      return false;
    }
  };
}

export function VehiclesList() {
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const run = useAction();
  const { confirm } = useUi();
  const delWith = useDeleteWithBlockers();
  const list = useList('/vehicles');
  const s = list.stats ?? {};
  const f = list.data?.facets ?? { types: [], makers: [], registration_types: [] };
  const remove = async (ids: (string | number)[]) => {
    if (!(await confirm({ title: t('vehicles.delete_q', { n: ids.length }), body: t('common.cannot_undo') }))) return;
    if (await delWith(() => (ids.length > 1 ? post('/vehicles/bulk-delete', { ids }) : del(`/vehicles/${ids[0]}`)))) { list.setSelected(new Set()); list.reload(); }
  };
  const columns: Column<any>[] = [
    { key: 'plate', header: t('vehicles.plate'), sort: 'plate', render: (r) => <div><div className="font-medium">{r.plate}</div><div className="text-xs text-zinc-500">{[r.plate_en, typeLabel(t, r.vehicle_type), `#${r.id}`].filter(Boolean).join(' · ')}</div></div> },
    { key: 'make', header: t('vehicles.make_model'), sort: 'make', render: (r) => <div>{[r.maker, r.model].filter(Boolean).join(' ') || '—'}{r.color && <div className="text-xs text-zinc-500">{r.color}</div>}</div> },
    { key: 'year', header: t('vehicles.year'), sort: 'year', render: (r) => <span className="num">{r.year ?? '—'}</span> },
    { key: 'ownership', header: t('vehicles.ownership'), sort: 'ownership', render: (r) => t(`vehicle.own.${r.ownership}`) },
    { key: 'rider', header: t('vehicles.current_rider'), render: (r) => { const rs = riderList(r.riders); return rs.length ? <div>{rs.map((x) => <div key={x.id}><Link to={`/admin/riders/${x.id}`} className="hover:text-brand">{x.name}</Link> <span className="text-xs text-zinc-500 num">#{x.id}</span></div>)}{rs.length > 1 && <Badge tone="amber">{rs.length}</Badge>}</div> : <span className="text-zinc-500">{t('vehicles.unassigned')}</span>; } },
    { key: 'card', header: t('vehicles.card'), sort: 'card', render: (r) => r.card_id ? <div><ExpiryDate date={r.card_expiry} days={r.card_days} /><div className="text-xs text-zinc-500 num">{r.card_number}{r.card_vehicles > 1 && ` · ${t('vehicles.n_vehicles', { n: r.card_vehicles })}`}</div></div> : <span className="text-zinc-500">{t('vehicles.no_card')}</span> },
    { key: 'status', header: t('vehicles.status'), sort: 'status', render: (r) => <VStatus s={r.status} /> },
    { key: 'actions', header: t('common.actions'), render: (r) => (
      <div className="flex">
        <IconButton title={t('common.view')} onClick={() => nav(`/admin/vehicles/${r.id}`)}><Eye /></IconButton>
        {can('vehicles.update') && <IconButton title={t('vehicles.edit')} onClick={() => nav(`/admin/vehicles/${r.id}/edit`)}><Pencil /></IconButton>}
        {can('vehicles.delete') && <IconButton title={t('vehicles.delete')} tone="red" onClick={() => remove([r.id])}><Trash2 /></IconButton>}
      </div>
    ) },
  ];
  const st = (k: string) => () => list.set('status', list.query.status === k ? null : k);
  return (
    <>
      <PageHeader title={t('vehicles.title')} actions={<>
        {can('vehicles.export') && <ExportButton path="/vehicles/export" query={list.query} />}
        {can('vehicles.import') && <Button size="sm" onClick={() => run(() => download('/vehicles/import/template'))}>{t('import.download_template')}</Button>}
        {can('vehicles.import') && <Link to="/admin/vehicles/import"><Button size="sm" icon={<FileUp className="size-3.5" />}>{t('import.import_file')}</Button></Link>}
        {can('vehicles.create') && <Link to="/admin/vehicles/new"><Button variant="primary" icon={<Plus className="size-4" />}>{t('vehicles.add')}</Button></Link>}
      </>} />
      <StatGrid>
        <StatCard label={t('common.total')} value={fmtNum(s.total)} />
        <StatCard label={t('vehicle.status.active')} value={fmtNum(s.active)} tone="green" onClick={st('active')} active={list.query.status === 'active'} />
        <StatCard label={t('vehicle.status.maintenance')} value={fmtNum(s.maintenance)} tone={toneIf(s.maintenance, 'amber')} onClick={st('maintenance')} active={list.query.status === 'maintenance'} />
        <StatCard label={t('vehicle.status.retired')} value={fmtNum(s.retired)} onClick={st('retired')} active={list.query.status === 'retired'} />
        <StatCard label={t('vehicle.own.owned')} value={fmtNum(s.owned)} />
        <StatCard label={t('vehicle.own.rented')} value={fmtNum(s.rented)} />
        <StatCard label={t('vehicles.with_rider')} value={fmtNum(s.with_rider)} />
        <StatCard label={t('vehicles.unassigned')} value={fmtNum(s.unassigned)} tone={toneIf(s.unassigned, 'amber')} />
        <StatCard label={t('vehicles.cards_soon')} value={fmtNum(s.cards_soon)} tone={toneIf(s.cards_soon, 'amber')} />
        <StatCard label={t('vehicles.cards_expired')} value={fmtNum(s.cards_expired)} tone={toneIf(s.cards_expired, 'red')} />
      </StatGrid>
      <FilterBar list={list} placeholder={t('vehicles.search_hint')}>
        <FilterSelect list={list} name="status" label={t('vehicles.status')} options={Object.keys(VEHICLE_STATUS).map((v) => ({ value: v, label: t(`vehicle.status.${v}`) }))} />
        <FilterSelect list={list} name="type" label={t('vehicles.type')} options={f.types.map((v: string) => ({ value: v, label: typeLabel(t, v) }))} />
        <FilterSelect list={list} name="ownership" label={t('vehicles.ownership')} options={['owned', 'rented'].map((v) => ({ value: v, label: t(`vehicle.own.${v}`) }))} />
        {f.makers.length > 0 && <FilterSelect list={list} name="maker" label={t('vehicles.maker')} options={f.makers.map((v: string) => ({ value: v, label: v }))} />}
        {f.registration_types.length > 0 && <FilterSelect list={list} name="registration_type" label={t('vehicles.registration_type')} options={f.registration_types.map((v: string) => ({ value: v, label: v }))} />}
        <FilterSelect list={list} name="assignment" label={t('vehicles.assignment')} options={[{ value: 'assigned', label: t('vehicles.with_rider') }, { value: 'unassigned', label: t('vehicles.unassigned') }]} />
        <FilterSelect list={list} name="card" label={t('vehicles.card')} options={[{ value: 'yes', label: t('vehicles.has_card') }, { value: 'no', label: t('vehicles.no_card') }]} />
      </FilterBar>
      <DataTable list={list} columns={columns} onRowClick={(r) => nav(`/admin/vehicles/${r.id}`)} selectable={can('vehicles.delete')}
        bulk={<Button size="sm" variant="danger" onClick={() => remove([...list.selected])}>{t('common.delete_selected')}</Button>} />
    </>
  );
}

const V_EMPTY = { plate: '', plate_en: '', vehicle_type: '', registration_type: '', maker: '', model: '', color: '', year: '', chassis: '', weight: '', capacity: '', ownership: 'owned', status: 'active', odometer: '',
  current_card_id: '', current_registration_id: '' };

export function VehicleForm() {
  const { id } = useParams();
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const city = useCityName();
  const form = useForm<Record<string, any>>(V_EMPTY);
  const card = useForm<Record<string, any>>({ number: '', transport_license_id: '', issue_date: '', expiry_date: '', notes: '' });
  const [withCard, setWithCard] = useState(false);
  const [scan, setScan] = useState<Scan | null>(null);
  const [loaded, setLoaded] = useState<any>(id ? null : {});
  const [saved, setSaved] = useState<number | null>(null);
  const cards = useOptions<any>(can('operation_cards.view') ? '/operation-cards/options' : null);
  const regs = useOptions<any>(can('vehicle_registrations.view') ? '/vehicle-registrations/options' : null);
  const licenses = useOptions<any>(withCard ? '/transport-licenses/options' : null);
  useEffect(() => { if (id) get(`/vehicles/${id}`).then((v) => { setLoaded(v); form.reset(Object.fromEntries(Object.keys(V_EMPTY).map((k) => [k, v[k] ?? '']))); }); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!loaded) return <Loading />;
  if (saved) return (
    <div className="space-y-4">
      <Card><div className="py-6 text-center"><CheckCircle2 className="mx-auto size-10 text-emerald-500" /><h2 className="mt-2 text-lg font-semibold">{t('vehicles.saved')}</h2>
        <div className="mt-4 flex justify-center gap-2"><Link to={`/admin/vehicles/${saved}`}><Button variant="primary">{t('vehicles.open')}</Button></Link>
          <Button onClick={() => { setSaved(null); form.reset(V_EMPTY); setWithCard(false); }}>{t('vehicles.add_another')}</Button></div></div></Card>
      <Attachments entityType="vehicle" entityId={saved} title={t('vehicles.registration_photos')} />
    </div>
  );
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body: any = id ? { ...form.changes } : Object.fromEntries(Object.entries(form.values).filter(([, v]) => v !== ''));
    if (!id && withCard) body.card = { ...card.values, scan: scan?.token };
    const r = await form.submit(() => (id ? patch(`/vehicles/${id}`, body) : post('/vehicles', body)));
    if (r) { if (id) nav(`/admin/vehicles/${id}`); else setSaved(r.id); }
  };
  return (
    <form onSubmit={submit}>
      <PageHeader title={id ? t('vehicles.edit_title', { plate: loaded.plate }) : t('vehicles.add')} back={id ? `/admin/vehicles/${id}` : '/admin/vehicles'} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title={t('vehicles.details')}>
            <Grid cols={3}>
              <TextInput form={form} name="plate" label={t('vehicles.plate')} required maxLength={30} />
              <TextInput form={form} name="plate_en" label={t('vehicles.plate_en')} dir="ltr" maxLength={30} hint={t('vehicles.plate_en_hint')} />
              <TextInput form={form} name="vehicle_type" label={t('vehicles.type')} required list="vtypes" />
              <TextInput form={form} name="registration_type" label={t('vehicles.registration_type')} />
              <TextInput form={form} name="maker" label={t('vehicles.maker')} />
              <TextInput form={form} name="model" label={t('vehicles.model')} />
              <TextInput form={form} name="color" label={t('vehicles.color')} />
              <TextInput form={form} name="year" label={t('vehicles.year')} dir="ltr" />
              <TextInput form={form} name="chassis" label={t('vehicles.chassis')} dir="ltr" />
              <TextInput form={form} name="weight" label={t('vehicles.weight')} dir="ltr" />
              <TextInput form={form} name="capacity" label={t('vehicles.capacity')} dir="ltr" />
              <TextInput form={form} name="odometer" label={t('vehicles.odometer')} dir="ltr" />
              <SelectInput form={form} name="ownership" label={t('vehicles.ownership')} empty={false} options={['owned', 'rented'].map((v) => ({ value: v, label: t(`vehicle.own.${v}`) }))} />
              <SelectInput form={form} name="status" label={t('vehicles.status')} empty={false} options={Object.keys(VEHICLE_STATUS).map((v) => ({ value: v, label: t(`vehicle.status.${v}`) }))} />
            </Grid>
            <datalist id="vtypes">{VTYPES.map((v) => <option key={v} value={v}>{t(`vehicle.type.${v}`)}</option>)}</datalist>
          </Card>
          {!id && can('operation_cards.create') && (
            <Card title={t('vehicles.operation_card')}>
              <Checkbox checked={withCard} onChange={setWithCard} label={t('vehicles.also_create_card')} />
              {withCard && (
                <div className="mt-3 space-y-3">
                  {can('operation_cards.upload') && <ScanUpload value={scan} onChange={setScan} title={t('vehicles.attach_document')} />}
                  <Grid cols={3}>
                    <TextInput form={card} name="number" label={t('cards.number')} required dir="ltr" />
                    <SelectInput form={card} name="transport_license_id" label={t('cards.license')} required options={licenses.map((l: any) => ({ value: l.id, label: `${l.number} · ${city(l)}` }))} />
                    <TextInput form={card} name="expiry_date" label={t('cards.expiry_date')} type="date" required />
                    <TextInput form={card} name="issue_date" label={t('cards.issue_date')} type="date" />
                    <TextArea form={card} name="notes" label={t('common.notes')} className="sm:col-span-2" />
                  </Grid>
                </div>
              )}
            </Card>
          )}
        </div>
        <Card title={t('vehicles.card_and_registration')}>
          <div className="space-y-3">
            {!withCard && can('operation_cards.update') && <SelectInput form={form} name="current_card_id" label={t('vehicles.current_card')} options={cards.map((c: any) => ({ value: c.id, label: `${c.number} · ${c.expiry_date}` }))} />}
            {can('vehicle_registrations.update') && <SelectInput form={form} name="current_registration_id" label={t('vehicles.current_registration')} options={regs.map((g: any) => ({ value: g.id, label: `${g.serial} · ${g.plate}` }))} hint={t('vehicles.registration_moves')} />}
          </div>
        </Card>
      </div>
      <SaveBar form={form} editing={!!id} label={id ? t('common.save') : withCard ? t('vehicles.create_with_card') : t('vehicles.add')} onCancel={() => nav(-1)} />
    </form>
  );
}

export function VehicleView() {
  const { id } = useParams();
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const run = useAction();
  const { confirm } = useUi();
  const delWith = useDeleteWithBlockers();
  const [v, setV] = useState<any>(null);
  const load = useCallback(() => get(`/vehicles/${id}`).then(setV), [id]);
  useEffect(() => { load(); }, [load]);
  if (!v) return <Loading />;
  const toggle = async () => {
    const toMaint = v.status === 'active';
    if (!(await confirm({ title: toMaint ? t('vehicles.to_maintenance_q') : t('vehicles.to_service_q'), tone: 'warn' }))) return;
    if (await run(() => post(`/vehicles/${id}/${toMaint ? 'maintenance' : 'service'}`), t('common.saved'))) load();
  };
  return (
    <>
      <PageHeader title={v.plate} back="/admin/vehicles"
        subtitle={<span className="flex flex-wrap items-center gap-2"><span className="num">#{v.id}</span>{typeLabel(t, v.vehicle_type)} · {t(`vehicle.own.${v.ownership}`)}<VStatus s={v.status} /></span>}
        actions={<>
          {(v.status === 'active' ? can('vehicles.deactivate') : can('vehicles.activate')) && <Button variant="warn" icon={v.status === 'active' ? <Wrench className="size-4" /> : <Play className="size-4" />} onClick={toggle}>{v.status === 'active' ? t('vehicles.to_maintenance') : t('vehicles.to_service')}</Button>}
          {can('vehicles.update') && <Link to={`/admin/vehicles/${id}/edit`}><Button icon={<Pencil className="size-4" />}>{t('common.edit')}</Button></Link>}
        </>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label={t('vehicles.current_rider')} value={v.riders[0]?.full_name ?? t('vehicles.unassigned')} />
        <StatCard label={t('vehicles.card_expiry')} value={v.card?.expiry_date ?? '—'} tone={v.card ? (v.card.days_left < 0 ? 'red' : v.card.days_left <= 30 ? 'amber' : 'green') : 'none'} sub={v.card && t(v.card.days_left < 0 ? 'docs.expired_ago' : 'docs.days_left', { n: Math.abs(v.card.days_left) })} />
        <StatCard label={t('vehicles.odometer')} value={`${fmtNum(v.odometer)} km`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('vehicles.details')}><Details rows={[[t('vehicles.plate_en'), v.plate_en], [t('vehicles.registration_type'), v.registration_type], [t('vehicles.maker'), v.maker],
          [t('vehicles.model'), v.model], [t('vehicles.color'), v.color], [t('vehicles.year'), v.year], [t('vehicles.chassis'), v.chassis], [t('vehicles.weight'), v.weight], [t('vehicles.capacity'), v.capacity]]} /></Card>
        <Card title={t('vehicles.current_rider')}>
          {v.riders.length ? <ul className="space-y-2 text-sm">{v.riders.map((r: any) => <li key={r.id}><Link to={`/admin/riders/${r.id}`} className="font-medium text-brand hover:underline">{r.full_name}</Link> <span className="num text-zinc-500">#{r.id} · {r.phone ?? '—'} · {t('vehicles.since')} {r.start_date}</span></li>)}</ul>
            : <p className="text-sm text-zinc-500">{t('vehicles.unassigned')}</p>}
        </Card>
        <Card title={t('vehicles.card_in_force')} actions={v.card && <Link to={`/admin/operation-cards/${v.card.id}`}><Button size="sm">{t('vehicles.open_card')}</Button></Link>}>
          {v.card ? <Details rows={[[t('cards.number'), v.card.number], [t('cards.expiry_date'), v.card.expiry_date], [t('vehicles.vehicles_on_card'), v.card.vehicles]]} /> : <p className="text-sm text-zinc-500">{t('vehicles.no_card')}</p>}
        </Card>
        <Card title={t('vehicles.current_registration')} actions={v.registration ? <Link to={`/admin/vehicle-registrations/${v.registration.id}`}><Button size="sm">{t('vehicles.open_registration')}</Button></Link>
          : can('vehicle_registrations.create') && <Link to={`/admin/vehicle-registrations/new?vehicle=${v.id}`}><Button size="sm">{t('vehicles.record_registration')}</Button></Link>}>
          {v.registration ? <Details rows={[[t('regs.serial'), v.registration.serial], [t('regs.owner'), v.registration.owner], [t('regs.expiry_date'), v.registration.expiry_date ?? t('regs.no_date_yet'), true]]} /> : <p className="text-sm text-zinc-500">—</p>}
        </Card>
      </div>
      {v.card_vehicles.length > 0 && (
        <Card title={t('vehicles.card_vehicles')} className="mt-4" pad={false}>
          <table className="w-full text-sm"><thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-900"><tr><th className="px-3 py-2 text-start">{t('vehicles.plate')}</th><th className="px-3 py-2 text-start">{t('vehicles.make_model')}</th><th className="px-3 py-2 text-start">{t('vehicles.current_rider')}</th><th className="px-3 py-2 text-start">{t('regs.serial')}</th></tr></thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{v.card_vehicles.map((x: any) => <tr key={x.id} className={x.id === v.id ? 'bg-brand-soft' : ''}><td className="px-3 py-2"><Link to={`/admin/vehicles/${x.id}`} className="hover:text-brand">{x.plate}</Link></td><td className="px-3 py-2">{[x.maker, x.model].filter(Boolean).join(' ')}</td><td className="px-3 py-2">{x.riders ?? '—'}</td><td className="px-3 py-2 num">{x.registration ?? '—'}</td></tr>)}</tbody></table>
        </Card>
      )}
      <div className="mt-4"><Attachments entityType="vehicle" entityId={v.id} title={t('vehicles.registration_photos')} /></div>
      {can('vehicles.delete') && (
        <Card title={t('vehicles.delete')} className="mt-4">
          <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={async () => {
            if (!(await confirm({ title: t('vehicles.delete_q', { n: 1 }), body: t('common.cannot_undo') }))) return;
            if (await delWith(() => del(`/vehicles/${id}`))) nav('/admin/vehicles');
          }}>{t('vehicles.delete')}</Button>
        </Card>
      )}
    </>
  );
}

export function VehiclesImport() {
  const { t } = useI18n();
  return <><PageHeader title={t('vehicles.import_title')} back="/admin/vehicles" /><ImportWizard base="/vehicles/import" back="/admin/vehicles" modeLabels={{ question: t('vehicles.on_duplicate_plate'), skip: t('import.skip'), replace: t('import.replace') }} /></>;
}
