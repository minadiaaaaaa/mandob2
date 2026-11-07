// The subscription domain: a company (tenant), its plan, and whether it may work right now.
// Routes stay thin: they call these rules instead of repeating them (routes/saas.ts, auth, portal, sync).
import { asPlatform, exec, one, tx, withTenant } from '../db.js';
import { audit } from '../audit.js';
import { FREE_PLAN, LATER_QUOTAS, QUOTAS, QUOTA_KINDS, featureList, type Feature, type QuotaKind } from './plans.js';

export type Tenant = {
  id: number; slug: string; name: string; name_en: string | null; phone: string | null; email: string | null; plan_key: string;
  status: 'trial' | 'active' | 'expired' | 'suspended'; billing_cycle: 'monthly' | 'annual'; trial_ends_at: string | null; period_ends_at: string | null;
  extra_riders: number; extra_users: number; extra_vehicles: number; owner_note: string | null; created_at: string;
  next_plan_key: string | null; next_payment_id: number | null;
};
export type Plan = { key: string; name_ar: string; name_en: string; price_monthly: number; price_annual: number | null; max_riders: number | null; max_users: number | null; max_vehicles: number | null;
  features: unknown; is_public: number; is_active: number; sort: number } & Record<string, unknown>;

export const nowUtc = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
export const plusDays = (from: string | null, days: number) => {
  const base = from && from > nowUtc() ? new Date(from.replace(' ', 'T') + 'Z') : new Date();
  return new Date(base.getTime() + days * 86400000).toISOString().slice(0, 19).replace('T', ' ');
};

// ---------- the company of the request, with a short cache (status changes apply within seconds) ----------
const tenantCache = new Map<number, { at: number; t: Tenant | undefined }>();
export async function loadTenant(id: number) {
  const c = tenantCache.get(id);
  if (c && Date.now() - c.at < 10000) return c.t;
  const t = await asPlatform(() => one<Tenant>('SELECT * FROM tenants WHERE id = ?', [id]));
  tenantCache.set(id, { at: Date.now(), t });
  return t;
}
export const forgetTenant = (id: number) => tenantCache.delete(id);
export async function plan(key: string) { return asPlatform(() => one<Plan>('SELECT * FROM plans WHERE `key` = ?', [key])); }

// Days left and whether the company can still change data. An active company with no end date (the Free plan)
// stays usable: `days_left` is null then.
export function standing(t: Tenant) {
  const end = t.status === 'trial' ? t.trial_ends_at : t.status === 'active' ? t.period_ends_at : null;
  const open = t.status === 'active' && !end;
  const ms = end ? new Date(end.replace(' ', 'T') + 'Z').getTime() - Date.now() : 0;
  const usable = open || ((t.status === 'trial' || t.status === 'active') && ms > 0);
  return { usable, ends_at: end, days_left: open ? null : usable ? Math.ceil(ms / 86400000) : 0, state: usable ? t.status : t.status === 'suspended' ? 'suspended' : 'expired' };
}

// The company's limits: its plan's, plus the extra places the owner granted (riders, staff, vehicles).
// null means unlimited. `devices` is per staff account.
export type Limits = Record<QuotaKind | (typeof LATER_QUOTAS)[number] | 'devices', number | null>;
export async function limits(t: Tenant): Promise<Limits> {
  return limitsOf(await plan(t.plan_key), t);
}
// the same for a plan the company is not on yet (a change of plan must fit what it already has)
export function limitsOf(p: Plan | undefined, t: Tenant): Limits {
  const num = (v: unknown) => (v == null ? null : Number(v));
  const out = {} as Limits;
  for (const k of QUOTA_KINDS) {
    const base = num(p?.[QUOTAS[k].column]);
    const extra = Number((t as Record<string, unknown>)[`extra_${k}`] ?? 0);
    out[k] = base == null ? null : base + extra;
  }
  for (const k of LATER_QUOTAS) out[k] = num(p?.[`max_${k}`]);
  out.devices = num(p?.max_devices);
  return out;
}
// How many devices one staff account may be signed in from at once (null: no limit, as for the platform owner).
export async function deviceLimit(tenantId: number) {
  const t = tenantId ? await loadTenant(tenantId) : undefined;
  return t ? (await limits(t)).devices : null;
}
export async function features(t: Tenant | undefined): Promise<Feature[]> {
  return t ? featureList((await plan(t.plan_key))?.features) : [];
}

// When the trial or the paid period is over: a smaller plan already paid for (a downgrade approved during the
// period) starts now; otherwise the company falls back to Free. Nothing is deleted; records above Free's limits are
// paused (quotas.ts). Runs once per ending, under the company's row lock.
async function renew(id: number) {
  await asPlatform(() => tx(async () => {
    const t = await one<Tenant>('SELECT * FROM tenants WHERE id = ? FOR UPDATE', [id]);
    if (!t || (t.status !== 'trial' && t.status !== 'active') || standing(t).usable) return null;
    const paid = t.next_payment_id ? await one<{ plan_key: string; billing_cycle: string; period_end: string }>(
      "SELECT plan_key, billing_cycle, period_end FROM subscription_payments WHERE id = ? AND tenant_id = ? AND status = 'approved'", [t.next_payment_id, id]) : undefined;
    if (paid && paid.period_end > nowUtc())
      await exec("UPDATE tenants SET status = 'active', plan_key = ?, billing_cycle = ?, period_ends_at = ?, next_plan_key = NULL, next_payment_id = NULL, updated_at = UTC_TIMESTAMP() WHERE id = ?",
        [paid.plan_key, paid.billing_cycle, paid.period_end, id]);
    else
      await exec("UPDATE tenants SET status = 'active', plan_key = ?, billing_cycle = 'monthly', period_ends_at = NULL, next_plan_key = NULL, next_payment_id = NULL, updated_at = UTC_TIMESTAMP() WHERE id = ?",
        [FREE_PLAN, id]);
    return paid ? `starts ${paid.plan_key}` : `falls back to ${FREE_PLAN}`;
  })).then(async (details) => { if (details) await withTenant(id, () => audit(null, { action: "subscription.renewal", entity_type: "tenant", entity_id: id, actor_type: "system", details })); });
  forgetTenant(id);
}
// ---------- whether a company may work right now: one rule for staff, riders and the sync token ----------
// A suspended company is stopped. An ended trial or period can still read (and do what `allow` lists), but not change.
export async function companyAccess(tenantId: number, method: string, path: string, allow: RegExp[] = []): Promise<{ status: number; error: string } | null> {
  if (tenantId === 0) return null; // the platform itself
  const t = await loadTenant(tenantId);
  if (!t) return { status: 401, error: 'session_ended' };
  if (t.status === 'suspended') return { status: 403, error: 'company_suspended' };
  let st = standing(t);
  if (!st.usable && (t.status === 'trial' || t.status === 'active')) {
    await renew(t.id);
    const now = await loadTenant(t.id);
    if (now) st = standing(now);
  }
  // a company the owner set to "expired" by hand stays read-only until it pays
  if (!st.usable && method !== 'GET' && !allow.some((r) => r.test(path))) return { status: 402, error: 'subscription_inactive' };
  return null;
}
