import { Router, type NextFunction, type Request, type Response } from 'express';
import { randomBytes, randomInt } from 'node:crypto';
import { exec, one, q, setting, tx, withActor } from '../db.js';
import { HttpError, addDays, clean, daysBetween, fail, fieldError, langOf, latinDigits, sendExport, today, tr, type Col } from '../http.js';
import { can, clientIp, hashPassword, readCookie, sha256, verifyPassword } from '../auth.js';
import { audit } from '../audit.js';
import { sendStored, storeFile, upload } from '../files.js';
import { sendMail, smtpConfig } from '../mail.js';
import { fileChangeRequest } from './requests.js';
import { leaveFromRider, overlap } from './leaves.js';
import { addMessage, files10, messages, riderMessage } from './issues.js';
import { logError } from './maintenance.js';

// Chapter 12: the rider portal. Riders sign in with their own sessions, never with a staff account.
declare global {
  namespace Express {
    interface Request { rider?: { id: number; full_name: string; locale: string | null; sessionId: number } }
  }
}
export const portalRouter = Router();
export const portalAdminRouter = Router();

const COOKIE = 'lsp_rsid';
const SESSION_HOURS = 12;
const ALLOWED = ['active', 'inactive'];
const ua = (req: Request) => (req.headers['user-agent'] ?? '').slice(0, 255);
const riderAudit = (req: Request, e: Parameters<typeof audit>[1]) => audit(req, { ...e, actor_type: 'rider', actor_name: `${req.rider!.full_name} #${req.rider!.id}` });

// ======================================================================== sign in (12.2)
async function attempt(req: Request, typed: string, riderId: number | null, success: boolean, reason: string | null) {
  await exec('INSERT INTO rider_login_attempts (typed, rider_id, success, reason, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)',
    [typed.slice(0, 30) || null, riderId, success ? 1 : 0, reason, clientIp(req), ua(req)]);
}

portalRouter.post('/portal/login', async (req, res) => {
  const typed = latinDigits(String(req.body?.rider_id ?? '').trim());
  const password = req.body?.password ? String(req.body.password) : '';
  const ip = clientIp(req);
  // 10 failures from one network within 15 minutes; the password step and the refusals themselves do not count
  const [{ n }] = await q<any>(`SELECT COUNT(*) n FROM rider_login_attempts WHERE ip = ? AND success = 0 AND reason NOT IN ('no_password', 'too_many')
    AND created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 15 MINUTE)`, [ip]);
  if (Number(n) >= 10) { await attempt(req, typed, null, false, 'too_many'); fail(429, 'portal_too_many'); }
  const r = /^\d{1,20}$/.test(typed) ? await one<any>('SELECT id, full_name, status, portal_enabled, portal_password_hash FROM riders WHERE id = ?', [typed]) : undefined;
  if (!r) { await attempt(req, typed, null, false, 'bad_credentials'); fail(401, 'portal_bad_credentials'); }
  if (!r.portal_enabled || !ALLOWED.includes(r.status)) { await attempt(req, typed, r.id, false, 'disabled'); fail(403, 'portal_disabled'); }
  if (!r.portal_password_hash) { await attempt(req, typed, r.id, false, 'password_not_ready'); fail(403, 'portal_password_not_ready'); }
  if (r.portal_password_hash) {
    if (!password) { await attempt(req, typed, r.id, false, 'no_password'); return res.json({ step: 'password' }); }
    if (!(await verifyPassword(password, r.portal_password_hash))) { await attempt(req, typed, r.id, false, 'bad_credentials'); fail(401, 'portal_bad_credentials'); }
  }
  const token = randomBytes(32).toString('hex');
  await exec('INSERT INTO rider_sessions (token_hash, rider_id, ip, user_agent, expires_at) VALUES (?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? HOUR))',
    [sha256(token), r.id, ip, ua(req), SESSION_HOURS]);
  await exec('INSERT INTO rider_accounts (rider_id, last_login_at) VALUES (?, UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE last_login_at = UTC_TIMESTAMP()', [r.id]);
  await attempt(req, typed, r.id, true, null);
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_HOURS * 3600}${req.secure ? '; Secure' : ''}`);
  res.json({ ok: true, first: !r.portal_password_hash });
});

portalRouter.post('/portal/logout', async (req, res) => {
  const tok = readCookie(req, COOKIE);
  if (tok) await exec("UPDATE rider_sessions SET status = 'signed_out', ended_at = UTC_TIMESTAMP() WHERE token_hash = ? AND status = 'active'", [sha256(tok)]);
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

async function endSessions(riderId: number, keep = 0) {
  const r = await exec("UPDATE rider_sessions SET status = 'revoked', ended_at = UTC_TIMESTAMP() WHERE rider_id = ? AND status = 'active' AND id <> ?", [riderId, keep]);
  return r.affectedRows;
}

// ======================================================================== emailed codes (12.3, 12.12)
async function emailAccount() {
  if ((await setting('email.enabled')) === '0') return null;
  for (const a of ['riders', 'system'] as const) { const c = await smtpConfig(a); if (c.host && c.enabled) return a; }
  return null;
}
async function emailUnavailable() {
  return fail(503, 'email_unavailable', { phone: (await setting('org.support_phone')) ?? '', email: (await setting('org.support_email')) ?? '' });
}
type Purpose = 'verify_email' | 'reset_password';
async function issueCode(req: Request, rider: { id: number; full_name: string; locale?: string | null }, purpose: Purpose, email: string, path: string) {
  const account = await emailAccount();
  if (!account) await emailUnavailable();
  const [l] = await q<any>(`SELECT TIMESTAMPDIFF(SECOND, MAX(created_at), UTC_TIMESTAMP()) ago, COALESCE(SUM(created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR)), 0) hour
    FROM rider_codes WHERE rider_id = ? AND purpose = ?`, [rider.id, purpose]);
  if (l.ago != null && Number(l.ago) < 60) fail(429, 'code_wait', { seconds: 60 - Number(l.ago) });
  if (Number(l.hour) >= 5) fail(429, 'code_hourly_limit');
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  // the new code cancels the old one
  await exec('UPDATE rider_codes SET used_at = UTC_TIMESTAMP() WHERE rider_id = ? AND purpose = ? AND used_at IS NULL', [rider.id, purpose]);
  await exec('INSERT INTO rider_codes (rider_id, purpose, email, code_hash, expires_at) VALUES (?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 15 MINUTE))',
    [rider.id, purpose, email, sha256(`${rider.id}:${code}`)]);
  const link = `${req.protocol}://${req.get('host')}${path.replace('{code}', code)}`;
  await sendMail({ template: `portal.${purpose}`, to: email, toName: rider.full_name, lang: rider.locale ?? 'ar', account: account!,
    vars: { owner_name: rider.full_name, code, link }, entity_type: 'rider', entity_id: rider.id });
}
async function checkCode(riderId: number, purpose: Purpose, code: unknown) {
  const c = await one<any>('SELECT *, expires_at < UTC_TIMESTAMP() expired FROM rider_codes WHERE rider_id = ? AND purpose = ? AND used_at IS NULL ORDER BY id DESC LIMIT 1', [riderId, purpose]);
  if (!c || c.expired) fieldError('code', 'code_expired');
  if (c.attempts >= 5) fieldError('code', 'code_locked');
  if (sha256(`${riderId}:${latinDigits(String(code ?? '').trim())}`) !== c.code_hash) {
    await exec('UPDATE rider_codes SET attempts = attempts + 1 WHERE id = ?', [c.id]);
    const left = 4 - c.attempts;
    fieldError('code', left > 0 ? 'code_wrong' : 'code_locked', { left });
  }
  await exec('UPDATE rider_codes SET used_at = UTC_TIMESTAMP() WHERE id = ?', [c.id]);
  return c as { email: string };
}
function checkPassword(body: any) {
  const p = String(body.password ?? '');
  if (p.length < 8 || p.length > 72 || !/[A-Za-z]/.test(p) || !/\d/.test(p)) fieldError('password', 'portal_password_rules');
  if (p !== String(body.confirm ?? '')) fieldError('confirm', 'password_mismatch');
  return p;
}

