import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Ban, Eye, FileUp, History, Pencil, Plus, RotateCw, Square, StopCircle, Trash2, Unlock } from 'lucide-react';
import { del, download, get, patch, post } from '../../api';
import { useAuth } from '../../auth';
import { fmtDateTime, fmtMoney, fmtNum, useI18n } from '../../i18n';
import { Alert, Badge, Button, Card, Checkbox, Details, Field, IconButton, Loading, PageHeader, StatCard, StatGrid, toneIf, useAction, useErrorText, useUi, type Tone } from '../../ui/kit';
import { ComboInput, Grid, SaveBar, SelectInput, TextArea, TextInput, useForm } from '../../ui/forms';
import { DataTable, FilterBar, FilterDate, FilterNumber, FilterSelect, useList, type Column } from '../../ui/table';
import { Attachments } from '../../ui/files';
import { ImportWizard } from '../../ui/importer';
import { ExpiryDate, ExportButton, invalidateOptions, Remaining, useOptions } from '../../ui/common';
import { useVehicleOptions } from './Cards';

const VALID3: Record<string, Tone> = { valid: 'green', expired: 'red', cancelled: 'grey' };
const st3 = (t: (k: string) => string, s: string) => <Badge tone={VALID3[s]}>{t(`reg.status.${s}`)}</Badge>;
function useRiderOptions() {
  const rs = useOptions<any>('/riders-options');
  return useMemo(() => rs.map((r: any) => ({ value: r.id, label: r.full_name, sub: `#${r.id}${r.company_name ? ` · ${r.company_name}` : ''}`, search: `${r.id} ${r.national_id ?? ''} ${r.phone ?? ''}` })), [rs]);
}
function DeleteCard({ title, q, path, back }: { title: string; q: string; path: string; back: string }) {
  const { confirm } = useUi();
  const run = useAction();
  const nav = useNavigate();
  return <Card title={title} className="mt-4"><Button variant="danger" icon={<Trash2 className="size-4" />} onClick={async () => {
    if (!(await confirm({ title: q }))) return;
    if (await run(() => del(path))) nav(back);
  }}>{title}</Button></Card>;
}
// A form page that loads a record for editing and saves only what changed.
function useRecordForm(empty: Record<string, any>, path: string | null) {
  const form = useForm<Record<string, any>>(empty);
  const [loaded, setLoaded] = useState<any>(path ? null : {});
  useEffect(() => { if (path) get(path).then((r) => { setLoaded(r); form.reset(Object.fromEntries(Object.keys(empty).map((k) => [k, r[k] ?? '']))); }); }, [path]); // eslint-disable-line react-hooks/exhaustive-deps
  return { form, loaded };
}

// ---------- generic bulk edit: tick a field to change it; unticked fields stay as they are ----------
export function BulkEdit({ title, back, endpoint, fields }: { title: string; back: string; endpoint: string; fields: { name: string; label: string; input: (v: string, set: (v: string) => void) => ReactNode; show?: (v: string) => string }[] }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { ids: number[]; labels: string[] } };
  const { confirm, toast } = useUi();
  const errText = useErrorText();
  const [on, setOn] = useState<Record<string, boolean>>({});
  const [v, setV] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  if (!loc.state?.ids?.length) return <Navigate to={back} replace />;
  const { ids, labels } = loc.state;
  const chosen = fields.filter((f) => on[f.name]);
  const apply = async () => {
    if (!chosen.length) { toast(t('riders.bulk_no_field'), 'amber'); return; }
    if (chosen.some((f) => v[f.name] === undefined || v[f.name] === '') && chosen.some((f) => f.name !== 'notes')) {
      const empty = chosen.filter((f) => f.name !== 'notes' && !v[f.name]);
      if (empty.length) { toast(t('riders.bulk_no_value'), 'red'); return; }
    }
    if (!(await confirm({ title: t('bulk.confirm', { n: ids.length }), tone: 'primary' }))) return;
    setBusy(true);
    try { await post(endpoint, { ids, changes: Object.fromEntries(chosen.map((f) => [f.name, v[f.name] ?? ''])) }); toast(t('bulk.done', { n: ids.length })); nav(back); }
    catch (e) { toast(errText(e), 'red'); }
    finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader title={title} back={back} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={t('bulk.selected', { n: ids.length })}><ul className="space-y-1 text-sm">{labels.slice(0, 12).map((l, i) => <li key={i}>{l}</li>)}</ul>{labels.length > 12 && <p className="mt-1 text-xs text-zinc-500">{t('riders.and_more', { n: labels.length - 12 })}</p>}</Card>
        <Card title={t('bulk.fields')}>
          <div className="space-y-4">{fields.map((f) => (
            <div key={f.name}>
              <Checkbox checked={!!on[f.name]} onChange={(x) => setOn({ ...on, [f.name]: x })} label={<span className="font-medium">{f.label}</span>} />
              <div className={on[f.name] ? 'mt-1' : 'pointer-events-none mt-1 opacity-50'}>{f.input(v[f.name] ?? '', (x) => setV({ ...v, [f.name]: x }))}</div>
              {!on[f.name] && <p className="text-xs text-zinc-500">{t('riders.left_unchanged')}</p>}
            </div>
          ))}</div>
        </Card>
        <Card title={t('riders.what_will_change')}>
          {chosen.length ? <ul className="space-y-1 text-sm">{chosen.map((f) => <li key={f.name}>{f.label}: <b>{f.show ? f.show(v[f.name] ?? '') : v[f.name] || '—'}</b></li>)}</ul> : <p className="text-sm text-zinc-500">{t('riders.bulk_no_field')}</p>}
          <Button variant="primary" className="mt-4 w-full" loading={busy} onClick={apply}>{t('bulk.apply')}</Button>
        </Card>
      </div>
    </>
  );
}

// ======================================================================== insurance companies
export function InsurersList() {
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const run = useAction();
  const { confirm } = useUi();
  const list = useList('/insurance/companies');
  const s = list.stats ?? {};
  const name = (r: any) => (lang === 'ar' || lang === 'ur' ? r.name_ar : r.name_en || r.name_ar);
  const remove = async (ids: (string | number)[]) => {
    if (!(await confirm({ title: t('ic.delete_q') }))) return;
    if (await run(() => (ids.length > 1 ? post('/insurance/companies/bulk-delete', { ids }) : del(`/insurance/companies/${ids[0]}`)), t('common.deleted'))) { list.setSelected(new Set()); list.reload(); }
  };
  const columns: Column<any>[] = [
    { key: 'name', header: t('ic.name'), sort: 'name', render: (r) => <span className="font-medium">{name(r)}</span> },
    { key: 'phone', header: t('ic.phone'), render: (r) => <span className="num">{r.phone ?? '—'}</span> },
    { key: 'policies', header: t('ic.policies'), render: (r) => <span className="num">{r.policies}</span> },
    { key: 'vehicles', header: t('ic.vehicles'), render: (r) => <span className="num">{r.vehicles}</span> },
    { key: 'status', header: t('ic.status'), sort: 'status', render: (r) => <Badge tone={r.is_active ? 'green' : 'grey'}>{r.is_active ? t('common.active') : t('common.inactive')}</Badge> },
    { key: 'actions', header: t('common.actions'), render: (r) => <div className="flex">
      {can('insurance_companies.update') && <IconButton title={t('common.edit')} onClick={() => nav(`/admin/insurance/companies/${r.id}/edit`)}><Pencil /></IconButton>}
      {can('insurance_companies.delete') && <IconButton title={t('common.delete')} tone="red" onClick={() => remove([r.id])}><Trash2 /></IconButton>}</div> },
  ];
  return (
    <>
      <PageHeader title={t('ic.title')} actions={<>
        <ExportButton path="/insurance/companies/export" query={list.query} />
        {can('insurance_companies.create') && <><Button size="sm" onClick={() => run(() => download('/insurance/companies/import/template'))}>{t('import.download_template')}</Button>
          <Link to="/admin/insurance/companies/import"><Button size="sm" icon={<FileUp className="size-3.5" />}>{t('import.import_file')}</Button></Link>
          <Link to="/admin/insurance/companies/new"><Button variant="primary" icon={<Plus className="size-4" />}>{t('ic.new')}</Button></Link></>}
      </>} />
      <StatGrid>
        <StatCard label={t('ic.s.companies')} value={fmtNum(s.companies)} /><StatCard label={t('common.active')} value={fmtNum(s.active)} tone="green" /><StatCard label={t('common.inactive')} value={fmtNum(s.inactive)} />
        <StatCard label={t('ic.s.with')} value={fmtNum(s.with_policies)} /><StatCard label={t('ic.s.without')} value={fmtNum(s.without_policies)} />
        <StatCard label={t('ic.s.policies')} value={fmtNum(s.policies)} /><StatCard label={t('ic.s.vehicles')} value={fmtNum(s.vehicles)} />
      </StatGrid>
      <FilterBar list={list} placeholder={t('ic.search_hint')}><FilterSelect list={list} name="status" label={t('ic.status')} options={[{ value: 'active', label: t('common.active') }, { value: 'inactive', label: t('common.inactive') }]} /></FilterBar>
      <DataTable list={list} columns={columns} onRowClick={(r) => nav(`/admin/insurance/companies/${r.id}`)} selectable={can('insurance_companies.delete')} bulk={<Button size="sm" variant="danger" onClick={() => remove([...list.selected])}>{t('common.delete_selected')}</Button>} />
    </>
  );
}
export function InsurerForm() {
  const { id } = useParams();
  const { t } = useI18n();
  const nav = useNavigate();
  const { form, loaded } = useRecordForm({ name_ar: '', name_en: '', phone: '', website: '', is_active: true }, id ? `/insurance/companies/${id}` : null);
  if (!loaded) return <Loading />;
  return (
    <form onSubmit={async (e) => { e.preventDefault(); const r = await form.submit(() => (id ? patch(`/insurance/companies/${id}`, form.changes) : post('/insurance/companies', form.values))); if (r) nav(`/admin/insurance/companies/${id ?? r.id}`); }}>
      <PageHeader title={id ? t('ic.edit') : t('ic.new')} back="/admin/insurance/companies" />
      <Card><Grid>
        <TextInput form={form} name="name_ar" label={t('ic.name_ar')} required maxLength={150} /><TextInput form={form} name="name_en" label={t('ic.name_en')} maxLength={150} />
        <TextInput form={form} name="phone" label={t('ic.phone')} dir="ltr" /><TextInput form={form} name="website" label={t('ic.website')} dir="ltr" />
      </Grid></Card>
      <SaveBar form={form} editing={!!id} onCancel={() => nav(-1)} />
    </form>
  );
}
export function InsurerView() {
  const { id } = useParams();
  const { t } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const { confirm } = useUi();
  const [c, setC] = useState<any>(null);
  const load = useCallback(() => get(`/insurance/companies/${id}`).then(setC), [id]);
  useEffect(() => { load(); }, [load]);
  if (!c) return <Loading />;
  const toggle = async () => {
    if (!(await confirm({ title: c.is_active ? t('ic.deactivate_q') : t('ic.activate_q'), tone: 'warn' }))) return;
    if (await run(() => post(`/insurance/companies/${id}/${c.is_active ? 'deactivate' : 'activate'}`), t('common.saved'))) load();
  };
  return (
    <>
      <PageHeader title={c.name_ar} subtitle={c.name_en} back="/admin/insurance/companies" actions={<>
        {(c.is_active ? can('insurance_companies.deactivate') : can('insurance_companies.activate')) && <Button variant="warn" onClick={toggle}>{c.is_active ? t('common.deactivate') : t('common.activate')}</Button>}
        {can('insurance_companies.update') && <Link to={`/admin/insurance/companies/${id}/edit`}><Button icon={<Pencil className="size-4" />}>{t('common.edit')}</Button></Link>}</>} />
      <Card title={t('ic.details')}><Details rows={[[t('ic.phone'), c.phone], [t('ic.website'), c.website], [t('ic.status'), c.is_active ? t('common.active') : t('common.inactive')], [t('ic.policies'), c.policies, true], [t('ic.vehicles'), c.vehicles, true]]} /></Card>
      <Card title={t('ic.company_policies')} className="mt-4" pad={false}>
        <table className="w-full text-sm"><tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{c.policy_list.map((p: any) => <tr key={p.id}><td className="px-3 py-2"><Link className="hover:text-brand num" to={`/admin/insurance/policies/${p.id}`}>{p.number}</Link></td><td className="px-3 py-2 num">{p.expiry_date}</td><td className="px-3 py-2">{st3(t, p.status)}</td></tr>)}</tbody></table>
      </Card>
      {can('insurance_companies.delete') && <DeleteCard title={t('ic.delete')} q={t('ic.delete_q')} path={`/insurance/companies/${id}`} back="/admin/insurance/companies" />}
    </>
  );
}

