import { exec, q } from './db.js';
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

async function insert(to: { user_id?: number; rider_id?: number }, n: Note, who: string) {
  const dedupe = n.dedupe ? `${who}:${n.category}:${n.entity_type}:${n.entity_id}:${await today()}` : null;
  const r = await exec(`INSERT IGNORE INTO notifications (user_id, rider_id, category, severity, title, body, params, entity_type, entity_id, link, dedupe)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [to.user_id ?? null, to.rider_id ?? null, n.category, n.severity ?? 'info', n.title, n.body ?? null,
    n.params ? JSON.stringify(n.params) : null, n.entity_type ?? null, n.entity_id == null ? null : String(n.entity_id), n.link ?? null, dedupe]);
  return r.affectedRows;
}
