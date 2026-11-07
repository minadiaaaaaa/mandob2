import { Router, type NextFunction, type Request, type Response } from 'express';
import { randomBytes } from 'node:crypto';
import { asPlatform, exec, one, q, setSetting, setting, tx, withTenant } from '../db.js';
import { companyAccess, features, forgetTenant, limits, limitsOf, loadTenant, nowUtc, plan, plusDays, standing, type Plan, type Tenant } from '../domain/subscription.js';
import { pausedCounts, pausedIds, usage } from '../domain/quotas.js';
import { ANNUAL_DISCOUNT_KEY, FEATURES, FREE_PLAN, LIMIT_COLUMNS, QUOTA_KINDS, annualDiscount, annualPrice, priced, type Feature } from '../domain/plans.js';
import { HttpError, clean, fail, fieldError } from '../http.js';
import { can, clientIp, hashPassword, platformOnly, requireUser } from '../auth.js';
import { audit } from '../audit.js';
import { attach, sendStored, upload } from '../files.js';
import { seedTenant, TRIAL_DAYS, TRIAL_PLAN } from '../seed.js';
import { COMPANY_ADMIN } from '../perms.js';

// The SaaS layer: companies sign up, get a 14-day trial, and stay inside their plan's limits.
// The platform owner (company 0) manages companies, plans and payments from the owner dashboard.
export const signupRouter = Router();
export const billingRouter = Router();
export const platformRouter = Router();

const STAFF_ALWAYS = [/^\/api\/me$/, /^\/api\/auth\//, /^\/api\/billing/, /^\/api\/profile/, /^\/api\/notifications\/mine/];
export async function subscriptionGate(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return next();
  const refused = await companyAccess(req.user.tenant_id, req.method, req.originalUrl.split('?')[0], STAFF_ALWAYS);
  if (refused) return res.status(refused.status).json({ error: refused.error });
  next();
}

// A feature the company's plan does not include answers "locked" (the screens offer the upgrade).
export const requireFeature = (feature: Feature) => async (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) throw new HttpError(401, 'session_ended');
  if (req.user.tenant_id !== 0 && !(await features(await loadTenant(req.user.tenant_id))).includes(feature)) throw new HttpError(402, 'feature_locked', { feature });
  next();
};

// "Data access paused": after a plan ends or gets smaller, the records above its limits wait for an upgrade.
// A paused staff account can only see who it is and its plan; a paused rider's or vehicle's file does not open.
const PAUSED_RECORD = /^\/(riders|vehicles)\/(\d+)(?:\/|$)/;
const STAFF_PAUSED_OPEN = /^\/(me|auth\/.*|plan\/usage)$/;
export async function pausedGate(req: Request, res: Response, next: NextFunction) {
  if (!req.user || req.user.tenant_id === 0) return next();
  if (!STAFF_PAUSED_OPEN.test(req.path) && (await pausedIds('users')).has(String(req.user.id))) return res.status(402).json({ error: 'staff_paused' });
  const m = PAUSED_RECORD.exec(req.path);
  // the company may still delete a paused record or take it out of the count, to make room for the others
  const freeing = req.method === 'DELETE' || (req.method === 'PATCH' && Object.keys(req.body ?? {}).join() === 'status' && ['terminated', 'retired'].includes(req.body.status));
  if (m && !freeing && (await pausedIds(m[1] as 'riders' | 'vehicles')).has(m[2])) return res.status(402).json({ error: 'record_paused', params: { kind: m[1] } });
  next();
}
// the same mark on list rows, so the screens can show the record greyed with "data access paused"
export async function markPaused<T extends { id: unknown }>(kind: 'riders' | 'vehicles', rows: T[]) {
  const ids = await pausedIds(kind);
  return ids.size ? rows.map((r) => ({ ...r, paused: ids.has(String(r.id)) })) : rows;
}

// ======================================================================== sign-up (public)
const signupTries = new Map<string, number[]>();
const slugOf = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);

