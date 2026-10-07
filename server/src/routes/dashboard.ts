import { Router } from 'express';
import { exec, one, q, settingInt } from '../db.js';
import { addDays, clean, eq, fail, langOf, list, listAll, sendExport, today, tr, where, type Query, type Spec } from '../http.js';
import { can, requireUser } from '../auth.js';
import { audit } from '../audit.js';
import { alertsUnion } from './docs.js';
import { notifyRider, notifyUsers } from '../notify.js';

export const dashboardRouter = Router();

// ======================================================================== 9.1 dashboard
// Every part is read on its own: a part that fails is null and the others still show.
const part = async <T>(fn: () => Promise<T>) => { try { return await fn(); } catch (e) { console.error('dashboard part', e); return null; } };
async function thresholds() {
  const t = [await settingInt('dashboard.alert_days_critical', 7), await settingInt('dashboard.alert_days_warning', 15), await settingInt('dashboard.alert_days_notice', 30)];
  return t.sort((a, b) => a - b); // entered in the wrong order, they are sorted
}

dashboardRouter.get('/dashboard', can('dashboard.view'), async (req, res) => {
  const day = await today();
  const [t1, t2, t3] = await thresholds();
  const docs = `(SELECT a.*, DATEDIFF(a.expiry_date, '${day}') d FROM (${alertsUnion(day)}) a)`;
  const alerts = await part(async () => {
    const [c] = await q<any>(`SELECT COALESCE(SUM(d < 0),0) expired, COALESCE(SUM(d BETWEEN 0 AND ${t1}),0) l1, COALESCE(SUM(d > ${t1} AND d <= ${t2}),0) l2,
      COALESCE(SUM(d > ${t2} AND d <= ${t3}),0) l3 FROM ${docs} x`);
    // the most urgent documents, at most five from each level, split by owner
    const urgent = await q<any>(`SELECT owner_type, lvl FROM (SELECT x.owner_type, CASE WHEN d < 0 THEN 0 WHEN d <= ${t1} THEN 1 WHEN d <= ${t2} THEN 2 ELSE 3 END lvl,
      ROW_NUMBER() OVER (PARTITION BY CASE WHEN d < 0 THEN 0 WHEN d <= ${t1} THEN 1 WHEN d <= ${t2} THEN 2 ELSE 3 END ORDER BY d) rn FROM ${docs} x WHERE d <= ${t3}) y WHERE rn <= 5`);
    const by = (o: string) => urgent.filter((u) => u.owner_type === o).length;
    return { ...c, days: [t1, t2, t3], vehicle: by('vehicle'), rider: by('rider'), other: by('organization') };
  });
  const figures = await part(async () => {
    const [v] = await q<any>("SELECT COUNT(*) total, COALESCE(SUM(status='active'),0) active, COALESCE(SUM(status='maintenance'),0) maintenance, COALESCE(SUM(status='retired'),0) retired FROM vehicles");
    const [r] = await q<any>("SELECT COUNT(*) total, COALESCE(SUM(status='active'),0) active, COALESCE(SUM(status='inactive'),0) inactive FROM riders");
    const [d] = await q<any>(`SELECT COALESCE(SUM(d < 0),0) expired, COALESCE(SUM(d BETWEEN 0 AND ${t3}),0) soon FROM ${docs} x`);
    const [a] = await q<any>("SELECT COUNT(*) open FROM advances WHERE status IN ('pending','approved','disbursed','repaying')");
    const [o] = await q<any>("SELECT COALESCE(SUM(i.amount - i.paid),0) outstanding FROM advance_installments i JOIN advances a ON a.id = i.advance_id WHERE a.status IN ('disbursed','repaying') AND i.status IN ('due','partial')");
    const [n] = await q<any>('SELECT COUNT(*) unread FROM notifications WHERE user_id = ? AND read_at IS NULL', [req.user!.id]);
    return { vehicles: v, riders: r, docs: d, advances_open: a.open, outstanding: o.outstanding, unread: n.unread };
  });
  const charts = {
    vehicles: await part(() => q("SELECT status k, COUNT(*) n FROM vehicles GROUP BY status")),
    riders: await part(() => q("SELECT status k, COUNT(*) n FROM riders GROUP BY status")),
    doc_kinds: await part(() => q(`SELECT kind k, COUNT(*) n FROM ${docs} x GROUP BY kind ORDER BY n DESC`)),
    compliance: await part(async () => (await q<any>(`SELECT COUNT(*) total, COALESCE(SUM(d > ${t3}),0) valid FROM ${docs} x`))[0]),
    advances: await part(() => q('SELECT status k, COUNT(*) n FROM advances GROUP BY status')),
    // the next four come from chapter 6 (performance and sync)
    deliveries: await part(() => q(`SELECT work_date k, SUM(completed) completed, SUM(cancelled) cancelled FROM daily_performance WHERE work_date > ? GROUP BY work_date ORDER BY work_date`, [addDays(day, -14)])),
    ratings: await part(async () => {
      const m = await one<any>('SELECT MAX(month) m FROM monthly_ratings');
      return m?.m ? { month: m.m, rows: await q('SELECT segment k, COUNT(*) n FROM monthly_ratings WHERE month = ? GROUP BY segment ORDER BY segment', [m.m]) } : null;
    }),
    photos: await part(() => q('SELECT verdict k, COUNT(*) n FROM branding_photos GROUP BY verdict HAVING n > 0')),
    sync: await part(() => q('SELECT outcome k, COUNT(*) n FROM sync_runs WHERE started_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 14 DAY) GROUP BY outcome')),
    expiring: await part(() => q(`SELECT DATE_FORMAT(expiry_date, '%Y-%m') k, COUNT(*) n FROM ${docs} x WHERE expiry_date >= ? AND expiry_date < DATE_ADD(?, INTERVAL 12 MONTH) GROUP BY k ORDER BY k`, [`${day.slice(0, 7)}-01`, `${day.slice(0, 7)}-01`])),
  };
  const events = await part(async () => q(`SELECT id, created_at, action, actor_name, entity_type, entity_id, details, severity FROM audit_log ORDER BY id DESC LIMIT ?`,
    [await settingInt('dashboard.recent_activity_limit', 12)]));
  res.json({ alerts, figures, charts, events });
});

