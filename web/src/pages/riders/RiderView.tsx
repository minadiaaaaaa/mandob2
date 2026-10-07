import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Pencil, Trash2 } from 'lucide-react';
import { del, get, patch } from '../../api';
import { useAuth } from '../../auth';
import { fmtDateTime, useI18n } from '../../i18n';
import { Alert, Badge, Button, Card, Details, IconButton, Loading, PageHeader, useAction, useErrorText, useUi } from '../../ui/kit';
import { Attachments } from '../../ui/files';
import { Remaining, useCityName } from '../../ui/common';
import { DOC_MODULE, DOC_TYPES, RiderStatus, type DocType } from './shared';
import { RiderOpsCards } from './RiderCards';

export default function RiderView() {
  // the profile shares the /admin/riders/:slug route with the document screens
  const params = useParams();
  const id = params.id ?? params.slug;
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const run = useAction();
  const errText = useErrorText();
  const { confirm } = useUi();
  const city = useCityName();
  const [r, setR] = useState<any>(null);
  const [notFound, setNotFound] = useState(false);
  const [phone, setPhone] = useState<string | null>(null);
  const load = useCallback(() => get(`/riders/${id}`).then(setR).catch(() => setNotFound(true)), [id]);
  useEffect(() => { load(); }, [load]);
  if (notFound) return <Alert tone="amber">{t('riders.not_found')}</Alert>;
  if (!r) return <Loading />;

  const remove = async () => {
    if (!(await confirm({ title: t('riders.delete_q'), body: t('common.cannot_undo'), confirm: t('riders.delete') }))) return;
    try { await del(`/riders/${id}`); nav('/admin/riders'); }
    catch (e: any) {
      const b = e?.params?.blockers;
      await confirm({ title: t('riders.cannot_delete'), body: <>{errText(e)}{b && <ul className="mt-2 list-disc ps-5">{b.map((x: any) => <li key={x.what}>{t(`riders.linked.${x.what}`)}: {x.n}</li>)}</ul>}</>, confirm: t('common.ok'), tone: 'primary' });
    }
  };
  const savePhone = async () => {
    if (await run(() => patch(`/riders/${id}`, { account_holder_phone: phone }), t('common.saved'))) { setPhone(null); load(); }
  };
  const deleteSection = async (type: DocType) => {
    const d = r.documents[type];
    if (!(await confirm({ title: t('riders.delete_section_q', { doc: t(`docs.${type}`), n: d.versions }), body: t('common.cannot_undo') }))) return;
    if (await run(() => del(`/riders/${id}/documents/${type}`), t('common.deleted'))) load();
  };
  const docRows = (type: DocType, d: any): [string, React.ReactNode][] => {
    const f = (k: string) => t(`docs.f.${k}`);
    const common: [string, React.ReactNode][] = [[f('issue_date'), d.issue_date], [f('expiry_date'), d.expiry_date]];
    switch (type) {
      case 'id': return [[f('document_type'), t(`docs.kind.${d.id_kind}`)], [t('riders.national_id'), r.national_id], [f('version_number'), d.version_number], [f('place_of_issue'), d.place_of_issue], ...common];
      case 'license': return [[f('licence_number'), d.doc_number], [f('licence_type'), d.license_type], [f('licence_type_en'), d.license_type_en], ...common];
      case 'health': return [[f('certificate_number'), d.doc_number], [f('certificate_type'), d.cert_type], [f('issuing_authority'), d.issuing_authority], ...common,
        [f('issue_date_hijri'), d.issue_date_hijri], [f('expiry_date_hijri'), d.expiry_date_hijri]];
      case 'driver_card': return [[f('card_number'), d.doc_number], [f('issuing_licence'), d.transport_license_number], [f('card_category'), d.card_category && t(`docs.cat.${d.card_category}`)], ...common];
      case 'ajeer': return [[f('permit_number'), d.doc_number], [f('beneficiary_company'), d.beneficiary_company_name], [f('contract_summary'), d.contract_summary], [f('work_locations'), d.work_locations], ...common];
    }
  };

  return (
    <>
      <PageHeader title={r.full_name} back="/admin/riders"
        subtitle={<span className="num">#{r.id}{r.alias && ` · ${r.alias}`}</span>}
        actions={<>
          {can('riders.update') && <Link to={`/admin/riders/${id}/edit`}><Button icon={<Pencil className="size-4" />}>{t('common.edit')}</Button></Link>}
          {can('riders.delete') && <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={remove}>{t('common.delete')}</Button>}
          <Link to="/admin/riders"><Button variant="ghost">{t('riders.back_to_list')}</Button></Link>
        </>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('riders.sec.identity')}>
          <Details rows={[
            [t('riders.status'), <RiderStatus s={r.status} />, true], [t('riders.full_name'), r.full_name], [t('riders.name_en'), r.name_en], [t('riders.alias'), r.alias],
            [t('riders.national_id'), r.national_id && <span className="num">{r.national_id}</span>], [t('riders.nationality'), r.nationality], [t('riders.birth_date'), r.birth_date],
            [t('riders.birth_place'), r.birth_place], [t('riders.blood_type'), r.blood_type], [t('riders.mobile'), r.phone && <span className="num">{r.phone}</span>],
            [t('riders.account_holder_phone'), phone !== null ? (
              <span className="flex gap-1">
                <input className="input py-1" dir="ltr" autoFocus value={phone} onChange={(e) => setPhone(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') savePhone(); if (e.key === 'Escape') setPhone(null); }} />
                <Button size="sm" variant="primary" onClick={savePhone}>{t('common.save')}</Button><Button size="sm" onClick={() => setPhone(null)}>{t('common.cancel')}</Button>
              </span>
            ) : (
              <span className="flex items-center gap-1"><span className="num">{r.account_holder_phone ?? '—'}</span>
                {can('riders.update') && <IconButton title={t('common.edit')} onClick={() => setPhone(r.account_holder_phone ?? '')}><Pencil /></IconButton>}</span>
            ), true],
            [t('riders.email'), r.email], [t('riders.correspondence_language'), r.language && t(`lang.${r.language}`)], [t('riders.occupation'), r.occupation],
            [t('common.notes'), r.notes], [t('riders.created'), fmtDateTime(r.created_at)],
          ]} />
        </Card>
        <Card title={t('riders.sec.operations')}>
          <Details rows={[
            [t('riders.operating_company'), r.company_name, true], [t('riders.contract'), r.contract_name, true], [t('riders.city'), r.city_ar ? city(r) : null, true],
            [t('riders.hire_date'), r.hire_date],
            [t('riders.vehicle'), r.vehicle_plate ? <Link className="text-brand hover:underline" to={`/admin/vehicles/${r.vehicle_id}`}>{r.vehicle_plate} · {[r.vehicle_maker, r.vehicle_model].filter(Boolean).join(' ')}</Link> : t('riders.no_vehicle'), true],
            [t('riders.assigned_since'), r.assigned_since],
          ]} />
        </Card>
      </div>
      <div className="mt-4">
        <Card title={t('riders.sec.documents')}>
          <div className="space-y-4">
            {DOC_TYPES.filter((type) => type in r.documents).map((type) => {
              const d = r.documents[type];
              return (
                <div key={type} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="font-medium">{t(`docs.${type}`)}</span>
                    {d ? <>
                      {d.expiry_date && <span className="text-xs text-zinc-500">{t('docs.valid_until')} <span className="num">{d.expiry_date}</span></span>}
                      <Remaining days={d.days_left} />
                      <Badge tone={d.days_left !== null && d.days_left < 0 ? 'red' : 'green'} className="ms-auto">{d.days_left !== null && d.days_left < 0 ? t('docs.expired') : t('docs.on_file')}</Badge>
                    </> : <Badge tone="grey" className="ms-auto">{t('docs.no_document')}</Badge>}
                  </div>
                  {d && <>
                    <Details cols={3} rows={[...docRows(type, d), [t('docs.f.status'), t(`docs.status.${d.status === 'valid' && d.days_left !== null && d.days_left < 0 ? 'expired' : d.status}`)]]} />
                    {d.files && <div className="mt-3"><Attachments entityType={`rider_doc_${type}`} entityId={d.id} canUpload={false} title={t('riders.doc_files')} downloadName={`${t(`docs.${type}`)} - ${r.full_name}`} /></div>}
                    {can(`${DOC_MODULE[type]}.delete`) && <Button size="sm" variant="ghost" className="mt-2 text-red-600" icon={<Trash2 className="size-3.5" />} onClick={() => deleteSection(type)}>{t('riders.delete_section')}</Button>}
                  </>}
                </div>
              );
            })}
          </div>
        </Card>
      </div>
      <RiderOpsCards riderId={r.id} />
      <div className="mt-4"><Attachments entityType="rider" entityId={r.id} /></div>
    </>
  );
}
