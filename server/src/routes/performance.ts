import { Router, type Request } from 'express';
import { exec, one, q } from '../db.js';
import { addDays, clean, daysBetween, eq, fail, fieldError, latinDigits, list, listAll, sendExport, today, where, type Col, type Query, type Spec } from '../http.js';
import { can } from '../auth.js';
import { audit } from '../audit.js';
import { cellDate, cellNum, cellStr, importRoutes, type Ctx, type ImportDef, type Parsed } from '../importer.js';

// Chapter 6: daily performance (6.1), the scorecard over a period (6.2) and the monthly ratings (6.4).
export const performanceRouter = Router();

// ======================================================================== 6.1 daily performance
type Kind = 'text' | 'int' | 'num' | 'rate';
export const MEASURES: Record<string, { kind: Kind; aliases: string[] }> = {
  batch: { kind: 'text', aliases: ['batch', 'batch number'] }, tga_status: { kind: 'text', aliases: ['tga status', 'tga'] },
  error_codes: { kind: 'text', aliases: ['error codes', 'error code'] }, shifts: { kind: 'int', aliases: ['shifts', 'shift count'] },
  working_days: { kind: 'int', aliases: ['working days', 'days'] }, planned_hours: { kind: 'num', aliases: ['planned hours', 'scheduled hours'] },
  actual_hours: { kind: 'num', aliases: ['actual hours', 'worked hours', 'working hours'] }, break_hours: { kind: 'num', aliases: ['break hours'] },
  lost_hours: { kind: 'num', aliases: ['lost hours'] }, attendance_rate: { kind: 'rate', aliases: ['attendance rate', 'attendance', 'utr'] },
  acceptance_rate: { kind: 'rate', aliases: ['acceptance rate', 'acceptance'] }, contact_rate: { kind: 'rate', aliases: ['contact rate'] },
  no_shows: { kind: 'int', aliases: ['no shows', 'no show'] }, no_show_rate: { kind: 'rate', aliases: ['no show %', 'no show rate'] },
  notified: { kind: 'int', aliases: ['notified', 'notified orders'] }, accepted: { kind: 'int', aliases: ['accepted', 'accepted orders'] },
  completed: { kind: 'int', aliases: ['completed', 'completed orders', 'delivered orders'] }, stacked: { kind: 'int', aliases: ['stacked', 'stacked orders'] },
  declined: { kind: 'int', aliases: ['declined', 'declined orders'] }, cancelled: { kind: 'int', aliases: ['cancelled', 'cancelled orders'] },
  deductions: { kind: 'int', aliases: ['deductions', 'deducted orders'] }, not_accepted: { kind: 'int', aliases: ['not accepted', 'not accepted orders'] },
  manual_undispatched: { kind: 'int', aliases: ['manual undispatched'] }, chat_response_rate: { kind: 'rate', aliases: ['chat response %', 'chat response rate'] },
};
// Rates arrive as 0.97 or 97.
const rate = (n: number) => (n > 1.5 ? n / 100 : n);
function measureValue(kind: Kind, v: unknown): unknown {
  if (kind === 'text') return cellStr(v, 50);
  const n = cellNum(typeof v === 'string' ? v.replace('%', '') : v);
  if (n === undefined) return undefined;
  if (n === null) return null;
  return kind === 'int' ? Math.round(n) : kind === 'rate' ? Math.round(rate(n) * 10000) / 10000 : Math.round(n * 100) / 100;
}

const VEHICLE_ON = `(SELECT v.plate FROM vehicle_assignments a JOIN vehicles v ON v.id = a.vehicle_id WHERE a.rider_id = p.rider_id
  AND a.start_date <= p.work_date AND (a.end_date IS NULL OR a.end_date >= p.work_date) ORDER BY a.start_date DESC LIMIT 1)`;
