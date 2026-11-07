import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, ROOT, exec, q, executeScript, withTenant, asPlatform, setSetting, setting } from './db.js';
import { hashPassword } from './auth.js';
import { runMigrations } from './migrations.js';
import { ALL_PERMS, BUILTIN_ROLES, COMPANY_ADMIN, SUPER_ADMIN, adminRoleName } from './perms.js';
import { seedTemplates } from './mail.js';

// [key, default, type, category, description] — the operational keys of "System settings" (guide 11.1.3).
const SYSTEM: [string, string, string, string, string][] = [
  ['id_document.expiry_alert_days', '60', 'int', 'notifications', 'Alert this many days before the ID / Iqama expires'],
  ['driving_license.expiry_alert_days', '30', 'int', 'notifications', 'Alert this many days before the driving licence expires'],
  ['health_cert.expiry_alert_days', '30', 'int', 'notifications', 'Alert this many days before the health certificate expires'],
  ['driver_card.expiry_alert_days', '30', 'int', 'notifications', 'Alert this many days before the driver card expires'],
  ['ajeer_permit.expiry_alert_days', '60', 'int', 'notifications', 'Alert this many days before the Ajeer permit expires'],
  ['operation_card.expiry_alert_days', '30', 'int', 'notifications', 'Alert this many days before the vehicle operating card expires'],
  ['vehicle_registration.expiry_alert_days', '30', 'int', 'notifications', 'Alert this many days before the vehicle registration expires'],
  ['transport_license.expiry_alert_days', '60', 'int', 'notifications', 'Alert this many days before the transport activity licence expires'],
  ['vehicle_insurance.expiry_alert_days', '30', 'int', 'notifications', 'Alert this many days before the vehicle insurance expires'],
  ['insurance_policy.expiry_alert_days', '45', 'int', 'notifications', 'Alert this many days before the master insurance policy expires'],
  ['advance.due_alert_days', '7', 'int', 'advances', 'Alert this many days before an advance instalment is due'],
  ['notifications.retention_days', '180', 'int', 'notifications', 'Delete read notifications after this many days'],
  ['notifications.generator_cron', '0 6 * * *', 'text', 'notifications', 'The daily time for generating document expiry and instalment notifications'],
  ['notifications.email_default', '1', 'bool', 'notifications', 'Send an email with the notification by default, unless the recipient unsubscribes'],
  ['notifications.email_batch_size', '200', 'int', 'notifications', 'The maximum number of messages sent in one batch during a scheduled run'],
  ['notifications.email_lookback_days', '2', 'int', 'notifications', 'The number of past days checked for notifications whose email has not been sent'],
  ['dashboard.alert_days_critical', '7', 'int', 'general', 'The day limit for the critical level in document expiry alerts'],
  ['dashboard.alert_days_warning', '15', 'int', 'general', 'The day limit for the warning level'],
  ['dashboard.alert_days_notice', '30', 'int', 'general', 'The day limit for the notice level'],
  ['dashboard.recent_activity_limit', '12', 'int', 'general', 'The number of latest activities shown on the dashboard'],
  ['auth.max_login_attempts', '5', 'int', 'security', 'The number of failed sign-in attempts before the account is locked'],
  ['auth.lockout_minutes', '15', 'int', 'security', 'How long the account stays locked after the attempts are exceeded, in minutes. It is also the duration of the automatic address block'],
  ['auth.window_minutes', '15', 'int', 'security', 'The time window within which failed attempts are counted'],
  ['auth.session_ttl_minutes', '120', 'int', 'security', 'How long a sign-in session is valid, in minutes'],
  ['auth.challenge_ttl_seconds', '120', 'int', 'security', 'How long the verification code before sign-in is valid, in seconds'],
  ['auth.block_ip_after_failures', '20', 'int', 'security', 'The number of failed attempts from the same address before it is blocked'],
  ['advance.max_amount', '5000', 'decimal', 'advances', 'The maximum amount of a single advance'],
  ['advance.max_installments', '12', 'int', 'advances', 'The maximum number of instalments for an advance'],
  ['advance.max_open_per_rider', '1', 'int', 'advances', 'The number of unpaid advances allowed for a rider'],
  ['advance.requires_approval', '1', 'bool', 'advances', 'Require the advance to be approved before it is disbursed'],
  ['renewal.default_term_months', '12', 'int', 'general', 'The default validity period on renewal, in months'],
  ['renewal.require_receipt', '0', 'bool', 'general', 'Require a receipt to be attached when recording a renewal'],
  ['renewal.notify_on_renew', '1', 'bool', 'general', 'Notify the managers when a document renewal is recorded'],
  ['logs.cleanup_cron', '30 3 * * *', 'text', 'maintenance', 'The daily time for running the log cleanup job'],
  ['logs.audit_retention_days', '365', 'int', 'maintenance', 'Retention of the audit log. The enforced minimum is 90 days'],
  ['logs.login_retention_days', '180', 'int', 'maintenance', 'Retention of the login attempts log. The enforced minimum is 60 days'],
  ['logs.error_retention_days', '90', 'int', 'maintenance', 'Retention of the system error log'],
  ['logs.cron_retention_days', '90', 'int', 'maintenance', 'Retention of the scheduled job run log'],
  ['logs.email_retention_days', '180', 'int', 'maintenance', 'Retention of the email message log'],
  ['logs.session_retention_days', '30', 'int', 'maintenance', 'Retention of expired and revoked sessions'],
  ['email.enabled', '1', 'bool', 'email', 'Enable email sending from the whole system. A global off switch'],
  ['email.dry_run', '0', 'bool', 'email', 'Trial mode: compose the message and record it without actually sending it'],
  ['oil_change.default_alert_days', '7', 'int', 'maintenance', 'The default number of alert days before an oil change is due'],
  ['backup.auto_enabled', '1', 'bool', 'backups', 'Enable automatic backup'],
  ['backup.cron', '0 3 * * *', 'text', 'backups', 'The time of the automatic backup'],
  ['backup.keep_count', '14', 'int', 'backups', 'The number of automatic backups kept'],
  ['backup.type', 'full', 'text', 'backups', 'The type of the automatic backup'],
  ['branding.checks_cron', '*/5 * * * *', 'text', 'maintenance', 'How often the branding verification photos are checked'],
  ['branding.learn_cron', '0 4 * * *', 'text', 'maintenance', 'The daily time for learning the card model from the reviews'],
  ['sync.branding_cron', '0 10 * * *', 'text', 'maintenance', 'The daily time for syncing the branding verification photos'],
  ['sync.cron', '0 15 * * *', 'text', 'maintenance', 'The daily time for syncing the HungerStation reports'],
];