// ======================================================================== 9.2 reports
// One page per report: every matching row, no pages; the filters live in the address.
type Report = { spec: (day: string, q: Query) => Spec; stats: (rows: any[]) => [string, unknown][]; cols: { key: string; label: string; fill?: (r: any) => string | null }[] };
const digitsOrLike = (cols: string[], idCol: string) => (term: string): [string, unknown[]] =>
  /^\d+$/.test(term) ? [`(${idCol} = ? OR ${cols.map((c) => `${c} LIKE ?`).join(' OR ')})`, [Number(term), ...cols.map(() => `%${term}%`)]] : [`(${cols.map((c) => `${c} LIKE ?`).join(' OR ')})`, cols.map(() => `%${term}%`)];
const stateFill = (r: any) => (r.state === 'expired' ? 'red' : r.state === 'near' ? 'amber' : 'green');
const REPORTS: Record<string, Report> = {
  vehicles: {
    spec: (day) => ({
      from: `FROM vehicles v LEFT JOIN operation_card_vehicles x ON x.vehicle_id = v.id AND x.is_current = 1 LEFT JOIN operation_cards oc ON oc.id = x.card_id AND oc.status = 'valid'
        LEFT JOIN vehicle_insurance vi ON vi.vehicle_id = v.id AND vi.is_current = 1 AND vi.status = 'valid'`,
      select: `v.plate, v.plate_en, v.maker, v.model, v.color, v.year, v.registration_type, v.ownership, v.status, oc.number card, oc.expiry_date card_expiry, vi.expiry_date insurance_expiry,
        DATEDIFF(oc.expiry_date, '${day}') card_days, DATEDIFF(vi.expiry_date, '${day}') ins_days`,
      search: ['v.plate', 'v.plate_en', 'v.maker', 'v.model'],
      filters: { status: eq('v.status'), ownership: eq('v.ownership'), maker: eq('v.maker') },
      sorts: { plate: 'v.plate' }, defaultSort: 'plate',
    }),
    stats: (rows) => [['rep.v.vehicles', rows.length], ['rep.v.active', rows.filter((r) => r.status === 'active').length], ['rep.v.owned', rows.filter((r) => r.ownership === 'owned').length], ['rep.v.rented', rows.filter((r) => r.ownership === 'rented').length]],
    cols: [{ key: 'plate', label: 'vehicles.plate' }, { key: 'maker', label: 'vehicles.maker' }, { key: 'model', label: 'vehicles.model' }, { key: 'color', label: 'vehicles.color' },
      { key: 'year', label: 'vehicles.year' }, { key: 'registration_type', label: 'vehicles.registration_type' }, { key: 'ownership', label: 'vehicles.ownership' }, { key: 'status', label: 'vehicle.status' },
      { key: 'card', label: 'vehicles.card' }, { key: 'card_expiry', label: 'vehicles.card_expiry', fill: (r) => (r.card_days == null ? null : r.card_days < 0 ? 'red' : r.card_days <= 30 ? 'amber' : null) },
      { key: 'insurance_expiry', label: 'rep.v.insurance_expiry', fill: (r) => (r.ins_days == null ? null : r.ins_days < 0 ? 'red' : r.ins_days <= 30 ? 'amber' : null) }],
  },
  riders: {
    spec: () => ({
      from: 'FROM riders r LEFT JOIN cities ci ON ci.id = r.city_id',
      select: 'r.id, r.full_name, r.alias, r.national_id, r.nationality, r.occupation, r.phone, ci.name_ar city_ar, ci.name_en city_en, r.status, r.hire_date',
      search: [digitsOrLike(['r.full_name', 'r.alias', 'r.national_id', 'r.phone'], 'r.id')],
      filters: { status: eq('r.status'), city: eq('r.city_id') },
      sorts: { name: 'r.full_name' }, defaultSort: 'name',
    }),
    stats: (rows) => [['rep.r.riders', rows.length], ['rep.r.active', rows.filter((r) => r.status === 'active').length], ['rep.r.inactive', rows.filter((r) => r.status !== 'active').length]],
    cols: [{ key: 'full_name', label: 'rep.r.rider' }, { key: 'alias', label: 'rep.r.known_as' }, { key: 'national_id', label: 'riders.national_id' }, { key: 'nationality', label: 'riders.nationality' },
      { key: 'occupation', label: 'riders.occupation' }, { key: 'phone', label: 'riders.phone' }, { key: 'city_ar', label: 'riders.city' }, { key: 'status', label: 'riders.status' }, { key: 'hire_date', label: 'rep.r.hired' }],
  },
  documents: {
    spec: (day, query) => {
      const win = Number(query.within) > 0 ? Number(query.within) : 30;
      const days = `DATEDIFF(a.expiry_date, '${day}')`;
      return {
        from: `FROM (${alertsUnion(day)}) a`,
        select: `a.*, ${days} days_left, CASE WHEN ${days} < 0 THEN 'expired' WHEN ${days} <= ${win} THEN 'near' ELSE 'valid' END state`,
        search: ['a.owner', 'a.number'],
        filters: {
          kind: eq('a.kind'),
          validity: (v) => ({ expired: `${days} < 0`, near: `${days} BETWEEN 0 AND ${win}`, valid: `${days} > ${win}` } as Record<string, string>)[v] ?? null,
          // "Within (days)" alone: what has this many days left or fewer, with the expired
          within: (_v, q) => (q.validity ? null : `${days} <= ${win}`),
        },
        sorts: { days: days }, defaultSort: 'days',
      };
    },
    stats: (rows) => [['alerts.s.expired', rows.filter((r) => r.state === 'expired').length], ['alerts.s.near_title', rows.filter((r) => r.state === 'near').length],
      ['alerts.s.valid', rows.filter((r) => r.state === 'valid').length], ['rep.records', rows.length]],
    cols: [{ key: 'kind', label: 'alerts.document' }, { key: 'owner', label: 'alerts.belongs_to' }, { key: 'number', label: 'alerts.number' }, { key: 'issue_date', label: 'alerts.issued' },
      { key: 'expiry_date', label: 'alerts.expires' }, { key: 'days_left', label: 'alerts.days_left', fill: stateFill }, { key: 'state', label: 'alerts.status', fill: stateFill }],
  },
  advances: {
    spec: (day) => ({
      from: 'FROM advances a JOIN riders r ON r.id = a.rider_id',
      select: `a.number, a.amount, a.installments, a.status, a.request_date, r.full_name, r.national_id,
        (SELECT COALESCE(SUM(paid),0) FROM advance_installments WHERE advance_id = a.id) paid,
        (SELECT COALESCE(SUM(amount - paid),0) FROM advance_installments WHERE advance_id = a.id AND status IN ('due','partial')) remaining,
        (SELECT COUNT(*) FROM advance_installments WHERE advance_id = a.id AND status IN ('due','partial') AND due_date < '${day}') overdue,
        (SELECT MIN(due_date) FROM advance_installments WHERE advance_id = a.id AND status IN ('due','partial')) next_due`,
      search: [digitsOrLike(['r.full_name', 'a.number', 'r.national_id'], 'r.id')],
      filters: {
        status: eq('a.status'), from: (v) => ['a.request_date >= ?', [v]], to: (v) => ['a.request_date <= ?', [v]],
        overdue: (v) => (v === 'yes' ? `EXISTS (SELECT 1 FROM advance_installments i WHERE i.advance_id = a.id AND i.status IN ('due','partial') AND i.due_date < '${day}')` : null),
      },
      sorts: { date: 'a.request_date' }, defaultSort: '-date',
    }),
    stats: (rows) => {
      const sum = (k: string) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0).toFixed(2);
      return [['rep.a.advanced', sum('amount')], ['rep.a.repaid', sum('paid')], ['rep.a.outstanding', sum('remaining')], ['rep.a.with_overdue', rows.filter((r) => r.overdue > 0).length]];
    },
    cols: [{ key: 'number', label: 'rep.a.number' }, { key: 'full_name', label: 'adv.rider' }, { key: 'amount', label: 'adv.amount' }, { key: 'paid', label: 'rep.a.paid' },
      { key: 'remaining', label: 'rep.a.remaining' }, { key: 'installments', label: 'adv.installments' }, { key: 'overdue', label: 'adv.overdue', fill: (r) => (r.overdue ? 'red' : null) },
      { key: 'next_due', label: 'adv.next_due' }, { key: 'status', label: 'adv.status' }, { key: 'request_date', label: 'rep.a.requested' }],
  },
};
async function report(name: string, query: Query) {
  const r = REPORTS[name];
  if (!r) fail(404, 'not_found');
  const rows = await listAll(r.spec(await today(), query), query, 10000);
  return { r, rows };
}
dashboardRouter.get('/reports/:name', can('reports.view'), async (req, res) => {
  const { r, rows } = await report(String(req.params.name), req.query as Query);
  const facets = req.params.name === 'vehicles' ? { makers: (await q<any>('SELECT DISTINCT maker FROM vehicles WHERE maker IS NOT NULL ORDER BY maker')).map((x) => x.maker) }
    : req.params.name === 'documents' ? { kinds: (await q<any>(`SELECT DISTINCT kind FROM (${alertsUnion(await today())}) a`)).map((x) => x.kind) } : {};
  res.json({ rows, total: rows.length, stats: Object.fromEntries(r.stats(rows)), facets });
});
dashboardRouter.get('/reports/:name/export', can('reports.export'), async (req, res) => {
  const name = String(req.params.name);
  const { r, rows } = await report(name, req.query as Query);
  const lang = await langOf(req);
  const translated = ['kind', 'state', 'status', 'ownership'];
  const value = (k: string) => (row: any) => {
    const v = row[k];
    if (v == null || !translated.includes(k)) return v;
    const key = k === 'kind' ? `alerts.kind.${v}` : k === 'state' ? `alerts.state.${v}` : name === 'riders' ? `rider.status.${v}` : name === 'advances' ? `adv.s.${v}` : k === 'ownership' ? `vehicle.own.${v}` : `vehicle.status.${v}`;
    return tr(lang, key);
  };
  const filters = Object.entries(req.query).filter(([k, v]) => v && k !== 'format').map(([k, v]) => `${k}: ${v}`).join('   ');
  await audit(req, { action: 'report.export', details: `${name}: ${rows.length} rows` });
  await sendExport(req, res, { format: 'xlsx', title: `rep.${name}.title`, rows, filters, summary: r.stats(rows), cols: r.cols.map((c) => ({ ...c, value: value(c.key) })) });
});

