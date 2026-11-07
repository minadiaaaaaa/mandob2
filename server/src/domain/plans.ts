// What a plan is made of, in one place: its quotas, its features, its prices. Every limit and every locked feature
// in the system is read from here (quotas.ts counts, subscription.ts decides), never written as a number in a route.
import { asPlatform, setting, withTenant } from '../db.js';

// ---------- quotas ----------
// Counted now: each has its table and what "not counted" means there (a terminated rider, a switched-off contract…).
// `owner`: the company owner's own account is not one of the plan's places.
export type QuotaKind = 'riders' | 'vehicles' | 'users' | 'platforms' | 'contracts';
export type Quota = { table: string; column: string; counted: string; off: { column: string; value: string | number }; owner?: boolean };
export const QUOTAS: Record<QuotaKind, Quota> = {
  riders: { table: 'riders', column: 'max_riders', counted: "status <> 'terminated'", off: { column: 'status', value: 'terminated' } },
  vehicles: { table: 'vehicles', column: 'max_vehicles', counted: "status <> 'retired'", off: { column: 'status', value: 'retired' } },
  users: { table: 'users', column: 'max_users', counted: "status <> 'disabled'", off: { column: 'status', value: 'disabled' }, owner: true },
  // the delivery platforms the company works for (HungerStation, …): the `companies` table
  platforms: { table: 'companies', column: 'max_platforms', counted: 'is_active = 1', off: { column: 'is_active', value: 0 } },
  contracts: { table: 'contracts', column: 'max_contracts', counted: 'is_active = 1', off: { column: 'is_active', value: 0 } },
};
export const QUOTA_KINDS = Object.keys(QUOTAS) as QuotaKind[];
export const kindOfTable = (table: string) => QUOTA_KINDS.find((k) => QUOTAS[k].table === table);
// Set on every plan now; counted by the phases that add their screens (branches and designations: phase 2;
// invoice buyers, open drafts and invoices a month: phase 7).
export const LATER_QUOTAS = ['branches', 'designations', 'invoice_buyers', 'open_invoice_drafts', 'invoices_month'] as const;
// devices each staff account may be signed in from at once (auth.ts)
export const DEVICE_COLUMN = 'max_devices';
export const LIMIT_COLUMNS = [...QUOTA_KINDS.map((k) => QUOTAS[k].column), ...LATER_QUOTAS.map((k) => `max_${k}`), DEVICE_COLUMN];

// ---------- features a plan can include ----------
export const FEATURES = ['live_rider_details', 'live_multi_city', 'android_app', 'zatca_phase2'] as const;
export type Feature = (typeof FEATURES)[number];

// ---------- the plans every install starts with (LogisTap's tiers); the owner edits them afterwards ----------
export const FREE_PLAN = 'free';
type Defaults = Record<string, number | null>;
export const PLAN_DEFAULTS: { key: string; name_ar: string; name_en: string; sort: number; limits: Defaults; features: Feature[] }[] = [
  { key: FREE_PLAN, name_ar: 'المجانية', name_en: 'Free', sort: 0, features: [],
    limits: { max_riders: 10, max_users: 0, max_vehicles: 10, max_platforms: 1, max_contracts: 2, max_branches: 1, max_designations: 0, max_invoice_buyers: 5, max_open_invoice_drafts: 2, max_invoices_month: 20, max_devices: 2 } },
  { key: 'starter', name_ar: 'البداية', name_en: 'Starter', sort: 1, features: [],
    limits: { max_platforms: 3, max_contracts: 6, max_branches: 2, max_designations: 2, max_invoice_buyers: 20, max_open_invoice_drafts: 5, max_invoices_month: 100, max_devices: 2 } },
  { key: 'growth', name_ar: 'النمو', name_en: 'Growth', sort: 2, features: ['live_rider_details', 'live_multi_city'],
    limits: { max_platforms: 5, max_contracts: 10, max_branches: 5, max_designations: 5, max_invoice_buyers: 50, max_open_invoice_drafts: 10, max_invoices_month: 300, max_devices: 2 } },
  { key: 'scale', name_ar: 'التوسع', name_en: 'Scale', sort: 3, features: [...FEATURES],
    limits: { max_platforms: 8, max_contracts: 16, max_branches: 10, max_designations: 10, max_invoice_buyers: null, max_open_invoice_drafts: null, max_invoices_month: null, max_devices: 3 } },
];

// ---------- prices ----------
// An annual price left empty is twelve months less the platform's annual discount (15% unless the owner changes it).
export const ANNUAL_DISCOUNT_KEY = 'platform.annual_discount';
export async function annualDiscount() {
  const raw = await asPlatform(() => withTenant(0, () => setting(ANNUAL_DISCOUNT_KEY)));
  const v = raw == null || raw === '' ? NaN : Number(raw);
  return Number.isFinite(v) && v >= 0 && v <= 90 ? v : 15;
}
export const annualPrice = (monthly: number, annual: number | null | undefined, discount: number) =>
  annual != null ? Number(annual) : Math.round(Number(monthly) * 12 * (1 - discount / 100) * 100) / 100;
// The plan as companies see it: the annual price filled in, the features as a list.
export async function priced<P extends { price_monthly: number; price_annual: number | null; features?: unknown }>(plans: P[]) {
  const d = await annualDiscount();
  return plans.map((p) => ({ ...p, price_monthly: Number(p.price_monthly), price_annual: annualPrice(p.price_monthly, p.price_annual, d), annual_auto: p.price_annual == null, features: featureList(p.features) }));
}
export function featureList(raw: unknown): Feature[] {
  let v = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = []; } }
  return Array.isArray(v) ? (v.filter((f) => (FEATURES as readonly string[]).includes(f)) as Feature[]) : [];
}