// Forgot password: the same answer whether or not the ID has a verified email.
portalRouter.post('/portal/forgot', async (req, res) => {
  const id = latinDigits(String(req.body?.rider_id ?? '').trim());
  const r = /^\d{1,20}$/.test(id) ? await one<any>(`SELECT r.id, r.full_name, r.status, r.portal_enabled, a.verified_email, a.locale FROM riders r
    LEFT JOIN rider_accounts a ON a.rider_id = r.id WHERE r.id = ?`, [id]) : undefined;
  if (r?.verified_email && r.portal_enabled && ALLOWED.includes(r.status)) {
    try { await issueCode(req, r, 'reset_password', r.verified_email, `/rider/forgot-password?id=${r.id}&step=code`); }
    catch (e) { if (!(e instanceof HttpError)) throw e; }
  }
  res.json({ ok: true, resend_in: 60 });
});

portalRouter.post('/portal/reset', async (req, res) => {
  const id = latinDigits(String(req.body?.rider_id ?? '').trim());
  const r = /^\d{1,20}$/.test(id) ? await one<any>('SELECT id, full_name FROM riders WHERE id = ?', [id]) : undefined;
  if (!r) fieldError('code', 'code_expired');
  const p = checkPassword(req.body ?? {});
  await checkCode(r.id, 'reset_password', req.body.code);
  await exec('UPDATE riders SET portal_password_hash = ?, portal_password_set_at = UTC_TIMESTAMP() WHERE id = ?', [await hashPassword(p), r.id]);
  const ended = await endSessions(r.id);
  await audit(req, { action: 'portal.password_reset', entity_type: 'rider', entity_id: r.id, actor_type: 'rider', actor_name: `${r.full_name} #${r.id}`, details: `${ended} sessions ended` });
  res.json({ ok: true });
});

// ======================================================================== the signed-in rider
async function riderAuth(req: Request, _res: Response, next: NextFunction) {
  const tok = readCookie(req, COOKIE);
  const s = tok ? await one<any>(`SELECT s.id sid, s.expires_at < UTC_TIMESTAMP() expired, r.id, r.full_name, r.status, r.portal_enabled, a.locale
    FROM rider_sessions s JOIN riders r ON r.id = s.rider_id LEFT JOIN rider_accounts a ON a.rider_id = r.id WHERE s.token_hash = ? AND s.status = 'active'`, [sha256(tok)]) : undefined;
  if (!s) throw new HttpError(401, 'rider_session_ended');
  if (s.expired) {
    await exec("UPDATE rider_sessions SET status = 'expired', ended_at = UTC_TIMESTAMP() WHERE id = ?", [s.sid]);
    throw new HttpError(401, 'rider_session_ended');
  }
  if (!s.portal_enabled || !ALLOWED.includes(s.status)) {
    await exec("UPDATE rider_sessions SET status = 'revoked', ended_at = UTC_TIMESTAMP() WHERE id = ?", [s.sid]);
    throw new HttpError(401, 'portal_disabled');
  }
  await exec('UPDATE rider_sessions SET last_activity_at = UTC_TIMESTAMP() WHERE id = ? AND last_activity_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 SECOND)', [s.sid]);
  req.rider = { id: s.id, full_name: s.full_name, locale: s.locale, sessionId: s.sid };
  withActor({ kind: 'rider', id: s.id }, next);
}
portalRouter.use('/portal', riderAuth);

