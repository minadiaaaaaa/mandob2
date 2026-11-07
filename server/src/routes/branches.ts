// Branches and job titles (designations), phase 2. Both are lists the company keeps for itself, counted against its
// plan (domain/plans.ts QUOTAS), with the same life: add, edit, switch off and on, delete while unused.
// The rules they share with riders, vehicles and imports live in domain/branches.ts.
import { Router } from 'express';
import { exec, one, q, tx } from '../db.js';
import { clean, fail, fieldError, list, listAll, mustExist, sendExport, type Spec } from '../http.js';
import { can, requireUser } from '../auth.js';
import { audit } from '../audit.js';
import { withQuota } from '../domain/quotas.js';
import { branchUse, designationUse } from '../domain/branches.js';

export const branchesRouter = Router();

// `kind` is the route path, the table and the plan quota at once
type Def = {
  kind: 'branches' | 'designations'; entity: string; spec: Spec; rules: Record<string, any>;
  // why a record may not be switched off or deleted (the main branch, a built-in title)
  locked: (row: any) => string | null;
  use: (id: string) => Promise<Record<string, number>>;
  check?: (v: Record<string, any>) => Promise<void>;
  cols: { key: string; label: string }[];
};
const name = { name_ar: { req: true, max: 100, minLen: 2 }, name_en: { max: 100 } };

function listRoutes(d: Def) {
  const one_ = (id: unknown) => one<any>(`SELECT * FROM ${d.kind} WHERE id = ?`, [id]);
  const unique = async (v: Record<string, any>, id = 0) => {
    if (v.name_ar && (await one(`SELECT 1 FROM ${d.kind} WHERE name_ar = ? AND id <> ?`, [v.name_ar, id]))) fieldError('name_ar', 'name_taken');
  };
  branchesRouter.get(`/${d.kind}`, can(`${d.kind}.view`), async (req, res) => res.json(await list(d.spec, req.query as any)));
  branchesRouter.get(`/${d.kind}/export`, can(`${d.kind}.export`), async (req, res) =>
    sendExport(req, res, { format: 'csv', title: `${d.kind}.title`, rows: await listAll(d.spec, req.query as any), cols: d.cols }));
  branchesRouter.get(`/${d.kind}/:id`, can(`${d.kind}.view`), async (req, res) => {
    const row = await one_(req.params.id);
    if (!row) fail(404, 'not_found');
    res.json({ ...row, use: await d.use(String(req.params.id)) });
  });
  branchesRouter.post(`/${d.kind}`, can(`${d.kind}.create`), async (req, res) => {
    const v = clean(req.body, d.rules);
    await unique(v);
    await d.check?.(v);
    // the insert guard (db.ts) refuses it when the plan's places are taken
    const r = await exec(`INSERT INTO ${d.kind} SET ?`, [v]);
    await audit(req, { action: `${d.entity}.create`, entity_type: d.entity, entity_id: r.insertId, after: v });
    res.json({ id: r.insertId });
  });
  branchesRouter.patch(`/${d.kind}/:id`, can(`${d.kind}.update`), async (req, res) => {
    const before = await one_(req.params.id);
    if (!before) fail(404, 'not_found');
    const v = clean(req.body, d.rules, true);
    await unique(v, Number(req.params.id));
    await d.check?.(v);
    if (Object.keys(v).length) {
      await exec(`UPDATE ${d.kind} SET ?, updated_at = UTC_TIMESTAMP() WHERE id = ?`, [v, req.params.id]);
      await audit(req, { action: `${d.entity}.update`, entity_type: d.entity, entity_id: req.params.id, before, after: v });
    }
    res.json({ ok: true });
  });
  branchesRouter.post(`/${d.kind}/:id/deactivate`, can(`${d.kind}.deactivate`), async (req, res) => {
    const row = await one_(req.params.id);
    if (!row) fail(404, 'not_found');
    const why = d.locked(row);
    if (why) fail(409, why);
    await exec(`UPDATE ${d.kind} SET is_active = 0, updated_at = UTC_TIMESTAMP() WHERE id = ?`, [req.params.id]);
    await audit(req, { action: `${d.entity}.deactivate`, entity_type: d.entity, entity_id: req.params.id, severity: 'warning' });
    res.json({ ok: true });
  });
  branchesRouter.post(`/${d.kind}/:id/activate`, can(`${d.kind}.activate`), async (req, res) => {
    const row = await one_(req.params.id);
    if (!row) fail(404, 'not_found');
    // switched back on, it takes one of the plan's places again
    await withQuota(d.kind, row.is_active ? 0 : 1, () => exec(`UPDATE ${d.kind} SET is_active = 1, updated_at = UTC_TIMESTAMP() WHERE id = ?`, [req.params.id]));
    await audit(req, { action: `${d.entity}.activate`, entity_type: d.entity, entity_id: req.params.id });
    res.json({ ok: true });
  });
  branchesRouter.delete(`/${d.kind}/:id`, can(`${d.kind}.delete`), async (req, res) => {
    const row = await one_(req.params.id);
    if (!row) fail(404, 'not_found');
    const why = d.locked(row);
    if (why) fail(409, why);
    const use = await d.use(String(req.params.id));
    if (Object.values(use).some((n) => n > 0)) fail(409, `${d.entity}_in_use`, use);
    await exec(`DELETE FROM ${d.kind} WHERE id = ?`, [req.params.id]);
    await audit(req, { action: `${d.entity}.delete`, entity_type: d.entity, entity_id: req.params.id, before: row, severity: 'critical' });
    res.json({ ok: true });
  });
}

