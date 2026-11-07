import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { ApiError, api, get } from '../../api';
import { useAuth } from '../../auth';
import { useI18n } from '../../i18n';
import { FEATURE_KEYS, LATER_KEYS, QUOTA_KEYS, planLimit, type FeatureKey, type LimitKey, type Plan, type QuotaKey } from '../../plans';
import { Alert, Badge, Button, Card, Field, Loading, Modal, PageHeader, cx, useAction, type Tone } from '../../ui/kit';

type Billing = {
  company: { name: string; status: string; billing_cycle: 'monthly' | 'annual' };
  plan: { key: string; name_ar: string; name_en: string } | null;
  next_plan: { key: string; name_ar: string; name_en: string } | null;
  state: 'trial' | 'active' | 'expired' | 'suspended'; days_left: number | null; ends_at: string | null;
  limits: Record<LimitKey, number | null>; usage: Record<QuotaKey, number>; paused: Record<'riders' | 'vehicles' | 'users', number>;
  features: FeatureKey[]; plans: Plan[]; bank_details: string | null;
  payments: { id: number; plan_key: string; billing_cycle: string; amount: number; reference: string | null; status: string; review_note: string | null; created_at: string; period_end: string | null }[];
};
export const STATE_TONE: Record<string, Tone> = { trial: 'blue', active: 'green', expired: 'red', suspended: 'grey' };
const PAY_TONE: Record<string, Tone> = { pending: 'amber', approved: 'green', rejected: 'red' };

export function UsageRow({ label, used, max }: { label: string; used: number; max: number | null }) {
  const { t } = useI18n();
  const pct = max ? Math.min(100, Math.round((used / max) * 100)) : used > 0 && max === 0 ? 100 : 0;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span className="text-zinc-600 dark:text-zinc-400">{label}</span>
        <span className="num font-medium">{used}<span className="text-zinc-400"> / {max ?? t('billing.unlimited')}</span></span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div className={cx('h-full rounded-full', max != null && used > max ? 'bg-red-500' : pct >= 85 ? 'bg-amber-500' : 'bg-brand')} style={{ width: `${max != null ? pct : 0}%` }} />
      </div>
    </div>
  );
}

