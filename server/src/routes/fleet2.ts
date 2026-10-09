import { Router, type Request } from 'express';
import { exec, one, q, tx } from '../db.js';
import { addMonths, clean, eq, fail, fieldError, list, listAll, plateKey, sendExport, today, where, type Query, type Spec } from '../http.js';
import { can } from '../auth.js';
import { audit } from '../audit.js';
import { claimScan } from '../scans.js';
import { cellBool, cellDate, cellNum, cellStr, importRoutes, type ImportDef } from '../importer.js';
import { logRenewal } from './fleet.js';

export const fleet2Router = Router();
const dd = (col: string, day: string) => `DATEDIFF(${col}, '${day}')`;
const vehicleByPlate = async (plate: string | null) => plate ? (await one<{ id: number }>('SELECT id FROM vehicles WHERE plate_key = ?', [plateKey(plate)]))?.id ?? null : null;

// ======================================================================== insurance companies
const icSpec: Spec = {
  from: 'FROM insurance_companies c',
  select: `c.*, (SELECT COUNT(*) FROM insurance_policies WHERE company_id = c.id) policies,
    (SELECT COUNT(*) FROM vehicle_insurance vi JOIN insurance_policies p ON p.id = vi.policy_id WHERE p.company_id = c.id) vehicles`,
  search: ['c.name_ar', 'c.name_en', 'c.phone', 'CAST(c.id AS CHAR)'],
  filters: { status: (v) => ['c.is_active = ?', [v === 'active' ? 1 : 0]] },
  sorts: { name: 'c.name_ar', status: 'c.is_active' }, defaultSort: 'name',
};
const IC_RULES = { name_ar: { req: true, max: 150 }, name_en: { max: 150 }, phone: { max: 30 }, website: { max: 255 }, is_active: { type: 'bool' as const } };
fleet2Router.get('/insurance/companies', can('insurance_companies.view'), async (req, res) => {
  const [stats] = await q(`SELECT COUNT(*) companies, COALESCE(SUM(is_active),0) active, COALESCE(SUM(1-is_active),0) inactive,
    COALESCE(SUM(EXISTS(SELECT 1 FROM insurance_policies WHERE company_id = c.id)),0) with_policies,
    (SELECT COUNT(*) FROM insurance_policies) policies, (SELECT COUNT(*) FROM vehicle_insurance) vehicles FROM insurance_companies c`);
  res.json({ ...(await list(icSpec, req.query as Query)), stats: { ...stats, without_policies: stats.companies - stats.with_policies } });
});
fleet2Router.get('/insurance/companies/options', can('insurance_companies.view', 'insurance_policies.view'), async (_req, res) => res.json(await q('SELECT id, name_ar, name_en, is_active FROM insurance_companies ORDER BY name_ar')));
fleet2Router.get('/insurance/companies/export', can('insurance_companies.view'), async (req, res) => {
  await sendExport(req, res, { format: 'xlsx', title: 'ic.title', rows: await listAll(icSpec, req.query as Query), cols: [
    { key: 'name_ar', label: 'ic.name_ar' }, { key: 'name_en', label: 'ic.name_en' }, { key: 'phone', label: 'ic.phone' }, { key: 'website', label: 'ic.website' },
    { key: 'policies', label: 'ic.policies' }, { key: 'vehicles', label: 'ic.vehicles' }, { key: 'is_active', label: 'ic.status' },
  ] });
});
fleet2Router.get('/insurance/companies/:id', can('insurance_companies.view'), async (req, res) => {
  const c = await one<any>(`SELECT ${icSpec.select} ${icSpec.from} WHERE c.id = ?`, [req.params.id]);
  if (!c) fail(404, 'not_found');
  c.policy_list = await q('SELECT id, number, expiry_date, status FROM insurance_policies WHERE company_id = ? ORDER BY id DESC LIMIT 50', [c.id]);
  res.json(c);
});
const icUnique = async (name: string | undefined, id = 0) => { if (name && (await one('SELECT 1 FROM insurance_companies WHERE name_ar = ? AND id <> ?', [name, id]))) fieldError('name_ar', 'name_taken'); };
fleet2Router.post('/insurance/companies', can('insurance_companies.create'), async (req, res) => {
  const v = clean(req.body, IC_RULES);
  if (req.body.is_active === undefined) v.is_active = 1;
  await icUnique(v.name_ar);
  const r = await exec('INSERT INTO insurance_companies SET ?', [v]);
  await audit(req, { action: 'insurance_company.create', entity_type: 'insurance_company', entity_id: r.insertId, after: v });
  res.json({ id: r.insertId });
});
fleet2Router.patch('/insurance/companies/:id', can('insurance_companies.update'), async (req, res) => {
  const v = clean(req.body, IC_RULES, true);
  await icUnique(v.name_ar, Number(req.params.id));
  await exec('UPDATE insurance_companies SET ? WHERE id = ?', [v, req.params.id]);
  await audit(req, { action: 'insurance_company.update', entity_type: 'insurance_company', entity_id: req.params.id, after: v });
  res.json({ ok: true });
});
for (const [path, perm, val] of [['deactivate', 'insurance_companies.deactivate', 0], ['activate', 'insurance_companies.activate', 1]] as const) {
  fleet2Router.post(`/insurance/companies/:id/${path}`, can(perm), async (req, res) => {
    await exec('UPDATE insurance_companies SET is_active = ? WHERE id = ?', [val, req.params.id]);
    await audit(req, { action: `insurance_company.${path}`, entity_type: 'insurance_company', entity_id: req.params.id });
    res.json({ ok: true });
  });
}
async function deleteIc(req: Request, ids: number[]) {
  const [{ n }] = await q<any>('SELECT COUNT(*) n FROM insurance_policies WHERE company_id IN (?)', [ids]);
  if (n) fail(409, 'company_has_policies');
  await exec('DELETE FROM insurance_companies WHERE id IN (?)', [ids]);
  await audit(req, { action: 'insurance_company.delete', entity_type: 'insurance_company', entity_id: ids.join(','), severity: 'critical' });
}
fleet2Router.delete('/insurance/companies/:id', can('insurance_companies.delete'), async (req, res) => { await deleteIc(req, [Number(req.params.id)]); res.json({ ok: true }); });
fleet2Router.post('/insurance/companies/bulk-delete', can('insurance_companies.delete'), async (req, res) => { await deleteIc(req, (req.body.ids ?? []).map(Number).slice(0, 200)); res.json({ ok: true }); });
fleet2Router.use('/insurance/companies/import', importRoutes({
  name: 'insurance_companies', perm: 'insurance_companies.create', matchOn: 'ic.name_ar',
  columns: { name_ar: ['ic.name_ar', 'name (arabic)'], name_en: ['ic.name_en', 'name (english)'], phone: ['ic.phone', 'phone'], website: ['ic.website', 'website'], status: ['ic.status', 'status'] },
  requiredColumns: [['name_ar']],
  async parse(row) {
    const name = cellStr(row.name_ar, 150);
    if (!name) return 'no_key';
    const st = cellStr(row.status)?.toLowerCase();
    return { line: 0, key: name, label: name, data: { name_ar: name, name_en: cellStr(row.name_en, 150), phone: cellStr(row.phone, 30), website: cellStr(row.website, 255),
      is_active: st == null ? null : ['inactive', 'غير نشطة', '0', 'no'].includes(st) ? 0 : 1 } };
  },
  async existing(items) {
    const m = new Map<string, any>();
    if (items.length) for (const r of await q('SELECT * FROM insurance_companies WHERE name_ar IN (?)', [items.map((i) => i.key)])) m.set(r.name_ar, r);
    return m;
  },
  async write(it, ex, ctx) {
    const values = Object.fromEntries(Object.entries(it.data).filter(([, v]) => v !== null && v !== undefined));
    if (ex) { if (ctx.mode === 'skip') return 'skipped'; await exec('UPDATE insurance_companies SET ? WHERE id = ?', [values, ex.id]); return 'replaced'; }
    await exec('INSERT INTO insurance_companies SET ?', [values]);
    return 'inserted';
  },
}));

