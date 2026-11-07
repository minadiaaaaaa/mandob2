import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../auth';
import { get, patch, post, put } from '../../api';
import { useI18n } from '../../i18n';
import { Badge, Button, Card, Field, Loading, PageHeader, SidePanel, StatCard, StatGrid, Tabs, cx, useAction, useUi, type Tone } from '../../ui/kit';
import { STATE_TONE } from '../system/Billing';
import { FEATURE_KEYS, LATER_KEYS, LIMIT_KEYS, limitColumn, planLimit, type LimitKey, type Plan } from '../../plans';

type Company = {
  id: number; slug: string; name: string; name_en: string | null; phone: string | null; email: string | null; owner_email: string | null; plan_key: string;
  status: string; state: string; days_left: number; ends_at: string | null; billing_cycle: string; trial_ends_at: string | null; period_ends_at: string | null;
  extra_riders: number; extra_users: number; extra_vehicles: number; owner_note: string | null; created_at: string; last_login_at: string | null;
  riders: number; vehicles: number; users: number;
};
const PAY_TONE: Record<string, Tone> = { pending: 'amber', approved: 'green', rejected: 'red' };
const th = 'px-3 py-2 text-start text-xs font-medium text-zinc-500';
const td = 'px-3 py-2.5';

function usePlans(enabled: boolean) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const load = useCallback(() => (enabled ? get<Plan[]>('/platform/plans').then(setPlans) : Promise.resolve()), [enabled]);
  useEffect(() => { load(); }, [load]);
  return { plans, load };
}

function Overview({ plans }: { plans: Plan[] }) {
  const { t, lang } = useI18n();
  const [d, setD] = useState<any>(null);
  useEffect(() => { get('/platform/overview').then(setD); }, []);
  if (!d) return <Loading />;
  const pname = (k: string) => { const p = plans.find((x) => x.key === k); return p ? (lang === 'ar' ? p.name_ar : p.name_en) : k; };
  return (
    <>
      <StatGrid>
        <StatCard label={t('platform.companies')} value={d.counts.total ?? 0} />
        <StatCard label={t('billing.state.trial')} value={d.counts.trial ?? 0} tone="blue" />
        <StatCard label={t('billing.state.active')} value={d.counts.active ?? 0} tone="green" />
        <StatCard label={t('billing.state.expired')} value={d.counts.expired ?? 0} tone={d.counts.expired ? 'red' : 'none'} />
        <StatCard label={t('platform.new_30')} value={d.counts.new_30 ?? 0} />
        <StatCard label={t('platform.revenue_30')} value={Number(d.money.revenue_30).toLocaleString()} sub={t('billing.sar')} />
        <StatCard label={t('platform.pending_payments')} value={d.money.pending} tone={d.money.pending ? 'amber' : 'none'} />
      </StatGrid>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('platform.ending_soon')} pad={false}>
          {d.ending.length ? <table className="w-full text-sm"><tbody>{d.ending.map((c: any) => (
            <tr key={c.id} className="border-b border-zinc-50 last:border-0 dark:border-zinc-800/60">
              <td className={td}>{c.name}</td><td className={td}><Badge tone={STATE_TONE[c.status]}>{t(`billing.state.${c.status}`)}</Badge></td><td className={cx(td, 'num text-zinc-500')}>{String(c.ends_at).slice(0, 10)}</td>
            </tr>))}</tbody></table> : <p className="p-4 text-sm text-zinc-500">{t('platform.nothing_ending')}</p>}
        </Card>
        <Card title={t('platform.by_plan')}>
          <div className="space-y-2 text-sm">{d.byPlan.map((r: any) => <div key={r.plan_key} className="flex justify-between"><span>{pname(r.plan_key)}</span><span className="num font-medium">{r.n}</span></div>)}</div>
        </Card>
      </div>
    </>
  );
}

