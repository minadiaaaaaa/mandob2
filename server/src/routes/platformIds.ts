// Platform IDs (phase 3): the list with its status cards, the profile with its transfer history, transfers, the
// shared IDs of a month, export and import. The rules live in domain/platformIds.ts. A company's own data on every
// plan: no quota, no feature gate.
import { Router } from 'express';
import { exec, one, q, tx } from '../db.js';
import { clean, fail, fieldError, list, listAll, sendExport, today, where, type Spec } from '../http.js';
import { can } from '../auth.js';
import { audit } from '../audit.js';
import { cellStr, importRoutes, type ImportDef } from '../importer.js';
import { PLATFORM_ID_STATUSES, checkPlatformIdLinks, createPlatformId, riderPlatformIds, sharedIds, transfer } from '../domain/platformIds.js';

export const platformIdsRouter = Router();

const SPEC: Spec = {
  from: `FROM platform_ids p JOIN companies co ON co.id = p.company_id LEFT JOIN contracts k ON k.id = p.contract_id
    LEFT JOIN riders o ON o.id = p.owner_rider_id LEFT JOIN riders w ON w.id = p.worker_rider_id`,
  select: `p.id, p.id_number, p.company_id, p.contract_id, p.owner_rider_id, p.worker_rider_id, p.status, p.notes, p.created_at, p.updated_at,
    co.name platform, k.name contract, o.full_name owner_name, o.alias owner_alias, w.full_name worker_name, w.alias worker_alias,
    (p.owner_rider_id <=> p.worker_rider_id) is_self`,
  search: ['p.id_number', 'o.full_name', 'o.alias', 'w.full_name', 'w.alias'],
  filters: {
    status: (v) => ['p.status = ?', [v]],
    platform: (v) => ['p.company_id = ?', [v]],
    contract: (v) => ['p.contract_id = ?', [v]],
    rider: (v) => ['(p.owner_rider_id = ? OR p.worker_rider_id = ?)', [v, v]],
    // who works on it: the owner, someone else, or nobody
    worker: (v) => (v === 'self' ? 'p.worker_rider_id IS NOT NULL AND p.worker_rider_id <=> p.owner_rider_id'
      : v === 'other' ? 'p.worker_rider_id IS NOT NULL AND NOT (p.worker_rider_id <=> p.owner_rider_id)' : v === 'none' ? 'p.worker_rider_id IS NULL' : null),
  },
  sorts: { id_number: 'p.id_number', owner: 'o.full_name', worker: 'w.full_name', platform: 'co.name', status: 'p.status', created: 'p.created_at' },
  defaultSort: 'platform',
};
const RULES = {
  id_number: { req: true, max: 50 }, company_id: { req: true, type: 'int' as const }, contract_id: { type: 'int' as const },
  owner_rider_id: { type: 'int' as const }, status: { enum: PLATFORM_ID_STATUSES }, notes: { max: 500 },
};
const COLS = [
  { key: 'id_number', label: 'pids.id_number' }, { key: 'platform', label: 'pids.platform' }, { key: 'contract', label: 'pids.contract' },
  { key: 'owner_rider_id', label: 'pids.owner_id' }, { key: 'owner_name', label: 'pids.owner' },
  { key: 'worker_rider_id', label: 'pids.worker_id' }, { key: 'worker_name', label: 'pids.worker' },
  { key: 'status', label: 'pids.status' }, { key: 'notes', label: 'common.notes' },
];

