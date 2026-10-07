import { Router } from 'express';
import { exec, one, q } from '../db.js';
import { clean, eq, fail, fieldError, list, listAll, sendExport, type Spec } from '../http.js';
import { can, requireUser } from '../auth.js';
import { audit } from '../audit.js';

export const companiesRouter = Router();

// Small option lists for selects. Only active entries unless ?all=1 (edit screens show disabled ones too).
companiesRouter.get('/lookups/cities', requireUser, async (_req, res) => res.json(await q('SELECT id, name_ar, name_en FROM cities WHERE is_active = 1 ORDER BY name_ar')));
companiesRouter.get('/lookups/companies', requireUser, async (req, res) =>
  res.json(await q(`SELECT id, name, is_active FROM companies ${req.query.all ? '' : 'WHERE is_active = 1'} ORDER BY name`)));
companiesRouter.get('/lookups/contracts', requireUser, async (req, res) => {
  const params: unknown[] = [];
  let w = req.query.all ? 'WHERE 1' : 'WHERE c.is_active = 1';
  if (req.query.company) { w += ' AND c.company_id = ?'; params.push(req.query.company); }
  res.json(await q(`SELECT c.id, c.name, c.company_id, c.is_active FROM contracts c ${w} ORDER BY c.name`, params));
});
companiesRouter.get('/lookups/nationalities', requireUser, async (_req, res) =>
  res.json((await q<{ v: string }>('SELECT DISTINCT nationality v FROM riders WHERE nationality IS NOT NULL ORDER BY v')).map((r) => r.v)));

// ---------- delivery companies ----------
const spec: Spec = {
  from: 'FROM companies c',
  select: `c.*, (SELECT COUNT(*) FROM contracts WHERE company_id = c.id) contracts,
    (SELECT COUNT(*) FROM riders WHERE company_id = c.id) riders`,
  search: ['c.name'],
  filters: { status: (v) => ['c.is_active = ?', [v === 'active' ? 1 : 0]] },
  sorts: { name: 'c.name', status: 'c.is_active', created: 'c.created_at' },
  defaultSort: 'name',
};
const rules = { name: { req: true, max: 100, minLen: 2 }, email: { type: 'email' as const, max: 150 }, operator_id: { max: 50 }, is_active: { type: 'bool' as const } };
async function unique(name: string | undefined, id = 0) {
  if (name && (await one('SELECT 1 FROM companies WHERE name = ? AND id <> ?', [name, id]))) fieldError('name', 'company_name_taken');
}

companiesRouter.get('/companies', can('companies.view'), async (req, res) => {
  const [stats] = await q(`SELECT COUNT(*) companies, COALESCE(SUM(is_active),0) active, COALESCE(SUM(1 - is_active),0) disabled,
    (SELECT COUNT(*) FROM contracts) contracts, (SELECT COUNT(*) FROM riders WHERE company_id IS NOT NULL) riders FROM companies`);
  res.json({ ...(await list(spec, req.query as any)), stats });
});
companiesRouter.get('/companies/export', can('companies.view'), async (req, res) => {
  await sendExport(req, res, { format: 'csv', title: 'companies.title', rows: await listAll(spec, req.query as any), cols: [
    { key: 'id', label: 'common.id' }, { key: 'name', label: 'companies.company' }, { key: 'is_active', label: 'common.active' },
    { key: 'contracts', label: 'companies.contracts' }, { key: 'riders', label: 'companies.riders' }, { key: 'created_at', label: 'companies.added' },
  ] });
});
companiesRouter.get('/companies/:id', can('companies.view'), async (req, res) => {
  const c = await one<any>(`SELECT c.*, (SELECT COUNT(*) FROM contracts WHERE company_id = c.id) contracts, (SELECT COUNT(*) FROM riders WHERE company_id = c.id) riders
    FROM companies c WHERE id = ?`, [req.params.id]);
  if (!c) fail(404, 'not_found');
  res.json({ ...c, performance: 0, contract_list: await q('SELECT id, name, description, is_active FROM contracts WHERE company_id = ? ORDER BY name', [c.id]) });
});
companiesRouter.post('/companies', can('companies.create'), async (req, res) => {
  const v = clean(req.body, rules);
  await unique(v.name);
  const r = await exec('INSERT INTO companies SET ?', [{ ...v, is_active: req.body.is_active === undefined ? 1 : v.is_active }]);
  await audit(req, { action: 'company.create', entity_type: 'company', entity_id: r.insertId, after: v });
  res.json({ id: r.insertId });
});
companiesRouter.patch('/companies/:id', can('companies.update'), async (req, res) => {
  const { is_active: _a, ...editRules } = rules;
  const v = clean(req.body, editRules, true);
  await unique(v.name, Number(req.params.id));
  const before = await one('SELECT name, email, operator_id FROM companies WHERE id = ?', [req.params.id]);
  await exec('UPDATE companies SET ? WHERE id = ?', [v, req.params.id]);
  await audit(req, { action: 'company.update', entity_type: 'company', entity_id: req.params.id, before, after: v });
  res.json({ ok: true });
});
companiesRouter.post('/companies/:id/disable', can('companies.deactivate'), async (req, res) => {
  await exec('UPDATE companies SET is_active = 0 WHERE id = ?', [req.params.id]);
  await audit(req, { action: 'company.disable', entity_type: 'company', entity_id: req.params.id, severity: 'warning' });
  res.json({ ok: true });
});
companiesRouter.post('/companies/:id/enable', can('companies.activate'), async (req, res) => {
  await exec('UPDATE companies SET is_active = 1 WHERE id = ?', [req.params.id]);
  await audit(req, { action: 'company.enable', entity_type: 'company', entity_id: req.params.id });
  res.json({ ok: true });
});
companiesRouter.delete('/companies/:id', can('companies.delete'), async (req, res) => {
  const c = await one<any>('SELECT (SELECT COUNT(*) FROM contracts WHERE company_id = ?) contracts, (SELECT COUNT(*) FROM riders WHERE company_id = ?) riders', [req.params.id, req.params.id]);
  if (c.contracts || c.riders) fail(409, 'company_in_use');
  await exec('DELETE FROM companies WHERE id = ?', [req.params.id]);
  await audit(req, { action: 'company.delete', entity_type: 'company', entity_id: req.params.id, severity: 'critical' });
  res.json({ ok: true });
});

