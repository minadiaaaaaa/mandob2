import { Router } from 'express';
import { join } from 'node:path';
import { STORAGE_DIR, exec, one, q, setting } from '../db.js';
import { clean, fail, fieldError } from '../http.js';
import { clientIp, hashPassword, issueChallenge, login, logout, requireUser, verifyPassword } from '../auth.js';
import { audit } from '../audit.js';

export const publicRouter = Router();

publicRouter.get('/auth/challenge', async (req, res) => res.json(await issueChallenge(clientIp(req))));
publicRouter.post('/auth/login', login);
publicRouter.post('/auth/logout', logout);

// What the sign-in page, the public site and the shell need before anyone signs in.
publicRouter.get('/public/org', async (_req, res) => {
  const keys = ['org.name', 'org.name_en', 'org.system_name', 'org.version', 'org.cr_number', 'org.tax_number', 'org.unified_number',
    'org.support_email', 'org.support_phone', 'org.website', 'org.address', 'org.default_language', 'org.timezone', 'org.currency',
    'platform.name', 'platform.tagline', 'platform.primary_color', 'org.maintenance', 'org.maintenance_message'];
  const rows = await q<{ key: string; value: string }>('SELECT `key`, value FROM settings WHERE `key` IN (?)', [keys]);
  const logos = await q<{ id: number; attachment_type: string }>("SELECT id, attachment_type FROM attachments WHERE entity_type = 'organization' AND is_current = 1 AND attachment_type IN ('logo','logo_dark','favicon')");
  res.json({ ...Object.fromEntries(rows.map((r) => [r.key, r.value])), logos: Object.fromEntries(logos.map((l) => [l.attachment_type, l.id])) });
});

// Logos are public (sign-in page, public site); other attachments are not.
publicRouter.get('/public/logo/:type', async (req, res) => {
  const a = await one<any>("SELECT * FROM attachments WHERE entity_type = 'organization' AND is_current = 1 AND attachment_type = ?", [req.params.type]);
  if (!a || !['logo', 'logo_dark', 'favicon'].includes(req.params.type)) return res.status(404).end();
  res.setHeader('Content-Type', a.mime);
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(join(STORAGE_DIR, a.stored_name));
});

export const accountRouter = Router();
accountRouter.use(requireUser);

accountRouter.get('/me', async (req, res) => {
  const u = req.user!;
  res.json({ id: u.id, username: u.username, full_name: u.full_name, email: u.email, role: u.role_name, locale: u.locale, perms: [...u.perms],
    org_language: await setting('org.default_language') });
});

accountRouter.get('/profile', async (req, res) => {
  res.json(await one(`SELECT u.id, u.username, u.full_name, u.email, u.locale, u.status, u.created_at, u.updated_at, u.last_login_at, r.name role
    FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`, [req.user!.id]));
});

accountRouter.patch('/profile', async (req, res) => {
  const v = clean(req.body, { full_name: { req: true, max: 150 }, email: { req: true, type: 'email', max: 150 }, locale: { max: 10 } }, true);
  // a built-in language or one added on the "Languages" screen
  if (v.locale && !['ar', 'en', 'bn', 'ur'].includes(v.locale) && !(await one('SELECT 1 FROM languages WHERE code = ?', [v.locale]))) fieldError('locale', 'invalid');
  if (v.email && (await one('SELECT 1 FROM users WHERE email = ? AND id <> ?', [v.email, req.user!.id]))) fieldError('email', 'email_taken');
  const before = await one('SELECT full_name, email, locale FROM users WHERE id = ?', [req.user!.id]);
  if (Object.keys(v).length) await exec('UPDATE users SET ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [v, req.user!.id]);
  await audit(req, { action: 'profile.update', entity_type: 'user', entity_id: req.user!.id, before, after: v });
  res.json({ ok: true });
});

accountRouter.post('/profile/password', async (req, res) => {
  const { current, password, confirm } = req.body ?? {};
  const u = await one<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', [req.user!.id]);
  if (!current || !(await verifyPassword(String(current), u!.password_hash))) fieldError('current', 'current_password_wrong');
  if (!password || String(password).length < 10) fieldError('password', 'password_min_10');
  if (password === current) fieldError('password', 'password_same');
  if (password !== confirm) fieldError('confirm', 'passwords_differ');
  await exec('UPDATE users SET password_hash = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [await hashPassword(password), req.user!.id]);
  const r = await exec("UPDATE sessions SET status = 'revoked', ended_at = UTC_TIMESTAMP() WHERE user_id = ? AND status = 'active' AND id <> ?", [req.user!.id, req.user!.sessionId]);
  await audit(req, { action: 'profile.password_change', entity_type: 'user', entity_id: req.user!.id, severity: 'warning' });
  res.json({ ended: r.affectedRows });
});

accountRouter.get('/profile/sessions', async (req, res) => {
  const rows = await q(`SELECT id, status, ip, user_agent, created_at, last_activity_at, expires_at FROM sessions WHERE user_id = ? ORDER BY last_activity_at DESC LIMIT 50`, [req.user!.id]);
  res.json(rows.map((r: any) => ({ ...r, current: r.id === req.user!.sessionId })));
});

accountRouter.delete('/profile/sessions/:id', async (req, res) => {
  const r = await exec("UPDATE sessions SET status = 'revoked', ended_at = UTC_TIMESTAMP() WHERE id = ? AND user_id = ? AND status = 'active'", [req.params.id, req.user!.id]);
  if (!r.affectedRows) fail(409, 'session_already_ended');
  await audit(req, { action: 'session.end', entity_type: 'session', entity_id: req.params.id });
  res.json({ ok: true, self: Number(req.params.id) === req.user!.sessionId });
});

accountRouter.get('/profile/attempts', async (req, res) => {
  const limit = req.query.limit === '100' ? 100 : 20;
  res.json(await q('SELECT created_at, success, reason, ip, user_agent FROM login_attempts WHERE user_id = ? ORDER BY id DESC LIMIT ?', [req.user!.id, limit]));
});