// ======================================================================== insurance policies
export function PoliciesList() {
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const run = useAction();
  const { confirm } = useUi();
  const list = useList('/insurance/policies');
  const insurers = useOptions<any>('/insurance/companies/options');
  const s = list.stats ?? {};
  const insurer = (r: any) => (lang === 'ar' || lang === 'ur' ? r.company_ar ?? r.name_ar : (r.company_en ?? r.name_en) || (r.company_ar ?? r.name_ar));
  const remove = async (ids: (string | number)[]) => {
    if (!(await confirm({ title: t('pol.delete_q') }))) return;
    if (await run(() => (ids.length > 1 ? post('/insurance/policies/bulk-delete', { ids }) : del(`/insurance/policies/${ids[0]}`)), t('common.deleted'))) { list.setSelected(new Set()); list.reload(); }
  };
  const columns: Column<any>[] = [
    { key: 'number', header: t('pol.number'), sort: 'number', render: (r) => <span className="font-medium num">{r.number}</span> },
    { key: 'insurer', header: t('pol.insurer'), sort: 'company', render: insurer },
    { key: 'type', header: t('pol.type'), render: (r) => t(`pol.type.${r.type}`) },
    { key: 'expiry', header: t('pol.expiry_date'), sort: 'expiry', render: (r) => <ExpiryDate date={r.expiry_date} days={r.days_left} /> },
    { key: 'status', header: t('pol.status'), sort: 'status', render: (r) => st3(t, r.status) },
    { key: 'vehicles', header: t('pol.vehicles'), render: (r) => <span className="num">{r.vehicles}</span> },
    { key: 'actions', header: t('common.actions'), render: (r) => <div className="flex">
      {can('insurance_policies.renew') && <IconButton title={t('pol.quick_renew')} onClick={async () => { if (!(await confirm({ title: t('pol.quick_renew_q'), tone: 'primary' }))) return; if (await run(() => post(`/insurance/policies/${r.id}/renew`, { quick: true }), t('common.saved'))) list.reload(); }}><RotateCw /></IconButton>}
      {can('insurance_policies.update') && <IconButton title={t('common.edit')} onClick={() => nav(`/admin/insurance/policies/${r.id}/edit`)}><Pencil /></IconButton>}
      {can('insurance_policies.delete') && <IconButton title={t('common.delete')} tone="red" onClick={() => remove([r.id])}><Trash2 /></IconButton>}</div> },
  ];
  return (
    <>
      <PageHeader title={t('pol.title')} actions={<>
        {can('insurance_policies.export') && <ExportButton path="/insurance/policies/export" query={list.query} />}
        {can('insurance_policies.create') && <><Button size="sm" onClick={() => run(() => download('/insurance/policies/import/template'))}>{t('import.download_template')}</Button>
          <Link to="/admin/insurance/policies/import"><Button size="sm" icon={<FileUp className="size-3.5" />}>{t('import.import_file')}</Button></Link>
          <Link to="/admin/insurance/policies/new"><Button variant="primary" icon={<Plus className="size-4" />}>{t('pol.new')}</Button></Link></>}
      </>} />
      <StatGrid>
        <StatCard label={t('pol.s.policies')} value={fmtNum(s.policies)} /><StatCard label={t('reg.status.valid')} value={fmtNum(s.valid)} tone="green" />
        <StatCard label={t('reg.status.expired')} value={fmtNum(s.expired)} tone={toneIf(s.expired, 'red')} /><StatCard label={t('reg.status.cancelled')} value={fmtNum(s.cancelled)} />
        <StatCard label={t('pol.s.within30')} value={fmtNum(s.within30)} tone={toneIf(s.within30, 'amber')} /><StatCard label={t('pol.s.valid_past')} value={fmtNum(s.valid_past)} tone={toneIf(s.valid_past, 'red')} />
        <StatCard label={t('pol.s.vehicles')} value={fmtNum(s.vehicles)} />
      </StatGrid>
      <FilterBar list={list} placeholder={t('pol.search_hint')}>
        <FilterSelect list={list} name="company" label={t('pol.insurer')} options={insurers.map((c: any) => ({ value: c.id, label: insurer(c) }))} />
        <FilterSelect list={list} name="type" label={t('pol.type')} options={['third_party', 'comprehensive'].map((v) => ({ value: v, label: t(`pol.type.${v}`) }))} />
        <FilterSelect list={list} name="status" label={t('pol.status')} options={Object.keys(VALID3).map((v) => ({ value: v, label: t(`reg.status.${v}`) }))} />
        <FilterSelect list={list} name="expiry" label={t('pol.expiry')} options={[['expired', 'docs.state.expired'], ['within30', 'tl.within30'], ['beyond30', 'tl.beyond30']].map(([v, k]) => ({ value: v, label: t(k) }))} />
      </FilterBar>
      <DataTable list={list} columns={columns} onRowClick={(r) => nav(`/admin/insurance/policies/${r.id}`)} selectable={can('insurance_policies.delete')} bulk={<Button size="sm" variant="danger" onClick={() => remove([...list.selected])}>{t('common.delete_selected')}</Button>} />
    </>
  );
}
export function PolicyForm() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const insurers = useOptions<any>('/insurance/companies/options');
  const { form, loaded } = useRecordForm({ number: '', company_id: '', type: 'third_party', issue_date: '', start_date: '', expiry_date: '', status: 'valid', notes: '' }, id ? `/insurance/policies/${id}` : null);
  if (!loaded) return <Loading />;
  return (
    <form onSubmit={async (e) => { e.preventDefault(); const r = await form.submit(() => (id ? patch(`/insurance/policies/${id}`, form.changes) : post('/insurance/policies', form.values))); if (r) nav(`/admin/insurance/policies/${id ?? r.id}`); }}>
      <PageHeader title={id ? t('pol.edit') : t('pol.new')} back="/admin/insurance/policies" />
      <Card><Grid cols={3}>
        <TextInput form={form} name="number" label={t('pol.number')} required dir="ltr" maxLength={50} />
        <SelectInput form={form} name="company_id" label={t('pol.insurer')} required options={insurers.filter((c: any) => c.is_active || String(c.id) === String(form.values.company_id)).map((c: any) => ({ value: c.id, label: lang === 'ar' ? c.name_ar : c.name_en || c.name_ar }))} />
        <SelectInput form={form} name="type" label={t('pol.type')} empty={false} options={['third_party', 'comprehensive'].map((v) => ({ value: v, label: t(`pol.type.${v}`) }))} />
        <TextInput form={form} name="issue_date" label={t('pol.issue_date')} type="date" /><TextInput form={form} name="start_date" label={t('pol.start_date')} type="date" />
        <TextInput form={form} name="expiry_date" label={t('pol.expiry_date')} type="date" required />
        <SelectInput form={form} name="status" label={t('pol.status')} empty={false} options={Object.keys(VALID3).map((v) => ({ value: v, label: t(`reg.status.${v}`) }))} />
        <TextArea form={form} name="notes" label={t('common.notes')} className="sm:col-span-2" />
      </Grid></Card>
      <SaveBar form={form} editing={!!id} onCancel={() => nav(-1)} />
    </form>
  );
}
export function PolicyView() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const { confirm } = useUi();
  const [p, setP] = useState<any>(null);
  const [exp, setExp] = useState('');
  const load = useCallback(() => get(`/insurance/policies/${id}`).then(setP), [id]);
  useEffect(() => { load(); }, [load]);
  if (!p) return <Loading />;
  const company = lang === 'ar' ? p.company_ar : p.company_en || p.company_ar;
  return (
    <>
      <PageHeader title={<span className="num">{p.number}</span>} back="/admin/insurance/policies" subtitle={<span className="flex items-center gap-2">{can('insurance_companies.view') ? <Link className="text-brand" to={`/admin/insurance/companies/${p.company_id}`}>{company}</Link> : company} · {t(`pol.type.${p.type}`)} {st3(t, p.status)}</span>}
        actions={can('insurance_policies.update') && <Link to={`/admin/insurance/policies/${id}/edit`}><Button icon={<Pencil className="size-4" />}>{t('common.edit')}</Button></Link>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2"><StatCard label={t('pol.expiry_date')} value={p.expiry_date} sub={<Remaining days={p.days_left} />} /><StatCard label={t('pol.vehicles')} value={fmtNum(p.vehicles)} /></div>
      <Card title={t('pol.details')}><Details rows={[[t('pol.issue_date'), p.issue_date], [t('pol.start_date'), p.start_date], [t('pol.expiry_date'), p.expiry_date], [t('common.notes'), p.notes]]} /></Card>
      {can('insurance_policies.renew') && (
        <Card title={t('pol.renew')} className="mt-4">
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t('renew.new_expiry')} required><input type="date" className="input" value={exp} onChange={(e) => setExp(e.target.value)} /></Field>
            <Button variant="primary" disabled={!exp} onClick={async () => { if (!(await confirm({ title: t('pol.renew_q'), tone: 'primary' }))) return; if (await run(() => post(`/insurance/policies/${id}/renew`, { new_expiry: exp }), t('common.saved'))) { setExp(''); load(); } }}>{t('pol.renew')}</Button>
          </div>
          <p className="mt-2 text-xs text-zinc-500">{t('pol.renew_note')}</p>
        </Card>
      )}
      <Card title={t('pol.covered')} className="mt-4" pad={false}>
        <table className="w-full text-sm"><tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{p.covers.map((c: any) => <tr key={c.id}><td className="px-3 py-2"><Link className="hover:text-brand" to={`/admin/insurance/vehicles/${c.id}`}>{c.plate}</Link></td><td className="px-3 py-2 num">{c.expiry_date}</td><td className="px-3 py-2">{st3(t, c.status)}</td></tr>)}</tbody></table>
      </Card>
      {can('insurance_policies.delete') && <DeleteCard title={t('pol.delete')} q={t('pol.delete_q')} path={`/insurance/policies/${id}`} back="/admin/insurance/policies" />}
    </>
  );
}