const PHOTO = "(SELECT a.id FROM attachments a WHERE a.entity_type = 'rider' AND a.entity_id = r.id AND a.attachment_type = 'photo' AND a.is_current = 1 ORDER BY a.id DESC LIMIT 1)";
async function unread(riderId: number) {
  const [{ n }] = await q<any>(`SELECT COUNT(*) n FROM rider_issue_messages m JOIN rider_issues i ON i.id = m.issue_id
    WHERE i.rider_id = ? AND m.author = 'staff' AND m.internal = 0 AND (i.rider_read_at IS NULL OR m.created_at > i.rider_read_at)`, [riderId]);
  return Number(n);
}

portalRouter.get('/portal/me', async (req, res) => {
  const r = await one<any>(`SELECT r.id, r.full_name, r.alias, r.status, r.portal_password_hash IS NOT NULL has_password, a.verified_email, a.locale, ${PHOTO} photo_id
    FROM riders r LEFT JOIN rider_accounts a ON a.rider_id = r.id WHERE r.id = ?`, [req.rider!.id]);
  res.json({ ...r, has_password: !!r.has_password, unread_issues: await unread(r.id) });
});

// The language follows the rider to other devices.
portalRouter.put('/portal/locale', async (req, res) => {
  const l = String(req.body?.locale ?? '');
  if (!['ar', 'en', 'bn', 'ur'].includes(l) && !(await one('SELECT 1 FROM languages WHERE code = ?', [l]))) fieldError('locale', 'invalid');
  await exec('INSERT INTO rider_accounts (rider_id, locale) VALUES (?, ?) ON DUPLICATE KEY UPDATE locale = VALUES(locale)', [req.rider!.id, l]);
  res.json({ ok: true });
});

// A file the rider may see: his own record, his documents, his requests, and the public messages of his conversations.
portalRouter.get('/portal/files/:id', async (req, res) => {
  const a = await one<any>('SELECT * FROM attachments WHERE id = ?', [req.params.id]);
  const rid = req.rider!.id;
  const mine = !a ? false
    : a.entity_type === 'rider' ? a.entity_id === String(rid)
    : a.entity_type.startsWith('rider_doc_') ? !!(await one('SELECT 1 FROM rider_documents WHERE id = ? AND rider_id = ?', [a.entity_id, rid]))
    : a.entity_type === 'change_request' ? !!(await one('SELECT 1 FROM rider_change_requests WHERE id = ? AND rider_id = ?', [a.entity_id, rid]))
    : a.entity_type === 'issue_message' ? !!(await one('SELECT 1 FROM rider_issue_messages m JOIN rider_issues i ON i.id = m.issue_id WHERE m.id = ? AND m.internal = 0 AND i.rider_id = ?', [a.entity_id, rid]))
    : false;
  if (!mine) fail(404, 'file_link_expired');
  sendStored(res, a, req.query.download === '1');
});

// A portal page that failed to display is recorded in "System errors" for the office.
portalRouter.post('/portal/client-error', async (req, res) => {
  const b = req.body ?? {};
  await logError({ name: 'PortalPage', message: `[rider #${req.rider!.id}] ${String(b.page ?? '').slice(0, 200)}: ${String(b.message ?? '')}`, stack: String(b.stack ?? '') }, req);
  res.json({ ok: true });
});

// ======================================================================== profile and its completion (12.4, 12.5)
const DOCS = ['id', 'license', 'health', 'driver_card', 'ajeer'] as const;
async function completion(riderId: number, day: string) {
  const docs = await q<any>(`SELECT d.id, d.doc_type, CASE WHEN d.doc_type = 'id' THEN r.national_id ELSE d.doc_number END doc_number, d.issue_date, d.expiry_date,
      DATEDIFF(d.expiry_date, ?) days_left FROM rider_documents d JOIN riders r ON r.id = d.rider_id WHERE d.rider_id = ? AND d.is_current = 1`, [day, riderId]);
  const pending = await q<any>("SELECT id, type, doc_type FROM rider_change_requests WHERE rider_id = ? AND status = 'pending'", [riderId]);
  const r = await one<any>(`SELECT r.phone, ${PHOTO} photo_id FROM riders r WHERE r.id = ?`, [riderId]);
  const waiting = (type: string, doc?: string) => pending.find((p) => p.type === type && (!doc || p.doc_type === doc))?.id ?? null;
  const items = [
    ...DOCS.map((t) => {
      const d = docs.find((x) => x.doc_type === t);
      const days = d?.days_left == null ? null : Number(d.days_left);
      const st = !d ? 'missing' : days == null ? 'valid' : days < 0 ? 'expired' : days <= 30 ? 'expiring' : 'valid';
      const req = waiting('document', t);
      return { key: t, status: st !== 'valid' && req ? 'pending' : st, days, request_id: req };
    }),
    { key: 'photo', status: r?.photo_id ? 'done' : waiting('photo') ? 'pending' : 'missing', days: null, request_id: waiting('photo') },
    { key: 'phone', status: r?.phone ? 'done' : waiting('contact') ? 'pending' : 'missing', days: null, request_id: waiting('contact') },
  ];
  const done = items.filter((i) => i.status === 'valid' || i.status === 'done').length;
  return { items, missing: items.length - done, percent: Math.round((done / items.length) * 100), docs };
}
const mask = (s: string | null) => (s ? '•'.repeat(Math.max(0, s.length - 4)) + s.slice(-4) : null);

