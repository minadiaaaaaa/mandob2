import { Router } from 'express';
import { exec, one, q } from '../db.js';
import { addDays, clean, fail, langOf, latinDigits, list, listAll, sendExport, today, tr, where, type Query, type Spec } from '../http.js';
import { can } from '../auth.js';
import { audit } from '../audit.js';
import { cellDate, cellNum, cellStr, importRoutes, type Ctx, type ImportDef, type Parsed } from '../importer.js';

// Chapter 8: fines, wallet and monthly billing — the delivery company's figures, read-only except a fine's status.
export const financeRouter = Router();

// Digits only match the rider id exactly; anything else searches names and the given columns.
const riderSearch = (cols: string[]) => (term: string): [string, unknown[]] =>
  /^\d+$/.test(term) ? ['r.id = ?', [Number(term)]] : [`(${['r.full_name', 'r.alias', ...cols].map((c) => `${c} LIKE ?`).join(' OR ')})`, Array(cols.length + 2).fill(`%${term}%`)];

// Riders the import does not know: left out unless "create them" is on (temporary name, note to complete).
async function riderKnown(id: number, ctx: Ctx) {
  const key = `rider:${id}`;
  if (!ctx.cache.has(key)) ctx.cache.set(key, !!(await one('SELECT 1 FROM riders WHERE id = ?', [id])));
  return ctx.cache.get(key) as boolean;
}
async function ensureRider(id: number, ctx: Ctx) {
  if (await riderKnown(id, ctx)) return true;
  if (!ctx.options.create_riders) return false;
  await exec("INSERT IGNORE INTO riders (id, full_name, status, notes) VALUES (?, ?, 'active', ?)", [id, `Rider ${id}`, 'Created by a finance import — complete the details.']);
  ctx.cache.set(`rider:${id}`, true);
  ctx.result.new_riders = (ctx.result.new_riders ?? 0) + 1;
  return true;
}
const riderIdOf = (v: unknown) => { const s = cellStr(v); return s && /^\d{1,20}$/.test(s) ? Number(s) : null; };
async function unknownRiders(items: Parsed[]): Promise<Record<string, number>> {
  const ids = [...new Set(items.map((i) => i.data.rider_id))];
  if (!ids.length) return { unknown_riders: 0 };
  const known = new Set((await q<any>('SELECT id FROM riders WHERE id IN (?)', [ids])).map((r) => r.id));
  return { unknown_riders: ids.filter((id) => !known.has(id)).length };
}

// ======================================================================== 8.1 fines
const fineSpec: Spec = {
  from: 'FROM fines f JOIN riders r ON r.id = f.rider_id',
  select: 'f.*, r.full_name',
  search: [riderSearch(['f.category', 'f.invoice_no', 'f.company'])],
  filters: {
    status: (v) => ['f.status = ?', [v]], category: (v) => ['f.category = ?', [v]],
    from: (v) => ['f.fine_date >= ?', [v]], to: (v) => ['f.fine_date <= ?', [v]],
    amount_min: (v) => ['f.amount >= ?', [Number(latinDigits(v))]], amount_max: (v) => ['f.amount <= ?', [Number(latinDigits(v))]],
    rider: (v) => ['f.rider_id = ?', [v]],
  },
  sorts: { date: 'f.fine_date, f.id', rider: 'r.full_name', category: 'f.category', amount: 'f.amount', status: 'f.status' },
  defaultSort: '-date',
};

financeRouter.get('/finance/fines', can('finance.view'), async (req, res) => {
  const query = req.query as Query;
  // the cards and the charts follow the date, status and category — not the amount fields or the search
  const w = where(fineSpec, query, ['search', 'amount_min', 'amount_max']);
  const [stats] = await q(`SELECT COALESCE(SUM(f.amount),0) total, COUNT(*) n ${fineSpec.from}${w.sql}`, w.params);
  const day = await today();
  const [{ month }] = await q<any>('SELECT COALESCE(SUM(amount),0) month FROM fines WHERE fine_date >= ?', [`${day.slice(0, 7)}-01`]);
  const top = await one(`SELECT r.full_name, SUM(f.amount) total ${fineSpec.from}${w.sql} GROUP BY f.rider_id, r.full_name ORDER BY total DESC LIMIT 1`, w.params);
  const months = await q(`SELECT DATE_FORMAT(f.fine_date, '%Y-%m') m, SUM(f.amount) total ${fineSpec.from}${w.sql} GROUP BY m ORDER BY m DESC LIMIT 12`, w.params);
  const categories = await q(`SELECT f.category, SUM(f.amount) total ${fineSpec.from}${w.sql} GROUP BY f.category ORDER BY total DESC LIMIT 6`, w.params);
  res.json({ ...(await list(fineSpec, query)), stats: { ...stats, month, top: top ?? null }, charts: { months: months.reverse(), categories } });
});
financeRouter.get('/finance/fines/categories', can('finance.view'), async (_req, res) =>
  res.json((await q<any>('SELECT DISTINCT category FROM fines ORDER BY category')).map((r) => r.category)));

