import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, Eye, FileUp, Pencil, Plus, Star, Trash2, UserCheck } from 'lucide-react';
import { del, download, get, patch, post } from '../../api';
import { useAuth } from '../../auth';
import { fmtDate, fmtDateTime, fmtNum, useI18n } from '../../i18n';
import { Alert, Badge, Button, Card, cx, Details, Field, IconButton, Loading, PageHeader, StatCard, StatGrid, useAction, useErrorText, useUi, type Tone } from '../../ui/kit';
import { CheckInput, Grid, SaveBar, SelectInput, TextArea, TextInput, useForm } from '../../ui/forms';
import { DataTable, FilterBar, FilterSelect, useList, type Column } from '../../ui/table';
import { ImportWizard } from '../../ui/importer';
import { Attachments } from '../../ui/files';
import { ExportButton, useCityName, useOptions } from '../../ui/common';

const STATUS_TONE: Record<string, Tone> = { new: 'blue', review: 'amber', approved: 'green', rejected: 'red', withdrawn: 'grey', hired: 'green' };
export const AppStatus = ({ s }: { s: string }) => { const { t } = useI18n(); return <Badge tone={STATUS_TONE[s]}>{t(`app.status.${s}`)}</Badge>; };

function StarButton({ on, onClick, title }: { on: boolean; onClick: () => void; title: string }) {
  return <button title={title} onClick={onClick} className={cx('rounded p-1', on ? 'text-amber-400' : 'text-zinc-300 hover:text-amber-300')}><Star className={cx('size-5', on && 'fill-current')} /></button>;
}
function Official({ r }: { r: any }) {
  const { t } = useI18n();
  if (r.rider_id) return <Link to={`/admin/riders/${r.rider_id}`}><Badge tone="green">{t('app.official_rider')}</Badge></Link>;
  if (r.matching_rider_id || r.matching_rider) return <Badge tone="amber">{t('app.exists_as_rider', { id: r.matching_rider_id ?? r.matching_rider.id })}</Badge>;
  return <span className="text-xs text-zinc-500">{t('app.not_rider_yet')}</span>;
}

