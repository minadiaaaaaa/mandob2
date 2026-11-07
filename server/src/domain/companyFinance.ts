// Phase 6, company finance: the rules the screens, the payroll and the dashboard share, defined once.
// - An account's balance is its opening balance plus money in minus money out, voided entries left out.
// - An entry's amount, account and date never change: a wrong one is voided (kept, with the reason) and entered
//   again. Money in uses an income category, money out an expense one.
// - A transfer between two accounts is two entries (out of one, into the other) sharing one transfer_group.
// - Obligations: a one-off bill has one payment due; a monthly one has one each month from its start day, made ahead
//   up to a month from today and never past its end date. Paying a due writes the money-out entry; voiding that
//   entry makes the due unpaid again.
// - Stock: the quantity of an item is what came in minus what went out; nothing goes out that is not there.
import { randomBytes } from 'node:crypto';
import { asPlatform, exec, one, q, tx } from '../db.js';
import { addDays, addMonths, fail, fieldError } from '../http.js';

const BUILTIN_CATEGORIES: { key: string; kind: 'income' | 'expense'; ar: string; en: string }[] = [
  { key: 'platform_income', kind: 'income', ar: 'إيرادات المنصات', en: 'Platform income' },
  { key: 'other_income', kind: 'income', ar: 'إيرادات أخرى', en: 'Other income' },
  { key: 'fuel', kind: 'expense', ar: 'وقود', en: 'Fuel' },
  { key: 'salaries', kind: 'expense', ar: 'رواتب', en: 'Salaries' },
  { key: 'rent', kind: 'expense', ar: 'إيجار', en: 'Rent' },
  { key: 'maintenance', kind: 'expense', ar: 'صيانة', en: 'Maintenance' },
  { key: 'fines', kind: 'expense', ar: 'مخالفات', en: 'Fines' },
  { key: 'other_expense', kind: 'expense', ar: 'مصروفات أخرى', en: 'Other expenses' },
];

// The built-in categories, once per company (inside the current company). Written outside the plan check: they
// belong to every company. A custom category of the same name becomes the built-in one.
export async function ensureFinanceDefaults(tenant: number) {
  const have = new Set((await q<{ builtin_key: string }>('SELECT builtin_key FROM fin_categories WHERE builtin_key IS NOT NULL')).map((r) => r.builtin_key));
  for (const c of BUILTIN_CATEGORIES) {
    if (have.has(c.key)) continue;
    const same = await one<{ id: number }>('SELECT id FROM fin_categories WHERE kind = ? AND name_ar = ?', [c.kind, c.ar]);
    if (same) await exec('UPDATE fin_categories SET builtin_key = ? WHERE id = ?', [c.key, same.id]);
    else await asPlatform(() => exec('INSERT INTO fin_categories SET ?', [{ tenant_id: tenant, name_ar: c.ar, name_en: c.en, kind: c.kind, builtin_key: c.key }]));
  }
}
export async function categoryByKey(key: string) {
  return (await one<{ id: number }>('SELECT id FROM fin_categories WHERE builtin_key = ?', [key]))?.id ?? null;
}

// ---------- balances ----------
const LIVE = 'e.voided_at IS NULL';
export async function accounts(includeInactive = true) {
  return q<any>(`SELECT a.*, a.opening_balance + COALESCE((SELECT SUM(IF(e.direction = 'in', e.amount, -e.amount)) FROM fin_entries e WHERE e.account_id = a.id AND ${LIVE}), 0) balance
    FROM fin_accounts a ${includeInactive ? '' : 'WHERE a.is_active = 1'} ORDER BY a.is_active DESC, a.name`);
}
// The money-in, money-out and net of a month (YYYY-MM), transfers between own accounts left out.
export async function monthFlow(month: string) {
  const [r] = await q<{ inflow: string; outflow: string }>(`SELECT COALESCE(SUM(IF(e.direction = 'in', e.amount, 0)), 0) inflow, COALESCE(SUM(IF(e.direction = 'out', e.amount, 0)), 0) outflow
    FROM fin_entries e WHERE ${LIVE} AND e.transfer_group IS NULL AND e.entry_date >= ? AND e.entry_date < ?`, [`${month}-01`, addMonths(`${month}-01`, 1)]);
  const inflow = Number(r.inflow), outflow = Number(r.outflow);
  return { inflow, outflow, net: Math.round((inflow - outflow) * 100) / 100 };
}