// Organization details and platform settings are edited from their own tabs, not from the key table.
const OTHER: [string, string, string][] = [
  ['org.name', '', 'organization'], ['org.name_en', '', 'organization'], ['org.system_name', 'مندوب', 'organization'],
  ['org.version', '1.0.0', 'organization'], ['org.unified_number', '', 'organization'], ['org.cr_number', '', 'organization'],
  ['org.tax_number', '', 'organization'], ['org.support_email', '', 'organization'], ['org.support_phone', '', 'organization'],
  ['org.website', '', 'organization'], ['org.address', '', 'organization'], ['org.default_language', 'ar', 'organization'],
  ['org.timezone', 'Asia/Riyadh', 'organization'], ['org.currency', 'SAR', 'organization'], ['org.date_format', 'YYYY-MM-DD', 'organization'],
  ['org.maintenance', '0', 'organization'], ['org.maintenance_message', '', 'organization'], ['org.description', '', 'organization'],
  ['platform.name', 'مندوب', 'platform'], ['platform.tagline', '', 'platform'],
  ['platform.primary_color', '#1d6b4f', 'platform'], ['platform.secondary_color', '#0f172a', 'platform'],
  ['platform.currency', 'SAR', 'platform'], ['platform.locale', 'ar', 'platform'], ['platform.timezone', 'Asia/Riyadh', 'platform'],
  ['platform.country', 'SA', 'platform'], ['platform.date_format', 'YYYY-MM-DD', 'platform'], ['platform.time_format', '24', 'platform'],
  ['platform.number_format', '1,234.56', 'platform'], ['platform.meta_title', '', 'platform'], ['platform.meta_keywords', '', 'platform'],
  ['platform.meta_description', '', 'platform'], ['platform.self_registration', '0', 'platform'], ['platform.email_verification', '0', 'platform'],
  ['platform.two_factor', '0', 'platform'], ['platform.session_timeout', '120', 'platform'], ['platform.min_password', '10', 'platform'],
  ['platform.max_login_attempts', '5', 'platform'], ['platform.lockout_minutes', '15', 'platform'], ['platform.max_upload_mb', '10', 'platform'],
  ['platform.allowed_file_types', 'pdf,jpg,jpeg,png,webp,gif', 'platform'], ['platform.tax_enabled', '1', 'platform'],
  ['platform.tax_rate', '15', 'platform'], ['platform.tax_label', 'VAT', 'platform'], ['platform.invoice_prefix', 'INV-', 'platform'],
  ['platform.invoice_start', '1', 'platform'], ['platform.maintenance', '0', 'platform'], ['platform.maintenance_message', '', 'platform'],
  ['smtp.host', '', 'smtp'], ['smtp.port', '587', 'smtp'], ['smtp.username', '', 'smtp'], ['smtp.password', '', 'smtp'],
  ['smtp.encryption', 'starttls', 'smtp'], ['smtp.sender_name', '', 'smtp'], ['smtp.sender_email', '', 'smtp'], ['smtp.enabled', '0', 'smtp'],
  ['system.installed', '0', 'system'],
  ['leave.establishment_name', '', 'leaves'], ['leave.default_reason', 'ظروف عائلية طارئة', 'leaves'],
  ['leave.email_requires_file', '1', 'leaves'], ['leave.auto_stamp', '0', 'leaves'],
];

