import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Eye, FileUp, Pencil, Plus, RotateCw, Trash2, X } from 'lucide-react';
import { del, download, get, patch, post } from '../../api';
import { useAuth } from '../../auth';
import { fmtNum, useI18n } from '../../i18n';
import { Alert, Badge, Button, Card, Details, Field, IconButton, Loading, PageHeader, StatCard, StatGrid, toneIf, useAction, useUi, type Tone } from '../../ui/kit';
import { Combo, ComboInput, Grid, RiderInput, SaveBar, SelectInput, TextArea, TextInput, useForm, type ComboOption } from '../../ui/forms';
import { DataTable, FilterBar, FilterNumber, FilterSelect, useList, type Column } from '../../ui/table';
import { Attachments, ScanUpload, type Scan } from '../../ui/files';
import { ImportWizard } from '../../ui/importer';
import { ExpiryDate, ExportButton, invalidateOptions, Remaining, useCityName, useOptions } from '../../ui/common';

const CARD_STATUS: Record<string, Tone> = { valid: 'green', expired: 'red', suspended: 'amber', cancelled: 'grey' };
const plates = (s: string | null) => (s ? s.split('\n').map((x) => { const [id, plate, maker, model, year] = x.split('\t'); return { id, plate, maker, model, year }; }) : []);
export function useVehicleOptions(): ComboOption[] {
  const { t } = useI18n();
  const vs = useOptions<any>('/vehicles/options');
  return useMemo(() => vs.map((v: any) => ({ value: v.id, label: v.plate, sub: [v.maker, v.model].filter(Boolean).join(' '), search: v.plate_en ?? '', note: v.holder_name ? t('riders.with_holder', { name: v.holder_name }) : undefined })), [vs, t]);
}

// ======================================================================== operation cards
export function CardsList() {
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const run = useAction();
  const { confirm, toast } = useUi();
  const list = useList('/operation-cards');
  const vehicles = useVehicleOptions();
  const s = list.stats ?? {};
  const removeMany = async () => {
    const ids = [...list.selected];
    if (!(await confirm({ title: t('cards.delete_q', { n: ids.length }) }))) return;
    const r = await run(() => post('/operation-cards/bulk-delete', { ids }));
    if (r) { toast(t('cards.deleted_n', { n: r.deleted }), r.failed.length ? 'amber' : 'green'); list.setSelected(new Set()); list.reload(); }
  };
  const columns: Column<any>[] = [
    { key: 'number', header: t('cards.number'), sort: 'number', render: (r) => <div><div className="font-medium num">{r.number}</div><div className="text-xs text-zinc-500 num">{r.license_number}</div>{!r.has_scan && <Badge tone="amber">{t('cards.no_scan')}</Badge>}</div> },
    { key: 'vehicle', header: t('cards.vehicle'), render: (r) => { const vs = plates(r.vehicles); return <div>{vs.map((v) => <div key={v.id}><Link to={`/admin/vehicles/${v.id}`} className="hover:text-brand">{v.plate}</Link> <span className="text-xs text-zinc-500">{[v.maker, v.model, v.year].filter(Boolean).join(' ')}</span></div>)}</div>; } },
    { key: 'dates', header: t('cards.issue_expiry'), sort: 'expiry', render: (r) => <div className="num text-xs">{r.issue_date ?? '—'} → {r.expiry_date}{r.renew_date && <div className="text-zinc-500">{t('cards.renew_date')}: {r.renew_date}</div>}</div> },
    { key: 'remaining', header: t('docs.remaining'), sort: 'remaining', render: (r) => <Remaining days={r.days_left} /> },
    { key: 'status', header: t('cards.status'), sort: 'status', render: (r) => (
      <div><Badge tone={r.status === 'valid' && r.days_left < 0 ? 'red' : CARD_STATUS[r.status]}>{t(`card.status.${r.status}`)}</Badge>
        {r.status === 'valid' && r.days_left < 0 && <div className="text-xs text-red-600">{t('cards.marked_valid_date_gone')}</div>}</div>
    ) },
    { key: 'actions', header: t('common.actions'), render: (r) => <div className="flex"><IconButton title={t('common.view')} onClick={() => nav(`/admin/operation-cards/${r.id}`)}><Eye /></IconButton>
      {can('operation_cards.update') && <IconButton title={t('common.edit')} onClick={() => nav(`/admin/operation-cards/${r.id}/edit`)}><Pencil /></IconButton>}</div> },
  ];
  return (
    <>
      <PageHeader title={t('cards.title')} actions={<>
        {can('operation_cards.export') && <ExportButton path="/operation-cards/export" query={list.query} />}
        {can('operation_cards.create') && <Button size="sm" onClick={() => run(() => download('/operation-cards/import/template'))}>{t('import.download_template')}</Button>}
        {can('operation_cards.create') && <Link to="/admin/operation-cards/import"><Button size="sm" icon={<FileUp className="size-3.5" />}>{t('import.import_file')}</Button></Link>}
        {can('operation_cards.create') && <Link to="/admin/operation-cards/new"><Button variant="primary" icon={<Plus className="size-4" />}>{t('cards.new')}</Button></Link>}
      </>} />
      <StatGrid>
        <StatCard label={t('common.total')} value={fmtNum(s.total)} sub={t('cards.n_vehicles', { n: fmtNum(s.vehicles) })} />
        <StatCard label={t('docs.state.expired')} value={fmtNum(s.expired)} tone={toneIf(s.expired, 'red')} sub={t('cards.by_date')} />
        <StatCard label={t('docs.state.near')} value={fmtNum(s.near)} tone={toneIf(s.near, 'amber')} />
        <StatCard label={t('card.status.valid')} value={fmtNum(s.valid)} tone="green" sub={t('cards.by_status')} />
        <StatCard label={t('cards.without_scan')} value={fmtNum(s.no_scan)} tone={toneIf(s.no_scan, 'amber')} />
      </StatGrid>
      <FilterBar list={list} placeholder={t('cards.search_hint')}>
        <FilterSelect list={list} name="expiry_state" label={t('cards.expiry_state')} options={['expired', 'near', 'valid'].map((v) => ({ value: v, label: t(`docs.state.${v}`) }))} />
        <FilterSelect list={list} name="status" label={t('cards.status')} options={Object.keys(CARD_STATUS).map((v) => ({ value: v, label: t(`card.status.${v}`) }))} />
        <FilterSelect list={list} name="scan" label={t('cards.scan')} options={[{ value: 'no', label: t('cards.no_scan') }, { value: 'yes', label: t('cards.has_scan') }]} />
        <FilterSelect list={list} name="vehicle" label={t('cards.vehicle')} options={vehicles.map((v) => ({ value: v.value, label: v.label }))} />
        <FilterNumber list={list} name="window" label={t('cards.window')} />
      </FilterBar>
      <DataTable list={list} columns={columns} onRowClick={(r) => nav(`/admin/operation-cards/${r.id}`)} selectable={can('operation_cards.delete')}
        bulk={<Button size="sm" variant="danger" onClick={removeMany}>{t('common.delete_selected')}</Button>} />
    </>
  );
}

