// Phase 8: the company dashboard's own numbers, defined once.
// - Profile completeness (as LogisTap weighs it): identity 15, legal 30, contact 15, bank 15, documents 25.
// - Risk (0-100, higher is worse): for riders, the share of working riders with an expired or missing required
//   paper; for vehicles, the share of vehicles in use with an expired paper, an expired operation card, or an oil
//   change overdue.
// - Company health (0-100): profile 30%, riders 35%, vehicles 25%, money 10% (no overdue payment = full marks,
//   each overdue payment takes 10 points of that part). 80 and up is good standing, 60 to 79 needs attention.
// - Rider work state: working = has a vehicle now; on leave = approved leave covering today; ready = active with
//   no vehicle and not on leave; waiting = stopped or suspended (not terminated).
import { asPlatform, one, q, setting } from '../db.js';
import { addDays } from '../http.js';
import { alertsUnion } from '../routes/docs.js';
import { riderPapers } from './employees.js';
import { dueSummary } from './companyFinance.js';
import { loadTenant, standing } from './subscription.js';

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const filled = (v: unknown) => v != null && String(v).trim() !== '';

export async function profileCompleteness() {
  const keys = ['org.name', 'org.name_en', 'org.cr_number', 'org.tax_number', 'org.unified_number', 'org.city_cr_number', 'org.vat_cert_expiry',
    'org.gosi_number', 'org.support_email', 'org.support_phone', 'org.address'];
  const v = Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await setting(k)])));
  const logo = await one("SELECT 1 FROM attachments WHERE entity_type = 'organization' AND attachment_type IN ('logo','leave_logo') LIMIT 1");
  const bank = await one("SELECT 1 FROM fin_accounts WHERE kind = 'bank' AND iban IS NOT NULL AND is_active = 1 LIMIT 1");
  const [{ docs }] = await q<{ docs: number }>("SELECT COUNT(*) docs FROM attachments WHERE entity_type = 'organization' AND (attachment_type IS NULL OR attachment_type NOT IN ('logo','leave_logo','leave_stamp','leave_signature'))");
  const part = (weight: number, checks: boolean[]) => ({ weight, done: checks.filter(Boolean).length, of: checks.length, score: Math.round((weight * checks.filter(Boolean).length) / checks.length) });
  const sections = {
    identity: part(15, [filled(v['org.name']), filled(v['org.name_en']), !!logo]),
    legal: part(30, [filled(v['org.cr_number']), filled(v['org.tax_number']), filled(v['org.unified_number']), filled(v['org.city_cr_number']), filled(v['org.vat_cert_expiry']), filled(v['org.gosi_number'])]),
    contact: part(15, [filled(v['org.support_email']), filled(v['org.support_phone']), filled(v['org.address'])]),
    bank: part(15, [!!bank]),
    documents: part(25, [Number(docs) >= 1, Number(docs) >= 3]),
  };
  return { percent: Object.values(sections).reduce((s, p) => s + p.score, 0), sections };
}