// ======================================================================== 9.3 notifications
const RECIPIENT = "CASE WHEN n.rider_id IS NOT NULL THEN 'rider' WHEN ro.name = 'Super Admin' THEN 'admin' ELSE 'manager' END";
const noteSpec: Spec = {
  from: 'FROM notifications n LEFT JOIN users u ON u.id = n.user_id LEFT JOIN roles ro ON ro.id = u.role_id LEFT JOIN riders r ON r.id = n.rider_id',
  select: `n.*, COALESCE(u.full_name, r.full_name) recipient, ${RECIPIENT} recipient_kind, (u.id IS NULL AND r.id IS NULL) recipient_gone`,
  search: ['n.title', 'n.body', 'CAST(n.params AS CHAR)'],
  filters: {
    kind: (v) => [`${RECIPIENT} = ?`, [v]], category: eq('n.category'), severity: eq('n.severity'),
    state: (v) => (v === 'unread' ? 'n.read_at IS NULL' : 'n.read_at IS NOT NULL'),
    from: (v) => ['n.created_at >= ?', [v]], to: (v) => ['n.created_at < DATE_ADD(?, INTERVAL 1 DAY)', [v]],
  },
  sorts: { sent: 'n.id', recipient: 'recipient', category: 'n.category', severity: 'n.severity', state: 'n.read_at' },
  defaultSort: '-sent',
};
// The bell: your latest eight, unread first. Open to every signed-in user.
dashboardRouter.get('/notifications/mine', requireUser, async (req, res) => {
  const rows = await q('SELECT id, category, severity, title, body, params, created_at, read_at FROM notifications WHERE user_id = ? ORDER BY read_at IS NULL DESC, id DESC LIMIT 8', [req.user!.id]);
  const [c] = await q<any>(`SELECT COUNT(*) unread, MAX(CASE severity WHEN 'critical' THEN 3 WHEN 'warning' THEN 2 ELSE 1 END) top FROM notifications WHERE user_id = ? AND read_at IS NULL`, [req.user!.id]);
  res.json({ rows, unread: Number(c.unread), top: c.top === 3 ? 'critical' : c.top === 2 ? 'warning' : 'info' });
});
dashboardRouter.get('/notifications', can('notifications.view'), async (req, res) => {
  const [stats] = await q(`SELECT COUNT(*) total, COALESCE(SUM(read_at IS NULL),0) unread, COALESCE(SUM(severity = 'critical'),0) critical, COALESCE(SUM(severity = 'warning'),0) warning FROM notifications`);
  res.json({ ...(await list(noteSpec, req.query as Query)), stats });
});
dashboardRouter.get('/notifications/export', can('notifications.export'), async (req, res) => {
  const rows = await listAll(noteSpec, req.query as Query);
  // the headers of this file are in English
  const cols = [['created_at', 'Created'], ['recipient_kind', 'Recipient type'], ['recipient', 'Recipient'], ['category', 'Category'], ['severity', 'Severity'], ['read_at', 'Read'], ['title', 'Title']];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="notifications ${await today()}.csv"`);
  const lang = await langOf(req);
  const esc = (v: unknown) => { const s = String(v ?? '-'); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const text = (r: any) => tr(lang, r.title, typeof r.params === 'string' ? JSON.parse(r.params) : r.params ?? {});
  res.send('﻿' + [cols.map((c) => c[1]).join(','), ...rows.map((r: any) => cols.map(([k]) => esc(k === 'read_at' ? (r.read_at ? 'read' : 'unread') : k === 'title' ? text(r) : r[k])).join(','))].join('\r\n'));
});
dashboardRouter.post('/notifications/generate', can('notifications.send'), async (req, res) => {
  const created = await generateNotifications();
  await audit(req, { action: 'notifications.generate', details: `${created} created` });
  res.json({ created });
});
dashboardRouter.post('/notifications/:id/read', can('notifications.view'), async (req, res) => {
  await exec('UPDATE notifications SET read_at = COALESCE(read_at, UTC_TIMESTAMP()) WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});
dashboardRouter.delete('/notifications/:id', can('notifications.delete'), async (req, res) => {
  const n = await one<any>('SELECT * FROM notifications WHERE id = ?', [req.params.id]);
  if (!n) fail(404, 'not_found');
  await exec('DELETE FROM notifications WHERE id = ?', [n.id]);
  await audit(req, { action: 'notification.delete', entity_type: 'notification', entity_id: n.id, severity: n.read_at ? 'info' : 'warning', details: n.title });
  res.json({ ok: true });
});

// ======================================================================== 9.4 preferences: yours only
export const CATEGORIES = ['document_expiry', 'oil_change', 'advance_status', 'installment_due', 'performance', 'backup', 'security', 'system', 'general'];
dashboardRouter.get('/notifications/preferences', can('notification_prefs.view'), async (req, res) => {
  const rows = await q<any>('SELECT category, in_app, email FROM notification_prefs WHERE user_id = ?', [req.user!.id]);
  res.json(CATEGORIES.map((c) => { const r = rows.find((x) => x.category === c); return { category: c, in_app: r ? !!r.in_app : true, email: r ? !!r.email : false, customised: !!r }; }));
});
dashboardRouter.put('/notifications/preferences/:category', can('notification_prefs.update'), async (req, res) => {
  const c = String(req.params.category);
  if (!CATEGORIES.includes(c)) fail(404, 'not_found');
  const v = clean(req.body, { in_app: { type: 'bool' }, email: { type: 'bool' } });
  const cur = await one<any>('SELECT in_app, email FROM notification_prefs WHERE user_id = ? AND category = ?', [req.user!.id, c]);
  const next = { in_app: v.in_app ?? cur?.in_app ?? 1, email: v.email ?? cur?.email ?? 0 };
  await exec('INSERT INTO notification_prefs (user_id, category, in_app, email) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE in_app = VALUES(in_app), email = VALUES(email)', [req.user!.id, c, next.in_app, next.email]);
  await audit(req, { action: 'notification_prefs.update', details: `${c}: in_app=${next.in_app} email=${next.email}`, severity: !next.in_app && !next.email ? 'warning' : 'info' });
  res.json({ ok: true });
});

// ======================================================================== the generator (also the daily scheduled job)
// Documents entering their alert period or expired, oil changes due, instalments due or overdue.
// One notification per recipient per record per day, so running it twice creates nothing new.
const ALERT_KEY: Record<string, [string, number]> = {
  id: ['id_document.expiry_alert_days', 60], license: ['driving_license.expiry_alert_days', 30], health: ['health_cert.expiry_alert_days', 30],
  driver_card: ['driver_card.expiry_alert_days', 30], ajeer: ['ajeer_permit.expiry_alert_days', 60], operation_card: ['operation_card.expiry_alert_days', 30],
  vehicle_registration: ['vehicle_registration.expiry_alert_days', 30], vehicle_insurance: ['vehicle_insurance.expiry_alert_days', 30],
  insurance_policy: ['insurance_policy.expiry_alert_days', 45], transport_license: ['transport_license.expiry_alert_days', 60],
};
export async function generateNotifications() {
  const day = await today();
  let created = 0;
  const docs = await q<any>(`SELECT a.*, DATEDIFF(a.expiry_date, ?) d FROM (${alertsUnion(day)}) a WHERE a.kind <> 'oil_change'`, [day]);
  for (const doc of docs) {
    const [key, def] = ALERT_KEY[doc.kind] ?? ['', 30];
    const window = key ? await settingInt(key, def) : 30;
    if (doc.d > window) continue;
    const expired = doc.d < 0;
    const n = {
      category: 'document_expiry' as const, severity: (expired ? 'critical' : 'warning') as 'critical' | 'warning',
      title: expired ? 'note.doc_expired' : 'note.doc_expiring', params: { kind: `alerts.kind.${doc.kind}`, owner: doc.owner, days: Math.abs(doc.d), date: doc.expiry_date },
      entity_type: doc.kind, entity_id: doc.record_id, link: '/admin/alerts', dedupe: true,
    };
    created += await notifyUsers('all', n);
    if (doc.owner_type === 'rider') created += await notifyRider(doc.ref_id, n);
  }
  const oils = await q<any>(`SELECT s.id, v.plate, DATEDIFF(DATE_ADD(s.last_change, INTERVAL s.interval_days DAY), ?) d, s.warn_days FROM oil_schedules s JOIN vehicles v ON v.id = s.vehicle_id`, [day]);
  for (const o of oils.filter((x) => x.d <= x.warn_days)) {
    created += await notifyUsers('all', { category: 'oil_change', severity: o.d < 0 ? 'critical' : 'warning', title: o.d < 0 ? 'note.oil_overdue' : 'note.oil_due',
      params: { plate: o.plate, days: Math.abs(o.d) }, entity_type: 'oil_schedule', entity_id: o.id, link: `/admin/oil-changes/${o.id}`, dedupe: true });
  }
  const dueDays = await settingInt('advance.due_alert_days', 7);
  const insts = await q<any>(`SELECT i.id, i.n, i.amount - i.paid amount, a.number, a.rider_id, a.id advance_id, DATEDIFF(i.due_date, ?) d FROM advance_installments i JOIN advances a ON a.id = i.advance_id
    WHERE i.status IN ('due','partial') AND i.due_date <= ?`, [day, addDays(day, dueDays)]);
  for (const i of insts) {
    const late = i.d < 0;
    const n = { category: 'installment_due' as const, severity: (late ? 'critical' : 'info') as 'critical' | 'info', title: late ? 'note.inst_overdue' : 'note.inst_due',
      params: { number: i.number, n: i.n, amount: Number(i.amount).toFixed(2), days: Math.abs(i.d) }, entity_type: 'advance', entity_id: i.advance_id, link: `/admin/advances/${i.advance_id}`, dedupe: true };
    created += await notifyRider(i.rider_id, n);
    if (late) created += await notifyUsers('all', n);
  }
  return created;
}