financeRouter.get('/finance/fines/export', can('finance.view'), async (req, res) => {
  const query = req.query as Query;
  const rows = await listAll(fineSpec, query);
  const lang = await langOf(req);
  // the files say "Outstanding" and "Dropped" where the screen says "Open" and "Waived"
  const word: Record<string, string> = { open: 'fin.x.outstanding', disputed: 'fin.st.disputed', waived: 'fin.x.dropped', deducted: 'fin.st.deducted' };
  await sendExport(req, res, {
    format: query.format === 'csv' ? 'csv' : 'xlsx', title: 'fin.fines_title', rows,
    filters: [query.from && `${tr(lang, 'common.from')}: ${query.from}`, query.to && `${tr(lang, 'common.to')}: ${query.to}`].filter(Boolean).join('   '),
    summary: [['export.records', rows.length], ['fin.riders', new Set(rows.map((r: any) => r.rider_id)).size], ['fin.total', rows.reduce((s: number, r: any) => s + Number(r.amount), 0).toFixed(2)]],
    cols: [
      { key: 'fine_date', label: 'fin.date' }, { key: 'rider_id', label: 'riders.rider_id' }, { key: 'full_name', label: 'fin.rider' }, { key: 'invoice_no', label: 'fin.invoice' },
      { key: 'company', label: 'fin.authority' }, { key: 'category', label: 'fin.category' }, { key: 'amount', label: 'fin.amount' }, { key: 'currency', label: 'fin.currency' },
      { key: 'status', label: 'fin.status', value: (r) => tr(lang, word[r.status]) }, { key: 'internal_note', label: 'fin.internal_note' },
    ],
  });
});