const CITIES: [string, string][] = [
  ['الرياض', 'Riyadh'], ['جدة', 'Jeddah'], ['مكة المكرمة', 'Makkah'], ['المدينة المنورة', 'Madinah'], ['الدمام', 'Dammam'],
  ['الخبر', 'Khobar'], ['الظهران', 'Dhahran'], ['الأحساء', 'Al Ahsa'], ['القطيف', 'Qatif'], ['الجبيل', 'Jubail'],
  ['الطائف', 'Taif'], ['تبوك', 'Tabuk'], ['بريدة', 'Buraidah'], ['عنيزة', 'Unaizah'], ['حائل', 'Hail'], ['أبها', 'Abha'],
  ['خميس مشيط', 'Khamis Mushait'], ['جازان', 'Jazan'], ['نجران', 'Najran'], ['الخرج', 'Al Kharj'], ['ينبع', 'Yanbu'],
  ['الباحة', 'Al Baha'], ['عرعر', 'Arar'], ['سكاكا', 'Sakaka'], ['حفر الباطن', 'Hafar Al Batin'],
];

// Columns that later versions widened: [table, column, type it must have now].
const WIDENED: [string, string, string][] = [
  ['audit_log', 'actor_type', "ENUM('user','system','api','guest','job','rider') NOT NULL DEFAULT 'user'"],
  ['rider_change_requests', 'rider_note', 'VARCHAR(1000) NULL'],
];