// ======================================================================== insurance policies
const POL_RULES = {
  number: { req: true, max: 50 }, company_id: { req: true, type: 'int' as const }, type: { enum: ['third_party', 'comprehensive'] }, issue_date: { type: 'date' as const },
  start_date: { type: 'date' as const }, expiry_date: { req: true, type: 'date' as const }, status: { enum: ['valid', 'expired', 'cancelled'] }, notes: { max: 500 },
};
function polSpec(day: string): Spec {
  const d = dd('p.expiry_date', day);
  return {
    from: 'FROM insurance_policies p JOIN insurance_companies c ON c.id = p.company_id',
    select: `p.*, c.name_ar company_ar, c.name_en company_en, ${d} days_left, (SELECT COUNT(*) FROM vehicle_insurance WHERE policy_id = p.id) vehicles`,
    search: ['p.number', 'c.name_ar', 'c.name_en', 'p.notes'],
    filters: {
      company: eq('p.company_id'), type: eq('p.type'), status: eq('p.status'),
      expiry: (v) => ({ expired: `${d} < 0`, within30: `${d} BETWEEN 0 AND 30`, beyond30: `${d} > 30` } as Record<string, string>)[v] ?? null,
    },
    sorts: { number: 'p.number', company: 'c.name_ar', expiry: 'p.expiry_date', status: 'p.status' }, defaultSort: 'expiry',
  };
}
fleet2Router.get('/insurance/policies', can('insurance_policies.view'), async (req, res) => {
  const day = await today();
  const d = dd('expiry_date', day);
  const [stats] = await q(`SELECT COUNT(*) policies, COALESCE(SUM(status='valid'),0) valid, COALESCE(SUM(status='expired'),0) expired, COALESCE(SUM(status='cancelled'),0) cancelled,
    COALESCE(SUM(${d} BETWEEN 0 AND 30),0) within30, COALESCE(SUM(status='valid' AND ${d} < 0),0) valid_past, (SELECT COUNT(*) FROM vehicle_insurance) vehicles FROM insurance_policies`);
  res.json({ ...(await list(polSpec(day), req.query as Query)), stats });
});
fleet2Router.get('/insurance/policies/options', can('insurance_policies.view', 'vehicle_insurance.view'), async (_req, res) =>
  res.json(await q('SELECT p.id, p.number, p.expiry_date, c.name_ar company_ar, c.name_en company_en FROM insurance_policies p JOIN insurance_companies c ON c.id = p.company_id ORDER BY p.number')));
fleet2Router.get('/insurance/policies/export', can('insurance_policies.export'), async (req, res) => {
  await sendExport(req, res, { format: 'xlsx', title: 'pol.title', rows: await listAll(polSpec(await today()), req.query as Query), cols: [
    { key: 'number', label: 'pol.number' }, { key: 'company_ar', label: 'pol.insurer' }, { key: 'type', label: 'pol.type' }, { key: 'issue_date', label: 'pol.issue_date' },
    { key: 'start_date', label: 'pol.start_date' }, { key: 'expiry_date', label: 'pol.expiry_date', fill: (r) => r.days_left < 0 ? 'red' : r.days_left <= 30 ? 'amber' : 'green' },
    { key: 'status', label: 'pol.status' }, { key: 'vehicles', label: 'pol.vehicles' }, { key: 'notes', label: 'common.notes' },
  ] });
});
fleet2Router.get('/insurance/policies/:id', can('insurance_policies.view'), async (req, res) => {
  const spec = polSpec(await today());
  const p = await one<any>(`SELECT ${spec.select} ${spec.from} WHERE p.id = ?`, [req.params.id]);
  if (!p) fail(404, 'not_found');
  p.covers = await q(`SELECT vi.id, vi.expiry_date, vi.status, v.plate FROM vehicle_insurance vi JOIN vehicles v ON v.id = vi.vehicle_id WHERE vi.policy_id = ? ORDER BY v.plate`, [p.id]);
  res.json(p);
});
async function polCheck(v: Record<string, any>, id = 0, before?: any) {
  if (v.number && (await one('SELECT 1 FROM insurance_policies WHERE number = ? AND id <> ?', [v.number, id]))) fieldError('number', 'policy_number_taken');
  const start = v.start_date !== undefined ? v.start_date : before?.start_date;
  const exp = v.expiry_date !== undefined ? v.expiry_date : before?.expiry_date;
  if (start && exp && exp < start) fieldError('start_date', 'start_after_expiry');
}
fleet2Router.post('/insurance/policies', can('insurance_policies.create'), async (req, res) => {
  const v = clean(req.body, POL_RULES);
  await polCheck(v);
  const r = await exec('INSERT INTO insurance_policies SET ?', [{ type: 'third_party', status: 'valid', ...v }]);
  await audit(req, { action: 'insurance_policy.create', entity_type: 'insurance_policy', entity_id: r.insertId, after: v });
  res.json({ id: r.insertId });
});
fleet2Router.patch('/insurance/policies/:id', can('insurance_policies.update'), async (req, res) => {
  const before = await one<any>('SELECT * FROM insurance_policies WHERE id = ?', [req.params.id]);
  if (!before) fail(404, 'not_found');
  const v = clean(req.body, POL_RULES, true);
  await polCheck(v, before.id, before);
  await exec('UPDATE insurance_policies SET ? WHERE id = ?', [v, before.id]);
  await audit(req, { action: 'insurance_policy.update', entity_type: 'insurance_policy', entity_id: before.id, before, after: v });
  res.json({ ok: true });
});
// Renewing the master policy changes the policy's date only; each vehicle cover keeps its own date.
fleet2Router.post('/insurance/policies/:id/renew', can('insurance_policies.renew'), async (req, res) => {
  const day = await today();
  const expiry = req.body.quick ? addMonths(day, 12) : clean(req.body, { new_expiry: { req: true, type: 'date' } }).new_expiry;
  if (expiry < day) fieldError('new_expiry', 'renewal_in_past');
  await exec("UPDATE insurance_policies SET expiry_date = ?, status = 'valid' WHERE id = ?", [expiry, req.params.id]);
  await audit(req, { action: 'insurance_policy.renew', entity_type: 'insurance_policy', entity_id: req.params.id, after: { expiry_date: expiry } });
  res.json({ expiry_date: expiry });
});
async function deletePolicies(req: Request, ids: number[]) {
  const [{ n }] = await q<any>('SELECT COUNT(*) n FROM vehicle_insurance WHERE policy_id IN (?)', [ids]);
  if (n) fail(409, 'policy_has_covers');
  await exec('DELETE FROM insurance_policies WHERE id IN (?)', [ids]);
  await audit(req, { action: 'insurance_policy.delete', entity_type: 'insurance_policy', entity_id: ids.join(','), severity: 'critical' });
}
fleet2Router.delete('/insurance/policies/:id', can('insurance_policies.delete'), async (req, res) => { await deletePolicies(req, [Number(req.params.id)]); res.json({ ok: true }); });
fleet2Router.post('/insurance/policies/bulk-delete', can('insurance_policies.delete'), async (req, res) => { await deletePolicies(req, (req.body.ids ?? []).map(Number).slice(0, 200)); res.json({ ok: true }); });
const TYPE_IN: Record<string, string> = { 'third party': 'third_party', third_party: 'third_party', 'ضد الغير': 'third_party', comprehensive: 'comprehensive', 'شامل': 'comprehensive' };
fleet2Router.use('/insurance/policies/import', importRoutes({
  name: 'insurance_policies', perm: 'insurance_policies.create', matchOn: 'pol.number',
  columns: { number: ['pol.number', 'policy number'], company: ['pol.insurer', 'insurance company', 'company'], expiry_date: ['pol.expiry_date', 'expiry date'],
    type: ['pol.type', 'insurance type'], issue_date: ['pol.issue_date', 'issue date'], start_date: ['pol.start_date', 'start date'], status: ['pol.status', 'status'], notes: ['common.notes', 'notes'] },
  requiredColumns: [['number'], ['company'], ['expiry_date']],
  async parse(row) {
    const number = cellStr(row.number, 50); const company = cellStr(row.company); const exp = cellDate(row.expiry_date);
    if (!number || !company || !exp) return exp === undefined ? 'invalid_value' : 'missing_required';
    const c = await one<{ id: number }>('SELECT id FROM insurance_companies WHERE name_ar = ? OR name_en = ?', [company, company]);
    if (!c) return 'company_not_registered';
    const issue = cellDate(row.issue_date); const start = cellDate(row.start_date);
    if (issue === undefined || start === undefined) return 'invalid_value';
    const t = cellStr(row.type)?.toLowerCase(); const st = cellStr(row.status)?.toLowerCase();
    if ((t && !TYPE_IN[t]) || (st && !['valid', 'expired', 'cancelled'].includes(st))) return 'invalid_value';
    return { line: 0, key: number, label: company, data: { number, company_id: c.id, expiry_date: exp, issue_date: issue, start_date: start, type: t ? TYPE_IN[t] : null, status: st ?? null, notes: cellStr(row.notes, 500) } };
  },
  async existing(items) {
    const m = new Map<string, any>();
    if (items.length) for (const r of await q('SELECT * FROM insurance_policies WHERE number IN (?)', [items.map((i) => i.key)])) m.set(r.number, r);
    return m;
  },
  async write(it, ex, ctx) {
    const values = Object.fromEntries(Object.entries(it.data).filter(([, v]) => v !== null && v !== undefined));
    if (ex) { if (ctx.mode === 'skip') return 'skipped'; await exec('UPDATE insurance_policies SET ? WHERE id = ?', [values, ex.id]); return 'replaced'; }
    await exec('INSERT INTO insurance_policies SET ?', [values]);
    return 'inserted';
  },
}));