// "Plan & billing": the company's plan, what it uses, and the upgrade or renewal request.
export default function BillingPage() {
  const { t, lang } = useI18n();
  const { can, refresh, me } = useAuth();
  const run = useAction();
  const [data, setData] = useState<Billing | null>(null);
  const [cycle, setCycle] = useState<'monthly' | 'annual'>('monthly');
  const [chosen, setChosen] = useState<Plan | null>(null);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [tooSmall, setTooSmall] = useState<QuotaKey[] | null>(null);
  const owner = !!me?.platform_owner;
  const load = useCallback(() => (owner ? Promise.resolve() : get<Billing>('/billing').then(setData)), [owner]);
  useEffect(() => { load(); }, [load]);
  // the platform itself has no subscription: its owner manages everyone's plans instead
  if (owner) return <Navigate to="/admin/platform/plans" replace />;
  if (!data) return <Loading />;
  const pname = (p: { name_ar: string; name_en: string } | null) => (p ? (lang === 'ar' ? p.name_ar : p.name_en) : '—');
  const pending = data.payments.some((p) => p.status === 'pending');
  const onFree = data.plan?.key === 'free';
  const paused = Object.entries(data.paused ?? {}).filter(([, n]) => n > 0);
  // numbers stay in Latin digits everywhere in the system
  const money = (n: number) => `${Number(n).toLocaleString('en-US')} ${t('billing.sar')}`;
  // what the chosen plan would leave over the limit, so the screen says it before the request is sent
  const overIn = (p: Plan) => QUOTA_KEYS.filter((k) => { const max = planLimit(p, k); return max != null && data.usage[k] > max; });

  const send = async () => {
    if (!chosen) return;
    setBusy(true);
    const fd = new FormData();
    fd.set('plan_key', chosen.key); fd.set('billing_cycle', cycle); fd.set('reference', reference); fd.set('note', note);
    if (file) fd.set('receipt', file);
    const ok = await run(async () => {
      try { return await api('/billing/request', { method: 'POST', body: fd }); }
      catch (e) { if (e instanceof ApiError && e.code === 'plan_too_small') setTooSmall((e.params.kinds as QuotaKey[]) ?? []); throw e; }
    }, t('billing.request_sent'));
    setBusy(false);
    if (ok) { setChosen(null); setReference(''); setNote(''); setFile(null); load(); refresh(); }
  };

  return (
    <div className="max-w-5xl">
      <PageHeader title={t('billing.title')} subtitle={t('billing.subtitle')} />
      {data.state === 'expired' && <div className="mb-4"><Alert tone="red" title={t('billing.expired_title')}>{t('billing.expired_body')}</Alert></div>}
      {onFree && <div className="mb-4"><Alert tone="blue" title={t('billing.free_title')}>{t('billing.free_body')}</Alert></div>}
      {paused.length > 0 && (
        <div className="mb-4"><Alert tone="amber" title={t('billing.paused_title')}>
          {t('billing.paused_body', { list: paused.map(([k, n]) => `${n} ${t(`billing.${k}`)}`).join('، ') })}
        </Alert></div>
      )}
      {pending && <div className="mb-4"><Alert tone="amber">{t('billing.pending_note')}</Alert></div>}
      {data.next_plan && <div className="mb-4"><Alert tone="blue">{t('billing.next_plan', { plan: pname(data.next_plan), date: data.ends_at?.slice(0, 10) ?? '' })}</Alert></div>}

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs text-zinc-500">{t('billing.current_plan')}</div>
              <div className="mt-1 text-xl font-semibold">{pname(data.plan)}</div>
            </div>
            <Badge tone={STATE_TONE[data.state]}>{t(`billing.state.${data.state}`)}</Badge>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 border-t border-zinc-100 pt-4 text-sm dark:border-zinc-800">
            <div><div className="text-xs text-zinc-500">{data.state === 'trial' ? t('billing.trial_ends') : t('billing.renews_on')}</div><div className="num mt-0.5 font-medium">{data.ends_at?.slice(0, 10) ?? t('billing.no_end')}</div></div>
            <div><div className="text-xs text-zinc-500">{t('billing.days_left')}</div><div className="num mt-0.5 font-medium">{data.days_left ?? '—'}</div></div>
          </div>
          <div className="mt-4 border-t border-zinc-100 pt-3 dark:border-zinc-800">
            <div className="mb-2 text-xs text-zinc-500">{t('billing.features')}</div>
            <ul className="space-y-1 text-sm">
              {FEATURE_KEYS.map((k) => (
                <li key={k} className={cx('flex items-center gap-2', !data.features.includes(k) && 'text-zinc-400')}>
                  {data.features.includes(k) ? <span className="size-1.5 rounded-full bg-brand" /> : <Lock className="size-3" />}{t(`feature.${k}`)}
                </li>
              ))}
            </ul>
          </div>
        </Card>
        <Card title={t('billing.usage')}>
          <div className="space-y-4">
            {QUOTA_KEYS.map((k) => <UsageRow key={k} label={t(`billing.${k}`)} used={data.usage[k]} max={data.limits[k]} />)}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-zinc-100 pt-3 text-xs text-zinc-500 dark:border-zinc-800">
            {[...LATER_KEYS, 'devices' as const].map((k) => <div key={k} className="flex justify-between"><span>{t(`billing.${k}`)}</span><span className="num">{data.limits[k] ?? '∞'}</span></div>)}
          </div>
        </Card>
      </div>

      <div className="mb-3 mt-8 flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="text-base font-semibold">{t('billing.plans')}</h2><p className="text-xs text-zinc-500">{t('billing.plans_hint')}</p></div>
        <div className="inline-flex rounded-lg border border-zinc-200 p-0.5 text-sm dark:border-zinc-700">
          {(['monthly', 'annual'] as const).map((c) => (
            <button key={c} onClick={() => setCycle(c)} className={cx('rounded-md px-3 py-1', cycle === c ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'text-zinc-600 dark:text-zinc-400')}>{t(`billing.${c}`)}</button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {data.plans.map((p) => {
          const current = data.plan?.key === p.key && data.state === 'active';
          const price = cycle === 'annual' ? p.price_annual : p.price_monthly;
          const over = overIn(p);
          const free = p.key === 'free';
          return (
            <div key={p.key} className={cx('flex flex-col rounded-xl border bg-white p-4 dark:bg-zinc-900', current ? 'border-brand' : 'border-zinc-200 dark:border-zinc-800')}>
              <div className="flex items-center justify-between"><span className="font-semibold">{pname(p)}</span>{current && <Badge tone="green">{t('billing.your_plan')}</Badge>}</div>
              <div className="mt-3">
                <span className="num text-2xl font-bold">{free ? t('billing.free_price') : price ? money(price) : t('billing.price_on_request')}</span>
                {!free && price ? <span className="text-xs text-zinc-500"> / {t(cycle === 'annual' ? 'billing.per_year' : 'billing.per_month')}</span> : null}
                {!free && cycle === 'annual' && p.annual_auto && p.price_monthly > 0 && <div className="text-xs text-green-700 dark:text-green-400">{t('billing.annual_saving')}</div>}
              </div>
              <ul className="mt-4 flex-1 space-y-1.5 text-sm text-zinc-600 dark:text-zinc-400">
                {QUOTA_KEYS.map((k) => <li key={k}><span className="num font-medium text-zinc-900 dark:text-zinc-100">{planLimit(p, k) ?? '∞'}</span> {t(`billing.${k}`)}</li>)}
                {p.features.map((k) => <li key={k} className="text-xs">✓ {t(`feature.${k}`)}</li>)}
              </ul>
              {over.length > 0 && !current && <p className="mt-2 text-xs text-red-600">{t('billing.over_in_plan', { list: over.map((k) => t(`billing.${k}`)).join('، ') })}</p>}
              {can('subscription.manage') && !free && (
                <Button className="mt-4 w-full" variant={current ? 'secondary' : 'primary'} disabled={pending || (over.length > 0 && !current)} onClick={() => { setTooSmall(null); setChosen(p); }}>
                  {current ? t('billing.renew') : t('billing.choose')}
                </Button>
              )}
              {free && <p className="mt-4 text-xs text-zinc-500">{t('billing.free_automatic')}</p>}
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-zinc-500">{t('billing.custom_note')}</p>

      {data.payments.length > 0 && (
        <Card title={t('billing.history')} className="mt-8" pad={false}>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-xs text-zinc-500"><tr className="border-b border-zinc-100 dark:border-zinc-800">
              {['billing.date', 'billing.plan', 'billing.cycle', 'billing.amount', 'billing.reference', 'billing.status'].map((k) => <th key={k} className="px-4 py-2 text-start font-medium">{t(k)}</th>)}
            </tr></thead>
            <tbody>{data.payments.map((p) => (
              <tr key={p.id} className="border-b border-zinc-50 last:border-0 dark:border-zinc-800/60">
                <td className="num px-4 py-2">{p.created_at.slice(0, 10)}</td>
                <td className="px-4 py-2">{pname(data.plans.find((x) => x.key === p.plan_key) ?? null)}</td>
                <td className="px-4 py-2">{t(`billing.${p.billing_cycle}`)}</td>
                <td className="num px-4 py-2">{money(p.amount)}</td>
                <td className="num px-4 py-2">{p.reference ?? '—'}</td>
                <td className="px-4 py-2"><Badge tone={PAY_TONE[p.status]}>{t(`billing.pay.${p.status}`)}</Badge>{p.review_note && <div className="mt-0.5 text-xs text-zinc-500">{p.review_note}</div>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </Card>
      )}

      <Modal open={!!chosen} onClose={() => setChosen(null)} title={t('billing.request_title', { plan: pname(chosen) })}
        footer={<><Button onClick={() => setChosen(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={busy} onClick={send}>{t('billing.send_request')}</Button></>}>
        {chosen && (
          <div className="space-y-3 text-sm">
            <div className="flex justify-between rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/60">
              <span>{t(`billing.${cycle}`)}</span>
              <b className="num">{money(cycle === 'annual' ? chosen.price_annual : chosen.price_monthly)}</b>
            </div>
            {data.state === 'active' && data.ends_at && chosen.sort < (data.plans.find((p) => p.key === data.plan?.key)?.sort ?? 0) && (
              <Alert tone="blue">{t('billing.downgrade_waits', { date: data.ends_at.slice(0, 10) })}</Alert>
            )}
            {tooSmall && tooSmall.length > 0 && <Alert tone="red">{t('billing.over_in_plan', { list: tooSmall.map((k) => t(`billing.${k}`)).join('، ') })}</Alert>}
            <div>
              <div className="mb-1 text-xs font-medium text-zinc-500">{t('billing.transfer_to')}</div>
              <pre className="whitespace-pre-wrap rounded-lg border border-zinc-200 p-3 font-sans text-sm dark:border-zinc-700">{data.bank_details || t('billing.no_bank_details')}</pre>
            </div>
            <Field label={t('billing.reference')}><input className="input" dir="ltr" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
            <Field label={t('billing.receipt')}><input type="file" accept="image/*,application/pdf" className="block w-full text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
            <Field label={t('billing.note')}><textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <p className="text-xs text-zinc-500">{t('billing.review_note')}</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