const C_EMPTY = { vehicle_id: '', number: '', transport_license_id: '', issue_date: '', expiry_date: '', renew_date: '', status: 'valid', notes: '' };
export function CardForm() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const city = useCityName();
  const form = useForm<Record<string, any>>({ ...C_EMPTY, vehicle_id: params.get('vehicle') ?? '' });
  const [more, setMore] = useState<(string | number)[]>([]);
  const [baseMore, setBaseMore] = useState<string>('');
  const [scan, setScan] = useState<Scan | null>(null);
  const [newVehicle, setNewVehicle] = useState<null | { plate: string; vehicle_type: string; maker: string; model: string }>(null);
  const [newLicense, setNewLicense] = useState<null | { number: string; city_id: string; expiry_date: string }>(null);
  const [loaded, setLoaded] = useState<any>(id ? null : {});
  const vehicles = useVehicleOptions();
  const regs = useOptions<any>(can('vehicle_registrations.view') ? '/vehicle-registrations/options' : null);
  const licenses = useOptions<any>('/transport-licenses/options');
  const cities = useOptions<any>(newLicense ? '/lookups/cities' : null);
  useEffect(() => {
    if (!id) return;
    get(`/operation-cards/${id}`).then((c) => {
      setLoaded(c);
      const vs = c.vehicles.map((v: any) => v.id);
      form.reset({ ...Object.fromEntries(Object.keys(C_EMPTY).map((k) => [k, c[k] ?? ''])), vehicle_id: vs[0] ?? '' });
      setMore(vs.slice(1)); setBaseMore(vs.slice(1).join(','));
    });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!loaded) return <Loading />;
  const moreChanged = more.join(',') !== baseMore;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await form.submit(() => {
      if (id) {
        const { vehicle_id, ...ch } = form.changes;
        const body: any = { ...ch, scan: scan?.token };
        if (vehicle_id !== undefined || moreChanged) body.vehicle_ids = [form.values.vehicle_id, ...more].filter(Boolean);
        return patch(`/operation-cards/${id}`, body);
      }
      return post('/operation-cards', { ...form.values, more_vehicles: more, scan: scan?.token, new_vehicle: newVehicle ?? undefined, new_license: newLicense ?? undefined, vehicle_id: newVehicle ? undefined : form.values.vehicle_id });
    });
    if (r) { invalidateOptions('/vehicles'); nav(`/admin/operation-cards/${id ?? r.id}`); }
  };
  return (
    <form onSubmit={submit}>
      <PageHeader title={id ? t('cards.edit') : t('cards.new')} back={id ? `/admin/operation-cards/${id}` : '/admin/operation-cards'} />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          {can('operation_cards.upload') && <Card title={t('cards.scan_panel')}><ScanUpload value={scan} onChange={setScan} /></Card>}
          <Card title={t('cards.vehicle')}>
            {newVehicle ? (
              <div className="space-y-3">
                <Grid>
                  {(['plate', 'vehicle_type', 'maker', 'model'] as const).map((k) => (
                    <Field key={k} label={t(`vehicles.${k === 'vehicle_type' ? 'type' : k}`)} required={k === 'plate'}><input className="input" value={newVehicle[k]} onChange={(e) => setNewVehicle({ ...newVehicle, [k]: e.target.value })} /></Field>
                  ))}
                </Grid>
                <Button type="button" size="sm" onClick={() => setNewVehicle(null)}>{t('cards.pick_from_register')}</Button>
              </div>
            ) : (
              <div className="space-y-3">
                <ComboInput form={form} name="vehicle_id" label={t('cards.choose_vehicle')} required options={vehicles} />
                {!id && <Field label={t('cards.registration_card')} hint={t('cards.registration_hint')}>
                  <select className="input" value="" onChange={(e) => { const g = regs.find((x: any) => String(x.id) === e.target.value); if (g) form.set('vehicle_id', g.vehicle_id); }}>
                    <option value="">{t('common.choose')}</option>{regs.map((g: any) => <option key={g.id} value={g.id}>{g.serial} · {g.plate}</option>)}
                  </select>
                </Field>}
                {!id && can('vehicles.create') && <Button type="button" size="sm" onClick={() => setNewVehicle({ plate: '', vehicle_type: 'car', maker: '', model: '' })}>{t('cards.vehicle_not_on_file')}</Button>}
              </div>
            )}
            <div className="mt-4">
              <span className="mb-1 block text-xs font-medium">{t('cards.more_vehicles')}</span>
              <div className="mb-2 flex flex-wrap gap-1">{more.map((m) => <Badge key={m}>{vehicles.find((v) => String(v.value) === String(m))?.label ?? m}<button type="button" onClick={() => setMore(more.filter((x) => x !== m))}><X className="size-3" /></button></Badge>)}</div>
              <Combo value={null} onChange={(v) => v && !more.includes(v) && String(v) !== String(form.values.vehicle_id) && setMore([...more, v])} options={vehicles} placeholder={t('cards.add_vehicle')} />
            </div>
          </Card>
        </div>
        <Card title={t('cards.card')}>
          <Grid>
            <TextInput form={form} name="number" label={t('cards.number')} required dir="ltr" maxLength={50} />
            {newLicense ? (
              <div className="space-y-2 sm:col-span-2 rounded-lg border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
                <p className="text-xs font-medium">{t('cards.licence_not_on_file')}</p>
                <Grid cols={3}>
                  <Field label={t('tl.number')} required><input className="input" dir="ltr" value={newLicense.number} onChange={(e) => setNewLicense({ ...newLicense, number: e.target.value })} /></Field>
                  <Field label={t('tl.city')} required><select className="input" value={newLicense.city_id} onChange={(e) => setNewLicense({ ...newLicense, city_id: e.target.value })}><option value="">—</option>{cities.map((c: any) => <option key={c.id} value={c.id}>{city(c)}</option>)}</select></Field>
                  <Field label={t('tl.expires')} required><input type="date" className="input" value={newLicense.expiry_date} onChange={(e) => setNewLicense({ ...newLicense, expiry_date: e.target.value })} /></Field>
                </Grid>
                <Button type="button" size="sm" onClick={() => setNewLicense(null)}>{t('cards.pick_from_register')}</Button>
              </div>
            ) : (
              <div>
                <SelectInput form={form} name="transport_license_id" label={t('cards.license')} required options={licenses.map((l: any) => ({ value: l.id, label: `${l.number} · ${city(l)}` }))} />
                {!id && can('transport_licenses.create') && <button type="button" className="mt-1 text-xs text-brand hover:underline" onClick={() => setNewLicense({ number: '', city_id: '', expiry_date: '' })}>{t('cards.create_new_licence')}</button>}
              </div>
            )}
            <TextInput form={form} name="issue_date" label={t('cards.issue_date')} type="date" />
            <TextInput form={form} name="expiry_date" label={t('cards.expiry_date')} type="date" required />
            <TextInput form={form} name="renew_date" label={t('cards.renew_date')} type="date" />
            <SelectInput form={form} name="status" label={t('cards.status')} empty={false} options={Object.keys(CARD_STATUS).map((v) => ({ value: v, label: t(`card.status.${v}`) }))} />
            <TextArea form={form} name="notes" label={t('common.notes')} maxLength={500} className="sm:col-span-2" />
          </Grid>
        </Card>
      </div>
      <SaveBar form={form} editing={!!id} extra={(moreChanged ? 1 : 0) + (scan ? 1 : 0)} label={id ? t('common.save_changes') : t('cards.create')} onCancel={() => nav(-1)} />
    </form>
  );
}

