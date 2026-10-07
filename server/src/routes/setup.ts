import { Router } from 'express';
import { dbConfig, isInstalled, one, q, saveDbConfig, setSetting, testConnection, type DbConfig } from '../db.js';
import { clean, fail } from '../http.js';
import { hashPassword } from '../auth.js';
import { install } from '../seed.js';
import { attach, upload } from '../files.js';
import { exec } from '../db.js';

// The "Platform Setup Wizard" (guide 11.11). Closed for good once installation completes.
export const setupRouter = Router();

setupRouter.use(async (_req, _res, next) => {
  if (await isInstalled()) fail(409, 'already_installed');
  next();
});

setupRouter.get('/status', async (_req, res) => {
  const c = dbConfig();
  let tables = false;
  let admin = false;
  if (c) {
    try {
      tables = !!(await one("SELECT 1 FROM settings WHERE `key` = 'system.installed'"));
      admin = tables && !!(await one('SELECT 1 FROM users LIMIT 1'));
    } catch { /* not created yet */ }
  }
  res.json({ installed: false, db: c ? { ...c, password: undefined } : null, tables, admin });
});

const dbRules = { host: { req: true }, port: { type: 'int' as const, min: 1, max: 65535 }, user: { req: true }, password: {}, database: { req: true, max: 64 } };
const toDb = (b: any): DbConfig => {
  const v = clean(b, dbRules);
  return { host: v.host, port: v.port ?? 3306, user: v.user, password: v.password ?? '', database: v.database };
};

setupRouter.post('/db/test', async (req, res) => {
  try { await testConnection(toDb(req.body)); res.json({ ok: true }); }
  catch (e: any) { res.status(422).json({ error: 'db_connect_failed', params: { detail: e.message } }); }
});

setupRouter.post('/db/save', async (req, res) => {
  const c = toDb(req.body);
  try { await testConnection(c, true); }
  catch (e: any) { return res.status(422).json({ error: 'db_connect_failed', params: { detail: e.message } }); }
  saveDbConfig(c);
  res.json({ ok: true });
});

setupRouter.post('/install', async (_req, res) => {
  const log: string[] = [];
  await install((s) => log.push(s));
  res.json({ ok: true, log });
});

setupRouter.post('/platform', upload.fields(['logo', 'logo_dark', 'cr', 'tax_cert', 'municipality', 'safety', 'health', 'favicon'].map((name) => ({ name, maxCount: 1 }))), async (req, res) => {
  const v = clean(req.body, {
    platform_name: { req: true, max: 150 }, description: { max: 500 }, company_name: { max: 255 }, tax_number: { max: 15 },
    address: { max: 255 }, support_email: { type: 'email' }, support_phone: { max: 30 }, website: { max: 255 },
    name_en: { max: 255 }, unified_number: { type: 'digits', max: 30 }, cr_number: { max: 30 },
    default_language: { enum: ['ar', 'en', 'bn', 'ur'] }, currency: { max: 3 }, timezone: { max: 60 }, country: { max: 2 },
    primary_color: { max: 9 }, secondary_color: { max: 9 }, tax_label: { max: 20 }, tax_rate: { type: 'num', min: 0, max: 100 }, tax_enabled: { type: 'bool' },
  });
  const map: Record<string, string> = {
    platform_name: 'platform.name', description: 'org.description', company_name: 'org.name', tax_number: 'org.tax_number', address: 'org.address',
    support_email: 'org.support_email', support_phone: 'org.support_phone', website: 'org.website', name_en: 'org.name_en',
    unified_number: 'org.unified_number', cr_number: 'org.cr_number', default_language: 'org.default_language', currency: 'org.currency',
    timezone: 'org.timezone', country: 'platform.country', primary_color: 'platform.primary_color', secondary_color: 'platform.secondary_color',
    tax_label: 'platform.tax_label', tax_rate: 'platform.tax_rate', tax_enabled: 'platform.tax_enabled',
  };
  for (const [k, key] of Object.entries(map)) if (v[k] !== null && v[k] !== undefined) await setSetting(key, String(v[k]));
  await setSetting('org.system_name', v.platform_name);
  const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
  for (const [type, list] of Object.entries(files)) await attach(req, 'organization', 1, list[0], type, null);
  res.json({ ok: true });
});

setupRouter.post('/admin', async (req, res) => {
  const v = clean(req.body, { full_name: { req: true, max: 150 }, email: { req: true, type: 'email', max: 150 }, password: { req: true, minLen: 8 } });
  if (req.body.password !== req.body.confirm) fail(422, 'passwords_differ');
  const role = await one<{ id: number }>("SELECT id FROM roles WHERE name = 'Super Admin'");
  if (!role) fail(409, 'run_install_first');
  const username = v.email.split('@')[0].replace(/[^A-Za-z0-9._-]/g, '').slice(0, 50) || 'admin';
  const existing = await one<{ id: number }>('SELECT id FROM users WHERE email = ?', [v.email]);
  if (existing) await exec('UPDATE users SET full_name = ?, password_hash = ? WHERE id = ?', [v.full_name, await hashPassword(v.password), existing.id]);
  else await exec('INSERT INTO users (username, full_name, email, password_hash, role_id) VALUES (?, ?, ?, ?, ?)', [username, v.full_name, v.email, await hashPassword(v.password), role!.id]);
  res.json({ ok: true, username });
});

setupRouter.post('/smtp', async (req, res) => {
  const v = clean(req.body, {
    host: { req: true }, port: { type: 'int', min: 1, max: 65535, req: true }, encryption: { enum: ['starttls', 'ssl', 'none'] },
    username: {}, password: {}, sender_name: {}, sender_email: { type: 'email' },
  });
  for (const [k, val] of Object.entries(v)) if (val !== null) await setSetting(`smtp.${k}`, String(val));
  await setSetting('smtp.enabled', '1');
  res.json({ ok: true });
});

setupRouter.post('/complete', async (_req, res) => {
  const [{ n }] = await q<{ n: number }>('SELECT COUNT(*) n FROM users');
  if (!n) fail(409, 'create_admin_first');
  await setSetting('system.installed', '1');
  const admin = await one<{ email: string }>('SELECT email FROM users ORDER BY id LIMIT 1');
  res.json({ ok: true, email: admin?.email, database: dbConfig()?.database });
});
