import { Router, type Request } from 'express';
import { exec, one, q, settingInt, setting, tx } from '../db.js';
import { addDays, addMonths, clean, eq, fail, fieldError, inList, list, listAll, sendExport, today, where, type Query, type Spec } from '../http.js';
import { can } from '../auth.js';
import { audit } from '../audit.js';
import { notifyRider } from '../notify.js';

// 3.3 Advances: request → approval → payout (the schedule is created) → monthly instalments.
export const advancesRouter = Router();

const OPEN = "('pending','approved','disbursed','repaying')";
const SUMS = `(SELECT COALESCE(SUM(paid),0) FROM advance_installments WHERE advance_id = a.id) repaid,
  (SELECT COALESCE(SUM(amount - paid),0) FROM advance_installments WHERE advance_id = a.id AND status IN ('due','partial')) outstanding,
  (SELECT COUNT(*) FROM advance_installments WHERE advance_id = a.id AND status IN ('paid','waived')) inst_done,
  (SELECT COUNT(*) FROM advance_installments WHERE advance_id = a.id AND status IN ('due','partial') AND due_date < '{d}') overdue,
  (SELECT COALESCE(SUM(amount - paid),0) FROM advance_installments WHERE advance_id = a.id AND status IN ('due','partial') AND due_date < '{d}') overdue_value,
  (SELECT MIN(due_date) FROM advance_installments WHERE advance_id = a.id AND status IN ('due','partial')) next_due`;
const spec = (day: string): Spec => ({
  from: 'FROM advances a JOIN riders r ON r.id = a.rider_id LEFT JOIN companies co ON co.id = r.company_id',
  select: `a.*, r.full_name, r.national_id, co.name company_name, ${SUMS.replaceAll('{d}', day)}`,
  search: ['a.number', 'r.full_name', 'r.national_id', 'CAST(r.id AS CHAR)'],
  filters: {
    status: inList('a.status'), company: eq('r.company_id'), rider: eq('a.rider_id'),
    overdue: () => `EXISTS (SELECT 1 FROM advance_installments i WHERE i.advance_id = a.id AND i.status IN ('due','partial') AND i.due_date < '${day}')`,
    from: (v) => ['a.request_date >= ?', [v]], to: (v) => ['a.request_date <= ?', [v]],
  },
  sorts: { number: 'a.seq_year, a.seq', rider: 'r.full_name', amount: 'a.amount', status: 'a.status', date: 'a.request_date, a.id' },
  defaultSort: '-date',
});

advancesRouter.get('/advances', can('advances.view'), async (req, res) => {
  const day = await today();
  const s = spec(day);
  const query = req.query as Query;
  const w = where(s, query);
  const [stats] = await q(`SELECT COUNT(*) advances, COALESCE(SUM(amount),0) amount, COALESCE(SUM(status = 'pending'),0) pending,
    COALESCE(SUM(status = 'approved'),0) approved, COALESCE(SUM(status IN ('disbursed','repaying')),0) disbursed,
    COALESCE(SUM(repaid),0) repaid, COALESCE(SUM(outstanding),0) outstanding, COALESCE(SUM(overdue),0) overdue, COALESCE(SUM(overdue_value),0) overdue_value
    FROM (SELECT ${s.select} ${s.from}${w.sql}) t`, w.params);
  res.json({ ...(await list(s, query)), stats });
});

advancesRouter.get('/advances/export', can('advances.export'), async (req, res) => {
  const rows = await listAll(spec(await today()), req.query as Query);
  await sendExport(req, res, { format: 'csv', title: 'adv.title', rows, cols: [
    { key: 'number', label: 'adv.number' }, { key: 'request_date', label: 'adv.request_date' }, { key: 'rider_id', label: 'riders.rider_id' },
    { key: 'full_name', label: 'adv.rider' }, { key: 'national_id', label: 'riders.national_id' }, { key: 'company_name', label: 'adv.company' },
    { key: 'amount', label: 'adv.amount' }, { key: 'repaid', label: 'adv.repaid' }, { key: 'outstanding', label: 'adv.outstanding' },
    { key: 'installments', label: 'adv.installments' }, { key: 'inst_done', label: 'adv.inst_done' }, { key: 'overdue', label: 'adv.overdue' },
    { key: 'next_due', label: 'adv.next_due' }, { key: 'status', label: 'adv.status' }, { key: 'deduct_from', label: 'adv.deduct_from' },
  ] });
});