// ======================================================================== vehicle insurance (covers)
const VI_RULES = {
  vehicle_id: { req: true, type: 'int' as const }, policy_id: { req: true, type: 'int' as const }, sub_policy: { max: 50 }, start_date: { type: 'date' as const },
  expiry_date: { req: true, type: 'date' as const }, status: { enum: ['valid', 'expired', 'cancelled'] }, is_current: { type: 'bool' as const }, notes: { max: 500 },
};
function viSpec(day: string, within: number): Spec {
  const d = dd('vi.expiry_date', day);
  return {
    from: 'FROM vehicle_insurance vi JOIN vehicles v ON v.id = vi.vehicle_id JOIN insurance_policies p ON p.id = vi.policy_id JOIN insurance_companies c ON c.id = p.company_id',
    select: `vi.*, v.plate, v.maker, v.model, p.number policy_number, c.id company_id, c.name_ar company_ar, c.name_en company_en, ${d} days_left`,
    search: ['v.plate', (s) => ['v.plate_key LIKE ?', [`%${plateKey(s)}%`]], 'p.number', 'vi.sub_policy'],
    filters: {
      vehicle: eq('vi.vehicle_id'), policy: eq('vi.policy_id'), company: eq('p.company_id'), status: eq('vi.status'),
      expiry: (v) => ({ expired: `${d} < 0`, soon: `${d} BETWEEN 0 AND ${within}`, valid: `${d} > ${within}` } as Record<string, string>)[v] ?? null,
      current: (v) => ['vi.is_current = ?', [v === 'current' ? 1 : 0]], within: () => `${d} <= ${within}`,
    },
    sorts: { plate: 'v.plate', policy: 'p.number', expiry: 'vi.expiry_date', remaining: d, status: 'vi.status' }, defaultSort: 'remaining',
  };
}
// One vehicle cannot carry two current covers.
const demoteCovers = (vehicleId: number, keep: number) => exec('UPDATE vehicle_insurance SET is_current = 0 WHERE vehicle_id = ? AND id <> ?', [vehicleId, keep]);
fleet2Router.get('/insurance/vehicles', can('vehicle_insurance.view'), async (req, res) => {
  const day = await today();
  const within = Number(req.query.within) || 30;
  const spec = viSpec(day, within);
  const w = where(spec, req.query as Query);
  const d = dd('vi.expiry_date', day);
  const [stats] = await q(`SELECT COUNT(*) total, COALESCE(SUM(vi.status='valid'),0) valid, COALESCE(SUM(${d} BETWEEN 0 AND ${within}),0) soon,
    COALESCE(SUM(${d} < 0),0) expired, COALESCE(SUM(vi.status='cancelled'),0) cancelled, COALESCE(SUM(vi.is_current),0) current ${spec.from}${w.sql}`, w.params);
  res.json({ ...(await list(spec, req.query as Query)), stats });
});
fleet2Router.get('/insurance/vehicles/export', can('vehicle_insurance.export'), async (req, res) => {
  await sendExport(req, res, { format: 'xlsx', title: 'vi.title', rows: await listAll(viSpec(await today(), Number(req.query.within) || 30), req.query as Query), cols: [
    { key: 'plate', label: 'vi.plate' }, { key: 'policy_number', label: 'vi.policy' }, { key: 'company_ar', label: 'pol.insurer' }, { key: 'sub_policy', label: 'vi.sub_policy' },
    { key: 'start_date', label: 'vi.start' }, { key: 'expiry_date', label: 'vi.expiry_date', fill: (r) => r.days_left < 0 ? 'red' : r.days_left <= 30 ? 'amber' : 'green' },
    { key: 'status', label: 'vi.status' }, { key: 'is_current', label: 'vi.current' }, { key: 'notes', label: 'common.notes' },
  ] });
});
fleet2Router.get('/insurance/vehicles/:id', can('vehicle_insurance.view'), async (req, res) => {
  const spec = viSpec(await today(), 30);
  const r = await one(`SELECT ${spec.select} ${spec.from} WHERE vi.id = ?`, [req.params.id]);
  if (!r) fail(404, 'not_found');
  res.json(r);
});
async function viCheck(v: Record<string, any>, id = 0, before?: any) {
  const vehicle = v.vehicle_id ?? before?.vehicle_id; const policy = v.policy_id ?? before?.policy_id;
  if (await one('SELECT 1 FROM vehicle_insurance WHERE vehicle_id = ? AND policy_id = ? AND id <> ?', [vehicle, policy, id])) fieldError('policy_id', 'cover_exists');
  const start = v.start_date !== undefined ? v.start_date : before?.start_date;
  const exp = v.expiry_date !== undefined ? v.expiry_date : before?.expiry_date;
  if (start && exp && exp < start) fieldError('start_date', 'start_after_expiry');
}
fleet2Router.post('/insurance/vehicles', can('vehicle_insurance.create'), async (req, res) => {
  const v = clean(req.body, VI_RULES);
  if (req.body.is_current === undefined) v.is_current = 1;
  await viCheck(v);
  const id = await tx(async () => {
    const r = await exec('INSERT INTO vehicle_insurance SET ?', [{ status: 'valid', ...v }]);
    if (v.is_current) await demoteCovers(v.vehicle_id, r.insertId);
    return r.insertId;
  });
  await audit(req, { action: 'vehicle_insurance.create', entity_type: 'vehicle_insurance', entity_id: id, after: v });
  res.json({ id });
});
fleet2Router.patch('/insurance/vehicles/:id', can('vehicle_insurance.update'), async (req, res) => {
  const before = await one<any>('SELECT * FROM vehicle_insurance WHERE id = ?', [req.params.id]);
  if (!before) fail(404, 'not_found');
  const v = clean(req.body, VI_RULES, true);
  await viCheck(v, before.id, before);
  await tx(async () => {
    await exec('UPDATE vehicle_insurance SET ? WHERE id = ?', [v, before.id]);
    if (v.is_current) await demoteCovers(v.vehicle_id ?? before.vehicle_id, before.id);
  });
  await audit(req, { action: 'vehicle_insurance.update', entity_type: 'vehicle_insurance', entity_id: before.id, before, after: v });
  res.json({ ok: true });
});
// The renewal extends the same cover record; both dates go to the renewal log.
fleet2Router.post('/insurance/vehicles/:id/renew', can('vehicle_insurance.renew'), async (req, res) => {
  const c = await one<any>('SELECT vi.*, v.plate FROM vehicle_insurance vi JOIN vehicles v ON v.id = vi.vehicle_id WHERE vi.id = ?', [req.params.id]);
  if (!c) fail(404, 'not_found');
  const v = clean(req.body, { new_expiry: { req: true, type: 'date' }, new_start: { type: 'date' }, new_number: { max: 50 },
    operation: { enum: ['renewal', 'replacement', 'reissue', 'correction'] }, cost: { type: 'num', min: 0 }, reference: { max: 100 } });
  if (v.new_expiry < (await today())) fieldError('new_expiry', 'renewal_in_past');
  await tx(async () => {
    await exec("UPDATE vehicle_insurance SET expiry_date = ?, status = 'valid', start_date = COALESCE(?, start_date), sub_policy = COALESCE(?, sub_policy) WHERE id = ?",
      [v.new_expiry, v.new_start, v.new_number, c.id]);
    await logRenewal(req, { doc_kind: 'vehicle_insurance', doc_id: c.id, owner_type: 'vehicle', owner_label: c.plate, previous_number: c.sub_policy, new_number: v.new_number ?? c.sub_policy,
      previous_expiry: c.expiry_date, new_expiry: v.new_expiry, operation: v.operation ?? 'renewal', cost: v.cost, reference: v.reference });
    if (c.is_current) await demoteCovers(c.vehicle_id, c.id);
  });
  res.json({ ok: true });
});
// Bulk edit: status, current cover and notes only.
fleet2Router.post('/insurance/vehicles/bulk-edit', can('vehicle_insurance.update'), async (req, res) => {
  const ids: number[] = (req.body.ids ?? []).map(Number);
  if (!ids.length || ids.length > 200) fail(422, ids.length ? 'max_200' : 'nothing_selected');
  const ch = clean(req.body.changes ?? {}, { status: { enum: ['valid', 'expired', 'cancelled'] }, is_current: { type: 'bool' }, notes: { max: 500 } }, true);
  if (!Object.keys(ch).length) fail(422, 'no_field_chosen');
  if (ch.status === null) fieldError('status', 'choose_value');
  await tx(async () => {
    await exec('UPDATE vehicle_insurance SET ? WHERE id IN (?)', [ch, ids]);
    if (ch.is_current) for (const r of await q<any>('SELECT id, vehicle_id FROM vehicle_insurance WHERE id IN (?) ORDER BY id', [ids])) await demoteCovers(r.vehicle_id, r.id);
  });
  await audit(req, { action: 'vehicle_insurance.bulk_edit', entity_type: 'vehicle_insurance', after: ch, details: `${ids.length} records` });
  res.json({ updated: ids.length });
});
async function deleteCovers(req: Request, ids: number[]) {
  const [{ n }] = await q<any>(`SELECT (SELECT COUNT(*) FROM attachments WHERE entity_type = 'vehicle_insurance' AND entity_id IN (?)) +
    (SELECT COUNT(*) FROM renewals WHERE doc_kind = 'vehicle_insurance' AND doc_id IN (?)) n`, [ids.map(String), ids]);
  if (n) fail(409, 'cover_has_history');
  await exec('DELETE FROM vehicle_insurance WHERE id IN (?)', [ids]);
  await audit(req, { action: 'vehicle_insurance.delete', entity_type: 'vehicle_insurance', entity_id: ids.join(','), severity: 'critical' });
}
fleet2Router.delete('/insurance/vehicles/:id', can('vehicle_insurance.delete'), async (req, res) => { await deleteCovers(req, [Number(req.params.id)]); res.json({ ok: true }); });
fleet2Router.post('/insurance/vehicles/bulk-delete', can('vehicle_insurance.delete'), async (req, res) => { await deleteCovers(req, (req.body.ids ?? []).map(Number).slice(0, 200)); res.json({ ok: true }); });
fleet2Router.use('/insurance/vehicles/import', importRoutes({
  name: 'vehicle_insurance', perm: 'vehicle_insurance.create', matchOn: 'vi.match',
  columns: { plate: ['vi.plate', 'plate', 'plate number'], policy: ['vi.policy', 'policy number'], expiry_date: ['vi.expiry_date', 'expiry date'], sub_policy: ['vi.sub_policy'],
    start_date: ['vi.start', 'cover start'], status: ['vi.status', 'status'], is_current: ['vi.current', 'current cover'], notes: ['common.notes', 'notes'] },
  requiredColumns: [['plate'], ['policy'], ['expiry_date']],
  async parse(row) {
    const plate = cellStr(row.plate); const pol = cellStr(row.policy); const exp = cellDate(row.expiry_date);
    if (!plate || !pol || !exp) return exp === undefined ? 'invalid_value' : 'missing_required';
    const vid = await vehicleByPlate(plate);
    if (!vid) return 'vehicle_not_registered';
    const p = await one<{ id: number }>('SELECT id FROM insurance_policies WHERE number = ?', [pol]);
    if (!p) return 'policy_not_registered';
    const start = cellDate(row.start_date);
    if (start === undefined) return 'invalid_value';
    const st = cellStr(row.status)?.toLowerCase();
    if (st && !['valid', 'expired', 'cancelled'].includes(st)) return 'invalid_value';
    return { line: 0, key: `${vid}:${p.id}`, label: plate, data: { vehicle_id: vid, policy_id: p.id, expiry_date: exp, start_date: start, sub_policy: cellStr(row.sub_policy, 50),
      status: st ?? null, is_current: cellBool(row.is_current), notes: cellStr(row.notes, 500) } };
  },
  async existing(items) {
    const m = new Map<string, any>();
    for (const r of await q('SELECT * FROM vehicle_insurance')) m.set(`${r.vehicle_id}:${r.policy_id}`, r);
    return new Map(items.filter((i) => m.has(i.key)).map((i) => [i.key, m.get(i.key)]));
  },
  async write(it, ex, ctx) {
    const values = Object.fromEntries(Object.entries(it.data).filter(([, v]) => v !== null && v !== undefined));
    let id: number; let out: 'replaced' | 'inserted';
    if (ex) { if (ctx.mode === 'skip') return 'skipped'; await exec('UPDATE vehicle_insurance SET ? WHERE id = ?', [values, ex.id]); id = ex.id; out = 'replaced'; }
    else { id = (await exec('INSERT INTO vehicle_insurance SET ?', [{ is_current: 1, ...values }])).insertId; out = 'inserted'; }
    if (values.is_current !== 0) {
      const r = await demoteCovers(it.data.vehicle_id, id);
      ctx.result.lost_current = (ctx.result.lost_current ?? 0) + r.affectedRows;
    }
    return out;
  },
}));