async function ensureSchema() {
  // server/src/schema.sql is idempotent (CREATE TABLE IF NOT EXISTS), so it runs at every start.
  await executeScript(readFileSync(join(ROOT, 'src', 'schema.sql'), 'utf8'));
  for (const [t, c, def] of WIDENED) {
    const [col] = await q<{ ty: string }>('SELECT COLUMN_TYPE ty FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [t, c]);
    if (col && !def.toLowerCase().startsWith(col.ty.toLowerCase())) await executeScript(`ALTER TABLE ${t} MODIFY ${c} ${def}`);
  }
}

// The plans offered at sign-up, editable afterwards from the owner dashboard (the defaults follow LogisTap's tiers).
export const DEFAULT_PLANS = [
  { key: 'starter', name_ar: 'البداية', name_en: 'Starter', price_monthly: 0, price_annual: 0, max_riders: 50, max_users: 2, max_vehicles: 60, sort: 1 },
  { key: 'growth', name_ar: 'النمو', name_en: 'Growth', price_monthly: 0, price_annual: 0, max_riders: 100, max_users: 5, max_vehicles: 120, sort: 2 },
  { key: 'scale', name_ar: 'التوسع', name_en: 'Scale', price_monthly: 0, price_annual: 0, max_riders: 200, max_users: 8, max_vehicles: 240, sort: 3 },
];
export const TRIAL_PLAN = 'starter';
export const TRIAL_DAYS = 14;
async function seedPlans() {
  await asPlatform(() => exec('INSERT IGNORE INTO plans (`key`, name_ar, name_en, price_monthly, price_annual, max_riders, max_users, max_vehicles, sort) VALUES ?',
    [DEFAULT_PLANS.map(p => [p.key, p.name_ar, p.name_en, p.price_monthly, p.price_annual, p.max_riders, p.max_users, p.max_vehicles, p.sort])]));
}

// Everything one company needs before its first sign-in: settings, email templates, the built-in roles.
// Idempotent, so it also runs at every start to give existing companies what later versions add.
export async function seedTenant(tenant: number) {
  await withTenant(tenant, async () => {
    // the product is now called "مندوب"; installs that kept the old default name take the new one
    await exec("UPDATE settings SET value = 'مندوب' WHERE `key` IN ('org.system_name', 'platform.name') AND value = 'Logistics Services Platform'");
    await exec('INSERT IGNORE INTO settings (`key`, value, type, category, description) VALUES ?', [SYSTEM]);
    await exec('INSERT IGNORE INTO settings (`key`, value, type, category, editable) VALUES ?', [OTHER.map(([k,v,c])=>[k,v,'text',c,0])]);
    await seedTemplates();
    // companies signed up before the rename: their full role becomes Admin
    if (tenant !== 0) await exec('UPDATE IGNORE roles SET name = ?, description = ? WHERE name = ?', [COMPANY_ADMIN, 'Full permissions inside this company', SUPER_ADMIN]);
    for (const builtin of BUILTIN_ROLES) {
      const full = builtin.name === SUPER_ADMIN;
      const role = full ? { ...builtin, name: adminRoleName(tenant), description: tenant === 0 ? builtin.description : 'Full permissions inside this company' } : builtin;
      await exec('INSERT IGNORE INTO roles (name, description) VALUES (?, ?)', [role.name, role.description]);
      const [{ id }] = await q<{ id: number }>('SELECT id FROM roles WHERE name = ?', [role.name]);
      const [{ n }] = await q<{ n: number }>('SELECT COUNT(*) n FROM role_permissions WHERE role_id = ?', [id]);
      if (!n) await exec('INSERT INTO role_permissions (role_id, perm) VALUES ?', [[...new Set(role.perms)].map((p) => [id, p])]);
    }
    // the full role (Super Admin on the platform, Admin in a company) keeps every permission, including later ones
    const admin = (await q<{ id: number }>('SELECT id FROM roles WHERE name = ?', [adminRoleName(tenant)]))[0];
    if (admin) await exec('INSERT IGNORE INTO role_permissions (role_id, perm) VALUES ?', [ALL_PERMS.map(perm => [admin.id, perm])]);
  });
}

// Runs at every start of an installed system. Every statement is idempotent.
export async function upgrade() {
  await asPlatform(ensureSchema);
  await seedPlans();
  const tenants = await asPlatform(() => q<{ id: number }>('SELECT id FROM tenants'));
  for (const t of [0, ...tenants.map(x => x.id)]) await seedTenant(t);
}

// The setup wizard installs the platform itself (company 0, where the platform owner signs in).
export async function install(log: (s: string) => void) {
  await asPlatform(ensureSchema);
  log('tables');
  await seedPlans();
  await seedTenant(0);
  log('settings');
  log('roles');
  for (const [ar, en] of CITIES) await asPlatform(() => exec('INSERT IGNORE INTO cities (name_ar, name_en) VALUES (?, ?)', [ar, en]));
  log('cities');
}

// No setup screens: at every start the tables are created or completed, and the platform owner's account (company 0)
// is created once from OWNER_EMAIL / OWNER_PASSWORD / OWNER_NAME in .env. Without them a random password is written to
// server/data/first-login.txt; change it from the profile after signing in.
export async function bootstrap() {
  const fresh = (await withTenant(0, () => setting('system.installed').catch(() => null))) !== '1';
  if (fresh) await install(() => {}); else await upgrade();
  // every change after the schema.sql baseline, once per database (see migrations.ts)
  await runMigrations();
  await withTenant(0, async () => {
    if (fresh) {
      if (!(await setting('platform.name'))) await setSetting('platform.name', process.env.PLATFORM_NAME || 'مندوب');
      await setSetting('org.system_name', process.env.PLATFORM_NAME || 'مندوب');
      if (!(await setting('org.name'))) await setSetting('org.name', process.env.PLATFORM_NAME || 'مندوب');
    }
    const [owner] = await q<{ id: number }>('SELECT id FROM users ORDER BY id LIMIT 1');
    if (!owner) {
      const email = (process.env.OWNER_EMAIL || 'admin@mandoob.local').trim().toLowerCase();
      const generated = !process.env.OWNER_PASSWORD;
      const password = process.env.OWNER_PASSWORD || randomBytes(9).toString('base64url');
      if (password.length < 8) throw new Error('OWNER_PASSWORD must be at least 8 characters');
      const username = email.split('@')[0].replace(/[^A-Za-z0-9._-]/g, '').slice(0, 50) || 'admin';
      const [role] = await q<{ id: number }>("SELECT id FROM roles WHERE name = 'Super Admin'");
      await exec('INSERT INTO users (username, full_name, email, password_hash, role_id) VALUES (?, ?, ?, ?, ?)',
        [username, process.env.OWNER_NAME || 'Platform owner', email, await hashPassword(password), role.id]);
      if (generated) {
        const file = join(DATA_DIR, 'first-login.txt');
        writeFileSync(file, `Mandoob platform owner
Username: ${username}
Email: ${email}
Password: ${password}
Change this password from the profile after signing in, then delete this file.
`);
        console.log(`Platform owner created. Sign-in details: ${file}`);
      } else console.log(`Platform owner created: ${email}`);
    }
    await setSetting('system.installed', '1');
  });
}