// ---------- import (one row per ID; the platform and the ID number find an existing one) ----------
const STATUS_IN: Record<string, string> = Object.fromEntries(PLATFORM_ID_STATUSES.flatMap((s) => [[s, s]]));
const platformIdImport: ImportDef = {
  name: 'platform_ids', perm: 'platform_ids.import', matchOn: 'pids.match',
  columns: {
    id_number: ['pids.id_number', 'id number', 'platform id'], platform: ['pids.platform', 'platform'], contract: ['pids.contract', 'contract'],
    owner: ['pids.owner_id', 'owner', 'owner id'], worker: ['pids.worker_id', 'worker', 'worker id'], status: ['pids.status', 'status'],
    notes: ['common.notes', 'notes'],
  },
  requiredColumns: [['id_number'], ['platform']],
  async parse(row, ctx) {
    const number = cellStr(row.id_number, 50), name = cellStr(row.platform, 100);
    if (!number || !name) return 'no_key';
    if (!ctx.cache.has('platforms')) ctx.cache.set('platforms', new Map((await q<any>('SELECT id, name FROM companies')).map((c) => [c.name.trim().toLowerCase(), c.id])));
    const company_id = ctx.cache.get('platforms').get(name.trim().toLowerCase());
    if (!company_id) return 'platform_not_found';
    const d: Record<string, any> = { id_number: number, company_id };
    if (ctx.present.has('contract')) {
      const c = cellStr(row.contract, 255);
      d.contract_id = c ? (await one<{ id: number }>('SELECT id FROM contracts WHERE company_id = ? AND name = ?', [company_id, c]))?.id ?? false : null;
      if (d.contract_id === false) return 'contract_not_found';
    }
    for (const [col, field] of [['owner', 'owner_rider_id'], ['worker', 'worker_rider_id']] as const) {
      if (!ctx.present.has(col)) continue;
      const s = cellStr(row[col], 20);
      if (s && !/^\d+$/.test(s)) return 'invalid_value';
      // an empty owner cell clears the owner; an empty worker cell changes nothing (a new ID is then worked by its owner)
      if (s) d[field] = Number(s);
      else if (field === 'owner_rider_id') d[field] = null;
    }
    if (ctx.present.has('status')) { const s = cellStr(row.status)?.toLowerCase(); if (s && !STATUS_IN[s]) return 'invalid_value'; if (s) d.status = s; }
    if (ctx.present.has('notes')) d.notes = cellStr(row.notes, 500);
    return { line: 0, key: `${company_id}|${number}`, data: d, label: `${name} ${number}` };
  },
  async existing(items) {
    const m = new Map<string, any>();
    if (items.length) for (const r of await q<any>('SELECT * FROM platform_ids WHERE id_number IN (?)', [items.map((i) => i.data.id_number)])) m.set(`${r.company_id}|${r.id_number}`, r);
    return m;
  },
  async check(it, ex) {
    try { await checkPlatformIdLinks(it.data, ex ?? {}); } catch (e: any) { return (Object.values(e.fields ?? {})[0] as string | undefined) ?? e.code ?? 'invalid_value'; }
    return null;
  },
  async write(it, ex, ctx) {
    const { worker_rider_id, ...rest } = it.data;
    if (!ex) {
      const v = 'worker_rider_id' in it.data ? it.data : rest;
      const { id } = await createPlatformId(v, ctx.req.user!.id);
      await audit(ctx.req, { action: 'platform_id.create', entity_type: 'platform_id', entity_id: id, after: v, details: 'import' });
      return 'inserted';
    }
    if (ctx.mode === 'skip') return 'skipped';
    await exec('UPDATE platform_ids SET ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [rest, ex.id]);
    // a different worker in the file is a transfer, kept in the history like one made on the screen
    if ('worker_rider_id' in it.data && (worker_rider_id ?? null) !== (ex.worker_rider_id == null ? null : Number(ex.worker_rider_id)))
      await transfer(ex.id, worker_rider_id ?? null, { reason: null, date: null, today: await today(), userId: ctx.req.user!.id });
    await audit(ctx.req, { action: 'platform_id.update', entity_type: 'platform_id', entity_id: ex.id, before: ex, after: it.data, details: 'import' });
    return 'replaced';
  },
};
platformIdsRouter.use('/platform-ids/import', importRoutes(platformIdImport));

platformIdsRouter.get('/platform-ids', can('platform_ids.view'), async (req, res) => {
  const query = req.query as Record<string, string>;
  const data = await list(SPEC, query);
  // the cards count every status under the other filters
  const w = where(SPEC, query, ['status']);
  const [stats] = await q(`SELECT COUNT(*) total, COALESCE(SUM(p.status = 'active'),0) active, COALESCE(SUM(p.status = 'pending'),0) pending,
    COALESCE(SUM(p.status = 'blocked'),0) blocked, COALESCE(SUM(p.status = 'expired'),0) expired,
    COALESCE(SUM(p.worker_rider_id IS NOT NULL AND NOT (p.worker_rider_id <=> p.owner_rider_id)),0) other_worker ${SPEC.from}${w.sql}`, w.params);
  res.json({ ...data, stats });
});

platformIdsRouter.get('/platform-ids/export', can('platform_ids.export'), async (req, res) =>
  sendExport(req, res, { format: req.query.format === 'csv' ? 'csv' : 'xlsx', title: 'pids.title', rows: await listAll(SPEC, req.query as any), cols: COLS }));

// The IDs more than one rider worked on in a month (?month=YYYY-MM, default this month).
platformIdsRouter.get('/platform-ids/shared', can('platform_ids.view'), async (req, res) => {
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(req.query.month ?? '')) ? String(req.query.month) : (await today()).slice(0, 7);
  const shared = await sharedIds(month);
  if (!shared.length) return res.json({ month, rows: [] });
  const ids = shared.map((s) => s.platform_id);
  const riderIds = [...new Set(shared.flatMap((s) => s.riders))];
  const info = new Map((await q<any>(`SELECT p.id, p.id_number, p.status, co.name platform FROM platform_ids p JOIN companies co ON co.id = p.company_id WHERE p.id IN (?)`, [ids])).map((r) => [r.id, r]));
  const names = new Map((await q<any>('SELECT id, full_name FROM riders WHERE id IN (?)', [riderIds])).map((r) => [Number(r.id), r.full_name]));
  res.json({ month, rows: shared.map((s) => ({ ...info.get(s.platform_id), transfers: s.transfers, riders: s.riders.map((id) => ({ id, full_name: names.get(id) ?? null })) })) });
});