// ======================================================================== vehicle assignments
function asSpec(day: string): Spec {
  return {
    from: 'FROM vehicle_assignments a JOIN riders r ON r.id = a.rider_id JOIN vehicles v ON v.id = a.vehicle_id',
    select: `a.*, r.full_name, v.plate, v.maker, v.model, DATEDIFF(COALESCE(a.end_date, '${day}'), a.start_date) duration`,
    search: ['r.full_name', 'CAST(r.id AS CHAR)', 'v.plate', (s) => ['v.plate_key LIKE ?', [`%${plateKey(s)}%`]], 'v.maker'],
    filters: {
      rider: eq('a.rider_id'), vehicle: eq('a.vehicle_id'), state: (v) => ['a.is_current = ?', [v === 'current' ? 1 : 0]],
      from: (v) => ['a.start_date >= ?', [v]], to: (v) => ['a.start_date <= ?', [v]],
    },
    sorts: { rider: 'r.full_name', vehicle: 'v.plate', start: 'a.start_date', end: 'a.end_date', duration: 'duration', state: 'a.is_current' }, defaultSort: '-start',
  };
}
fleet2Router.get('/vehicle-assignments', can('vehicle_assignments.view'), async (req, res) => {
  const spec = asSpec(await today());
  const w = where(spec, req.query as Query);
  const [stats] = await q(`SELECT COUNT(*) total, COALESCE(SUM(a.is_current),0) current, COALESCE(SUM(1-a.is_current),0) ended,
    (SELECT COUNT(*) FROM riders x WHERE x.status = 'active' AND NOT EXISTS (SELECT 1 FROM vehicle_assignments y WHERE y.rider_id = x.id AND y.is_current = 1)) riders_without,
    (SELECT COUNT(*) FROM vehicles x WHERE x.status <> 'retired' AND NOT EXISTS (SELECT 1 FROM vehicle_assignments y WHERE y.vehicle_id = x.id AND y.is_current = 1)) vehicles_without
    ${spec.from}${w.sql}`, w.params);
  res.json({ ...(await list(spec, req.query as Query)), stats });
});
fleet2Router.get('/vehicle-assignments/export', can('vehicle_assignments.export'), async (req, res) => {
  await sendExport(req, res, { format: 'xlsx', title: 'va.title', rows: await listAll(asSpec(await today()), req.query as Query), cols: [
    { key: 'rider_id', label: 'riders.rider_id' }, { key: 'full_name', label: 'va.rider' }, { key: 'plate', label: 'va.vehicle' }, { key: 'start_date', label: 'va.start' },
    { key: 'end_date', label: 'va.end' }, { key: 'duration', label: 'va.duration' }, { key: 'is_current', label: 'va.state' },
  ] });
});
fleet2Router.get('/vehicle-assignments/:id', can('vehicle_assignments.view'), async (req, res) => {
  const spec = asSpec(await today());
  const r = await one(`SELECT ${spec.select}, r.phone ${spec.from} WHERE a.id = ?`, [req.params.id]);
  if (!r) fail(404, 'not_found');
  res.json(r);
});
// The rules of the vehicle field in the rider record, shared with this screen.
async function saveAssignment(req: Request, v: Record<string, any>, id = 0) {
  if (!v.is_current && !v.end_date) fieldError('end_date', 'required');
  if (v.is_current) v.end_date = null;
  if (v.end_date && v.end_date < v.start_date) fieldError('end_date', 'end_before_start');
  const warnings: unknown[] = [];
  if (v.is_current) {
    const holder = await one<any>('SELECT r.full_name FROM vehicle_assignments a JOIN riders r ON r.id = a.rider_id WHERE a.vehicle_id = ? AND a.is_current = 1 AND a.rider_id <> ? AND a.id <> ?', [v.vehicle_id, v.rider_id, id]);
    if (holder) fieldError('vehicle_id', 'vehicle_taken', { name: holder.full_name });
    // The rider's (or this pair's) previous current assignment is closed on the new start date.
    await exec('UPDATE vehicle_assignments SET is_current = 0, end_date = ? WHERE rider_id = ? AND is_current = 1 AND id <> ?', [v.start_date, v.rider_id, id]);
  }
  const overlap = await one<any>(`SELECT id FROM vehicle_assignments WHERE rider_id = ? AND id <> ? AND start_date < COALESCE(?::date, '9999-12-31') AND COALESCE(end_date, '9999-12-31') > ?`,
    [v.rider_id, id, v.end_date, v.start_date]);
  if (overlap) warnings.push({ code: 'overlapping_dates', id: overlap.id });
  return warnings;
}
const AS_RULES = { rider_id: { req: true, type: 'int' as const }, vehicle_id: { req: true, type: 'int' as const }, start_date: { type: 'date' as const }, end_date: { type: 'date' as const }, is_current: { type: 'bool' as const } };
fleet2Router.post('/vehicle-assignments', can('vehicle_assignments.create'), async (req, res) => {
  const v = clean(req.body, AS_RULES);
  v.start_date ??= await today();
  if (req.body.is_current === undefined) v.is_current = 1;
  const out = await tx(async () => {
    const warnings = await saveAssignment(req, v);
    return { id: (await exec('INSERT INTO vehicle_assignments SET ?', [v])).insertId, warnings };
  });
  await audit(req, { action: 'assignment.create', entity_type: 'vehicle_assignment', entity_id: out.id, after: v });
  res.json(out);
});
fleet2Router.patch('/vehicle-assignments/:id', can('vehicle_assignments.update'), async (req, res) => {
  const before = await one<any>('SELECT * FROM vehicle_assignments WHERE id = ?', [req.params.id]);
  if (!before) fail(404, 'not_found');
  const v = { ...before, ...clean(req.body, AS_RULES, true) };
  delete v.created_at;
  const warnings = await tx(async () => {
    const w = await saveAssignment(req, v, before.id);
    await exec('UPDATE vehicle_assignments SET ? WHERE id = ?', [v, before.id]);
    return w;
  });
  await audit(req, { action: 'assignment.update', entity_type: 'vehicle_assignment', entity_id: before.id, before, after: v });
  res.json({ ok: true, warnings });
});
fleet2Router.post('/vehicle-assignments/:id/end', can('vehicle_assignments.update'), async (req, res) => {
  const r = await exec('UPDATE vehicle_assignments SET is_current = 0, end_date = ? WHERE id = ? AND is_current = 1', [await today(), req.params.id]);
  if (!r.affectedRows) fail(409, 'assignment_already_ended');
  await audit(req, { action: 'assignment.end', entity_type: 'vehicle_assignment', entity_id: req.params.id });
  res.json({ ok: true });
});
async function deleteAssignments(req: Request, ids: number[]) {
  await exec('DELETE FROM vehicle_assignments WHERE id IN (?)', [ids]);
  await audit(req, { action: 'assignment.delete', entity_type: 'vehicle_assignment', entity_id: ids.join(','), severity: 'warning' });
}
fleet2Router.delete('/vehicle-assignments/:id', can('vehicle_assignments.delete'), async (req, res) => { await deleteAssignments(req, [Number(req.params.id)]); res.json({ ok: true }); });
fleet2Router.post('/vehicle-assignments/bulk-delete', can('vehicle_assignments.delete'), async (req, res) => { await deleteAssignments(req, (req.body.ids ?? []).map(Number).slice(0, 200)); res.json({ ok: true }); });
fleet2Router.use('/vehicle-assignments/import', importRoutes({
  name: 'vehicle_assignments', perm: 'vehicle_assignments.create', matchOn: 'va.match',
  columns: { rider_id: ['riders.rider_id', 'rider id', 'rider number'], plate: ['va.vehicle', 'plate', 'plate number'], start_date: ['va.start', 'start date'],
    end_date: ['va.end', 'end date'], state: ['va.state', 'state'] },
  requiredColumns: [['rider_id'], ['plate'], ['start_date']],
  async parse(row) {
    const rid = cellStr(row.rider_id); const plate = cellStr(row.plate); const start = cellDate(row.start_date);
    if (!rid || !plate || !start) return start === undefined ? 'invalid_value' : 'missing_required';
    if (!(await one('SELECT 1 FROM riders WHERE id = ?', [rid]))) return 'rider_not_registered';
    const vid = await vehicleByPlate(plate);
    if (!vid) return 'vehicle_not_registered';
    const end = cellDate(row.end_date);
    if (end === undefined) return 'invalid_value';
    const st = cellStr(row.state)?.toLowerCase();
    const current = st ? ['current', 'حالي', '1', 'yes'].includes(st) : !end;
    if (current && end) return 'current_with_end_date';
    if (end && end < start) return 'end_before_start';
    return { line: 0, key: `${rid}:${vid}:${start}`, label: plate, data: { rider_id: Number(rid), vehicle_id: vid, start_date: start, end_date: end, is_current: current ? 1 : 0 } };
  },
  async existing(items) {
    const m = new Map<string, any>();
    for (const r of await q('SELECT * FROM vehicle_assignments')) m.set(`${r.rider_id}:${r.vehicle_id}:${r.start_date}`, r);
    return new Map(items.filter((i) => m.has(i.key)).map((i) => [i.key, m.get(i.key)]));
  },
  async counts(items) {
    let close = 0;
    for (const it of items) if (it.data.is_current && (await one('SELECT 1 FROM vehicle_assignments WHERE rider_id = ? AND is_current = 1 AND vehicle_id <> ?', [it.data.rider_id, it.data.vehicle_id]))) close++;
    return { would_close_current: close };
  },
  async check(it, _ex, ctx) {
    // Two lines that make the same rider or vehicle current are both rejected.
    const key = `cur:${it.data.rider_id}`; const vkey = `curv:${it.data.vehicle_id}`;
    if (it.data.is_current) {
      if (ctx.cache.has(key) || ctx.cache.has(vkey)) return 'competing_lines';
      ctx.cache.set(key, 1); ctx.cache.set(vkey, it.data.rider_id);
      const holder = await one<any>('SELECT rider_id FROM vehicle_assignments WHERE vehicle_id = ? AND is_current = 1 AND rider_id <> ?', [it.data.vehicle_id, it.data.rider_id]);
      if (holder) return 'vehicle_taken';
    }
    return null;
  },
  async write(it, ex, ctx) {
    if (ex) {
      if (ctx.mode === 'skip') return 'skipped';
      await exec('UPDATE vehicle_assignments SET end_date = ?, is_current = ? WHERE id = ?', [it.data.end_date, it.data.is_current, ex.id]);
      return 'replaced';
    }
    if (it.data.is_current) await exec('UPDATE vehicle_assignments SET is_current = 0, end_date = ? WHERE rider_id = ? AND is_current = 1', [it.data.start_date, it.data.rider_id]);
    await exec('INSERT INTO vehicle_assignments SET ?', [it.data]);
    return 'inserted';
  },
}));

