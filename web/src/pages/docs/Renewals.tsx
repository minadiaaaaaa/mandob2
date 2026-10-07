import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Eye, ExternalLink, Plus, RefreshCw } from 'lucide-react';
import { get, post } from '../../api';
import { useAuth } from '../../auth';
import { fmtDate, fmtDateTime, fmtMoney, fmtNum, useI18n } from '../../i18n';
import { Alert, Badge, Button, Card, Details, Field, IconButton, Loading, PageHeader, StatCard, StatGrid, toneIf, useUi, type Tone } from '../../ui/kit';
import { Combo, Grid, SaveBar, SelectInput, TextArea, TextInput, useFieldError, useForm } from '../../ui/forms';
import { DataTable, FilterBar, FilterDate, FilterSelect, useList, type Column } from '../../ui/table';
import { Attachments, ScanUpload, type Scan } from '../../ui/files';
import { ExportButton, latin } from '../../ui/common';

export const ALERT_KINDS = ['id', 'license', 'health', 'driver_card', 'ajeer', 'operation_card', 'vehicle_registration', 'vehicle_insurance', 'insurance_policy', 'oil_change', 'transport_license'];
export const RENEW_KINDS = ['id', 'license', 'health', 'driver_card', 'ajeer', 'vehicle_registration', 'operation_card', 'vehicle_insurance', 'transport_license'];
const OWNER_TYPES = ['rider', 'vehicle', 'organization'];
const STATE_TONE: Record<string, Tone> = { expired: 'red', near: 'amber', valid: 'green' };
const OP_TONE: Record<string, Tone> = { renewal: 'green', replacement: 'amber', reissue: 'blue', correction: 'grey' };

function useDaysText() {
  const { t } = useI18n();
  return (d: number) => (d < 0 ? t('docs.expired_ago', { n: fmtNum(-d) }) : d === 0 ? t('docs.expires_today') : t('docs.days_left', { n: fmtNum(d) }));
}
const recordLink = (r: { kind: string; ref_id: number }) => ({
  operation_card: `/admin/operation-cards/${r.ref_id}`, vehicle_registration: `/admin/vehicle-registrations/${r.ref_id}`,
  vehicle_insurance: `/admin/insurance/vehicles/${r.ref_id}`, insurance_policy: `/admin/insurance/policies/${r.ref_id}`,
  oil_change: `/admin/vehicles/${r.ref_id}`, transport_license: `/admin/transport-licenses/${r.ref_id}`,
} as Record<string, string>)[r.kind] ?? `/admin/riders/${r.ref_id}`;

