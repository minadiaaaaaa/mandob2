import { Link, useNavigate } from 'react-router-dom';
import { Eye, FileUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { del, download, post } from '../../api';
import { useAuth } from '../../auth';
import { fmtNum, useI18n } from '../../i18n';
import { Alert, Button, IconButton, PageHeader, StatCard, StatGrid, toneIf, useAction, useUi } from '../../ui/kit';
import { DataTable, FilterBar, FilterDate, FilterSelect, useList, type Column } from '../../ui/table';
import { ExportButton, useCityName, useOptions } from '../../ui/common';
import { DOC_TYPES, DocMark, MissingDocs, RiderStatus } from './shared';

export default function RidersList() {
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const run = useAction();
  const { confirm } = useUi();
  const city = useCityName();
  const list = useList('/riders');
  const companies = useOptions<any>('/lookups/companies');
  const contracts = useOptions<any>(`/lookups/contracts${list.query.company && list.query.company !== 'none' ? `?company=${list.query.company}` : ''}`);
  const cities = useOptions<any>('/lookups/cities');
  const nationalities = useOptions<string>('/lookups/nationalities');
  const s = list.stats ?? {};
  const statusFilter = (v: string) => list.set('status', list.query.status === v ? null : v);

  const remove = async (ids: (string | number)[]) => {
    const ok = await confirm({ title: ids.length > 1 ? t('riders.delete_many_q', { n: ids.length }) : t('riders.delete_q'), body: t('common.cannot_undo'), confirm: t('riders.delete') });
    if (!ok) return;
    const r = await run(() => (ids.length > 1 ? post('/riders/bulk-delete', { ids }) : del(`/riders/${ids[0]}`)), t('riders.deleted'));
    if (r) { list.setSelected(new Set()); list.reload(); }
  };

  const columns: Column<any>[] = [
    { key: 'rider', header: t('riders.rider'), sort: 'rider', render: (r) => (
      <div className="min-w-48">
        <div className="flex flex-wrap items-center gap-1.5"><Link to={`/admin/riders/${r.id}`} className="font-medium hover:text-brand">{r.full_name}</Link><DocMark types={r.doc_types} expired={r.docs_expired} /></div>
        {r.alias && <div className="text-xs text-zinc-500">{r.alias}</div>}
        <div className="text-xs text-zinc-500 num">#{r.id}</div>
      </div>
    ) },
    { key: 'missing', header: t('riders.missing_documents'), render: (r) => <MissingDocs types={r.doc_types} /> },
    { key: 'national_id', header: t('riders.national_id'), render: (r) => <span className="num">{r.national_id ?? '—'}</span> },
    { key: 'phone', header: t('riders.phone'), render: (r) => <span className="num">{r.phone ?? '—'}</span> },
    { key: 'company', header: t('riders.company'), render: (r) => r.company_name ?? '—' },
    { key: 'city', header: t('riders.city'), render: (r) => (r.city_ar ? city(r) : '—') },
    { key: 'vehicle', header: t('riders.vehicle'), render: (r) => r.vehicle_plate ?? '—' },
    { key: 'status', header: t('riders.status'), render: (r) => <RiderStatus s={r.status} /> },
    { key: 'actions', header: t('common.actions'), render: (r) => (
      <div className="flex">
        <IconButton title={t('riders.view')} onClick={() => nav(`/admin/riders/${r.id}`)}><Eye /></IconButton>
        {can('riders.update') && <IconButton title={t('riders.edit')} onClick={() => nav(`/admin/riders/${r.id}/edit`)}><Pencil /></IconButton>}
        {can('riders.delete') && <IconButton title={t('riders.delete')} tone="red" onClick={() => remove([r.id])}><Trash2 /></IconButton>}
      </div>
    ) },
  ];

  return (
    <>
      <PageHeader title={t('riders.title')} actions={<>
        {can('riders.export') && <ExportButton path="/riders/export" query={list.query} label={t('riders.export')} />}
        {can('riders.import') && <Button size="sm" onClick={() => run(() => download('/riders/import/template'))}>{t('import.download_template')}</Button>}
        {can('riders.import') && <Link to="/admin/riders/import"><Button size="sm" icon={<FileUp className="size-3.5" />}>{t('import.import_file')}</Button></Link>}
        {can('riders.create') && <Link to="/admin/riders/new"><Button variant="primary" icon={<Plus className="size-4" />}>{t('riders.add')}</Button></Link>}
      </>} />
      <StatGrid>
        <StatCard label={t('riders.s.total')} value={fmtNum(s.total)} />
        <StatCard label={t('rider.status.active')} value={fmtNum(s.active)} tone="green" onClick={() => statusFilter('active')} active={list.query.status === 'active'} />
        <StatCard label={t('rider.status.inactive')} value={fmtNum(s.inactive)} onClick={() => statusFilter('inactive')} active={list.query.status === 'inactive'} />
        <StatCard label={t('rider.status.suspended')} value={fmtNum(s.suspended)} tone={toneIf(s.suspended, 'amber')} onClick={() => statusFilter('suspended')} active={list.query.status === 'suspended'} />
        <StatCard label={t('rider.status.terminated')} value={fmtNum(s.terminated)} tone={toneIf(s.terminated, 'red')} onClick={() => statusFilter('terminated')} active={list.query.status === 'terminated'} />
        <StatCard label={t('riders.s.with_vehicle')} value={fmtNum(s.with_vehicle)} tone="blue" />
        <StatCard label={t('riders.s.no_company')} value={fmtNum(s.no_company)} tone={toneIf(s.no_company, 'amber')} onClick={() => list.set('company', list.query.company === 'none' ? null : 'none')} active={list.query.company === 'none'} />
        <StatCard label={t('riders.s.no_contract')} value={fmtNum(s.no_contract)} tone={toneIf(s.no_contract, 'amber')} onClick={() => list.set('contract', list.query.contract === 'none' ? null : 'none')} active={list.query.contract === 'none'} />
      </StatGrid>
      {(companies.failed || cities.failed) && <div className="mb-3"><Alert tone="amber">{t('riders.lists_failed')}</Alert></div>}
      <FilterBar list={list} placeholder={t('riders.search_hint')}>
        <FilterSelect list={list} name="company" label={t('riders.company')} options={companies.map((c: any) => ({ value: c.id, label: c.name }))} />
        <FilterSelect list={list} name="contract" label={t('riders.contract')} options={contracts.map((c: any) => ({ value: c.id, label: c.name }))} />
        <FilterSelect list={list} name="city" label={t('riders.city')} options={cities.map((c: any) => ({ value: c.id, label: city(c) }))} />
        <FilterSelect list={list} name="status" label={t('riders.status')} options={['active', 'inactive', 'suspended', 'terminated'].map((v) => ({ value: v, label: t(`rider.status.${v}`) }))} />
        <FilterSelect list={list} name="vehicle" label={t('riders.vehicle')} options={[{ value: 'yes', label: t('riders.has_vehicle') }, { value: 'no', label: t('riders.no_vehicle') }]} />
        <FilterSelect list={list} name="vehicle_type" label={t('riders.vehicle_type')} options={['car', 'motorcycle', 'bicycle', 'scooter', 'van', 'truck'].map((v) => ({ value: v, label: t(`vehicle.type.${v}`) }))} />
        <FilterSelect list={list} name="documents" label={t('riders.documents')} options={['complete', 'incomplete', 'some_expired', 'none'].map((v) => ({ value: v, label: t(`riders.docs.${v}`) }))} />
        <FilterSelect list={list} name="missing" label={t('riders.missing_document')} options={DOC_TYPES.map((d) => ({ value: d, label: t(`docs.${d}`) }))} />
        <FilterSelect list={list} name="nationality" label={t('riders.nationality')} options={nationalities.map((n) => ({ value: n, label: n }))} />
        <FilterSelect list={list} name="language" label={t('riders.rider_language')} options={['ar', 'en', 'bn'].map((v) => ({ value: v, label: t(`lang.${v}`) }))} />
        <FilterSelect list={list} name="has_phone" label={t('riders.has_phone')} options={[{ value: 'yes', label: t('common.yes') }, { value: 'no', label: t('common.no') }]} />
        <FilterDate list={list} name="hired_from" label={t('riders.hired_from')} />
        <FilterDate list={list} name="hired_to" label={t('riders.hired_to')} />
      </FilterBar>
      <DataTable list={list} columns={columns} onRowClick={(r) => nav(`/admin/riders/${r.id}`)} selectable={can('riders.delete') || can('riders.update')}
        bulk={<>
          {can('riders.update') && <Button size="sm" onClick={() => nav('/admin/riders/bulk-edit', { state: { ids: [...list.selected], names: list.rows.filter((r: any) => list.selected.has(r.id)).map((r: any) => r.full_name) } })}>{t('riders.edit_selected')}</Button>}
          {can('riders.delete') && <Button size="sm" variant="danger" onClick={() => remove([...list.selected])}>{t('common.delete_selected')}</Button>}
        </>} />
    </>
  );
}
