// What a plan is made of, as the screens show it (the rules themselves live in server/src/domain/plans.ts).
export const QUOTA_KEYS = ['riders', 'vehicles', 'users', 'platforms', 'contracts', 'branches', 'designations'] as const;
// set on every plan now, counted once their screens exist (invoices: phase 7)
export const LATER_KEYS = ['invoice_buyers', 'open_invoice_drafts', 'invoices_month'] as const;
export const LIMIT_KEYS = [...QUOTA_KEYS, ...LATER_KEYS, 'devices'] as const;
export type QuotaKey = (typeof QUOTA_KEYS)[number];
export type LimitKey = (typeof LIMIT_KEYS)[number];
export const FEATURE_KEYS = ['live_rider_details', 'live_multi_city', 'android_app', 'zatca_phase2'] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];
export const limitColumn = (k: LimitKey) => `max_${k}`;

export type Plan = {
  key: string; name_ar: string; name_en: string; price_monthly: number; price_annual: number; annual_auto: boolean; annual_price?: number;
  features: FeatureKey[]; is_public?: number; is_active?: number; sort: number;
} & { [column: string]: unknown };
export const planLimit = (p: Plan, k: LimitKey) => (p[limitColumn(k)] == null ? null : Number(p[limitColumn(k)]));