// ======================================================================== fuel cards
const FC_RULES = {
  number: { req: true, max: 50 }, provider: { max: 100 }, status: { enum: ['active', 'blocked', 'expired'] }, issue_date: { type: 'date' as const },
  balance: { req: true, type: 'num' as const }, monthly_limit: { type: 'num' as const, min: 0 }, rider_id: { type: 'int' as const }, vehicle_id: { type: 'int' as const },
};
const twoDecimals = (v: Record<string, any>) => { for (const k of ['balance', 'monthly_limit']) if (v[k] != null && Math.round(v[k] * 100) !== v[k] * 100) fieldError(k, 'two_decimals'); };
const fcSpec: Spec = {
  from: 'FROM fuel_cards f LEFT JOIN riders r ON r.id = f.rider_id LEFT JOIN vehicles v ON v.id = f.vehicle_id',
  select: 'f.*, r.full_name, v.plate',
  search: ['f.number', 'f.provider', 'r.full_name', 'v.plate'],
  filters: { status: eq('f.status'), provider: eq('f.provider'), rider: eq('f.rider_id'), vehicle: eq('f.vehicle_id'),
    assignment: (v) => v === 'assigned' ? 'f.rider_id IS NOT NULL' : 'f.rider_id IS NULL',
    from: (v) => ['f.issue_date >= ?', [v]], to: (v) => ['f.issue_date <= ?', [v]] },
  sorts: { number: 'f.number', rider: 'r.full_name', balance: 'f.balance', limit: 'f.monthly_limit', status: 'f.status', issued: 'f.issue_date' }, defaultSort: 'number',
};
// Choosing a rider without a vehicle links the card to the rider's current vehicle.
async function riderVehicle(v: Record<string, any>, body: any) {
  if (v.rider_id && !('vehicle_id' in body)) v.vehicle_id = (await one<any>('SELECT vehicle_id FROM vehicle_assignments WHERE rider_id = ? AND is_current = 1', [v.rider_id]))?.vehicle_id ?? null;
}
fleet2Router.get('/fuel-cards', can('fuel_cards.view'), async (req, res) => {
  const w = where(fcSpec, req.query as Query);
  const [stats] = await q(`SELECT COUNT(*) cards, COALESCE(SUM(f.status='active'),0) active, COALESCE(SUM(f.status='blocked'),0) blocked, COALESCE(SUM(f.status='expired'),0) expired,
    COALESCE(SUM(f.rider_id IS NULL),0) unassigned, COALESCE(SUM(f.balance),0) balance, COALESCE(SUM(f.monthly_limit),0) monthly_limit ${fcSpec.from}${w.sql}`, w.params);
  const providers = (await q<any>('SELECT DISTINCT provider FROM fuel_cards WHERE provider IS NOT NULL ORDER BY provider')).map((p) => p.provider);
  res.json({ ...(await list(fcSpec, req.query as Query)), stats, providers });
});
fleet2Router.get('/fuel-cards/export', can('fuel_cards.export'), async (req, res) => {
  await sendExport(req, res, { format: 'xlsx', title: 'fc.title', rows: await listAll(fcSpec, req.query as Query), cols: [
    { key: 'number', label: 'fc.number' }, { key: 'provider', label: 'fc.provider' }, { key: 'rider_id', label: 'riders.rider_id' }, { key: 'full_name', label: 'fc.rider' },
    { key: 'plate', label: 'fc.vehicle' }, { key: 'balance', label: 'fc.balance' }, { key: 'monthly_limit', label: 'fc.monthly_limit' }, { key: 'status', label: 'fc.status' }, { key: 'issue_date', label: 'fc.issued' },
  ] });
});
fleet2Router.get('/fuel-cards/:id', can('fuel_cards.view'), async (req, res) => {
  const r = await one(`SELECT ${fcSpec.select} ${fcSpec.from} WHERE f.id = ?`, [req.params.id]);
  if (!r) fail(404, 'not_found');
  res.json(r);
});
fleet2Router.post('/fuel-cards', can('fuel_cards.create'), async (req, res) => {
  const v = clean(req.body, FC_RULES);
  twoDecimals(v);
  if (await one('SELECT 1 FROM fuel_cards WHERE number = ?', [v.number])) fieldError('number', 'card_number_taken');
  await riderVehicle(v, req.body);
  const r = await exec('INSERT INTO fuel_cards SET ?', [{ status: 'active', ...v }]);
  await audit(req, { action: 'fuel_card.create', entity_type: 'fuel_card', entity_id: r.insertId, after: v });
  res.json({ id: r.insertId });
});
fleet2Router.patch('/fuel-cards/:id', can('fuel_cards.update'), async (req, res) => {
  const before = await one<any>('SELECT * FROM fuel_cards WHERE id = ?', [req.params.id]);
  if (!before) fail(404, 'not_found');
  const v = clean(req.body, FC_RULES, true);
  twoDecimals(v);
  if (v.number && (await one('SELECT 1 FROM fuel_cards WHERE number = ? AND id <> ?', [v.number, before.id]))) fieldError('number', 'card_number_taken');
  if (v.rider_id && v.rider_id !== before.rider_id) await riderVehicle(v, req.body);
  await exec('UPDATE fuel_cards SET ? WHERE id = ?', [v, before.id]);
  await audit(req, { action: 'fuel_card.update', entity_type: 'fuel_card', entity_id: before.id, before, after: v });
  res.json({ ok: true });
});
fleet2Router.post('/fuel-cards/:id/block', can('fuel_cards.deactivate'), async (req, res) => {
  await exec("UPDATE fuel_cards SET status = 'blocked' WHERE id = ?", [req.params.id]);
  await audit(req, { action: 'fuel_card.block', entity_type: 'fuel_card', entity_id: req.params.id, severity: 'warning' });
  res.json({ ok: true });
});
fleet2Router.post('/fuel-cards/:id/unblock', can('fuel_cards.activate'), async (req, res) => {
  await exec("UPDATE fuel_cards SET status = 'active' WHERE id = ?", [req.params.id]);
  await audit(req, { action: 'fuel_card.unblock', entity_type: 'fuel_card', entity_id: req.params.id });
  res.json({ ok: true });
});
fleet2Router.post('/fuel-cards/bulk-edit', can('fuel_cards.update'), async (req, res) => {
  const ids: number[] = (req.body.ids ?? []).map(Number);
  if (!ids.length || ids.length > 200) fail(422, ids.length ? 'max_200' : 'nothing_selected');
  const raw = req.body.changes ?? {};
  const ch = clean(raw, { status: { enum: ['active', 'blocked', 'expired'] }, provider: { max: 100 }, monthly_limit: { type: 'num', min: 0 }, rider_id: { type: 'int' }, plate: { max: 30 } }, true);
  for (const [k, val] of Object.entries(ch)) if (val === null) fieldError(k, 'choose_value');
  if (!Object.keys(ch).length) fail(422, 'no_field_chosen');
  if (ch.plate) { ch.vehicle_id = await vehicleByPlate(ch.plate); if (!ch.vehicle_id) fieldError('plate', 'vehicle_not_registered'); delete ch.plate; }
  else if (ch.rider_id) await riderVehicle(ch, {});
  await exec('UPDATE fuel_cards SET ? WHERE id IN (?)', [ch, ids]);
  await audit(req, { action: 'fuel_card.bulk_edit', entity_type: 'fuel_card', after: ch, details: `${ids.length} cards` });
  res.json({ updated: ids.length });
});
// A card that still carries a balance is blocked, not deleted, so its balance stays in the report.
async function deleteFuelCards(req: Request, ids: number[]) {
  const [{ n }] = await q<any>('SELECT COUNT(*) n FROM fuel_cards WHERE id IN (?) AND balance <> 0', [ids]);
  if (n) fail(409, 'fuel_card_has_balance');
  await exec('DELETE FROM fuel_cards WHERE id IN (?)', [ids]);
  await audit(req, { action: 'fuel_card.delete', entity_type: 'fuel_card', entity_id: ids.join(','), severity: 'warning' });
}
fleet2Router.delete('/fuel-cards/:id', can('fuel_cards.delete'), async (req, res) => { await deleteFuelCards(req, [Number(req.params.id)]); res.json({ ok: true }); });
fleet2Router.post('/fuel-cards/bulk-delete', can('fuel_cards.delete'), async (req, res) => { await deleteFuelCards(req, (req.body.ids ?? []).map(Number).slice(0, 200)); res.json({ ok: true }); });
fleet2Router.use('/fuel-cards/import', importRoutes({
  name: 'fuel_cards', perm: 'fuel_cards.create', matchOn: 'fc.number',
  columns: { number: ['fc.number', 'card number'], balance: ['fc.balance', 'balance'], provider: ['fc.provider', 'provider'], rider_id: ['riders.rider_id', 'rider number', 'rider id'],
    plate: ['fc.vehicle', 'plate', 'plate number'], monthly_limit: ['fc.monthly_limit', 'monthly limit'], status: ['fc.status', 'status'], issue_date: ['fc.issued', 'issue date'] },
  requiredColumns: [['number'], ['balance']],
  async parse(row) {
    const number = cellStr(row.number, 50);
    if (!number) return 'no_key';
    const balance = cellNum(row.balance); const limit = cellNum(row.monthly_limit); const issue = cellDate(row.issue_date);
    if (balance === undefined || limit === undefined || issue === undefined) return 'invalid_value';
    let rider_id: number | null = null; let vehicle_id: number | null = null;
    const rid = cellStr(row.rider_id);
    if (rid) { if (!(await one('SELECT 1 FROM riders WHERE id = ?', [rid]))) return 'rider_not_registered'; rider_id = Number(rid); }
    const plate = cellStr(row.plate);
    if (plate) { vehicle_id = await vehicleByPlate(plate); if (!vehicle_id) return 'vehicle_not_registered'; }
    const st = cellStr(row.status)?.toLowerCase();
    if (st && !['active', 'blocked', 'expired'].includes(st)) return 'invalid_value';
    return { line: 0, key: number, label: number, data: { number, balance, monthly_limit: limit, provider: cellStr(row.provider, 100), rider_id, vehicle_id, status: st ?? null, issue_date: issue } };
  },
  async existing(items) {
    const m = new Map<string, any>();
    if (items.length) for (const r of await q('SELECT * FROM fuel_cards WHERE number IN (?)', [items.map((i) => i.key)])) m.set(r.number, r);
    return m;
  },
  async check(it, ex) { return !ex && it.data.balance == null ? 'missing_required' : null; },
  async write(it, ex, ctx) {
    const values = Object.fromEntries(Object.entries(it.data).filter(([, v]) => v !== null && v !== undefined));
    if (ex) { if (ctx.mode === 'skip') return 'skipped'; await exec('UPDATE fuel_cards SET ? WHERE id = ?', [values, ex.id]); return 'replaced'; }
    await exec('INSERT INTO fuel_cards SET ?', [values]);
    return 'inserted';
  },
}));