function Companies({ plans }: { plans: Plan[] }) {
  const { t, lang } = useI18n();
  const run = useAction();
  const [rows, setRows] = useState<Company[] | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [edit, setEdit] = useState<Company | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [days, setDays] = useState('30');
  const load = useCallback(() => get<Company[]>('/platform/tenants', { search, status }).then(setRows), [search, status]);
  useEffect(() => { const h = setTimeout(load, 250); return () => clearTimeout(h); }, [load]);
  const pname = (k: string) => { const p = plans.find((x) => x.key === k); return p ? (lang === 'ar' ? p.name_ar : p.name_en) : k; };
  const open = (c: Company) => {
    setEdit(c);
    setForm({ name: c.name, plan_key: c.plan_key, status: c.status, trial_ends_at: c.trial_ends_at?.slice(0, 10) ?? '', period_ends_at: c.period_ends_at?.slice(0, 10) ?? '',
      extra_riders: c.extra_riders, extra_users: c.extra_users, extra_vehicles: c.extra_vehicles, owner_note: c.owner_note ?? '' });
  };
  const save = async () => { if (await run(() => patch(`/platform/tenants/${edit!.id}`, form), t('common.saved'))) { setEdit(null); load(); } };
  const extend = async () => { if (await run(() => post(`/platform/tenants/${edit!.id}/extend`, { days: Number(days) }), t('common.saved'))) { setEdit(null); load(); } };
  const f = (k: string) => ({ value: form[k] ?? '', onChange: (e: any) => setForm({ ...form, [k]: e.target.value }) });

  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder={t('platform.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('common.all')}</option>
          {['trial', 'active', 'expired', 'suspended'].map((s) => <option key={s} value={s}>{t(`billing.state.${s}`)}</option>)}
        </select>
      </div>
      {!rows ? <Loading /> : (
        <>
        {/* phones: one card per company */}
        <div className="space-y-2 sm:hidden">
          {rows.map((c) => (
            <button key={c.id} onClick={() => open(c)} className="w-full rounded-lg border border-zinc-200 bg-white p-3 text-start dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><div className="truncate font-medium">{c.name}</div><div className="truncate text-xs text-zinc-500" dir="ltr">{c.owner_email}</div></div>
                <Badge tone={STATE_TONE[c.state]}>{t(`billing.state.${c.state}`)}</Badge>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                <span>{pname(c.plan_key)}</span><span>{t('billing.days_left')}: <b className="num text-zinc-800 dark:text-zinc-200">{c.days_left}</b></span>
                <span>{t('billing.riders')}: <b className="num text-zinc-800 dark:text-zinc-200">{c.riders}</b></span><span>{t('billing.vehicles')}: <b className="num text-zinc-800 dark:text-zinc-200">{c.vehicles}</b></span>
              </div>
            </button>
          ))}
          {!rows.length && <p className="p-6 text-center text-sm text-zinc-500">{t('platform.no_companies')}</p>}
        </div>
        <Card pad={false} className="hidden sm:block">
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="border-b border-zinc-100 dark:border-zinc-800">{['platform.company', 'billing.plan', 'billing.status', 'billing.days_left', 'billing.riders', 'billing.vehicles', 'billing.users', 'platform.last_login'].map((k) => <th key={k} className={th}>{t(k)}</th>)}</tr></thead>
            <tbody>{rows.map((c) => (
              <tr key={c.id} onClick={() => open(c)} className="cursor-pointer border-b border-zinc-50 last:border-0 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40">
                <td className={td}><div className="font-medium">{c.name}</div><div className="text-xs text-zinc-500" dir="ltr">{c.owner_email}</div></td>
                <td className={td}>{pname(c.plan_key)}</td>
                <td className={td}><Badge tone={STATE_TONE[c.state]}>{t(`billing.state.${c.state}`)}</Badge></td>
                <td className={cx(td, 'num')}>{c.days_left}</td>
                <td className={cx(td, 'num')}>{c.riders}</td><td className={cx(td, 'num')}>{c.vehicles}</td><td className={cx(td, 'num')}>{c.users}</td>
                <td className={cx(td, 'num text-zinc-500')}>{c.last_login_at?.slice(0, 10) ?? '—'}</td>
              </tr>))}
              {!rows.length && <tr><td colSpan={8} className="p-6 text-center text-zinc-500">{t('platform.no_companies')}</td></tr>}
            </tbody>
          </table></div>
        </Card>
        </>
      )}
      <SidePanel open={!!edit} onClose={() => setEdit(null)} title={edit?.name ?? ''}
        footer={<><Button onClick={() => setEdit(null)}>{t('common.cancel')}</Button><Button variant="primary" onClick={save}>{t('common.save')}</Button></>}>
        {edit && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-3 gap-2 rounded-lg bg-zinc-50 p-3 text-center dark:bg-zinc-800/50">
              <div><div className="num text-lg font-semibold">{edit.riders}</div><div className="text-xs text-zinc-500">{t('billing.riders')}</div></div>
              <div><div className="num text-lg font-semibold">{edit.vehicles}</div><div className="text-xs text-zinc-500">{t('billing.vehicles')}</div></div>
              <div><div className="num text-lg font-semibold">{edit.users}</div><div className="text-xs text-zinc-500">{t('billing.users')}</div></div>
            </div>
            <Field label={t('platform.company')}><input className="input" {...f('name')} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('billing.plan')}><select className="input" {...f('plan_key')}>{plans.map((p) => <option key={p.key} value={p.key}>{lang === 'ar' ? p.name_ar : p.name_en}</option>)}</select></Field>
              <Field label={t('billing.status')}><select className="input" {...f('status')}>{['trial', 'active', 'expired', 'suspended'].map((s) => <option key={s} value={s}>{t(`billing.state.${s}`)}</option>)}</select></Field>
              <Field label={t('billing.trial_ends')}><input type="date" className="input" {...f('trial_ends_at')} /></Field>
              <Field label={t('billing.renews_on')}><input type="date" className="input" {...f('period_ends_at')} /></Field>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">{t('platform.extra_capacity')}</div>
              <div className="grid grid-cols-3 gap-2">
                <Field label={t('billing.riders')}><input type="number" min={0} className="input" {...f('extra_riders')} /></Field>
                <Field label={t('billing.vehicles')}><input type="number" min={0} className="input" {...f('extra_vehicles')} /></Field>
                <Field label={t('billing.users')}><input type="number" min={0} className="input" {...f('extra_users')} /></Field>
              </div>
            </div>
            <Field label={t('platform.owner_note')}><textarea className="input" rows={3} {...f('owner_note')} /></Field>
            <div className="flex items-end gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
              <Field label={t('platform.extend_days')} className="flex-1"><input type="number" min={1} className="input" value={days} onChange={(e) => setDays(e.target.value)} /></Field>
              <Button onClick={extend}>{t('platform.extend')}</Button>
            </div>
            <p className="text-xs text-zinc-500" dir="ltr">{edit.owner_email} · {edit.phone ?? ''} · #{edit.id} · {edit.created_at.slice(0, 10)}</p>
          </div>
        )}
      </SidePanel>
    </>
  );
}

