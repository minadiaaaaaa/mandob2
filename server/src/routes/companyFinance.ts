// Phase 6: company finance (accounts, categories, suppliers, entries, transfers, obligations, assets, stock) and
// payroll (salary rules, sheets, paid history, a rider's settlement statement). The rules live in
// domain/companyFinance.ts and domain/payroll.ts. A company's own data on every plan: no quota, no feature gate.
import { Router } from 'express';
import { exec, one, q } from '../db.js';
import { clean, fail, fieldError, list, listAll, sendExport, today, where, type Spec } from '../http.js';
import { can } from '../auth.js';
import { audit } from '../audit.js';
import { normalizeIban, validIban } from '../domain/employees.js';
import {
  accounts, createEntry, dueSummary, ensureDues, ensureFinanceDefaults, financeOverview, moveStock, payDue, stockQuantity, transfer, voidEntry,
} from '../domain/companyFinance.js';
import { computeSheet, createSheet, editLine, finalizeSheet, paySheet, reopenSheet, settlement } from '../domain/payroll.js';

export const companyFinanceRouter = Router();
const id = (req: { params: Record<string, string | string[]> }) => String(req.params.id);
const tenantOf = (req: any) => Number(req.user!.tenant_id);

// ======================================================================== overview
companyFinanceRouter.get('/company-finance/overview', can('company_finance.view'), async (req, res) => {
  await ensureFinanceDefaults(tenantOf(req));
  res.json(await financeOverview(await today()));
});

// ======================================================================== accounts
const ACCOUNT_RULES = { name: { req: true, max: 100 }, kind: { req: true, enum: ['cash', 'bank'] }, bank_name: { max: 100 }, iban: { max: 40 },
  opening_balance: { type: 'num' as const }, opening_date: { type: 'date' as const } };
