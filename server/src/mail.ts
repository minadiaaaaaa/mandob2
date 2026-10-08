import nodemailer from 'nodemailer';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STORAGE_DIR, exec, one, q, setting } from './db.js';
import { decrypt } from './routes/system.js';

// 11.3 Email: templates with {placeholders}, a branded frame, and a log of every attempt.

const T = (key: string, name: string, grp: string, placeholders: string, subject: string, body: string, required = 0) => ({ key, name, grp, placeholders, subject, body, required });
const DOC = (key: string, name: string, ar: string) => T(key, name, 'documents', 'owner_name,doc_number,expiry_date,days_left',
  `تنبيه: ${ar} {doc_number} تنتهي خلال {days_left} يوماً`,
  `<p>مرحباً،</p><p>${ar} الخاصة بـ <b>{owner_name}</b> رقم <b>{doc_number}</b> تنتهي بتاريخ <b>{expiry_date}</b> (متبقٍ {days_left} يوماً).</p><p>نرجو المبادرة بالتجديد.</p>`);
export const SEED = [
  DOC('expiry.id', 'ID / Iqama expiry', 'الهوية / الإقامة'), DOC('expiry.license', 'Driving licence expiry', 'رخصة القيادة'),
  DOC('expiry.health', 'Health certificate expiry', 'الشهادة الصحية'), DOC('expiry.driver_card', 'Driver card expiry', 'بطاقة السائق'),
  DOC('expiry.operation_card', 'Operating card expiry', 'بطاقة التشغيل'), DOC('expiry.vehicle_insurance', 'Vehicle insurance expiry', 'تأمين المركبة'),
  DOC('expiry.transport_license', 'Transport activity licence expiry', 'ترخيص نشاط النقل'), DOC('expiry.insurance_policy', 'Insurance policy expiry', 'بوليصة التأمين'),
  T('oil.due', 'Oil change due', 'documents', 'owner_name,expiry_date,days_left', 'موعد تغيير زيت {owner_name}', '<p>يحين موعد تغيير زيت المركبة <b>{owner_name}</b> بتاريخ {expiry_date} (خلال {days_left} يوماً).</p>'),
  T('advance.approved', 'Advance approved', 'advances', 'owner_name,doc_number', 'تم اعتماد سلفتك {doc_number}', '<p>عزيزي {owner_name}،</p><p>تم اعتماد السلفة رقم <b>{doc_number}</b>.</p>'),
  T('advance.rejected', 'Advance rejected', 'advances', 'owner_name,doc_number', 'تم رفض سلفتك {doc_number}', '<p>عزيزي {owner_name}،</p><p>تم رفض السلفة رقم <b>{doc_number}</b>.</p>'),
  T('advance.installment', 'Advance instalment due', 'advances', 'owner_name,doc_number,expiry_date,days_left', 'قسط مستحق على السلفة {doc_number}', '<p>عزيزي {owner_name}،</p><p>يستحق قسط السلفة <b>{doc_number}</b> بتاريخ {expiry_date} (خلال {days_left} يوماً).</p>'),
  T('security.login', 'New sign-in alert', 'security', 'user_name,login_time,ip_address,device', 'تنبيه أمني لحسابك', '<p>{user_name}، سُجّل دخول/قفل لحسابك في {login_time} من العنوان {ip_address} ({device}).</p><p>إن لم يكن هذا أنت فتواصل مع مدير النظام فوراً.</p>'),
  T('system.jobs', 'Scheduled jobs summary', 'system', 'job_name,status,duration', 'ملخص الوظيفة المجدولة {job_name}: {status}', '<p>انتهت الوظيفة <b>{job_name}</b> بنتيجة <b>{status}</b> خلال {duration}.</p>'),
  T('system.smtp_test', 'Email settings test', 'system', 'company_name', 'رسالة اختبار إعدادات البريد — {company_name}', '<p>هذه رسالة اختبار. إن وصلتك فإعدادات البريد تعمل.</p><p>This is a test message: the email settings work.</p>', 1),
  T('portal.verify_email', 'Rider portal email verification', 'portal', 'owner_name,code,link', 'رمز التحقق من بريدك: {code}', '<p>{owner_name}، رمز التحقق من بريدك الإلكتروني هو <b style="font-size:20px">{code}</b>. صالح لمدة 15 دقيقة.</p><p><a href="{link}">تأكيد البريد مباشرة</a></p>', 1),
  T('portal.reset_password', 'Rider portal password recovery', 'portal', 'owner_name,code,link', 'رمز استعادة كلمة المرور: {code}', '<p>{owner_name}، رمز استعادة كلمة المرور هو <b style="font-size:20px">{code}</b>. صالح لمدة 15 دقيقة. إن لم تطلبه فتجاهل هذه الرسالة.</p><p><a href="{link}">إدخال الرمز</a></p>', 1),
];
export async function seedTemplates() {
  for (const t of SEED) {
    await exec('INSERT IGNORE INTO email_templates (tkey, name, subject, body_html, placeholders, grp, is_system, is_required) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
      [t.key, t.name, t.subject, t.body, t.placeholders, t.grp, t.required]);
  }
}