// ======================================================================== oil changes
// "Next due" is never typed: it is always the last change plus the interval.
function oilSpec(day: string, within: number | null): Spec {
  const next = 'DATE_ADD(s.last_change, INTERVAL s.interval_days DAY)';
  const d = dd(next, day);
  return {
    from: 'FROM oil_schedules s JOIN vehicles v ON v.id = s.vehicle_id',
    select: `s.*, v.plate, v.maker, v.model, v.odometer, ${next} next_due, ${d} days_left,
      NOT EXISTS (SELECT 1 FROM oil_changes WHERE vehicle_id = s.vehicle_id) never_changed,
      CASE WHEN ${d} < 0 THEN 'overdue' WHEN ${d} <= s.warn_days THEN 'due_soon' ELSE 'on_schedule' END state`,
    search: ['v.plate', (s) => ['v.plate_key LIKE ?', [`%${plateKey(s)}%`]], 'v.maker', 'v.model'],
    filters: {
      state: (v) => ({ overdue: `${d} < 0`, due_soon: `${d} BETWEEN 0 AND s.warn_days`, on_schedule: `${d} > s.warn_days`,
        never: 'NOT EXISTS (SELECT 1 FROM oil_changes WHERE vehicle_id = s.vehicle_id)' } as Record<string, string>)[v] ?? null,
      vehicle: eq('s.vehicle_id'),
      within: () => within === null ? null : `${d} <= ${within}`,
    },
    sorts: { vehicle: 'v.plate', interval: 's.interval_days', last: 's.last_change', next: next, days: d, state: d }, defaultSort: 'days',
  };
}
// The schedule follows the latest change in the history; if the history is emptied it stays as it is.
async function rollForward(vehicleId: number) {
  const r = await exec(`UPDATE oil_schedules s SET last_change = h.m FROM (SELECT vehicle_id, MAX(change_date) m FROM oil_changes WHERE vehicle_id = ? GROUP BY vehicle_id) h WHERE h.vehicle_id = s.vehicle_id AND s.last_change <> h.m`, [vehicleId]);
  return r.affectedRows;
}
const OS_RULES = { vehicle_id: { req: true, type: 'int' as const }, interval_days: { req: true, type: 'int' as const, min: 1, max: 3650 }, warn_days: { type: 'int' as const, min: 0, max: 365 }, last_change: { req: true, type: 'date' as const } };
fleet2Router.get('/oil-changes', can('oil_changes.view'), async (req, res) => {
  const day = await today();
  const spec = oilSpec(day, req.query.within ? Number(req.query.within) : null);
  const w = where(spec, req.query as Query);
  const d = dd('DATE_ADD(s.last_change, INTERVAL s.interval_days DAY)', day);
  const [stats] = await q(`SELECT COUNT(*) vehicles, COALESCE(SUM(${d} < 0),0) overdue, COALESCE(SUM(${d} BETWEEN 0 AND s.warn_days),0) due_soon,
    COALESCE(SUM(${d} > s.warn_days),0) on_schedule, COALESCE(SUM(NOT EXISTS (SELECT 1 FROM oil_changes WHERE vehicle_id = s.vehicle_id)),0) never ${spec.from}${w.sql}`, w.params);
  res.json({ ...(await list(spec, req.query as Query)), stats });
});
fleet2Router.get('/oil-changes/export', can('oil_changes.export'), async (req, res) => {
  await sendExport(req, res, { format: 'xlsx', title: 'oil.schedule', rows: await listAll(oilSpec(await today(), null), req.query as Query), cols: [
    { key: 'plate', label: 'oil.vehicle' }, { key: 'interval_days', label: 'oil.interval' }, { key: 'warn_days', label: 'oil.warn' }, { key: 'last_change', label: 'oil.last_change' },
    { key: 'next_due', label: 'oil.next_due' }, { key: 'days_left', label: 'oil.days_left', fill: (r) => r.state === 'overdue' ? 'red' : r.state === 'due_soon' ? 'amber' : 'green' },
    { key: 'state', label: 'oil.state' },
  ] });
});
const histSpec: Spec = {
  from: 'FROM oil_changes h JOIN vehicles v ON v.id = h.vehicle_id',
  select: 'h.*, v.plate, v.maker, v.model',
  search: ['v.plate', (s) => ['v.plate_key LIKE ?', [`%${plateKey(s)}%`]], 'v.maker', 'h.performed_by'],
  filters: { vehicle: eq('h.vehicle_id'), performed_by: eq('h.performed_by'), from: (v) => ['h.change_date >= ?', [v]], to: (v) => ['h.change_date <= ?', [v]] },
  sorts: { vehicle: 'v.plate', date: 'h.change_date', odometer: 'h.odometer', cost: 'h.cost' }, defaultSort: '-date',
};
fleet2Router.get('/oil-changes/history', can('oil_changes.view'), async (req, res) => {
  const w = where(histSpec, req.query as Query);
  const [stats] = await q(`SELECT COUNT(*) records, COUNT(DISTINCT h.vehicle_id) vehicles, COALESCE(SUM(h.cost),0) cost ${histSpec.from}${w.sql}`, w.params);
  const performers = (await q<any>('SELECT DISTINCT performed_by FROM oil_changes WHERE performed_by IS NOT NULL ORDER BY 1')).map((p) => p.performed_by);
  res.json({ ...(await list(histSpec, req.query as Query)), stats, performers });
});
fleet2Router.get('/oil-changes/history/export', can('oil_changes.export'), async (req, res) => {
  await sendExport(req, res, { format: 'xlsx', title: 'oil.history', rows: await listAll(histSpec, req.query as Query), cols: [
    { key: 'plate', label: 'oil.vehicle' }, { key: 'change_date', label: 'oil.change_date' }, { key: 'odometer', label: 'oil.odometer' },
    { key: 'performed_by', label: 'oil.performed_by' }, { key: 'cost', label: 'oil.cost' }, { key: 'notes', label: 'common.notes' },
  ] });
});
fleet2Router.get('/oil-changes/history/:id', can('oil_changes.view'), async (req, res) => {
  const r = await one(`SELECT ${histSpec.select} ${histSpec.from} WHERE h.id = ?`, [req.params.id]);
  if (!r) fail(404, 'not_found');
  res.json(r);
});
fleet2Router.get('/oil-changes/:id', can('oil_changes.view'), async (req, res) => {
  const spec = oilSpec(await today(), null);
  const s = await one<any>(`SELECT ${spec.select}, (SELECT COUNT(*) FROM oil_changes WHERE vehicle_id = s.vehicle_id) changes ${spec.from} WHERE s.id = ?`, [req.params.id]);
  if (!s) fail(404, 'not_found');
  s.recent = await q('SELECT * FROM oil_changes WHERE vehicle_id = ? ORDER BY change_date DESC LIMIT 5', [s.vehicle_id]);
  res.json(s);
});
fleet2Router.post('/oil-changes', can('oil_changes.create'), async (req, res) => {
  const v = clean(req.body, OS_RULES);
  if (await one('SELECT 1 FROM oil_schedules WHERE vehicle_id = ?', [v.vehicle_id])) fieldError('vehicle_id', 'schedule_exists');
  const r = await exec('INSERT INTO oil_schedules SET ?', [{ ...v, warn_days: v.warn_days ?? 7 }]);
  await audit(req, { action: 'oil_schedule.create', entity_type: 'oil_schedule', entity_id: r.insertId, after: v });
  res.json({ id: r.insertId });
});
fleet2Router.patch('/oil-changes/:id', can('oil_changes.update'), async (req, res) => {
  const { vehicle_id: _v, ...rules } = OS_RULES; // the vehicle of a schedule is not changed here
  const v = clean(req.body, rules, true);
  await exec('UPDATE oil_schedules SET ? WHERE id = ?', [v, req.params.id]);
  await audit(req, { action: 'oil_schedule.update', entity_type: 'oil_schedule', entity_id: req.params.id, after: v });
  res.json({ ok: true });
});
fleet2Router.post('/oil-changes/bulk-edit', can('oil_changes.update'), async (req, res) => {
  const ids: number[] = (req.body.ids ?? []).map(Number);
  if (!ids.length || ids.length > 200) fail(422, ids.length ? 'max_200' : 'nothing_selected');
  const ch = clean(req.body.changes ?? {}, { interval_days: { type: 'int', min: 1, max: 3650 }, warn_days: { type: 'int', min: 0, max: 365 } }, true);
  for (const [k, val] of Object.entries(ch)) if (val === null) fieldError(k, 'choose_value');
  if (!Object.keys(ch).length) fail(422, 'no_field_chosen');
  await exec('UPDATE oil_schedules SET ? WHERE id IN (?)', [ch, ids]);
  await audit(req, { action: 'oil_schedule.bulk_edit', entity_type: 'oil_schedule', after: ch, details: `${ids.length}` });
  res.json({ updated: ids.length });
});
async function deleteSchedules(req: Request, ids: number[]) {
  await exec('DELETE FROM oil_schedules WHERE id IN (?)', [ids]);
  await audit(req, { action: 'oil_schedule.delete', entity_type: 'oil_schedule', entity_id: ids.join(','), severity: 'warning' });
}
fleet2Router.delete('/oil-changes/:id', can('oil_changes.delete'), async (req, res) => { await deleteSchedules(req, [Number(req.params.id)]); res.json({ ok: true }); });
fleet2Router.post('/oil-changes/bulk-delete', can('oil_changes.delete'), async (req, res) => { await deleteSchedules(req, (req.body.ids ?? []).map(Number).slice(0, 200)); res.json({ ok: true }); });