// ======================================================================== vehicle insurance
export function CoversList() {
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const run = useAction();
  const { confirm } = useUi();
  const list = useList('/insurance/vehicles');
  const vehicles = useVehicleOptions();
  const policies = useOptions<any>('/insurance/policies/options');
  const insurers = useOptions<any>('/insurance/companies/options');
  const s = list.stats ?? {};
  const within = Number(list.query.within) || 30;
  const remove = async (ids: (string | number)[]) => {
    if (!(await confirm({ title: t('vi.delete_q') }))) return;
    if (await run(() => (ids.length > 1 ? post('/insurance/vehicles/bulk-delete', { ids }) : del(`/insurance/vehicles/${ids[0]}`)), t('common.deleted'))) { list.setSelected(new Set()); list.reload(); }
  };
  const columns: Column<any>[] = [
    { key: 'plate', header: t('vi.plate'), sort: 'plate', render: (r) => <div><div className="font-medium">{r.plate}</div><div className="text-xs text-zinc-500">{[r.maker, r.model].filter(Boolean).join(' ')}</div></div> },
    { key: 'policy', header: t('vi.policy'), sort: 'policy', render: (r) => <div><span className="num">{r.policy_number}</span><div className="text-xs text-zinc-500">{lang === 'ar' ? r.company_ar : r.company_en || r.company_ar}</div></div> },
    { key: 'sub', header: t('vi.sub_policy'), render: (r) => <span className="num">{r.sub_policy ?? '—'}</span> },
    { key: 'expiry', header: t('vi.expiry_date'), sort: 'remaining', render: (r) => <ExpiryDate date={r.expiry_date} days={r.days_left} window={within} /> },
    { key: 'status', header: t('vi.status'), sort: 'status', render: (r) => st3(t, r.status) },
    { key: 'current', header: t('vi.current'), render: (r) => (r.is_current ? <Badge tone="green">✓</Badge> : '—') },
  ];
  return (
    <>
      <PageHeader title={t('vi.title')} actions={<>
        {can('vehicle_insurance.export') && <ExportButton path="/insurance/vehicles/export" query={list.query} />}
        {can('vehicle_insurance.create') && <><Button size="sm" onClick={() => run(() => download('/insurance/vehicles/import/template'))}>{t('import.download_template')}</Button>
          <Link to="/admin/insurance/vehicles/import"><Button size="sm" icon={<FileUp className="size-3.5" />}>{t('import.import_file')}</Button></Link>
          <Link to="/admin/insurance/vehicles/new"><Button variant="primary" icon={<Plus className="size-4" />}>{t('vi.add')}</Button></Link></>}
      </>} />
      <StatGrid>
        <StatCard label={t('common.total')} value={fmtNum(s.total)} /><StatCard label={t('reg.status.valid')} value={fmtNum(s.valid)} tone="green" />
        <StatCard label={t('regs.expiring_soon')} value={fmtNum(s.soon)} tone={toneIf(s.soon, 'amber')} /><StatCard label={t('reg.status.expired')} value={fmtNum(s.expired)} tone={toneIf(s.expired, 'red')} />
        <StatCard label={t('reg.status.cancelled')} value={fmtNum(s.cancelled)} /><StatCard label={t('vi.current')} value={fmtNum(s.current)} />
      </StatGrid>
      <FilterBar list={list} placeholder={t('vi.search_hint')}>
        <FilterSelect list={list} name="vehicle" label={t('vi.plate')} options={vehicles.map((v) => ({ value: v.value, label: v.label }))} />
        <FilterSelect list={list} name="policy" label={t('vi.policy')} options={policies.map((p: any) => ({ value: p.id, label: p.number }))} />
        <FilterSelect list={list} name="company" label={t('pol.insurer')} options={insurers.map((c: any) => ({ value: c.id, label: lang === 'ar' ? c.name_ar : c.name_en || c.name_ar }))} />
        <FilterSelect list={list} name="status" label={t('vi.status')} options={Object.keys(VALID3).map((v) => ({ value: v, label: t(`reg.status.${v}`) }))} />
        <FilterSelect list={list} name="expiry" label={t('vi.expiry')} options={[['expired', 'docs.state.expired'], ['soon', 'regs.expiring_soon'], ['valid', 'docs.state.valid']].map(([v, k]) => ({ value: v, label: t(k) }))} />
        <FilterSelect list={list} name="current" label={t('vi.current')} options={[{ value: 'current', label: t('vi.current_only') }, { value: 'not', label: t('vi.not_current') }]} />
        <FilterNumber list={list} name="within" label={t('regs.within')} />
      </FilterBar>
      <DataTable list={list} columns={columns} onRowClick={(r) => nav(`/admin/insurance/vehicles/${r.id}`)} selectable={can('vehicle_insurance.update') || can('vehicle_insurance.delete')}
        bulk={<>
          {can('vehicle_insurance.update') && <Button size="sm" onClick={() => nav('/admin/insurance/vehicles/bulk-edit', { state: { ids: [...list.selected], labels: list.rows.filter((r: any) => list.selected.has(r.id)).map((r: any) => `${r.plate} · ${r.policy_number}`) } })}>{t('common.edit_selected')}</Button>}
          {can('vehicle_insurance.delete') && <Button size="sm" variant="danger" onClick={() => remove([...list.selected])}>{t('common.delete_selected')}</Button>}
        </>} />
    </>
  );
}
export function CoverForm() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { t } = useI18n();
  const nav = useNavigate();
  const vehicles = useVehicleOptions();
  const policies = useOptions<any>('/insurance/policies/options');
  const { form, loaded } = useRecordForm({ vehicle_id: params.get('vehicle') ?? '', policy_id: '', sub_policy: '', start_date: '', expiry_date: '', status: 'valid', is_current: true, notes: '' }, id ? `/insurance/vehicles/${id}` : null);
  if (!loaded) return <Loading />;
  return (
    <form onSubmit={async (e) => { e.preventDefault(); const r = await form.submit(() => (id ? patch(`/insurance/vehicles/${id}`, form.changes) : post('/insurance/vehicles', form.values))); if (r) nav(`/admin/insurance/vehicles/${id ?? r.id}`); }}>
      <PageHeader title={id ? t('vi.edit') : t('vi.add')} back="/admin/insurance/vehicles" />
      <Card><Grid cols={3}>
        <ComboInput form={form} name="vehicle_id" label={t('vi.plate')} required options={vehicles} />
        <SelectInput form={form} name="policy_id" label={t('vi.policy')} required options={policies.map((p: any) => ({ value: p.id, label: `${p.number} · ${p.company_ar}` }))} />
        <TextInput form={form} name="sub_policy" label={t('vi.sub_policy')} dir="ltr" maxLength={50} />
        <TextInput form={form} name="start_date" label={t('vi.start')} type="date" /><TextInput form={form} name="expiry_date" label={t('vi.expiry_date')} type="date" required />
        <SelectInput form={form} name="status" label={t('vi.status')} empty={false} options={Object.keys(VALID3).map((v) => ({ value: v, label: t(`reg.status.${v}`) }))} />
        <div className="flex items-end"><Checkbox checked={!!form.values.is_current && form.values.is_current !== '0'} onChange={(v) => form.set('is_current', v)} label={t('vi.current')} /></div>
        <TextArea form={form} name="notes" label={t('common.notes')} className="sm:col-span-2" />
      </Grid></Card>
      <SaveBar form={form} editing={!!id} label={id ? t('common.save') : t('vi.add')} onCancel={() => nav(-1)} />
    </form>
  );
}
export function CoverView() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const { confirm } = useUi();
  const [c, setC] = useState<any>(null);
  const renew = useForm<Record<string, any>>({ new_expiry: '', new_start: '', new_number: '', operation: 'renewal', cost: '', reference: '' });
  const load = useCallback(() => get(`/insurance/vehicles/${id}`).then(setC), [id]);
  useEffect(() => { load(); }, [load]);
  if (!c) return <Loading />;
  return (
    <>
      <PageHeader title={<Link to={`/admin/vehicles/${c.vehicle_id}`} className="hover:text-brand">{c.plate}</Link>} back="/admin/insurance/vehicles" subtitle={st3(t, c.status)}
        actions={can('vehicle_insurance.update') && <Link to={`/admin/insurance/vehicles/${id}/edit`}><Button icon={<Pencil className="size-4" />}>{t('common.edit')}</Button></Link>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label={t('vi.expiry_date')} value={c.expiry_date} sub={<Remaining days={c.days_left} />} />
        <StatCard label={t('vi.current')} value={c.is_current ? t('common.yes') : t('common.no')} />
        <StatCard label={t('pol.insurer')} value={lang === 'ar' ? c.company_ar : c.company_en || c.company_ar} />
      </div>
      <Card title={t('vi.details')}><Details rows={[[t('vi.policy'), <Link className="text-brand num" to={`/admin/insurance/policies/${c.policy_id}`}>{c.policy_number}</Link>], [t('vi.sub_policy'), c.sub_policy], [t('vi.start'), c.start_date], [t('vi.expiry_date'), c.expiry_date], [t('common.notes'), c.notes]]} /></Card>
      {can('vehicle_insurance.renew') && (
        <Card title={t('vi.renew')} className="mt-4">
          <form onSubmit={async (e) => { e.preventDefault(); if (!(await confirm({ title: t('vi.renew_q'), tone: 'primary' }))) return; if (await renew.submit(() => post(`/insurance/vehicles/${id}/renew`, renew.values))) { renew.reset(renew.values); load(); } }}>
            <Grid cols={3}>
              <TextInput form={renew} name="new_expiry" label={t('renew.new_expiry')} type="date" required /><TextInput form={renew} name="new_start" label={t('vi.new_start')} type="date" />
              <TextInput form={renew} name="new_number" label={t('vi.new_sub_policy')} dir="ltr" />
              <SelectInput form={renew} name="operation" label={t('renew.type')} empty={false} options={['renewal', 'replacement', 'reissue', 'correction'].map((v) => ({ value: v, label: t(`renew.op.${v}`) }))} />
              <TextInput form={renew} name="cost" label={t('renew.cost')} dir="ltr" /><TextInput form={renew} name="reference" label={t('renew.reference')} dir="ltr" />
            </Grid>
            <Button type="submit" variant="primary" className="mt-3" loading={renew.busy} icon={<RotateCw className="size-4" />}>{t('renew.renew')}</Button>
          </form>
        </Card>
      )}
      <div className="mt-4"><Attachments entityType="vehicle_insurance" entityId={c.id} title={t('vi.certificate')} /></div>
      {can('vehicle_insurance.delete') && <DeleteCard title={t('vi.delete')} q={t('vi.delete_q')} path={`/insurance/vehicles/${id}`} back="/admin/insurance/vehicles" />}
    </>
  );
}
export function CoversBulk() {
  const { t } = useI18n();
  const sel = (opts: [string, string][]) => (v: string, set: (v: string) => void) => <select className="input" value={v} onChange={(e) => set(e.target.value)}><option value="">{t('common.choose')}</option>{opts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>;
  return <BulkEdit title={t('vi.bulk_title')} back="/admin/insurance/vehicles" endpoint="/insurance/vehicles/bulk-edit" fields={[
    { name: 'status', label: t('vi.status'), input: sel(Object.keys(VALID3).map((k) => [k, t(`reg.status.${k}`)])), show: (v) => (v ? t(`reg.status.${v}`) : '—') },
    { name: 'is_current', label: t('vi.current'), input: sel([['1', t('common.yes')], ['0', t('common.no')]]), show: (v) => (v === '1' ? t('common.yes') : t('common.no')) },
    { name: 'notes', label: t('common.notes'), input: (v, set) => <textarea className="input" value={v} onChange={(e) => set(e.target.value)} /> },
  ]} />;
}

// ======================================================================== vehicle assignments
export function AssignmentsList() {
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const run = useAction();
  const { confirm } = useUi();
  const list = useList('/vehicle-assignments');
  const riders = useRiderOptions();
  const vehicles = useVehicleOptions();
  const s = list.stats ?? {};
  const end = async (r: any) => { if (!(await confirm({ title: t('va.end_q'), tone: 'warn' }))) return; if (await run(() => post(`/vehicle-assignments/${r.id}/end`), t('common.saved'))) list.reload(); };
  const remove = async (ids: (string | number)[]) => { if (!(await confirm({ title: t('va.delete_q'), body: t('va.delete_note') }))) return; if (await run(() => (ids.length > 1 ? post('/vehicle-assignments/bulk-delete', { ids }) : del(`/vehicle-assignments/${ids[0]}`)), t('common.deleted'))) { list.setSelected(new Set()); list.reload(); } };
  const columns: Column<any>[] = [
    { key: 'rider', header: t('va.rider'), sort: 'rider', render: (r) => <div><Link to={`/admin/riders/${r.rider_id}`} className="hover:text-brand">{r.full_name}</Link><div className="text-xs text-zinc-500 num">#{r.rider_id}</div></div> },
    { key: 'vehicle', header: t('va.vehicle'), sort: 'vehicle', render: (r) => <div>{r.plate}<div className="text-xs text-zinc-500">{[r.maker, r.model].filter(Boolean).join(' ')}</div></div> },
    { key: 'start', header: t('va.start'), sort: 'start', render: (r) => <span className="num">{r.start_date}</span> },
    { key: 'end', header: t('va.end'), sort: 'end', render: (r) => <span className="num">{r.end_date ?? '—'}</span> },
    { key: 'duration', header: t('va.duration'), sort: 'duration', render: (r) => <span className="num">{t('va.days', { n: fmtNum(r.duration) })}</span> },
    { key: 'state', header: t('va.state'), sort: 'state', render: (r) => <Badge tone={r.is_current ? 'green' : 'grey'}>{r.is_current ? t('va.current') : t('va.ended')}</Badge> },
    { key: 'actions', header: t('common.actions'), render: (r) => <div className="flex">
      {r.is_current && can('vehicle_assignments.update') && <IconButton title={t('va.end')} tone="amber" onClick={() => end(r)}><StopCircle /></IconButton>}
      {can('vehicle_assignments.update') && <IconButton title={t('va.edit')} onClick={() => nav(`/admin/vehicle-assignments/${r.id}/edit`)}><Pencil /></IconButton>}
      {can('vehicle_assignments.delete') && <IconButton title={t('va.delete')} tone="red" onClick={() => remove([r.id])}><Trash2 /></IconButton>}</div> },
  ];
  return (
    <>
      <PageHeader title={t('va.title')} actions={<>
        {can('vehicle_assignments.export') && <ExportButton path="/vehicle-assignments/export" query={list.query} />}
        {can('vehicle_assignments.create') && <><Button size="sm" onClick={() => run(() => download('/vehicle-assignments/import/template'))}>{t('import.download_template')}</Button>
          <Link to="/admin/vehicle-assignments/import"><Button size="sm" icon={<FileUp className="size-3.5" />}>{t('import.import_file')}</Button></Link>
          <Link to="/admin/vehicle-assignments/new"><Button variant="primary" icon={<Plus className="size-4" />}>{t('va.new')}</Button></Link></>}
      </>} />
      <StatGrid>
        <StatCard label={t('va.s.assignments')} value={fmtNum(s.total)} /><StatCard label={t('va.current')} value={fmtNum(s.current)} tone="green" /><StatCard label={t('va.ended')} value={fmtNum(s.ended)} />
        <StatCard label={t('va.s.riders_without')} value={fmtNum(s.riders_without)} tone={toneIf(s.riders_without, 'amber')} /><StatCard label={t('va.s.vehicles_without')} value={fmtNum(s.vehicles_without)} tone={toneIf(s.vehicles_without, 'amber')} />
      </StatGrid>
      <FilterBar list={list} placeholder={t('va.search_hint')}>
        <FilterSelect list={list} name="rider" label={t('va.rider')} options={riders.map((r) => ({ value: r.value, label: r.label }))} />
        <FilterSelect list={list} name="vehicle" label={t('va.vehicle')} options={vehicles.map((v) => ({ value: v.value, label: v.label }))} />
        <FilterSelect list={list} name="state" label={t('va.state')} options={[{ value: 'current', label: t('va.current') }, { value: 'ended', label: t('va.ended') }]} />
        <FilterDate list={list} name="from" label={t('common.from_date')} /><FilterDate list={list} name="to" label={t('common.to_date')} />
      </FilterBar>
      <DataTable list={list} columns={columns} onRowClick={(r) => nav(`/admin/vehicle-assignments/${r.id}`)} selectable={can('vehicle_assignments.delete')} bulk={<Button size="sm" variant="danger" onClick={() => remove([...list.selected])}>{t('common.delete_selected')}</Button>} />
    </>
  );
}
export function AssignmentForm() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { t } = useI18n();
  const nav = useNavigate();
  const { toast } = useUi();
  const riders = useRiderOptions();
  const vehicles = useVehicleOptions();
  const today = new Date().toISOString().slice(0, 10);
  const { form, loaded } = useRecordForm({ rider_id: params.get('rider') ?? '', vehicle_id: '', start_date: today, end_date: '', is_current: '1' }, id ? `/vehicle-assignments/${id}` : null);
  if (!loaded) return <Loading />;
  const current = form.values.is_current === '1' || form.values.is_current === 1 || form.values.is_current === true;
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      const body = id ? { ...form.changes, is_current: current ? 1 : 0 } : { ...form.values, is_current: current ? 1 : 0 };
      const r = await form.submit(() => (id ? patch(`/vehicle-assignments/${id}`, body) : post('/vehicle-assignments', body)));
      if (!r) return;
      for (const w of r.warnings ?? []) toast(t('va.overlap', { id: w.id }), 'amber');
      invalidateOptions('/vehicles'); invalidateOptions('/riders');
      nav(`/admin/vehicle-assignments/${id ?? r.id}`);
    }}>
      <PageHeader title={id ? t('va.edit') : t('va.new')} back="/admin/vehicle-assignments" />
      <Card><Grid>
        <ComboInput form={form} name="rider_id" label={t('va.rider')} required options={riders} />
        <ComboInput form={form} name="vehicle_id" label={t('va.vehicle')} required options={vehicles} />
        <TextInput form={form} name="start_date" label={t('va.start')} type="date" required />
        <SelectInput form={form} name="is_current" label={t('va.state')} empty={false} options={[{ value: '1', label: t('va.current') }, { value: '0', label: t('va.ended') }]} />
        <TextInput form={form} name="end_date" label={t('va.end')} type="date" disabled={current} />
      </Grid></Card>
      <SaveBar form={form} editing={!!id} label={id ? t('common.save') : t('va.new')} onCancel={() => nav(-1)} />
    </form>
  );
}
export function AssignmentView() {
  const { id } = useParams();
  const { t } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const { confirm } = useUi();
  const [a, setA] = useState<any>(null);
  const load = useCallback(() => get(`/vehicle-assignments/${id}`).then(setA), [id]);
  useEffect(() => { load(); }, [load]);
  if (!a) return <Loading />;
  return (
    <>
      <PageHeader title={`${a.full_name} · ${a.plate}`} back="/admin/vehicle-assignments" subtitle={<Badge tone={a.is_current ? 'green' : 'grey'}>{a.is_current ? t('va.current') : t('va.ended')}</Badge>}
        actions={can('vehicle_assignments.update') && <Link to={`/admin/vehicle-assignments/${id}/edit`}><Button icon={<Pencil className="size-4" />}>{t('common.edit')}</Button></Link>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label={t('va.duration')} value={t('va.days', { n: fmtNum(a.duration) })} /><StatCard label={t('va.start')} value={a.start_date} /><StatCard label={t('va.end')} value={a.end_date ?? t('va.still_running')} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('va.rider')} actions={<Link to={`/admin/riders/${a.rider_id}`}><Button size="sm">{t('va.open_rider')}</Button></Link>}><Details rows={[[t('common.name'), a.full_name], [t('riders.rider_id'), a.rider_id], [t('riders.phone'), a.phone]]} /></Card>
        <Card title={t('va.vehicle')} actions={<Link to={`/admin/vehicles/${a.vehicle_id}`}><Button size="sm">{t('va.open_vehicle')}</Button></Link>}><Details rows={[[t('vehicles.plate'), a.plate], [t('vehicles.make_model'), [a.maker, a.model].filter(Boolean).join(' ')]]} /></Card>
      </div>
      {a.is_current && can('vehicle_assignments.update') && <Card title={t('va.end')} className="mt-4"><Button variant="warn" icon={<Square className="size-4" />} onClick={async () => { if (!(await confirm({ title: t('va.end_q'), tone: 'warn' }))) return; if (await run(() => post(`/vehicle-assignments/${id}/end`), t('common.saved'))) load(); }}>{t('va.end')}</Button></Card>}
      {can('vehicle_assignments.delete') && <DeleteCard title={t('va.delete')} q={t('va.delete_q')} path={`/vehicle-assignments/${id}`} back="/admin/vehicle-assignments" />}
    </>
  );
}