const perfSpec: Spec = {
  from: `FROM daily_performance p JOIN riders r ON r.id = p.rider_id LEFT JOIN companies co ON co.id = r.company_id LEFT JOIN cities ci ON ci.id = r.city_id
    LEFT JOIN contracts k ON k.id = COALESCE(p.contract_id, r.contract_id)`,
  select: `p.*, r.full_name, r.alias, co.name company_name, ci.name_ar city_ar, ci.name_en city_en, k.name contract_name, ${VEHICLE_ON} vehicle,
    CASE WHEN p.working_days > 0 THEN p.actual_hours / p.working_days ELSE p.actual_hours END avg_hours`,
  // digits alone match the rider's id at the company exactly
  search: [(s) => (/^\d+$/.test(s) ? ['p.rider_id = ?', [Number(s)]] : ['(r.full_name LIKE ? OR r.alias LIKE ? OR k.name LIKE ? OR ci.name_ar LIKE ? OR ci.name_en LIKE ?)', Array(5).fill(`%${s}%`)])],
  filters: {
    from: (v) => ['p.work_date >= ?', [v]], to: (v) => ['p.work_date <= ?', [v]],
    company: eq('r.company_id'), contract: (v) => ['COALESCE(p.contract_id, r.contract_id) = ?', [v]], city: eq('r.city_id'), rider: eq('p.rider_id'),
    tga: eq('p.tga_status'),
    band: (v) => ({ critical: 'p.completed < 10', warning: 'p.completed >= 10 AND p.completed < 15', good: 'p.completed >= 15' } as Record<string, string>)[v] ?? null,
    del_min: (v) => ['p.completed >= ?', [Number(latinDigits(v))]], del_max: (v) => ['p.completed <= ?', [Number(latinDigits(v))]],
  },
  sorts: { rider: 'r.full_name', date: 'p.work_date', completed: 'p.completed', attendance: 'p.attendance_rate', acceptance: 'p.acceptance_rate', hours: 'p.actual_hours' },
  defaultSort: 'rider',
};

performanceRouter.get('/performance', can('performance.view'), async (req, res) => {
  const query = req.query as Query;
  const w = where(perfSpec, query);
  const [stats] = await q(`SELECT COUNT(*) records, COUNT(DISTINCT p.rider_id) riders, COALESCE(SUM(p.completed),0) completed, COALESCE(SUM(p.notified),0) notified,
    COALESCE(SUM(p.actual_hours),0) hours, COALESCE(SUM(p.lost_hours),0) lost, AVG(p.attendance_rate) attendance, AVG(p.acceptance_rate) acceptance,
    COALESCE(SUM(p.tga_status IS NOT NULL AND LOWER(p.tga_status) <> 'compliant'),0) not_compliant ${perfSpec.from}${w.sql}`, w.params);
  const tga = (await q<any>('SELECT DISTINCT tga_status v FROM daily_performance WHERE tga_status IS NOT NULL ORDER BY v')).map((r) => r.v);
  res.json({ ...(await list(perfSpec, query)), stats, facets: { tga } });
});

// Colours: the same thresholds on the screen and in the file.
export const perfFill: Record<string, (v: number) => string | null> = {
  completed: (v) => (v < 10 ? 'red' : v < 15 ? 'amber' : 'green'),
  attendance_rate: (v) => (v < 0.7 ? 'red' : v < 0.95 ? 'amber' : 'green'),
  acceptance_rate: (v) => (v < 0.85 ? 'red' : v < 0.95 ? 'amber' : 'green'),
  actual_hours: (v) => (v < 6 ? 'red' : v < 8 ? 'amber' : 'green'),
  avg_hours: (v) => (v < 6 ? 'red' : v < 8 ? 'amber' : 'green'),
  lost_hours: (v) => (v >= 2.5 ? 'red' : v >= 1 ? 'amber' : null),
  no_shows: (v) => (v > 0 ? 'red' : null),
};
performanceRouter.get('/performance/export', can('performance.export'), async (req, res) => {
  // the file follows the period, the search, the company, the contract and the city
  const query: Query = { ...(req.query as Query), tga: undefined, band: undefined, del_min: undefined, del_max: undefined };
  const rows = await listAll(perfSpec, query, 50000);
  const shown = String(req.query.cols ?? '').split(',').filter(Boolean);
  const all = ['company_name', 'city_ar', 'contract_name', 'vehicle', ...Object.keys(MEASURES), 'avg_hours'];
  const cols: Col[] = [{ key: 'full_name', label: 'perf.rider' }, { key: 'work_date', label: 'perf.date' },
    ...all.filter((k) => !shown.length || shown.includes(k)).map((k) => ({ key: k, label: `perf.m.${k}`,
      value: MEASURES[k]?.kind === 'rate' ? (r: any) => (r[k] == null ? null : `${Math.floor(r[k] * 1000) / 10}%`) : undefined,
      fill: perfFill[k] ? (r: any) => (r[k] == null ? null : perfFill[k](Number(r[k]))) : k === 'tga_status' ? (r: any) => (r.tga_status ? (String(r.tga_status).toLowerCase() === 'compliant' ? 'green' : 'amber') : null) : undefined }))];
  await sendExport(req, res, { format: 'xlsx', title: 'perf.title', rows, cols, filters: [query.from, query.to].filter(Boolean).join(' → ') });
});

