import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Eye, Pencil, Plus, Power, PowerOff, Trash2 } from 'lucide-react';
import { del, get, patch, post } from '../../api';
import { useAuth } from '../../auth';
import { fmtDateTime, fmtNum, useI18n } from '../../i18n';
import { Alert, Badge, Button, Card, Details, IconButton, Loading, PageHeader, StatCard, StatGrid, toneIf, useAction, useUi } from '../../ui/kit';
import { CheckInput, Grid, SaveBar, SelectInput, TextArea, TextInput, useForm } from '../../ui/forms';
import { DataTable, FilterBar, FilterSelect, useList, type Column } from '../../ui/table';
import { Attachments } from '../../ui/files';
import { ExportButton, invalidateOptions, useOptions } from '../../ui/common';

const Active = ({ on }: { on: boolean }) => { const { t } = useI18n(); return <Badge tone={on ? 'green' : 'grey'}>{on ? t('common.active') : t('common.disabled')}</Badge>; };

// Enable / disable / delete share one confirm-then-act pattern.
function useToggle(kind: 'companies' | 'contracts', reload: () => void) {
  const { t } = useI18n();
  const run = useAction();
  const { confirm } = useUi();
  const k = kind === 'companies' ? 'co' : 'ct';
  return {
    toggle: async (r: { id: number; is_active: number }) => {
      const disabling = !!r.is_active;
      if (!(await confirm({ title: t(disabling ? `${k}.disable_q` : `${k}.enable_q`), confirm: t(disabling ? 'common.disable' : 'common.enable'), tone: 'warn' }))) return;
      if (await run(() => post(`/${kind}/${r.id}/${disabling ? 'disable' : 'enable'}`), t(disabling ? `${k}.disabled_msg` : `${k}.enabled_msg`))) { invalidateOptions('/lookups'); reload(); }
    },
    remove: async (id: number) => {
      if (!(await confirm({ title: t(`${k}.delete_q`), body: t('common.cannot_undo') }))) return false;
      return !!(await run(() => del(`/${kind}/${id}`), t(`${k}.deleted_msg`)));
    },
  };
}

