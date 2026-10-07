import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, exec, q } from './db.js';
import { BUILTIN_ROLES } from './perms.js';

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
];

// Organization details and platform settings are edited from their own tabs, not from the key table.
const OTHER: [string, string, string][] = [
  ['org.name', '', 'organization'], ['org.name_en', '', 'organization'], ['org.system_name', 'Logistics Services Platform', 'organization'],
  ['org.version', '1.0.0', 'organization'], ['org.unified_number', '', 'organization'], ['org.cr_number', '', 'organization'],
  ['org.tax_number', '', 'organization'], ['org.support_email', '', 'organization'], ['org.support_phone', '', 'organization'],
  ['org.website', '', 'organization'], ['org.address', '', 'organization'], ['org.default_language', 'ar', 'organization'],
  ['org.timezone', 'Asia/Riyadh', 'organization'], ['org.currency', 'SAR', 'organization'], ['org.date_format', 'YYYY-MM-DD', 'organization'],
  ['org.maintenance', '0', 'organization'], ['org.maintenance_message', '', 'organization'], ['org.description', '', 'organization'],
  ['platform.name', 'Logistics Services Platform', 'platform'], ['platform.tagline', '', 'platform'],
  ['platform.primary_color', '#0f766e', 'platform'], ['platform.secondary_color', '#0f172a', 'platform'],
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
];

const CITIES: [string, string][] = [
  ['الرياض', 'Riyadh'], ['جدة', 'Jeddah'], ['مكة المكرمة', 'Makkah'], ['المدينة المنورة', 'Madinah'], ['الدمام', 'Dammam'],
  ['الخبر', 'Khobar'], ['الظهران', 'Dhahran'], ['الأحساء', 'Al Ahsa'], ['القطيف', 'Qatif'], ['الجبيل', 'Jubail'],
  ['الطائف', 'Taif'], ['تبوك', 'Tabuk'], ['بريدة', 'Buraidah'], ['عنيزة', 'Unaizah'], ['حائل', 'Hail'], ['أبها', 'Abha'],
  ['خميس مشيط', 'Khamis Mushait'], ['جازان', 'Jazan'], ['نجران', 'Najran'], ['الخرج', 'Al Kharj'], ['ينبع', 'Yanbu'],
  ['الباحة', 'Al Baha'], ['عرعر', 'Arar'], ['سكاكا', 'Sakaka'], ['حفر الباطن', 'Hafar Al Batin'],
];

export async function install(log: (s: string) => void) {
  const sql = readFileSync(join(ROOT, 'src', 'schema.sql'), 'utf8');
  await exec(sql);
  log('tables');
  for (const [k, v, t, c, d] of SYSTEM) {
    await exec('INSERT IGNORE INTO settings (`key`, value, type, category, description) VALUES (?, ?, ?, ?, ?)', [k, v, t, c, d]);
  }
  for (const [k, v, c] of OTHER) await exec('INSERT IGNORE INTO settings (`key`, value, type, category, editable) VALUES (?, ?, ?, ?, 0)', [k, v, 'text', c]);
  log('settings');
  for (const role of BUILTIN_ROLES) {
    await exec('INSERT IGNORE INTO roles (name, description) VALUES (?, ?)', [role.name, role.description]);
    const [{ id }] = await q<{ id: number }>('SELECT id FROM roles WHERE name = ?', [role.name]);
    const [{ n }] = await q<{ n: number }>('SELECT COUNT(*) n FROM role_permissions WHERE role_id = ?', [id]);
    if (!n) await exec('INSERT INTO role_permissions (role_id, perm) VALUES ?', [[...new Set(role.perms)].map((p) => [id, p])]);
  }
  log('roles');
  for (const [ar, en] of CITIES) await exec('INSERT IGNORE INTO cities (name_ar, name_en) VALUES (?, ?)', [ar, en]);
  log('cities');
}
