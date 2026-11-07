// Platform IDs (phase 3): the rules the screen, the import and the reports share, defined once.
// An ID is an account number a delivery platform issued to the company. It has an owner (the rider it is registered
// to) and a worker (the rider working on it now). The worker changes only through transfer(), which writes the
// history row and the new worker together, so the history is always complete. The first assignment is a history
// row too (from nobody).
import { exec, one, q, tx } from '../db.js';
import { fail, fieldError } from '../http.js';

export const PLATFORM_ID_STATUSES = ['active', 'pending', 'blocked', 'expired'] as const;
export type PlatformIdStatus = (typeof PLATFORM_ID_STATUSES)[number];

// The platform, its contract and the riders given to an ID must exist in this company (queries are company-scoped)
// and the contract must belong to that platform. A rider whose service ended cannot be given new work.
// `current` holds the record's present values: a value it already has may stay even if it was switched off since.
export async function checkPlatformIdLinks(v: Record<string, any>, current: Record<string, any> = {}) {
  const companyId = v.company_id ?? current.company_id;
  if (v.company_id !== undefined && Number(v.company_id) !== Number(current.company_id)) {
    if (!(await one('SELECT 1 FROM companies WHERE id = ? AND is_active = 1', [v.company_id]))) fieldError('company_id', 'invalid');
  }
  const contractId = v.contract_id !== undefined ? v.contract_id : current.contract_id;
  if (contractId != null && (v.contract_id !== undefined || v.company_id !== undefined)) {
    const k = await one<{ company_id: number; is_active: number }>('SELECT company_id, is_active FROM contracts WHERE id = ?', [contractId]);
    if (!k || Number(k.company_id) !== Number(companyId)) fieldError('contract_id', 'contract_not_of_platform');
    if (!k!.is_active && Number(contractId) !== Number(current.contract_id)) fieldError('contract_id', 'invalid');
  }
  for (const field of ['owner_rider_id', 'worker_rider_id'] as const) {
    if (v[field] == null || Number(v[field]) === Number(current[field])) continue;
    await checkRider(v[field], field);
  }
}
async function checkRider(id: unknown, field: string) {
  const r = await one<{ status: string }>('SELECT status FROM riders WHERE id = ?', [id]);
  if (!r) fieldError(field, 'rider_not_found');
  if (r!.status === 'terminated') fieldError(field, 'rider_terminated');
}

// A new ID: the worker defaults to the owner ("self"), and the first assignment is recorded.
export async function createPlatformId(v: Record<string, any>, userId: number | null) {
  const row: Record<string, any> = { ...v, worker_rider_id: v.worker_rider_id !== undefined ? v.worker_rider_id : (v.owner_rider_id ?? null) };
  await checkPlatformIdLinks(row);
  if (await one('SELECT 1 FROM platform_ids WHERE company_id = ? AND id_number = ?', [row.company_id, row.id_number])) fieldError('id_number', 'id_number_taken');
  return tx(async () => {
    const r = await exec('INSERT INTO platform_ids SET ?', [row]);
    if (row.worker_rider_id != null)
      await exec('INSERT INTO platform_id_transfers SET ?, transferred_at = UTC_TIMESTAMP()', [{ platform_id: r.insertId, from_rider_id: null, to_rider_id: row.worker_rider_id, reason: null, user_id: userId }]);
    return { id: r.insertId, row };
  });
}