// ---------- instalments due: the collection list (before /advances/:id) ----------
const dueSpec = (day: string, horizon: string): Spec => ({
  from: `FROM advance_installments i JOIN advances a ON a.id = i.advance_id JOIN riders r ON r.id = a.rider_id LEFT JOIN companies co ON co.id = r.company_id`,
  select: `i.*, a.number, a.installments, a.rider_id, r.full_name, co.name company_name, DATEDIFF(i.due_date, '${day}') days_left`,
  search: ['a.number', 'r.full_name', 'CAST(r.id AS CHAR)'],
  filters: {
    // overdue instalments always appear, whatever the window
    open: () => `i.status IN ('due','partial') AND i.due_date <= '${horizon}'`,
    overdue: () => `i.due_date < '${day}'`, company: eq('r.company_id'), rider: eq('a.rider_id'),
  },
  sorts: { due: 'i.due_date, i.id' }, defaultSort: 'due',
});
const horizonOf = (day: string, w: unknown) => addDays(day, [30, 60, 90, 365].includes(Number(w)) ? Number(w) : 30);

advancesRouter.get('/advances/due', can('advance_installments.view'), async (req, res) => {
  const day = await today();
  const query: Query = { ...(req.query as Query), open: '1' };
  const s = dueSpec(day, horizonOf(day, query.window));
  const w = where(s, query);
  const [stats] = await q(`SELECT COUNT(*) open, COALESCE(SUM(i.amount - i.paid),0) owed, COALESCE(SUM(i.due_date < ?),0) overdue,
    COALESCE(SUM(CASE WHEN i.due_date < ? THEN i.amount - i.paid END),0) overdue_value ${s.from}${w.sql}`, [day, day, ...w.params]);
  res.json({ ...(await list(s, query)), stats });
});
advancesRouter.get('/advances/due/export', can('advance_installments.export'), async (req, res) => {
  const day = await today();
  const query: Query = { ...(req.query as Query), open: '1' };
  await sendExport(req, res, { format: 'csv', title: 'adv.due_title', rows: await listAll(dueSpec(day, horizonOf(day, query.window)), query), cols: [
    { key: 'due_date', label: 'adv.due' }, { key: 'rider_id', label: 'riders.rider_id' }, { key: 'full_name', label: 'adv.rider' }, { key: 'company_name', label: 'adv.company' },
    { key: 'number', label: 'adv.advance' }, { key: 'n', label: 'adv.inst_no' }, { key: 'amount', label: 'adv.amount' }, { key: 'paid', label: 'adv.repaid' },
    { key: 'status', label: 'adv.status' },
  ] });
});

// ---------- one advance ----------
async function getAdvance(id: unknown) {
  const day = await today();
  const s = spec(day);
  const a = await one<any>(`SELECT ${s.select}, r.phone, r.status rider_status, ud.full_name decided_by_name, up.full_name disbursed_by_name, uc.full_name created_by_name
    ${s.from} LEFT JOIN users ud ON ud.id = a.decided_by LEFT JOIN users up ON up.id = a.disbursed_by LEFT JOIN users uc ON uc.id = a.created_by WHERE a.id = ?`, [id]);
  if (!a) fail(404, 'not_found');
  return a;
}
advancesRouter.get('/advances/:id', can('advances.view'), async (req, res) => {
  const a = await getAdvance(req.params.id);
  const day = await today();
  const installments = await q(`SELECT i.*, DATEDIFF(i.due_date, ?) days_left, u.full_name updated_by_name FROM advance_installments i
    LEFT JOIN users u ON u.id = i.updated_by WHERE i.advance_id = ? ORDER BY i.n`, [day, a.id]);
  res.json({ ...a, installments_list: installments, requires_approval: (await setting('advance.requires_approval')) !== '0' });
});