portalRouter.get('/portal/profile', async (req, res) => {
  const id = req.rider!.id;
  const r = await one<any>(`SELECT r.id, r.full_name, r.name_en, r.alias, r.status, r.phone, r.email, r.account_holder_phone, r.national_id, r.nationality, r.birth_date,
      r.hire_date, co.name company_name, k.name contract_name, ci.name_ar city_ar, ci.name_en city_en, ${PHOTO} photo_id
    FROM riders r LEFT JOIN companies co ON co.id = r.company_id LEFT JOIN contracts k ON k.id = r.contract_id LEFT JOIN cities ci ON ci.id = r.city_id WHERE r.id = ?`, [id]);
  const c = await completion(id, await today());
  const docs = c.docs.map((d) => ({ ...d, doc_number: d.doc_type === 'id' ? mask(d.doc_number) : d.doc_number }));
  const files = await q("SELECT id, attachment_type, file_name, mime, size, created_at FROM attachments WHERE entity_type = 'rider' AND entity_id = ? ORDER BY id DESC", [String(id)]);
  res.json({ ...r, national_id: mask(r.national_id), completion: { items: c.items, missing: c.missing, percent: c.percent }, documents: docs, files });
});

// ======================================================================== performance (12.4, 12.7)
// Wasted hours are never negative: overtime is not a debt.
const WASTE = 'CASE WHEN p.planned_hours IS NULL THEN COALESCE(p.lost_hours, 0) ELSE GREATEST(p.planned_hours - COALESCE(p.actual_hours, 0), 0) END';
const PARTIAL_HOURS = 1;
// ponytail: there is no work schedule, so a day with no imported report and no recorded absence counts as a day off, not "Absent".
async function dayStatuses(riderId: number, from: string, to: string) {
  const perf = await q<any>(`SELECT p.work_date, p.planned_hours, p.actual_hours, p.shifts, p.no_shows, ${WASTE} wasted FROM daily_performance p
    WHERE p.rider_id = ? AND p.work_date BETWEEN ? AND ?`, [riderId, from, to]);
  const off = [
    ...(await q<any>('SELECT DATE(start_at) s, DATE(end_at) e, reason FROM rider_absences WHERE rider_id = ? AND end_at >= ? AND start_at < DATE_ADD(?, INTERVAL 1 DAY)', [riderId, from, to])),
    ...(await q<any>("SELECT start_date s, end_date e, leave_type reason FROM leaves WHERE rider_id = ? AND status = 'approved' AND end_date >= ? AND start_date <= ?", [riderId, from, to])),
  ];
  const out: any[] = [];
  for (let d = to; d >= from; d = addDays(d, -1)) {
    const p = perf.find((x) => x.work_date === d);
    const leave = off.find((o) => o.s <= d && o.e >= d);
    const worked = Number(p?.actual_hours) > 0;
    const required = !!p && (Number(p.planned_hours) > 0 || Number(p.shifts) > 0 || Number(p.no_shows) > 0);
    const status = worked ? (Number(p.wasted) >= PARTIAL_HOURS ? 'partial' : 'present') : leave ? 'leave' : required ? 'absent' : null;
    if (status) out.push({ day: d, status, reason: status === 'leave' ? leave!.reason : null, planned: p?.planned_hours ?? null, actual: p?.actual_hours ?? null,
      wasted: p ? Number(p.wasted) : 0, shifts: p?.shifts ?? null });
  }
  return out;
}

portalRouter.get('/portal/overview', async (req, res) => {
  const id = req.rider!.id;
  const day = await today();
  const d7 = addDays(day, -6), d30 = addDays(day, -29);
  const sums = (from: string) => q<any>(`SELECT COALESCE(SUM(p.completed),0) completed, COALESCE(SUM(p.actual_hours),0) hours, COALESCE(SUM(p.planned_hours),0) planned,
    COALESCE(SUM(${WASTE}),0) lost, AVG(p.attendance_rate) att, AVG(p.acceptance_rate) acc, COUNT(*) days FROM daily_performance p WHERE p.rider_id = ? AND p.work_date BETWEEN ? AND ?`, [id, from, day]);
  const [[w7], [w30]] = [await sums(d7), await sums(d30)];
  const absent7 = (await dayStatuses(id, d7, day)).filter((x) => x.status === 'absent').length;
  const daily = await q('SELECT work_date day, completed, attendance_rate att FROM daily_performance WHERE rider_id = ? AND work_date BETWEEN ? AND ? ORDER BY work_date', [id, d30, day]);
  const photos = await q('SELECT COALESCE(override_result, check_result) result, COUNT(*) n FROM branding_photos WHERE rider_id = ? AND captured_at >= ? GROUP BY 1', [id, d30]);
  const ratings = await q('SELECT month, segment, final_score, on_time, fail_rate_score, verification_rate, completed, gross_orders FROM monthly_ratings WHERE rider_id = ? ORDER BY month DESC LIMIT 12', [id]);
  const [{ pending }] = await q<any>("SELECT COUNT(*) pending FROM rider_change_requests WHERE rider_id = ? AND status = 'pending'", [id]);
  const [{ open }] = await q<any>("SELECT COUNT(*) open FROM rider_issues WHERE rider_id = ? AND status IN ('open','in_progress')", [id]);
  const c = await completion(id, day);
  res.json({ completion: { items: c.items, missing: c.missing, percent: c.percent }, week: { ...w7, absent: absent7 }, month: w30, daily, photos, ratings,
    requests_pending: Number(pending), issues_open: Number(open) });
});

const PERF_SUMS = `COALESCE(SUM(p.completed),0) completed, COALESCE(SUM(p.accepted),0) accepted, COALESCE(SUM(p.declined),0) declined, COALESCE(SUM(p.cancelled),0) cancelled,
  COALESCE(SUM(p.notified),0) notified, AVG(p.attendance_rate) att, AVG(p.acceptance_rate) acc, COALESCE(SUM(p.actual_hours),0) actual, COALESCE(SUM(p.planned_hours),0) planned,
  COALESCE(SUM(p.break_hours),0) break_hours, COALESCE(SUM(${WASTE}),0) lost, COALESCE(SUM(p.no_shows),0) no_shows, COALESCE(SUM(p.shifts),0) shifts`;