export function ApplicantsList() {
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const run = useAction();
  const { confirm } = useUi();
  const city = useCityName();
  const list = useList('/applicants');
  const cities = useOptions<any>('/lookups/cities');
  const [bulkStatus, setBulkStatus] = useState('');
  const s = list.stats ?? {};
  const ids = [...list.selected];
  const feature = async (r: any) => { if (await run(() => post(`/applicants/${r.id}/feature`, { featured: !r.featured }))) list.reload(); };
  const remove = async (sel: (string | number)[]) => {
    if (!(await confirm({ title: t('app.delete_q'), body: t('common.cannot_undo') }))) return;
    if (await run(() => (sel.length > 1 ? post('/applicants/bulk-delete', { ids: sel }) : del(`/applicants/${sel[0]}`)), t('common.deleted'))) { list.setSelected(new Set()); list.reload(); }
  };
  const columns: Column<any>[] = [
    { key: 'featured', header: t('app.featured'), sort: 'featured', render: (r) => <StarButton on={!!r.featured} title={t('app.toggle_featured')} onClick={() => can('applicants.update') && feature(r)} /> },
    { key: 'name', header: t('common.name'), sort: 'name', render: (r) => <div><div className="font-medium">{r.full_name}</div><div className="text-xs text-zinc-500">{r.featured && r.featured_reason ? r.featured_reason : <span className="num">#{r.id}</span>}</div></div> },
    { key: 'phone', header: t('app.phone'), sort: 'phone', render: (r) => <span className="num">{r.phone}</span> },
    { key: 'city', header: t('app.city'), sort: 'city', render: (r) => (r.city_ar ? city(r) : '—') },
    { key: 'own_vehicle', header: t('app.own_vehicle'), sort: 'own_vehicle', render: (r) => <div>{r.has_vehicle ? t('common.yes') : t('common.no')}{r.vehicle_type && <div className="text-xs text-zinc-500">{r.vehicle_type}</div>}</div> },
    { key: 'status', header: t('app.status'), sort: 'status', render: (r) => <div><AppStatus s={r.status} />{r.rider_id && <div className="text-xs text-zinc-500 num">#{r.rider_id}</div>}</div> },
    { key: 'official', header: t('app.official'), sort: 'official', render: (r) => <Official r={r} /> },
    { key: 'filed', header: t('app.filed_on'), sort: 'filed', render: (r) => <span className="num">{fmtDate(r.created_at)}</span> },
    { key: 'actions', header: t('common.actions'), render: (r) => (
      <div className="flex">
        <IconButton title={t('app.view')} onClick={() => nav(`/admin/rider-applicants/${r.id}`)}><Eye /></IconButton>
        {can('applicants.update') && <IconButton title={t('app.edit')} onClick={() => nav(`/admin/rider-applicants/${r.id}/edit`)}><Pencil /></IconButton>}
        {can('applicants.hire') && r.status === 'approved' && !r.rider_id && <IconButton title={t('app.hire')} tone="green" onClick={() => nav(`/admin/rider-applicants/${r.id}`)}><UserCheck /></IconButton>}
        {can('applicants.delete') && r.status !== 'hired' && <IconButton title={t('app.delete')} tone="red" onClick={() => remove([r.id])}><Trash2 /></IconButton>}
      </div>
    ) },
  ];
  const card = (k: string, label: string, tone: Tone = 'none', filter?: [string, string]) => (
    <StatCard key={k} label={label} value={fmtNum(s[k])} tone={s[k] ? tone : 'none'} onClick={filter ? () => list.set(filter[0], list.query[filter[0]] === filter[1] ? null : filter[1]) : undefined} active={!!filter && list.query[filter[0]] === filter[1]} />
  );
  return (
    <>
      <PageHeader title={t('app.title')} actions={<>
        {can('applicants.export') && <ExportButton path="/applicants/export" query={list.query} />}
        {can('applicants.import') && <Button size="sm" onClick={() => run(() => download('/applicants/import/template'))}>{t('import.download_template')}</Button>}
        {can('applicants.import') && <Link to="/admin/rider-applicants/import"><Button size="sm" icon={<FileUp className="size-3.5" />}>{t('import.import_file')}</Button></Link>}
        {can('applicants.create') && <Link to="/admin/rider-applicants/new"><Button variant="primary" icon={<Plus className="size-4" />}>{t('app.register')}</Button></Link>}
      </>} />
      <StatGrid>
        {card('total', t('app.s.total'))}{card('open', t('app.s.open'), 'blue')}{card('new', t('app.status.new'), 'blue', ['status', 'new'])}
        {card('review', t('app.status.review'), 'amber', ['status', 'review'])}{card('approved', t('app.status.approved'), 'green', ['status', 'approved'])}
        {card('rejected', t('app.status.rejected'), 'red', ['status', 'rejected'])}{card('hired', t('app.status.hired'), 'green', ['status', 'hired'])}
        {card('withdrawn', t('app.status.withdrawn'), 'none', ['status', 'withdrawn'])}{card('own_vehicle', t('app.s.own_vehicle'), 'none', ['own_vehicle', 'yes'])}
        {card('featured', t('app.featured'), 'amber', ['featured', 'yes'])}{card('official', t('app.s.official'), 'green', ['official', 'yes'])}
      </StatGrid>
      <FilterBar list={list} placeholder={t('app.search_hint')}>
        <FilterSelect list={list} name="status" label={t('app.status')} options={Object.keys(STATUS_TONE).map((v) => ({ value: v, label: t(`app.status.${v}`) }))} />
        <FilterSelect list={list} name="city" label={t('app.city')} options={cities.map((c: any) => ({ value: c.id, label: city(c) }))} />
        <FilterSelect list={list} name="featured" label={t('app.featured')} options={[{ value: 'yes', label: t('app.featured_only') }, { value: 'no', label: t('app.not_featured') }]} />
        <FilterSelect list={list} name="official" label={t('app.official_q')} options={[{ value: 'yes', label: t('app.official_rider') }, { value: 'no', label: t('app.not_rider_yet') }]} />
        <FilterSelect list={list} name="own_vehicle" label={t('app.own_vehicle')} options={[{ value: 'yes', label: t('common.yes') }, { value: 'no', label: t('common.no') }]} />
      </FilterBar>
      <DataTable list={list} columns={columns} onRowClick={(r) => nav(`/admin/rider-applicants/${r.id}`)} selectable={can('applicants.update') || can('applicants.delete')}
        bulk={<>
          {can('applicants.update') && <>
            <Button size="sm" onClick={() => run(() => post('/applicants/bulk-feature', { ids, featured: true })).then((r) => r && list.reload())}>{t('app.feature_selected')}</Button>
            <Button size="sm" onClick={() => run(() => post('/applicants/bulk-feature', { ids, featured: false })).then((r) => r && list.reload())}>{t('app.unfeature_selected')}</Button>
            <select className="input w-auto py-1 text-xs" value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}>
              <option value="">{t('app.status')}</option>{['new', 'review', 'approved', 'rejected', 'withdrawn'].map((v) => <option key={v} value={v}>{t(`app.status.${v}`)}</option>)}
            </select>
            <Button size="sm" disabled={!bulkStatus} onClick={async () => {
              if (!(await confirm({ title: t('app.bulk_status_q', { n: ids.length, status: t(`app.status.${bulkStatus}`) }), tone: 'primary' }))) return;
              if (await run(() => post('/applicants/bulk-status', { ids, status: bulkStatus }), t('common.saved'))) { list.setSelected(new Set()); list.reload(); }
            }}>{t('app.apply_to_selected')}</Button>
          </>}
          {can('applicants.delete') && <Button size="sm" variant="danger" onClick={() => remove(ids)}>{t('common.delete_selected')}</Button>}
        </>} />
    </>
  );
}

const EMPTY = { full_name: '', name_en: '', phone: '', national_id: '', nationality: '', birth_date: '', city_id: '', status: 'new', heard_from: '', featured: false,
  featured_reason: '', notes: '', has_vehicle: false, vehicle_type: '', vehicle_plate: '', vehicle_maker: '', vehicle_model: '', vehicle_year: '' };

export function ApplicantForm() {
  const { id } = useParams();
  const { t } = useI18n();
  const nav = useNavigate();
  const city = useCityName();
  const form = useForm<Record<string, any>>(EMPTY);
  const cities = useOptions<any>('/lookups/cities');
  const [loaded, setLoaded] = useState<any>(id ? null : {});
  const [saved, setSaved] = useState<number | null>(null);
  useEffect(() => {
    if (id) get(`/applicants/${id}`).then((a) => { setLoaded(a); form.reset(Object.fromEntries(Object.keys(EMPTY).map((k) => [k, a[k] ?? '']))); });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!loaded) return <Loading />;
  if (saved) return (
    <Card><div className="py-8 text-center"><CheckCircle2 className="mx-auto size-10 text-emerald-500" /><h2 className="mt-2 text-lg font-semibold">{t('app.filed')}</h2>
      <div className="mt-4 flex justify-center gap-2"><Link to={`/admin/rider-applicants/${saved}`}><Button variant="primary">{t('app.open')}</Button></Link>
        <Button onClick={() => { setSaved(null); form.reset(EMPTY); }}>{t('app.register_another')}</Button></div></div></Card>
  );
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await form.submit(() => (id ? patch(`/applicants/${id}`, form.changes) : post('/applicants', form.values)));
    if (r) { if (id) nav(`/admin/rider-applicants/${id}`); else setSaved(r.id); }
  };
  const hasV = !!form.values.has_vehicle && form.values.has_vehicle !== '0';
  return (
    <form onSubmit={submit}>
      <PageHeader title={id ? t('app.edit') : t('app.register')} back={id ? `/admin/rider-applicants/${id}` : '/admin/rider-applicants'} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('app.sec.identity')}>
          <Grid>
            <TextInput form={form} name="full_name" label={t('app.full_name')} required maxLength={150} />
            <TextInput form={form} name="name_en" label={t('app.name_en')} maxLength={150} />
            <TextInput form={form} name="phone" label={t('app.phone')} required dir="ltr" maxLength={20} hint={t('app.phone_hint')} />
            <TextInput form={form} name="national_id" label={t('app.national_id')} dir="ltr" maxLength={30} />
            <TextInput form={form} name="nationality" label={t('app.nationality')} />
            <TextInput form={form} name="birth_date" label={t('app.birth_date')} type="date" />
            <SelectInput form={form} name="city_id" label={t('app.city')} options={cities.map((c: any) => ({ value: c.id, label: city(c) }))} />
          </Grid>
        </Card>
        <div className="space-y-4">
          <Card title={t('app.sec.application')}>
            <Grid>
              {id && loaded.status !== 'hired' && <SelectInput form={form} name="status" label={t('app.status')} empty={false} options={['new', 'review', 'approved', 'rejected', 'withdrawn'].map((v) => ({ value: v, label: t(`app.status.${v}`) }))} />}
              <TextInput form={form} name="heard_from" label={t('app.heard_from')} maxLength={100} />
            </Grid>
            <div className="mt-3 space-y-3">
              <CheckInput form={form} name="featured" label={t('app.featured')} />
              {!!form.values.featured && form.values.featured !== '0' && <TextInput form={form} name="featured_reason" label={t('app.why_featured')} maxLength={255} hint={t('app.why_featured_hint')} />}
              <TextArea form={form} name="notes" label={t('common.notes')} maxLength={500} />
            </div>
          </Card>
          <Card title={t('app.sec.vehicle')}>
            <CheckInput form={form} name="has_vehicle" label={t('app.brings_vehicle')} />
            <div className="mt-3"><Grid>
              <TextInput form={form} name="vehicle_type" label={t('app.vehicle_type')} required={hasV} disabled={!hasV} list="vtypes" maxLength={50} />
              <TextInput form={form} name="vehicle_plate" label={t('app.plate')} disabled={!hasV} maxLength={30} />
              <TextInput form={form} name="vehicle_maker" label={t('app.maker')} disabled={!hasV} maxLength={60} />
              <TextInput form={form} name="vehicle_model" label={t('app.model')} disabled={!hasV} maxLength={60} />
              <TextInput form={form} name="vehicle_year" label={t('app.year')} disabled={!hasV} dir="ltr" />
            </Grid></div>
            <datalist id="vtypes">{['car', 'motorcycle', 'bicycle', 'scooter', 'van'].map((v) => <option key={v} value={t(`vehicle.type.${v}`)} />)}</datalist>
          </Card>
        </div>
      </div>
      {id && <div className="mt-4"><Attachments entityType="applicant" entityId={id} title={t('app.cv_photo')} /></div>}
      <SaveBar form={form} editing={!!id} label={id ? t('common.save') : t('app.register')} onCancel={() => nav(-1)} />
    </form>
  );
}

export function ApplicantView() {
  const { id } = useParams();
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const run = useAction();
  const errText = useErrorText();
  const { confirm } = useUi();
  const city = useCityName();
  const cities = useOptions<any>('/lookups/cities');
  const [a, setA] = useState<any>(null);
  const [hiring, setHiring] = useState(false);
  const [hire, setHire] = useState({ rider_id: '', city_id: '' });
  const [hireErr, setHireErr] = useState<string | null>(null);
  const load = useCallback(() => get(`/applicants/${id}`).then((x) => { setA(x); setHire({ rider_id: '', city_id: x.city_id ?? '' }); }), [id]);
  useEffect(() => { load(); }, [load]);
  if (!a) return <Loading />;
  const doHire = async () => {
    setHireErr(null);
    try { const r = await post(`/applicants/${id}/hire`, hire); await load(); setHiring(false); run(async () => r, t('app.hired_msg', { id: r.rider_id })); }
    catch (e) { setHireErr(errText(e)); }
  };
  return (
    <>
      <PageHeader title={<span className="flex items-center gap-2">{a.full_name}<StarButton on={!!a.featured} title={t('app.toggle_featured')} onClick={async () => { if (can('applicants.update') && await run(() => post(`/applicants/${id}/feature`, { featured: !a.featured }))) load(); }} /></span>}
        back="/admin/rider-applicants"
        subtitle={<span className="flex flex-wrap items-center gap-2"><span className="num">#{a.id} · {a.phone}</span><AppStatus s={a.status} /><Official r={a} /></span>}
        actions={can('applicants.update') && <Link to={`/admin/rider-applicants/${id}/edit`}><Button icon={<Pencil className="size-4" />}>{t('common.edit')}</Button></Link>} />
      {!!a.featured && <div className="mb-4"><Alert tone="amber">{t('app.featured_by', { name: a.featured_by_name ?? '—', date: fmtDateTime(a.featured_at) })}{a.featured_reason && ` — ${a.featured_reason}`}</Alert></div>}
      <div className="space-y-4">
        {a.rider_id && (
          <Card title={t('app.hired_card')}>
            <Details rows={[[t('app.rider_name'), a.hired_name], [t('app.rider_status'), a.hired_status && t(`rider.status.${a.hired_status}`)], [t('app.hire_date'), a.hired_date]]} />
            <Link to={`/admin/riders/${a.rider_id}`}><Button className="mt-3">{t('app.open_rider')}</Button></Link>
          </Card>
        )}
        {a.matching_rider && (
          <Card title={t('app.already_rider')}>
            <p className="text-sm">{a.matching_rider.full_name} · <span className="num">#{a.matching_rider.id}</span></p>
            <div className="mt-3 flex gap-2">
              <Link to={`/admin/riders/${a.matching_rider.id}`}><Button>{t('app.open_rider')}</Button></Link>
              {can('applicants.hire') && <Button variant="primary" onClick={async () => {
                if (!(await confirm({ title: t('app.confirm_official_q'), tone: 'primary' }))) return;
                if (await run(() => post(`/applicants/${id}/link`), t('common.saved'))) load();
              }}>{t('app.confirm_official')}</Button>}
            </div>
          </Card>
        )}
        {a.status === 'approved' && !a.rider_id && can('applicants.hire') && (
          <Card title={t('app.hire')}>
            {!hiring ? <Button variant="primary" onClick={() => setHiring(true)}>{t('app.start_hiring')}</Button> : (
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label={t('riders.rider_id')} required hint={t('app.rider_id_hint')}><input className="input" dir="ltr" value={hire.rider_id} onChange={(e) => setHire({ ...hire, rider_id: e.target.value })} /></Field>
                <Field label={t('app.city')}><select className="input" value={hire.city_id} onChange={(e) => setHire({ ...hire, city_id: e.target.value })}><option value="">—</option>{cities.map((c: any) => <option key={c.id} value={c.id}>{city(c)}</option>)}</select></Field>
                <div className="flex items-end gap-2"><Button variant="primary" onClick={doHire}>{t('app.confirm_hire')}</Button><Button onClick={() => setHiring(false)}>{t('common.cancel')}</Button></div>
                {hireErr && <div className="sm:col-span-3"><Alert tone="red">{hireErr}</Alert></div>}
              </div>
            )}
          </Card>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label={t('app.own_vehicle')} value={a.has_vehicle ? t('common.yes') : t('common.no')} />
          <StatCard label={t('app.status')} value={t(`app.status.${a.status}`)} />
          <StatCard label={t('app.last_reviewed_by')} value={a.reviewed_by_name ?? '—'} sub={a.reviewed_at && fmtDateTime(a.reviewed_at)} />
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title={t('app.details')}><Details cols={1} rows={[[t('app.name_en'), a.name_en], [t('app.national_id'), a.national_id], [t('app.nationality'), a.nationality],
            [t('app.birth_date'), a.birth_date], [t('app.city'), a.city_ar && city(a)], [t('app.heard_from'), a.heard_from], [t('app.filed_on'), fmtDateTime(a.created_at)]]} /></Card>
          <Card title={t('app.sec.vehicle')}>{a.has_vehicle ? <Details cols={1} rows={[[t('app.vehicle_type'), a.vehicle_type], [t('app.plate'), a.vehicle_plate], [t('app.maker'), a.vehicle_maker], [t('app.model'), a.vehicle_model], [t('app.year'), a.vehicle_year]]} /> : <p className="text-sm text-zinc-500">{t('common.no')}</p>}</Card>
          <Card title={t('common.notes')}><p className="whitespace-pre-wrap text-sm">{a.notes ?? '—'}</p></Card>
        </div>
        <Attachments entityType="applicant" entityId={a.id} title={t('app.cv_photo')} />
        {can('applicants.delete') && a.status !== 'hired' && (
          <Card title={t('app.delete')}>
            <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={async () => {
              if (!(await confirm({ title: t('app.delete_q') }))) return;
              if (await run(() => del(`/applicants/${id}`))) nav('/admin/rider-applicants');
            }}>{t('app.delete')}</Button>
          </Card>
        )}
      </div>
    </>
  );
}

export function ApplicantsImport() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t('app.import_title')} back="/admin/rider-applicants" />
      <ImportWizard base="/applicants/import" back="/admin/rider-applicants" modeLabels={{ question: t('app.when_phone_exists'), skip: t('import.skip'), replace: t('import.replace') }} />
    </>
  );
}
