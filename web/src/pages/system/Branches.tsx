// Settings → Branches and Job titles (phase 2): the company's own lists, counted against its plan.
// Both pages share one table and one side panel; the server keeps the rules (main branch, built-in titles, in use).
import { useState } from 'react';
import { Pencil, Plus, Power, PowerOff, Star, Trash2 } from 'lucide-react';
import { del, patch, post } from '../../api';
import { useAuth } from '../../auth';
import { fmtNum, useI18n } from '../../i18n';
import { Badge, Button, IconButton, PageHeader, SidePanel, useAction, useUi } from '../../ui/kit';
import { Grid, SelectInput, TextArea, TextInput, useForm } from '../../ui/forms';
import { DataTable, FilterBar, FilterSelect, useList, type Column } from '../../ui/table';
import { ExportButton, invalidateOptions, localName, useOptions } from '../../ui/common';
import { PlanCounter, forgetPlanUsage } from '../../ui/plan';

type Kind = 'branches' | 'designations';
const EMPTY = { name_ar: '', name_en: '', city_id: '', notes: '' };

function OrgList({ kind }: { kind: Kind }) {
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const run = useAction();
  const { confirm } = useUi();
  const list = useList(`/${kind}`);
  const cities = useOptions<any>(kind === 'branches' ? '/lookups/cities' : null);
  const [edit, setEdit] = useState<any | null>(null);
  const form = useForm<Record<string, any>>(EMPTY);
  const isBranch = kind === 'branches';
  // the lists, pickers and plan counters elsewhere read these again
  const changed = () => { invalidateOptions(`/lookups/${kind}`); forgetPlanUsage(); list.reload(); };

  const open = (r?: any) => { form.reset(r ? { name_ar: r.name_ar, name_en: r.name_en ?? '', city_id: r.city_id ?? '', notes: r.notes ?? '' } : EMPTY); setEdit(r ?? {}); };
  const save = async () => {
    // the server keeps only the fields of this kind (city and notes are branch fields)
    const r = await form.submit(() => (edit.id ? patch(`/${kind}/${edit.id}`, form.changes) : post(`/${kind}`, form.values)));
    if (r) { setEdit(null); changed(); }
  };
  const act = async (r: any, action: 'activate' | 'deactivate' | 'make-default' | 'delete') => {
    const key = action.replace('-', '_');
    if (!(await confirm({ title: t(`${kind}.${key}_q`, { name: localName(lang, r.name_ar, r.name_en) }), body: action === 'delete' ? t('common.cannot_undo') : undefined, tone: action === 'activate' ? undefined : 'warn' }))) return;
    const done = await run(() => (action === 'delete' ? del(`/${kind}/${r.id}`) : post(`/${kind}/${r.id}/${action}`)), t(`${kind}.done_${key}`));
    if (done) changed();
  };
  const locked = (r: any) => (isBranch ? !!r.is_default : !!r.builtin_key);

  const columns: Column<any>[] = [
    { key: 'name', header: t(`${kind}.name`), sort: 'name', render: (r) => <div>
      <div className="font-medium">{r.name_ar} {isBranch && !!r.is_default && <Badge tone="blue">{t('branches.default')}</Badge>} {!isBranch && r.builtin_key && <Badge tone="grey">{t('designations.builtin')}</Badge>}</div>
      {r.name_en && <div className="text-xs text-zinc-500" dir="ltr">{r.name_en}</div>}</div> },
    ...(isBranch ? [{ key: 'city', header: t('branches.city'), render: (r: any) => localName(lang, r.city_ar, r.city_en) }] : []),
    { key: 'riders', header: t(`${kind}.riders`), render: (r) => <span className="num">{fmtNum(r.riders)}</span> },
    ...(isBranch ? [{ key: 'vehicles', header: t('branches.vehicles'), render: (r: any) => <span className="num">{fmtNum(r.vehicles)}</span> }] : []),
    { key: 'status', header: t(`${kind}.status`), sort: 'status', render: (r) => <Badge tone={r.is_active ? 'green' : 'grey'}>{r.is_active ? t('common.active') : t('common.disabled')}</Badge> },
    { key: 'actions', header: t('common.actions'), render: (r) => <div className="flex">
      {can(`${kind}.update`) && <IconButton title={t('common.edit')} onClick={() => open(r)}><Pencil /></IconButton>}
      {isBranch && !r.is_default && !!r.is_active && can('branches.update') && <IconButton title={t('branches.make_default')} onClick={() => act(r, 'make-default')}><Star /></IconButton>}
      {!locked(r) && (r.is_active ? can(`${kind}.deactivate`) : can(`${kind}.activate`)) &&
        <IconButton title={r.is_active ? t('common.disable') : t('common.enable')} tone={r.is_active ? 'amber' : 'green'} onClick={() => act(r, r.is_active ? 'deactivate' : 'activate')}>{r.is_active ? <PowerOff /> : <Power />}</IconButton>}
      {!locked(r) && can(`${kind}.delete`) && <IconButton title={t('common.delete')} tone="red" onClick={() => act(r, 'delete')}><Trash2 /></IconButton>}
    </div> },
  ];
  return (
    <>
      <PageHeader title={t(`${kind}.title`)} subtitle={<PlanCounter kind={kind} />} actions={<>
        {can(`${kind}.export`) && <ExportButton path={`/${kind}/export`} query={list.query} label={t('common.export_csv')} />}
        {can(`${kind}.create`) && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => open()}>{t(`${kind}.new`)}</Button>}
      </>} />
      <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">{t(`${kind}.intro`)}</p>
      <FilterBar list={list} placeholder={t(`${kind}.search_hint`)}>
        <FilterSelect list={list} name="status" label={t(`${kind}.status`)} options={[{ value: 'active', label: t('common.active_only') }, { value: 'disabled', label: t('common.disabled_only') }]} />
        {!isBranch && <FilterSelect list={list} name="type" label={t('designations.type')} options={[{ value: 'builtin', label: t('designations.builtin') }, { value: 'custom', label: t('designations.custom') }]} />}
      </FilterBar>
      <DataTable list={list} columns={columns} />
      <SidePanel open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? t(`${kind}.edit`) : t(`${kind}.new`)}
        footer={<><Button onClick={() => setEdit(null)}>{t('common.cancel')}</Button><Button variant="primary" disabled={form.busy} onClick={save}>{t('common.save')}</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); save(); }}>
          <Grid>
            <TextInput form={form} name="name_ar" label={t(`${kind}.name_ar`)} required maxLength={100} />
            <TextInput form={form} name="name_en" label={t(`${kind}.name_en`)} dir="ltr" maxLength={100} />
            {isBranch && <SelectInput form={form} name="city_id" label={t('branches.city')} options={cities.map((c) => ({ value: c.id, label: localName(lang, c.name_ar, c.name_en) }))} />}
          </Grid>
          {isBranch && <TextArea form={form} name="notes" label={t('common.notes')} maxLength={500} />}
        </form>
      </SidePanel>
    </>
  );
}