async function period(req: Request) {
  const day = await today();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from)) ? String(req.query.from) : addDays(day, -29);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to)) ? String(req.query.to) : day;
  if (from > to) fieldError('from', 'start_after_end');
  const group = req.query.group === 'month' ? 'month' : 'day';
  return { from, to, group };
}
async function perfRows(riderId: number, from: string, to: string, group: string) {
  const key = group === 'month' ? 'LEFT(p.work_date::text, 7)' : 'p.work_date';
  return q<any>(`SELECT ${key} label, ${PERF_SUMS} FROM daily_performance p WHERE p.rider_id = ? AND p.work_date BETWEEN ? AND ? GROUP BY label ORDER BY label DESC`, [riderId, from, to]);
}
portalRouter.get('/portal/performance', async (req, res) => {
  const id = req.rider!.id;
  const { from, to, group } = await period(req);
  const rows = await perfRows(id, from, to, group);
  const [total] = await q<any>(`SELECT ${PERF_SUMS}, COUNT(*) n FROM daily_performance p WHERE p.rider_id = ? AND p.work_date BETWEEN ? AND ?`, [id, from, to]);
  // the day-by-day absence list covers at most 92 days
  const tooLong = daysBetween(from, to) + 1 > 92;
  const days = tooLong ? [] : await dayStatuses(id, from, to);
  res.json({ from, to, group, rows, total, absence: { too_long: tooLong, days, absent: days.filter((d) => d.status === 'absent').length,
    present: days.filter((d) => d.status === 'present' || d.status === 'partial').length, wasted: days.reduce((s, d) => s + d.wasted, 0) } });
});
portalRouter.get('/portal/performance/export', async (req, res) => {
  const id = req.rider!.id;
  const { from, to, group } = await period(req);
  const rows = await perfRows(id, from, to, group);
  if (!rows.length) fail(404, 'no_performance_data');
  const [total] = await q<any>(`SELECT ${PERF_SUMS} FROM daily_performance p WHERE p.rider_id = ? AND p.work_date BETWEEN ? AND ?`, [id, from, to]);
  const pct = (k: string) => (r: any) => (r[k] == null ? null : (Number(r[k]) * 100).toFixed(2));
  const cols: Col[] = ['date', 'completed', 'accepted', 'declined', 'cancelled', 'offered', 'att', 'acc', 'actual', 'planned', 'break', 'lost', 'no_shows', 'shifts'].map((k) => ({
    key: ({ date: 'label', offered: 'notified', break: 'break_hours' } as Record<string, string>)[k] ?? k, label: `rp.perf.col.${k}`, value: k === 'att' || k === 'acc' ? pct(k) : undefined }));
  await sendExport(req, res, { format: 'csv', title: 'rp.nav.performance', cols, rows: [...rows, { ...total, label: tr(await langOf(req), 'rp.perf.total') }] });
});

portalRouter.get('/portal/ratings', async (req, res) => {
  const rows = await q<any>(`SELECT m.month, m.segment, m.final_score, m.on_time, m.fail_rate_score, m.verification_rate, m.gross_orders, m.completed, m.completed_in_time,
      m.failed_by_rider, m.city, m.contract FROM monthly_ratings m WHERE m.rider_id = ? ORDER BY m.month DESC LIMIT 24`, [req.rider!.id]);
  res.json({ rows, current_month: (await today()).slice(0, 7) });
});

// ======================================================================== attendance photos (12.6)
portalRouter.get('/portal/attendance', async (req, res) => {
  const id = req.rider!.id;
  const { from, to } = await period(req);
  const result = typeof req.query.result === 'string' && /^[a-z_]+$/.test(req.query.result) ? req.query.result : null;
  const page = Math.max(1, Number(req.query.page) || 1);
  const RESULT = 'COALESCE(override_result, check_result)';
  const base = `FROM branding_photos WHERE rider_id = ? AND captured_at >= ? AND captured_at < DATE_ADD(?, INTERVAL 1 DAY)`;
  const counts = await q<any>(`SELECT ${RESULT} result, COUNT(*) n ${base} GROUP BY 1`, [id, from, to]);
  const cond = result ? ` AND ${RESULT} = ?` : '';
  const params = result ? [id, from, to, result] : [id, from, to];
  const [{ n }] = await q<any>(`SELECT COUNT(*) n ${base}${cond}`, params);
  const rows = await q(`SELECT id, captured_at, photo_url, contract_name, check_result, override_result, ${RESULT} result, card_review, source_review, card_note
    ${base}${cond} ORDER BY captured_at DESC LIMIT 24 OFFSET ?`, [...params, (page - 1) * 24]);
  res.json({ from, to, rows, counts, total: Number(n), page, pageSize: 24 });
});

// ======================================================================== update requests (12.9)
const DOC_FILES: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' };
const PHOTO_FILES: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
function checkFiles(files: Express.Multer.File[], allowed: Record<string, string>, max: number) {
  if (!files.length) fieldError('files', 'file_required');
  if (files.length > max) fieldError('files', 'too_many_files', { max });
  if (files.some((f) => !allowed[f.mimetype])) fieldError('files', 'file_type_not_allowed');
  if (files.some((f) => f.size > 10 * 1024 * 1024)) fieldError('files', 'file_too_large', { max: 10 });
}

