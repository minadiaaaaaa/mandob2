import { Link, useNavigate, useParams } from 'react-router-dom';
import { UserRound } from 'lucide-react';
import { useAuth } from '../../auth';
import { fmtNum, useI18n } from '../../i18n';
import { Badge, IconButton, PageHeader, StatCard, StatGrid, toneIf } from '../../ui/kit';
import { DataTable, FilterBar, FilterNumber, FilterSelect, FilterToggles, useList, type Column } from '../../ui/table';
import { ExportButton, Remaining, useCityName, useOptions } from '../../ui/common';
import { DOC_MODULE, DOC_SLUG } from './shared';

const STATE_TONE = { expired: 'red', near: 'amber', valid: 'green', none: 'grey' } as const;

// Five follow-up screens with one layout: what expired, what is close, and how many days are left.
export default function RiderDocuments() {
  const { slug = '' } = useParams();
  const type = DOC_SLUG[slug];
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const city = useCityName();
  const list = useList(type ? `/rider-documents/${type}` : null);
  const companies = useOptions<any>(can('riders.view') ? '/lookups/companies' : null);
  const cities = useOptions<any>(can('riders.view') ? '/lookups/cities' : null);
  if (!type) return null;
  const s = list.stats ?? {};
  const win = Number(list.query.window) || 30;
  const numberHeader = { id: t('riders.national_id'), license: t('docs.f.licence_number'), health: t('docs.f.certificate_number'), driver_card: t('docs.f.card_number'), ajeer: t('docs.f.permit_number') }[type];
  const extraHeader = { id: t('docs.f.document_type'), license: t('docs.f.licence_type'), health: t('docs.f.issuing_authority'), driver_card: t('docs.f.card_category'), ajeer: t('docs.f.beneficiary_company') }[type];
  const extra = (r: any) => ({ id: r.id_kind && t(`docs.kind.${r.id_kind}`), license: r.license_type, health: r.issuing_authority, driver_card: r.card_category && t(`docs.cat.${r.card_category}`), ajeer: r.beneficiary_company_name }[type]);

  const columns: Column<any>[] = [
    { key: 'rider', header: t('riders.rider'), sort: 'rider', render: (r) => (
      <div><Link to={`/admin/riders/${r.rider_id}`} className="font-medium hover:text-brand">{r.full_name}</Link>
        <div className="text-xs text-zinc-500"><span className="num">#{r.rider_id}</span>{r.company_name && ` · ${r.company_name}`}{r.city_ar && ` · ${city(r)}`}</div></div>
    ) },
    { key: 'number', header: numberHeader, render: (r) => <span className="num">{(type === 'id' ? r.national_id : r.doc_number) ?? '—'}</span> },
    { key: 'extra', header: extraHeader, render: (r) => extra(r) ?? '—' },
    { key: 'dates', header: t('docs.issued_expires'), sort: 'expiry', render: (r) => (
      <div className="num text-xs"><div>{r.issue_date ?? '—'} → {r.expiry_date ?? '—'}</div>
        {r.validity_days != null && <div className="text-zinc-500">{t('docs.validity_period', { n: fmtNum(r.validity_days) })}</div>}
        {type === 'health' && r.expiry_date_hijri && <div className="text-zinc-500">{r.expiry_date_hijri} هـ</div>}</div>
    ) },
    { key: 'remaining', header: t('docs.remaining'), sort: 'remaining', render: (r) => <Remaining days={r.days_left} window={win} /> },
    { key: 'validity', header: t('docs.validity'), render: (r) => (
      <div><Badge tone={STATE_TONE[r.state as keyof typeof STATE_TONE]}>{t(`docs.state.${r.state}`)}</Badge>{!r.is_current && <div className="mt-0.5 text-xs text-zinc-500">{t('docs.superseded')}</div>}</div>
    ) },
    { key: 'actions', header: t('common.actions'), render: (r) => (
      <IconButton title={t('docs.rider_profile')} onClick={() => nav(`/admin/riders/${r.rider_id}`)}><UserRound /></IconButton>
    ) },
  ];
  return (
    <>
      <PageHeader title={t(`docs.${type}`)} subtitle={t('docs.screen_subtitle')} actions={can(`${DOC_MODULE[type]}.export`) && <ExportButton path={`/rider-documents/${type}/export`} query={list.query} label={t('common.export_csv')} />} />
      <StatGrid>
        <StatCard label={t('docs.s.documents')} value={fmtNum(s.documents)} sub={t('docs.s.riders', { n: fmtNum(s.riders) })} />
        <StatCard label={t('docs.state.expired')} value={fmtNum(s.expired)} tone={toneIf(s.expired, 'red')} />
        <StatCard label={t('docs.state.near')} value={fmtNum(s.near)} tone={toneIf(s.near, 'amber')} sub={t('docs.s.window', { n: s.window ?? win })} />
        <StatCard label={t('docs.state.valid')} value={fmtNum(s.valid)} tone="green" />
        <StatCard label={t('docs.s.no_expiry')} value={fmtNum(s.none)} />
      </StatGrid>
      <FilterBar list={list} placeholder={t('docs.search_hint')}>
        <FilterToggles list={list} name="validity" options={[
            { value: 'expired', label: t('docs.state.expired'), tone: 'bg-red-600 text-white ring-red-600' },
            { value: 'near', label: t('docs.state.near'), tone: 'bg-amber-500 text-white ring-amber-500' },
            { value: 'valid', label: t('docs.state.valid'), tone: 'bg-emerald-600 text-white ring-emerald-600' },
            { value: 'none', label: t('docs.state.none'), tone: 'bg-zinc-500 text-white ring-zinc-500' },
          ]} />
        <FilterNumber list={list} name="window" label={t('docs.window')} placeholder="30" />
        {can('riders.view') && <FilterSelect list={list} name="company" label={t('riders.company')} options={companies.map((c: any) => ({ value: c.id, label: c.name }))} />}
        {can('riders.view') && <FilterSelect list={list} name="city" label={t('riders.city')} options={cities.map((c: any) => ({ value: c.id, label: city(c) }))} />}
        <FilterSelect list={list} name="in_force" label={t('docs.in_force')} allLabel={t('docs.current_only')} options={[{ value: 'superseded', label: t('docs.superseded_only') }, { value: 'all', label: t('docs.all_versions') }]} />
      </FilterBar>
      <DataTable list={list} columns={columns} onRowClick={(r) => nav(`/admin/riders/${r.rider_id}`)} emptyText={list.hasFilters ? t('docs.no_matching') : undefined} />
    </>
  );
}