// ======================================================================== companies
export function CompaniesList() {
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const list = useList('/companies');
  const { toggle, remove } = useToggle('companies', list.reload);
  const s = list.stats ?? {};
  const columns: Column<any>[] = [
    { key: 'name', header: t('co.company'), sort: 'name', render: (r) => <div><div className="font-medium">{r.name}</div><div className="text-xs text-zinc-500 num">#{r.id}</div></div> },
    { key: 'email', header: t('co.email'), render: (r) => <div><span dir="ltr">{r.email ?? '—'}</span>{r.operator_id && <div className="text-xs text-zinc-500">{t('co.operator_id_x', { id: r.operator_id })}</div>}</div> },
    { key: 'contracts', header: t('co.contracts'), render: (r) => <span className="num">{fmtNum(r.contracts)}</span> },
    { key: 'riders', header: t('co.riders'), render: (r) => <span className="num">{fmtNum(r.riders)}</span> },
    { key: 'status', header: t('co.status'), sort: 'status', render: (r) => <Active on={!!r.is_active} /> },
    { key: 'added', header: t('co.added'), sort: 'created', render: (r) => <span className="num text-xs">{fmtDateTime(r.created_at)}</span> },
    { key: 'actions', header: t('common.actions'), render: (r) => <div className="flex">
      <IconButton title={t('common.view')} onClick={() => nav(`/admin/companies/${r.id}`)}><Eye /></IconButton>
      {can('companies.update') && <IconButton title={t('common.edit')} onClick={() => nav(`/admin/companies/${r.id}/edit`)}><Pencil /></IconButton>}
      {(r.is_active ? can('companies.deactivate') : can('companies.activate')) && <IconButton title={r.is_active ? t('common.disable') : t('common.enable')} tone={r.is_active ? 'amber' : 'green'} onClick={() => toggle(r)}>{r.is_active ? <PowerOff /> : <Power />}</IconButton>}
      {can('companies.delete') && !r.contracts && !r.riders && <IconButton title={t('common.delete')} tone="red" onClick={async () => { if (await remove(r.id)) list.reload(); }}><Trash2 /></IconButton>}</div> },
  ];
  return (
    <>
      <PageHeader title={t('co.title')} actions={<>
        <ExportButton path="/companies/export" query={list.query} label={t('common.export_csv')} />
        {can('companies.create') && <Link to="/admin/companies/new"><Button variant="primary" icon={<Plus className="size-4" />}>{t('co.new')}</Button></Link>}
      </>} />
      <StatGrid>
        <StatCard label={t('co.s.companies')} value={fmtNum(s.companies)} /><StatCard label={t('common.active')} value={fmtNum(s.active)} tone="green" />
        <StatCard label={t('common.disabled')} value={fmtNum(s.disabled)} tone={toneIf(s.disabled, 'amber')} /><StatCard label={t('co.contracts')} value={fmtNum(s.contracts)} />
        <StatCard label={t('co.s.riders')} value={fmtNum(s.riders)} />
      </StatGrid>
      <FilterBar list={list} placeholder={t('co.search_hint')}><FilterSelect list={list} name="status" label={t('co.status')} options={[{ value: 'active', label: t('common.active_only') }, { value: 'disabled', label: t('common.disabled_only') }]} /></FilterBar>
      <DataTable list={list} columns={columns} onRowClick={(r) => nav(`/admin/companies/${r.id}`)} />
    </>
  );
}
export function CompanyForm() {
  const { id } = useParams();
  const { t } = useI18n();
  const nav = useNavigate();
  const form = useForm<Record<string, any>>({ name: '', email: '', operator_id: '', is_active: true });
  const [loaded, setLoaded] = useState<any>(id ? null : {});
  useEffect(() => { if (id) get(`/companies/${id}`).then((c) => { setLoaded(c); form.reset({ name: c.name, email: c.email ?? '', operator_id: c.operator_id ?? '' }); }); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!loaded) return <Loading />;
  return (
    <form onSubmit={async (e) => { e.preventDefault(); const r = await form.submit(() => (id ? patch(`/companies/${id}`, form.changes) : post('/companies', form.values))); if (r) { invalidateOptions('/lookups'); nav(`/admin/companies/${id ?? r.id}`); } }}>
      <PageHeader title={id ? t('co.edit') : t('co.new')} back={id ? `/admin/companies/${id}` : '/admin/companies'} />
      <Card><Grid>
        <TextInput form={form} name="name" label={t('co.name')} required maxLength={100} hint={t('co.name_hint')} />
        <TextInput form={form} name="email" label={t('co.email')} type="email" dir="ltr" hint={t('co.email_hint')} />
        <TextInput form={form} name="operator_id" label={t('co.operator_id')} dir="ltr" maxLength={50} />
        {!id && <div className="flex items-end"><CheckInput form={form} name="is_active" label={t('common.active')} /></div>}
      </Grid></Card>
      <SaveBar form={form} editing={!!id} label={id ? t('common.save') : t('co.add')} onCancel={() => nav(-1)} />
    </form>
  );
}
export function CompanyView() {
  const { id } = useParams();
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const [c, setC] = useState<any>(null);
  const load = useCallback(() => get(`/companies/${id}`).then(setC), [id]);
  const { toggle, remove } = useToggle('companies', load);
  useEffect(() => { load(); }, [load]);
  if (!c) return <Loading />;
  const used = c.contracts || c.riders || c.performance;
  return (
    <>
      <PageHeader title={c.name} back="/admin/companies" subtitle={<Active on={!!c.is_active} />} actions={<>
        {(c.is_active ? can('companies.deactivate') : can('companies.activate')) && <Button variant="warn" onClick={() => toggle(c)}>{c.is_active ? t('common.disable') : t('common.enable')}</Button>}
        {can('companies.update') && <Link to={`/admin/companies/${id}/edit`}><Button icon={<Pencil className="size-4" />}>{t('common.edit')}</Button></Link>}</>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label={t('co.contracts')} value={fmtNum(c.contracts)} /><StatCard label={t('co.s.riders')} value={fmtNum(c.riders)} /><StatCard label={t('co.performance')} value={fmtNum(c.performance)} />
      </div>
      <Card title={t('co.what_points')}>
        <Details rows={[[t('co.status'), c.is_active ? t('common.active') : t('common.disabled')], [t('co.added'), fmtDateTime(c.created_at)], [t('co.email'), c.email], [t('co.operator_id'), c.operator_id]]} />
        {!c.email && <div className="mt-3"><Alert tone="amber">{t('co.no_email')}</Alert></div>}
      </Card>
      <Card title={t('co.contracts_under')} className="mt-4" actions={can('contracts.create') && !!c.is_active && <Link to={`/admin/contracts/new?company=${c.id}`}><Button size="sm" icon={<Plus className="size-3.5" />}>{t('ct.add')}</Button></Link>} pad={false}>
        <table className="w-full text-sm"><tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {c.contract_list.map((k: any) => <tr key={k.id}><td className="px-3 py-2">{can('contracts.view') ? <Link className="hover:text-brand" to={`/admin/contracts/${k.id}`}>{k.name}</Link> : k.name}</td><td className="px-3 py-2 text-zinc-500">{k.description}</td><td className="px-3 py-2"><Active on={!!k.is_active} /></td></tr>)}
          {!c.contract_list.length && <tr><td className="px-3 py-4 text-center text-zinc-500">{t('table.no_records')}</td></tr>}
        </tbody></table>
      </Card>
      {can('companies.delete') && <Card title={t('common.delete')} className="mt-4">
        {used ? <Alert tone="amber">{t('co.use_disable')}</Alert> : <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={async () => { if (await remove(c.id)) nav('/admin/companies'); }}>{t('common.delete')}</Button>}
      </Card>}
    </>
  );
}

// ======================================================================== contracts
export function ContractsList() {
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const list = useList('/contracts');
  const companies = useOptions<any>('/lookups/companies?all=1');
  const { toggle, remove } = useToggle('contracts', list.reload);
  const s = list.stats ?? {};
  const columns: Column<any>[] = [
    { key: 'name', header: t('ct.contract'), sort: 'name', render: (r) => <div><div className="font-medium">{r.name}</div>{r.description && <div className="text-xs text-zinc-500">{r.description}</div>}</div> },
    { key: 'company', header: t('ct.company'), sort: 'company', render: (r) => <div>{r.company_name}{!r.company_active && <div className="text-xs text-red-600">{t('ct.company_disabled')}</div>}</div> },
    { key: 'performance', header: t('ct.performance'), render: (r) => <span className="num">{fmtNum(r.performance)}</span> },
    { key: 'status', header: t('ct.status'), sort: 'status', render: (r) => <Active on={!!r.is_active} /> },
    { key: 'actions', header: t('common.actions'), render: (r) => <div className="flex">
      <IconButton title={t('common.view')} onClick={() => nav(`/admin/contracts/${r.id}`)}><Eye /></IconButton>
      {can('contracts.update') && <IconButton title={t('common.edit')} onClick={() => nav(`/admin/contracts/${r.id}/edit`)}><Pencil /></IconButton>}
      {(r.is_active ? can('contracts.deactivate') : can('contracts.activate')) && <IconButton title={r.is_active ? t('common.disable') : t('common.enable')} tone={r.is_active ? 'amber' : 'green'} onClick={() => toggle(r)}>{r.is_active ? <PowerOff /> : <Power />}</IconButton>}
      {can('contracts.delete') && !r.performance && <IconButton title={t('common.delete')} tone="red" onClick={async () => { if (await remove(r.id)) list.reload(); }}><Trash2 /></IconButton>}</div> },
  ];
  return (
    <>
      <PageHeader title={t('ct.title')} actions={<>
        <ExportButton path="/contracts/export" query={list.query} label={t('common.export_csv')} />
        {can('contracts.create') && <Link to={`/admin/contracts/new${list.query.company ? `?company=${list.query.company}` : ''}`}><Button variant="primary" icon={<Plus className="size-4" />} disabled={!companies.some((c: any) => c.is_active)}>{t('ct.new')}</Button></Link>}
      </>} />
      <StatGrid>
        <StatCard label={t('ct.s.contracts')} value={fmtNum(s.contracts)} /><StatCard label={t('common.active')} value={fmtNum(s.active)} tone="green" />
        <StatCard label={t('common.disabled')} value={fmtNum(s.disabled)} tone={toneIf(s.disabled, 'amber')} /><StatCard label={t('ct.s.companies')} value={fmtNum(s.companies)} />
        <StatCard label={t('ct.s.under_disabled')} value={fmtNum(s.under_disabled)} tone={toneIf(s.under_disabled, 'red')} />
      </StatGrid>
      <FilterBar list={list} placeholder={t('ct.search_hint')}>
        <FilterSelect list={list} name="company" label={t('ct.company')} options={companies.map((c: any) => ({ value: c.id, label: c.name }))} />
        <FilterSelect list={list} name="status" label={t('ct.status')} options={[{ value: 'active', label: t('common.active_only') }, { value: 'disabled', label: t('common.disabled_only') }]} />
      </FilterBar>
      <DataTable list={list} columns={columns} onRowClick={(r) => nav(`/admin/contracts/${r.id}`)} />
    </>
  );
}
export function ContractForm() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { t } = useI18n();
  const nav = useNavigate();
  const form = useForm<Record<string, any>>({ company_id: params.get('company') ?? '', name: '', description: '' });
  const companies = useOptions<any>(id ? '/lookups/companies?all=1' : '/lookups/companies');
  const [loaded, setLoaded] = useState<any>(id ? null : {});
  useEffect(() => { if (id) get(`/contracts/${id}`).then((k) => { setLoaded(k); form.reset({ company_id: k.company_id, name: k.name, description: k.description ?? '' }); }); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!loaded) return <Loading />;
  return (
    <form onSubmit={async (e) => { e.preventDefault(); const r = await form.submit(() => (id ? patch(`/contracts/${id}`, form.changes) : post('/contracts', form.values))); if (r) { invalidateOptions('/lookups'); nav(`/admin/contracts/${id ?? r.id}`); } }}>
      <PageHeader title={id ? t('ct.edit') : t('ct.new')} back={id ? `/admin/contracts/${id}` : '/admin/contracts'} />
      {id && form.changed.includes('company_id') && <div className="mb-4"><Alert tone="amber">{t('ct.move_warning')}</Alert></div>}
      <Card><Grid>
        <SelectInput form={form} name="company_id" label={t('ct.company')} required options={companies.map((c: any) => ({ value: c.id, label: c.is_active ? c.name : `${c.name} (${t('common.disabled')})` }))} />
        <TextInput form={form} name="name" label={t('ct.name')} required maxLength={255} hint={t('ct.name_hint')} />
        <TextArea form={form} name="description" label={t('ct.description')} maxLength={500} className="sm:col-span-2" />
      </Grid></Card>
      <SaveBar form={form} editing={!!id} label={id ? t('common.save') : t('ct.add_contract')} onCancel={() => nav(-1)} />
    </form>
  );
}
export function ContractView() {
  const { id } = useParams();
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const [k, setK] = useState<any>(null);
  const load = useCallback(() => get(`/contracts/${id}`).then(setK), [id]);
  const { toggle, remove } = useToggle('contracts', load);
  useEffect(() => { load(); }, [load]);
  if (!k) return <Loading />;
  return (
    <>
      <PageHeader title={k.name} back="/admin/contracts" subtitle={<Active on={!!k.is_active} />} actions={<>
        {(k.is_active ? can('contracts.deactivate') : can('contracts.activate')) && <Button variant="warn" onClick={() => toggle(k)}>{k.is_active ? t('common.disable') : t('common.enable')}</Button>}
        {can('contracts.update') && <Link to={`/admin/contracts/${id}/edit`}><Button icon={<Pencil className="size-4" />}>{t('common.edit')}</Button></Link>}</>} />
      {!k.company_active && <div className="mb-4"><Alert tone="amber">{t('ct.company_disabled')}</Alert></div>}
      <div className="mb-4 grid gap-3 sm:grid-cols-2"><StatCard label={t('ct.performance')} value={fmtNum(k.performance)} /><StatCard label={t('ct.status')} value={k.is_active ? t('common.active') : t('common.disabled')} /></div>
      <Card title={t('ct.details')}><Details rows={[[t('ct.company'), can('companies.view') ? <Link className="text-brand" to={`/admin/companies/${k.company_id}`}>{k.company_name}</Link> : k.company_name], [t('ct.contract'), k.name], [t('ct.description'), k.description], [t('ct.performance'), k.performance, true]]} /></Card>
      <div className="mt-4"><Attachments entityType="contract" entityId={k.id} title={t('ct.file_papers')} /></div>
      {can('contracts.delete') && <Card title={t('common.delete')} className="mt-4">
        {k.performance ? <Alert tone="amber">{t('ct.use_disable')}</Alert> : <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={async () => { if (await remove(k.id)) nav('/admin/contracts'); }}>{t('common.delete')}</Button>}
      </Card>}
    </>
  );
}