financeRouter.patch('/finance/fines/:id', can('finance.manage'), async (req, res) => {
  const before = await one<any>('SELECT * FROM fines WHERE id = ?', [req.params.id]);
  if (!before) fail(404, 'not_found');
  const v = clean(req.body, { status: { enum: ['open', 'disputed', 'waived', 'deducted'] }, amount: { type: 'num' }, internal_note: { max: 500 } }, true);
  if (v.amount === null) delete v.amount; // empty keeps the amount as it is
  try {
    await exec('UPDATE fines SET ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [v, before.id]);
  } catch (e: any) {
    if (e?.code === 'ER_DUP_ENTRY') fail(409, 'fine_would_duplicate');
    throw e;
  }
  await audit(req, { action: 'fine.update', entity_type: 'fine', entity_id: before.id, before, after: v, severity: v.status && v.status !== before.status ? 'warning' : 'info' });
  res.json({ ok: true });
});
financeRouter.delete('/finance/fines/:id', can('finance.manage'), async (req, res) => {
  const f = await one('SELECT * FROM fines WHERE id = ?', [req.params.id]);
  if (!f) fail(404, 'not_found');
  await exec('DELETE FROM fines WHERE id = ?', [req.params.id]);
  await audit(req, { action: 'fine.delete', entity_type: 'fine', entity_id: req.params.id as string, before: f, severity: 'warning' });
  res.json({ ok: true });
});

const FINE_STATUS: Record<string, string> = { open: 'open', outstanding: 'open', disputed: 'disputed', waived: 'waived', dropped: 'waived', deducted: 'deducted' };
const fineImport: ImportDef = {
  name: 'fines', perm: 'finance.import', matchOn: 'fin.match_fine', options: ['create_riders'], maxRows: 20000,
  columns: {
    rider_id: ['riders.rider_id', 'rider id', 'rider_id', 'riderid'], date: ['fin.date', 'date', 'fine date', 'violation date'],
    category: ['fin.category', 'category', 'violation', 'reason'], amount: ['fin.amount', 'amount', 'fine amount', 'value'],
    invoice_no: ['fin.invoice', 'invoice number', 'invoice_no', 'invoice'], company: ['fin.authority', 'company', 'authority'],
    currency: ['fin.currency', 'currency'], status: ['fin.status', 'status'], internal_note: ['fin.internal_note', 'internal note', 'note'],
  },
  requiredColumns: [['rider_id'], ['date'], ['category'], ['amount']],
  async parse(row) {
    const rider_id = riderIdOf(row.rider_id);
    if (!rider_id) return 'no_rider_id';
    const date = cellDate(row.date);
    if (!date) return 'bad_date';
    const amount = cellNum(row.amount);
    if (amount == null) return 'bad_amount';
    const category = cellStr(row.category, 255) ?? '';
    const invoice_no = cellStr(row.invoice_no, 60) ?? '';
    const data = { rider_id, fine_date: date, invoice_no, category, amount: Math.round(amount * 100) / 100, company: cellStr(row.company, 150),
      currency: (cellStr(row.currency, 3) ?? 'SAR').toUpperCase(), status: FINE_STATUS[cellStr(row.status)?.toLowerCase() ?? ''] ?? 'open', internal_note: cellStr(row.internal_note, 500) };
    return { line: 0, key: `${rider_id}|${date}|${invoice_no}|${category}|${data.amount}`, data, label: `#${rider_id} ${date} ${data.amount}` };
  },
  async existing(items) {
    const m = new Map<string, any>();
    for (const i of items) {
      const f = await one('SELECT id FROM fines WHERE rider_id = ? AND fine_date = ? AND invoice_no = ? AND category = ? AND amount = ?',
        [i.data.rider_id, i.data.fine_date, i.data.invoice_no, i.data.category, i.data.amount]);
      if (f) m.set(i.key, f);
    }
    return m;
  },
  counts: (items) => unknownRiders(items),
  async write(it, ex, ctx) {
    if (ex) {
      if (ctx.mode === 'skip') return 'skipped';
      // only the company and the currency are updated; the status and the note are the office's
      await exec('UPDATE fines SET company = COALESCE(?, company), currency = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [it.data.company, it.data.currency, ex.id]);
      return 'replaced';
    }
    if (!(await ensureRider(it.data.rider_id, ctx))) return 'skipped';
    await exec('INSERT INTO fines SET ?', [it.data]);
    return 'inserted';
  },
};
financeRouter.use('/finance/fines/import', importRoutes(fineImport));

// ======================================================================== 8.2 wallet
const LATEST = `(SELECT s.rider_id, s.balance, s.snapshot_date FROM wallet_snapshots s
  JOIN (SELECT rider_id, MAX(snapshot_date) d FROM wallet_snapshots GROUP BY rider_id) x ON x.rider_id = s.rider_id AND x.d = s.snapshot_date)`;
const balanceSpec: Spec = {
  from: `FROM ${LATEST} b JOIN riders r ON r.id = b.rider_id`,
  select: 'b.*, r.full_name',
  search: [riderSearch([])],
  sorts: { rider: 'r.full_name', balance: 'b.balance', date: 'b.snapshot_date' },
  defaultSort: 'balance',
};
financeRouter.get('/finance/wallet/balances', can('finance.view'), async (req, res) => {
  const [stats] = await q(`SELECT COUNT(*) riders, MAX(b.snapshot_date) latest, COALESCE(SUM(b.balance),0) net, COALESCE(SUM(b.balance < 0),0) negative,
    COALESCE(SUM(CASE WHEN b.balance < 0 THEN b.balance END),0) owed FROM ${LATEST} b`);
  res.json({ ...(await list(balanceSpec, { pageSize: '100', ...(req.query as Query) })), stats });
});
financeRouter.get('/finance/wallet/history/:rider', can('finance.view'), async (req, res) =>
  res.json(await q('SELECT snapshot_date, balance FROM wallet_snapshots WHERE rider_id = ? ORDER BY snapshot_date', [req.params.rider])));

const entrySpec: Spec = {
  from: 'FROM wallet_entries e JOIN riders r ON r.id = e.rider_id',
  select: 'e.*, r.full_name',
  search: [riderSearch(['e.description'])],
  filters: { from: (v) => ['e.entry_date >= ?', [v]], to: (v) => ['e.entry_date <= ?', [v]], rider: (v) => ['e.rider_id = ?', [v]] },
  sorts: { date: 'e.entry_date, e.id', rider: 'r.full_name', amount: 'e.amount' },
  defaultSort: '-date',
};
financeRouter.get('/finance/wallet/entries', can('finance.view'), async (req, res) => res.json(await list(entrySpec, req.query as Query)));

financeRouter.get('/finance/wallet/export', can('finance.view'), async (req, res) => {
  const query = req.query as Query;
  const entries = query.tab === 'entries';
  const rows = await listAll(entries ? entrySpec : balanceSpec, query);
  const key = entries ? 'amount' : 'balance';
  await sendExport(req, res, {
    format: query.format === 'csv' ? 'csv' : 'xlsx', title: entries ? 'fin.entries_title' : 'fin.balances_title', rows,
    summary: [['export.records', rows.length], ['fin.riders', new Set(rows.map((r: any) => r.rider_id)).size], ['fin.total', rows.reduce((s: number, r: any) => s + Number(r[key]), 0).toFixed(2)]],
    cols: entries
      ? [{ key: 'entry_date', label: 'fin.date' }, { key: 'rider_id', label: 'riders.rider_id' }, { key: 'full_name', label: 'fin.rider' }, { key: 'description', label: 'fin.entry_note' },
        { key: 'amount', label: 'fin.amount', fill: (r) => (r.amount < 0 ? 'red' : null) }]
      : [{ key: 'snapshot_date', label: 'fin.date' }, { key: 'rider_id', label: 'riders.rider_id' }, { key: 'full_name', label: 'fin.rider' },
        { key: 'balance', label: 'fin.balance', fill: (r) => (r.balance < 0 ? 'red' : null) }],
  });
});

// One file carries either balances or entries; the headings tell which.
const walletImport: ImportDef = {
  name: 'wallet', perm: 'finance.import', matchOn: 'fin.match_wallet', options: ['create_riders'], maxRows: 50000,
  columns: {
    rider_id: ['riders.rider_id', 'rider id', 'rider_id', 'riderid'], balance: ['fin.balance', 'balance', 'wallet balance'],
    snapshot_date: ['fin.snapshot_date', 'snapshot date', 'snapshot_date', 'balance date'], date: ['fin.date', 'date', 'entry date'],
    amount: ['fin.amount', 'amount'], description: ['fin.entry_note', 'description', 'note', 'entry description'],
  },
  templateColumns: ['rider_id', 'balance', 'snapshot_date'],
  requiredColumns: [['rider_id'], ['balance', 'amount']],
  async parse(row, ctx) {
    const rider_id = riderIdOf(row.rider_id);
    if (!rider_id) return 'no_rider_id';
    if (ctx.present.has('balance')) {
      const d = cellDate(row.snapshot_date ?? row.date);
      if (!d) return 'bad_date';
      const balance = cellNum(row.balance);
      if (balance == null) return 'bad_amount';
      return { line: 0, key: `b|${rider_id}|${d}`, data: { kind: 'balance', rider_id, snapshot_date: d, balance }, label: `#${rider_id} ${d}` };
    }
    const d = cellDate(row.date);
    if (!d) return 'bad_date';
    const amount = cellNum(row.amount);
    if (amount == null) return 'bad_amount';
    const description = cellStr(row.description, 500) ?? '';
    return { line: 0, key: `e|${rider_id}|${d}|${description}|${amount}`, data: { kind: 'entry', rider_id, entry_date: d, description, amount }, label: `#${rider_id} ${d} ${amount}` };
  },
  async existing(items) {
    const m = new Map<string, any>();
    for (const i of items) {
      const d = i.data;
      const x = d.kind === 'balance'
        ? await one('SELECT 1 x FROM wallet_snapshots WHERE rider_id = ? AND snapshot_date = ?', [d.rider_id, d.snapshot_date])
        : await one('SELECT 1 x FROM wallet_entries WHERE rider_id = ? AND entry_date = ? AND description = ? AND amount = ?', [d.rider_id, d.entry_date, d.description, d.amount]);
      if (x) m.set(i.key, x);
    }
    return m;
  },
  counts: (items) => unknownRiders(items),
  async write(it, ex, ctx) {
    const { kind, ...d } = it.data;
    if (ex) {
      // a matching entry has nothing in it to update
      if (ctx.mode === 'skip' || kind === 'entry') return 'skipped';
      await exec('UPDATE wallet_snapshots SET balance = ? WHERE rider_id = ? AND snapshot_date = ?', [d.balance, d.rider_id, d.snapshot_date]);
      return 'replaced';
    }
    if (!(await ensureRider(d.rider_id, ctx))) return 'skipped';
    await exec(`INSERT INTO ${kind === 'balance' ? 'wallet_snapshots' : 'wallet_entries'} SET ?`, [d]);
    return 'inserted';
  },
};
financeRouter.use('/finance/wallet/import', importRoutes(walletImport));

// ======================================================================== 8.3 monthly billing
export const BILL_GROUPS: Record<string, string[]> = {
  payments: ['completed_orders', 'basic_payment', 'distance_payment', 'ftr_bonus', 'rider_payment_basic', 'rider_payment_scoring'],
  fines: ['fine_acceptance', 'fine_contact', 'fine_declined', 'fine_late', 'fine_no_show', 'fine_no_show_special', 'fine_daily_acceptance', 'fine_missed_days'],
  deductions: ['ded_stacking', 'ded_car', 'ded_google', 'total_deductions'],
  total: ['rider_balance', 'pending_balance', 'amount_excl_vat', 'vat', 'amount_incl_vat', 'net_ftr'],
};
const MONEY = Object.values(BILL_GROUPS).flat().filter((c) => c !== 'completed_orders');
const monthOf = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}$/.test(v) ? v : null);
const billSpec = (month: string): Spec => ({
  from: 'FROM billing b JOIN riders r ON r.id = b.rider_id',
  select: 'b.*, r.full_name',
  search: [riderSearch(['b.contract'])],
  filters: { month: () => ['b.month = ?', [month]] },
  sorts: { amount: 'b.amount_incl_vat' },
  defaultSort: '-amount',
});