export function CardView() {
  const { id } = useParams();
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const run = useAction();
  const { confirm } = useUi();
  const [c, setC] = useState<any>(null);
  useEffect(() => { get(`/operation-cards/${id}`).then(setC); }, [id]);
  if (!c) return <Loading />;
  const first = c.vehicles[0];
  return (
    <>
      <PageHeader title={first?.plate ?? c.number} back="/admin/operation-cards"
        subtitle={<span className="flex flex-wrap items-center gap-2"><span className="num">{c.number}</span><Badge tone={CARD_STATUS[c.status]}>{t(`card.status.${c.status}`)}</Badge><Remaining days={c.days_left} /></span>}
        actions={can('operation_cards.update') && <Link to={`/admin/operation-cards/${id}/edit`}><Button icon={<Pencil className="size-4" />}>{t('common.edit')}</Button></Link>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('cards.vehicle')} actions={first && <Link to={`/admin/vehicles/${first.id}`}><Button size="sm">{t('vehicles.open')}</Button></Link>}>
          {first ? <Details rows={[[t('vehicles.plate'), first.plate], [t('vehicles.make_model'), [first.maker, first.model, first.year].filter(Boolean).join(' ')]]} /> : '—'}
        </Card>
        <Card title={t('cards.card')}>
          <Details rows={[[t('cards.number'), c.number], [t('cards.issue_date'), c.issue_date], [t('cards.expiry_date'), <ExpiryDate date={c.expiry_date} days={c.days_left} />], [t('cards.renew_date'), c.renew_date], [t('common.notes'), c.notes]]} />
        </Card>
      </div>
      <Card title={t('cards.vehicles_on_card')} className="mt-4" pad={false}>
        <table className="w-full text-sm"><thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-900"><tr><th className="px-3 py-2 text-start">{t('vehicles.plate')}</th><th className="px-3 py-2 text-start">{t('cards.for_vehicle')}</th><th className="px-3 py-2 text-start">{t('vehicles.current_rider')}</th><th className="px-3 py-2 text-start">{t('regs.serial')}</th></tr></thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{c.vehicles.map((v: any) => <tr key={v.id}><td className="px-3 py-2"><Link className="hover:text-brand" to={`/admin/vehicles/${v.id}`}>{v.plate}</Link></td>
            <td className="px-3 py-2"><Badge tone={v.is_current ? 'green' : 'grey'}>{v.is_current ? t('cards.current_for_vehicle') : t('cards.previous')}</Badge></td><td className="px-3 py-2">{v.riders ?? '—'}</td><td className="px-3 py-2 num">{v.registration ?? '—'}</td></tr>)}</tbody></table>
      </Card>
      <Card title={t('cards.transport_licence')} className="mt-4" actions={can('transport_licenses.view') && <Link to={`/admin/transport-licenses/${c.transport_license_id}`}><Button size="sm">{t('cards.open_licence')}</Button></Link>}>
        <Details rows={[[t('tl.number'), c.license_number], [t('tl.expires'), c.license_expiry]]} />
      </Card>
      <div className="mt-4"><Attachments entityType="operation_card" entityId={c.id} title={t('cards.scan_attachments')} /></div>
      {can('operation_cards.delete') && <Card title={t('cards.delete')} className="mt-4"><Button variant="danger" icon={<Trash2 className="size-4" />} onClick={async () => {
        if (!(await confirm({ title: t('cards.delete_q', { n: 1 }) }))) return;
        if (await run(() => del(`/operation-cards/${id}`))) nav('/admin/operation-cards');
      }}>{t('cards.delete')}</Button></Card>}
    </>
  );
}