// The odometer of a change sits between the readings of the changes before and after it.
async function odometerProblem(vehicleId: number, date: string, odo: number | null, id = 0) {
  if (odo === null) return null;
  if (!Number.isInteger(odo) || odo < 0) return 'odometer_invalid';
  const prev = await one<any>('SELECT MAX(odometer) m FROM oil_changes WHERE vehicle_id = ? AND change_date < ? AND id <> ?', [vehicleId, date, id]);
  if (prev?.m != null && odo < prev.m) return 'odometer_below_earlier';
  const next = await one<any>('SELECT MIN(odometer) m FROM oil_changes WHERE vehicle_id = ? AND change_date > ? AND id <> ?', [vehicleId, date, id]);
  if (next?.m != null && odo > next.m) return 'odometer_above_later';
  return null;
}
// Recording is vehicle by vehicle; one refusal does not stop the rest.
fleet2Router.post('/oil-changes/history', can('oil_changes.create'), async (req, res) => {
  const common = clean(req.body, { change_date: { req: true, type: 'date' }, performed_by: { max: 150 }, cost: { type: 'num', min: 0 }, notes: { max: 300 } });
  const vehicles: { vehicle_id: number; odometer?: number | string | null }[] = req.body.vehicles ?? [];
  if (!vehicles.length) fieldError('vehicles', 'required');
  if (vehicles.length > 200) fail(422, 'max_200');
  const recorded: any[] = [];
  const rejected: { vehicle_id: number; reason: string; existing_id?: number }[] = [];
  for (const item of vehicles) {
    const vid = Number(item.vehicle_id);
    const odo = item.odometer === '' || item.odometer == null ? null : Number(item.odometer);
    const veh = await one<any>('SELECT plate FROM vehicles WHERE id = ?', [vid]);
    if (!veh) { rejected.push({ vehicle_id: vid, reason: 'no_such_vehicle' }); continue; }
    const same = await one<any>('SELECT id FROM oil_changes WHERE vehicle_id = ? AND change_date = ?', [vid, common.change_date]);
    if (same) { rejected.push({ vehicle_id: vid, reason: 'change_same_date', existing_id: same.id }); continue; }
    const p = await odometerProblem(vid, common.change_date, odo);
    if (p) { rejected.push({ vehicle_id: vid, reason: p }); continue; }
    await tx(async () => {
      const r = await exec('INSERT INTO oil_changes SET ?', [{ ...common, vehicle_id: vid, odometer: odo }]);
      await rollForward(vid);
      if (odo !== null) await exec('UPDATE vehicles SET odometer = GREATEST(odometer, ?) WHERE id = ?', [odo, vid]);
      const s = await one<any>("SELECT DATE_ADD(last_change, INTERVAL interval_days DAY) next_due FROM oil_schedules WHERE vehicle_id = ?", [vid]);
      recorded.push({ id: r.insertId, vehicle_id: vid, plate: veh.plate, next_due: s?.next_due ?? null });
    });
  }
  await audit(req, { action: 'oil_change.record', entity_type: 'oil_change', after: common, details: `${recorded.length} recorded, ${rejected.length} rejected` });
  res.json({ recorded, rejected });
});
fleet2Router.patch('/oil-changes/history/:id', can('oil_changes.update'), async (req, res) => {
  const before = await one<any>('SELECT * FROM oil_changes WHERE id = ?', [req.params.id]);
  if (!before) fail(404, 'not_found');
  const v = clean(req.body, { change_date: { req: true, type: 'date' }, odometer: { type: 'int', min: 0 }, performed_by: { max: 150 }, cost: { type: 'num', min: 0 }, notes: { max: 300 } }, true);
  const date = v.change_date ?? before.change_date;
  if (v.change_date && (await one('SELECT 1 FROM oil_changes WHERE vehicle_id = ? AND change_date = ? AND id <> ?', [before.vehicle_id, date, before.id]))) fieldError('change_date', 'change_same_date');
  const p = await odometerProblem(before.vehicle_id, date, v.odometer !== undefined ? v.odometer : before.odometer, before.id);
  if (p) fieldError('odometer', p);
  await tx(async () => { await exec('UPDATE oil_changes SET ? WHERE id = ?', [v, before.id]); await rollForward(before.vehicle_id); });
  await audit(req, { action: 'oil_change.update', entity_type: 'oil_change', entity_id: before.id, before, after: v });
  res.json({ ok: true });
});
async function deleteChanges(req: Request, ids: number[]) {
  const vehicles = (await q<any>('SELECT DISTINCT vehicle_id FROM oil_changes WHERE id IN (?)', [ids])).map((r) => r.vehicle_id);
  await tx(async () => {
    await exec('DELETE FROM oil_changes WHERE id IN (?)', [ids]);
    for (const v of vehicles) await rollForward(v);
  });
  await audit(req, { action: 'oil_change.delete', entity_type: 'oil_change', entity_id: ids.join(','), severity: 'warning' });
}
fleet2Router.delete('/oil-changes/history/:id', can('oil_changes.delete'), async (req, res) => { await deleteChanges(req, [Number(req.params.id)]); res.json({ ok: true }); });
fleet2Router.post('/oil-changes/history/bulk-delete', can('oil_changes.delete'), async (req, res) => { await deleteChanges(req, (req.body.ids ?? []).map(Number).slice(0, 200)); res.json({ ok: true }); });

