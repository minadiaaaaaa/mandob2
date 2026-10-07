import { unreadIssues } from './issues.js';
import { Router, type Request } from 'express';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, exec, one, q, setSetting, settingInt, tx } from '../db.js';
import { HttpError, clean, eq, fail, fieldError, list, listAll, sendExport, today, where, type Query, type Spec } from '../http.js';
import { can, has, requireUser } from '../auth.js';
import { audit } from '../audit.js';

export const systemRouter = Router();

// ---------- organization details & platform settings: plain key/value groups ----------
const ORG_RULES: Record<string, any> = {
  system_name: { max: 150 }, version: { max: 20 }, name: { max: 255 }, name_en: { max: 255 }, unified_number: { type: 'digits', max: 30 },
  cr_number: { max: 30 }, tax_number: { type: 'digits', max: 15, minLen: 15 }, support_email: { type: 'email' }, support_phone: { max: 30 },
  website: { max: 255 }, address: { max: 500 }, default_language: { enum: ['ar', 'en', 'bn', 'ur'] }, timezone: { max: 60 }, currency: { max: 3 },
  date_format: { enum: ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY', 'DD-MM-YYYY', 'D MMM YYYY'] }, maintenance: { type: 'bool' }, maintenance_message: { max: 500 },
};
const PLATFORM_RULES: Record<string, any> = {
  name: { max: 150 }, tagline: { max: 255 }, primary_color: { max: 9 }, secondary_color: { max: 9 }, currency: { max: 3 }, locale: { max: 10 }, timezone: { max: 60 },
  country: { max: 2 }, date_format: { max: 20 }, time_format: { enum: ['24', '12'] }, number_format: { max: 20 }, meta_title: { max: 120 }, meta_keywords: { max: 500 },
  meta_description: { max: 300 }, self_registration: { type: 'bool' }, email_verification: { type: 'bool' }, two_factor: { type: 'bool' },
  session_timeout: { type: 'int', min: 1 }, min_password: { type: 'int', min: 1 }, max_login_attempts: { type: 'int', min: 1 }, lockout_minutes: { type: 'int', min: 1 },
  max_upload_mb: { type: 'int', min: 1 }, allowed_file_types: { max: 255 }, tax_enabled: { type: 'bool' }, tax_rate: { type: 'num', min: 0 }, tax_label: { max: 20 },
  invoice_prefix: { max: 20 }, invoice_start: { type: 'int', min: 0 }, maintenance: { type: 'bool' }, maintenance_message: { max: 500 },
};
async function group(prefix: string) {
  const rows = await q<{ key: string; value: string }>('SELECT `key`, value FROM settings WHERE `key` LIKE ?', [`${prefix}.%`]);
  return Object.fromEntries(rows.map((r) => [r.key.slice(prefix.length + 1), r.value]));
}
async function saveGroup(req: Request, prefix: string, rules: Record<string, any>) {
  const v = clean(req.body ?? {}, rules, true);
  const before = await group(prefix);
  for (const [k, val] of Object.entries(v)) await setSetting(`${prefix}.${k}`, val === null ? '' : String(val));
  await audit(req, { action: `settings.${prefix}`, entity_type: 'settings', entity_id: prefix, before: Object.fromEntries(Object.keys(v).map((k) => [k, before[k]])), after: v });
}
systemRouter.get('/settings/organization', can('organization.view'), async (req, res) => {
  const docs = has(req, 'attachments.view')
    ? await q("SELECT id, attachment_type, file_name, mime, size, is_current, created_at FROM attachments WHERE entity_type = 'organization' ORDER BY id DESC") : [];
  res.json({ values: await group('org'), docs });
});
systemRouter.patch('/settings/organization', can('organization.update'), async (req, res) => { await saveGroup(req, 'org', ORG_RULES); res.json({ ok: true }); });
systemRouter.get('/settings/platform', can('platform_settings.view'), async (_req, res) => res.json({ values: await group('platform'), org: await group('org') }));
systemRouter.patch('/settings/platform', can('platform_settings.update'), async (req, res) => { await saveGroup(req, 'platform', PLATFORM_RULES); res.json({ ok: true }); });

// ---------- system settings: the operational keys table ----------
systemRouter.get('/settings/system', can('system_settings.view'), async (_req, res) => {
  res.json(await q("SELECT `key`, value, type, category, description, editable FROM settings WHERE category NOT IN ('organization','platform','smtp','system') ORDER BY category, `key`"));
});
const CRON = /^(\S+\s+){4}\S+$/;
systemRouter.patch('/settings/system', can('system_settings.update'), async (req, res) => {
  const values: Record<string, unknown> = req.body?.values ?? {};
  const rows = await q<any>("SELECT `key`, value, type, editable FROM settings WHERE `key` IN (?) AND category NOT IN ('organization','platform','smtp','system')", [Object.keys(values).length ? Object.keys(values) : ['']]);
  const fields: Record<string, string> = {};
  const out: [string, string][] = [];
  for (const r of rows) {
    if (!r.editable) { fields[r.key] = 'not_editable'; continue; }
    let v = values[r.key];
    const s = v === null || v === undefined ? '' : String(v).trim();
    if (r.type === 'int' && !/^-?\d+$/.test(s)) fields[r.key] = 'invalid_number';
    else if (r.type === 'decimal' && !/^-?\d+(\.\d+)?$/.test(s)) fields[r.key] = 'invalid_number';
    else if (r.type === 'bool') v = v === true || s === '1' || s === 'true' ? '1' : '0';
    else if (r.type === 'date' && s && !/^\d{4}-\d{2}-\d{2}$/.test(s)) fields[r.key] = 'invalid_date';
    else if (r.type === 'json') { try { JSON.parse(s); } catch { fields[r.key] = 'invalid_json'; } }
    if (r.key.endsWith('_cron') && s && !CRON.test(s)) fields[r.key] = 'invalid_cron';
    out.push([r.key, r.type === 'bool' ? String(v) : s]);
  }
  // A value that does not match its type rejects the whole save.
  if (Object.keys(fields).length) throw new HttpError(422, 'validation', {}, fields);
  const before = Object.fromEntries(rows.map((r: any) => [r.key, r.value]));
  await tx(async () => { for (const [k, v] of out) await setSetting(k, v); });
  await audit(req, { action: 'settings.system', entity_type: 'settings', entity_id: 'system', before, after: Object.fromEntries(out) });
  res.json({ saved: out.length });
});

// ---------- private keys: values are encrypted at rest and never shown ----------
const KEY_FILE = join(DATA_DIR, 'app.key');
function appKey() {
  if (process.env.APP_KEY) return Buffer.from(process.env.APP_KEY, 'base64');
  if (!existsSync(KEY_FILE)) writeFileSync(KEY_FILE, randomBytes(32).toString('base64'), { mode: 0o600 });
  return Buffer.from(readFileSync(KEY_FILE, 'utf8').trim(), 'base64');
}
export function encrypt(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', appKey(), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${data.toString('base64')}`;
}
export function decrypt(stored: string) {
  const [, iv, tag, data] = stored.split(':');
  const d = createDecipheriv('aes-256-gcm', appKey(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}
export async function secret(name: string) {
  const r = await one<any>('SELECT value, encrypted FROM secrets WHERE name = ?', [name]);
  return r ? (r.encrypted ? decrypt(r.value) : r.value) : null;
}
systemRouter.get('/settings/private', can('secrets.view'), async (_req, res) => {
  res.json(await q("SELECT name, description, encrypted, value IS NOT NULL AND value <> '' is_set, updated_at FROM secrets ORDER BY name"));
});
systemRouter.put('/settings/private/:name', can('secrets.update', 'secrets.create'), async (req, res) => {
  const name = String(req.params.name);
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(name)) fieldError('name', 'key_name_format');
  const exists = await one('SELECT 1 FROM secrets WHERE name = ?', [name]);
  if (!exists && !has(req, 'secrets.create')) fail(403, 'forbidden', { perm: 'secrets.create' });
  if (exists && !has(req, 'secrets.update')) fail(403, 'forbidden', { perm: 'secrets.update' });
  const v = clean(req.body, { value: { req: true }, description: { max: 255 }, encrypted: { type: 'bool' } });
  const enc = req.body.encrypted === undefined ? 1 : v.encrypted;
  await exec(`INSERT INTO secrets (name, value, description, encrypted, updated_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP())
    ON DUPLICATE KEY UPDATE value = VALUES(value), description = COALESCE(VALUES(description), description), encrypted = VALUES(encrypted), updated_at = UTC_TIMESTAMP()`,
  [name, enc ? encrypt(v.value) : v.value, v.description, enc]);
  await audit(req, { action: exists ? 'secret.replace' : 'secret.create', entity_type: 'secret', entity_id: name, severity: 'warning' });
  res.json({ ok: true });
});
systemRouter.delete('/settings/private/:name', can('secrets.delete'), async (req, res) => {
  await exec('DELETE FROM secrets WHERE name = ?', [req.params.name]);
  await audit(req, { action: 'secret.delete', entity_type: 'secret', entity_id: req.params.name as string, severity: 'critical' });
  res.json({ ok: true });
});

// ---------- every file in the system ----------
const attSpec: Spec = {
  from: 'FROM attachments a',
  select: 'a.id, a.entity_type, a.entity_id, a.attachment_type, a.file_name, a.mime, a.size, a.note, a.is_current, a.created_at',
  search: ['a.file_name', 'a.note'],
  filters: {
    entity_type: eq('a.entity_type'), attachment_type: eq('a.attachment_type'),
    kind: (v) => v === 'pdf' ? "a.mime = 'application/pdf'" : "a.mime LIKE 'image/%'",
    current: (v) => ['a.is_current = ?', [v === 'current' ? 1 : 0]],
    from: (v) => ['a.created_at >= ?', [v]], to: (v) => ['a.created_at < DATE_ADD(?, INTERVAL 1 DAY)', [v]],
  },
  sorts: { file: 'a.file_name', size: 'a.size', uploaded: 'a.created_at' }, defaultSort: '-uploaded',
};
systemRouter.get('/attachments-index', can('attachments.view'), async (req, res) => {
  const [stats] = await q('SELECT COUNT(*) files, COALESCE(SUM(size),0) bytes FROM attachments');
  const top = await q('SELECT entity_type, COUNT(*) files, SUM(size) bytes FROM attachments GROUP BY entity_type ORDER BY files DESC LIMIT 3');
  const facets = await q('SELECT DISTINCT entity_type, attachment_type FROM attachments');
  res.json({ ...(await list(attSpec, req.query as Query)), stats: { ...stats, top },
    facets: { entity_types: [...new Set(facets.map((f: any) => f.entity_type))], attachment_types: [...new Set(facets.map((f: any) => f.attachment_type).filter(Boolean))] } });
});

// ---------- activity log & login attempts ----------
const auditSpec: Spec = {
  from: 'FROM audit_log l',
  select: 'l.id, l.created_at, l.action, l.entity_type, l.entity_id, l.actor_type, l.actor_name, l.status, l.severity, l.ip',
  search: ['l.action', 'l.actor_name', 'l.entity_id', 'l.details'],
  filters: {
    action: eq('l.action'), entity_type: eq('l.entity_type'), severity: eq('l.severity'), status: eq('l.status'), actor_type: eq('l.actor_type'),
    from: (v) => ['l.created_at >= ?', [v]], to: (v) => ['l.created_at < DATE_ADD(?, INTERVAL 1 DAY)', [v]],
    entity_id: eq('l.entity_id'),
  },
  sorts: { time: 'l.id' }, defaultSort: '-time',
};
systemRouter.get('/logs/audit', can('audit_log.view', 'logs.view'), async (req, res) => {
  const facets = await q('SELECT DISTINCT action, entity_type FROM audit_log ORDER BY action LIMIT 2000');
  res.json({ ...(await list(auditSpec, req.query as Query)),
    facets: { actions: [...new Set(facets.map((f: any) => f.action))], entity_types: [...new Set(facets.map((f: any) => f.entity_type).filter(Boolean))] } });
});
systemRouter.get('/logs/audit/export', can('audit_log.export', 'logs.export'), async (req, res) => {
  await sendExport(req, res, { format: 'csv', title: 'audit.title', rows: await listAll(auditSpec, req.query as Query), cols: [
    { key: 'created_at', label: 'audit.time' }, { key: 'action', label: 'audit.action' }, { key: 'actor_name', label: 'audit.actor' }, { key: 'entity_type', label: 'audit.record_type' },
    { key: 'entity_id', label: 'audit.record' }, { key: 'status', label: 'audit.status' }, { key: 'severity', label: 'audit.severity' }, { key: 'ip', label: 'audit.ip' },
  ] });
});
systemRouter.get('/logs/audit/:id', can('audit_log.view', 'logs.view'), async (req, res) => {
  const r = await one('SELECT * FROM audit_log WHERE id = ?', [req.params.id]);
  if (!r) fail(404, 'not_found');
  res.json(r);
});
const loginSpec: Spec = {
  from: 'FROM login_attempts a LEFT JOIN users u ON u.id = a.user_id',
  select: 'a.*, u.full_name, u.username',
  search: ['a.username_typed', 'a.ip', 'u.full_name'],
  filters: { status: (v) => ['a.success = ?', [v === 'success' ? 1 : 0]], from: (v) => ['a.created_at >= ?', [v]], to: (v) => ['a.created_at < DATE_ADD(?, INTERVAL 1 DAY)', [v]] },
  sorts: { time: 'a.id' }, defaultSort: '-time',
};
systemRouter.get('/logs/login', can('login_log.view'), async (req, res) => {
  const [stats] = await q('SELECT COALESCE(SUM(success),0) success, COALESCE(SUM(1-success),0) failed, COUNT(DISTINCT ip) ips FROM login_attempts WHERE created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)');
  const busiest = await q('SELECT ip, COUNT(*) attempts, SUM(1-success) failed FROM login_attempts WHERE created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY) GROUP BY ip ORDER BY attempts DESC LIMIT 5');
  res.json({ ...(await list(loginSpec, req.query as Query)), stats: { ...stats, busiest } });
});
systemRouter.get('/logs/login/export', can('login_log.export'), async (req, res) => {
  await sendExport(req, res, { format: 'csv', title: 'login.log_title', rows: await listAll(loginSpec, req.query as Query), cols: [
    { key: 'created_at', label: 'login.at' }, { key: 'success', label: 'login.status' }, { key: 'username_typed', label: 'login.account' },
    { key: 'reason', label: 'login.reason' }, { key: 'ip', label: 'login.ip' }, { key: 'user_agent', label: 'login.device' },
  ] });
});

// ---------- sidebar badges: expired / expiring soon per document type ----------
// The badge uses the alert period set for each type in the settings, not a screen's own window.
systemRouter.get('/meta/badges', requireUser, async (req, res) => {
  const day = await today();
  const out: Record<string, { expired: number; soon: number }> = {};
  const count = async (key: string, perm: string, sql: string, alertKey: string, fallback = 30) => {
    if (!has(req, perm)) return;
    const days = await settingInt(alertKey, fallback);
    const [r] = await q<any>(sql.replace(/\{d\}/g, `'${day}'`), [days]);
    out[key] = { expired: Number(r.expired) || 0, soon: Number(r.soon) || 0 };
  };
  const docSql = (type: string) => `SELECT COALESCE(SUM(expiry_date < {d}),0) expired, COALESCE(SUM(DATEDIFF(expiry_date, {d}) BETWEEN 0 AND ?),0) soon
    FROM rider_documents WHERE is_current = 1 AND doc_type = '${type}'`;
  await count('id', 'id_documents.view', docSql('id'), 'id_document.expiry_alert_days', 60);
  await count('license', 'driving_licenses.view', docSql('license'), 'driving_license.expiry_alert_days');
  await count('health', 'health_certs.view', docSql('health'), 'health_cert.expiry_alert_days');
  await count('driver_card', 'driver_cards.view', docSql('driver_card'), 'driver_card.expiry_alert_days');
  await count('ajeer', 'ajeer_permits.view', docSql('ajeer'), 'ajeer_permit.expiry_alert_days', 60);
  const simple = (table: string, extra = '') => `SELECT COALESCE(SUM(expiry_date < {d}),0) expired, COALESCE(SUM(DATEDIFF(expiry_date, {d}) BETWEEN 0 AND ?),0) soon FROM ${table} WHERE 1 ${extra}`;
  await count('operation_cards', 'operation_cards.view', simple('operation_cards', "AND status <> 'cancelled'"), 'operation_card.expiry_alert_days');
  await count('vehicle_registrations', 'vehicle_registrations.view', simple('vehicle_registrations', 'AND is_current = 1 AND expiry_date IS NOT NULL'), 'vehicle_registration.expiry_alert_days');
  await count('insurance_policies', 'insurance_policies.view', simple('insurance_policies', "AND status <> 'cancelled'"), 'insurance_policy.expiry_alert_days', 45);
  await count('vehicle_insurance', 'vehicle_insurance.view', simple('vehicle_insurance', 'AND is_current = 1'), 'vehicle_insurance.expiry_alert_days');
  await count('transport_licenses', 'transport_licenses.view', simple('transport_licenses'), 'transport_license.expiry_alert_days', 60);
  if (has(req, 'oil_changes.view')) {
    const [r] = await q<any>(`SELECT COALESCE(SUM(DATEDIFF(DATE_ADD(last_change, INTERVAL interval_days DAY), ?) < 0),0) expired,
      COALESCE(SUM(DATEDIFF(DATE_ADD(last_change, INTERVAL interval_days DAY), ?) BETWEEN 0 AND warn_days),0) soon FROM oil_schedules`, [day, day]);
    out.oil_changes = { expired: Number(r.expired), soon: Number(r.soon) };
  }
  // conversations with unread rider messages
  if (has(req, 'rider_portal.view_issues')) out.issues = { expired: await unreadIssues(), soon: 0 };
  res.json(out);
});