// ---------- the branded frame ----------
export const BRAND_DEFAULT = {
  use_org: true, company_name: '', alt_name: '', header_name: 'primary', logo_source: 'org', logo_width: 120, logo_place: 'above', embed_logo: false,
  header_bg: '#0f172a', header_text: '#ffffff', accent: '#0f766e', footer_ar: '', footer_en: '',
  show_address: true, show_phone: true, show_email: true, show_website: true, show_cr: false, show_tax: false,
  auto_notice: true, auto_notice_ar: 'هذه رسالة آلية، يرجى عدم الرد عليها.', auto_notice_en: 'This is an automated message, please do not reply.', reply_to: '',
};
export type Brand = typeof BRAND_DEFAULT;
export async function branding(): Promise<Brand> {
  try { return { ...BRAND_DEFAULT, ...JSON.parse((await setting('email.branding')) ?? '{}') }; } catch { return BRAND_DEFAULT; }
}
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
export const fill = (text: string, vars: Record<string, unknown>) => text.replace(/\{(\w+)\}/g, (_, k) => esc(vars[k] ?? ''));
async function orgValues() {
  const rows = await q<any>("SELECT `key`, value FROM settings WHERE `key` LIKE 'org.%'");
  return Object.fromEntries(rows.map((r) => [r.key.slice(4), r.value ?? '']));
}
async function logoData() {
  const a = await one<any>("SELECT stored_name, mime FROM attachments WHERE entity_type = 'organization' AND is_current = 1 AND attachment_type = 'logo'");
  return a && existsSync(join(STORAGE_DIR, a.stored_name)) ? `data:${a.mime};base64,${readFileSync(join(STORAGE_DIR, a.stored_name)).toString('base64')}` : null;
}
export async function frame(bodyHtml: string, lang = 'ar', brand?: Partial<Brand>) {
  const b = { ...(await branding()), ...brand };
  const org = await orgValues();
  const primary = b.company_name || (b.use_org ? org.name : '') || (await setting('platform.name')) || '';
  const alt = b.alt_name || (b.use_org ? org.name_en : '') || primary;
  const name = b.header_name === 'alternate' ? alt : b.header_name === 'both' ? `${primary}<br><small>${esc(alt)}</small>` : b.header_name === 'by_language' && lang !== 'ar' ? alt : primary;
  const logo = b.logo_source === 'org' ? await logoData() : null;
  const rtl = lang === 'ar' || lang === 'ur';
  const contacts = [b.show_address && org.address, b.show_phone && org.support_phone, b.show_email && org.support_email, b.show_website && org.website,
    b.show_cr && org.cr_number && `CR ${org.cr_number}`, b.show_tax && org.tax_number && `VAT ${org.tax_number}`].filter(Boolean).map(esc).join(' · ');
  const footer = (rtl ? b.footer_ar : b.footer_en) || (rtl ? `© ${esc(primary)}` : `© ${esc(alt)}`);
  return `<!doctype html><html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"></head>
<body style="margin:0;background:#f4f4f5;font-family:Tahoma,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden">
<tr><td style="background:${esc(b.header_bg)};color:${esc(b.header_text)};padding:20px 24px;text-align:${b.logo_place === 'centred' ? 'center' : rtl ? 'right' : 'left'}">
${logo ? `<img src="${logo}" alt="" style="${b.logo_place === 'full' ? 'width:100%' : `width:${Number(b.logo_width)}px`};display:block;${b.logo_place === 'centred' ? 'margin:0 auto 8px' : 'margin-bottom:8px'}">` : ''}
<div style="font-size:18px;font-weight:bold">${name}</div></td></tr>
<tr><td style="padding:24px;color:#18181b;font-size:15px;line-height:1.8;text-align:${rtl ? 'right' : 'left'}">${bodyHtml.replace(/<a /g, `<a style="color:${esc(b.accent)}" `)}</td></tr>
<tr><td style="padding:16px 24px;background:#fafafa;color:#71717a;font-size:12px;text-align:center;border-top:1px solid #eee">
${footer}${contacts ? `<br>${contacts}` : ''}${b.auto_notice ? `<br><i>${esc(rtl ? b.auto_notice_ar : b.auto_notice_en)}</i>` : ''}</td></tr>
</table></td></tr></table></body></html>`;
}

