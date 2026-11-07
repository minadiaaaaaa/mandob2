// The quota engine: every plan limit goes through here, never a number inside a feature.
// What each quota counts is declared once in plans.ts (QUOTAS); phases that add screens add their quota there.
import { currentTenant, inTransaction, q, setInsertGuard, tx } from '../db.js';
import { HttpError } from '../http.js';
import { QUOTAS, QUOTA_KINDS, kindOfTable, type QuotaKind } from './plans.js';
import { limits, loadTenant } from './subscription.js';

export type { QuotaKind } from './plans.js';
// the value that takes a record out of the count (a terminated rider, a switched-off contract…)
export const NOT_COUNTED = Object.fromEntries(QUOTA_KINDS.map((k) => [k, QUOTAS[k].off.value])) as Record<QuotaKind, string | number>;
const isOff = (kind: QuotaKind, v: unknown) => {
  const off = QUOTAS[kind].off.value;
  return v !== undefined && v !== null && v !== '' && (typeof off === 'number' ? Number(v) === off : String(v) === off);
};

// What the company uses now. `locking` (inside ensureQuota) reads the latest committed rows plus this transaction's
// own, instead of the snapshot an earlier read in the same transaction would otherwise pin.
export async function used(kind: QuotaKind, locking = false) {
  const quota = QUOTAS[kind];
  // a locking read sees the latest rows (tenancy.ts filters a locked table in the WHERE, not in a snapshot read)
  const n = Number((await q<{ n: number }>(`SELECT COUNT(*) n FROM ${quota.table} WHERE ${quota.counted}${locking ? ' LOCK IN SHARE MODE' : ''}`))[0].n);
  // the company owner's own account is not one of the plan's staff places
  return quota.owner ? Math.max(0, n - 1) : n;
}
export async function usage() {
  const out = {} as Record<QuotaKind, number>;
  for (const k of QUOTA_KINDS) out[k] = await used(k);
  return out;
}

// Must run inside the transaction that makes the change: it locks the company's row until that transaction ends,
// so two requests at the same moment cannot both take the last place.
export async function ensureQuota(kind: QuotaKind, adding = 1) {
  const id = currentTenant();
  if (!id || adding <= 0) return; // the platform itself has no limits
  if (!inTransaction()) throw new Error('ensureQuota must run inside the transaction that adds the record');
  await q('SELECT id FROM tenants WHERE id = ? FOR UPDATE', [id]);
  const t = await loadTenant(id);
  if (!t) return;
  const max = (await limits(t))[kind];
  if (max == null) return;
  if ((await used(kind, true)) + adding > max) throw new HttpError(402, 'plan_limit_reached', { kind, max });
}
// Runs a change that brings records back into the count, after checking the limit, as one transaction.
export const withQuota = <T>(kind: QuotaKind, adding: number, fn: () => Promise<T>) => tx(async () => { await ensureQuota(kind, adding); return fn(); });
// true when a change takes a record from "not counted" back to counted (a status, or is_active from 0 to 1)
export const comesBack = (kind: QuotaKind, before: unknown, after: unknown) =>
  after !== undefined && after !== null && after !== '' && isOff(kind, before) && !isOff(kind, after);

// How many counted records an INSERT adds: `SET ?` with the "not counted" value adds none, `VALUES ?` with a list
// of rows adds one per row (counted whatever their values, to stay on the safe side), anything else adds one.
export function insertedCount(kind: QuotaKind, parameters: unknown[]) {
  const [first] = parameters;
  if (parameters.length === 1 && Array.isArray(first) && first.every(Array.isArray)) return first.length;
  if (parameters.length === 1 && first && typeof first === 'object' && !Array.isArray(first))
    return isOff(kind, (first as Record<string, unknown>)[QUOTAS[kind].off.column]) ? 0 : 1;
  return 1;
}
// Every new counted record, from any screen, import or sync, passes this check (db.ts exec()).
setInsertGuard(async (table, parameters) => {
  const kind = kindOfTable(table);
  if (kind) await ensureQuota(kind, insertedCount(kind, parameters));
}, QUOTA_KINDS.map((k) => QUOTAS[k].table));

// ---------- "data access paused": the records above a limit, after a plan ends or gets smaller ----------
// Nothing is deleted. The oldest records up to the limit stay open; the newer ones are paused until the company
// upgrades or frees places. Riders, vehicles and staff accounts are paused; for the other quotas the company
// just cannot add more.
export const PAUSABLE = ['riders', 'vehicles', 'users'] as const;
export type Pausable = (typeof PAUSABLE)[number];
const ORDER: Record<Pausable, string> = { riders: 'created_at, id', vehicles: 'created_at, id', users: 'id' };
const pausedCache = new Map<string, { at: number; ids: Set<string> }>();
export async function pausedIds(kind: Pausable): Promise<Set<string>> {
  const tenant = currentTenant();
  if (!tenant) return new Set();
  const t = await loadTenant(tenant);
  const max = t ? (await limits(t))[kind] : null;
  if (max == null) return new Set();
  // the limit is part of the key: a plan change shows at once; new or removed records within 10 seconds
  const key = `${tenant}:${kind}:${max}`;
  const c = pausedCache.get(key);
  if (c && Date.now() - c.at < 10000) return c.ids;
  let ids = new Set<string>();
  {
    const quota = QUOTAS[kind];
    // staff: the owner (the first account) always stays, so the plan's places start after it
    const keep = quota.owner ? max + 1 : max;
    const rows = await q<{ id: string | number }>(`SELECT id FROM ${quota.table} WHERE ${quota.counted} ORDER BY ${ORDER[kind]} LIMIT 1000000 OFFSET ?`, [keep]);
    ids = new Set(rows.map((r) => String(r.id)));
  }
  pausedCache.set(key, { at: Date.now(), ids });
  return ids;
}
export async function pausedCounts() {
  const out = {} as Record<Pausable, number>;
  for (const k of PAUSABLE) out[k] = (await pausedIds(k)).size;
  return out;
}