financeRouter.get('/finance/billing', can('finance.view'), async (req, res) => {
  const month = monthOf(req.query.month) ?? (await today()).slice(0, 7);
  const spec = billSpec(month);
  // the cards are the whole month; the totals row is every column summed
  const sums = [...MONEY, 'completed_orders'].map((c) => `SUM(b.${c}) ${c}`).join(', ');
  const [totals] = await q<any>(`SELECT COUNT(*) riders, ${sums} FROM billing b WHERE b.month = ?`, [month]);
  const n = (k: string) => Number(totals[k] ?? 0);
  const stats = {
    riders: Number(totals.riders), orders: n('completed_orders'), payments: n('basic_payment') + n('distance_payment') + n('ftr_bonus'),
    fines: BILL_GROUPS.fines.reduce((s, c) => s + n(c), 0), deductions: n('total_deductions'), net: n('net_ftr'),
  };
  res.json({ ...(await list(spec, { pageSize: '50', ...(req.query as Query), month, sort: '-amount' })), month, stats, totals });
});

financeRouter.get('/finance/billing/export', can('finance.view'), async (req, res) => {
  const query = req.query as Query;
  const month = monthOf(query.month) ?? (await today()).slice(0, 7);
  const rows = await listAll(billSpec(month), { ...query, month, sort: '-amount' });
  const sum = (c: string) => rows.reduce((s: number, r: any) => s + Number(r[c] ?? 0), 0).toFixed(2);
  await sendExport(req, res, {
    format: query.format === 'csv' ? 'csv' : 'xlsx', title: 'fin.billing_title', rows, filters: month,
    summary: [['fin.riders', rows.length], ['fin.b.total_deductions', sum('total_deductions')], ['fin.b.amount_incl_vat', sum('amount_incl_vat')]],
    cols: [{ key: 'month', label: 'fin.month' }, { key: 'rider_id', label: 'riders.rider_id' }, { key: 'full_name', label: 'fin.rider' }, { key: 'contract', label: 'fin.contract' },
      ...Object.values(BILL_GROUPS).flat().map((c) => ({ key: c, label: `fin.b.${c}`, fill: (r: any) => (Number(r[c]) < 0 ? 'red' : null) }))],
  });
});