const PERF_RULES = Object.fromEntries(Object.entries(MEASURES).map(([k, m]) => [k, m.kind === 'text' ? { max: 50 } : { type: 'num' as const, min: 0 }]));
const normalise = (v: Record<string, any>) => {
  for (const [k, m] of Object.entries(MEASURES)) if (v[k] != null && m.kind !== 'text') v[k] = measureValue(m.kind, v[k]);
  return v;
};
async function record(id: unknown) {
  const p = await one<any>(`SELECT ${perfSpec.select}, u.full_name created_by_name ${perfSpec.from} LEFT JOIN users u ON u.id = p.created_by WHERE p.id = ?`, [id]);
  if (!p) fail(404, 'not_found');
  return p;
}
performanceRouter.get('/performance/missing-days', can('performance.import'), async (req, res) => {
  // earlier days of the same month with no data at all
  const day = String(req.query.day ?? await today());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) fail(422, 'invalid');
  const have = new Set((await q<any>('SELECT DISTINCT work_date d FROM daily_performance WHERE work_date >= ? AND work_date < ?', [`${day.slice(0, 7)}-01`, day])).map((r) => r.d));
  const out: string[] = [];
  for (let d = `${day.slice(0, 7)}-01`; d < day; d = addDays(d, 1)) if (!have.has(d)) out.push(d);
  res.json(out);
});
performanceRouter.get('/performance/:id', can('performance.view'), async (req, res) => res.json(await record(req.params.id)));
// What the add screen shows "from the rider's record": company, contract, city, and the vehicle on that date.
performanceRouter.get('/performance-rider/:id', can('performance.create', 'performance.update'), async (req, res) => {
  const day = String(req.query.day ?? await today());
  res.json(await one(`SELECT r.id, co.name company_name, k.name contract_name, ci.name_ar city_ar, ci.name_en city_en,
    (SELECT v.plate FROM vehicle_assignments a JOIN vehicles v ON v.id = a.vehicle_id WHERE a.rider_id = r.id AND a.start_date <= ? AND (a.end_date IS NULL OR a.end_date >= ?) ORDER BY a.start_date DESC LIMIT 1) vehicle
    FROM riders r LEFT JOIN companies co ON co.id = r.company_id LEFT JOIN contracts k ON k.id = r.contract_id LEFT JOIN cities ci ON ci.id = r.city_id WHERE r.id = ?`, [day, day, req.params.id]));
});
async function saveRecord(req: Request, v: Record<string, any>, id = 0) {
  try {
    if (id) await exec('UPDATE daily_performance SET ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [v, id]);
    else return (await exec('INSERT INTO daily_performance SET ?', [{ ...v, source: 'manual', created_by: req.user!.id }])).insertId;
  } catch (e: any) {
    if (e?.code === 'ER_DUP_ENTRY') fieldError('work_date', 'perf_day_taken');
    throw e;
  }
  return id;
}
performanceRouter.post('/performance', can('performance.create'), async (req, res) => {
  const v = normalise(clean(req.body, { rider_id: { req: true, type: 'int' }, work_date: { req: true, type: 'date' }, ...PERF_RULES }));
  if (!(await one('SELECT 1 FROM riders WHERE id = ?', [v.rider_id]))) fieldError('rider_id', 'rider_not_found');
  const id = await saveRecord(req, v);
  await audit(req, { action: 'performance.create', entity_type: 'performance', entity_id: id, after: v });
  res.json({ id });
});
performanceRouter.patch('/performance/:id', can('performance.update'), async (req, res) => {
  const before = await one<any>('SELECT * FROM daily_performance WHERE id = ?', [req.params.id]);
  if (!before) fail(404, 'not_found');
  const v = normalise(clean(req.body, { rider_id: { type: 'int' }, work_date: { type: 'date' }, ...PERF_RULES }, true));
  await saveRecord(req, v, before.id);
  await audit(req, { action: 'performance.update', entity_type: 'performance', entity_id: before.id, before, after: v });
  res.json({ ok: true });
});
async function removeRecords(req: Request, ids: number[]) {
  if (!ids.length) fail(422, 'nothing_selected');
  if (ids.length > 500) fail(422, 'max_500');
  const r = await exec('DELETE FROM daily_performance WHERE id IN (?)', [ids]);
  await audit(req, { action: 'performance.delete', entity_type: 'performance', entity_id: ids.join(',').slice(0, 60), severity: 'warning', details: `${r.affectedRows} records` });
  return r.affectedRows;
}
performanceRouter.delete('/performance/:id', can('performance.delete'), async (req, res) => res.json({ deleted: await removeRecords(req, [Number(req.params.id)]) }));
performanceRouter.post('/performance/bulk-delete', can('performance.delete'), async (req, res) => res.json({ deleted: await removeRecords(req, (req.body.ids ?? []).map(Number)) }));

// ---------- import: the company's file does not carry the date; the screen gives it ----------
async function ensureRider(id: number, ctx: Ctx, note: string) {
  const key = `rider:${id}`;
  if (!ctx.cache.has(key)) ctx.cache.set(key, !!(await one('SELECT 1 FROM riders WHERE id = ?', [id])));
  if (ctx.cache.get(key)) return true;
  if (!ctx.options.create_riders) return false;
  await exec("INSERT IGNORE INTO riders (id, full_name, status, notes) VALUES (?, ?, 'active', ?)", [id, `Rider ${id}`, note]);
  ctx.cache.set(key, true);
  ctx.result.riders_created = (ctx.result.riders_created ?? 0) + 1;
  return true;
}
export const performanceImport: ImportDef = {
  name: 'performance', perm: 'performance.import', matchOn: 'perf.match_on', options: ['create_riders', 'create_contracts'], values: ['day', 'company_id'], maxRows: 20000,
  columns: {
    rider_id: ['riders.rider_id', 'rider id', 'rider_id', 'riderid'], contract: ['perf.m.contract_name', 'contract name', 'contract'], city: ['perf.m.city_ar', 'city', 'city name'],
    ...Object.fromEntries(Object.entries(MEASURES).map(([k, m]) => [k, [`perf.m.${k}`, k, ...m.aliases]])),
  },
  requiredColumns: [['rider_id']],
  async parse(row, ctx) {
    const s = cellStr(row.rider_id);
    if (!s || !/^\d{1,20}$/.test(s)) return 'no_rider_id';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ctx.values.day ?? '')) return 'bad_date';
    const data: Record<string, unknown> = { rider_id: Number(s), work_date: ctx.values.day, _contract: cellStr(row.contract, 150), _city: cellStr(row.city, 100) };
    for (const [k, m] of Object.entries(MEASURES)) {
      if (!ctx.present.has(k)) continue;
      const v = measureValue(m.kind, row[k]);
      if (v === undefined) return 'invalid_value';
      data[k] = v;
    }
    return { line: 0, key: s, data, label: `#${s}` };
  },
  async existing(items, ctx) {
    const m = new Map<string, any>();
    const ids = items.map((i) => i.data.rider_id);
    if (ids.length) for (const r of await q<any>('SELECT id, rider_id FROM daily_performance WHERE work_date = ? AND rider_id IN (?)', [ctx.values.day, ids])) m.set(String(r.rider_id), r);
    return m;
  },
  async counts(items, existing) {
    const ids = [...new Set(items.map((i) => i.data.rider_id))];
    const known = new Set(ids.length ? (await q<any>('SELECT id FROM riders WHERE id IN (?)', [ids])).map((r) => r.id) : []);
    return { new_rows: items.filter((i) => !existing.has(i.key)).length, recorded: existing.size, unknown_riders: ids.filter((id) => !known.has(id)).length };
  },
  async write(it, ex, ctx) {
    const { _contract, _city, ...data } = it.data;
    if (ex && ctx.mode === 'skip') return 'skipped';
    if (!(await ensureRider(data.rider_id, ctx, 'Created by the performance import — complete the details.'))) { ctx.result.left_out = (ctx.result.left_out ?? 0) + 1; return 'skipped'; }
    const rider = await one<any>('SELECT company_id, contract_id, city_id FROM riders WHERE id = ?', [data.rider_id]);
    const company = Number(ctx.values.company_id) || rider.company_id;
    if (_contract && company) {
      let k = await one<any>('SELECT id FROM contracts WHERE company_id = ? AND name = ?', [company, _contract]);
      if (!k && ctx.options.create_contracts) {
        k = { id: (await exec('INSERT INTO contracts (company_id, name) VALUES (?, ?)', [company, _contract])).insertId };
        ctx.result.contracts_created = (ctx.result.contracts_created ?? 0) + 1;
      }
      if (k) data.contract_id = k.id;
    }
    // the city and the contract go to the rider's file only where it is empty
    const fill: Record<string, unknown> = {};
    if (!rider.company_id && company) fill.company_id = company;
    if (!rider.contract_id && data.contract_id) fill.contract_id = data.contract_id;
    if (!rider.city_id && _city) { const c = await one<any>('SELECT id FROM cities WHERE name_ar = ? OR name_en = ?', [_city, _city]); if (c) fill.city_id = c.id; }
    if (Object.keys(fill).length) await exec('UPDATE riders SET ? WHERE id = ?', [fill, data.rider_id]);
    if (ex) { await exec('UPDATE daily_performance SET ?, source = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [data, ctx.req.user ? 'import' : 'sync', ex.id]); return 'replaced'; }
    await exec('INSERT INTO daily_performance SET ?', [{ ...data, source: ctx.values.sync ? 'sync' : 'import', created_by: ctx.req.user?.id ?? null }]);
    return 'inserted';
  },
};
performanceRouter.use('/performance-import', importRoutes(performanceImport));

// ======================================================================== 6.2 scorecard over a period
type Score = { grade: 'negligent' | 'weak' | 'fair' | 'strong'; points: number | null; reasons: string[] };
export function grade(a: { days: number; orders: number; att: number | null; acc: number | null; lost: number; no_shows: number }): Score {
  const d = Math.max(1, a.days);
  const reasons: string[] = [];
  // first, negligence: a commitment problem, whatever the orders
  if (a.no_shows / d >= 0.15) reasons.push('no_shows');
  if (a.att !== null && a.att < 0.7) reasons.push('low_attendance');
  if (a.lost / d >= 2.5) reasons.push('lost_hours');
  if (reasons.length) return { grade: 'negligent', points: null, reasons };
  const perDay = a.orders / d;
  let points = perDay >= 15 ? 2 : perDay >= 10 ? 1 : 0;
  if (perDay < 10) reasons.push('few_deliveries');
  const score = (v: number | null, why: string) => (v === null ? 1 : v >= 0.95 ? 2 : v >= 0.85 ? 1 : (reasons.push(why), 0));
  points += score(a.att, 'low_attendance') + score(a.acc, 'low_acceptance');
  if (a.lost / d >= 1) { points -= 1; reasons.push('some_lost_hours'); }
  if (a.no_shows / d >= 0.05) { points -= 1; reasons.push('some_no_shows'); }
  const g = perDay < 10 ? 'weak' : points >= 5 ? 'strong' : points <= 2 ? 'weak' : 'fair';
  return { grade: g, points, reasons };
}
const RANK = { negligent: 0, weak: 1, fair: 2, strong: 3 };

async function scorecard(query: Query, riderId?: number) {
  const day = await today();
  const to = /^\d{4}-\d{2}-\d{2}$/.test(query.to ?? '') ? query.to! : addDays(day, -1);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(query.from ?? '') ? query.from! : addDays(to, -13);
  const span = daysBetween(from, to) + 1;
  // the leave subquery (to, from, to, from), then the period (from, to)
  const params: unknown[] = [to, from, to, from, from, to];
  let w = '';
  if (query.company) { w += ' AND r.company_id = ?'; params.push(query.company); }
  if (riderId) { w += ' AND r.id = ?'; params.push(riderId); }
  const s = latinDigits(query.search?.trim() ?? '');
  if (s) { if (/^\d+$/.test(s)) { w += ' AND r.id = ?'; params.push(Number(s)); } else { w += ' AND (r.full_name LIKE ? OR r.alias LIKE ?)'; params.push(`%${s}%`, `%${s}%`); } }
  const rows = await q<any>(`SELECT r.id, r.full_name, r.alias, co.name company_name, COUNT(*) days, COALESCE(SUM(p.actual_hours),0) hours, COALESCE(SUM(p.planned_hours),0) planned,
    COALESCE(SUM(p.lost_hours),0) lost, COALESCE(SUM(p.completed),0) orders, AVG(p.attendance_rate) att, AVG(p.acceptance_rate) acc, COALESCE(SUM(p.no_shows),0) no_shows,
    (SELECT COALESCE(SUM(DATEDIFF(LEAST(l.end_date, ?), GREATEST(l.start_date, ?)) + 1),0) FROM leaves l WHERE l.rider_id = r.id AND l.status = 'approved' AND l.start_date <= ? AND l.end_date >= ?) leave_days
    FROM daily_performance p JOIN riders r ON r.id = p.rider_id LEFT JOIN companies co ON co.id = r.company_id
    WHERE p.work_date BETWEEN ? AND ?${w} GROUP BY r.id, r.full_name, r.alias, co.name`, params);
  const out = rows.map((r) => {
    const a = { days: Number(r.days), orders: Number(r.orders), att: r.att === null ? null : Number(r.att), acc: r.acc === null ? null : Number(r.acc), lost: Number(r.lost), no_shows: Number(r.no_shows) };
    const absent = Math.max(0, span - a.days);
    return { ...r, ...a, hours: Number(r.hours), planned: Number(r.planned), absent, leave_days: Number(r.leave_days), absent_net: Math.max(0, absent - Number(r.leave_days)),
      missed_hours: Math.max(0, Number(r.planned) - Number(r.hours)), per_day: a.orders / Math.max(1, a.days), ...grade(a) };
  });
  return { from, to, span, rows: out };
}
const SORTS: Record<string, (a: any, b: any) => number> = {
  worst: (a, b) => RANK[a.grade as keyof typeof RANK] - RANK[b.grade as keyof typeof RANK] || (a.points ?? -1) - (b.points ?? -1) || a.per_day - b.per_day,
  absent: (a, b) => b.absent - a.absent, hours: (a, b) => a.hours - b.hours, attendance: (a, b) => (a.att ?? 2) - (b.att ?? 2),
  orders: (a, b) => a.per_day - b.per_day, no_shows: (a, b) => b.no_shows - a.no_shows,
};
function narrow(rows: any[], query: Query) {
  const n = (k: string) => (query[k] !== undefined && query[k] !== '' ? Number(latinDigits(query[k]!)) : null);
  return rows.filter((r) => (n('hours_min') === null || r.hours >= n('hours_min')!) && (n('hours_max') === null || r.hours <= n('hours_max')!)
    && (n('absent_min') === null || r.absent >= n('absent_min')!) && (n('noshow_min') === null || r.no_shows >= n('noshow_min')!) && (!query.grade || r.grade === query.grade))
    .sort(SORTS[query.sort ?? 'worst'] ?? SORTS.worst);
}
performanceRouter.get('/performance-scorecard', can('performance.view'), async (req, res) => {
  const query = req.query as Query;
  const sc = await scorecard(query);
  const counts = Object.fromEntries(Object.keys(RANK).map((g) => [g, sc.rows.filter((r) => r.grade === g).length]));
  const rows = narrow(sc.rows, query);
  const pageSize = [25, 50, 100].includes(Number(query.pageSize)) ? Number(query.pageSize) : 50;
  const page = Math.max(1, Number(query.page) || 1);
  res.json({ rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize, from: sc.from, to: sc.to, span: sc.span,
    stats: { riders: sc.rows.length, attention: counts.negligent + counts.weak, ...counts } });
});
performanceRouter.get('/performance-scorecard/export', can('performance.export'), async (req, res) => {
  const query = req.query as Query;
  const sc = await scorecard(query);
  const rows = narrow(sc.rows, query);
  const tone: Record<string, string> = { negligent: 'red', weak: 'amber', fair: 'blue', strong: 'green' };
  await sendExport(req, res, { format: 'xlsx', title: 'score.title', rows, filters: `${sc.from} → ${sc.to}`, cols: [
    { key: 'grade', label: 'score.grade', fill: (r) => tone[r.grade] }, { key: 'points', label: 'score.points' }, { key: 'id', label: 'riders.rider_id' },
    { key: 'full_name', label: 'score.rider' }, { key: 'company_name', label: 'riders.company' },
    { key: 'absent', label: 'score.absent_days', fill: (r) => (r.absent_net / sc.span >= 0.15 ? 'red' : r.absent_net / sc.span >= 0.05 ? 'amber' : null) },
    { key: 'days', label: 'score.days_worked' }, { key: 'hours', label: 'score.actual_hours', fill: (r) => perfFill.actual_hours(r.hours / Math.max(1, r.days)) },
    { key: 'missed_hours', label: 'score.missed_hours' }, { key: 'orders', label: 'score.orders', fill: (r) => perfFill.completed(r.per_day) },
    { key: 'att', label: 'score.attendance', value: (r) => (r.att == null ? null : `${Math.floor(r.att * 1000) / 10}%`) },
    { key: 'acc', label: 'score.acceptance', value: (r) => (r.acc == null ? null : `${Math.floor(r.acc * 1000) / 10}%`) },
    { key: 'no_shows', label: 'score.missed_shifts', fill: (r) => (r.no_shows > 0 ? 'red' : null) }, { key: 'reasons', label: 'score.why', value: (r) => r.reasons.join(', ') },
  ] });
});
performanceRouter.get('/performance-scorecard/:id', can('performance.view'), async (req, res) => {
  const id = Number(req.params.id);
  const rider = await one<any>(`SELECT r.id, r.full_name, r.alias, r.phone, r.national_id, r.hire_date, k.name contract_name, co.name company_name FROM riders r
    LEFT JOIN contracts k ON k.id = r.contract_id LEFT JOIN companies co ON co.id = r.company_id WHERE r.id = ?`, [id]);
  if (!rider) fail(404, 'rider_not_found');
  const sc = await scorecard(req.query as Query, id);
  const days = await q(`SELECT p.id, p.work_date, p.completed, p.notified, p.actual_hours, p.planned_hours, p.lost_hours, p.attendance_rate, p.acceptance_rate, p.no_shows
    FROM daily_performance p WHERE p.rider_id = ? AND p.work_date BETWEEN ? AND ? ORDER BY p.work_date`, [id, sc.from, sc.to]);
  res.json({ rider, from: sc.from, to: sc.to, span: sc.span, score: sc.rows[0] ?? null, days });
});

// ======================================================================== 6.4 monthly ratings
const SEGMENTS = ['A', 'B', 'C', 'D', 'E', 'F'];
const ratingSpec = (month: string): Spec => ({
  from: 'FROM monthly_ratings m JOIN riders r ON r.id = m.rider_id',
  select: 'm.*, r.full_name',
  search: [(s) => (/^\d+$/.test(s) ? ['m.rider_id = ?', [Number(s)]] : ['(r.full_name LIKE ? OR m.contract LIKE ?)', [`%${s}%`, `%${s}%`]])],
  filters: { month: () => ['m.month = ?', [month]], segment: eq('m.segment') },
  sorts: { final: 'm.final_score', rider: 'r.full_name' },
  defaultSort: '-final',
});
async function monthOf(query: Query) {
  if (/^\d{4}-\d{2}$/.test(query.month ?? '')) return query.month!;
  return (await one<any>('SELECT MAX(month) m FROM monthly_ratings'))?.m ?? (await today()).slice(0, 7);
}
performanceRouter.get('/ratings', can('ratings.view'), async (req, res) => {
  const query = req.query as Query;
  const month = await monthOf(query);
  const spec = ratingSpec(month);
  const w = where(spec, { ...query, segment: undefined });
  const [stats] = await q(`SELECT COUNT(*) riders, AVG(m.final_score) final, AVG(m.on_time) on_time, AVG(m.fail_rate_score) fail_rate, AVG(m.verification_rate) verification,
    COALESCE(SUM(m.completed),0) completed, COALESCE(SUM(m.gross_orders),0) gross, COALESCE(SUM(m.failed_by_rider),0) failed ${spec.from}${w.sql}`, w.params);
  const counts = await q<any>('SELECT segment, COUNT(*) n FROM monthly_ratings WHERE month = ? GROUP BY segment', [month]);
  const cutoffs = await q<any>('SELECT * FROM rating_cutoffs WHERE month = ?', [month]);
  const ladder = SEGMENTS.map((s, i) => ({ segment: s, ...(cutoffs.find((c) => c.segment === s) ?? {}), upper: cutoffs.find((c) => c.segment === SEGMENTS[i - 1])?.min_final ?? null,
    n: Number(counts.find((c) => c.segment === s)?.n ?? 0) }));
  const months = await q('SELECT month, COUNT(*) n FROM monthly_ratings GROUP BY month ORDER BY month DESC');
  res.json({ ...(await list(spec, { ...query, month })), month, stats, ladder, months });
});
performanceRouter.get('/ratings/export', can('ratings.export'), async (req, res) => {
  const query = req.query as Query;
  const month = await monthOf(query);
  const rows = await listAll(ratingSpec(month), { ...query, month });
  const shown = String(query.cols ?? '').split(',').filter(Boolean);
  const pct = (k: string) => (r: any) => (r[k] == null ? null : `${(Number(r[k]) * 100).toFixed(2)}%`);
  const all: Col[] = [{ key: 'segment', label: 'rat.segment' }, { key: 'final_score', label: 'rat.final', value: pct('final_score') }, { key: 'on_time', label: 'rat.on_time', value: pct('on_time') },
    { key: 'fail_rate_score', label: 'rat.fail_rate', value: pct('fail_rate_score') }, { key: 'gross_orders', label: 'rat.gross' }, { key: 'completed', label: 'rat.completed' },
    { key: 'completed_in_time', label: 'rat.in_time' }, { key: 'failed_by_rider', label: 'rat.failed' }, { key: 'verification_requests', label: 'rat.ver_requests' },
    { key: 'verification_success', label: 'rat.ver_success' }, { key: 'verification_rate', label: 'rat.ver_rate', value: pct('verification_rate') },
    { key: 'city', label: 'rat.city' }, { key: 'contract', label: 'rat.contract' }, { key: 'month', label: 'rat.month' }, { key: 'source', label: 'rat.source' }];
  await sendExport(req, res, { format: 'xlsx', title: 'rat.title', rows, filters: month, cols: [{ key: 'rider_id', label: 'riders.rider_id' }, { key: 'full_name', label: 'rat.rider' },
    ...all.filter((c) => !shown.length || shown.includes(c.key))] });
});
performanceRouter.post('/ratings/bulk-delete', can('ratings.delete'), async (req, res) => {
  const ids: number[] = (req.body.ids ?? []).map(Number);
  if (!ids.length) fail(422, 'nothing_selected');
  if (ids.length > 500) fail(422, 'max_500');
  const r = await exec('DELETE FROM monthly_ratings WHERE id IN (?)', [ids]);
  await audit(req, { action: 'ratings.delete', severity: 'warning', details: `${r.affectedRows} ratings` });
  res.json({ deleted: r.affectedRows });
});
// The rider file's "HungerStation monthly rating" card.
performanceRouter.get('/ratings/rider/:id', can('ratings.view'), async (req, res) => {
  const rows = await q<any>(`SELECT m.*, c.min_final floor, (SELECT c2.min_final FROM rating_cutoffs c2 WHERE c2.month = m.month AND c2.segment = CHAR(ASCII(m.segment) - 1)) next_floor
    FROM monthly_ratings m LEFT JOIN rating_cutoffs c ON c.month = m.month AND c.segment = m.segment WHERE m.rider_id = ? ORDER BY m.month`, [req.params.id]);
  res.json(rows);
});

const ratingImport: ImportDef = {
  name: 'ratings', perm: 'ratings.import', matchOn: 'rat.match_on', options: ['create_riders'], maxRows: 50000,
  columns: {
    rider_id: ['riders.rider_id', 'rider_id', 'rider id'], month: ['rat.month', 'month'], segment: ['rat.segment', 'segment'],
    final_score: ['rat.final', 'final score', 'final_score'], on_time: ['rat.on_time', 'on time', 'otd', 'on_time'], fail_rate_score: ['rat.fail_rate', 'fail rate score', 'fr'],
    gross_orders: ['rat.gross', 'gross orders', 'gross'], completed: ['rat.completed', 'completed', 'completed orders'], completed_in_time: ['rat.in_time', 'completed in time'],
    failed_by_rider: ['rat.failed', 'failed by rider', 'rider failed'], verification_requests: ['rat.ver_requests', 'verification requests'],
    verification_success: ['rat.ver_success', 'verification success'], verification_rate: ['rat.ver_rate', 'verification rate'],
    city: ['rat.city', 'city'], contract: ['rat.contract', 'contract', 'contract name'],
  },
  requiredColumns: [['rider_id'], ['month']],
  async parse(row) {
    const s = cellStr(row.rider_id);
    if (!s || !/^\d{1,20}$/.test(s)) return 'no_rider_id';
    const raw = row.month instanceof Date || typeof row.month === 'number' ? cellDate(row.month) : cellStr(row.month);
    const m = String(raw ?? '').match(/^(\d{4})[-/.](\d{1,2})/);
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return 'bad_month';
    const n = (k: string) => { const v = cellNum(typeof row[k] === 'string' ? row[k].replace('%', '') : row[k]); return v == null ? null : v; };
    const r = (k: string) => { const v = n(k); return v == null ? null : rate(v); };
    const d: Record<string, any> = { rider_id: Number(s), month: `${m[1]}-${m[2].padStart(2, '0')}`, segment: cellStr(row.segment, 1)?.toUpperCase() ?? null,
      gross_orders: n('gross_orders'), completed: n('completed'), completed_in_time: n('completed_in_time'), failed_by_rider: n('failed_by_rider'),
      verification_requests: n('verification_requests'), verification_success: n('verification_success'),
      on_time: r('on_time'), fail_rate_score: r('fail_rate_score'), final_score: r('final_score'), verification_rate: r('verification_rate'),
      city: cellStr(row.city, 100), contract: cellStr(row.contract, 150), source: 'file' };
    // missing scores are worked out from the counts
    if (d.on_time == null && d.completed) d.on_time = d.completed_in_time != null ? d.completed_in_time / d.completed : null;
    if (d.fail_rate_score == null && d.gross_orders) d.fail_rate_score = d.failed_by_rider != null ? 1 - d.failed_by_rider / d.gross_orders : null;
    if (d.final_score == null && d.on_time != null && d.fail_rate_score != null) d.final_score = (d.on_time + d.fail_rate_score) / 2;
    if (d.verification_rate == null && d.verification_requests) d.verification_rate = d.verification_success != null ? d.verification_success / d.verification_requests : null;
    for (const k of ['on_time', 'fail_rate_score', 'final_score', 'verification_rate']) if (d[k] != null) d[k] = Math.round(d[k] * 10000) / 10000;
    if (d.segment && !SEGMENTS.includes(d.segment)) d.segment = null;
    return { line: 0, key: `${s}|${d.month}`, data: d, label: `#${s} ${d.month}` };
  },
  async existing(items) {
    const m = new Map<string, any>();
    for (const i of items) { const x = await one('SELECT id FROM monthly_ratings WHERE rider_id = ? AND month = ?', [i.data.rider_id, i.data.month]); if (x) m.set(i.key, x); }
    return m;
  },
  async counts(items: Parsed[]) {
    const ids = [...new Set(items.map((i) => i.data.rider_id))];
    const known = new Set(ids.length ? (await q<any>('SELECT id FROM riders WHERE id IN (?)', [ids])).map((r) => r.id) : []);
    return { unknown_riders: ids.filter((id) => !known.has(id)).length, months: new Set(items.map((i) => i.data.month)).size };
  },
  // a month that already exists is always replaced: the latest data received is the one in effect
  async write(it, ex, ctx) {
    if (!(await ensureRider(it.data.rider_id, ctx, 'Created by the ratings import — complete the details.'))) return 'skipped';
    if (ex) { await exec('UPDATE monthly_ratings SET ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [it.data, ex.id]); return 'replaced'; }
    await exec('INSERT INTO monthly_ratings SET ?', [it.data]);
    return 'inserted';
  },
};
performanceRouter.use('/ratings/import', importRoutes(ratingImport));
export { ratingImport };