// Moves the work on an ID to another rider (or to nobody: `to` null). `date` (YYYY-MM-DD) is the day it happened,
// default today; it may not be after `today` nor before the day of the last change, so the history stays in order.
// A past day is stored at its start, or just after the last change when that was the same day.
export async function transfer(id: number | string, to: number | null, opts: { reason?: string | null; date?: string | null; today: string; userId: number | null }) {
  if (to != null) await checkRider(to, 'to_rider_id');
  if (opts.date && opts.date > opts.today) fieldError('date', 'date_in_future');
  return tx(async () => {
    const p = await one<{ worker_rider_id: number | null }>('SELECT worker_rider_id FROM platform_ids WHERE id = ? FOR UPDATE', [id]);
    if (!p) fail(404, 'not_found');
    const from = p!.worker_rider_id == null ? null : Number(p!.worker_rider_id);
    if (from === (to == null ? null : Number(to))) fail(409, 'same_worker');
    const [last] = await q<{ at: string | null }>("SELECT DATE_FORMAT(MAX(transferred_at), '%Y-%m-%d %H:%i:%s') at FROM platform_id_transfers WHERE platform_id = ?", [id]);
    const lastDay = last?.at?.slice(0, 10) ?? null;
    const row = { platform_id: id, from_rider_id: from, to_rider_id: to, reason: opts.reason ?? null, user_id: opts.userId };
    const afterLast = 'DATE_ADD(?, INTERVAL 1 SECOND)';
    if (!opts.date || opts.date === opts.today) {
      // now, and never before the last change
      await exec(`INSERT INTO platform_id_transfers SET ?, transferred_at = GREATEST(UTC_TIMESTAMP(), COALESCE(${afterLast}, UTC_TIMESTAMP()))`, [row, last?.at ?? null]);
    } else {
      if (lastDay && opts.date < lastDay) fieldError('date', 'before_last_transfer', { last: lastDay });
      if (opts.date === lastDay) await exec(`INSERT INTO platform_id_transfers SET ?, transferred_at = ${afterLast}`, [row, last!.at]);
      else await exec('INSERT INTO platform_id_transfers SET ?, transferred_at = ?', [row, `${opts.date} 00:00:00`]);
    }
    await exec('UPDATE platform_ids SET worker_rider_id = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [to, id]);
    return { from, to };
  });
}

// Shared IDs of a month (YYYY-MM): IDs that more than one rider worked on during the month. The riders who worked on
// an ID in the month are the one holding it when the month began and every rider it was moved to during the month.
export async function sharedIds(month: string) {
  const start = `${month}-01 00:00:00`;
  const [{ end }] = await q<{ end: string }>("SELECT DATE_FORMAT(DATE_ADD(?, INTERVAL 1 MONTH), '%Y-%m-%d %H:%i:%s') end", [start]);
  // only IDs that changed hands this month can have had more than one rider; for them, the month's transfers and
  // the last one before it (who held the ID when the month began)
  const moved = (await q<{ platform_id: number }>('SELECT DISTINCT platform_id FROM platform_id_transfers WHERE transferred_at >= ? AND transferred_at < ?', [start, end])).map((r) => r.platform_id);
  if (!moved.length) return [];
  const rows = await q<{ platform_id: number; from_rider_id: number | null; to_rider_id: number | null; at: string }>(
    `SELECT x.platform_id, x.from_rider_id, x.to_rider_id, DATE_FORMAT(x.transferred_at, '%Y-%m-%d %H:%i:%s') at FROM platform_id_transfers x
      WHERE x.platform_id IN (?) AND x.transferred_at < ? AND (x.transferred_at >= ? OR x.id = (SELECT y.id FROM platform_id_transfers y
        WHERE y.platform_id = x.platform_id AND y.transferred_at < ? ORDER BY y.transferred_at DESC, y.id DESC LIMIT 1))
      ORDER BY x.platform_id, x.transferred_at, x.id`, [moved, end, start, start]);
  const byId = new Map<number, typeof rows>();
  for (const r of rows) (byId.get(r.platform_id) ?? byId.set(r.platform_id, []).get(r.platform_id)!).push(r);
  const shared: { platform_id: number; riders: number[]; transfers: number }[] = [];
  for (const [pid, list] of byId) {
    const before = list.filter((x) => x.at < start);
    const during = list.filter((x) => x.at >= start);
    if (!during.length) continue; // nobody changed hands this month: one rider at most
    const riders = new Set<number>();
    const atStart = before.length ? before[before.length - 1].to_rider_id : during[0].from_rider_id;
    if (atStart != null) riders.add(Number(atStart));
    for (const x of during) if (x.to_rider_id != null) riders.add(Number(x.to_rider_id));
    if (riders.size > 1) shared.push({ platform_id: pid, riders: [...riders], transfers: during.length });
  }
  return shared;
}

// IDs and history a rider is part of, for the rider's profile.
export async function riderPlatformIds(riderId: number | string) {
  return q(`SELECT p.id, p.id_number, p.status, p.owner_rider_id, p.worker_rider_id, co.name platform, k.name contract
    FROM platform_ids p JOIN companies co ON co.id = p.company_id LEFT JOIN contracts k ON k.id = p.contract_id
    WHERE p.owner_rider_id = ? OR p.worker_rider_id = ? ORDER BY co.name, p.id_number`, [riderId, riderId]);
}