export function CardsImport() {
  const { t } = useI18n();
  return <><PageHeader title={t('cards.import_title')} back="/admin/operation-cards" /><ImportWizard base="/operation-cards/import" back="/admin/operation-cards" extraLabels={{ becomes_current: t('cards.becomes_current'), became_current: t('cards.became_current') }} /></>;
}

// ======================================================================== vehicle registrations
const REG_STATUS: Record<string, Tone> = { valid: 'green', expired: 'red', cancelled: 'grey' };
export function RegistrationsList() {
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const list = useList('/vehicle-registrations');
  const vehicles = useVehicleOptions();
  const s = list.stats ?? {};
  const within = Number(list.query.within) || 30;
  const columns: Column<any>[] = [
    { key: 'plate', header: t('regs.plate'), sort: 'plate', render: (r) => <div><div className="font-medium">{r.plate}</div><div className="text-xs text-zinc-500">{[r.maker, r.model].filter(Boolean).join(' ')}</div></div> },
    { key: 'serial', header: t('regs.serial'), sort: 'serial', render: (r) => <span className="num">{r.serial}</span> },
    { key: 'owner', header: t('regs.owner'), render: (r) => <div>{r.owner}<div className="text-xs text-zinc-500 num">{r.owner_id_no}</div></div> },
    { key: 'expires', header: t('regs.expires'), sort: 'remaining', render: (r) => <ExpiryDate date={r.expiry_date} days={r.days_left} window={within} /> },
    { key: 'status', header: t('regs.status'), sort: 'status', render: (r) => <Badge tone={REG_STATUS[r.status]}>{t(`reg.status.${r.status}`)}</Badge> },
    { key: 'current', header: t('regs.current'), render: (r) => (r.is_current ? <Badge tone="green">{t('regs.current')}</Badge> : '—') },
  ];
  return (
    <>
      <PageHeader title={t('regs.title')} actions={<>
        {can('vehicle_registrations.export') && <ExportButton path="/vehicle-registrations/export" query={list.query} />}
        {can('vehicle_registrations.create') && <Link to="/admin/vehicle-registrations/new"><Button variant="primary" icon={<Plus className="size-4" />}>{t('regs.add')}</Button></Link>}
      </>} />
      <StatGrid>
        <StatCard label={t('common.total')} value={fmtNum(s.total)} />
        <StatCard label={t('reg.status.valid')} value={fmtNum(s.valid)} tone="green" />
        <StatCard label={t('regs.expiring_soon')} value={fmtNum(s.soon)} tone={toneIf(s.soon, 'amber')} />
        <StatCard label={t('reg.status.expired')} value={fmtNum(s.expired)} tone={toneIf(s.expired, 'red')} />
        <StatCard label={t('regs.current')} value={fmtNum(s.current)} />
      </StatGrid>
      <FilterBar list={list} placeholder={t('regs.search_hint')}>
        <FilterSelect list={list} name="vehicle" label={t('regs.vehicle')} options={vehicles.map((v) => ({ value: v.value, label: v.label }))} />
        <FilterSelect list={list} name="status" label={t('regs.status')} options={Object.keys(REG_STATUS).map((v) => ({ value: v, label: t(`reg.status.${v}`) }))} />
        <FilterSelect list={list} name="validity" label={t('regs.validity')} options={[['expired', 'docs.state.expired'], ['soon', 'regs.expiring_soon'], ['valid', 'docs.state.valid']].map(([v, k]) => ({ value: v, label: t(k) }))} />
        <FilterSelect list={list} name="current" label={t('regs.current')} options={[{ value: 'current', label: t('regs.current') }, { value: 'past', label: t('regs.past_issue') }]} />
        <FilterNumber list={list} name="within" label={t('regs.within')} />
      </FilterBar>
      <DataTable list={list} columns={columns} onRowClick={(r) => nav(`/admin/vehicle-registrations/${r.id}`)} />
    </>
  );
}