function Plans({ plans, reload }: { plans: Plan[]; reload: () => void }) {
  const { t, lang } = useI18n();
  const run = useAction();
  const [bank, setBank] = useState('');
  const [discount, setDiscount] = useState('');
  // the plan being edited: limits as typed (empty = unlimited), the annual price empty when it follows the discount
  const [edit, setEdit] = useState<Record<string, any> | null>(null);
  useEffect(() => { get<{ bank_details: string }>('/platform/bank-details').then((r) => setBank(r.bank_details)); }, []);
  useEffect(() => { get<{ annual_discount: number }>('/platform/billing-settings').then((r) => setDiscount(String(r.annual_discount))); }, []);
  const open = (p: Plan) => setEdit({
    ...p, price_annual: p.annual_auto ? '' : p.price_annual,
    ...Object.fromEntries(LIMIT_KEYS.map((k) => [limitColumn(k), planLimit(p, k) ?? ''])),
  });
  const f = (k: string) => ({ value: edit?.[k] ?? '', onChange: (e: React.ChangeEvent<HTMLInputElement>) => setEdit({ ...edit, [k]: e.target.value }) });
  const save = async () => { if (edit && (await run(() => put(`/platform/plans/${edit.key}`, edit), t('common.saved')))) { setEdit(null); reload(); } };
  const money = (n: number) => Number(n).toLocaleString('en-US');
  const cap = (p: Plan, k: LimitKey) => planLimit(p, k) ?? '∞';
  return (
    <>
      <Card pad={false} subtitle={t('platform.plans_hint')} title={t('billing.plans')}>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="border-b border-zinc-100 dark:border-zinc-800">{['billing.plan', 'platform.price_monthly', 'platform.price_annual', 'billing.riders', 'billing.vehicles', 'billing.users', 'billing.platforms', 'billing.contracts', 'billing.devices', 'platform.on_sale', ''].map((k) => <th key={k} className={th}>{k && t(k)}</th>)}</tr></thead>
          <tbody>{plans.map((p) => (
            <tr key={p.key} className="border-b border-zinc-50 last:border-0 dark:border-zinc-800/60">
              <td className={td}><div className="font-medium">{lang === 'ar' ? p.name_ar : p.name_en}</div><div className="text-xs text-zinc-500" dir="ltr">{p.key}</div></td>
              <td className={cx(td, 'num')}>{money(p.price_monthly)}</td>
              <td className={cx(td, 'num')}>{money(p.annual_price ?? p.price_annual)}{p.annual_auto && <div className="text-xs text-zinc-500">{t('platform.annual_auto', { n: discount })}</div>}</td>
              {(['riders', 'vehicles', 'users', 'platforms', 'contracts', 'devices'] as const).map((k) => <td key={k} className={cx(td, 'num')}>{cap(p, k)}</td>)}
              <td className={td}>{p.is_public && p.is_active ? <Badge tone="green">{t('platform.on_sale')}</Badge> : <Badge tone="grey">{t('platform.off_sale')}</Badge>}</td>
              <td className={td}><Button size="sm" onClick={() => open(p)}>{t('common.edit')}</Button></td>
            </tr>))}</tbody>
        </table></div>
      </Card>
      <Card title={t('platform.annual_discount')} subtitle={t('platform.annual_discount_hint')} className="mt-4">
        <div className="flex items-end gap-2">
          <Field label="%" className="w-32"><input type="number" min={0} max={90} className="input" value={discount} onChange={(e) => setDiscount(e.target.value)} /></Field>
          <Button variant="primary" onClick={async () => { if (await run(() => put('/platform/billing-settings', { annual_discount: discount }), t('common.saved'))) reload(); }}>{t('common.save')}</Button>
        </div>
      </Card>
      <SidePanel open={!!edit} onClose={() => setEdit(null)} title={edit ? (lang === 'ar' ? edit.name_ar : edit.name_en) : ''}
        footer={<><Button onClick={() => setEdit(null)}>{t('common.cancel')}</Button><Button variant="primary" onClick={save}>{t('common.save')}</Button></>}>
        {edit && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <Field label={t('platform.name_ar')}><input className="input" {...f('name_ar')} /></Field>
              <Field label={t('platform.name_en')}><input className="input" dir="ltr" {...f('name_en')} /></Field>
              <Field label={t('platform.price_monthly')}><input type="number" min={0} className="input" {...f('price_monthly')} /></Field>
              <Field label={t('platform.price_annual')} hint={t('platform.annual_empty', { n: discount })}><input type="number" min={0} className="input" placeholder={t('platform.auto')} {...f('price_annual')} /></Field>
              <Field label={t('platform.sort')} hint={t('platform.sort_hint')}><input type="number" min={0} className="input" {...f('sort')} /></Field>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">{t('platform.limits')}</div>
              <p className="mb-2 text-xs text-zinc-500">{t('platform.limits_hint')}</p>
              <div className="grid grid-cols-2 gap-2">
                {LIMIT_KEYS.map((k) => (
                  <Field key={k} label={t(`billing.${k}`)} hint={(LATER_KEYS as readonly string[]).includes(k) ? t('platform.limit_later') : undefined}>
                    <input type="number" min={0} className="input" placeholder="∞" {...f(limitColumn(k))} />
                  </Field>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 text-xs font-medium text-zinc-600 dark:text-zinc-400">{t('platform.features')}</div>
              <div className="space-y-1.5">
                {FEATURE_KEYS.map((k) => (
                  <label key={k} className="flex items-center gap-2">
                    <input type="checkbox" checked={edit.features.includes(k)} onChange={(e) => setEdit({ ...edit, features: e.target.checked ? [...edit.features, k] : edit.features.filter((x: string) => x !== k) })} />
                    {t(`feature.${k}`)}
                  </label>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
              <input type="checkbox" disabled={edit.key === 'free'} checked={!!edit.is_public && !!edit.is_active}
                onChange={(e) => setEdit({ ...edit, is_public: e.target.checked ? 1 : 0, is_active: e.target.checked ? 1 : 0 })} />
              {t('platform.on_sale')}
            </label>
            {edit.key === 'free' && <p className="text-xs text-zinc-500">{t('platform.free_hint')}</p>}
          </div>
        )}
      </SidePanel>
      <Card title={t('platform.bank_details')} subtitle={t('platform.bank_hint')} className="mt-4">
        <textarea className="input" rows={4} value={bank} onChange={(e) => setBank(e.target.value)} />
        <div className="mt-2 flex justify-end"><Button variant="primary" onClick={() => run(() => put('/platform/bank-details', { bank_details: bank }), t('common.saved'))}>{t('common.save')}</Button></div>
      </Card>
      <Maintenance />
    </>
  );
}

// Closes every company for maintenance (their staff see the message), while the owner's account keeps working.
function Maintenance() {
  const { t } = useI18n();
  const run = useAction();
  const [m, setM] = useState<{ on: boolean; message: string } | null>(null);
  useEffect(() => { get<{ on: boolean; message: string }>('/platform/maintenance').then(setM); }, []);
  if (!m) return null;
  return (
    <Card title={t('platform.maintenance')} subtitle={t('platform.maintenance_hint')} className="mt-4">
      <label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={m.on} onChange={(e) => setM({ ...m, on: e.target.checked })} />{t('platform.maintenance_on')}</label>
      <Field label={t('platform.maintenance_message')}><textarea className="input" rows={2} value={m.message} onChange={(e) => setM({ ...m, message: e.target.value })} /></Field>
      <div className="mt-2 flex justify-end"><Button variant={m.on ? 'danger' : 'primary'} onClick={() => run(() => put('/platform/maintenance', m), t('common.saved'))}>{t('common.save')}</Button></div>
    </Card>
  );
}

function Payments({ plans }: { plans: Plan[] }) {
  const { t, lang } = useI18n();
  const run = useAction();
  const { confirm } = useUi();
  const [status, setStatus] = useState('pending');
  const [rows, setRows] = useState<any[] | null>(null);
  const load = useCallback(() => get<any[]>('/platform/payments', { status }).then(setRows), [status]);
  useEffect(() => { load(); }, [load]);
  const pname = (k: string) => { const p = plans.find((x) => x.key === k); return p ? (lang === 'ar' ? p.name_ar : p.name_en) : k; };
  const decide = async (id: number, decision: 'approve' | 'reject') => {
    const ok = await confirm({ title: t(`platform.${decision}_title`), tone: decision === 'approve' ? 'primary' : 'danger', input: { label: t('platform.review_note') } });
    if (!ok) return;
    if (await run(() => post(`/platform/payments/${id}/${decision}`, { note: ok.text }), t('common.saved'))) load();
  };
  return (
    <>
      <Tabs value={status} onChange={setStatus} tabs={['pending', 'approved', 'rejected', ''].map((s) => ({ key: s, label: s ? t(`billing.pay.${s}`) : t('common.all') }))} />
      {!rows ? <Loading /> : (
        <Card pad={false} className="mt-3">
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="border-b border-zinc-100 dark:border-zinc-800">{['billing.date', 'platform.company', 'billing.plan', 'billing.amount', 'billing.reference', 'billing.receipt', 'billing.status', ''].map((k) => <th key={k} className={th}>{k && t(k)}</th>)}</tr></thead>
            <tbody>{rows.map((p) => (
              <tr key={p.id} className="border-b border-zinc-50 last:border-0 dark:border-zinc-800/60">
                <td className={cx(td, 'num')}>{p.created_at.slice(0, 10)}</td>
                <td className={td}>{p.tenant_name}</td>
                <td className={td}>{pname(p.plan_key)} · {t(`billing.${p.billing_cycle}`)}</td>
                <td className={cx(td, 'num')}>{Number(p.amount).toLocaleString()}</td>
                <td className={cx(td, 'num')}>{p.reference ?? '—'}{p.note && <div className="text-xs text-zinc-500">{p.note}</div>}</td>
                <td className={td}>{p.receipt_id ? <a className="text-brand hover:underline" href={`/api/platform/payments/${p.id}/receipt`} target="_blank" rel="noreferrer">{t('platform.open')}</a> : '—'}</td>
                <td className={td}><Badge tone={PAY_TONE[p.status]}>{t(`billing.pay.${p.status}`)}</Badge></td>
                <td className={cx(td, 'whitespace-nowrap')}>{p.status === 'pending' && <div className="flex gap-1.5"><Button size="sm" variant="primary" onClick={() => decide(p.id, 'approve')}>{t('platform.approve')}</Button><Button size="sm" onClick={() => decide(p.id, 'reject')}>{t('platform.reject')}</Button></div>}</td>
              </tr>))}
              {!rows.length && <tr><td colSpan={8} className="p-6 text-center text-zinc-500">{t('platform.no_payments')}</td></tr>}
            </tbody>
          </table></div>
        </Card>
      )}
    </>
  );
}

// The platform owner's dashboard: subscribed companies, plans and their prices, payment approvals.
export default function PlatformPage() {
  const { t } = useI18n();
  const { tab = 'overview' } = useParams();
  const nav = useNavigate();
  const { me } = useAuth();
  const { plans, load } = usePlans(!!me?.platform_owner);
  // only the platform owner's account has this dashboard
  if (!me?.platform_owner) return <Navigate to="/admin" replace />;
  return (
    <div>
      <PageHeader title={t('platform.title')} subtitle={t('platform.subtitle')} />
      <div className="mb-4"><Tabs value={tab} onChange={(k) => nav(k === 'overview' ? '/admin/platform' : `/admin/platform/${k}`)}
        tabs={['overview', 'companies', 'plans', 'payments'].map((k) => ({ key: k, label: t(`platform.tab.${k}`) }))} /></div>
      {tab === 'overview' && <Overview plans={plans} />}
      {tab === 'companies' && <Companies plans={plans} />}
      {tab === 'plans' && <Plans plans={plans} reload={load} />}
      {tab === 'payments' && <Payments plans={plans} />}
    </div>
  );
}
