// Phase 5: the rules for a rider's file that the screens, the import and the reports share.
// - Bank accounts: one or more per rider, exactly one main one when there is any. An IBAN is kept without spaces,
//   upper-case, and must pass the international check (mod 97); a Saudi one is SA + 22 digits.
// - Leaving: a rider set to Terminated gets an exit date (today unless one is given); the exit record keeps the
//   reason and the state of their dues (clear / in debt / settled).
// - Papers: what each rider has of the eight papers, and how many of the seven required ones are missing.
import { exec, one, q, tx } from '../db.js';
import { fieldError } from '../http.js';

export const EXIT_CLEARANCE = ['clear', 'in_debt', 'settled'] as const;

export function normalizeIban(raw: string) {
  return String(raw ?? '').replace(/[\s-]+/g, '').toUpperCase();
}
// ISO 13616: move the first four characters to the end, letters become 10..35, the number mod 97 must be 1.
export function validIban(iban: string) {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  if (iban.startsWith('SA') && !/^SA\d{22}$/.test(iban)) return false;
  const moved = iban.slice(4) + iban.slice(0, 4);
  let rest = 0;
  for (const ch of moved) {
    const d = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const x of d) rest = (rest * 10 + Number(x)) % 97;
  }
  return rest === 1;
}

// Adds or edits an account; the first account of a rider is the main one, and a new main one takes over.
export async function saveBankAccount(riderId: number | string, v: Record<string, any>, id?: number) {
  if (v.iban !== undefined) {
    v.iban = normalizeIban(v.iban);
    if (!validIban(v.iban)) fieldError('iban', 'iban_invalid');
    if (await one('SELECT 1 FROM rider_bank_accounts WHERE rider_id = ? AND iban = ? AND id <> ?', [riderId, v.iban, id ?? 0])) fieldError('iban', 'iban_taken');
  }
  return tx(async () => {
    const [{ n }] = await q<{ n: number }>('SELECT COUNT(*) n FROM rider_bank_accounts WHERE rider_id = ? AND id <> ?', [riderId, id ?? 0]);
    if (!Number(n)) v.is_primary = 1;
    if (v.is_primary) await exec('UPDATE rider_bank_accounts SET is_primary = 0 WHERE rider_id = ?', [riderId]);
    if (id) { await exec('UPDATE rider_bank_accounts SET ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [v, id]); return id; }
    return (await exec('INSERT INTO rider_bank_accounts SET ?', [{ ...v, rider_id: riderId }])).insertId;
  });
}
// After a delete: if the main one went, the oldest remaining becomes main.
export async function keepOnePrimary(riderId: number | string) {
  if (await one('SELECT 1 FROM rider_bank_accounts WHERE rider_id = ? AND is_primary = 1', [riderId])) return;
  await exec('UPDATE rider_bank_accounts SET is_primary = 1 WHERE rider_id = ? ORDER BY id LIMIT 1', [riderId]);
}

// Riders just set to Terminated get today as their exit date when they have none.
export async function stampExit(ids: (number | string)[], day: string) {
  if (ids.length) await exec("UPDATE riders SET exit_date = ? WHERE id IN (?) AND status = 'terminated' AND exit_date IS NULL", [day, ids]);
}

// ---------- papers ----------
export const RIDER_PAPERS = ['photo', 'id', 'license', 'passport', 'health', 'driver_card', 'ajeer', 'other'] as const;
const REQUIRED = RIDER_PAPERS.filter((p) => p !== 'other');
export async function riderPapers(filters: { search?: string; missing?: string; branch?: string }) {
  const where: string[] = ["r.status <> 'terminated'"]; const params: unknown[] = [];
  if (filters.search) { const s = `%${filters.search}%`; where.push('(r.full_name LIKE ? OR r.alias LIKE ? OR CAST(r.id AS CHAR) LIKE ?)'); params.push(s, s, s); }
  if (filters.branch) { where.push('r.branch_id = ?'); params.push(filters.branch); }
  const doc = (type: string) => `(SELECT d.id FROM rider_documents d WHERE d.rider_id = r.id AND d.doc_type = '${type}' AND d.is_current = 1 LIMIT 1) ${type}_id,
    (SELECT d.expiry_date FROM rider_documents d WHERE d.rider_id = r.id AND d.doc_type = '${type}' AND d.is_current = 1 LIMIT 1) ${type}_expiry`;
  const file = (type: string) => `(SELECT a.id FROM attachments a WHERE a.entity_type = 'rider' AND a.entity_id = CAST(r.id AS CHAR) AND a.attachment_type = '${type}' ORDER BY a.is_current DESC, a.id DESC LIMIT 1) ${type}_file`;
  const rows = await q<any>(`SELECT r.id, r.full_name, r.alias, r.passport_number, r.passport_expiry,
      ${['id', 'license', 'health', 'driver_card', 'ajeer'].map(doc).join(', ')}, ${['photo', 'passport', 'other'].map(file).join(', ')}
    FROM riders r WHERE ${where.join(' AND ')} ORDER BY r.full_name`, params);
  const out = rows.map((r) => {
    const has: Record<string, boolean> = {
      photo: r.photo_file != null, id: r.id_id != null, license: r.license_id != null, passport: r.passport_file != null || !!r.passport_number,
      health: r.health_id != null, driver_card: r.driver_card_id != null, ajeer: r.ajeer_id != null, other: r.other_file != null,
    };
    return { ...r, has, missing: REQUIRED.filter((p) => !has[p]).length };
  });
  return (filters.missing === '1' ? out.filter((r) => r.missing > 0) : out).sort((a, b) => b.missing - a.missing || String(a.full_name).localeCompare(String(b.full_name)));
}