const R_EMPTY = { vehicle_id: '', serial: '', owner: '', owner_id_no: '', user_rider_id: '', user_name: '', user_id_no: '', issue_date: '', expiry_date: '', status: 'valid', is_current: true, notes: '' };
export function RegistrationForm() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { t } = useI18n();
  const nav = useNavigate();
  const locked = params.get('vehicle');
  const form = useForm<Record<string, any>>({ ...R_EMPTY, vehicle_id: locked ?? '' });
  const [scan, setScan] = useState<Scan | null>(null);
  const [loaded, setLoaded] = useState<any>(id ? null : {});
  const vehicles = useVehicleOptions();
  useEffect(() => { if (id) get(`/vehicle-registrations/${id}`).then((g) => { setLoaded(g); form.reset(Object.fromEntries(Object.keys(R_EMPTY).map((k) => [k, g[k] ?? '']))); }); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!loaded) return <Loading />;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await form.submit(() => (id ? patch(`/vehicle-registrations/${id}`, form.changes) : post('/vehicle-registrations', { ...form.values, scan: scan?.token })));
    if (r) nav(`/admin/vehicle-registrations/${id ?? r.id}`);
  };
  return (
    <form onSubmit={submit}>
      <PageHeader title={id ? t('regs.edit') : t('regs.add')} back={id ? `/admin/vehicle-registrations/${id}` : '/admin/vehicle-registrations'} />
      <div className="grid gap-4 lg:grid-cols-3">
        {!id && <Card title={t('regs.card_scan')}><ScanUpload value={scan} onChange={setScan} autoRead={false} /><p className="mt-2 text-xs text-zinc-500">{t('regs.scan_hint')}</p></Card>}
        <Card title={t('regs.details')} className={id ? 'lg:col-span-3' : 'lg:col-span-2'}>
          <Grid>
            <ComboInput form={form} name="vehicle_id" label={t('regs.vehicle')} required options={vehicles} disabled={!!locked} />
            <TextInput form={form} name="serial" label={t('regs.serial')} required dir="ltr" maxLength={30} />
            <TextInput form={form} name="owner" label={t('regs.owner')} required maxLength={150} />
            <TextInput form={form} name="owner_id_no" label={t('regs.owner_id')} dir="ltr" />
            <RiderInput form={form} name="user_rider_id" label={t('regs.user_is_rider')} />
            <TextInput form={form} name="user_name" label={t('regs.user')} hint={t('regs.user_hint')} />
            <TextInput form={form} name="user_id_no" label={t('regs.user_id')} dir="ltr" />
            <TextInput form={form} name="issue_date" label={t('regs.issue_date')} type="date" />
            <TextInput form={form} name="expiry_date" label={t('regs.expiry_date')} type="date" hint={t('regs.expiry_hint')} />
            <SelectInput form={form} name="status" label={t('regs.status')} empty={false} options={Object.keys(REG_STATUS).map((v) => ({ value: v, label: t(`reg.status.${v}`) }))} />
            <TextArea form={form} name="notes" label={t('common.notes')} className="sm:col-span-2" />
          </Grid>
        </Card>
      </div>
      <SaveBar form={form} editing={!!id} label={id ? t('common.save') : t('regs.add')} onCancel={() => nav(-1)} />
    </form>
  );
}