// ---------- entries ----------
type EntryIn = { entry_date: string; direction: 'in' | 'out'; account_id: number; category_id?: number | null; supplier_id?: number | null; amount: number;
  description?: string | null; reference?: string | null; source_type?: string; source_id?: number | null; transfer_group?: string | null };
export async function checkEntry(v: EntryIn, today: string) {
  if (!(v.amount > 0)) fieldError('amount', 'too_small');
  if (v.entry_date > today) fieldError('entry_date', 'date_in_future');
  const acc = await one<{ is_active: number }>('SELECT is_active FROM fin_accounts WHERE id = ?', [v.account_id]);
  if (!acc) fieldError('account_id', 'invalid');
  if (!acc!.is_active) fieldError('account_id', 'account_inactive');
  if (v.category_id != null) {
    const c = await one<{ kind: string; is_active: number }>('SELECT kind, is_active FROM fin_categories WHERE id = ?', [v.category_id]);
    if (!c || !c.is_active) fieldError('category_id', 'invalid');
    if ((c!.kind === 'income') !== (v.direction === 'in')) fieldError('category_id', 'category_other_direction');
  }
  if (v.supplier_id != null && !(await one('SELECT 1 FROM fin_suppliers WHERE id = ? AND is_active = 1', [v.supplier_id]))) fieldError('supplier_id', 'invalid');
}
export async function createEntry(v: EntryIn, userId: number | null, today: string) {
  await checkEntry(v, today);
  return (await exec('INSERT INTO fin_entries SET ?', [{ source_type: 'manual', ...v, created_by: userId }])).insertId;
}
// Voiding keeps the entry (and its reason). An entry written by a payroll is undone by reopening the payroll; an
// obligation payment voided makes its due unpaid again; a transfer is voided as a pair.
export async function voidEntry(id: number | string, reason: string) {
  return tx(async () => {
    const e = await one<any>('SELECT * FROM fin_entries WHERE id = ? FOR UPDATE', [id]);
    if (!e) fail(404, 'not_found');
    if (e.voided_at) fail(409, 'entry_voided');
    if (e.source_type === 'payroll') fail(409, 'entry_from_payroll');
    const ids = e.transfer_group ? (await q<{ id: number }>('SELECT id FROM fin_entries WHERE transfer_group = ?', [e.transfer_group])).map((r) => r.id) : [e.id];
    await exec('UPDATE fin_entries SET voided_at = UTC_TIMESTAMP(), void_reason = ? WHERE id IN (?)', [reason, ids]);
    if (e.source_type === 'obligation_due') await exec("UPDATE fin_obligation_dues SET status = 'due', paid_on = NULL, entry_id = NULL WHERE entry_id = ?", [e.id]);
    return ids;
  });
}
export async function transfer(from: number, to: number, amount: number, date: string, note: string | null, userId: number | null, today: string) {
  if (from === to) fieldError('to_account_id', 'same_account');
  const group = randomBytes(8).toString('hex');
  const base = { entry_date: date, amount, description: note, source_type: 'transfer', transfer_group: group };
  await checkEntry({ ...base, direction: 'out', account_id: from }, today);
  await checkEntry({ ...base, direction: 'in', account_id: to }, today);
  return tx(async () => {
    await exec('INSERT INTO fin_entries SET ?', [{ ...base, direction: 'out', account_id: from, created_by: userId }]);
    await exec('INSERT INTO fin_entries SET ?', [{ ...base, direction: 'in', account_id: to, created_by: userId }]);
    return group;
  });
}