// ======================================================================== 5.1 expiry alerts
export function AlertsList() {
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const daysText = useDaysText();
  const list = useList('/alerts');
  const s = list.stats ?? {};
  const win = s.window ?? 30;
  const columns: Column<any>[] = [
    { key: 'kind', header: t('alerts.document'), sort: 'kind', render: (r) => <div><div className="font-medium">{t(`alerts.kind.${r.kind}`)}</div><div className="text-xs text-zinc-500">{t(`alerts.owner.${r.owner_type}`)}</div></div> },
    { key: 'owner', header: t('alerts.belongs_to'), sort: 'owner', render: (r) => r.owner || '—' },
    { key: 'number', header: t('alerts.number'), render: (r) => <span className="num">{r.number ?? '—'}</span> },
    { key: 'issued', header: t('alerts.issued'), sort: 'issued', render: (r) => <span className="num">{fmtDate(r.issue_date)}</span> },
    { key: 'expires', header: t('alerts.expires'), sort: 'expires', render: (r) => <span className="num">{fmtDate(r.expiry_date)}</span> },
    { key: 'days', header: t('alerts.days_left'), sort: 'days', render: (r) => <Badge tone={STATE_TONE[r.state]} title={daysText(r.days_left)}><span className="num">{fmtNum(r.days_left)}</span></Badge> },
    { key: 'status', header: t('alerts.status'), render: (r) => <Badge tone={STATE_TONE[r.state]}>{t(`alerts.state.${r.state}`)}</Badge> },
    { key: 'actions', header: t('common.actions'), render: (r) => <div className="flex">
      <IconButton title={t('alerts.open_record')} onClick={() => nav(recordLink(r))}><ExternalLink /></IconButton>
      {can('renewals.create') && RENEW_KINDS.includes(r.kind) && <IconButton title={t('alerts.record_renewal')} tone="green" onClick={() => nav(`/admin/renewals/new?kind=${r.kind}&doc=${r.record_id}`)}><RefreshCw /></IconButton>}
    </div> },
  ];
  return (
    <>
      <PageHeader title={t('alerts.title')} subtitle={t('alerts.subtitle')} actions={can('alerts.export') && <ExportButton path="/alerts/export" query={list.query} />} />
      <StatGrid>
        <StatCard label={t('alerts.s.documents')} value={fmtNum(s.documents)} />
        <StatCard label={t('alerts.s.expired')} value={fmtNum(s.expired)} tone={toneIf(s.expired, 'red')} onClick={() => list.set('status', list.query.status === 'expired' ? null : 'expired')} active={list.query.status === 'expired'} />
        <StatCard label={t('alerts.s.near', { n: win })} value={fmtNum(s.near)} tone={toneIf(s.near, 'amber')} onClick={() => list.set('status', list.query.status === 'near' ? null : 'near')} active={list.query.status === 'near'} />
        <StatCard label={t('alerts.s.valid')} value={fmtNum(s.valid)} tone="green" onClick={() => list.set('status', list.query.status === 'valid' ? null : 'valid')} active={list.query.status === 'valid'} />
      </StatGrid>
      <FilterBar list={list} placeholder={t('alerts.search_hint')} actions={can('alerts.export') && <ExportButton path="/alerts/export" query={list.query} format="csv" label={t('common.export_csv')} />}>
        <FilterSelect list={list} name="kind" label={t('alerts.document')} options={ALERT_KINDS.map((k) => ({ value: k, label: t(`alerts.kind.${k}`) }))} />
        <FilterSelect list={list} name="owner_type" label={t('alerts.belongs_to')} options={OWNER_TYPES.map((k) => ({ value: k, label: t(`alerts.owner.${k}`) }))} />
        <FilterSelect list={list} name="status" label={t('alerts.status')} options={['expired', 'near', 'valid'].map((k) => ({ value: k, label: t(`alerts.state.${k}`) }))} />
        <FilterSelect list={list} name="window" label={t('alerts.window')} options={[7, 30, 60, 90].map((n) => ({ value: n, label: t('alerts.within', { n }) }))} />
      </FilterBar>
      <DataTable list={list} columns={columns} rowKey="_key" emptyText={<div><div className="font-medium">{t('alerts.none')}</div><div className="text-xs">{t('alerts.none_hint')}</div></div>} />
    </>
  );
}