export function RegistrationView() {
  const { id } = useParams();
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const run = useAction();
  const { confirm } = useUi();
  const [g, setG] = useState<any>(null);
  const renew = useForm<Record<string, any>>({ new_expiry: '', new_issue: '', new_number: '', operation: 'renewal', cost: '', reference: '' });
  const load = useCallback(() => get(`/vehicle-registrations/${id}`).then(setG), [id]);
  useEffect(() => { load(); }, [load]);
  if (!g) return <Loading />;
  return (
    <>
      <PageHeader title={g.plate} back="/admin/vehicle-registrations" subtitle={<span className="flex items-center gap-2"><span className="num">{g.serial}</span>{[g.maker, g.model].filter(Boolean).join(' ')}<Badge tone={REG_STATUS[g.status]}>{t(`reg.status.${g.status}`)}</Badge></span>}
        actions={<><Link to={`/admin/vehicles/${g.vehicle_id}`}><Button>{t('vehicles.open')}</Button></Link>{can('vehicle_registrations.update') && <Link to={`/admin/vehicle-registrations/${id}/edit`}><Button icon={<Pencil className="size-4" />}>{t('common.edit')}</Button></Link>}</>} />
      {!g.expiry_date && <div className="mb-4"><Alert tone="amber">{t('regs.no_date_alert')}</Alert></div>}
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label={t('regs.expiry_date')} value={g.expiry_date ?? '—'} sub={<Remaining days={g.days_left} notRecorded={t('regs.no_date_yet')} />} />
        <StatCard label={t('regs.current')} value={g.is_current ? t('regs.current') : t('regs.past_issue')} />
        <StatCard label={t('regs.owner')} value={g.owner} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('regs.details')}><Details rows={[[t('vehicles.chassis'), g.chassis], [t('regs.owner_id'), g.owner_id_no], [t('regs.user'), g.user_name], [t('regs.user_id'), g.user_id_no],
          [t('regs.user_is_rider'), g.user_rider_id && <Link className="text-brand" to={`/admin/riders/${g.user_rider_id}`}>{g.user_rider_name}</Link>], [t('regs.issue_date'), g.issue_date], [t('common.notes'), g.notes]]} /></Card>
        <Card title={t('vehicles.operation_card')} actions={g.card ? <Link to={`/admin/operation-cards/${g.card.id}`}><Button size="sm">{t('vehicles.open_card')}</Button></Link>
          : can('operation_cards.create') && <Link to={`/admin/operation-cards/new?vehicle=${g.vehicle_id}`}><Button size="sm">{t('regs.add_card')}</Button></Link>}>
          {g.card ? <Details rows={[[t('cards.number'), g.card.number], [t('cards.expiry_date'), g.card.expiry_date]]} /> : <p className="text-sm text-zinc-500">{t('vehicles.no_card')}</p>}
        </Card>
      </div>
      {can('vehicle_registrations.renew') && g.is_current ? (
        <Card title={t('regs.renew_card')} className="mt-4">
          <form onSubmit={async (e) => {
            e.preventDefault();
            if (!(await confirm({ title: t('regs.renew_q'), tone: 'primary' }))) return;
            const r = await renew.submit(() => post(`/vehicle-registrations/${id}/renew`, renew.values));
            if (r) nav(`/admin/vehicle-registrations/${r.id}`);
          }}>
            <Grid cols={3}>
              <TextInput form={renew} name="new_expiry" label={t('renew.new_expiry')} type="date" required />
              <TextInput form={renew} name="new_issue" label={t('renew.new_issue')} type="date" />
              <TextInput form={renew} name="new_number" label={t('regs.new_serial')} dir="ltr" />
              <SelectInput form={renew} name="operation" label={t('renew.type')} empty={false} options={['renewal', 'replacement', 'reissue', 'correction'].map((v) => ({ value: v, label: t(`renew.op.${v}`) }))} />
              <TextInput form={renew} name="cost" label={t('renew.cost')} dir="ltr" />
              <TextInput form={renew} name="reference" label={t('renew.reference')} dir="ltr" />
            </Grid>
            <Button type="submit" variant="primary" className="mt-3" icon={<RotateCw className="size-4" />} loading={renew.busy}>{t('renew.renew')}</Button>
          </form>
        </Card>
      ) : null}
      <div className="mt-4"><Attachments entityType="vehicle_registration" entityId={g.id} title={t('regs.card_scan')} /></div>
      {can('vehicle_registrations.delete') && <Card title={t('regs.delete')} className="mt-4"><Button variant="danger" icon={<Trash2 className="size-4" />} onClick={async () => {
        if (!(await confirm({ title: t('regs.delete_q') }))) return;
        if (await run(() => del(`/vehicle-registrations/${id}`))) nav('/admin/vehicle-registrations');
      }}>{t('regs.delete')}</Button></Card>}
    </>
  );
}

