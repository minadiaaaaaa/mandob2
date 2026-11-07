import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { get } from '../api';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';
import type { FeatureKey, LimitKey, QuotaKey } from '../plans';
import { cx } from './kit';

export type PlanUsage = { limits: Record<LimitKey, number | null> | null; usage: Record<QuotaKey, number> | null; paused: Record<string, number> | null; features: FeatureKey[] };
// one read for every counter on the screen, refreshed after a minute (and on demand after adding a record)
let cached: { at: number; user: number; p: Promise<PlanUsage> } | null = null;
export function forgetPlanUsage() { cached = null; }
export function usePlanUsage(): PlanUsage | null {
  const { me } = useAuth();
  const [u, setU] = useState<PlanUsage | null>(null);
  useEffect(() => {
    if (!me || me.platform_owner) return;
    if (!cached || cached.user !== me.id || Date.now() - cached.at > 60_000)
      cached = { at: Date.now(), user: me.id, p: get<PlanUsage>('/plan/usage').catch((e) => { cached = null; throw e; }) };
    let live = true;
    cached.p.then((r) => live && setU(r)).catch(() => {});
    return () => { live = false; };
  }, [me]);
  return u;
}

// "Riders 37 / 50" next to a list's title; amber near the limit, red at or over it. Nothing for unlimited plans.
export function PlanCounter({ kind }: { kind: QuotaKey }) {
  const { t } = useI18n();
  const u = usePlanUsage();
  const max = u?.limits?.[kind];
  if (!u?.usage || max == null) return null;
  const used = u.usage[kind];
  const tone = used >= max ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'
    : used >= max * 0.85 ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300'
    : 'border-zinc-200 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400';
  return (
    <Link to="/admin/billing" title={t('plan.counter_hint')} className={cx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs', tone)}>
      {t('plan.counter', { what: t(`billing.${kind}`) })} <span className="num font-medium" dir="ltr">{used} / {max}</span>
    </Link>
  );
}

// a record above the plan's limits: shown greyed, its file opens again after an upgrade
export function PausedMark() {
  const { t } = useI18n();
  return <span className="inline-flex items-center gap-1 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" title={t('plan.paused_hint')}><Lock className="size-3" />{t('plan.paused')}</span>;
}

// a feature the plan does not include
export function LockedFeature({ feature }: { feature: FeatureKey }) {
  const { t } = useI18n();
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
      <Lock className="mx-auto mb-2 size-4" />
      <div>{t('plan.locked', { feature: t(`feature.${feature}`) })}</div>
      <Link to="/admin/billing" className="mt-2 inline-block text-brand hover:underline">{t('plan.see_plans')}</Link>
    </div>
  );
}