// ======================================================================== 5.2 renewal log
export function RenewalsList() {
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const list = useList('/renewals');
  const s = list.stats ?? {};
  const columns: Column<any>[] = [
    { key: 'date', header: t('ren.renewed_on'), sort: 'date', render: (r) => <div><div className="num">{fmtDate(r.renewal_date)}</div>{r.reference && <div className="text-xs text-zinc-500 num">{r.reference}</div>}</div> },
    { key: 'kind', header: t('ren.document'), sort: 'kind', render: (r) => <div><div className="font-medium">{t(`alerts.kind.${r.doc_kind}`)}</div><div className="text-xs text-zinc-500 num">#{r.doc_id}</div></div> },
    { key: 'owner', header: t('ren.owner'), sort: 'owner', render: (r) => <div><div>{r.owner_label ?? '—'}</div><div className="text-xs text-zinc-500">{t(`alerts.owner.${r.owner_type}`)}</div></div> },
    { key: 'expiry', header: t('ren.expiry'), sort: 'expiry', render: (r) => <div className="num"><div className="font-medium">{fmtDate(r.new_expiry)}</div><div className="text-xs text-zinc-500 line-through">{fmtDate(r.previous_expiry)}</div></div> },
    { key: 'extended', header: t('ren.extended_by'), render: (r) => (r.extended_days == null ? '—' : t('ren.n_days', { n: fmtNum(r.extended_days) })) },
    { key: 'op', header: t('ren.operation'), render: (r) => <Badge tone={OP_TONE[r.operation]}>{t(`ren.op.${r.operation}`)}</Badge> },
    { key: 'cost', header: t('ren.cost'), sort: 'cost', render: (r) => <span className="num">{r.cost == null ? '—' : fmtNum(r.cost, 2)}</span> },
    { key: 'actions', header: t('common.actions'), render: (r) => <div className="flex">
      <IconButton title={t('common.view')} onClick={() => nav(`/admin/renewals/${r.id}`)}><Eye /></IconButton>
      {can('renewals.create') && <IconButton title={t('ren.renew_this')} tone="green" onClick={() => nav(`/admin/renewals/new?kind=${r.doc_kind}&doc=${r.new_doc_id ?? r.doc_id}`)}><RefreshCw /></IconButton>}
    </div> },
  ];
  return (
    <>
      <PageHeader title={t('ren.title')} actions={<>
        {can('renewals.export') && <ExportButton path="/renewals/export" query={list.query} label={t('common.export_csv')} />}
        {can('renewals.create') && <Link to="/admin/renewals/new"><Button variant="primary" icon={<Plus className="size-4" />}>{t('ren.record')}</Button></Link>}
      </>} />
      <StatGrid>
        <StatCard label={t('ren.s.logged')} value={fmtNum(s.total)} />
        <StatCard label={t('ren.s.total_cost')} value={fmtMoney(s.cost)} />
        <StatCard label={t('ren.s.month')} value={fmtNum(s.month)} tone="blue" />
        <StatCard label={t('ren.s.month_cost')} value={fmtMoney(s.month_cost)} />
        {(s.kinds ?? []).map((k: any) => <StatCard key={k.kind} label={t(`alerts.kind.${k.kind}`)} value={fmtNum(k.n)} sub={t('ren.cost_x', { cost: fmtMoney(k.cost) })}
          onClick={() => list.set('kind', list.query.kind === k.kind ? null : k.kind)} active={list.query.kind === k.kind} />)}
      </StatGrid>
      <FilterBar list={list} placeholder={t('ren.search_hint')}>
        <FilterSelect list={list} name="kind" label={t('ren.kind')} options={RENEW_KINDS.map((k) => ({ value: k, label: t(`alerts.kind.${k}`) }))} />
        <FilterSelect list={list} name="owner_type" label={t('ren.belongs_to')} options={OWNER_TYPES.map((k) => ({ value: k, label: t(`alerts.owner.${k}`) }))} />
        <FilterDate list={list} name="from" label={t('common.from')} />
        <FilterDate list={list} name="to" label={t('common.to')} />
      </FilterBar>
      <DataTable list={list} columns={columns} onRowClick={(r) => nav(`/admin/renewals/${r.id}`)} />
    </>
  );
}

const todayStr = () => new Intl.DateTimeFormat('en-CA').format(new Date());

export function RenewalForm() {
  const { t } = useI18n();
  const nav = useNavigate();
  const { toast } = useUi();
  const daysText = useDaysText();
  const [params] = useSearchParams();
  const form = useForm<Record<string, any>>({
    kind: params.get('kind') ?? '', doc_id: params.get('doc') ?? '', new_expiry: '', renewal_date: todayStr(), new_issue: '', new_number: '',
    operation: 'renewal', cost: '', reference: '', notes: '',
  });
  const err = useFieldError(form);
  const [scan, setScan] = useState<Scan | null>(null);
  const [docs, setDocs] = useState<any[]>([]);
  const kind = form.values.kind;
  useEffect(() => { setDocs([]); if (kind) get(`/renewals/documents?kind=${kind}`).then(setDocs).catch(() => setDocs([])); }, [kind]);
  const doc = docs.find((d) => String(d.id) === String(form.values.doc_id));
  const options = useMemo(() => docs.map((d) => ({
    value: d.id, label: d.owner || `#${d.id}`, search: d.number ?? '',
    sub: [d.number, d.expiry_date && `${t('alerts.expires')}: ${d.expiry_date}`].filter(Boolean).join(' · '),
    note: d.days_left == null ? undefined : daysText(d.days_left),
  })), [docs, t]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = form.values;
    const r = await form.submit(() => post('/renewals', { ...v, scan: scan?.token, cost: latin(String(v.cost ?? '')) }));
    if (r) { toast(t('ren.recorded')); nav(`/admin/renewals/${r.id}`); }
  };
  return (
    <form onSubmit={save}>
      <PageHeader title={t('ren.record')} back="/admin/renewals" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('ren.doc_card')}>
          <div className="space-y-4">
            <SelectInput form={form} name="kind" label={t('ren.kind')} required options={RENEW_KINDS.map((k) => ({ value: k, label: t(`alerts.kind.${k}`) }))}
              onChange={() => { form.set('doc_id', ''); if (scan) setScan(null); }} />
            <Field label={t('ren.document')} required error={err('doc_id')}>
              <Combo value={form.values.doc_id} onChange={(v) => form.set('doc_id', v ?? '')} options={options} disabled={!kind} invalid={!!err('doc_id')}
                placeholder={kind ? t('common.choose') : t('ren.choose_kind_first')} countLabel={(n, total) => t('common.shown_of', { n, total })} />
            </Field>
          </div>
        </Card>
        <Card title={t('ren.scan_card')}>
          {!kind && <div className="mb-3"><Alert tone="blue">{t('ren.kind_before_scan')}</Alert></div>}
          <ScanUpload value={scan} onChange={setScan} title={t('ren.attach_scan')} disabled={!kind} />
          <p className="mt-2 text-xs text-zinc-500">{t('ren.formats')}</p>
          {err('scan') && <p className="mt-1 text-xs text-red-600">{err('scan')}</p>}
        </Card>
      </div>
      <Card title={t('ren.details')} className="mt-4"><Grid cols={3}>
        <TextInput form={form} name="new_expiry" label={t('ren.new_expiry')} type="date" required hint={doc?.expiry_date && t('ren.current_expiry', { date: doc.expiry_date })} />
        <TextInput form={form} name="renewal_date" label={t('ren.renewal_date')} type="date" />
        <TextInput form={form} name="new_issue" label={t('ren.new_issue')} type="date" hint={t('ren.new_issue_hint')} />
        <TextInput form={form} name="new_number" label={t('ren.new_number')} maxLength={100} dir="ltr" hint={t('ren.new_number_hint')} />
        <SelectInput form={form} name="operation" label={t('ren.operation')} empty={false} options={Object.keys(OP_TONE).map((k) => ({ value: k, label: t(`ren.op.${k}`) }))} />
        <TextInput form={form} name="cost" label={t('ren.cost')} dir="ltr" placeholder="0.00" />
        <TextInput form={form} name="reference" label={t('ren.reference')} maxLength={100} dir="ltr" />
        <TextArea form={form} name="notes" label={t('common.notes')} maxLength={500} className="sm:col-span-2" />
      </Grid></Card>
      <SaveBar form={form} editing={false} label={t('ren.save')} onCancel={() => nav(-1)} />
    </form>
  );
}

