import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import { get, patch, post } from '../../api';
import { useAuth } from '../../auth';
import { useI18n } from '../../i18n';
import { Alert, Badge, Button, Card, Field, Loading, PageHeader } from '../../ui/kit';
import { ComboInput, Grid, SaveBar, SelectInput, TextArea, TextInput, useFieldError, useForm, type ComboOption } from '../../ui/forms';
import { ScanUpload, type Scan } from '../../ui/files';
import { Remaining, useCityName, useOptions } from '../../ui/common';
import { DOC_MODULE, DOC_TYPES, type DocType } from './shared';

const EMPTY = { id: '', full_name: '', name_en: '', alias: '', national_id: '', status: 'active', company_id: '', contract_id: '', city_id: '', hire_date: '',
  occupation: '', phone: '', account_holder_phone: '', email: '', language: '', nationality: '', birth_date: '', birth_place: '', blood_type: '', notes: '', vehicle_id: '' };

type DocField = { name: string; label: string; req?: boolean; type?: 'date' | 'select' | 'text'; options?: { value: string; label: string }[]; dir?: 'ltr'; hint?: string };
type DocState = { open: boolean; values: Record<string, string>; scan: Scan | null };

export default function RiderForm() {
  const { id } = useParams();
  const editing = !!id;
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const city = useCityName();
  const form = useForm<Record<string, any>>(EMPTY);
  const fe = useFieldError(form);
  const [loaded, setLoaded] = useState<any>(editing ? null : {});
  const [docs, setDocs] = useState<Record<string, DocState>>({});
  const [docErrors, setDocErrors] = useState<Record<string, Record<string, string>>>({});
  const [saved, setSaved] = useState<{ id: number; failed: any[] } | null>(null);
  const companies = useOptions<any>(`/lookups/companies${editing ? '?all=1' : ''}`);
  const contracts = useOptions<any>(form.values.company_id ? `/lookups/contracts?company=${form.values.company_id}` : null);
  const cities = useOptions<any>('/lookups/cities');
  const nationalities = useOptions<string>('/lookups/nationalities');
  const vehicles = useOptions<any>('/riders-vehicle-options');
  const licenses = useOptions<any>(can('transport_licenses.view', 'driver_cards.view') ? '/transport-licenses/options' : null);

  useEffect(() => {
    if (!editing) return;
    get(`/riders/${id}`).then((r) => {
      setLoaded(r);
      form.reset(Object.fromEntries(Object.keys(EMPTY).map((k) => [k, r[k] ?? ''])));
    });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // When the company changes, a contract that is not one of its contracts is cleared.
  useEffect(() => {
    if (form.values.contract_id && contracts.length && !contracts.some((c: any) => String(c.id) === String(form.values.contract_id))) form.set('contract_id', '');
  }, [contracts]); // eslint-disable-line react-hooks/exhaustive-deps

  const vehicleOptions: ComboOption[] = useMemo(() => vehicles.map((v: any) => ({
    value: v.id, label: v.plate, sub: [v.plate_en, v.maker, v.model].filter(Boolean).join(' · '), search: `${v.plate_en ?? ''} ${v.maker ?? ''}`,
    disabled: !!v.holder_id && String(v.holder_id) !== String(id ?? ''), note: v.holder_id && String(v.holder_id) !== String(id ?? '') ? t('riders.with_holder', { name: v.holder_name }) : undefined,
  })), [vehicles, id, t]);

  const docFields = (type: DocType): DocField[] => {
    const d = (name: string, label: string, req = false): DocField => ({ name, label: t(`docs.f.${label}`), req, type: 'date' });
    switch (type) {
      case 'id': return [
        { name: 'id_kind', label: t('docs.f.document_type'), req: true, type: 'select', options: ['national_id', 'iqama', 'passport'].map((v) => ({ value: v, label: t(`docs.kind.${v}`) })) },
        { name: 'version_number', label: t('docs.f.version_number') }, { name: 'place_of_issue', label: t('docs.f.place_of_issue') },
        d('issue_date', 'issue_date'), d('expiry_date', 'expiry_date', true)];
      case 'license': return [{ name: 'doc_number', label: t('docs.f.licence_number'), req: true, dir: 'ltr' }, { name: 'license_type', label: t('docs.f.licence_type'), req: true, hint: t('docs.f.licence_type_hint') },
        { name: 'license_type_en', label: t('docs.f.licence_type_en') }, d('issue_date', 'issue_date'), d('expiry_date', 'expiry_date', true)];
      case 'health': return [{ name: 'doc_number', label: t('docs.f.certificate_number'), req: true, dir: 'ltr' }, { name: 'cert_type', label: t('docs.f.certificate_type'), req: true },
        { name: 'issuing_authority', label: t('docs.f.issuing_authority') }, d('issue_date', 'issue_date'), d('expiry_date', 'expiry_date', true),
        { name: 'issue_date_hijri', label: t('docs.f.issue_date_hijri'), dir: 'ltr', hint: t('docs.f.hijri_hint') }, { name: 'expiry_date_hijri', label: t('docs.f.expiry_date_hijri'), dir: 'ltr', hint: t('docs.f.hijri_hint') }];
      case 'driver_card': return [{ name: 'doc_number', label: t('docs.f.card_number'), req: true, dir: 'ltr' },
        { name: 'transport_license_id', label: t('docs.f.issuing_licence'), req: true, type: 'select', options: licenses.map((l: any) => ({ value: String(l.id), label: `${l.number} · ${city(l)}` })) },
        { name: 'card_category', label: t('docs.f.card_category'), type: 'select', options: ['yearly', 'half_yearly', 'quarterly', 'temporary'].map((v) => ({ value: v, label: t(`docs.cat.${v}`) })) },
        d('issue_date', 'issue_date'), d('expiry_date', 'expiry_date', true)];
      case 'ajeer': return [{ name: 'doc_number', label: t('docs.f.permit_number'), req: true, dir: 'ltr' },
        { name: 'beneficiary_company_id', label: t('docs.f.beneficiary_company'), type: 'select', options: companies.map((c: any) => ({ value: String(c.id), label: c.name })) },
        { name: 'contract_summary', label: t('docs.f.contract_summary') }, { name: 'work_locations', label: t('docs.f.work_locations') },
        d('issue_date', 'issue_date'), d('expiry_date', 'expiry_date', true)];
    }
  };
  const docDefaults = (type: DocType): Record<string, string> => {
    if (type === 'health') return { cert_type: t('docs.health_default') };
    if (type === 'driver_card') { const valid = licenses.find((l: any) => l.status === 'valid'); return valid ? { transport_license_id: String(valid.id) } : {}; }
    if (type === 'ajeer' && form.values.company_id) return { beneficiary_company_id: String(form.values.company_id) };
    return {};
  };
  const docOf = (type: DocType) => docs[type] ?? { open: false, values: {}, scan: null };
  const setDoc = (type: DocType, patchState: Partial<DocState>) => setDocs((d) => ({ ...d, [type]: { ...docOf(type), ...d[type], ...patchState } }));
  const prepared = (type: DocType) => { const d = docOf(type); return !!d.scan || Object.entries(d.values).some(([k, v]) => v && !(k in docDefaults(type))); };
  const preparedCount = DOC_TYPES.filter((d) => can(`${DOC_MODULE[d]}.create`) && prepared(d)).length;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const documents = Object.fromEntries(DOC_TYPES.filter((d) => prepared(d)).map((d) => [d, { ...docOf(d).values, scan: docOf(d).scan?.token }]));
    const body = editing ? { ...form.changes, documents } : { ...form.values, documents };
    const r = await form.submit(() => (editing ? patch(`/riders/${id}`, body) : post('/riders', body)));
    if (!r) return;
    const errs = Object.fromEntries((r.failed ?? []).map((f: any) => [f.type, f.fields ?? {}]));
    setDocErrors(errs);
    // Saved documents are cleared; refused ones stay open with their errors.
    setDocs((d) => Object.fromEntries(Object.entries(d).filter(([k]) => errs[k]).map(([k, v]) => [k, { ...v, open: true }])));
    if (editing && !r.failed.length) nav(`/admin/riders/${id}`);
    else setSaved(r);
  };

  if (!loaded) return <Loading />;
  // After adding, the rider stays saved even if a document was refused; the warning says which and why.
  if (saved && !editing) {
    return (
      <Card>
        {saved.failed.length > 0 && <Alert tone="amber" title={t('riders.docs_not_saved', { n: saved.failed.length })}>
          {saved.failed.map((f: any) => <div key={f.type}>{t(`docs.${f.type}`)}: {t(`err.${f.error === 'validation' ? Object.values(f.fields ?? {})[0] : f.error}`, f.params)}</div>)}
        </Alert>}
        <div className="py-8 text-center">
          <CheckCircle2 className="mx-auto size-10 text-emerald-500" />
          <h2 className="mt-2 text-lg font-semibold">{t('riders.saved')}</h2>
          <div className="mt-4 flex justify-center gap-2">
            <Link to={`/admin/riders/${saved.id}`}><Button variant="primary">{t('riders.open_profile')}</Button></Link>
            <Button onClick={() => { setSaved(null); form.reset(EMPTY); setDocs({}); }}>{t('riders.add_another')}</Button>
          </div>
        </div>
      </Card>
    );
  }

  const docSection = (type: DocType) => {
    if (!can(`${DOC_MODULE[type]}.view`)) return null;
    const st = docOf(type);
    const cur = loaded?.documents?.[type];
    const fields = docFields(type);
    const errs = docErrors[type] ?? {};
    const missing = fields.filter((f) => f.req && !(st.values[f.name] ?? docDefaults(type)[f.name]));
    return (
      <div key={type} className="rounded-lg border border-zinc-200 dark:border-zinc-800">
        <button type="button" className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-sm"
          onClick={() => setDoc(type, { open: !st.open, values: Object.keys(st.values).length ? st.values : docDefaults(type) })}>
          <span className="font-medium">{t(`docs.${type}`)}</span>
          {cur?.expiry_date && <span className="text-xs text-zinc-500">{t('docs.valid_until')} <span className="num">{cur.expiry_date}</span></span>}
          {cur && <Remaining days={cur.days_left} />}
          {prepared(type) && <Badge tone="blue">{t('riders.doc_prepared')}</Badge>}
          {errs && Object.keys(errs).length > 0 && <Badge tone="red">{t('riders.doc_refused')}</Badge>}
          <span className="ms-auto">{st.open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}</span>
        </button>
        {st.open && (
          <div className="space-y-3 border-t border-zinc-100 p-3 dark:border-zinc-800">
            {can(`${DOC_MODULE[type]}.upload`) && <ScanUpload value={st.scan} onChange={(scan) => setDoc(type, { scan })} />}
            <div className="grid gap-3 sm:grid-cols-2">
              {fields.map((f) => (
                <Field key={f.name} label={f.label} required={f.req} hint={f.hint} error={errs[f.name] ? t(`err.${errs[f.name]}`, docErrorParams(saved, type)) : undefined}>
                  {f.type === 'select' ? (
                    <select className="input" value={st.values[f.name] ?? ''} onChange={(e) => setDoc(type, { values: { ...st.values, [f.name]: e.target.value } })}>
                      <option value="">{t('common.choose')}</option>
                      {f.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : (
                    <input className="input" type={f.type === 'date' ? 'date' : 'text'} dir={f.dir} value={st.values[f.name] ?? ''}
                      onChange={(e) => setDoc(type, { values: { ...st.values, [f.name]: e.target.value } })} />
                  )}
                </Field>
              ))}
            </div>
            {type === 'id' && <p className="text-xs text-zinc-500">{t('riders.id_number_on_rider')}</p>}
            {missing.length > 0 && prepared(type) && <p className="text-xs text-amber-700">{t('riders.missing_fields')}: {missing.map((f) => f.label).join('، ')}</p>}
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span className="flex-1">{t('riders.doc_saved_with_rider')}</span>
              <Button type="button" size="sm" onClick={() => setDocs((d) => { const n = { ...d }; delete n[type]; return n; })}>{t('riders.discard')}</Button>
              <Button type="button" size="sm" onClick={() => setDoc(type, { open: false })}>{t('riders.collapse')}</Button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <form onSubmit={save}>
      <PageHeader title={editing ? t('riders.edit_title', { name: loaded.full_name }) : t('riders.add')} back={editing ? `/admin/riders/${id}` : '/admin/riders'} />
      {saved && saved.failed.length > 0 && (
        <div className="mb-4"><Alert tone="amber" title={t('riders.docs_not_saved', { n: saved.failed.length })}>
          {saved.failed.map((f: any) => <div key={f.type}>{t(`docs.${f.type}`)}: {t(`err.${f.error === 'validation' ? Object.values(f.fields ?? {})[0] : f.error}`, f.params)}</div>)}
        </Alert></div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Card title={t('riders.sec.identity')}>
            <div className="mb-4">{docSection('id')}</div>
            <Grid>
              {!editing && <TextInput form={form} name="id" label={t('riders.rider_id')} required dir="ltr" hint={t('riders.rider_id_hint')} />}
              <TextInput form={form} name="full_name" label={t('riders.full_name')} required maxLength={150} />
              <TextInput form={form} name="name_en" label={t('riders.name_en')} maxLength={150} dir="ltr" />
              <TextInput form={form} name="alias" label={t('riders.alias')} maxLength={150} hint={t('riders.alias_hint')} />
              <TextInput form={form} name="national_id" label={t('riders.national_id')} maxLength={30} dir="ltr" />
              <SelectInput form={form} name="status" label={t('riders.status')} empty={false} options={['active', 'inactive', 'suspended', 'terminated'].map((v) => ({ value: v, label: t(`rider.status.${v}`) }))} />
            </Grid>
          </Card>
          <Card title={t('riders.sec.operations')}>
            <Grid>
              <SelectInput form={form} name="company_id" label={t('riders.operating_company')} options={companies.map((c: any) => ({ value: c.id, label: c.is_active ? c.name : `${c.name} (${t('common.disabled')})` }))} />
              <SelectInput form={form} name="contract_id" label={t('riders.contract')} disabled={!form.values.company_id} hint={!form.values.company_id ? t('riders.choose_company_first') : undefined}
                options={contracts.map((c: any) => ({ value: c.id, label: c.name }))} />
              <SelectInput form={form} name="city_id" label={t('riders.city')} options={cities.map((c: any) => ({ value: c.id, label: city(c) }))} />
              <TextInput form={form} name="hire_date" label={t('riders.hire_date')} type="date" />
              <ComboInput form={form} name="vehicle_id" label={t('riders.vehicle_optional')} options={vehicleOptions} placeholder={t('riders.vehicle_search')}
                countLabel={(n, total) => t('riders.vehicles_count', { n, total })} />
              <TextInput form={form} name="occupation" label={t('riders.occupation')} />
            </Grid>
          </Card>
          <Card title={t('riders.sec.personal')}>
            <Grid>
              <TextInput form={form} name="phone" label={t('riders.mobile')} dir="ltr" />
              <TextInput form={form} name="account_holder_phone" label={t('riders.account_holder_phone')} dir="ltr" />
              <TextInput form={form} name="email" label={t('riders.email')} type="email" dir="ltr" />
              <SelectInput form={form} name="language" label={t('riders.correspondence_language')} options={['ar', 'en', 'bn'].map((v) => ({ value: v, label: t(`lang.${v}`) }))} />
              <TextInput form={form} name="nationality" label={t('riders.nationality')} list="nationalities" />
              <TextInput form={form} name="birth_date" label={t('riders.birth_date')} type="date" />
              <TextInput form={form} name="birth_place" label={t('riders.birth_place')} />
              <SelectInput form={form} name="blood_type" label={t('riders.blood_type')} options={['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((v) => ({ value: v, label: v }))} />
              <TextArea form={form} name="notes" label={t('common.notes')} maxLength={500} className="sm:col-span-2" />
            </Grid>
            <datalist id="nationalities">{nationalities.map((n) => <option key={n} value={n} />)}</datalist>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title={t('riders.sec.documents')}><div className="space-y-2">{(['license', 'health', 'driver_card'] as DocType[]).map(docSection)}</div></Card>
          <Card title={t('riders.sec.ajeer')}>{docSection('ajeer')}</Card>
          {fe('vehicle_id') && <Alert tone="red">{fe('vehicle_id')}</Alert>}
        </div>
      </div>
      <SaveBar form={form} editing={editing} extra={preparedCount} label={editing ? t('common.save') : t('riders.save_with_docs')} onCancel={() => nav(editing ? `/admin/riders/${id}` : '/admin/riders')} />
    </form>
  );
}
const docErrorParams = (saved: any, type: string) => saved?.failed?.find((f: any) => f.type === type)?.params ?? {};