// ---------- branches ----------
listRoutes({
  kind: 'branches', entity: 'branch',
  spec: {
    from: 'FROM branches b LEFT JOIN cities ci ON ci.id = b.city_id',
    select: `b.*, ci.name_ar city_ar, ci.name_en city_en,
      (SELECT COUNT(*) FROM riders WHERE branch_id = b.id) riders, (SELECT COUNT(*) FROM vehicles WHERE branch_id = b.id) vehicles`,
    search: ['b.name_ar', 'b.name_en'],
    filters: { status: (v) => ['b.is_active = ?', [v === 'active' ? 1 : 0]], city: (v) => ['b.city_id = ?', [v]] },
    sorts: { name: 'b.name_ar', status: 'b.is_active', created: 'b.created_at' }, defaultSort: 'name',
  },
  rules: { ...name, city_id: { type: 'int' as const }, notes: { max: 500 } },
  check: async (v) => {
    if (v.city_id != null && !(await one('SELECT 1 FROM cities WHERE id = ? AND is_active = 1', [v.city_id]))) fieldError('city_id', 'invalid');
  },
  locked: (b) => (b.is_default ? 'branch_is_default' : null),
  use: branchUse,
  cols: [{ key: 'id', label: 'common.id' }, { key: 'name_ar', label: 'branches.name_ar' }, { key: 'name_en', label: 'branches.name_en' },
    { key: 'city_ar', label: 'branches.city' }, { key: 'riders', label: 'branches.riders' }, { key: 'vehicles', label: 'branches.vehicles' },
    { key: 'is_active', label: 'common.active' }, { key: 'is_default', label: 'branches.default' }],
});
// the main branch (where records go when no branch is given) moves to another active branch
branchesRouter.post('/branches/:id/make-default', can('branches.update'), async (req, res) => {
  await mustExist('branches', req.params.id);
  await tx(async () => {
    const b = await one<{ is_active: number }>('SELECT is_active FROM branches WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!b!.is_active) fail(409, 'branch_inactive');
    await exec('UPDATE branches SET is_default = (id = ?) WHERE is_default = 1 OR id = ?', [req.params.id, req.params.id]);
  });
  await audit(req, { action: 'branch.default', entity_type: 'branch', entity_id: req.params.id });
  res.json({ ok: true });
});

// ---------- designations (job titles) ----------
listRoutes({
  kind: 'designations', entity: 'designation',
  spec: {
    from: 'FROM designations d',
    select: 'd.*, (SELECT COUNT(*) FROM riders WHERE designation_id = d.id) riders',
    search: ['d.name_ar', 'd.name_en'],
    filters: {
      status: (v) => ['d.is_active = ?', [v === 'active' ? 1 : 0]],
      type: (v) => (v === 'builtin' ? 'd.builtin_key IS NOT NULL' : 'd.builtin_key IS NULL'),
    },
    sorts: { name: 'd.name_ar', status: 'd.is_active', created: 'd.created_at' }, defaultSort: 'name',
  },
  rules: name,
  locked: (d) => (d.builtin_key ? 'designation_builtin' : null),
  use: designationUse,
  cols: [{ key: 'id', label: 'common.id' }, { key: 'name_ar', label: 'designations.name_ar' }, { key: 'name_en', label: 'designations.name_en' },
    { key: 'builtin_key', label: 'designations.builtin' }, { key: 'riders', label: 'designations.riders' }, { key: 'is_active', label: 'common.active' }],
});

// ---------- pickers on the rider and vehicle forms and the list filters ----------
// Active ones only, unless ?all=1 (an edit screen shows a switched-off value the record still has).
branchesRouter.get('/lookups/branches', requireUser, async (req, res) =>
  res.json(await q(`SELECT id, name_ar, name_en, is_default, is_active FROM branches ${req.query.all ? '' : 'WHERE is_active = 1'} ORDER BY is_default DESC, name_ar`)));
branchesRouter.get('/lookups/designations', requireUser, async (req, res) =>
  res.json(await q(`SELECT id, name_ar, name_en, builtin_key, is_active FROM designations ${req.query.all ? '' : 'WHERE is_active = 1'} ORDER BY builtin_key IS NULL, name_ar`)));
