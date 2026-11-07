// Phase 6, payroll: salary rules, monthly sheets and their lines, defined once.
// - The rule for a rider is the most specific active one: branch and job title, then branch, then job title, then a
//   rule for everyone. A rider with no rule gets a line with nothing to pay, so nobody is left out silently.
// - A line: base salary + completed orders × per order + the bonus when the month's orders reach the target
//   + additions − open fines of the month − advance instalments due by the month's end − deductions.
// - Draft sheets follow the data (recalculate keeps the manual additions, deductions and notes). Finalizing locks a
//   sheet; an unpaid finalized sheet can be reopened. Paying needs the signed proof attached and an account: it
//   writes one money-out entry (Salaries), marks the fines deducted and repays the instalments it took.
import { exec, one, q, tx } from '../db.js';
import { addMonths, fail, fieldError } from '../http.js';
import { refresh as refreshAdvance } from '../routes/advances.js';
import { categoryByKey, createEntry } from './companyFinance.js';

type Rule = { id: number; branch_id: number | null; designation_id: number | null; base_salary: string; per_order: string; target_orders: number | null;
  target_bonus: string; deduct_fines: number; deduct_advances: number };
export function ruleFor(rider: { branch_id: number | null; designation_id: number | null }, rules: Rule[]) {
  const fits = (r: Rule) => (r.branch_id == null || r.branch_id === rider.branch_id) && (r.designation_id == null || r.designation_id === rider.designation_id);
  const score = (r: Rule) => (r.branch_id != null ? 2 : 0) + (r.designation_id != null ? 1 : 0);
  return rules.filter(fits).sort((a, b) => score(b) - score(a) || a.id - b.id)[0] ?? null;
}
const money = (n: number) => Math.round(n * 100) / 100;

export const periodRange = (period: string) => ({ start: `${period}-01`, end: addMonths(`${period}-01`, 1) }); // [start, end)

// The riders a sheet covers: working in the month (hired by its end, not gone before its start), in the branch.
async function sheetRiders(period: string, branchId: number | null) {
  const { start, end } = periodRange(period);
  return q<{ id: number; branch_id: number | null; designation_id: number | null }>(`SELECT id, branch_id, designation_id FROM riders
    WHERE (hire_date IS NULL OR hire_date < ?) AND (status <> 'terminated' OR exit_date >= ?) ${branchId ? 'AND branch_id = ?' : ''} ORDER BY id`,
    branchId ? [end, start, branchId] : [end, start]);
}