// A rider's IDs, for the rider's profile
platformIdsRouter.get('/riders/:id/platform-ids', can('platform_ids.view'), async (req, res) => res.json(await riderPlatformIds(String(req.params.id))));

platformIdsRouter.get('/platform-ids/:id', can('platform_ids.view'), async (req, res) => {
  const [row] = await q(`SELECT ${SPEC.select} ${SPEC.from} WHERE p.id = ?`, [req.params.id]);
  if (!row) fail(404, 'not_found');
  const history = await q(`SELECT x.id, x.from_rider_id, x.to_rider_id, x.transferred_at, x.reason, f.full_name from_name, t.full_name to_name, u.full_name by_name
    FROM platform_id_transfers x LEFT JOIN riders f ON f.id = x.from_rider_id LEFT JOIN riders t ON t.id = x.to_rider_id LEFT JOIN users u ON u.id = x.user_id
    WHERE x.platform_id = ? ORDER BY x.transferred_at DESC, x.id DESC`, [req.params.id]);
  res.json({ ...row, history });
});

platformIdsRouter.post('/platform-ids', can('platform_ids.create'), async (req, res) => {
  const v = clean(req.body, { ...RULES, worker_rider_id: { type: 'int' as const } });
  // a worker given on its own (no owner) is still a worker; left out, the owner works on it
  if (!('worker_rider_id' in (req.body ?? {}))) delete v.worker_rider_id;
  const { id, row } = await createPlatformId(v, req.user!.id);
  await audit(req, { action: 'platform_id.create', entity_type: 'platform_id', entity_id: id, after: row });
  res.json({ id });
});

// Everything but the worker, which changes only by a transfer.
platformIdsRouter.patch('/platform-ids/:id', can('platform_ids.update'), async (req, res) => {
  const before = await one<any>('SELECT * FROM platform_ids WHERE id = ?', [req.params.id]);
  if (!before) fail(404, 'not_found');
  if ('worker_rider_id' in (req.body ?? {})) fail(422, 'worker_by_transfer');
  const v = clean(req.body, RULES, true);
  // a new platform drops a contract of the old one unless a new contract comes with it
  if (v.company_id !== undefined && Number(v.company_id) !== Number(before.company_id) && v.contract_id === undefined) v.contract_id = null;
  await checkPlatformIdLinks(v, before);
  const number = v.id_number ?? before.id_number, platform = v.company_id ?? before.company_id;
  if ((v.id_number !== undefined || v.company_id !== undefined) && (await one('SELECT 1 FROM platform_ids WHERE company_id = ? AND id_number = ? AND id <> ?', [platform, number, req.params.id])))
    fieldError('id_number', 'id_number_taken');
  if (Object.keys(v).length) {
    await exec('UPDATE platform_ids SET ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [v, req.params.id]);
    await audit(req, { action: 'platform_id.update', entity_type: 'platform_id', entity_id: req.params.id, before, after: v });
  }
  res.json({ ok: true });
});

platformIdsRouter.post('/platform-ids/:id/transfer', can('platform_ids.transfer'), async (req, res) => {
  const v = clean(req.body, { to_rider_id: { type: 'int' }, date: { type: 'date' }, reason: { max: 255 } });
  const r = await transfer(String(req.params.id), v.to_rider_id ?? null, { reason: v.reason, date: v.date, today: await today(), userId: req.user!.id });
  await audit(req, { action: 'platform_id.transfer', entity_type: 'platform_id', entity_id: req.params.id, before: { worker_rider_id: r.from }, after: { worker_rider_id: r.to, date: v.date ?? null, reason: v.reason ?? null } });
  res.json({ ok: true });
});

// Deleting an ID entered by mistake removes its history with it.
platformIdsRouter.delete('/platform-ids/:id', can('platform_ids.delete'), async (req, res) => {
  const before = await one<any>('SELECT * FROM platform_ids WHERE id = ?', [req.params.id]);
  if (!before) fail(404, 'not_found');
  await tx(async () => {
    await exec('DELETE FROM platform_id_transfers WHERE platform_id = ?', [req.params.id]);
    await exec('DELETE FROM platform_ids WHERE id = ?', [req.params.id]);
  });
  await audit(req, { action: 'platform_id.delete', entity_type: 'platform_id', entity_id: req.params.id, before, severity: 'critical' });
  res.json({ ok: true });
});