fleet2Router.use('/oil-changes/import', importRoutes({
  name: 'oil_schedules', perm: 'oil_changes.create', matchOn: 'vehicles.plate',
  columns: { plate: ['oil.vehicle', 'plate', 'plate number'], interval_days: ['oil.interval', 'interval', 'interval days'], last_change: ['oil.last_change', 'last change'], warn_days: ['oil.warn', 'warning days'] },
  requiredColumns: [['plate'], ['interval_days'], ['last_change']],
  async parse(row) {
    const plate = cellStr(row.plate); const interval = cellNum(row.interval_days); const last = cellDate(row.last_change); const warn = cellNum(row.warn_days);
    if (!plate || interval == null || !last) return interval === undefined || last === undefined ? 'invalid_value' : 'missing_required';
    if (warn === undefined || interval < 1 || interval > 3650 || (warn != null && (warn < 0 || warn > 365))) return 'invalid_value';
    const vid = await vehicleByPlate(plate);
    if (!vid) return 'vehicle_not_registered';
    return { line: 0, key: String(vid), label: plate, data: { vehicle_id: vid, interval_days: interval, last_change: last, warn_days: warn } };
  },
  async existing(items) {
    const m = new Map<string, any>();
    if (items.length) for (const r of await q('SELECT * FROM oil_schedules WHERE vehicle_id IN (?)', [items.map((i) => i.data.vehicle_id)])) m.set(String(r.vehicle_id), r);
    return m;
  },
  async write(it, ex, ctx) {
    const values = Object.fromEntries(Object.entries(it.data).filter(([, v]) => v !== null && v !== undefined));
    if (ex) { if (ctx.mode === 'skip') return 'skipped'; await exec('UPDATE oil_schedules SET ? WHERE id = ?', [values, ex.id]); return 'replaced'; }
    await exec('INSERT INTO oil_schedules SET ?', [{ warn_days: 7, ...values }]);
    return 'inserted';
  },
}));
fleet2Router.use('/oil-changes/history/import', importRoutes({
  name: 'oil_changes', perm: 'oil_changes.create', matchOn: 'oil.match',
  columns: { plate: ['oil.vehicle', 'plate', 'plate number'], change_date: ['oil.change_date', 'change date'], odometer: ['oil.odometer', 'odometer'],
    performed_by: ['oil.performed_by', 'performed by'], cost: ['oil.cost', 'cost'], notes: ['common.notes', 'notes'] },
  requiredColumns: [['plate'], ['change_date']],
  async parse(row) {
    const plate = cellStr(row.plate); const date = cellDate(row.change_date);
    if (!plate || !date) return date === undefined ? 'invalid_value' : 'missing_required';
    const odo = cellNum(row.odometer); const cost = cellNum(row.cost);
    if (odo === undefined || cost === undefined) return 'invalid_value';
    const vid = await vehicleByPlate(plate);
    if (!vid) return 'vehicle_not_registered';
    return { line: 0, key: `${vid}:${date}`, label: plate, data: { vehicle_id: vid, change_date: date, odometer: odo, cost, performed_by: cellStr(row.performed_by, 150), notes: cellStr(row.notes, 300) } };
  },
  async existing(items) {
    const m = new Map<string, any>();
    for (const it of items) { const r = await one('SELECT * FROM oil_changes WHERE vehicle_id = ? AND change_date = ?', [it.data.vehicle_id, it.data.change_date]); if (r) m.set(it.key, r); }
    return m;
  },
  async write(it, ex, ctx) {
    const values = Object.fromEntries(Object.entries(it.data).filter(([, v]) => v !== null && v !== undefined));
    let out: 'replaced' | 'inserted';
    if (ex) { if (ctx.mode === 'skip') return 'skipped'; await exec('UPDATE oil_changes SET ? WHERE id = ?', [values, ex.id]); out = 'replaced'; }
    else { await exec('INSERT INTO oil_changes SET ?', [values]); out = 'inserted'; }
    ctx.result.rolled_forward = (ctx.result.rolled_forward ?? 0) + (await rollForward(it.data.vehicle_id));
    return out;
  },
}));