// Works out every line of a draft sheet from the month's data, keeping what was typed by hand.
export async function computeSheet(sheetId: number) {
  const s = await one<any>('SELECT * FROM payroll_sheets WHERE id = ?', [sheetId]);
  if (!s) fail(404, 'not_found');
  if (s.status !== 'draft') fail(409, 'sheet_locked');
  const { start, end } = periodRange(s.period);
  const rules = await q<Rule>('SELECT * FROM salary_rules WHERE is_active = 1');
  const riders = await sheetRiders(s.period, s.branch_id);
  const ids = riders.map((r) => r.id);
  const kept = new Map((await q<any>('SELECT rider_id, addition, deduction, note FROM payroll_lines WHERE sheet_id = ?', [sheetId])).map((l) => [Number(l.rider_id), l]));
  const sum = async (sql: string, params: unknown[]) => new Map((ids.length ? await q<{ rider_id: number; v: string }>(sql, params) : []).map((r) => [Number(r.rider_id), Number(r.v)]));
  const orders = await sum('SELECT rider_id, SUM(COALESCE(completed, 0)) v FROM daily_performance WHERE rider_id IN (?) AND work_date >= ? AND work_date < ? GROUP BY rider_id', [ids, start, end]);
  const fines = await sum("SELECT rider_id, SUM(amount) v FROM fines WHERE rider_id IN (?) AND status = 'open' AND fine_date >= ? AND fine_date < ? GROUP BY rider_id", [ids, start, end]);
  const advances = await sum(`SELECT a.rider_id, SUM(i.amount - i.paid) v FROM advance_installments i JOIN advances a ON a.id = i.advance_id
    WHERE a.rider_id IN (?) AND a.deduct_from = 'salary' AND a.status IN ('disbursed','repaying') AND i.status IN ('due','partial') AND i.due_date < ? GROUP BY a.rider_id`, [ids, end]);
  await tx(async () => {
    // lines keep their ids: a rider's line is updated in place; riders no longer covered lose theirs
    if (ids.length) await exec('DELETE FROM payroll_lines WHERE sheet_id = ? AND rider_id NOT IN (?)', [sheetId, ids]);
    else await exec('DELETE FROM payroll_lines WHERE sheet_id = ?', [sheetId]);
    let total = 0;
    for (const r of riders) {
      const rule = ruleFor(r, rules);
      const k = kept.get(Number(r.id));
      const n = Math.round(orders.get(Number(r.id)) ?? 0);
      const base = rule ? Number(rule.base_salary) : 0;
      const ordersPay = rule ? money(n * Number(rule.per_order)) : 0;
      const bonus = rule && rule.target_orders != null && n >= rule.target_orders ? Number(rule.target_bonus) : 0;
      const f = rule?.deduct_fines ? money(fines.get(Number(r.id)) ?? 0) : 0;
      const adv = rule?.deduct_advances ? money(advances.get(Number(r.id)) ?? 0) : 0;
      const addition = Number(k?.addition ?? 0), deduction = Number(k?.deduction ?? 0);
      const net = money(base + ordersPay + bonus + addition - f - adv - deduction);
      total += net;
      const row = { rule_id: rule?.id ?? null, orders: n, base, orders_pay: ordersPay, bonus, addition, fines: f, advances: adv, deduction, net, note: k?.note ?? null };
      if (k) await exec('UPDATE payroll_lines SET ? WHERE sheet_id = ? AND rider_id = ?', [row, sheetId, r.id]);
      else await exec('INSERT INTO payroll_lines SET ?', [{ ...row, sheet_id: sheetId, rider_id: r.id }]);
    }
    await exec('UPDATE payroll_sheets SET total_net = ?, riders = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [money(total), riders.length, sheetId]);
  });
}

export async function createSheet(period: string, branchId: number | null, userId: number | null) {
  if (branchId != null && !(await one('SELECT 1 FROM branches WHERE id = ?', [branchId]))) fieldError('branch_id', 'invalid');
  const id = await tx(async () => {
    // one sheet per month and branch (or all branches); a sheet for all branches and one per branch cannot overlap
    const clash = await one<{ id: number }>(`SELECT id FROM payroll_sheets WHERE period = ? AND (branch_id <=> ? OR branch_id IS NULL OR ? IS NULL) LIMIT 1 FOR UPDATE`, [period, branchId, branchId]);
    if (clash) fail(409, 'sheet_exists', { id: clash.id });
    return (await exec('INSERT INTO payroll_sheets SET ?', [{ period, branch_id: branchId, created_by: userId }])).insertId;
  });
  await computeSheet(id);
  return id;
}

export async function editLine(lineId: number | string, v: { addition?: number; deduction?: number; note?: string | null }) {
  return tx(async () => {
    const l = await one<any>('SELECT l.*, s.status FROM payroll_lines l JOIN payroll_sheets s ON s.id = l.sheet_id WHERE l.id = ?', [lineId]);
    if (!l) fail(404, 'not_found');
    if (l.status !== 'draft') fail(409, 'sheet_locked');
    const addition = v.addition ?? Number(l.addition), deduction = v.deduction ?? Number(l.deduction);
    const net = money(Number(l.base) + Number(l.orders_pay) + Number(l.bonus) + addition - Number(l.fines) - Number(l.advances) - deduction);
    await exec('UPDATE payroll_lines SET addition = ?, deduction = ?, note = ?, net = ? WHERE id = ?', [addition, deduction, v.note !== undefined ? v.note : l.note, net, l.id]);
    await exec('UPDATE payroll_sheets SET total_net = (SELECT COALESCE(SUM(net), 0) FROM payroll_lines WHERE sheet_id = ?), updated_at = UTC_TIMESTAMP() WHERE id = ?', [l.sheet_id, l.sheet_id]);
  });
}

async function lockSheet(id: number | string) {
  const s = await one<any>('SELECT * FROM payroll_sheets WHERE id = ? FOR UPDATE', [id]);
  if (!s) fail(404, 'not_found');
  return s;
}
export async function finalizeSheet(id: number | string, userId: number | null) {
  return tx(async () => {
    const s = await lockSheet(id);
    if (s.status !== 'draft') fail(409, 'sheet_not_draft');
    if (!s.riders) fail(409, 'sheet_empty');
    await exec("UPDATE payroll_sheets SET status = 'finalized', finalized_at = UTC_TIMESTAMP(), finalized_by = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?", [userId, id]);
  });
}
export async function reopenSheet(id: number | string) {
  return tx(async () => {
    const s = await lockSheet(id);
    if (s.status !== 'finalized') fail(409, s.status === 'paid' ? 'sheet_paid' : 'sheet_not_finalized');
    await exec("UPDATE payroll_sheets SET status = 'draft', finalized_at = NULL, finalized_by = NULL, updated_at = UTC_TIMESTAMP() WHERE id = ?", [id]);
  });
}

export async function paySheet(id: number | string, p: { account_id: number; paid_on: string }, userId: number | null, today: string) {
  return tx(async () => {
    const s = await lockSheet(id);
    if (s.status !== 'finalized') fail(409, s.status === 'paid' ? 'sheet_paid' : 'sheet_not_finalized');
    if (!(await one("SELECT 1 FROM attachments WHERE entity_type = 'payroll_sheet' AND entity_id = ? AND attachment_type = 'proof'", [String(s.id)]))) fail(409, 'proof_required');
    const { start, end } = periodRange(s.period);
    let entry: number | null = null;
    if (Number(s.total_net) > 0) {
      entry = await createEntry({ entry_date: p.paid_on, direction: 'out', account_id: p.account_id, category_id: await categoryByKey('salaries'), amount: Number(s.total_net),
        description: `payroll ${s.period}`, source_type: 'payroll', source_id: s.id }, userId, today);
    }
    // what the sheet took: the month's open fines, and the due instalments, oldest first
    for (const l of await q<any>('SELECT rider_id, fines, advances FROM payroll_lines WHERE sheet_id = ? AND (fines > 0 OR advances > 0)', [s.id])) {
      if (Number(l.fines) > 0) await exec("UPDATE fines SET status = 'deducted', updated_at = UTC_TIMESTAMP() WHERE rider_id = ? AND status = 'open' AND fine_date >= ? AND fine_date < ?", [l.rider_id, start, end]);
      let left = Number(l.advances);
      const touched = new Set<number>();
      for (const i of await q<any>(`SELECT i.id, i.advance_id, i.amount, i.paid FROM advance_installments i JOIN advances a ON a.id = i.advance_id
          WHERE a.rider_id = ? AND a.deduct_from = 'salary' AND a.status IN ('disbursed','repaying') AND i.status IN ('due','partial') AND i.due_date < ? ORDER BY i.due_date, i.id`, [l.rider_id, end])) {
        if (left <= 0) break;
        const take = Math.min(left, money(Number(i.amount) - Number(i.paid)));
        const paid = money(Number(i.paid) + take);
        await exec('UPDATE advance_installments SET paid = ?, status = ?, paid_on = ?, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?',
          [paid, paid >= Number(i.amount) ? 'paid' : 'partial', p.paid_on, userId, i.id]);
        left = money(left - take);
        touched.add(Number(i.advance_id));
      }
      for (const a of touched) await refreshAdvance(a);
    }
    await exec("UPDATE payroll_sheets SET status = 'paid', paid_on = ?, paid_by = ?, account_id = ?, entry_id = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?", [p.paid_on, userId, p.account_id, entry, s.id]);
    return entry;
  });
}

// A rider's settlement statement: what they were paid, what they still owe (advances, fines), and what they hold.
export async function settlement(riderId: number | string) {
  const rider = await one<any>(`SELECT r.id, r.full_name, r.name_en, r.national_id, r.phone, r.hire_date, r.status, r.exit_date, r.exit_reason, r.exit_clearance, r.exit_note,
      br.name_ar branch_ar, br.name_en branch_en FROM riders r LEFT JOIN branches br ON br.id = r.branch_id WHERE r.id = ?`, [riderId]);
  if (!rider) fail(404, 'rider_not_found');
  const payroll = await q(`SELECT s.period, s.status, l.orders, l.base, l.orders_pay, l.bonus, l.addition, l.fines, l.advances, l.deduction, l.net
    FROM payroll_lines l JOIN payroll_sheets s ON s.id = l.sheet_id WHERE l.rider_id = ? ORDER BY s.period DESC LIMIT 12`, [riderId]);
  const advances = await q(`SELECT a.number, a.amount, a.status, COALESCE(SUM(i.amount - i.paid), 0) remaining FROM advances a LEFT JOIN advance_installments i ON i.advance_id = a.id AND i.status IN ('due','partial')
    WHERE a.rider_id = ? AND a.status IN ('disbursed','repaying') GROUP BY a.id ORDER BY a.id`, [riderId]);
  const fines = await q("SELECT fine_date, category, amount, status FROM fines WHERE rider_id = ? AND status IN ('open','disputed') ORDER BY fine_date", [riderId]);
  const vehicles = await q('SELECT v.plate, a.start_date FROM vehicle_assignments a JOIN vehicles v ON v.id = a.vehicle_id WHERE a.rider_id = ? AND a.is_current = 1', [riderId]);
  const ids = await q("SELECT p.id_number, co.name platform FROM platform_ids p JOIN companies co ON co.id = p.company_id WHERE p.worker_rider_id = ? OR p.owner_rider_id = ?", [riderId, riderId]);
  const owed = money(advances.reduce((s: number, a: any) => s + Number(a.remaining), 0) + fines.reduce((s: number, f: any) => s + Number(f.amount), 0));
  return { rider, payroll, advances, fines, vehicles, platform_ids: ids, owed };
}