// ======================================================================== transport licences
const TL_STATUS: Record<string, Tone> = { valid: 'green', expired: 'red', suspended: 'amber' };
export function LicensesList() {
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const run = useAction();
  const { confirm } = useUi();
  const city = useCityName();
  const list = useList('/transport-licenses');
  const cities = useOptions<any>('/lookups/cities');
  const s = list.stats ?? {};
  const columns: Column<any>[] = [
    { key: 'number', header: t('tl.number'), sort: 'number', render: (r) => <div><div className="font-medium num">{r.number}</div><div className="text-xs text-zinc-500">{r.activity_ar}</div></div> },
    { key: 'city', header: t('tl.city'), sort: 'city', render: (r) => city(r) },
    { key: 'issued', header: t('tl.issued'), render: (r) => <span className="num">{r.issue_date ?? '—'}</span> },
    { key: 'expires', header: t('tl.expires'), sort: 'expiry', render: (r) => <ExpiryDate date={r.expiry_date} days={r.days_left} /> },
    { key: 'status', header: t('tl.status'), sort: 'status', render: (r) => <div><Badge tone={TL_STATUS[r.status]}>{t(`tl.status.${r.status}`)}</Badge>{r.status === 'valid' && r.days_left < 0 && <div className="text-xs text-red-600">{t('tl.status.expired')}</div>}</div> },
    { key: 'cards', header: t('tl.cards_issued'), render: (r) => <span className="num">{fmtNum(r.driver_cards + r.operation_cards)}</span> },
    { key: 'actions', header: t('common.actions'), render: (r) => <div className="flex">
      <IconButton title={t('common.view')} onClick={() => nav(`/admin/transport-licenses/${r.id}`)}><Eye /></IconButton>
      {can('transport_licenses.update') && <IconButton title={t('common.edit')} onClick={() => nav(`/admin/transport-licenses/${r.id}/edit`)}><Pencil /></IconButton>}
      {can('transport_licenses.delete') && !(r.driver_cards + r.operation_cards) && <IconButton title={t('common.delete')} tone="red" onClick={async () => {
        if (!(await confirm({ title: t('tl.delete_q') }))) return;
        if (await run(() => del(`/transport-licenses/${r.id}`), t('tl.deleted'))) list.reload();
      }}><Trash2 /></IconButton>}
    </div> },
  ];
  return (
    <>
      <PageHeader title={t('tl.title')} actions={<>
        <ExportButton path="/transport-licenses/export" query={list.query} label={t('common.export_csv')} />
        {can('transport_licenses.create') && <Link to="/admin/transport-licenses/new"><Button variant="primary" icon={<Plus className="size-4" />}>{t('tl.new')}</Button></Link>}
      </>} />
      <StatGrid>
        <StatCard label={t('tl.s.total')} value={fmtNum(s.total)} />
        <StatCard label={t('tl.status.valid')} value={fmtNum(s.valid)} tone="green" />
        <StatCard label={t('tl.s.within30')} value={fmtNum(s.within30)} tone={toneIf(s.within30, 'amber')} />
        <StatCard label={t('tl.s.past')} value={fmtNum(s.past)} tone={toneIf(s.past, 'red')} />
        <StatCard label={t('tl.status.suspended')} value={fmtNum(s.suspended)} tone={toneIf(s.suspended, 'amber')} />
        <StatCard label={t('tl.s.cities')} value={fmtNum(s.cities)} />
      </StatGrid>
      <FilterBar list={list} placeholder={t('tl.search_hint')}>
        <FilterSelect list={list} name="city" label={t('tl.city')} options={cities.map((c: any) => ({ value: c.id, label: city(c) }))} />
        <FilterSelect list={list} name="status" label={t('tl.status')} options={Object.keys(TL_STATUS).map((v) => ({ value: v, label: t(`tl.status.${v}`) }))} />
        <FilterSelect list={list} name="expiry" label={t('tl.expiry')} options={[['expired', 'docs.state.expired'], ['within30', 'tl.within30'], ['beyond30', 'tl.beyond30']].map(([v, k]) => ({ value: v, label: t(k) }))} />
      </FilterBar>
      <DataTable list={list} columns={columns} onRowClick={(r) => nav(`/admin/transport-licenses/${r.id}`)} />
    </>
  );
}