advancesRouter.post('/advances', can('advances.create'), async (req, res) => {
  const v = clean(req.body, {
    rider_id: { req: true, type: 'int' }, amount: { req: true, type: 'num', min: 0.01 }, installments: { type: 'int', min: 1 },
    request_date: { type: 'date' }, first_due: { type: 'date' }, deduct_from: { enum: ['salary', 'commission', 'wallet', 'other'] },
    reason: { max: 500 }, notes: { max: 500 },
  });
  v.installments ??= 1;
  v.request_date ??= await today();
  const max = await settingInt('advance.max_amount', 5000);
  if (v.amount > max) fieldError('amount', 'advance_over_max', { max });
  const maxN = await settingInt('advance.max_installments', 12);
  if (v.installments > maxN) fieldError('installments', 'too_many_installments', { max: maxN });
  const r = await one<any>('SELECT status FROM riders WHERE id = ?', [v.rider_id]);
  if (!r) fieldError('rider_id', 'rider_not_found');
  const [{ n: open }] = await q<any>(`SELECT COUNT(*) n FROM advances WHERE rider_id = ? AND status IN ${OPEN}`, [v.rider_id]);
  const allowed = await settingInt('advance.max_open_per_rider', 1);
  if (open >= allowed) fieldError('rider_id', 'advance_open_exists', { n: allowed });
  const year = Number(v.request_date.slice(0, 4));
  const out = await tx(async () => {
    await q('SELECT pg_advisory_xact_lock(41001, ?::int)', [year]);
    const [{ n }] = await q<any>('SELECT COALESCE(MAX(seq), 0) + 1 n FROM advances WHERE seq_year = ?', [year]);
    const number = `ADV-${year}-${String(n).padStart(4, '0')}`;
    const ins = await exec('INSERT INTO advances SET ?', [{ ...v, seq_year: year, seq: n, number, created_by: req.user!.id }]);
    return { id: ins.insertId, number };
  });
  await audit(req, { action: 'advance.create', entity_type: 'advance', entity_id: out.id, after: { ...v, number: out.number } });
  res.json(out);
});

// Every step: only from the status that allows it.
async function step(req: Request, from: string[], fn: (a: any) => Promise<void>) {
  const a = await one<any>('SELECT * FROM advances WHERE id = ?', [req.params.id]);
  if (!a) fail(404, 'not_found');
  if (!from.includes(a.status)) fail(409, 'advance_wrong_status', { status: a.status });
  await tx(() => fn(a));
  return a;
}
const decided = (req: Request, status: string, note: string | null) =>
  ['UPDATE advances SET status = ?, decided_by = ?, decided_at = UTC_TIMESTAMP(), decision_note = ? WHERE id = ?', [status, req.user!.id, note]] as const;

advancesRouter.post('/advances/:id/approve', can('advances.approve'), async (req, res) => {
  const a = await step(req, ['pending'], async (x) => { const [sql, p] = decided(req, 'approved', null); await exec(sql, [...p, x.id]); });
  await audit(req, { action: 'advance.approve', entity_type: 'advance', entity_id: a.id });
  await notifyRider(a.rider_id, { category: 'advance_status', severity: 'info', title: 'note.advance_approved', params: { number: a.number, amount: a.amount }, entity_type: 'advance', entity_id: a.id });
  res.json({ ok: true });
});
advancesRouter.post('/advances/:id/reject', can('advances.reject'), async (req, res) => {
  const v = clean(req.body, { reason: { max: 500 } });
  const a = await step(req, ['pending'], async (x) => { const [sql, p] = decided(req, 'rejected', v.reason ?? null); await exec(sql, [...p, x.id]); });
  await audit(req, { action: 'advance.reject', entity_type: 'advance', entity_id: a.id, details: v.reason });
  await notifyRider(a.rider_id, { category: 'advance_status', severity: 'warning', title: 'note.advance_rejected', body: v.reason ? 'note.reason_x' : undefined, params: { number: a.number, reason: v.reason }, entity_type: 'advance', entity_id: a.id });
  res.json({ ok: true });
});
advancesRouter.post('/advances/:id/cancel', can('advances.cancel'), async (req, res) => {
  const v = clean(req.body, { reason: { max: 500 } });
  const a = await step(req, ['pending', 'approved'], async (x) => { const [sql, p] = decided(req, 'cancelled', v.reason ?? null); await exec(sql, [...p, x.id]); });
  await audit(req, { action: 'advance.cancel', entity_type: 'advance', entity_id: a.id, details: v.reason, severity: 'warning' });
  res.json({ ok: true });
});