// ---------- contracts ----------
const cspec: Spec = {
  from: 'FROM contracts k JOIN companies c ON c.id = k.company_id',
  select: 'k.*, c.name company_name, c.is_active company_active, 0 performance',
  search: ['k.name', 'c.name', 'k.description'],
  filters: { company: eq('k.company_id'), status: (v) => ['k.is_active = ?', [v === 'active' ? 1 : 0]] },
  sorts: { name: 'k.name', company: 'c.name', status: 'k.is_active' },
  defaultSort: 'name',
};
const crules = { company_id: { req: true, type: 'int' as const }, name: { req: true, max: 255, minLen: 2 }, description: { max: 500 } };
async function cunique(companyId: number, name: string, id = 0) {
  if (await one('SELECT 1 FROM contracts WHERE company_id = ? AND name = ? AND id <> ?', [companyId, name, id])) fieldError('name', 'contract_name_taken');
}

companiesRouter.get('/contracts', can('contracts.view'), async (req, res) => {
  const [stats] = await q(`SELECT COUNT(*) contracts, COALESCE(SUM(k.is_active),0) active, COALESCE(SUM(1 - k.is_active),0) disabled,
    COUNT(DISTINCT k.company_id) companies, COALESCE(SUM(k.is_active = 1 AND c.is_active = 0),0) under_disabled FROM contracts k JOIN companies c ON c.id = k.company_id`);
  res.json({ ...(await list(cspec, req.query as any)), stats });
});
companiesRouter.get('/contracts/export', can('contracts.view'), async (req, res) => {
  await sendExport(req, res, { format: 'csv', title: 'contracts.title', rows: await listAll(cspec, req.query as any), cols: [
    { key: 'id', label: 'common.id' }, { key: 'name', label: 'contracts.contract' }, { key: 'company_name', label: 'contracts.company' },
    { key: 'description', label: 'contracts.description' }, { key: 'is_active', label: 'common.active' }, { key: 'performance', label: 'contracts.performance' },
  ] });
});
companiesRouter.get('/contracts/:id', can('contracts.view'), async (req, res) => {
  const k = await one('SELECT k.*, c.name company_name, c.is_active company_active, 0 performance FROM contracts k JOIN companies c ON c.id = k.company_id WHERE k.id = ?', [req.params.id]);
  if (!k) fail(404, 'not_found');
  res.json(k);
});
companiesRouter.post('/contracts', can('contracts.create'), async (req, res) => {
  const v = clean(req.body, crules);
  if (!(await one('SELECT 1 FROM companies WHERE id = ? AND is_active = 1', [v.company_id]))) fieldError('company_id', 'choose_company');
  await cunique(v.company_id, v.name);
  const r = await exec('INSERT INTO contracts SET ?', [v]);
  await audit(req, { action: 'contract.create', entity_type: 'contract', entity_id: r.insertId, after: v });
  res.json({ id: r.insertId });
});
companiesRouter.patch('/contracts/:id', can('contracts.update'), async (req, res) => {
  const before = await one<any>('SELECT company_id, name, description FROM contracts WHERE id = ?', [req.params.id]);
  if (!before) fail(404, 'not_found');
  const v = clean(req.body, crules, true);
  await cunique(v.company_id ?? before.company_id, v.name ?? before.name, Number(req.params.id));
  await exec('UPDATE contracts SET ? WHERE id = ?', [v, req.params.id]);
  const moved = v.company_id && v.company_id !== before.company_id;
  await audit(req, { action: moved ? 'contract.move_company' : 'contract.update', entity_type: 'contract', entity_id: req.params.id, severity: moved ? 'warning' : 'info', before, after: v });
  res.json({ ok: true });
});
companiesRouter.post('/contracts/:id/disable', can('contracts.deactivate'), async (req, res) => {
  await exec('UPDATE contracts SET is_active = 0 WHERE id = ?', [req.params.id]);
  await audit(req, { action: 'contract.disable', entity_type: 'contract', entity_id: req.params.id, severity: 'warning' });
  res.json({ ok: true });
});
companiesRouter.post('/contracts/:id/enable', can('contracts.activate'), async (req, res) => {
  const k = await one<any>('SELECT c.is_active FROM contracts k JOIN companies c ON c.id = k.company_id WHERE k.id = ?', [req.params.id]);
  if (!k?.is_active) fail(409, 'contract_company_disabled');
  await exec('UPDATE contracts SET is_active = 1 WHERE id = ?', [req.params.id]);
  await audit(req, { action: 'contract.enable', entity_type: 'contract', entity_id: req.params.id });
  res.json({ ok: true });
});
companiesRouter.delete('/contracts/:id', can('contracts.delete'), async (req, res) => {
  await exec('DELETE FROM contracts WHERE id = ?', [req.params.id]);
  await audit(req, { action: 'contract.delete', entity_type: 'contract', entity_id: req.params.id, severity: 'critical' });
  res.json({ ok: true });
});