// ======================================================================== fuel cards
const FC_STATUS: Record<string, Tone> = { active: 'green', blocked: 'red', expired: 'grey' };
export function FuelCardsList() {
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const run = useAction();
  const { confirm } = useUi();
  const list = useList('/fuel-cards');
  const riders = useRiderOptions();
  const vehicles = useVehicleOptions();
  const s = list.stats ?? {};
  const block = async (r: any) => {
    const blocking = r.status !== 'blocked';
    if (!(await confirm({ title: blocking ? t('fc.block_q') : t('fc.unblock_q'), tone: 'warn' }))) return;
    if (await run(() => post(`/fuel-cards/${r.id}/${blocking ? 'block' : 'unblock'}`), t('common.saved'))) list.reload();
  };
  const remove = async (ids: (string | number)[]) => { if (!(await confirm({ title: t('fc.delete_q') }))) return; if (await run(() => (ids.length > 1 ? post('/fuel-cards/bulk-delete', { ids }) : del(`/fuel-cards/${ids[0]}`)), t('common.deleted'))) { list.setSelected(new Set()); list.reload(); } };
  const columns: Column<any>[] = [
    { key: 'number', header: t('fc.number'), sort: 'number', render: (r) => <div><span className="font-medium num">{r.number}</span><div className="text-xs text-zinc-500">{r.provider}</div></div> },
    { key: 'rider', header: t('fc.rider'), sort: 'rider', render: (r) => r.full_name ?? <span className="text-zinc-500">{t('fc.no_rider')}</span> },
    { key: 'vehicle', header: t('fc.vehicle'), render: (r) => r.plate ?? <span className="text-zinc-500">{t('fc.no_vehicle')}</span> },
    { key: 'balance', header: t('fc.balance'), sort: 'balance', render: (r) => <span className="num">{fmtMoney(r.balance)}</span> },
    { key: 'limit', header: t('fc.monthly_limit'), sort: 'limit', render: (r) => (r.monthly_limit == null ? <span className="text-zinc-500">{t('fc.no_limit')}</span> : <span className="num">{fmtMoney(r.monthly_limit)}</span>) },
    { key: 'status', header: t('fc.status'), sort: 'status', render: (r) => <Badge tone={FC_STATUS[r.status]}>{t(`fc.status.${r.status}`)}</Badge> },
    { key: 'issued', header: t('fc.issued'), sort: 'issued', render: (r) => <span className="num">{r.issue_date ?? '—'}</span> },
    { key: 'actions', header: t('common.actions'), render: (r) => <div className="flex">
      {(r.status === 'blocked' ? can('fuel_cards.activate') : can('fuel_cards.deactivate')) && <IconButton title={r.status === 'blocked' ? t('fc.unblock') : t('fc.block')} tone={r.status === 'blocked' ? 'green' : 'red'} onClick={() => block(r)}>{r.status === 'blocked' ? <Unlock /> : <Ban />}</IconButton>}
      {can('fuel_cards.update') && <IconButton title={t('fc.edit')} onClick={() => nav(`/admin/fuel-cards/${r.id}/edit`)}><Pencil /></IconButton>}
      {can('fuel_cards.delete') && <IconButton title={t('fc.delete')} tone="red" onClick={() => remove([r.id])}><Trash2 /></IconButton>}</div> },
  ];
  return (
    <>
      <PageHeader title={t('fc.title')} actions={<>
        {can('fuel_cards.export') && <ExportButton path="/fuel-cards/export" query={list.query} />}
        {can('fuel_cards.create') && <><Button size="sm" onClick={() => run(() => download('/fuel-cards/import/template'))}>{t('import.download_template')}</Button>
          <Link to="/admin/fuel-cards/import"><Button size="sm" icon={<FileUp className="size-3.5" />}>{t('import.import_file')}</Button></Link>
          <Link to="/admin/fuel-cards/new"><Button variant="primary" icon={<Plus className="size-4" />}>{t('fc.add')}</Button></Link></>}
      </>} />
      <StatGrid>
        <StatCard label={t('fc.s.cards')} value={fmtNum(s.cards)} /><StatCard label={t('fc.status.active')} value={fmtNum(s.active)} tone="green" />
        <StatCard label={t('fc.status.blocked')} value={fmtNum(s.blocked)} tone={toneIf(s.blocked, 'red')} /><StatCard label={t('fc.status.expired')} value={fmtNum(s.expired)} />
        <StatCard label={t('fc.s.unassigned')} value={fmtNum(s.unassigned)} tone={toneIf(s.unassigned, 'amber')} /><StatCard label={t('fc.s.balance')} value={fmtMoney(s.balance)} />
        <StatCard label={t('fc.s.limit')} value={fmtMoney(s.monthly_limit)} />
      </StatGrid>
      <FilterBar list={list} placeholder={t('fc.search_hint')}>
        <FilterSelect list={list} name="status" label={t('fc.status')} options={Object.keys(FC_STATUS).map((v) => ({ value: v, label: t(`fc.status.${v}`) }))} />
        <FilterSelect list={list} name="provider" label={t('fc.provider')} options={(list.data?.providers ?? []).map((p: string) => ({ value: p, label: p }))} />
        <FilterSelect list={list} name="rider" label={t('fc.rider')} options={riders.map((r) => ({ value: r.value, label: r.label }))} />
        <FilterSelect list={list} name="vehicle" label={t('fc.vehicle')} options={vehicles.map((v) => ({ value: v.value, label: v.label }))} />
        <FilterSelect list={list} name="assignment" label={t('fc.assignment')} options={[{ value: 'assigned', label: t('fc.assigned') }, { value: 'unassigned', label: t('fc.unassigned') }]} />
        <FilterDate list={list} name="from" label={t('fc.issued_from')} /><FilterDate list={list} name="to" label={t('fc.issued_to')} />
      </FilterBar>
      <DataTable list={list} columns={columns} onRowClick={(r) => nav(`/admin/fuel-cards/${r.id}`)} selectable={can('fuel_cards.update') || can('fuel_cards.delete')}
        bulk={<>
          {can('fuel_cards.update') && <Button size="sm" onClick={() => nav('/admin/fuel-cards/bulk-edit', { state: { ids: [...list.selected], labels: list.rows.filter((r: any) => list.selected.has(r.id)).map((r: any) => r.number) } })}>{t('common.edit_selected')}</Button>}
          {can('fuel_cards.delete') && <Button size="sm" variant="danger" onClick={() => remove([...list.selected])}>{t('common.delete_selected')}</Button>}
        </>} />
    </>
  );
}
export function FuelCardForm() {
  const { id } = useParams();
  const { t } = useI18n();
  const nav = useNavigate();
  const riders = useRiderOptions();
  const vehicles = useVehicleOptions();
  const { form, loaded } = useRecordForm({ number: '', provider: '', status: 'active', issue_date: '', balance: '', monthly_limit: '', rider_id: '', vehicle_id: '' }, id ? `/fuel-cards/${id}` : null);
  const [vehicleTouched, setVehicleTouched] = useState(false);
  if (!loaded) return <Loading />;
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      const body: any = id ? { ...form.changes } : { ...form.values };
      // Without a chosen vehicle the card follows the rider's current vehicle.
      if (!vehicleTouched && !('vehicle_id' in (id ? form.changes : {}))) delete body.vehicle_id;
      const r = await form.submit(() => (id ? patch(`/fuel-cards/${id}`, body) : post('/fuel-cards', body)));
      if (r) nav(`/admin/fuel-cards/${id ?? r.id}`);
    }}>
      <PageHeader title={id ? t('fc.edit') : t('fc.add')} back="/admin/fuel-cards" />
      <Card><Grid cols={3}>
        <TextInput form={form} name="number" label={t('fc.number')} required dir="ltr" maxLength={50} />
        <TextInput form={form} name="provider" label={t('fc.provider')} maxLength={100} />
        <SelectInput form={form} name="status" label={t('fc.status')} empty={false} options={Object.keys(FC_STATUS).map((v) => ({ value: v, label: t(`fc.status.${v}`) }))} />
        <TextInput form={form} name="issue_date" label={t('fc.issued')} type="date" />
        <TextInput form={form} name="balance" label={t('fc.balance')} required dir="ltr" hint={t('fc.balance_hint')} />
        <TextInput form={form} name="monthly_limit" label={t('fc.monthly_limit')} dir="ltr" hint={t('fc.limit_hint')} />
        <ComboInput form={form} name="rider_id" label={t('fc.rider')} options={riders} hint={t('fc.rider_hint')} />
        <div onFocusCapture={() => setVehicleTouched(true)}><ComboInput form={form} name="vehicle_id" label={t('fc.vehicle')} options={vehicles} /></div>
      </Grid></Card>
      <SaveBar form={form} editing={!!id} label={id ? t('common.save') : t('fc.add')} onCancel={() => nav(-1)} />
    </form>
  );
}
export function FuelCardView() {
  const { id } = useParams();
  const { t } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const { confirm } = useUi();
  const [c, setC] = useState<any>(null);
  const load = useCallback(() => get(`/fuel-cards/${id}`).then(setC), [id]);
  useEffect(() => { load(); }, [load]);
  if (!c) return <Loading />;
  const blocking = c.status !== 'blocked';
  return (
    <>
      <PageHeader title={<span className="num">{c.number}</span>} back="/admin/fuel-cards" subtitle={<Badge tone={FC_STATUS[c.status]}>{t(`fc.status.${c.status}`)}</Badge>} actions={<>
        {(blocking ? can('fuel_cards.deactivate') : can('fuel_cards.activate')) && <Button variant="warn" onClick={async () => { if (!(await confirm({ title: blocking ? t('fc.block_q') : t('fc.unblock_q'), tone: 'warn' }))) return; if (await run(() => post(`/fuel-cards/${id}/${blocking ? 'block' : 'unblock'}`))) load(); }}>{blocking ? t('fc.block') : t('fc.unblock')}</Button>}
        {can('fuel_cards.update') && <Link to={`/admin/fuel-cards/${id}/edit`}><Button icon={<Pencil className="size-4" />}>{t('common.edit')}</Button></Link>}</>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label={t('fc.balance')} value={fmtMoney(c.balance)} tone={c.balance < 0 ? 'red' : 'none'} />
        <StatCard label={t('fc.monthly_limit')} value={c.monthly_limit == null ? t('fc.no_limit') : fmtMoney(c.monthly_limit)} />
        <StatCard label={t('fc.rider')} value={c.full_name ?? t('fc.no_rider')} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={t('fc.card_details')}><Details cols={1} rows={[[t('fc.number'), c.number], [t('fc.provider'), c.provider], [t('fc.issued'), c.issue_date], [t('fc.status'), t(`fc.status.${c.status}`)]]} /></Card>
        <Card title={t('fc.assignment')}><Details cols={1} rows={[[t('fc.rider'), c.rider_id ? <Link className="text-brand" to={`/admin/riders/${c.rider_id}`}>{c.full_name}</Link> : t('fc.no_rider'), true], [t('fc.vehicle'), c.vehicle_id ? <Link className="text-brand" to={`/admin/vehicles/${c.vehicle_id}`}>{c.plate}</Link> : t('fc.no_vehicle'), true]]} /></Card>
        <Card title={t('fc.money')}><Details cols={1} rows={[[t('fc.balance'), fmtMoney(c.balance)], [t('fc.monthly_limit'), c.monthly_limit == null ? t('fc.no_limit') : fmtMoney(c.monthly_limit), true]]} /></Card>
      </div>
      {can('fuel_cards.delete') && <DeleteCard title={t('fc.delete')} q={t('fc.delete_q')} path={`/fuel-cards/${id}`} back="/admin/fuel-cards" />}
    </>
  );
}
export function FuelCardsBulk() {
  const { t } = useI18n();
  const riders = useRiderOptions();
  const input = (type = 'text') => (v: string, set: (v: string) => void) => <input className="input" type={type} value={v} onChange={(e) => set(e.target.value)} />;
  return <BulkEdit title={t('fc.bulk_title')} back="/admin/fuel-cards" endpoint="/fuel-cards/bulk-edit" fields={[
    { name: 'status', label: t('fc.status'), input: (v, set) => <select className="input" value={v} onChange={(e) => set(e.target.value)}><option value="">{t('common.choose')}</option>{Object.keys(FC_STATUS).map((k) => <option key={k} value={k}>{t(`fc.status.${k}`)}</option>)}</select>, show: (v) => (v ? t(`fc.status.${v}`) : '—') },
    { name: 'provider', label: t('fc.provider'), input: input() },
    { name: 'monthly_limit', label: t('fc.monthly_limit'), input: input('number') },
    { name: 'rider_id', label: t('fc.rider'), input: (v, set) => <select className="input" value={v} onChange={(e) => set(e.target.value)}><option value="">{t('common.choose')}</option>{riders.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select>, show: (v) => riders.find((r) => String(r.value) === v)?.label ?? '—' },
    { name: 'plate', label: t('fc.vehicle_plate'), input: input() },
  ]} />;
}

// ======================================================================== oil changes
const OIL_STATE: Record<string, Tone> = { overdue: 'red', due_soon: 'amber', on_schedule: 'green' };
function OilState({ r }: { r: any }) {
  const { t } = useI18n();
  return <div className="flex flex-wrap gap-1"><Badge tone={OIL_STATE[r.state]}>{t(`oil.state.${r.state}`)}</Badge>{!!r.never_changed && <Badge tone="amber">{t('oil.never')}</Badge>}</div>;
}
export function OilSchedule() {
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const run = useAction();
  const { confirm } = useUi();
  const list = useList('/oil-changes');
  const vehicles = useVehicleOptions();
  const s = list.stats ?? {};
  const remove = async (ids: (string | number)[]) => { if (!(await confirm({ title: t('oil.delete_schedule_q'), body: t('oil.delete_schedule_note') }))) return; if (await run(() => (ids.length > 1 ? post('/oil-changes/bulk-delete', { ids }) : del(`/oil-changes/${ids[0]}`)), t('common.deleted'))) { list.setSelected(new Set()); list.reload(); } };
  const columns: Column<any>[] = [
    { key: 'vehicle', header: t('oil.vehicle'), sort: 'vehicle', render: (r) => <div><div className="font-medium">{r.plate}</div><div className="text-xs text-zinc-500">{[r.maker, r.model].filter(Boolean).join(' ')}</div></div> },
    { key: 'interval', header: t('oil.interval'), sort: 'interval', render: (r) => <span className="num">{t('va.days', { n: r.interval_days })}</span> },
    { key: 'last', header: t('oil.last_change'), sort: 'last', render: (r) => <span className="num">{r.last_change}</span> },
    { key: 'next', header: t('oil.next_due'), sort: 'next', render: (r) => <span className="num">{r.next_due}</span> },
    { key: 'days', header: t('oil.days_left'), sort: 'days', render: (r) => <Remaining days={r.days_left} window={r.warn_days} /> },
    { key: 'state', header: t('oil.state'), render: (r) => <OilState r={r} /> },
    { key: 'actions', header: t('common.actions'), render: (r) => <div className="flex">
      {can('oil_changes.update') && <IconButton title={t('common.edit')} onClick={() => nav(`/admin/oil-changes/${r.id}/edit`)}><Pencil /></IconButton>}
      {can('oil_changes.delete') && <IconButton title={t('common.delete')} tone="red" onClick={() => remove([r.id])}><Trash2 /></IconButton>}</div> },
  ];
  return (
    <>
      <PageHeader title={t('oil.schedule')} actions={<>
        <Link to="/admin/oil-changes/history"><Button size="sm" icon={<History className="size-3.5" />}>{t('oil.history_btn')}</Button></Link>
        {can('oil_changes.export') && <ExportButton path="/oil-changes/export" query={list.query} />}
        {can('oil_changes.create') && <><Button size="sm" onClick={() => run(() => download('/oil-changes/import/template'))}>{t('import.download_template')}</Button>
          <Link to="/admin/oil-changes/import"><Button size="sm" icon={<FileUp className="size-3.5" />}>{t('import.import_file')}</Button></Link>
          <Link to="/admin/oil-changes/new"><Button variant="primary" icon={<Plus className="size-4" />}>{t('oil.new_schedule')}</Button></Link></>}
      </>} />
      <StatGrid>
        <StatCard label={t('oil.s.vehicles')} value={fmtNum(s.vehicles)} />
        <StatCard label={t('oil.state.overdue')} value={fmtNum(s.overdue)} tone={toneIf(s.overdue, 'red')} onClick={() => list.set('state', list.query.state === 'overdue' ? null : 'overdue')} active={list.query.state === 'overdue'} />
        <StatCard label={t('oil.state.due_soon')} value={fmtNum(s.due_soon)} tone={toneIf(s.due_soon, 'amber')} onClick={() => list.set('state', list.query.state === 'due_soon' ? null : 'due_soon')} active={list.query.state === 'due_soon'} />
        <StatCard label={t('oil.state.on_schedule')} value={fmtNum(s.on_schedule)} tone="green" />
        <StatCard label={t('oil.never')} value={fmtNum(s.never)} tone={toneIf(s.never, 'amber')} onClick={() => list.set('state', list.query.state === 'never' ? null : 'never')} active={list.query.state === 'never'} />
      </StatGrid>
      <FilterBar list={list} placeholder={t('oil.search_hint')}>
        <FilterSelect list={list} name="state" label={t('oil.state')} options={['overdue', 'due_soon', 'on_schedule', 'never'].map((v) => ({ value: v, label: v === 'never' ? t('oil.never') : t(`oil.state.${v}`) }))} />
        <FilterSelect list={list} name="vehicle" label={t('oil.vehicle')} options={vehicles.map((v) => ({ value: v.value, label: v.label }))} />
        <FilterSelect list={list} name="within" label={t('oil.due_within')} options={[['0', 'oil.today'], ['7', 'oil.within7'], ['15', 'oil.within15'], ['30', 'oil.within30']].map(([v, k]) => ({ value: v, label: t(k) }))} />
      </FilterBar>
      <DataTable list={list} columns={columns} onRowClick={(r) => nav(`/admin/oil-changes/${r.id}`)} selectable={can('oil_changes.update') || can('oil_changes.delete')}
        bulk={<>
          {can('oil_changes.update') && <Button size="sm" onClick={() => nav('/admin/oil-changes/bulk-edit', { state: { ids: [...list.selected], labels: list.rows.filter((r: any) => list.selected.has(r.id)).map((r: any) => r.plate) } })}>{t('common.edit_selected')}</Button>}
          {can('oil_changes.delete') && <Button size="sm" variant="danger" onClick={() => remove([...list.selected])}>{t('common.delete_selected')}</Button>}
        </>} />
    </>
  );
}
export function OilScheduleForm() {
  const { id } = useParams();
  const { t } = useI18n();
  const nav = useNavigate();
  const all = useOptions<any>('/vehicles/options');
  const { form, loaded } = useRecordForm({ vehicle_id: '', interval_days: '', warn_days: '7', last_change: '' }, id ? `/oil-changes/${id}` : null);
  if (!loaded) return <Loading />;
  const free = all.filter((v: any) => !v.has_schedule);
  return (
    <form onSubmit={async (e) => { e.preventDefault(); const r = await form.submit(() => (id ? patch(`/oil-changes/${id}`, form.changes) : post('/oil-changes', form.values))); if (r) { invalidateOptions('/vehicles'); nav(`/admin/oil-changes/${id ?? r.id}`); } }}>
      <PageHeader title={id ? t('oil.edit_schedule') : t('oil.new_schedule')} back="/admin/oil-changes" />
      {!id && !free.length && all.length > 0 && <div className="mb-4"><Alert tone="amber">{t('oil.all_scheduled')}</Alert></div>}
      <Card><Grid cols={4}>
        {id ? <Field label={t('oil.vehicle')}><input className="input" disabled value={loaded.plate} /></Field>
          : <ComboInput form={form} name="vehicle_id" label={t('oil.vehicle')} required options={free.map((v: any) => ({ value: v.id, label: v.plate, sub: [v.maker, v.model].filter(Boolean).join(' ') }))} />}
        <TextInput form={form} name="interval_days" label={t('oil.interval_days')} required dir="ltr" />
        <TextInput form={form} name="warn_days" label={t('oil.warn_days')} dir="ltr" />
        <TextInput form={form} name="last_change" label={t('oil.last_change')} type="date" required />
      </Grid><p className="mt-3 text-xs text-zinc-500">{t('oil.next_due_note')}</p></Card>
      <SaveBar form={form} editing={!!id} onCancel={() => nav(-1)} />
    </form>
  );
}
export function OilScheduleView() {
  const { id } = useParams();
  const { t } = useI18n();
  const { can } = useAuth();
  const [s, setS] = useState<any>(null);
  useEffect(() => { get(`/oil-changes/${id}`).then(setS); }, [id]);
  if (!s) return <Loading />;
  return (
    <>
      <PageHeader title={s.plate} back="/admin/oil-changes" subtitle={<span className="flex items-center gap-2">{[s.maker, s.model].filter(Boolean).join(' ')} · <span className="num">{fmtNum(s.odometer)} km</span><OilState r={s} /></span>}
        actions={<>{can('oil_changes.create') && <Link to={`/admin/oil-changes/history/new?vehicle=${s.vehicle_id}`}><Button variant="primary">{t('oil.record')}</Button></Link>}
          {can('oil_changes.update') && <Link to={`/admin/oil-changes/${id}/edit`}><Button icon={<Pencil className="size-4" />}>{t('common.edit')}</Button></Link>}</>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <StatCard label={t('oil.days_left')} value={fmtNum(s.days_left)} tone={OIL_STATE[s.state]} /><StatCard label={t('oil.next_due')} value={s.next_due} />
        <StatCard label={t('oil.last_change')} value={s.last_change} /><StatCard label={t('oil.changes')} value={fmtNum(s.changes)} />
      </div>
      <Card title={t('oil.schedule_card')}><Details rows={[[t('oil.interval_days'), s.interval_days], [t('oil.warn_days'), s.warn_days]]} /></Card>
      <Card title={t('oil.recent')} className="mt-4" pad={false}>
        <table className="w-full text-sm"><tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{s.recent.map((h: any) => <tr key={h.id}><td className="px-3 py-2"><Link className="hover:text-brand num" to={`/admin/oil-changes/history/${h.id}`}>{h.change_date}</Link></td><td className="px-3 py-2 num">{h.odometer ?? '—'}</td><td className="px-3 py-2">{h.performed_by ?? '—'}</td><td className="px-3 py-2 num">{h.cost != null ? fmtMoney(h.cost) : '—'}</td></tr>)}</tbody></table>
      </Card>
      {can('oil_changes.delete') && <DeleteCard title={t('oil.delete_schedule')} q={t('oil.delete_schedule_q')} path={`/oil-changes/${id}`} back="/admin/oil-changes" />}
    </>
  );
}
export function OilBulk() {
  const { t } = useI18n();
  const num = (v: string, set: (v: string) => void) => <input className="input" type="number" value={v} onChange={(e) => set(e.target.value)} />;
  return <BulkEdit title={t('oil.bulk_title')} back="/admin/oil-changes" endpoint="/oil-changes/bulk-edit" fields={[{ name: 'interval_days', label: t('oil.interval_days'), input: num }, { name: 'warn_days', label: t('oil.warn_days'), input: num }]} />;
}
export function OilHistory() {
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const run = useAction();
  const { confirm } = useUi();
  const list = useList('/oil-changes/history');
  const vehicles = useVehicleOptions();
  const s = list.stats ?? {};
  const remove = async (ids: (string | number)[]) => { if (!(await confirm({ title: t('oil.delete_record_q') }))) return; if (await run(() => (ids.length > 1 ? post('/oil-changes/history/bulk-delete', { ids }) : del(`/oil-changes/history/${ids[0]}`)), t('common.deleted'))) { list.setSelected(new Set()); list.reload(); } };
  const columns: Column<any>[] = [
    { key: 'vehicle', header: t('oil.vehicle'), sort: 'vehicle', render: (r) => <div>{r.plate}<div className="text-xs text-zinc-500">{[r.maker, r.model].filter(Boolean).join(' ')}</div></div> },
    { key: 'date', header: t('oil.change_date'), sort: 'date', render: (r) => <span className="num">{r.change_date}</span> },
    { key: 'odometer', header: t('oil.odometer'), sort: 'odometer', render: (r) => <span className="num">{r.odometer != null ? fmtNum(r.odometer) : '—'}</span> },
    { key: 'by', header: t('oil.performed_by'), render: (r) => r.performed_by ?? '—' },
    { key: 'cost', header: t('oil.cost'), sort: 'cost', render: (r) => <span className="num">{r.cost != null ? fmtMoney(r.cost) : '—'}</span> },
    { key: 'actions', header: t('common.actions'), render: (r) => <div className="flex">
      {can('oil_changes.update') && <IconButton title={t('common.edit')} onClick={() => nav(`/admin/oil-changes/history/${r.id}/edit`)}><Pencil /></IconButton>}
      {can('oil_changes.delete') && <IconButton title={t('common.delete')} tone="red" onClick={() => remove([r.id])}><Trash2 /></IconButton>}</div> },
  ];
  return (
    <>
      <PageHeader title={t('oil.history')} actions={<>
        <Link to="/admin/oil-changes"><Button size="sm">{t('oil.schedule_btn')}</Button></Link>
        {can('oil_changes.export') && <ExportButton path="/oil-changes/history/export" query={list.query} />}
        {can('oil_changes.create') && <><Button size="sm" onClick={() => run(() => download('/oil-changes/history/import/template'))}>{t('import.download_template')}</Button>
          <Link to="/admin/oil-changes/history/import"><Button size="sm" icon={<FileUp className="size-3.5" />}>{t('import.import_file')}</Button></Link>
          <Link to="/admin/oil-changes/history/new"><Button variant="primary" icon={<Plus className="size-4" />}>{t('oil.record')}</Button></Link></>}
      </>} />
      <StatGrid><StatCard label={t('oil.s.records')} value={fmtNum(s.records)} /><StatCard label={t('oil.s.covered')} value={fmtNum(s.vehicles)} /><StatCard label={t('oil.s.cost')} value={fmtMoney(s.cost)} /></StatGrid>
      <FilterBar list={list} placeholder={t('oil.history_search')}>
        <FilterSelect list={list} name="vehicle" label={t('oil.vehicle')} options={vehicles.map((v) => ({ value: v.value, label: v.label }))} />
        <FilterSelect list={list} name="performed_by" label={t('oil.performed_by')} options={(list.data?.performers ?? []).map((p: string) => ({ value: p, label: p }))} />
        <FilterDate list={list} name="from" label={t('common.from')} /><FilterDate list={list} name="to" label={t('common.to')} />
      </FilterBar>
      <DataTable list={list} columns={columns} onRowClick={(r) => nav(`/admin/oil-changes/history/${r.id}`)} selectable={can('oil_changes.delete')} bulk={<Button size="sm" variant="danger" onClick={() => remove([...list.selected])}>{t('common.delete_selected')}</Button>} />
    </>
  );
}
// Record a change for several vehicles that entered the workshop on the same date.
export function OilRecord() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const vs = useOptions<any>('/vehicles/options');
  const form = useForm<Record<string, any>>({ change_date: new Date().toISOString().slice(0, 10), performed_by: '', cost: '', notes: '' });
  const [picked, setPicked] = useState<Record<string, string>>(params.get('vehicle') ? { [params.get('vehicle')!]: '' } : {});
  const [filter, setFilter] = useState('');
  const [result, setResult] = useState<any>(null);
  const shown = vs.filter((v: any) => `${v.plate} ${v.maker ?? ''}`.toLowerCase().includes(filter.toLowerCase()));
  if (result) return (
    <>
      <PageHeader title={t('oil.record')} back="/admin/oil-changes/history" />
      <Card title={t('oil.recorded')} pad={false}><table className="w-full text-sm"><tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{result.recorded.map((r: any) => <tr key={r.id}><td className="px-3 py-2">{r.plate}</td><td className="px-3 py-2">{t('oil.next_due')}: <span className="num">{r.next_due ?? t('oil.no_schedule')}</span></td></tr>)}</tbody></table></Card>
      {result.rejected.length > 0 && <Card title={t('oil.not_recorded')} className="mt-4"><ul className="space-y-1 text-sm">{result.rejected.map((r: any) => <li key={r.vehicle_id}>{vs.find((v: any) => v.id === r.vehicle_id)?.plate ?? r.vehicle_id}: {t(`oil.reject.${r.reason}`)} {r.existing_id && <Link className="text-brand" to={`/admin/oil-changes/history/${r.existing_id}`}>#{r.existing_id}</Link>}</li>)}</ul></Card>}
      <div className="mt-4 flex gap-2"><Link to="/admin/oil-changes/history"><Button variant="primary">{t('oil.history')}</Button></Link><Button onClick={() => { setResult(null); setPicked({}); }}>{t('oil.record_another')}</Button></div>
    </>
  );
  return (
    <form onSubmit={async (e) => { e.preventDefault(); const r = await form.submit(() => post('/oil-changes/history', { ...form.values, vehicles: Object.entries(picked).map(([vehicle_id, odometer]) => ({ vehicle_id, odometer })) })); if (r) { invalidateOptions('/vehicles'); setResult(r); } }}>
      <PageHeader title={t('oil.record')} back="/admin/oil-changes/history" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={t('oil.serviced_vehicles')} className="lg:col-span-2" actions={<Button type="button" size="sm" onClick={() => setPicked({ ...picked, ...Object.fromEntries(shown.map((v: any) => [v.id, picked[v.id] ?? ''])) })}>{t('oil.select_shown')}</Button>}>
          <input className="input mb-3" placeholder={t('oil.search_vehicle')} value={filter} onChange={(e) => setFilter(e.target.value)} />
          {form.errors.vehicles && <p className="mb-2 text-xs text-red-600">{t('oil.pick_one')}</p>}
          <div className="max-h-96 space-y-1 overflow-y-auto">
            {shown.map((v: any) => (
              <div key={v.id} className="flex items-center gap-3 rounded-lg px-2 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-800">
                <Checkbox checked={v.id in picked || String(v.id) in picked} onChange={(on) => { const n = { ...picked }; if (on) n[v.id] = ''; else { delete n[v.id]; delete n[String(v.id)]; } setPicked(n); }} label={<span>{v.plate} <span className="text-xs text-zinc-500">{[v.maker, v.model].filter(Boolean).join(' ')}</span></span>} />
                {(v.id in picked || String(v.id) in picked) && <input className="input ms-auto w-36 py-1" dir="ltr" placeholder={t('oil.odometer')} value={picked[v.id] ?? ''} onChange={(e) => setPicked({ ...picked, [v.id]: e.target.value })} />}
              </div>
            ))}
          </div>
        </Card>
        <Card title={t('oil.change')}>
          <div className="space-y-3">
            <TextInput form={form} name="change_date" label={t('oil.change_date')} type="date" required />
            <TextInput form={form} name="performed_by" label={t('oil.performed_by')} maxLength={150} />
            <TextInput form={form} name="cost" label={t('oil.cost')} dir="ltr" />
            <TextArea form={form} name="notes" label={t('common.notes')} maxLength={300} />
            <p className="text-xs text-zinc-500">{t('oil.applies_to_all')}</p>
          </div>
        </Card>
      </div>
      <SaveBar form={form} editing={false} label={t('oil.record_n', { n: Object.keys(picked).length })} />
    </form>
  );
}
export function OilChangeEdit() {
  const { id } = useParams();
  const { t } = useI18n();
  const nav = useNavigate();
  const { form, loaded } = useRecordForm({ change_date: '', odometer: '', performed_by: '', cost: '', notes: '' }, `/oil-changes/history/${id}`);
  if (!loaded) return <Loading />;
  return (
    <form onSubmit={async (e) => { e.preventDefault(); if (await form.submit(() => patch(`/oil-changes/history/${id}`, form.changes))) nav(`/admin/oil-changes/history/${id}`); }}>
      <PageHeader title={`${t('oil.edit_record')} · ${loaded.plate}`} back={`/admin/oil-changes/history/${id}`} />
      <Card><Grid cols={3}>
        <TextInput form={form} name="change_date" label={t('oil.change_date')} type="date" required /><TextInput form={form} name="odometer" label={t('oil.odometer')} dir="ltr" />
        <TextInput form={form} name="performed_by" label={t('oil.performed_by')} /><TextInput form={form} name="cost" label={t('oil.cost')} dir="ltr" />
        <TextArea form={form} name="notes" label={t('common.notes')} className="sm:col-span-2" />
      </Grid></Card>
      <SaveBar form={form} onCancel={() => nav(-1)} />
    </form>
  );
}
export function OilChangeView() {
  const { id } = useParams();
  const { t } = useI18n();
  const { can } = useAuth();
  const [h, setH] = useState<any>(null);
  useEffect(() => { get(`/oil-changes/history/${id}`).then(setH); }, [id]);
  if (!h) return <Loading />;
  return (
    <>
      <PageHeader title={`${h.plate} · ${h.change_date}`} back="/admin/oil-changes/history" actions={can('oil_changes.update') && <Link to={`/admin/oil-changes/history/${id}/edit`}><Button icon={<Pencil className="size-4" />}>{t('common.edit')}</Button></Link>} />
      <Card title={t('oil.record_details')}><Details rows={[[t('oil.vehicle'), <Link className="text-brand" to={`/admin/vehicles/${h.vehicle_id}`}>{h.plate}</Link>], [t('oil.change_date'), h.change_date], [t('oil.odometer'), h.odometer],
        [t('oil.performed_by'), h.performed_by], [t('oil.cost'), h.cost != null && fmtMoney(h.cost)], [t('common.notes'), h.notes], [t('oil.recorded_at'), fmtDateTime(h.created_at)]]} />
        <Link to="/admin/oil-changes" className="mt-3 inline-block text-sm text-brand">{t('oil.schedule_btn')}</Link></Card>
      {can('oil_changes.delete') && <DeleteCard title={t('oil.delete_record')} q={t('oil.delete_record_q')} path={`/oil-changes/history/${id}`} back="/admin/oil-changes/history" />}
    </>
  );
}

// ---------- import screens of this chapter ----------
export function FleetImport({ base, back, title, matchLabel, extra }: { base: string; back: string; title: string; matchLabel?: string; extra?: Record<string, string> }) {
  const { t } = useI18n();
  return <><PageHeader title={title} back={back} /><ImportWizard base={base} back={back} extraLabels={extra} modeLabels={matchLabel ? { question: matchLabel, skip: t('import.skip'), replace: t('import.replace') } : undefined} /></>;
}