// The amount is split across the instalments; the remainder goes on the last one so they add up exactly.
// Each date is counted from the same anchor, so a 31st stays the month's last day instead of drifting to the 28th.
export function schedule(amount: number, n: number, anchor: string, offset: number) {
  const cents = Math.round(amount * 100);
  const base = Math.floor(cents / n);
  return Array.from({ length: n }, (_, i) => ({ n: i + 1, due_date: addMonths(anchor, i + offset), amount: (i === n - 1 ? cents - base * (n - 1) : base) / 100 }));
}

advancesRouter.post('/advances/:id/disburse', can('advances.disburse'), async (req, res) => {
  const v = clean(req.body, { method: { enum: ['cash', 'bank', 'wallet', 'other'] }, date: { type: 'date' } });
  const from = (await setting('advance.requires_approval')) === '0' ? ['pending', 'approved'] : ['approved'];
  const date = v.date ?? (await today());
  const a = await step(req, from, async (x) => {
    await exec("UPDATE advances SET status = 'disbursed', payout_method = ?, disbursed_on = ?, disbursed_by = ? WHERE id = ?", [v.method ?? 'cash', date, req.user!.id, x.id]);
    // without a first due date, the first instalment is one month after payout
    const plan = x.first_due ? schedule(Number(x.amount), x.installments, x.first_due, 0) : schedule(Number(x.amount), x.installments, date, 1);
    await exec('INSERT INTO advance_installments (advance_id, n, due_date, amount) VALUES ?', [plan.map((s) => [x.id, s.n, s.due_date, s.amount])]);
  });
  await audit(req, { action: 'advance.disburse', entity_type: 'advance', entity_id: a.id, after: { method: v.method ?? 'cash', date } });
  res.json({ ok: true });
});

// The advance follows its instalments: "repaying" after the first repayment or waiver, "settled" when all are done.
async function refresh(advanceId: number) {
  const [s] = await q<any>(`SELECT COUNT(*) total, SUM(status IN ('paid','waived')) done, SUM(paid > 0 OR status = 'waived') touched FROM advance_installments WHERE advance_id = ?`, [advanceId]);
  const status = Number(s.done) === Number(s.total) ? 'settled' : Number(s.touched) > 0 ? 'repaying' : 'disbursed';
  await exec("UPDATE advances SET status = ? WHERE id = ? AND status IN ('disbursed','repaying','settled')", [status, advanceId]);
}
async function openInstallment(id: unknown) {
  const i = await one<any>('SELECT i.*, a.number, a.rider_id FROM advance_installments i JOIN advances a ON a.id = i.advance_id WHERE i.id = ?', [id]);
  if (!i) fail(404, 'not_found');
  if (!['due', 'partial'].includes(i.status)) fail(409, 'installment_closed');
  return i;
}
advancesRouter.post('/advance-installments/:id/repay', can('advance_installments.repay'), async (req, res) => {
  const v = clean(req.body, { amount: { type: 'num', min: 0.01 }, date: { type: 'date' } });
  const i = await openInstallment(req.params.id);
  const left = Math.round((Number(i.amount) - Number(i.paid)) * 100) / 100;
  const amount = v.amount ?? left; // empty settles the whole remainder
  if (amount > left + 0.001) fieldError('amount', 'repay_over_remaining', { left });
  const paid = Math.round((Number(i.paid) + amount) * 100) / 100;
  await tx(async () => {
    await exec('UPDATE advance_installments SET paid = ?, status = ?, paid_on = ?, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?',
      [paid, paid >= Number(i.amount) ? 'paid' : 'partial', v.date ?? (await today()), req.user!.id, i.id]);
    await refresh(i.advance_id);
  });
  await audit(req, { action: 'advance_installment.repay', entity_type: 'advance', entity_id: i.advance_id, details: `#${i.n}: ${amount}` });
  res.json({ ok: true });
});
advancesRouter.post('/advance-installments/:id/waive', can('advance_installments.waive'), async (req, res) => {
  const v = clean(req.body, { reason: { max: 300 } });
  const i = await openInstallment(req.params.id);
  await tx(async () => {
    await exec("UPDATE advance_installments SET status = 'waived', waive_reason = ?, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?", [v.reason ?? null, req.user!.id, i.id]);
    await refresh(i.advance_id);
  });
  await audit(req, { action: 'advance_installment.waive', entity_type: 'advance', entity_id: i.advance_id, details: `#${i.n}: ${v.reason ?? ''}`, severity: 'warning' });
  res.json({ ok: true });
});