// the plans companies can see: prices (the annual one filled in by the discount rule), limits and features
const PUBLIC_PLAN = ['`key`', 'name_ar', 'name_en', 'price_monthly', 'price_annual', 'features', 'sort', ...LIMIT_COLUMNS].join(', ');
const publicPlans = async () => priced(await asPlatform(() => q<Plan>(`SELECT ${PUBLIC_PLAN} FROM plans WHERE is_active = 1 AND is_public = 1 ORDER BY sort, \`key\``)));
signupRouter.get('/public/plans', async (_req, res) => { res.json(await publicPlans()); });

signupRouter.post('/public/signup', async (req, res) => {
  // five sign-ups an hour from one network
  const ip = clientIp(req), now = Date.now();
  const recent = (signupTries.get(ip) ?? []).filter((x) => now - x < 3600000);
  if (recent.length >= 5) fail(429, 'too_many');
  const v = clean(req.body, {
    company_name: { req: true, max: 150 }, company_name_en: { max: 150 }, full_name: { req: true, max: 150 },
    email: { req: true, type: 'email', max: 150 }, phone: { req: true, max: 30 }, password: { req: true, minLen: 8, max: 72 },
  });
  if (req.body.password !== req.body.confirm) fieldError('confirm', 'passwords_differ');
  const email = v.email.toLowerCase();
  if (await asPlatform(() => one('SELECT 1 FROM users WHERE email = ? OR username = ?', [email, email]))) fieldError('email', 'email_taken');
  signupTries.set(ip, [...recent, now]);

  const base = slugOf(v.company_name_en || '') || 'company';
  const tenantId = await asPlatform(async () => {
    let slug = base;
    while (await one('SELECT 1 FROM tenants WHERE slug = ?', [slug])) slug = `${base}-${randomBytes(2).toString('hex')}`;
    return (await exec(`INSERT INTO tenants (slug, name, name_en, phone, email, plan_key, status, trial_ends_at)
      VALUES (?, ?, ?, ?, ?, ?, 'trial', DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY))`, [slug, v.company_name, v.company_name_en, v.phone, email, TRIAL_PLAN, TRIAL_DAYS])).insertId;
  });
  await seedTenant(tenantId);
  await withTenant(tenantId, async () => {
    await setSetting('org.name', v.company_name);
    if (v.company_name_en) await setSetting('org.name_en', v.company_name_en);
    await setSetting('org.support_phone', v.phone);
    await setSetting('org.support_email', email);
    await setSetting('system.installed', '1');
    // the company's owner is its Admin; Super Admin is the platform owner's alone
    const role = await one<{ id: number }>('SELECT id FROM roles WHERE name = ?', [COMPANY_ADMIN]);
    // the owner's account is not counted against the plan's staff accounts
    const hash = await hashPassword(v.password);
    await asPlatform(() => exec('INSERT INTO users (tenant_id, username, full_name, email, password_hash, role_id) VALUES (?, ?, ?, ?, ?, ?)',
      [tenantId, email, v.full_name, email, hash, role!.id]));
    await audit(req, { action: 'company.signup', entity_type: 'tenant', entity_id: tenantId, actor_type: 'guest', actor_name: email });
  });
  res.json({ ok: true, username: email, trial_days: TRIAL_DAYS });
});

