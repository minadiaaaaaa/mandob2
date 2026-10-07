import { exec, one, q } from './db.js';
import { sendMail } from './mail.js';
import { today } from './http.js';

// In-app notifications (guide 9.3). Title and body are translation keys rendered in the reader's language.
// A recipient who muted the category in-app gets nothing at all. With `dedupe`, one per recipient per record per day.
export type Note = {
  category: 'document_expiry' | 'oil_change' | 'advance_status' | 'installment_due' | 'backup' | 'security' | 'performance' | 'system' | 'general';
  severity?: 'info' | 'warning' | 'critical';
  title: string; body?: string; params?: Record<string, unknown>;
  entity_type?: string; entity_id?: string | number; link?: string; dedupe?: boolean;
};

export async function notifyUsers(users: 'all' | number[], n: Note) {
  const ids = users === 'all' ? (await q<{ id: number }>("SELECT id FROM users WHERE status = 'active'")).map((u) => u.id) : users;
  if (!ids.length) return 0;
  const muted = new Set((await q<{ user_id: number }>('SELECT user_id FROM notification_prefs WHERE category = ? AND in_app = 0 AND user_id IN (?)', [n.category, ids])).map((r) => r.user_id));
  let created = 0;
  for (const id of ids) if (!muted.has(id)) created += await insert({ user_id: id }, n, `u${id}`);
  return created;
}

export async function notifyRider(riderId: number, n: Note) {
  return insert({ rider_id: riderId }, n, `r${riderId}`);
}

// The email that goes with a notification, when there is a template for it.
function templateFor(n: Note) {
  const p = n.params ?? {};
  if (n.title === 'note.doc_expired' || n.title === 'note.doc_expiring') return `expiry.${String(p.kind ?? '').split('.').pop()}`;
  return ({ 'note.oil_due': 'oil.due', 'note.oil_overdue': 'oil.due', 'note.advance_approved': 'advance.approved', 'note.advance_rejected': 'advance.rejected',
    'note.inst_due': 'advance.installment', 'note.inst_overdue': 'advance.installment' } as Record<string, string>)[n.title] ?? null;
}
async function emailFor(to: { user_id?: number; rider_id?: number }, n: Note) {
  const tpl = templateFor(n);
  if (!tpl || !(await one('SELECT 1 FROM email_templates WHERE tkey = ?', [tpl]))) return;
  // staff get it only when they ticked "Email" for the category; a rider gets it when there is an address
  const r = to.user_id
    ? await one<any>('SELECT u.email, u.full_name name, u.locale lang FROM users u JOIN notification_prefs p ON p.user_id = u.id AND p.category = ? AND p.email = 1 WHERE u.id = ?', [n.category, to.user_id])
    : await one<any>('SELECT email, full_name name, language lang FROM riders WHERE id = ? AND email IS NOT NULL', [to.rider_id]);
  if (!r?.email) return;
  const p = n.params ?? {};
  await sendMail({ template: tpl, to: r.email, toName: r.name, lang: r.lang ?? 'ar', entity_type: n.entity_type, entity_id: n.entity_id,
    vars: { owner_name: p.owner ?? p.plate ?? r.name, doc_number: p.doc_number ?? p.number ?? '', expiry_date: p.date ?? '', days_left: p.days ?? '' } });
}

async function insert(to: { user_id?: number; rider_id?: number }, n: Note, who: string) {
  const dedupe = n.dedupe ? `${who}:${n.category}:${n.entity_type}:${n.entity_id}:${await today()}` : null;
  const r = await exec(`INSERT IGNORE INTO notifications (user_id, rider_id, category, severity, title, body, params, entity_type, entity_id, link, dedupe)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [to.user_id ?? null, to.rider_id ?? null, n.category, n.severity ?? 'info', n.title, n.body ?? null,
    n.params ? JSON.stringify(n.params) : null, n.entity_type ?? null, n.entity_id == null ? null : String(n.entity_id), n.link ?? null, dedupe]);
  if (r.affectedRows) await emailFor(to, n).catch(() => {});
  return r.affectedRows;
}
