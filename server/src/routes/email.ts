import { Router } from 'express';
import { exec, one, q, setSetting } from '../db.js';
import { clean, eq, fail, fieldError, list, listAll, sendExport, type Query, type Spec } from '../http.js';
import { can, has } from '../auth.js';
import { audit } from '../audit.js';
import { attempt, BRAND_DEFAULT, branding, fill, frame, sendMail, smtpConfig, type Account } from '../mail.js';
import { encrypt } from './system.js';

// 11.3 Email templates, SMTP settings, branding; 11.4 the email log.
export const emailRouter = Router();

// ---------- templates ----------
emailRouter.get('/email/templates', can('email_templates.view'), async (_req, res) => res.json(await q('SELECT * FROM email_templates ORDER BY grp, name')));
const declared = (t: { placeholders: string | null }) => (t.placeholders ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const used = (t: { subject: string; body_html: string }) => [...new Set([...`${t.subject} ${t.body_html}`.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];
emailRouter.get('/email/templates/:key', can('email_templates.view'), async (req, res) => {
  const t = await one<any>('SELECT * FROM email_templates WHERE tkey = ?', [req.params.key]);
  if (!t) fail(404, 'not_found');
  const d = declared(t); const u = used(t);
  res.json({ ...t, check: { both: d.filter((x) => u.includes(x)), unused: d.filter((x) => !u.includes(x)), undeclared: u.filter((x) => !d.includes(x) && !['company_name', 'company_name_en'].includes(x)) } });
});
const TPL = { name: { req: true, max: 150 }, subject: { req: true, max: 255 }, body_html: { req: true, max: 60000 }, placeholders: { max: 500 } };
emailRouter.post('/email/templates', can('email_templates.create'), async (req, res) => {
  const v = clean(req.body, { tkey: { req: true, max: 80 }, ...TPL });
  if (!/^[a-z][a-z0-9_.]{2,79}$/.test(v.tkey)) fieldError('tkey', 'template_key_format');
  if (await one('SELECT 1 FROM email_templates WHERE tkey = ?', [v.tkey])) fieldError('tkey', 'template_key_taken');
  await exec('INSERT INTO email_templates SET ?, updated_at = UTC_TIMESTAMP()', [v]);
  await audit(req, { action: 'email_template.create', entity_type: 'email_template', entity_id: v.tkey });
  res.json({ ok: true });
});
emailRouter.patch('/email/templates/:key', can('email_templates.update'), async (req, res) => {
  const v = clean(req.body, TPL, true);
  for (const k of ['name', 'subject', 'body_html']) if (k in v && !v[k]) fieldError(k, 'required');
  const r = await exec('UPDATE email_templates SET ?, updated_at = UTC_TIMESTAMP() WHERE tkey = ?', [v, req.params.key]);
  if (!r.affectedRows) fail(404, 'not_found');
  await audit(req, { action: 'email_template.update', entity_type: 'email_template', entity_id: req.params.key as string });
  res.json({ ok: true });
});
for (const state of ['activate', 'deactivate'] as const) {
  emailRouter.post(`/email/templates/:key/${state}`, can(`email_templates.${state}`), async (req, res) => {
    const t = await one<any>('SELECT is_required FROM email_templates WHERE tkey = ?', [req.params.key]);
    if (!t) fail(404, 'not_found');
    // required messages (portal verification, password recovery, the test) are always sent
    if (t.is_required && state === 'deactivate') fail(409, 'template_required');
    await exec('UPDATE email_templates SET is_active = ? WHERE tkey = ?', [state === 'activate' ? 1 : 0, req.params.key]);
    await audit(req, { action: `email_template.${state}`, entity_type: 'email_template', entity_id: req.params.key as string });
    res.json({ ok: true });
  });
}
emailRouter.delete('/email/templates/:key', can('email_templates.delete'), async (req, res) => {
  const t = await one<any>('SELECT is_system FROM email_templates WHERE tkey = ?', [req.params.key]);
  if (!t) fail(404, 'not_found');
  if (t.is_system) fail(409, 'template_system');
  await exec('DELETE FROM email_templates WHERE tkey = ?', [req.params.key]);
  await audit(req, { action: 'email_template.delete', entity_type: 'email_template', entity_id: req.params.key as string, severity: 'warning' });
  res.json({ ok: true });
});
// The preview shows the saved version, with the sample data.
emailRouter.post('/email/templates/:key/preview', can('email_templates.view'), async (req, res) => {
  const t = await one<any>('SELECT * FROM email_templates WHERE tkey = ?', [req.params.key]);
  if (!t) fail(404, 'not_found');
  const vars = req.body?.vars ?? {};
  res.json({ subject: fill(t.subject, vars).replace(/&amp;/g, '&'), html: await frame(fill(t.body_html, vars), req.body?.lang ?? 'ar') });
});
emailRouter.post('/email/templates/:key/test', can('email_templates.update'), async (req, res) => {
  const v = clean(req.body, { to: { req: true, type: 'email' } });
  const t = await one<any>('SELECT is_active FROM email_templates WHERE tkey = ?', [req.params.key]);
  if (!t) fail(404, 'not_found');
  if (!t.is_active) fail(409, 'template_inactive');
  const id = await sendMail({ template: String(req.params.key), to: v.to, vars: req.body?.vars ?? {} });
  const l = await one<any>('SELECT status, error_code, error_message FROM email_log WHERE id = ?', [id]);
  if (l.status !== 'sent') fail(422, 'email_send_failed', { reason: l.error_message });
  res.json({ ok: true });
});

// ---------- SMTP: the system account and the riders' correspondence account ----------
const acct = (p: unknown): Account => (p === 'riders' ? 'riders' : 'system');
emailRouter.get('/email/smtp', can('smtp.view'), async (_req, res) => {
  const out: Record<string, unknown> = {};
  for (const a of ['system', 'riders'] as const) { const { password, ...c } = await smtpConfig(a); out[a] = { ...c, has_password: !!password }; }
  res.json(out);
});
emailRouter.put('/email/smtp/:account', can('smtp.update'), async (req, res) => {
  const a = acct(req.params.account);
  const v = clean(req.body, { host: { req: true, max: 255 }, port: { req: true, type: 'int', min: 1, max: 65535 }, username: { max: 255 }, password: { max: 255 },
    encryption: { enum: ['starttls', 'ssl', 'none'] }, sender_name: { max: 150 }, sender_email: { type: 'email' }, enabled: { type: 'bool' } });
  const p = a === 'system' ? 'smtp' : 'smtp2';
  for (const [k, val] of Object.entries(v)) {
    if (k === 'password') { if (val) await setSetting(`${p}.password`, encrypt(String(val))); continue; } // empty keeps the saved password
    await setSetting(`${p}.${k}`, val == null ? null : String(val));
  }
  await audit(req, { action: 'smtp.update', entity_type: 'smtp', entity_id: a, severity: 'warning', after: { ...v, password: undefined } });
  res.json({ ok: true, warn_sender: !!(v.sender_email && v.username && v.sender_email.toLowerCase() !== String(v.username).toLowerCase()) });
});
emailRouter.post('/email/smtp/:account/test', can('smtp.update'), async (req, res) => {
  const v = clean(req.body, { to: { req: true, type: 'email' } });
  const id = await sendMail({ template: 'system.smtp_test', to: v.to, account: acct(req.params.account), force: true });
  const l = await one<any>('SELECT status, error_message FROM email_log WHERE id = ?', [id]);
  if (l.status !== 'sent') fail(422, 'email_send_failed', { reason: l.error_message });
  res.json({ ok: true });
});

// ---------- branding & content ----------
emailRouter.get('/email/branding', can('email_templates.view', 'smtp.view'), async (_req, res) => {
  const types = await q(`SELECT t.tkey, t.name, t.grp, t.is_active, t.is_required,
    (SELECT MAX(created_at) FROM email_log WHERE template_key = t.tkey) last_sent,
    (SELECT COUNT(*) FROM email_log WHERE template_key = t.tkey AND status = 'sent' AND created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)) sent_30,
    (SELECT COUNT(*) FROM email_log WHERE template_key = t.tkey AND status = 'failed' AND created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)) failed_30
    FROM email_templates t ORDER BY t.grp, t.name`);
  res.json({ branding: await branding(), types });
});
emailRouter.put('/email/branding', async (req, res, next) => {
  if (!has(req, 'email_templates.update') && !has(req, 'smtp.update')) return can('email_templates.update')(req, res, next);
  const b = { ...BRAND_DEFAULT, ...(await branding()) } as Record<string, any>;
  for (const k of Object.keys(BRAND_DEFAULT)) if (k in (req.body ?? {})) b[k] = req.body[k];
  for (const k of ['header_bg', 'header_text', 'accent']) if (!/^#[0-9a-f]{6}$/i.test(String(b[k]))) fieldError(k, 'invalid');
  if (b.reply_to && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.reply_to)) fieldError('reply_to', 'invalid_email');
  b.logo_width = Math.min(240, Math.max(40, Number(b.logo_width) || 120));
  for (const k of ['company_name', 'alt_name']) b[k] = String(b[k] ?? '').slice(0, 150);
  for (const k of ['footer_ar', 'footer_en']) b[k] = String(b[k] ?? '').slice(0, 500);
  await setSetting('email.branding', JSON.stringify(b));
  await audit(req, { action: 'email.branding', after: b });
  res.json({ ok: true });
});
// The live preview uses the unsaved values.
emailRouter.post('/email/branding/preview', can('email_templates.view', 'smtp.view'), async (req, res) => {
  const t = await one<any>('SELECT * FROM email_templates WHERE tkey = ?', [req.body?.template ?? 'system.smtp_test']);
  const vars = { owner_name: 'محمد أحمد', doc_number: 'L-1234', expiry_date: '2026-12-01', days_left: 14, user_name: 'Admin', job_name: 'document_expiry', status: 'completed', duration: '3s', code: '482913' };
  res.json({ html: await frame(fill(t?.body_html ?? '', vars), req.body?.lang ?? 'ar', req.body?.branding ?? {}) });
});

// ---------- 11.4 the log ----------
const logSpec: Spec = {
  from: 'FROM email_log l', select: 'l.id, l.template_key, l.to_email, l.to_name, l.cc, l.subject, l.account, l.status, l.error_code, l.error_message, l.entity_type, l.entity_id, l.retries, l.provider_id, l.created_at, l.sent_at, l.last_attempt_at',
  search: ['l.to_email', 'l.to_name', 'l.subject'],
  filters: { status: eq('l.status'), template: eq('l.template_key'), from: (v) => ['l.created_at >= ?', [v]], to: (v) => ['l.created_at < DATE_ADD(?, INTERVAL 1 DAY)', [v]] },
  sorts: { date: 'l.id' }, defaultSort: '-date',
};
emailRouter.get('/email/log', can('email_log.view'), async (req, res) => res.json(await list(logSpec, req.query as Query)));
emailRouter.get('/email/log/export', can('email_log.export'), async (req, res) => {
  await sendExport(req, res, { format: 'csv', title: 'mail.log_title', rows: await listAll(logSpec, req.query as Query), cols: [
    { key: 'created_at', label: 'mail.date' }, { key: 'status', label: 'mail.status' }, { key: 'template_key', label: 'mail.template' }, { key: 'to_email', label: 'mail.recipient' },
    { key: 'subject', label: 'mail.subject' }, { key: 'retries', label: 'mail.retries' }, { key: 'error_message', label: 'mail.error_message' },
  ] });
});
emailRouter.post('/email/log/:id/retry', can('email_templates.update'), async (req, res) => {
  const l = await one<any>('SELECT * FROM email_log WHERE id = ?', [req.params.id]);
  if (!l) fail(404, 'not_found');
  if (l.status !== 'failed') fail(409, 'email_not_failed');
  if (l.account === 'riders') fail(409, 'email_rider_no_retry');
  const t = await one<any>('SELECT is_active, is_required FROM email_templates WHERE tkey = ?', [l.template_key]);
  await exec('UPDATE email_log SET retries = retries + 1 WHERE id = ?', [l.id]);
  await attempt(l.id, t && !t.is_active && !t.is_required ? 'template_inactive' : null);
  await audit(req, { action: 'email.retry', entity_type: 'email', entity_id: l.id });
  res.json({ ok: true });
});