// ---------- obligations ----------
// Makes the payments due of every active obligation, up to a month from today.
export async function ensureDues(today: string) {
  const horizon = addDays(today, 31);
  for (const o of await q<any>("SELECT id, kind, amount, DATE_FORMAT(start_date, '%Y-%m-%d') start_date, DATE_FORMAT(end_date, '%Y-%m-%d') end_date FROM fin_obligations WHERE status = 'active'")) {
    const days: string[] = [];
    if (o.kind === 'once') days.push(o.start_date);
    else for (let d = o.start_date, n = 1; d <= horizon && (!o.end_date || d <= o.end_date) && n <= 600; d = addMonths(o.start_date, n++)) days.push(d);
    if (days.length) await exec('INSERT IGNORE INTO fin_obligation_dues (obligation_id, due_date, amount) VALUES ?', [days.map((d) => [o.id, d, o.amount])]);
  }
}
export async function payDue(dueId: number | string, p: { account_id: number; paid_on: string; reference?: string | null }, userId: number | null, today: string) {
  return tx(async () => {
    const d = await one<any>(`SELECT d.*, o.title, o.category_id, o.supplier_id FROM fin_obligation_dues d JOIN fin_obligations o ON o.id = d.obligation_id WHERE d.id = ? FOR UPDATE`, [dueId]);
    if (!d) fail(404, 'not_found');
    if (d.status !== 'due') fail(409, 'due_closed');
    const entry = await createEntry({ entry_date: p.paid_on, direction: 'out', account_id: p.account_id, category_id: d.category_id ?? (await categoryByKey('other_expense')),
      supplier_id: d.supplier_id, amount: Number(d.amount), description: d.title, reference: p.reference ?? null, source_type: 'obligation_due', source_id: d.id }, userId, today);
    await exec("UPDATE fin_obligation_dues SET status = 'paid', paid_on = ?, entry_id = ? WHERE id = ?", [p.paid_on, entry, d.id]);
    return entry;
  });
}
export async function dueSummary(today: string) {
  const [r] = await q<any>(`SELECT COALESCE(SUM(IF(due_date < ?, amount, 0)), 0) overdue, COALESCE(SUM(due_date < ?), 0) overdue_count,
      COALESCE(SUM(IF(due_date >= ? AND due_date <= ?, amount, 0)), 0) upcoming, COALESCE(SUM(due_date >= ? AND due_date <= ?), 0) upcoming_count
    FROM fin_obligation_dues WHERE status = 'due'`, [today, today, today, addDays(today, 30), today, addDays(today, 30)]);
  return { overdue: Number(r.overdue), overdue_count: Number(r.overdue_count), upcoming: Number(r.upcoming), upcoming_count: Number(r.upcoming_count) };
}

// ---------- stock ----------
export async function stockQuantity(itemId: number | string, lock = false) {
  if (lock) await one('SELECT id FROM fin_stock_items WHERE id = ? FOR UPDATE', [itemId]);
  const [r] = await q<{ qty: string }>("SELECT COALESCE(SUM(IF(direction = 'in', quantity, -quantity)), 0) qty FROM fin_stock_moves WHERE item_id = ?", [itemId]);
  return Number(r.qty);
}
export async function moveStock(v: { item_id: number; move_date: string; direction: 'in' | 'out'; quantity: number; unit_cost?: number | null; rider_id?: number | null; note?: string | null }, userId: number | null, today: string) {
  if (!(v.quantity > 0)) fieldError('quantity', 'too_small');
  if (v.move_date > today) fieldError('move_date', 'date_in_future');
  if (!(await one('SELECT 1 FROM fin_stock_items WHERE id = ? AND is_active = 1', [v.item_id]))) fieldError('item_id', 'invalid');
  if (v.rider_id != null && !(await one('SELECT 1 FROM riders WHERE id = ?', [v.rider_id]))) fieldError('rider_id', 'rider_not_found');
  return tx(async () => {
    const have = await stockQuantity(v.item_id, true);
    if (v.direction === 'out' && v.quantity > have + 1e-9) fieldError('quantity', 'not_enough_stock', { have });
    return (await exec('INSERT INTO fin_stock_moves SET ?', [{ ...v, created_by: userId }])).insertId;
  });
}

// ---------- the dashboard / setup ----------
export async function financeOverview(today: string) {
  await ensureDues(today);
  const acc = await accounts(false);
  const balance = Math.round(acc.reduce((s, a) => s + Number(a.balance), 0) * 100) / 100;
  const [{ categories }] = await q<{ categories: number }>('SELECT COUNT(*) categories FROM fin_categories WHERE is_active = 1');
  const [{ entries }] = await q<{ entries: number }>('SELECT COUNT(*) entries FROM fin_entries');
  return {
    balance, accounts: acc.length, flow: await monthFlow(today.slice(0, 7)), dues: await dueSummary(today),
    setup: { account: acc.length > 0, categories: Number(categories) > 0, entry: Number(entries) > 0 },
  };
}