function checkAccount(v: Record<string, any>) {
  if (v.iban) { v.iban = normalizeIban(v.iban); if (!validIban(v.iban)) fieldError('iban', 'iban_invalid'); }
}
companyFinanceRouter.get('/fin-accounts', can('company_finance.view'), async (_req, res) => res.json(await accounts()));
companyFinanceRouter.post('/fin-accounts', can('company_finance.create'), async (req, res) => {
  const v = clean(req.body, ACCOUNT_RULES);
  checkAccount(v);
  if (await one('SELECT 1 FROM fin_accounts WHERE name = ?', [v.name])) fieldError('name', 'name_taken');
  const r = await exec('INSERT INTO fin_accounts SET ?', [v]);
  await audit(req, { action: 'fin_account.create', entity_type: 'fin_account', entity_id: r.insertId, after: v });
  res.json({ id: r.insertId });
});
companyFinanceRouter.patch('/fin-accounts/:id', can('company_finance.update'), async (req, res) => {
  const before = await one<any>('SELECT * FROM fin_accounts WHERE id = ?', [id(req)]);
  if (!before) fail(404, 'not_found');
  const v = clean(req.body, { ...ACCOUNT_RULES, name: { max: 100 }, kind: { enum: ['cash', 'bank'] }, is_active: { type: 'bool' as const } }, true);
  checkAccount(v);
  if (v.name && (await one('SELECT 1 FROM fin_accounts WHERE name = ? AND id <> ?', [v.name, before.id]))) fieldError('name', 'name_taken');
  // the opening balance is fixed once money has moved through the account
  if (('opening_balance' in v || 'opening_date' in v) && (await one('SELECT 1 FROM fin_entries WHERE account_id = ? AND voided_at IS NULL', [before.id]))) fail(409, 'account_has_entries');
  if (Object.keys(v).length) {
    await exec('UPDATE fin_accounts SET ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [v, before.id]);
    await audit(req, { action: 'fin_account.update', entity_type: 'fin_account', entity_id: before.id, before, after: v });
  }
  res.json({ ok: true });
});
companyFinanceRouter.delete('/fin-accounts/:id', can('company_finance.delete'), async (req, res) => {
  const before = await one<any>('SELECT * FROM fin_accounts WHERE id = ?', [id(req)]);
  if (!before) fail(404, 'not_found');
  if (await one('SELECT 1 FROM fin_entries WHERE account_id = ?', [before.id])) fail(409, 'account_has_entries');
  await exec('DELETE FROM fin_accounts WHERE id = ?', [before.id]);
  await audit(req, { action: 'fin_account.delete', entity_type: 'fin_account', entity_id: before.id, before, severity: 'critical' });
  res.json({ ok: true });
});

// ======================================================================== categories and suppliers
companyFinanceRouter.get('/fin-categories', can('company_finance.view'), async (req, res) => {
  await ensureFinanceDefaults(tenantOf(req));
  res.json(await q(`SELECT c.*, (SELECT COUNT(*) FROM fin_entries e WHERE e.category_id = c.id) entries FROM fin_categories c ORDER BY c.kind, c.builtin_key IS NULL, c.name_ar`));
});
companyFinanceRouter.post('/fin-categories', can('company_finance.create'), async (req, res) => {
  const v = clean(req.body, { name_ar: { req: true, max: 100 }, name_en: { max: 100 }, kind: { req: true, enum: ['income', 'expense'] } });
  if (await one('SELECT 1 FROM fin_categories WHERE kind = ? AND name_ar = ?', [v.kind, v.name_ar])) fieldError('name_ar', 'name_taken');
  const r = await exec('INSERT INTO fin_categories SET ?', [v]);
  await audit(req, { action: 'fin_category.create', entity_type: 'fin_category', entity_id: r.insertId, after: v });
  res.json({ id: r.insertId });
});
companyFinanceRouter.patch('/fin-categories/:id', can('company_finance.update'), async (req, res) => {
  const before = await one<any>('SELECT * FROM fin_categories WHERE id = ?', [id(req)]);
  if (!before) fail(404, 'not_found');
  // renaming or switching off is always allowed; the kind of a category with entries is fixed
  const v = clean(req.body, { name_ar: { max: 100 }, name_en: { max: 100 }, is_active: { type: 'bool' } }, true);
  if (v.name_ar === null) fieldError('name_ar', 'required');
  if (v.name_ar && (await one('SELECT 1 FROM fin_categories WHERE kind = ? AND name_ar = ? AND id <> ?', [before.kind, v.name_ar, before.id]))) fieldError('name_ar', 'name_taken');
  if (Object.keys(v).length) {
    await exec('UPDATE fin_categories SET ? WHERE id = ?', [v, before.id]);
    await audit(req, { action: 'fin_category.update', entity_type: 'fin_category', entity_id: before.id, before, after: v });
  }
  res.json({ ok: true });
});
companyFinanceRouter.get('/fin-suppliers', can('company_finance.view'), async (_req, res) =>
  res.json(await q('SELECT s.*, (SELECT COUNT(*) FROM fin_entries e WHERE e.supplier_id = s.id) entries FROM fin_suppliers s ORDER BY s.is_active DESC, s.name')));
companyFinanceRouter.post('/fin-suppliers', can('company_finance.create'), async (req, res) => {
  const v = clean(req.body, { name: { req: true, max: 150 }, phone: { type: 'phone', max: 30 }, vat_number: { type: 'digits', max: 20 }, notes: { max: 255 } });
  if (await one('SELECT 1 FROM fin_suppliers WHERE name = ?', [v.name])) fieldError('name', 'name_taken');
  const r = await exec('INSERT INTO fin_suppliers SET ?', [v]);
  await audit(req, { action: 'fin_supplier.create', entity_type: 'fin_supplier', entity_id: r.insertId, after: v });
  res.json({ id: r.insertId });
});
companyFinanceRouter.patch('/fin-suppliers/:id', can('company_finance.update'), async (req, res) => {
  const before = await one<any>('SELECT * FROM fin_suppliers WHERE id = ?', [id(req)]);
  if (!before) fail(404, 'not_found');
  const v = clean(req.body, { name: { max: 150 }, phone: { type: 'phone', max: 30 }, vat_number: { type: 'digits', max: 20 }, notes: { max: 255 }, is_active: { type: 'bool' } }, true);
  if (v.name === null) fieldError('name', 'required');
  if (v.name && (await one('SELECT 1 FROM fin_suppliers WHERE name = ? AND id <> ?', [v.name, before.id]))) fieldError('name', 'name_taken');
  if (Object.keys(v).length) {
    await exec('UPDATE fin_suppliers SET ? WHERE id = ?', [v, before.id]);
    await audit(req, { action: 'fin_supplier.update', entity_type: 'fin_supplier', entity_id: before.id, before, after: v });
  }
  res.json({ ok: true });
});

// ======================================================================== entries (the history)
const ENTRY_SPEC: Spec = {
  from: `FROM fin_entries e JOIN fin_accounts a ON a.id = e.account_id LEFT JOIN fin_categories c ON c.id = e.category_id LEFT JOIN fin_suppliers s ON s.id = e.supplier_id`,
  select: `e.*, a.name account_name, c.name_ar category_ar, c.name_en category_en, s.name supplier_name`,
  search: ['e.description', 'e.reference', 's.name'],
  filters: {
    direction: (v) => ['e.direction = ?', [v]], account: (v) => ['e.account_id = ?', [v]], category: (v) => ['e.category_id = ?', [v]],
    supplier: (v) => ['e.supplier_id = ?', [v]], from: (v) => ['e.entry_date >= ?', [v]], to: (v) => ['e.entry_date <= ?', [v]],
    voided: (v) => (v === '1' ? 'e.voided_at IS NOT NULL' : v === '0' ? 'e.voided_at IS NULL' : null),
    month: (v) => (/^\d{4}-\d{2}$/.test(v) ? ['e.entry_date >= ? AND e.entry_date < DATE_ADD(?, INTERVAL 1 MONTH)', [`${v}-01`, `${v}-01`]] : null),
  },
  sorts: { date: 'e.entry_date', amount: 'e.amount', created: 'e.id' }, defaultSort: '-date',
};
companyFinanceRouter.get('/fin-entries', can('company_finance.view'), async (req, res) => {
  const query = req.query as Record<string, string>;
  const data = await list({ ...ENTRY_SPEC, sorts: { ...ENTRY_SPEC.sorts, date: 'e.entry_date DESC, e.id' } }, query);
  const w = where(ENTRY_SPEC, query, ['direction']);
  const [stats] = await q(`SELECT COALESCE(SUM(IF(e.direction = 'in' AND e.voided_at IS NULL, e.amount, 0)), 0) inflow,
    COALESCE(SUM(IF(e.direction = 'out' AND e.voided_at IS NULL, e.amount, 0)), 0) outflow ${ENTRY_SPEC.from}${w.sql}`, w.params);
  res.json({ ...data, stats });
});
companyFinanceRouter.get('/fin-entries/export', can('company_finance.export'), async (req, res) =>
  sendExport(req, res, { format: req.query.format === 'csv' ? 'csv' : 'xlsx', title: 'fin.title_entries', rows: await listAll(ENTRY_SPEC, req.query as any), cols: [
    { key: 'entry_date', label: 'fin2.date' }, { key: 'direction', label: 'fin2.direction' }, { key: 'amount', label: 'fin2.amount' }, { key: 'account_name', label: 'fin2.account' },
    { key: 'category_ar', label: 'fin2.category' }, { key: 'supplier_name', label: 'fin2.supplier' }, { key: 'description', label: 'fin2.description' },
    { key: 'reference', label: 'fin2.reference' }, { key: 'void_reason', label: 'fin2.void_reason' },
  ] }));
const ENTRY_RULES = { entry_date: { type: 'date' as const }, direction: { req: true, enum: ['in', 'out'] }, account_id: { req: true, type: 'int' as const },
  category_id: { type: 'int' as const }, supplier_id: { type: 'int' as const }, amount: { req: true, type: 'num' as const }, description: { max: 255 }, reference: { max: 100 } };
companyFinanceRouter.post('/fin-entries', can('company_finance.create'), async (req, res) => {
  const day = await today();
  const v = clean(req.body, ENTRY_RULES);
  const eid = await createEntry({ ...v, entry_date: v.entry_date ?? day } as any, req.user!.id, day);
  await audit(req, { action: 'fin_entry.create', entity_type: 'fin_entry', entity_id: eid, after: v });
  res.json({ id: eid });
});
// only the words of an entry change; its money is voided and entered again
companyFinanceRouter.patch('/fin-entries/:id', can('company_finance.update'), async (req, res) => {
  const before = await one<any>('SELECT * FROM fin_entries WHERE id = ?', [id(req)]);
  if (!before) fail(404, 'not_found');
  if (before.voided_at) fail(409, 'entry_voided');
  for (const k of ['amount', 'account_id', 'entry_date', 'direction']) if (k in (req.body ?? {})) fail(422, 'entry_money_fixed');
  const v = clean(req.body, { description: { max: 255 }, reference: { max: 100 } }, true);
  if (Object.keys(v).length) {
    await exec('UPDATE fin_entries SET ? WHERE id = ?', [v, before.id]);
    await audit(req, { action: 'fin_entry.update', entity_type: 'fin_entry', entity_id: before.id, before, after: v });
  }
  res.json({ ok: true });
});
companyFinanceRouter.post('/fin-entries/:id/void', can('company_finance.void'), async (req, res) => {
  const v = clean(req.body, { reason: { req: true, max: 255 } });
  const ids = await voidEntry(id(req), v.reason);
  await audit(req, { action: 'fin_entry.void', entity_type: 'fin_entry', entity_id: id(req), after: { ...v, ids }, severity: 'warning' });
  res.json({ ok: true, voided: ids.length });
});
companyFinanceRouter.post('/fin-transfers', can('company_finance.create'), async (req, res) => {
  const day = await today();
  const v = clean(req.body, { from_account_id: { req: true, type: 'int' }, to_account_id: { req: true, type: 'int' }, amount: { req: true, type: 'num' }, entry_date: { type: 'date' }, note: { max: 255 } });
  const group = await transfer(v.from_account_id, v.to_account_id, v.amount, v.entry_date ?? day, v.note ?? null, req.user!.id, day);
  await audit(req, { action: 'fin_entry.transfer', entity_type: 'fin_entry', entity_id: group, after: v });
  res.json({ ok: true, group });
});

// ======================================================================== obligations
companyFinanceRouter.get('/fin-obligations', can('obligations.view'), async (_req, res) => {
  const day = await today();
  await ensureDues(day);
  const rows = await q(`SELECT o.*, s.name supplier_name, c.name_ar category_ar, c.name_en category_en,
      (SELECT MIN(d.due_date) FROM fin_obligation_dues d WHERE d.obligation_id = o.id AND d.status = 'due') next_due,
      (SELECT COALESCE(SUM(d.amount), 0) FROM fin_obligation_dues d WHERE d.obligation_id = o.id AND d.status = 'due' AND d.due_date < ?) overdue
    FROM fin_obligations o LEFT JOIN fin_suppliers s ON s.id = o.supplier_id LEFT JOIN fin_categories c ON c.id = o.category_id ORDER BY o.status, o.title`, [day]);
  res.json({ rows, summary: await dueSummary(day) });
});
companyFinanceRouter.get('/fin-dues', can('obligations.view'), async (req, res) => {
  const day = await today();
  await ensureDues(day);
  const st = String(req.query.status ?? 'open');
  const w = st === 'paid' ? "d.status = 'paid'" : st === 'all' ? '1' : st === 'overdue' ? "d.status = 'due' AND d.due_date < ?" : "d.status = 'due'";
  res.json(await q(`SELECT d.*, o.title, o.kind, s.name supplier_name FROM fin_obligation_dues d JOIN fin_obligations o ON o.id = d.obligation_id LEFT JOIN fin_suppliers s ON s.id = o.supplier_id
    WHERE ${w} ORDER BY d.due_date LIMIT 300`, st === 'overdue' ? [day] : []));
});
const OBLIGATION_RULES = { title: { req: true, max: 150 }, kind: { req: true, enum: ['once', 'monthly'] }, supplier_id: { type: 'int' as const },
  category_id: { type: 'int' as const }, account_id: { type: 'int' as const }, amount: { req: true, type: 'num' as const, min: 0.01 }, start_date: { req: true, type: 'date' as const },
  end_date: { type: 'date' as const }, notes: { max: 255 } };
async function checkObligation(v: Record<string, any>, cur: Record<string, any> = {}) {
  const start = v.start_date ?? cur.start_date, end = v.end_date !== undefined ? v.end_date : cur.end_date;
  if (end && start && String(end).slice(0, 10) < String(start).slice(0, 10)) fieldError('end_date', 'end_before_start');
  if (v.category_id != null) {
    const c = await one<{ kind: string }>('SELECT kind FROM fin_categories WHERE id = ? AND is_active = 1', [v.category_id]);
    if (!c) fieldError('category_id', 'invalid');
    if (c!.kind !== 'expense') fieldError('category_id', 'category_other_direction');
  }
  if (v.supplier_id != null && !(await one('SELECT 1 FROM fin_suppliers WHERE id = ?', [v.supplier_id]))) fieldError('supplier_id', 'invalid');
  if (v.account_id != null && !(await one('SELECT 1 FROM fin_accounts WHERE id = ?', [v.account_id]))) fieldError('account_id', 'invalid');
}
companyFinanceRouter.post('/fin-obligations', can('obligations.create'), async (req, res) => {
  const v = clean(req.body, OBLIGATION_RULES);
  await checkObligation(v);
  const r = await exec('INSERT INTO fin_obligations SET ?', [{ ...v, created_by: req.user!.id }]);
  await ensureDues(await today());
  await audit(req, { action: 'fin_obligation.create', entity_type: 'fin_obligation', entity_id: r.insertId, after: v });
  res.json({ id: r.insertId });
});
// The amount and dates apply to the payments not yet made; paid ones keep what they were.
companyFinanceRouter.patch('/fin-obligations/:id', can('obligations.update'), async (req, res) => {
  const before = await one<any>('SELECT * FROM fin_obligations WHERE id = ?', [id(req)]);
  if (!before) fail(404, 'not_found');
  const v = clean(req.body, { ...OBLIGATION_RULES, title: { max: 150 }, kind: { enum: ['once', 'monthly'] }, amount: { type: 'num' as const, min: 0.01 }, start_date: { type: 'date' as const }, status: { enum: ['active', 'ended'] } }, true);
  if ((v.kind && v.kind !== before.kind) || (v.start_date && v.start_date !== String(before.start_date).slice(0, 10))) {
    if (await one("SELECT 1 FROM fin_obligation_dues WHERE obligation_id = ? AND status <> 'due'", [before.id])) fail(409, 'obligation_has_payments');
  }
  await checkObligation(v, before);
  if (Object.keys(v).length) {
    await exec('UPDATE fin_obligations SET ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [v, before.id]);
    // payments not yet made follow the new terms
    await exec("DELETE FROM fin_obligation_dues WHERE obligation_id = ? AND status = 'due'", [before.id]);
    await ensureDues(await today());
    await audit(req, { action: 'fin_obligation.update', entity_type: 'fin_obligation', entity_id: before.id, before, after: v });
  }
  res.json({ ok: true });
});
companyFinanceRouter.delete('/fin-obligations/:id', can('obligations.delete'), async (req, res) => {
  const before = await one<any>('SELECT * FROM fin_obligations WHERE id = ?', [id(req)]);
  if (!before) fail(404, 'not_found');
  if (await one("SELECT 1 FROM fin_obligation_dues WHERE obligation_id = ? AND status = 'paid'", [before.id])) fail(409, 'obligation_has_payments');
  await exec('DELETE FROM fin_obligation_dues WHERE obligation_id = ?', [before.id]);
  await exec('DELETE FROM fin_obligations WHERE id = ?', [before.id]);
  await audit(req, { action: 'fin_obligation.delete', entity_type: 'fin_obligation', entity_id: before.id, before, severity: 'critical' });
  res.json({ ok: true });
});
companyFinanceRouter.post('/fin-dues/:id/pay', can('obligations.pay'), async (req, res) => {
  const day = await today();
  const v = clean(req.body, { account_id: { req: true, type: 'int' }, paid_on: { type: 'date' }, reference: { max: 100 } });
  const entry = await payDue(id(req), { account_id: v.account_id, paid_on: v.paid_on ?? day, reference: v.reference }, req.user!.id, day);
  await audit(req, { action: 'fin_due.pay', entity_type: 'fin_obligation_due', entity_id: id(req), after: { ...v, entry } });
  res.json({ ok: true, entry });
});
companyFinanceRouter.post('/fin-dues/:id/skip', can('obligations.pay'), async (req, res) => {
  const r = await exec("UPDATE fin_obligation_dues SET status = 'skipped' WHERE id = ? AND status = 'due'", [id(req)]);
  if (!r.affectedRows) fail(409, 'due_closed');
  await audit(req, { action: 'fin_due.skip', entity_type: 'fin_obligation_due', entity_id: id(req), severity: 'warning' });
  res.json({ ok: true });
});

// ======================================================================== assets and stock
const ASSET_RULES = { name: { req: true, max: 150 }, category: { max: 100 }, value: { type: 'num' as const, min: 0 }, purchase_date: { type: 'date' as const },
  status: { enum: ['in_use', 'disposed'] }, disposed_on: { type: 'date' as const }, notes: { max: 255 } };
companyFinanceRouter.get('/fin-assets', can('assets.view'), async (_req, res) => {
  const rows = await q('SELECT * FROM fin_assets ORDER BY status, name');
  res.json({ rows, total: rows.filter((r: any) => r.status === 'in_use').reduce((s: number, r: any) => s + Number(r.value), 0) });
});
companyFinanceRouter.post('/fin-assets', can('assets.create'), async (req, res) => {
  const v = clean(req.body, ASSET_RULES);
  const r = await exec('INSERT INTO fin_assets SET ?', [v]);
  await audit(req, { action: 'fin_asset.create', entity_type: 'fin_asset', entity_id: r.insertId, after: v });
  res.json({ id: r.insertId });
});
companyFinanceRouter.patch('/fin-assets/:id', can('assets.update'), async (req, res) => {
  const before = await one<any>('SELECT * FROM fin_assets WHERE id = ?', [id(req)]);
  if (!before) fail(404, 'not_found');
  const v = clean(req.body, { ...ASSET_RULES, name: { max: 150 } }, true);
  if (v.name === null) fieldError('name', 'required');
  if (v.status === 'disposed' && !v.disposed_on && !before.disposed_on) v.disposed_on = await today();
  if (Object.keys(v).length) {
    await exec('UPDATE fin_assets SET ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [v, before.id]);
    await audit(req, { action: 'fin_asset.update', entity_type: 'fin_asset', entity_id: before.id, before, after: v });
  }
  res.json({ ok: true });
});
companyFinanceRouter.delete('/fin-assets/:id', can('assets.delete'), async (req, res) => {
  const before = await one<any>('SELECT * FROM fin_assets WHERE id = ?', [id(req)]);
  if (!before) fail(404, 'not_found');
  await exec('DELETE FROM fin_assets WHERE id = ?', [before.id]);
  await audit(req, { action: 'fin_asset.delete', entity_type: 'fin_asset', entity_id: before.id, before, severity: 'critical' });
  res.json({ ok: true });
});
companyFinanceRouter.get('/fin-stock', can('stock.view'), async (_req, res) =>
  res.json(await q(`SELECT i.*, COALESCE((SELECT SUM(IF(m.direction = 'in', m.quantity, -m.quantity)) FROM fin_stock_moves m WHERE m.item_id = i.id), 0) quantity,
    (SELECT MAX(m.move_date) FROM fin_stock_moves m WHERE m.item_id = i.id) last_move FROM fin_stock_items i ORDER BY i.is_active DESC, i.name`)));
companyFinanceRouter.post('/fin-stock', can('stock.create'), async (req, res) => {
  const v = clean(req.body, { name: { req: true, max: 150 }, unit: { max: 30 }, min_quantity: { type: 'num', min: 0 } });
  if (await one('SELECT 1 FROM fin_stock_items WHERE name = ?', [v.name])) fieldError('name', 'name_taken');
  const r = await exec('INSERT INTO fin_stock_items SET ?', [v]);
  await audit(req, { action: 'fin_stock.create', entity_type: 'fin_stock_item', entity_id: r.insertId, after: v });
  res.json({ id: r.insertId });
});
companyFinanceRouter.patch('/fin-stock/:id', can('stock.update'), async (req, res) => {
  const before = await one<any>('SELECT * FROM fin_stock_items WHERE id = ?', [id(req)]);
  if (!before) fail(404, 'not_found');
  const v = clean(req.body, { name: { max: 150 }, unit: { max: 30 }, min_quantity: { type: 'num', min: 0 }, is_active: { type: 'bool' } }, true);
  if (v.name === null) fieldError('name', 'required');
  if (v.name && (await one('SELECT 1 FROM fin_stock_items WHERE name = ? AND id <> ?', [v.name, before.id]))) fieldError('name', 'name_taken');
  if (Object.keys(v).length) await exec('UPDATE fin_stock_items SET ? WHERE id = ?', [v, before.id]);
  await audit(req, { action: 'fin_stock.update', entity_type: 'fin_stock_item', entity_id: before.id, before, after: v });
  res.json({ ok: true });
});
companyFinanceRouter.get('/fin-stock/:id/moves', can('stock.view'), async (req, res) =>
  res.json({ quantity: await stockQuantity(id(req)), rows: await q(`SELECT m.*, r.full_name rider_name, u.full_name by_name FROM fin_stock_moves m LEFT JOIN riders r ON r.id = m.rider_id
    LEFT JOIN users u ON u.id = m.created_by WHERE m.item_id = ? ORDER BY m.move_date DESC, m.id DESC LIMIT 200`, [id(req)]) }));
companyFinanceRouter.post('/fin-stock/:id/moves', can('stock.update'), async (req, res) => {
  const day = await today();
  const v = clean(req.body, { move_date: { type: 'date' }, direction: { req: true, enum: ['in', 'out'] }, quantity: { req: true, type: 'num' }, unit_cost: { type: 'num', min: 0 },
    rider_id: { type: 'int' }, note: { max: 255 } });
  const mid = await moveStock({ ...v, item_id: Number(id(req)), move_date: v.move_date ?? day } as any, req.user!.id, day);
  await audit(req, { action: 'fin_stock.move', entity_type: 'fin_stock_item', entity_id: id(req), after: v });
  res.json({ id: mid });
});

// ======================================================================== payroll
const RULE_RULES = { name: { req: true, max: 100 }, branch_id: { type: 'int' as const }, designation_id: { type: 'int' as const }, base_salary: { type: 'num' as const, min: 0 },
  per_order: { type: 'num' as const, min: 0 }, target_orders: { type: 'int' as const, min: 1 }, target_bonus: { type: 'num' as const, min: 0 },
  deduct_fines: { type: 'bool' as const }, deduct_advances: { type: 'bool' as const } };
async function checkRule(v: Record<string, any>) {
  if (v.branch_id != null && !(await one('SELECT 1 FROM branches WHERE id = ?', [v.branch_id]))) fieldError('branch_id', 'invalid');
  if (v.designation_id != null && !(await one('SELECT 1 FROM designations WHERE id = ?', [v.designation_id]))) fieldError('designation_id', 'invalid');
}
companyFinanceRouter.get('/salary-rules', can('salary_rules.view'), async (_req, res) =>
  res.json(await q(`SELECT r.*, b.name_ar branch_ar, b.name_en branch_en, d.name_ar designation_ar, d.name_en designation_en FROM salary_rules r
    LEFT JOIN branches b ON b.id = r.branch_id LEFT JOIN designations d ON d.id = r.designation_id ORDER BY r.is_active DESC, r.name`)));
companyFinanceRouter.post('/salary-rules', can('salary_rules.create'), async (req, res) => {
  const v = clean(req.body, RULE_RULES);
  await checkRule(v);
  if (await one('SELECT 1 FROM salary_rules WHERE name = ?', [v.name])) fieldError('name', 'name_taken');
  const r = await exec('INSERT INTO salary_rules SET ?', [v]);
  await audit(req, { action: 'salary_rule.create', entity_type: 'salary_rule', entity_id: r.insertId, after: v });
  res.json({ id: r.insertId });
});
companyFinanceRouter.patch('/salary-rules/:id', can('salary_rules.update'), async (req, res) => {
  const before = await one<any>('SELECT * FROM salary_rules WHERE id = ?', [id(req)]);
  if (!before) fail(404, 'not_found');
  const v = clean(req.body, { ...RULE_RULES, name: { max: 100 }, is_active: { type: 'bool' as const } }, true);
  if (v.name === null) fieldError('name', 'required');
  await checkRule(v);
  if (v.name && (await one('SELECT 1 FROM salary_rules WHERE name = ? AND id <> ?', [v.name, before.id]))) fieldError('name', 'name_taken');
  if (Object.keys(v).length) {
    await exec('UPDATE salary_rules SET ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [v, before.id]);
    await audit(req, { action: 'salary_rule.update', entity_type: 'salary_rule', entity_id: before.id, before, after: v });
  }
  res.json({ ok: true });
});
companyFinanceRouter.delete('/salary-rules/:id', can('salary_rules.delete'), async (req, res) => {
  const before = await one<any>('SELECT * FROM salary_rules WHERE id = ?', [id(req)]);
  if (!before) fail(404, 'not_found');
  if (await one('SELECT 1 FROM payroll_lines WHERE rule_id = ?', [before.id])) fail(409, 'rule_in_use');
  await exec('DELETE FROM salary_rules WHERE id = ?', [before.id]);
  await audit(req, { action: 'salary_rule.delete', entity_type: 'salary_rule', entity_id: before.id, before, severity: 'critical' });
  res.json({ ok: true });
});

companyFinanceRouter.get('/payroll', can('payroll.view'), async (req, res) => {
  const st = req.query.status ? String(req.query.status) : null;
  res.json(await q(`SELECT s.*, b.name_ar branch_ar, b.name_en branch_en, a.name account_name,
      (SELECT COUNT(*) FROM attachments f WHERE f.entity_type = 'payroll_sheet' AND f.entity_id = CAST(s.id AS CHAR) AND f.attachment_type = 'proof') proofs
    FROM payroll_sheets s LEFT JOIN branches b ON b.id = s.branch_id LEFT JOIN fin_accounts a ON a.id = s.account_id
    ${st ? 'WHERE s.status = ?' : ''} ORDER BY s.period DESC, s.id DESC LIMIT 200`, st ? [st] : []));
});
companyFinanceRouter.post('/payroll', can('payroll.create'), async (req, res) => {
  const v = clean(req.body, { period: { req: true, max: 7 }, branch_id: { type: 'int' } });
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(v.period)) fieldError('period', 'invalid');
  if (v.period > (await today()).slice(0, 7)) fieldError('period', 'date_in_future');
  const sid = await createSheet(v.period, v.branch_id ?? null, req.user!.id);
  await audit(req, { action: 'payroll.create', entity_type: 'payroll_sheet', entity_id: sid, after: v });
  res.json({ id: sid });
});
companyFinanceRouter.get('/payroll/:id', can('payroll.view'), async (req, res) => {
  const s = await one<any>(`SELECT s.*, b.name_ar branch_ar, b.name_en branch_en, a.name account_name FROM payroll_sheets s LEFT JOIN branches b ON b.id = s.branch_id
    LEFT JOIN fin_accounts a ON a.id = s.account_id WHERE s.id = ?`, [id(req)]);
  if (!s) fail(404, 'not_found');
  const lines = await q(`SELECT l.*, r.full_name, r.alias, ru.name rule_name, (SELECT ba.iban FROM rider_bank_accounts ba WHERE ba.rider_id = l.rider_id AND ba.is_primary = 1 LIMIT 1) iban
    FROM payroll_lines l JOIN riders r ON r.id = l.rider_id LEFT JOIN salary_rules ru ON ru.id = l.rule_id WHERE l.sheet_id = ? ORDER BY r.full_name`, [s.id]);
  res.json({ ...s, lines });
});
companyFinanceRouter.get('/payroll/:id/export', can('payroll.export'), async (req, res) => {
  const s = await one<any>('SELECT period FROM payroll_sheets WHERE id = ?', [id(req)]);
  if (!s) fail(404, 'not_found');
  const rows = await q(`SELECT l.*, r.full_name, (SELECT ba.iban FROM rider_bank_accounts ba WHERE ba.rider_id = l.rider_id AND ba.is_primary = 1 LIMIT 1) iban
    FROM payroll_lines l JOIN riders r ON r.id = l.rider_id WHERE l.sheet_id = ? ORDER BY r.full_name`, [id(req)]);
  await sendExport(req, res, { format: req.query.format === 'csv' ? 'csv' : 'xlsx', title: 'pay.title', rows, summary: [['pay.period', s!.period]], cols: [
    { key: 'rider_id', label: 'riders.rider_id' }, { key: 'full_name', label: 'riders.full_name' }, { key: 'iban', label: 'bank.iban' }, { key: 'orders', label: 'pay.orders' },
    { key: 'base', label: 'pay.base' }, { key: 'orders_pay', label: 'pay.orders_pay' }, { key: 'bonus', label: 'pay.bonus' }, { key: 'addition', label: 'pay.addition' },
    { key: 'fines', label: 'pay.fines' }, { key: 'advances', label: 'pay.advances' }, { key: 'deduction', label: 'pay.deduction' }, { key: 'net', label: 'pay.net' }, { key: 'note', label: 'common.notes' },
  ] });
});
companyFinanceRouter.post('/payroll/:id/recalculate', can('payroll.update'), async (req, res) => {
  await computeSheet(Number(id(req)));
  await audit(req, { action: 'payroll.recalculate', entity_type: 'payroll_sheet', entity_id: id(req) });
  res.json({ ok: true });
});
companyFinanceRouter.patch('/payroll-lines/:id', can('payroll.update'), async (req, res) => {
  const v = clean(req.body, { addition: { type: 'num', min: 0 }, deduction: { type: 'num', min: 0 }, note: { max: 255 } }, true);
  await editLine(id(req), v);
  await audit(req, { action: 'payroll.line', entity_type: 'payroll_line', entity_id: id(req), after: v });
  res.json({ ok: true });
});
companyFinanceRouter.post('/payroll/:id/finalize', can('payroll.finalize'), async (req, res) => {
  await finalizeSheet(id(req), req.user!.id);
  await audit(req, { action: 'payroll.finalize', entity_type: 'payroll_sheet', entity_id: id(req), severity: 'warning' });
  res.json({ ok: true });
});
companyFinanceRouter.post('/payroll/:id/reopen', can('payroll.reopen'), async (req, res) => {
  await reopenSheet(id(req));
  await audit(req, { action: 'payroll.reopen', entity_type: 'payroll_sheet', entity_id: id(req), severity: 'warning' });
  res.json({ ok: true });
});
companyFinanceRouter.post('/payroll/:id/pay', can('payroll.pay'), async (req, res) => {
  const day = await today();
  const v = clean(req.body, { account_id: { req: true, type: 'int' }, paid_on: { type: 'date' } });
  if (v.paid_on && v.paid_on > day) fieldError('paid_on', 'date_in_future');
  const entry = await paySheet(id(req), { account_id: v.account_id, paid_on: v.paid_on ?? day }, req.user!.id, day);
  await audit(req, { action: 'payroll.pay', entity_type: 'payroll_sheet', entity_id: id(req), after: { ...v, entry }, severity: 'warning' });
  res.json({ ok: true, entry });
});
companyFinanceRouter.delete('/payroll/:id', can('payroll.update'), async (req, res) => {
  const s = await one<any>('SELECT * FROM payroll_sheets WHERE id = ?', [id(req)]);
  if (!s) fail(404, 'not_found');
  if (s.status !== 'draft') fail(409, 'sheet_not_draft');
  await exec('DELETE FROM payroll_lines WHERE sheet_id = ?', [s.id]);
  await exec('DELETE FROM payroll_sheets WHERE id = ?', [s.id]);
  await audit(req, { action: 'payroll.delete', entity_type: 'payroll_sheet', entity_id: s.id, before: s, severity: 'critical' });
  res.json({ ok: true });
});

// A rider's settlement statement (printable)
companyFinanceRouter.get('/riders/:id/settlement', can('payroll.view'), async (req, res) => res.json(await settlement(id(req))));
