// Phase 5: a rider's bank accounts, the exited riders and their exit record, and the rider papers table.
// The rules live in domain/employees.ts. A company's own data on every plan: no quota, no feature gate.
import { Router } from 'express';
import { exec, one, q } from '../db.js';
import { clean, fail, fieldError, list, listAll, sendExport, today, type Spec } from '../http.js';
import { can } from '../auth.js';
import { audit } from '../audit.js';
import { EXIT_CLEARANCE, keepOnePrimary, riderPapers, saveBankAccount } from '../domain/employees.js';

export const employeesRouter = Router();
const id = (req: { params: Record<string, string | string[]> }) => String(req.params.id);

// ---------- bank accounts ----------
const BANK_RULES = { bank_name: { req: true, max: 100 }, iban: { req: true, max: 40 }, account_holder: { max: 150 }, is_primary: { type: 'bool' as const }, notes: { max: 255 } };
employeesRouter.get('/riders/:id/bank-accounts', can('riders.view'), async (req, res) =>
  res.json(await q('SELECT * FROM rider_bank_accounts WHERE rider_id = ? ORDER BY is_primary DESC, id', [id(req)])));
employeesRouter.post('/riders/:id/bank-accounts', can('riders.update'), async (req, res) => {
  if (!(await one('SELECT 1 FROM riders WHERE id = ?', [id(req)]))) fail(404, 'rider_not_found');
  const v = clean(req.body, BANK_RULES);
  const bid = await saveBankAccount(id(req), v);
  await audit(req, { action: 'rider_bank.create', entity_type: 'rider', entity_id: id(req), after: { ...v, iban: v.iban } });
  res.json({ id: bid });
});
employeesRouter.patch('/rider-bank-accounts/:id', can('riders.update'), async (req, res) => {
  const before = await one<any>('SELECT * FROM rider_bank_accounts WHERE id = ?', [id(req)]);
  if (!before) fail(404, 'not_found');
  const v = clean(req.body, BANK_RULES, true);
  for (const k of ['bank_name', 'iban'] as const) if (k in v && !v[k]) fieldError(k, 'required');
  await saveBankAccount(before.rider_id, v, before.id);
  await audit(req, { action: 'rider_bank.update', entity_type: 'rider', entity_id: before.rider_id, before, after: v });
  res.json({ ok: true });
});
employeesRouter.delete('/rider-bank-accounts/:id', can('riders.update'), async (req, res) => {
  const before = await one<any>('SELECT * FROM rider_bank_accounts WHERE id = ?', [id(req)]);
  if (!before) fail(404, 'not_found');
  await exec('DELETE FROM rider_bank_accounts WHERE id = ?', [before.id]);
  await keepOnePrimary(before.rider_id);
  await audit(req, { action: 'rider_bank.delete', entity_type: 'rider', entity_id: before.rider_id, before, severity: 'warning' });
  res.json({ ok: true });
});

// ---------- exited riders ----------
const EXITED_SPEC: Spec = {
  from: `FROM riders r LEFT JOIN branches br ON br.id = r.branch_id LEFT JOIN designations dg ON dg.id = r.designation_id`,
  select: `r.id, r.full_name, r.alias, r.phone, r.national_id, r.hire_date, r.exit_date, r.exit_reason, r.exit_clearance, r.exit_note,
    br.name_ar branch_ar, br.name_en branch_en, dg.name_ar designation_ar, dg.name_en designation_en,
    (SELECT COALESCE(SUM(i.amount - i.paid), 0) FROM advance_installments i JOIN advances ad ON ad.id = i.advance_id WHERE ad.rider_id = r.id AND i.status IN ('due','partial')) advances_due`,
  search: ['r.full_name', 'r.alias', 'r.national_id', 'r.phone', 'r.exit_reason', 'r.exit_note'],
  searchDigits: 'r.id',
  filters: {
    // the base condition (only riders who left) is part of every query
    _: () => "r.status = 'terminated'",
    clearance: (v) => (v === 'none' ? 'r.exit_clearance IS NULL' : ['r.exit_clearance = ?', [v]]),
    from: (v) => ['r.exit_date >= ?', [v]],
    to: (v) => ['r.exit_date <= ?', [v]],
  },
  sorts: { exit: 'r.exit_date', name: 'r.full_name', hire: 'r.hire_date' },
  defaultSort: '-exit',
};
const exitedQuery = (query: Record<string, string>) => ({ ...query, _: '1' });
employeesRouter.get('/riders-exited', can('riders.view'), async (req, res) => {
  const query = exitedQuery(req.query as Record<string, string>);
  const data = await list(EXITED_SPEC, query);
  const [stats] = await q(`SELECT COUNT(*) total, COALESCE(SUM(exit_clearance = 'clear'),0) clear, COALESCE(SUM(exit_clearance = 'in_debt'),0) in_debt,
    COALESCE(SUM(exit_clearance = 'settled'),0) settled, COALESCE(SUM(exit_clearance IS NULL),0) none FROM riders WHERE status = 'terminated'`);
  res.json({ ...data, stats });
});
employeesRouter.get('/riders-exited/export', can('riders.export'), async (req, res) =>
  sendExport(req, res, { format: req.query.format === 'csv' ? 'csv' : 'xlsx', title: 'exited.title', rows: await listAll(EXITED_SPEC, exitedQuery(req.query as Record<string, string>)), cols: [
    { key: 'id', label: 'riders.rider_id' }, { key: 'full_name', label: 'riders.full_name' }, { key: 'hire_date', label: 'riders.hire_date' },
    { key: 'exit_date', label: 'exited.exit_date' }, { key: 'exit_reason', label: 'exited.reason' }, { key: 'exit_clearance', label: 'exited.clearance' },
    { key: 'advances_due', label: 'exited.advances_due' }, { key: 'exit_note', label: 'exited.note' },
  ] }));
employeesRouter.patch('/riders/:id/exit', can('riders.update'), async (req, res) => {
  const before = await one<any>('SELECT id, status, hire_date, exit_date, exit_reason, exit_clearance, exit_note FROM riders WHERE id = ?', [id(req)]);
  if (!before) fail(404, 'rider_not_found');
  if (before.status !== 'terminated') fail(409, 'rider_not_exited');
  const v = clean(req.body, { exit_date: { type: 'date' }, exit_reason: { max: 255 }, exit_clearance: { enum: EXIT_CLEARANCE }, exit_note: { max: 500 } }, true);
  if (v.exit_date === null) fail(422, 'exit_date_required');
  if (v.exit_date && v.exit_date > (await today())) fail(422, 'date_in_future');
  if (v.exit_date && before.hire_date && v.exit_date < String(before.hire_date).slice(0, 10)) fail(422, 'exit_before_hire');
  if (Object.keys(v).length) {
    await exec('UPDATE riders SET ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [v, before.id]);
    await audit(req, { action: 'rider.exit', entity_type: 'rider', entity_id: before.id, before, after: v });
  }
  res.json({ ok: true });
});

// ---------- the rider papers table ----------
employeesRouter.get('/rider-papers', can('riders.view'), async (req, res) => {
  const rows = await riderPapers(req.query as Record<string, string>);
  res.json({ rows, stats: { total: rows.length, complete: rows.filter((r) => !r.missing).length, missing: rows.filter((r) => r.missing).length } });
});