// ======================================================================== the company's own subscription
async function billingView(t: Tenant) {
  const st = standing(t);
  const p = await plan(t.plan_key);
  const plans = await publicPlans();
  const next = t.next_plan_key ? await plan(t.next_plan_key) : undefined;
  const bank = { name: await asPlatform(() => withTenant(0, () => one<{ value: string }>("SELECT value FROM settings WHERE `key` = 'billing.bank_details'"))) };
  return {
    company: { id: t.id, name: t.name, slug: t.slug, status: t.status, billing_cycle: t.billing_cycle, created_at: t.created_at },
    plan: p ? { key: p.key, name_ar: p.name_ar, name_en: p.name_en } : null, ...st,
    next_plan: next ? { key: next.key, name_ar: next.name_ar, name_en: next.name_en } : null,
    limits: await limits(t), usage: await usage(), paused: await pausedCounts(), features: await features(t), plans,
    bank_details: bank.name?.value ?? null,
    payments: await q('SELECT id, plan_key, billing_cycle, amount, reference, status, review_note, created_at, reviewed_at, period_end FROM subscription_payments ORDER BY id DESC LIMIT 20'),
  };
}
billingRouter.get('/billing', can('subscription.view'), async (req, res) => {
  const t = await loadTenant(req.user!.tenant_id);
  if (!t) fail(404, 'not_found');
  res.json(await billingView(t!));
});
// The counters the screens show ("Riders 37/50"): any signed-in staff member of a company may read them.
billingRouter.get('/plan/usage', requireUser, async (req, res) => {
  const t = req.user!.tenant_id ? await loadTenant(req.user!.tenant_id) : undefined;
  if (!t) return res.json({ limits: null, usage: null, paused: null, features: [...FEATURES] });
  res.json({ limits: await limits(t), usage: await usage(), paused: await pausedCounts(), features: await features(t) });
});
// Upgrade or renewal: the company transfers the amount and sends the reference (and a receipt); the owner approves.
billingRouter.post('/billing/request', can('subscription.manage'), upload.single('receipt'), async (req, res) => {
  const t = await loadTenant(req.user!.tenant_id);
  if (!t) fail(404, 'not_found');
  const v = clean(req.body, { plan_key: { req: true, max: 30 }, billing_cycle: { req: true, enum: ['monthly', 'annual'] }, reference: { max: 100 }, note: { max: 500 } });
  const p = await plan(v.plan_key);
  if (!p || !p.is_active || !p.is_public) fieldError('plan_key', 'invalid');
  // nobody pays for Free: a company is on it when its paid period ends
  if (p!.key === FREE_PLAN) fieldError('plan_key', 'free_is_automatic');
  if (await one("SELECT 1 FROM subscription_payments WHERE status = 'pending'")) fail(409, 'payment_pending');
  // a smaller plan must still fit what the company already has
  const u = await usage(), max = limitsOf(p, t!);
  const over = QUOTA_KINDS.filter((k) => max[k] != null && u[k] > max[k]!);
  if (over.length) fail(422, 'plan_too_small', { over: over.join(', '), kinds: over });
  const amount = v.billing_cycle === 'annual' ? annualPrice(p!.price_monthly, p!.price_annual, await annualDiscount()) : Number(p!.price_monthly);
  const id = (await exec('INSERT INTO subscription_payments SET ?', [{ plan_key: p!.key, billing_cycle: v.billing_cycle, amount, reference: v.reference, note: v.note, requested_by: req.user!.id }])).insertId;
  if (req.file) await attach(req, 'subscription_payment', id, req.file, 'receipt', null);
  await audit(req, { action: 'subscription.request', entity_type: 'subscription_payment', entity_id: id, after: { ...v, amount } });
  res.json({ id });
});

// ======================================================================== the platform owner's dashboard
platformRouter.use('/platform', platformOnly);

platformRouter.get('/platform/overview', async (_req, res) => {
  const [counts] = await q<any>(`SELECT COUNT(*) total, SUM(status = 'trial') trial, SUM(status = 'active') active, SUM(status = 'expired') expired,
    SUM(status = 'suspended') suspended, SUM(created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)) new_30 FROM tenants`);
  const [money] = await q<any>(`SELECT COALESCE(SUM(CASE WHEN status = 'approved' AND reviewed_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY) THEN amount END), 0) revenue_30,
    COALESCE(SUM(status = 'pending'), 0) pending FROM subscription_payments`);
  const byPlan = await q<any>("SELECT plan_key, COUNT(*) n FROM tenants WHERE status IN ('trial', 'active') GROUP BY plan_key");
  const ending = await q<any>(`SELECT id, name, status, plan_key, COALESCE(CASE WHEN status = 'trial' THEN trial_ends_at END, period_ends_at) ends_at FROM tenants
    WHERE status IN ('trial', 'active') AND COALESCE(CASE WHEN status = 'trial' THEN trial_ends_at END, period_ends_at) < DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 DAY) ORDER BY ends_at LIMIT 10`);
  res.json({ counts, money, byPlan, ending });
});