const billImport: ImportDef = {
  name: 'billing', perm: 'finance.import', matchOn: 'fin.match_billing', options: ['create_riders'], maxRows: 20000,
  columns: {
    rider_id: ['riders.rider_id', 'rider id', 'rider_id', 'riderid'], month: ['fin.month', 'month', 'billing month', 'period'],
    contract: ['fin.contract', 'contract', 'contract name'],
    ...Object.fromEntries(Object.values(BILL_GROUPS).flat().map((c) => [c, [`fin.b.${c}`, c, c.replace(/_/g, ' ')]])),
  },
  requiredColumns: [['rider_id'], ['month']],
  async parse(row) {
    const rider_id = riderIdOf(row.rider_id);
    if (!rider_id) return 'no_rider_id';
    // "2026-09", "2026/9", a date in the month, or "09-2026"
    const raw = String((row.month instanceof Date || typeof row.month === 'number' ? cellDate(row.month) : cellStr(row.month)) ?? '');
    const ym = raw.match(/^(\d{4})[-/.](\d{1,2})/);
    const my = raw.match(/^(\d{1,2})[-/.](\d{4})$/);
    const [y, mo] = ym ? [ym[1], ym[2]] : my ? [my[2], my[1]] : [];
    if (!y || !mo || Number(mo) < 1 || Number(mo) > 12) return 'bad_month';
    const month = `${y}-${mo.padStart(2, '0')}`;
    const data: Record<string, unknown> = { rider_id, month, contract: cellStr(row.contract, 150) };
    for (const c of Object.values(BILL_GROUPS).flat()) {
      const v = cellNum(row[c]);
      if (v === undefined) return 'bad_amount';
      data[c] = v;
    }
    return { line: 0, key: `${rider_id}|${month}`, data, label: `#${rider_id} ${month}` };
  },
  async existing(items) {
    const m = new Map<string, any>();
    for (const i of items) { const b = await one('SELECT id FROM billing WHERE rider_id = ? AND month = ?', [i.data.rider_id, i.data.month]); if (b) m.set(i.key, b); }
    return m;
  },
  counts: (items) => unknownRiders(items),
  async write(it, ex, ctx) {
    if (ex) {
      if (ctx.mode === 'skip') return 'skipped';
      // the whole statement is replaced; a column the new file lacks becomes empty
      await exec('UPDATE billing SET ? WHERE id = ?', [it.data, ex.id]);
      return 'replaced';
    }
    if (!(await ensureRider(it.data.rider_id, ctx))) return 'skipped';
    await exec('INSERT INTO billing SET ?', [it.data]);
    return 'inserted';
  },
};
financeRouter.use('/finance/billing/import', importRoutes(billImport));