// ---------- sending ----------
export type Account = 'system' | 'riders';
export async function smtpConfig(account: Account) {
  const p = account === 'system' ? 'smtp' : 'smtp2';
  const get = (k: string) => setting(`${p}.${k}`);
  const pass = (await get('password')) ?? '';
  return {
    host: (await get('host')) ?? '', port: Number((await get('port')) || 587), encryption: (await get('encryption')) || 'starttls',
    username: (await get('username')) ?? '', password: pass.startsWith('v1:') ? decrypt(pass) : pass,
    sender_name: (await get('sender_name')) ?? '', sender_email: (await get('sender_email')) ?? '', enabled: (await get('enabled')) === '1',
  };
}
async function deliver(account: Account, to: string, subject: string, html: string, cc?: string | null) {
  if ((await setting('email.enabled')) === '0') throw Object.assign(new Error('Email sending is switched off'), { code: 'email_disabled' });
  const c = await smtpConfig(account);
  if (!c.host || !c.enabled) throw Object.assign(new Error('The SMTP settings have not been set'), { code: 'smtp_not_configured' });
  if ((await setting('email.dry_run')) === '1') return 'dry-run';
  const transport = nodemailer.createTransport({ host: c.host, port: c.port, secure: c.encryption === 'ssl', requireTLS: c.encryption === 'starttls',
    ignoreTLS: c.encryption === 'none', auth: c.username ? { user: c.username, pass: c.password } : undefined, connectionTimeout: 15000 });
  const brand = await branding();
  const info = await transport.sendMail({ from: c.sender_name ? `"${c.sender_name}" <${c.sender_email || c.username}>` : c.sender_email || c.username,
    to, cc: cc || undefined, subject, html, replyTo: brand.reply_to || undefined });
  return info.messageId;
}

// Renders a template, records it in the log, and sends it. Never throws: the log row carries the outcome.
export async function sendMail(m: { template: string; to: string; toName?: string | null; vars?: Record<string, unknown>; lang?: string; account?: Account;
  entity_type?: string; entity_id?: string | number; cc?: string | null; force?: boolean }) {
  const t = await one<any>('SELECT * FROM email_templates WHERE tkey = ?', [m.template]);
  const org = await orgValues();
  const vars = { company_name: org.name, company_name_en: org.name_en, ...m.vars };
  const subject = t ? fill(t.subject, vars).replace(/&amp;/g, '&') : m.template;
  const html = t ? await frame(fill(t.body_html, vars), m.lang ?? 'ar') : '';
  const log = await exec('INSERT INTO email_log (template_key, to_email, to_name, cc, subject, body, account, entity_type, entity_id, last_attempt_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())',
    [m.template, m.to, m.toName ?? null, m.cc ?? null, subject.slice(0, 255), html, m.account ?? 'system', m.entity_type ?? null, m.entity_id == null ? null : String(m.entity_id)]);
  await attempt(log.insertId, !t ? 'template_missing' : !t.is_active && !t.is_required && !m.force ? 'template_inactive' : null);
  return log.insertId;
}
export async function attempt(id: number, refused: string | null = null) {
  const l = await one<any>('SELECT * FROM email_log WHERE id = ?', [id]);
  if (!l) return;
  try {
    if (refused) throw Object.assign(new Error(refused), { code: refused });
    const pid = await deliver(l.account, l.to_email, l.subject, l.body, l.cc);
    await exec("UPDATE email_log SET status = 'sent', sent_at = UTC_TIMESTAMP(), last_attempt_at = UTC_TIMESTAMP(), provider_id = ?, error_code = NULL, error_message = NULL WHERE id = ?", [pid, id]);
    return true;
  } catch (e: any) {
    await exec("UPDATE email_log SET status = 'failed', last_attempt_at = UTC_TIMESTAMP(), error_code = ?, error_message = ? WHERE id = ?",
      [String(e.code ?? e.responseCode ?? 'send_failed').slice(0, 60), String(e.message ?? e).slice(0, 1000), id]);
    return false;
  }
}