platformRouter.get('/platform/tenants', async (req, res) => {
  const s = String(req.query.search ?? '').trim();
  const status = String(req.query.status ?? '');
  const rows = await q<any>(`SELECT t.*,
      (SELECT COUNT(*) FROM riders r WHERE r.tenant_id = t.id AND r.status <> 'terminated') riders,
      (SELECT COUNT(*) FROM vehicles v WHERE v.tenant_id = t.id AND v.status <> 'retired') vehicles,
      -- staff accounts besides the company owner, as the plan counts them
      GREATEST((SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id AND u.status <> 'disabled') - 1, 0) users,
      (SELECT MAX(u.last_login_at) FROM users u WHERE u.tenant_id = t.id) last_login_at,
      (SELECT u.email FROM users u WHERE u.tenant_id = t.id ORDER BY u.id LIMIT 1) owner_email
    FROM tenants t WHERE (? = '' OR t.name LIKE ? OR t.email LIKE ? OR t.slug LIKE ?) AND (? = '' OR t.status = ?) ORDER BY t.id DESC LIMIT 500`,
  [s, `%${s}%`, `%${s}%`, `%${s}%`, status, status]);
  res.json(rows.map((r) => ({ ...r, ...standing(r) })));
});

const TENANT_RULES = {
  name: { max: 150 }, name_en: { max: 150 }, phone: { max: 30 }, email: { type: 'email' as const, max: 150 }, plan_key: { max: 30 },
  status: { enum: ['trial', 'active', 'expired', 'suspended'] }, billing_cycle: { enum: ['monthly', 'annual'] },
  trial_ends_at: { type: 'date' as const }, period_ends_at: { type: 'date' as const },
  extra_riders: { type: 'int' as const, min: 0, max: 100000 }, extra_users: { type: 'int' as const, min: 0, max: 10000 }, extra_vehicles: { type: 'int' as const, min: 0, max: 100000 },
  owner_note: { max: 1000 },
};
platformRouter.patch('/platform/tenants/:id', async (req, res) => {
  const id = Number(req.params.id);
  const before = await one<Tenant>('SELECT * FROM tenants WHERE id = ?', [id]);
  if (!before) fail(404, 'not_found');
  const v = clean(req.body, TENANT_RULES, true);
  if (v.plan_key && !(await plan(v.plan_key))) fieldError('plan_key', 'invalid');
  for (const k of ['trial_ends_at', 'period_ends_at']) if (v[k]) v[k] = `${v[k]} 23:59:59`;
  if (Object.keys(v).length) await exec('UPDATE tenants SET ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [v, id]);
  forgetTenant(id);
  await audit(req, { action: 'platform.tenant_update', entity_type: 'tenant', entity_id: id, before, after: v });
  res.json({ ok: true });
});
// Quick actions: extend the trial or the paid period by a number of days.
platformRouter.post('/platform/tenants/:id/extend', async (req, res) => {
  const id = Number(req.params.id);
  const t = await one<Tenant>('SELECT * FROM tenants WHERE id = ?', [id]);
  if (!t) fail(404, 'not_found');
  const v = clean(req.body, { days: { req: true, type: 'int', min: 1, max: 3660 } });
  if (t!.status === 'trial' || (t!.status === 'expired' && !t!.period_ends_at)) await exec("UPDATE tenants SET status = 'trial', trial_ends_at = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?", [plusDays(t!.trial_ends_at, v.days), id]);
  else await exec("UPDATE tenants SET status = 'active', period_ends_at = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?", [plusDays(t!.period_ends_at, v.days), id]);
  forgetTenant(id);
  await audit(req, { action: 'platform.tenant_extend', entity_type: 'tenant', entity_id: id, details: `${v.days} days` });
  res.json({ ok: true });
});

// the owner sees the stored annual price (empty when it follows the discount) next to the computed one, so a plan
// read and saved back keeps following the discount
platformRouter.get('/platform/plans', async (_req, res) => {
  const rows = await q<Plan>('SELECT * FROM plans ORDER BY sort, `key`');
  res.json((await priced(rows)).map((p, i) => ({ ...p, annual_price: p.price_annual, price_annual: rows[i].price_annual == null ? null : Number(rows[i].price_annual) })));
});
const PLAN_RULES = {
  name_ar: { req: true, max: 80 }, name_en: { req: true, max: 80 }, price_monthly: { type: 'num' as const, min: 0, max: 1000000 }, price_annual: { type: 'num' as const, min: 0, max: 10000000 },
  ...Object.fromEntries(LIMIT_COLUMNS.map((c) => [c, { type: 'int' as const, min: 0, max: 1000000 }])),
  is_public: { type: 'bool' as const }, is_active: { type: 'bool' as const }, sort: { type: 'int' as const, min: 0, max: 1000 },
};
platformRouter.put('/platform/plans/:key', async (req, res) => {
  const key = String(req.params.key);
  if (!/^[a-z][a-z0-9_]{1,29}$/.test(key)) fail(422, 'validation');
  const v = clean(req.body, PLAN_RULES);
  const before = await one('SELECT * FROM plans WHERE `key` = ?', [key]);
  // an empty limit means unlimited; an empty annual price follows the discount rule
  for (const k of [...LIMIT_COLUMNS, 'price_annual']) if (!(k in req.body) || req.body[k] === '' || req.body[k] === null) v[k] = null;
  const list: string[] = Array.isArray(req.body.features) ? req.body.features.map(String) : [];
  if (list.some((f) => !(FEATURES as readonly string[]).includes(f))) fieldError('features', 'invalid');
  v.features = JSON.stringify([...new Set(list)]);
  // Free is where every ended plan lands, so it cannot be switched off
  if (key === FREE_PLAN && v.is_active === 0) fieldError('is_active', 'free_stays_active');
  if (before) await exec('UPDATE plans SET ?, updated_at = UTC_TIMESTAMP() WHERE `key` = ?', [v, key]);
  else await exec('INSERT INTO plans SET ?', [{ ...v, key, updated_at: nowUtc() }]);
  await audit(req, { action: 'platform.plan_save', entity_type: 'plan', entity_id: key, before, after: v });
  res.json({ ok: true });
});
// Billing rules of the whole platform: the discount an annual price gets when the plan leaves it empty.
platformRouter.get('/platform/billing-settings', async (_req, res) => { res.json({ annual_discount: await annualDiscount() }); });
platformRouter.put('/platform/billing-settings', async (req, res) => {
  const v = clean(req.body, { annual_discount: { req: true, type: 'num', min: 0, max: 90 } });
  const before = await annualDiscount();
  await withTenant(0, () => setSetting(ANNUAL_DISCOUNT_KEY, String(v.annual_discount)));
  await audit(req, { action: 'platform.billing_settings', before: { annual_discount: before }, after: v });
  res.json({ ok: true });
});
platformRouter.put('/platform/bank-details', async (req, res) => {
  const v = clean(req.body, { bank_details: { max: 1000 } });
  await withTenant(0, () => setSetting('billing.bank_details', v.bank_details ?? null));
  res.json({ ok: true });
});
platformRouter.get('/platform/bank-details', async (_req, res) => {
  res.json({ bank_details: (await withTenant(0, () => one<{ value: string }>("SELECT value FROM settings WHERE `key` = 'billing.bank_details'")))?.value ?? '' });
});
// Maintenance of the whole platform: every company's staff see the message until it is switched off (index.ts).
platformRouter.get('/platform/maintenance', async (_req, res) => {
  res.json(await withTenant(0, async () => ({ on: (await setting('platform.maintenance')) === '1', message: (await setting('platform.maintenance_message')) ?? '' })));
});
platformRouter.put('/platform/maintenance', async (req, res) => {
  const v = clean(req.body, { on: { type: 'bool' }, message: { max: 500 } });
  await withTenant(0, async () => {
    await setSetting('platform.maintenance', v.on ? '1' : '0');
    await setSetting('platform.maintenance_message', v.message ?? null);
  });
  await audit(req, { action: 'platform.maintenance', severity: 'warning', details: v.on ? 'on' : 'off' });
  res.json({ ok: true });
});

platformRouter.get('/platform/payments', async (req, res) => {
  const status = String(req.query.status ?? '');
  res.json(await q(`SELECT p.*, t.name tenant_name, t.slug,
      (SELECT a.id FROM attachments a WHERE a.tenant_id = p.tenant_id AND a.entity_type = 'subscription_payment' AND a.entity_id = CAST(p.id AS CHAR) ORDER BY a.id DESC LIMIT 1) receipt_id
    FROM subscription_payments p JOIN tenants t ON t.id = p.tenant_id WHERE (? = '' OR p.status = ?) ORDER BY p.id DESC LIMIT 300`, [status, status]));
});
// The receipt a company attached to its request (the owner reads it across companies).
platformRouter.get('/platform/payments/:id/receipt', async (req, res) => {
  const a = await one<any>("SELECT a.* FROM attachments a JOIN subscription_payments p ON p.tenant_id = a.tenant_id AND a.entity_type = 'subscription_payment' AND a.entity_id = CAST(p.id AS CHAR) WHERE p.id = ? ORDER BY a.id DESC LIMIT 1", [req.params.id]);
  if (!a) fail(404, 'not_found');
  sendStored(res, a, false);
});
// Approving a payment moves the company to the paid plan and adds a month or a year after the current end.
// A smaller plan bought while a bigger one is still paid for waits: it starts when the current period ends.
async function isSmaller(from: string, to: string) {
  const [a, b] = [await plan(from), await plan(to)];
  return !!a && !!b && a.key !== FREE_PLAN && a.key !== b.key && (b.sort < a.sort || (b.sort === a.sort && Number(b.price_monthly) < Number(a.price_monthly)));
}
platformRouter.post('/platform/payments/:id/:decision', async (req, res) => {
  const decision = req.params.decision;
  if (!['approve', 'reject'].includes(decision)) fail(404, 'not_found');
  const p = await one<any>('SELECT * FROM subscription_payments WHERE id = ?', [req.params.id]);
  if (!p) fail(404, 'not_found');
  if (p.status !== 'pending') fail(409, 'already_reviewed');
  const note = String(req.body?.note ?? '').slice(0, 500) || null;
  if (decision === 'reject') {
    await exec("UPDATE subscription_payments SET status = 'rejected', reviewed_by = ?, reviewed_at = UTC_TIMESTAMP(), review_note = ? WHERE id = ?", [req.user!.id, note, p.id]);
  } else {
    await tx(async () => {
      const t = await one<Tenant>('SELECT * FROM tenants WHERE id = ? FOR UPDATE', [p.tenant_id]);
      const running = t!.status === 'active' && !!t!.period_ends_at && t!.period_ends_at > nowUtc();
      const start = running ? t!.period_ends_at! : nowUtc();
      const end = plusDays(start, p.billing_cycle === 'annual' ? 365 : 30);
      if (running && (await isSmaller(t!.plan_key, p.plan_key)))
        await exec('UPDATE tenants SET next_plan_key = ?, next_payment_id = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [p.plan_key, p.id, p.tenant_id]);
      else
        await exec("UPDATE tenants SET status = 'active', plan_key = ?, billing_cycle = ?, period_ends_at = ?, next_plan_key = NULL, next_payment_id = NULL, updated_at = UTC_TIMESTAMP() WHERE id = ?",
          [p.plan_key, p.billing_cycle, end, p.tenant_id]);
      await exec("UPDATE subscription_payments SET status = 'approved', reviewed_by = ?, reviewed_at = UTC_TIMESTAMP(), review_note = ?, period_start = ?, period_end = ? WHERE id = ?", [req.user!.id, note, start, end, p.id]);
    });
    forgetTenant(p.tenant_id);
  }
  await audit(req, { action: `platform.payment_${decision}`, entity_type: 'subscription_payment', entity_id: p.id, details: note ?? undefined });
  res.json({ ok: true });
});