// ======================================================================== 8.5 the rider's financial summary
financeRouter.get('/finance/rider/:id', can('finance.view'), async (req, res) => {
  const id = Number(req.params.id);
  const day = await today();
  const wallet = await one<any>('SELECT balance, snapshot_date FROM wallet_snapshots WHERE rider_id = ? ORDER BY snapshot_date DESC LIMIT 1', [id]);
  const [{ entries }] = await q<any>('SELECT COUNT(*) entries FROM wallet_entries WHERE rider_id = ? AND entry_date >= ?', [id, addDays(day, -30)]);
  const [fines] = await q<any>('SELECT COALESCE(SUM(amount),0) total, COUNT(*) n FROM fines WHERE rider_id = ?', [id]);
  const bill = await one<any>('SELECT month, amount_incl_vat FROM billing WHERE rider_id = ? ORDER BY month DESC LIMIT 1', [id]);
  const [adv] = await q<any>(`SELECT COALESCE(SUM(i.amount - i.paid),0) remaining, MIN(CASE WHEN i.status IN ('due','partial') THEN i.due_date END) next_due
    FROM advances a JOIN advance_installments i ON i.advance_id = a.id WHERE a.rider_id = ? AND a.status IN ('disbursed','repaying') AND i.status IN ('due','partial')`, [id]);
  const [{ pending }] = await q<any>("SELECT COALESCE(SUM(amount),0) pending FROM advances WHERE rider_id = ? AND status IN ('pending','approved')", [id]);
  const next = adv.next_due ? await one<any>(`SELECT i.amount - i.paid amount, i.due_date FROM advance_installments i JOIN advances a ON a.id = i.advance_id
    WHERE a.rider_id = ? AND i.status IN ('due','partial') ORDER BY i.due_date LIMIT 1`, [id]) : null;
  const empty = !wallet && !Number(fines.n) && !bill && !Number(adv.remaining) && !Number(pending);
  res.json({ empty, wallet: wallet ? { ...wallet, entries: Number(entries) } : null, fines, billing: bill ?? null,
    advance: { remaining: Number(adv.remaining) + Number(pending), next } });
});