export async function companyDashboard(tenantId: number, day: string, soonDays = 30) {
  const docs = `(SELECT a.*, DATEDIFF(a.expiry_date, '${day}') d FROM (${alertsUnion(day)}) a)`;
  // ---------- riders ----------
  const [r] = await q<any>(`SELECT COUNT(*) total,
      COALESCE(SUM(r.status = 'active' AND va.id IS NOT NULL), 0) working,
      COALESCE(SUM(r.status = 'active' AND va.id IS NULL AND lv.id IS NULL), 0) ready,
      COALESCE(SUM(r.status IN ('inactive','suspended')), 0) waiting,
      COALESCE(SUM(r.status = 'active' AND lv.id IS NOT NULL), 0) on_leave
    FROM riders r LEFT JOIN vehicle_assignments va ON va.rider_id = r.id AND va.is_current = 1
    LEFT JOIN leaves lv ON lv.rider_id = r.id AND lv.status = 'approved' AND ? BETWEEN lv.start_date AND lv.end_date
    WHERE r.status <> 'terminated'`, [day]);
  const papers = await riderPapers({});
  const [rd] = await q<any>(`SELECT COALESCE(SUM(d < 0), 0) expired, COALESCE(SUM(d BETWEEN 0 AND ${soonDays}), 0) soon FROM ${docs} x WHERE owner_type = 'rider'`);
  const riderAtRisk = new Set([...papers.filter((p) => p.missing > 0).map((p) => Number(p.id)),
    ...(await q<{ ref_id: number }>(`SELECT DISTINCT ref_id FROM ${docs} x WHERE owner_type = 'rider' AND d < 0`)).map((x) => Number(x.ref_id))]);
  const nextRider = await q(`SELECT ref_id, owner, kind, expiry_date, d FROM ${docs} x WHERE owner_type = 'rider' AND d >= 0 ORDER BY d LIMIT 5`);
  // ---------- vehicles ----------
  const oilDays = Number(await setting('oil.due_days')) || 20;
  const [v] = await q<any>(`SELECT COUNT(*) total, COALESCE(SUM(v.status = 'active' AND va.id IS NOT NULL), 0) working, COALESCE(SUM(v.status = 'maintenance'), 0) servicing,
      COALESCE(SUM(v.status = 'active' AND va.id IS NULL), 0) reserved, COALESCE(SUM(v.status = 'retired'), 0) unavailable
    FROM vehicles v LEFT JOIN (SELECT vehicle_id, MIN(id) id FROM vehicle_assignments WHERE is_current = 1 GROUP BY vehicle_id) va ON va.vehicle_id = v.id`);
  const [vd] = await q<any>(`SELECT COALESCE(SUM(d < 0), 0) expired, COALESCE(SUM(d BETWEEN 0 AND ${soonDays}), 0) soon,
      COALESCE(SUM(d < 0 AND kind = 'operation_card'), 0) invalid_authorization FROM ${docs} x WHERE owner_type = 'vehicle'`);
  const oilDue = await q<{ plate: string }>(`SELECT v.plate FROM vehicles v WHERE v.status <> 'retired' AND
      COALESCE((SELECT MAX(c.change_date) FROM oil_changes c WHERE c.vehicle_id = v.id), (SELECT s.last_change FROM oil_schedules s WHERE s.vehicle_id = v.id)) < ?`, [addDays(day, -oilDays)]);
  // vehicles are told apart by plate (an operation card lists the plates it covers)
  const vehicleAtRisk = new Set([...oilDue.map((x) => x.plate),
    ...(await q<{ owner: string | null }>(`SELECT DISTINCT owner FROM ${docs} x WHERE owner_type = 'vehicle' AND d < 0`)).flatMap((x) => String(x.owner ?? '').split(' · ').filter(Boolean))]);
  const nextVehicle = await q(`SELECT ref_id, owner, kind, expiry_date, d FROM ${docs} x WHERE owner_type = 'vehicle' AND d >= 0 ORDER BY d LIMIT 5`);
  // ---------- the company ----------
  const profile = await profileCompleteness();
  const working = Number(r.total) - Number(r.waiting);
  const riskRiders = pct([...riderAtRisk].length, Math.max(working, papers.length));
  const inUse = Number(v.total) - Number(v.unavailable);
  const riskVehicles = pct([...vehicleAtRisk].length, inUse);
  const dues = await dueSummary(day);
  const money = Math.max(0, 100 - dues.overdue_count * 10);
  const health = Math.round(0.3 * profile.percent + 0.35 * (100 - riskRiders) + 0.25 * (100 - riskVehicles) + 0.1 * money);
  const [{ admins }] = await q<{ admins: number }>("SELECT COUNT(*) admins FROM users WHERE status = 'active'");
  const [{ branches }] = await q<{ branches: number }>('SELECT COUNT(*) branches FROM branches WHERE is_active = 1');
  const [{ titles }] = await q<{ titles: number }>('SELECT COUNT(*) titles FROM designations WHERE is_active = 1');
  const t = tenantId ? await asPlatform(() => loadTenant(tenantId)) : undefined;
  const sub = t ? standing(t) : null;
  return {
    health: { percent: health, label: health >= 80 ? 'good' : health >= 60 ? 'attention' : 'at_risk' },
    profile, cards: { admins: Number(admins), days_left: sub?.days_left ?? null, branches: Number(branches), designations: Number(titles) },
    riders: { ...num(r), missing_papers: papers.filter((p) => p.missing > 0).length, expired: Number(rd.expired), soon: Number(rd.soon), risk: riskRiders, next: nextRider },
    vehicles: { ...num(v), expired: Number(vd.expired), soon: Number(vd.soon), invalid_authorization: Number(vd.invalid_authorization), oil_due: oilDue.length, oil_days: oilDays, risk: riskVehicles, next: nextVehicle },
    dues,
  };
}
const num = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Number(v)]));
