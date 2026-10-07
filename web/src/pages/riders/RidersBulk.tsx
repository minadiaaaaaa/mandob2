import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { post } from '../../api';
import { useI18n } from '../../i18n';
import { Alert, Button, Card, Checkbox, Field, PageHeader, useErrorText, useUi } from '../../ui/kit';
import { ImportWizard } from '../../ui/importer';
import { useCityName, useOptions } from '../../ui/common';

// Bulk edit: change what repeats across the selected riders. A field that is not ticked stays as it is.
export function RidersBulkEdit() {
  const { t } = useI18n();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { ids: number[]; names: string[] } };
  const { confirm, toast } = useUi();
  const errText = useErrorText();
  const city = useCityName();
  const [on, setOn] = useState<Record<string, boolean>>({});
  const [v, setV] = useState<Record<string, string>>({});
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const companies = useOptions<any>('/lookups/companies');
  const contracts = useOptions<any>(on.company_id && v.company_id ? `/lookups/contracts?company=${v.company_id}` : '/lookups/contracts');
  const cities = useOptions<any>('/lookups/cities');
  // Opened without a selection (e.g. after a refresh): back to the list.
  if (!loc.state?.ids?.length) return <Navigate to="/admin/riders" replace />;
  const { ids, names } = loc.state;
  const fields = [
    ['company_id', t('riders.company'), companies.map((c: any) => [c.id, c.name])],
    ['contract_id', t('riders.contract'), contracts.map((c: any) => [c.id, c.name])],
    ['city_id', t('riders.city'), cities.map((c: any) => [c.id, city(c)])],
    ['status', t('riders.status'), ['active', 'inactive', 'suspended', 'terminated'].map((s) => [s, t(`rider.status.${s}`)])],
  ] as [string, string, [string | number, string][]][];
  const chosen = fields.filter(([k]) => on[k]);
  const contractMismatch = on.contract_id && on.company_id && v.contract_id && !contracts.some((c: any) => String(c.id) === v.contract_id);

  const apply = async () => {
    const e: Record<string, string> = {};
    for (const [k] of chosen) if (!v[k]) e[k] = t('riders.bulk_no_value');
    setErrs(e);
    if (!chosen.length) { toast(t('riders.bulk_no_field'), 'amber'); return; }
    if (Object.keys(e).length) return;
    if (!(await confirm({ title: t('riders.bulk_confirm', { n: ids.length }), confirm: t('riders.yes_apply'), tone: 'primary' }))) return;
    setBusy(true);
    try {
      const r = await post('/riders/bulk-edit', { ids, changes: Object.fromEntries(chosen.map(([k]) => [k, v[k]])) });
      toast(t('riders.bulk_done', { n: r.updated }));
      nav('/admin/riders');
    } catch (err) { toast(errText(err), 'red'); }
    finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title={t('riders.bulk_title')} back="/admin/riders" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={t('riders.bulk_selected', { n: ids.length })}>
          <ul className="space-y-1 text-sm">{names.slice(0, 12).map((n, i) => <li key={i}>{n}</li>)}</ul>
          {names.length > 12 && <p className="mt-2 text-xs text-zinc-500">{t('riders.and_more', { n: names.length - 12 })}</p>}
        </Card>
        <Card title={t('riders.bulk_fields')}>
          <div className="space-y-4">
            {fields.map(([k, label, opts]) => (
              <div key={k}>
                <Checkbox checked={!!on[k]} onChange={(x) => setOn({ ...on, [k]: x })} label={<span className="font-medium">{label} — {t('riders.change_this_field')}</span>} />
                <Field label="" error={errs[k]} hint={!on[k] ? t('riders.left_unchanged') : undefined}>
                  <select className="input mt-1" disabled={!on[k]} value={v[k] ?? ''} onChange={(e) => setV({ ...v, [k]: e.target.value })}>
                    <option value="">{t('common.choose')}</option>
                    {opts.map(([val, l]) => <option key={val} value={val}>{l}</option>)}
                  </select>
                </Field>
              </div>
            ))}
          </div>
        </Card>
        <Card title={t('riders.what_will_change')}>
          {chosen.length ? <ul className="space-y-1 text-sm">{chosen.map(([k, label, opts]) => <li key={k}>{label}: <b>{opts.find(([val]) => String(val) === v[k])?.[1] ?? '—'}</b></li>)}</ul>
            : <p className="text-sm text-zinc-500">{t('riders.bulk_no_field')}</p>}
          {contractMismatch && <div className="mt-3"><Alert tone="amber">{t('err.contract_other_company')}</Alert></div>}
          <Button variant="primary" className="mt-4 w-full" loading={busy} onClick={apply}>{t('riders.apply_change')}</Button>
        </Card>
      </div>
    </>
  );
}

export function RidersImport() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t('riders.import_title')} back="/admin/riders" />
      <ImportWizard base="/riders/import" back="/admin/riders" modeLabels={{ question: t('riders.when_id_exists'), skip: t('riders.skip_existing'), replace: t('riders.replace_existing') }}
        intro={<p className="text-sm text-zinc-500">{t('riders.import_intro')}</p>} />
    </>
  );
}