const TL_EMPTY = { number: '', city_id: '', issue_date: '', expiry_date: '', activity_ar: '', activity_en: '', status: 'valid', notes: '' };
export function LicenseForm() {
  const { id } = useParams();
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const city = useCityName();
  const form = useForm<Record<string, any>>(TL_EMPTY);
  const [scan, setScan] = useState<Scan | null>(null);
  const [loaded, setLoaded] = useState<any>(id ? null : {});
  const cities = useOptions<any>('/lookups/cities');
  useEffect(() => { if (id) get(`/transport-licenses/${id}`).then((l) => { setLoaded(l); form.reset(Object.fromEntries(Object.keys(TL_EMPTY).map((k) => [k, l[k] ?? '']))); }); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!loaded) return <Loading />;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await form.submit(() => (id ? patch(`/transport-licenses/${id}`, form.changes) : post('/transport-licenses', { ...form.values, scan: scan?.token })));
    if (r) { invalidateOptions('/transport-licenses'); nav(`/admin/transport-licenses/${id ?? r.id}`); }
  };
  const panel = can('transport_licenses.upload') && (id
    ? <Attachments entityType="transport_license" entityId={id} title={t('tl.licence_scan')} />
    : <Card title={t('tl.licence_scan')} actions={<Badge tone="blue">{t('tl.attached_on_save')}</Badge>}><ScanUpload value={scan} onChange={setScan} title={t('tl.choose_scan')} /></Card>);
  return (
    <form onSubmit={submit} className="space-y-4">
      <PageHeader title={id ? t('tl.edit') : t('tl.new')} back={id ? `/admin/transport-licenses/${id}` : '/admin/transport-licenses'} />
      {id && <Alert tone="amber">{t('tl.edit_notice')}</Alert>}
      {!id && panel}
      <Card title={t('tl.details')}>
        <Grid>
          <TextInput form={form} name="number" label={t('tl.number')} required dir="ltr" maxLength={50} />
          <SelectInput form={form} name="city_id" label={t('tl.city')} required options={cities.map((c: any) => ({ value: c.id, label: city(c) }))} />
          <TextInput form={form} name="issue_date" label={t('tl.issued')} type="date" />
          <TextInput form={form} name="expiry_date" label={t('tl.expires')} type="date" required />
          <TextInput form={form} name="activity_ar" label={t('tl.activity_ar')} maxLength={255} />
          <TextInput form={form} name="activity_en" label={t('tl.activity_en')} maxLength={255} />
          <SelectInput form={form} name="status" label={t('tl.status')} empty={false} options={Object.keys(TL_STATUS).map((v) => ({ value: v, label: t(`tl.status.${v}`) }))} />
          <TextArea form={form} name="notes" label={t('common.notes')} maxLength={500} />
        </Grid>
      </Card>
      {id && panel}
      <SaveBar form={form} editing={!!id} label={id ? t('common.save') : t('tl.add')} onCancel={() => nav(-1)} />
      {!id && !cities.length && <Alert tone="amber">{t('tl.no_cities')}</Alert>}
    </form>
  );
}

export function LicenseView() {
  const { id } = useParams();
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const run = useAction();
  const { confirm } = useUi();
  const city = useCityName();
  const [l, setL] = useState<any>(null);
  useEffect(() => { get(`/transport-licenses/${id}`).then(setL); }, [id]);
  if (!l) return <Loading />;
  const issued = l.driver_cards + l.operation_cards;
  return (
    <>
      <PageHeader title={<span className="num">{l.number}</span>} back="/admin/transport-licenses" subtitle={<Badge tone={TL_STATUS[l.status]}>{t(`tl.status.${l.status}`)}</Badge>}
        actions={can('transport_licenses.update') && <Link to={`/admin/transport-licenses/${id}/edit`}><Button icon={<Pencil className="size-4" />}>{t('common.edit')}</Button></Link>} />
      {l.status === 'valid' && l.days_left < 0 && <div className="mb-4"><Alert tone="amber">{t('tl.valid_but_past')}</Alert></div>}
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label={t('tl.expires')} value={l.expiry_date} sub={<Remaining days={l.days_left} />} />
        <StatCard label={t('tl.driver_cards')} value={fmtNum(l.driver_cards)} />
        <StatCard label={t('tl.operation_cards')} value={fmtNum(l.operation_cards)} />
      </div>
      <Card title={t('tl.details')}><Details rows={[[t('tl.number'), l.number], [t('tl.city'), city(l)], [t('tl.activity_ar'), l.activity_ar], [t('tl.activity_en'), l.activity_en],
        [t('tl.issued'), l.issue_date], [t('tl.expires'), l.expiry_date], [t('tl.status'), t(`tl.status.${l.status}`)], [t('common.notes'), l.notes]]} /></Card>
      <div className="mt-4"><Attachments entityType="transport_license" entityId={l.id} title={t('tl.licence_copy')} /></div>
      {can('transport_licenses.delete') && (
        <Card title={t('common.delete')} className="mt-4">
          {issued ? <Alert tone="amber">{t('err.licence_has_cards')}</Alert> : <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={async () => {
            if (!(await confirm({ title: t('tl.delete_q') }))) return;
            if (await run(() => del(`/transport-licenses/${id}`), t('tl.deleted'))) nav('/admin/transport-licenses');
          }}>{t('common.delete')}</Button>}
        </Card>
      )}
    </>
  );
}