export function RenewalView() {
  const { id } = useParams();
  const { t } = useI18n();
  const { can } = useAuth();
  const [r, setR] = useState<any>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => { setR(null); get(`/renewals/${id}`).then(setR).catch(() => setMissing(true)); }, [id]);
  if (missing) return <Alert tone="amber">{t('err.not_found')}</Alert>;
  if (!r) return <Loading />;
  const docId = r.new_doc_id ?? r.doc_id;
  return (
    <>
      <PageHeader title={r.owner_label || t(`alerts.kind.${r.kind}`)} back="/admin/renewals"
        subtitle={<span className="flex flex-wrap items-center gap-2">{t(`alerts.kind.${r.kind}`)} <span className="num">#{r.doc_id}</span><Badge tone={OP_TONE[r.operation]}>{t(`ren.op.${r.operation}`)}</Badge></span>}
        actions={<>
          <Link to="/admin/renewals"><Button variant="ghost">{t('ren.back_to_log')}</Button></Link>
          {can('renewals.create') && r.current && <Link to={`/admin/renewals/new?kind=${r.kind}&doc=${r.current.id}`}><Button variant="primary" icon={<RefreshCw className="size-4" />}>{t('ren.renew_this')}</Button></Link>}
        </>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label={t('ren.extended_by')} value={r.extended_days == null ? '—' : t('ren.n_days', { n: fmtNum(r.extended_days) })} sub={<span className="num">{fmtDate(r.previous_expiry)} → {fmtDate(r.new_expiry)}</span>} tone="green" />
        <StatCard label={t('ren.cost')} value={fmtMoney(r.cost)} />
        <StatCard label={t('ren.renewal_date')} value={fmtDate(r.renewal_date)} sub={r.reference ?? t('ren.not_recorded')} />
      </div>
      <div className="mb-4"><Alert tone="blue">{r.new_doc_id ? t('ren.replaced', { id: r.doc_id }) : t('ren.in_place')}</Alert></div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={t('ren.details')} className="lg:col-span-2">
          <Details rows={[
            [t('ren.document'), t(`alerts.kind.${r.kind}`)], [t('ren.record_id'), <span className="num">#{r.doc_id}{r.new_doc_id && ` → #${r.new_doc_id}`}</span>],
            [t('ren.owner'), r.owner_label], [t('ren.belongs_to'), t(`alerts.owner.${r.owner_type}`)],
            [t('ren.previous_number'), r.previous_number], [t('ren.new_number'), r.new_number],
            [t('ren.previous_expiry'), fmtDate(r.previous_expiry)], [t('ren.new_expiry'), fmtDate(r.new_expiry)],
            [t('ren.extended_by'), r.extended_days == null ? null : t('ren.n_days', { n: fmtNum(r.extended_days) })], [t('ren.operation'), t(`ren.op.${r.operation}`)],
            [t('ren.renewal_date'), fmtDate(r.renewal_date)], [t('ren.cost'), r.cost == null ? null : fmtMoney(r.cost)], [t('ren.reference'), r.reference],
            [t('ren.recorded_by'), r.recorded_by_name && `${r.recorded_by_name} · ${fmtDateTime(r.created_at)}`], [t('common.notes'), r.notes],
          ]} />
        </Card>
        <Card title={t('ren.chain')}>
          {r.chain.length <= 1 ? <p className="text-sm text-zinc-500">{t('ren.no_chain')}</p> : (
            <ol className="relative space-y-3 border-s border-zinc-200 ps-4 dark:border-zinc-700">
              {r.chain.map((c: any) => (
                <li key={c.id} className="relative">
                  <span className={`absolute -start-[21px] top-1.5 size-2.5 rounded-full ${c.id === r.id ? 'bg-brand' : 'bg-zinc-300 dark:bg-zinc-600'}`} />
                  <Link to={`/admin/renewals/${c.id}`} className={c.id === r.id ? 'font-semibold text-brand' : 'hover:text-brand'}>
                    <span className="num">{fmtDate(c.renewal_date)}</span> · {t(`ren.op.${c.operation}`)}
                  </Link>
                  <div className="text-xs text-zinc-500 num">{fmtDate(c.previous_expiry)} → {fmtDate(c.new_expiry)}</div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
      {r.entity && <div className="mt-4"><Attachments entityType={r.entity} entityId={docId} title={t('ren.files')} /></div>}
    </>
  );
}