export const BranchesPage = () => <OrgList kind="branches" />;
export const DesignationsPage = () => <OrgList kind="designations" />;

// ---------- pickers and labels for the rider and vehicle screens ----------
type OrgOption = { id: number; name_ar: string; name_en: string | null; is_active: number };
// one cached list per kind (every one, switched-off included); pickers for new values leave the switched-off ones out
export function useOrgOptions(kind: Kind, all = false) {
  const { lang } = useI18n();
  const rows = useOptions<OrgOption>(`/lookups/${kind}?all=1`);
  return rows.filter((r) => all || r.is_active).map((r) => ({ value: r.id, label: localName(lang, r.name_ar, r.name_en), disabled: !r.is_active }));
}

// "Move to branch" for the vehicles chosen in a list
export function MoveToBranch({ ids, onDone }: { ids: (string | number)[]; onDone: () => void }) {
  const { t } = useI18n();
  const run = useAction();
  const { confirm } = useUi();
  const branches = useOrgOptions('branches');
  const [to, setTo] = useState('');
  const move = async () => {
    const name = branches.find((b) => String(b.value) === to)?.label;
    if (!(await confirm({ title: t('branches.move_q', { n: ids.length, name }), tone: 'warn' }))) return;
    if (await run(() => post('/vehicles/bulk-branch', { ids, branch_id: Number(to) }), t('branches.moved', { n: ids.length }))) { setTo(''); onDone(); }
  };
  return (
    <span className="inline-flex items-center gap-1">
      <select className="input h-8 py-0 text-sm" value={to} onChange={(e) => setTo(e.target.value)} aria-label={t('branches.move_to')}>
        <option value="">{t('branches.move_to')}</option>
        {branches.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
      </select>
      <Button size="sm" disabled={!to} onClick={move}>{t('branches.apply')}</Button>
    </span>
  );
}