portalRouter.get('/portal/requests', async (req, res) => {
  const id = req.rider!.id;
  const st = ['pending', 'approved', 'rejected', 'cancelled'].includes(String(req.query.status)) ? String(req.query.status) : null;
  const rows = await q<any>(`SELECT id, type, doc_type, payload, snapshot, rider_note, status, review_note, reviewed_at, created_at FROM rider_change_requests
    WHERE rider_id = ? ${st ? 'AND status = ?' : ''} ORDER BY id DESC LIMIT 100`, st ? [id, st] : [id]);
  const files = rows.length ? await q<any>("SELECT id, entity_id, attachment_type, file_name, mime, size FROM attachments WHERE entity_type = 'change_request' AND entity_id IN (?) ORDER BY id",
    [rows.map((r) => String(r.id))]) : [];
  const parse = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);
  const [{ pending }] = await q<any>("SELECT COUNT(*) pending FROM rider_change_requests WHERE rider_id = ? AND status = 'pending'", [id]);
  res.json({ rows: rows.map((r) => ({ ...r, payload: parse(r.payload), snapshot: parse(r.snapshot), files: files.filter((f) => f.entity_id === String(r.id)) })), pending: Number(pending) });
});

portalRouter.post('/portal/requests', upload.array('files', 5), async (req, res) => {
  const id = req.rider!.id;
  const files = (req.files ?? []) as Express.Multer.File[];
  const base = clean(req.body, { type: { req: true, enum: ['contact', 'document', 'photo'] }, rider_note: { max: 1000 } });
  let payload: Record<string, unknown> = {};
  let docType: string | null = null;
  if (base.type === 'contact') {
    const v = clean(req.body, { email: { type: 'email', max: 150 }, phone: { max: 20 } });
    if (v.phone) { v.phone = v.phone.replace(/[\s-]/g, ''); if (!/^\+?\d{8,15}$/.test(v.phone)) fieldError('phone', 'portal_phone_rules'); }
    if (!v.email && !v.phone) fieldError('email', 'contact_one_required');
    const cur = await one<any>('SELECT phone, email FROM riders WHERE id = ?', [id]);
    if (v.email && v.email.toLowerCase() === String(cur?.email ?? '').toLowerCase()) fieldError('email', 'same_as_current');
    if (v.phone && v.phone === cur?.phone) fieldError('phone', 'same_as_current');
    payload = v;
  } else if (base.type === 'document') {
    const v = clean(req.body, { doc_type: { req: true, enum: ['id', 'license', 'health', 'driver_card', 'ajeer', 'other'] }, doc_number: { max: 50 }, issue_date: { type: 'date' }, expiry_date: { type: 'date' } });
    if (v.issue_date && v.expiry_date && v.expiry_date < v.issue_date) fieldError('expiry_date', 'expiry_before_issue');
    if (v.doc_type === 'id') delete v.doc_number;
    checkFiles(files, DOC_FILES, 4);
    docType = v.doc_type; delete v.doc_type;
    payload = v;
  } else {
    checkFiles(files, PHOTO_FILES, 1);
  }
  const crId = await fileChangeRequest(id, { type: base.type, doc_type: docType, payload, rider_note: base.rider_note ?? null });
  // the first document file is the front side, the second the back, the rest attachments
  for (const [i, f] of (base.type === 'contact' ? [] : files).entries()) {
    const kind = base.type === 'photo' ? 'photo' : i === 0 ? 'front' : i === 1 ? 'back' : 'attachment';
    const stored = await storeFile(f, base.type === 'photo' ? PHOTO_FILES : DOC_FILES);
    await exec('INSERT INTO attachments (entity_type, entity_id, attachment_type, file_name, stored_name, mime, size) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['change_request', String(crId), kind, Buffer.from(f.originalname, 'latin1').toString('utf8'), stored, f.mimetype, f.size]);
  }
  await riderAudit(req, { action: 'change_request.create', entity_type: 'rider', entity_id: id, after: payload, details: `#${crId} ${base.type}${docType ? ` ${docType}` : ''}` });
  res.json({ id: crId });
});

portalRouter.post('/portal/requests/:id/cancel', async (req, res) => {
  const r = await exec("UPDATE rider_change_requests SET status = 'cancelled' WHERE id = ? AND rider_id = ? AND status = 'pending'", [req.params.id, req.rider!.id]);
  if (!r.affectedRows) fail(409, 'request_not_pending');
  await riderAudit(req, { action: 'change_request.cancel', entity_type: 'rider', entity_id: req.rider!.id, details: `#${req.params.id}` });
  res.json({ ok: true });
});

// ======================================================================== leaves (12.10)
portalRouter.get('/portal/leaves', async (req, res) => {
  const id = req.rider!.id;
  const day = await today();
  const st = ['pending', 'approved', 'rejected', 'cancelled'].includes(String(req.query.status)) ? String(req.query.status) : null;
  // the rider never sees the internal notes or who reviewed the request
  const rows = await q(`SELECT id, letter_no, leave_type, start_date, end_date, DATEDIFF(end_date, start_date) + 1 days, reason, status, source, created_at,
      CASE WHEN status IN ('approved','rejected') THEN answer_note END answer
    FROM leaves WHERE rider_id = ? ${st ? 'AND status = ?' : ''} ORDER BY start_date DESC LIMIT 100`, st ? [id, st] : [id]);
  const y = day.slice(0, 4);
  const [s] = await q<any>(`SELECT COALESCE(SUM(status = 'pending'),0) pending,
      COALESCE(SUM(CASE WHEN status = 'approved' THEN GREATEST(DATEDIFF(LEAST(end_date, ?), GREATEST(start_date, ?)) + 1, 0) END),0) approved_days
    FROM leaves WHERE rider_id = ?`, [`${y}-12-31`, `${y}-01-01`, id]);
  const now = await one('SELECT start_date, end_date FROM leaves WHERE rider_id = ? AND status = ? AND ? BETWEEN start_date AND end_date', [id, 'approved', day]);
  res.json({ rows, stats: { pending: Number(s.pending), approved_days: Number(s.approved_days) }, on_leave: now ?? null, today: day });
});

portalRouter.post('/portal/leaves', async (req, res) => {
  const id = req.rider!.id;
  const v = clean(req.body, { leave_type: { req: true, enum: ['emergency', 'annual', 'sick', 'unpaid', 'other'] }, start_date: { req: true, type: 'date' }, end_date: { type: 'date' }, reason: { req: true, max: 500 } });
  v.end_date ??= v.start_date;
  const day = await today();
  if (v.start_date < day) fieldError('start_date', 'leave_in_past');
  if (v.start_date > addDays(day, 90)) fieldError('start_date', 'leave_too_far');
  if (v.end_date < v.start_date) fieldError('end_date', 'end_before_start');
  if (daysBetween(v.start_date, v.end_date) + 1 > 30) fieldError('end_date', 'leave_too_long');
  // the rider reads "You already have…", not the office's wording
  try { await overlap(id, v.start_date, v.end_date); }
  catch (e) { if (e instanceof HttpError) fieldError('start_date', 'leave_overlap_mine', e.params); throw e; }
  const out = await leaveFromRider(id, { ...v, rider_id: id });
  await riderAudit(req, { action: 'leave.create', entity_type: 'leave', entity_id: out.id, after: { ...v, letter_no: out.letter_no } });
  res.json(out);
});

portalRouter.post('/portal/leaves/:id/cancel', async (req, res) => {
  // after approval only the office can cancel it
  const r = await exec("UPDATE leaves SET status = 'cancelled', updated_at = UTC_TIMESTAMP() WHERE id = ? AND rider_id = ? AND status = 'pending'", [req.params.id, req.rider!.id]);
  if (!r.affectedRows) fail(409, 'leave_cancel_pending_only');
  await riderAudit(req, { action: 'leave.cancel', entity_type: 'leave', entity_id: req.params.id });
  res.json({ ok: true });
});

// ======================================================================== issues (12.11)
const UNREAD = "(SELECT COUNT(*) FROM rider_issue_messages m WHERE m.issue_id = i.id AND m.author = 'staff' AND m.internal = 0 AND (i.rider_read_at IS NULL OR m.created_at > i.rider_read_at))";
const LAST = '(SELECT m.id FROM rider_issue_messages m WHERE m.issue_id = i.id AND m.internal = 0 ORDER BY m.id DESC LIMIT 1)';
portalRouter.get('/portal/issues', async (req, res) => {
  const params: unknown[] = [req.rider!.id];
  let cond = '';
  const st = String(req.query.status ?? '');
  if (st === 'open') cond += " AND i.status IN ('open','in_progress')";
  else if (['resolved', 'closed'].includes(st)) { cond += ' AND i.status = ?'; params.push(st); }
  const s = String(req.query.search ?? '').trim();
  if (s) { cond += ' AND (i.subject LIKE ? OR EXISTS (SELECT 1 FROM rider_issue_messages m WHERE m.issue_id = i.id AND m.internal = 0 AND m.body LIKE ?))'; params.push(`%${s}%`, `%${s}%`); }
  const rows = await q(`SELECT i.id, i.subject, i.category, i.priority, i.status, i.created_at, i.last_activity_at, ${UNREAD} unread,
      (SELECT LEFT(COALESCE(m.body, ''), 140) FROM rider_issue_messages m WHERE m.id = ${LAST}) last_body,
      (SELECT m.author FROM rider_issue_messages m WHERE m.id = ${LAST}) last_author
    FROM rider_issues i WHERE i.rider_id = ?${cond} ORDER BY i.last_activity_at DESC LIMIT 100`, params);
  res.json({ rows });
});

portalRouter.post('/portal/issues', files10, async (req, res) => {
  const id = req.rider!.id;
  const v = clean(req.body, { category: { req: true, enum: ['account', 'performance', 'attendance', 'payment', 'vehicle', 'app', 'other'] },
    subject: { req: true, minLen: 3, max: 200 }, body: { req: true, minLen: 10, max: 5000 }, priority: { enum: ['low', 'normal', 'high'] } });
  const issueId = await tx(async () => {
    const r = await exec("INSERT INTO rider_issues (rider_id, subject, category, priority, status, opened_by, rider_read_at) VALUES (?, ?, ?, ?, 'open', 'rider', NOW(3))",
      [id, v.subject, v.category, v.priority ?? 'normal']);
    await addMessage(req, r.insertId, 'rider', v.body, false, null);
    return r.insertId;
  });
  await riderAudit(req, { action: 'issue.create', entity_type: 'issue', entity_id: issueId, details: v.subject });
  res.json({ id: issueId });
});

async function ownIssue(req: Request) {
  const i = await one<any>('SELECT id, subject, category, priority, status, opened_by, created_at, last_activity_at, staff_read_at FROM rider_issues WHERE id = ? AND rider_id = ?', [req.params.id, req.rider!.id]);
  if (!i) fail(404, 'not_found');
  return i;
}
portalRouter.get('/portal/issues/:id', async (req, res) => {
  const i = await ownIssue(req);
  const list = await messages(i.id, { after: Number(req.query.after) || undefined, before: Number(req.query.before) || undefined, staff: false });
  // the rider sees "Support", never the employee's name
  res.json({ ...i, list: list.map(({ user_name: _, ...m }) => m) });
});
portalRouter.post('/portal/issues/:id/messages', files10, async (req, res) => {
  res.json({ id: await riderMessage(req, Number(req.params.id), req.rider!.id) });
});
portalRouter.post('/portal/issues/:id/read', async (req, res) => {
  const result = await exec('UPDATE rider_issues SET rider_read_at = NOW(3) WHERE id = ? AND rider_id = ?', [req.params.id, req.rider!.id]);
  if (!result.affectedRows) fail(404, 'not_found');
  res.json({ ok: true });
});

// ======================================================================== security (12.12)
portalRouter.get('/portal/security', async (req, res) => {
  const id = req.rider!.id;
  const r = await one<any>(`SELECT r.portal_password_hash IS NOT NULL has_password, r.portal_password_set_at, a.verified_email, a.email_verified_at FROM riders r
    LEFT JOIN rider_accounts a ON a.rider_id = r.id WHERE r.id = ?`, [id]);
  const code = await one<any>(`SELECT email, GREATEST(60 - TIMESTAMPDIFF(SECOND, created_at, UTC_TIMESTAMP()), 0) resend_in FROM rider_codes
    WHERE rider_id = ? AND purpose = 'verify_email' AND used_at IS NULL AND expires_at > UTC_TIMESTAMP() ORDER BY id DESC LIMIT 1`, [id]);
  res.json({ ...r, has_password: !!r.has_password, email_available: !!(await emailAccount()), pending: code ?? null,
    support: { phone: (await setting('org.support_phone')) ?? '', email: (await setting('org.support_email')) ?? '' } });
});

portalRouter.post('/portal/security/email', async (req, res) => {
  const v = clean(req.body, { email: { req: true, type: 'email', max: 150 } });
  const email = v.email.toLowerCase();
  if (await one('SELECT 1 FROM rider_accounts WHERE verified_email = ? AND rider_id <> ?', [email, req.rider!.id])) fieldError('email', 'email_verified_elsewhere');
  await issueCode(req, req.rider!, 'verify_email', email, '/rider/security?code={code}');
  res.json({ email, resend_in: 60 });
});

portalRouter.post('/portal/security/email/verify', async (req, res) => {
  const id = req.rider!.id;
  const c = await checkCode(id, 'verify_email', req.body?.code);
  try {
    await exec('INSERT INTO rider_accounts (rider_id, verified_email, email_verified_at) VALUES (?, ?, UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE verified_email = VALUES(verified_email), email_verified_at = UTC_TIMESTAMP()', [id, c.email]);
  } catch (e: any) {
    if (e?.code === '23505') fieldError('email', 'email_verified_elsewhere');
    throw e;
  }
  await riderAudit(req, { action: 'portal.email_verified', entity_type: 'rider', entity_id: id, details: c.email });
  res.json({ ok: true, email: c.email });
});

portalRouter.post('/portal/security/password', async (req, res) => {
  const id = req.rider!.id;
  const r = await one<any>('SELECT r.portal_password_hash, a.verified_email FROM riders r LEFT JOIN rider_accounts a ON a.rider_id = r.id WHERE r.id = ?', [id]);
  if (!r.verified_email) fail(409, 'verify_email_first');
  if (r.portal_password_hash && !(await verifyPassword(String(req.body?.current ?? ''), r.portal_password_hash))) fieldError('current', 'current_password_wrong');
  const p = checkPassword(req.body ?? {});
  await exec('UPDATE riders SET portal_password_hash = ?, portal_password_set_at = UTC_TIMESTAMP() WHERE id = ?', [await hashPassword(p), id]);
  // signed out everywhere else; this device stays signed in
  const ended = await endSessions(id, req.rider!.sessionId);
  await riderAudit(req, { action: r.portal_password_hash ? 'portal.password_change' : 'portal.password_set', entity_type: 'rider', entity_id: id, details: `${ended} sessions ended` });
  res.json({ ok: true, ended });
});

// ======================================================================== the office side (12.14)
const managePortal = can('rider_portal.manage_portal');
async function portalRider(id: unknown) {
  const r = await one<any>('SELECT id, full_name, status, portal_enabled FROM riders WHERE id = ?', [id]);
  if (!r) fail(404, 'rider_not_found');
  return r;
}
portalAdminRouter.get('/riders/:id/portal', managePortal, async (req, res) => {
  const r = await one<any>(`SELECT r.id, r.status, r.portal_enabled, r.portal_password_set_at, r.portal_password_hash IS NOT NULL has_password, a.last_login_at, a.verified_email
    FROM riders r LEFT JOIN rider_accounts a ON a.rider_id = r.id WHERE r.id = ?`, [req.params.id]);
  if (!r) fail(404, 'rider_not_found');
  const [{ n }] = await q<any>("SELECT COUNT(*) n FROM rider_sessions WHERE rider_id = ? AND status = 'active' AND expires_at > UTC_TIMESTAMP()", [r.id]);
  const attempts = await q('SELECT success, reason, ip, created_at FROM rider_login_attempts WHERE rider_id = ? ORDER BY id DESC LIMIT 5', [r.id]);
  res.json({ ...r, has_password: !!r.has_password, active_sessions: Number(n), attempts });
});
portalAdminRouter.post('/riders/:id/portal/disable', managePortal, async (req, res) => {
  const r = await portalRider(req.params.id);
  await exec('UPDATE riders SET portal_enabled = 0 WHERE id = ?', [r.id]);
  const ended = await endSessions(r.id);
  await audit(req, { action: 'portal.disable', entity_type: 'rider', entity_id: r.id, severity: 'warning', details: `${ended} sessions ended` });
  res.json({ ok: true, ended });
});
portalAdminRouter.post('/riders/:id/portal/enable', managePortal, async (req, res) => {
  const r = await portalRider(req.params.id);
  await exec('UPDATE riders SET portal_enabled = 1 WHERE id = ?', [r.id]);
  await audit(req, { action: 'portal.enable', entity_type: 'rider', entity_id: r.id });
  res.json({ ok: true });
});
// Office provisions a password without opening an ID-only sign-in window.
portalAdminRouter.post('/riders/:id/portal/reset-password', managePortal, async (req, res) => {
  const r = await portalRider(req.params.id);
  const password = checkPassword(req.body ?? {});
  await exec('UPDATE riders SET portal_password_hash = ?, portal_password_set_at = UTC_TIMESTAMP() WHERE id = ?', [await hashPassword(password), r.id]);
  const ended = await endSessions(r.id);
  await audit(req, { action: 'portal.reset_password', entity_type: 'rider', entity_id: r.id, severity: 'warning', details: `${ended} sessions ended` });
  res.json({ ok: true, ended });
});
