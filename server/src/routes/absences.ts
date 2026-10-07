import { Router } from 'express';
import { exec, one, q } from '../db.js';
import { clean, eq, fail, list, listAll, sendExport, where, type Query, type Spec } from '../http.js';
import { can } from '../auth.js';
import { audit } from '../audit.js';
import { cellBool, cellNum, cellStr, importRoutes, type ImportDef } from '../importer.js';

// 3.2 Rider absences: the delivery company's record. Everything but the internal note is the company's.
export const absencesRouter = Router();

const LETTER = `(SELECT l.id FROM leaves l WHERE l.rider_id = a.rider_id AND l.status IN ('approved','pending')
  AND l.start_date <= DATE(a.end_at) AND l.end_date >= DATE(a.start_at) ORDER BY l.start_date LIMIT 1)`;
const spec: Spec = {
  from: 'FROM rider_absences a JOIN riders r ON r.id = a.rider_id LEFT JOIN companies co ON co.id = r.company_id',
  select: `a.*, ROUND(a.days) days_whole, r.full_name, co.name company_name, ${LETTER} leave_id,
    (SELECT letter_no FROM leaves WHERE id = ${LETTER}) letter_no`,
  search: ['r.full_name', 'CAST(r.id AS CHAR)', 'a.reason', 'a.status', 'a.internal_note'],
  filters: {
    from: (v) => ['a.end_at >= ?', [v]], to: (v) => ['a.start_at < DATE_ADD(?, INTERVAL 1 DAY)', [v]],
    reason: (v) => (v === 'other' ? ["(a.reason IS NULL OR UPPER(a.reason) NOT IN ('VACATION','SICKNESS'))", []] : ['UPPER(a.reason) = ?', [v.toUpperCase()]]),
    paid: (v) => ['a.paid = ?', [v === 'paid' ? 1 : 0]], rider: eq('a.rider_id'),
  },
  sorts: { start: 'a.start_at', rider: 'r.full_name', days: 'a.days' },
  defaultSort: '-start',
};

absencesRouter.get('/absences', can('absences.view'), async (req, res) => {
  const query = req.query as Query;
  const w = where(spec, query);
  // the cards and the charts follow the filter and the search
  const [stats] = await q(`SELECT COUNT(*) absences, COALESCE(ROUND(SUM(a.days)),0) days, COALESCE(SUM(a.paid = 0),0) unpaid,
    COALESCE(ROUND(SUM(CASE WHEN a.paid = 0 THEN a.days END)),0) unpaid_days, COUNT(DISTINCT a.rider_id) riders ${spec.from}${w.sql}`, w.params);
  const months = await q(`SELECT DATE_FORMAT(a.start_at, '%Y-%m') m, ROUND(SUM(a.days)) days ${spec.from}${w.sql} GROUP BY m ORDER BY m DESC LIMIT 12`, w.params);
  const reasons = await q(`SELECT COALESCE(UPPER(a.reason), 'OTHER') reason, ROUND(SUM(a.days)) days ${spec.from}${w.sql} GROUP BY 1 ORDER BY days DESC LIMIT 8`, w.params);
  res.json({ ...(await list(spec, query)), stats, charts: { months: months.reverse(), reasons } });
});

absencesRouter.get('/absences/export', can('absences.view'), async (req, res) => {
  const query = req.query as Query;
  const rows = await listAll(spec, query);
  const sum = (f: (r: any) => number) => rows.reduce((s: number, r: any) => s + f(r), 0);
  await sendExport(req, res, {
    format: query.format === 'csv' ? 'csv' : 'xlsx', title: 'abs.title', rows,
    summary: [['abs.s.absences', rows.length], ['abs.s.days', Math.round(sum((r) => Number(r.days)))], ['abs.s.unpaid', sum((r) => (r.paid === 0 ? 1 : 0))],
      ['abs.s.no_letter', sum((r) => (r.leave_id ? 0 : 1))]],
    cols: [
      { key: 'rider_id', label: 'riders.rider_id' }, { key: 'full_name', label: 'abs.rider' }, { key: 'company_name', label: 'riders.company' },
      { key: 'start_at', label: 'abs.start' }, { key: 'end_at', label: 'abs.end' }, { key: 'days_whole', label: 'abs.days' }, { key: 'reason', label: 'abs.reason' },
      { key: 'paid', label: 'abs.paid', value: (r) => (r.paid == null ? null : r.paid ? 'Paid' : 'Unpaid'), fill: (r) => (r.paid === 0 ? 'amber' : null) },
      { key: 'status', label: 'abs.company_status' }, { key: 'letter_no', label: 'abs.leave_letter', fill: (r) => (r.leave_id ? null : 'red') },
      { key: 'company_comment', label: 'abs.company_comment' }, { key: 'internal_note', label: 'abs.internal_note' },
    ],
  });
});

absencesRouter.patch('/absences/:id/note', can('absences.manage'), async (req, res) => {
  const v = clean(req.body, { internal_note: { max: 500 } }, true);
  const r = await exec('UPDATE rider_absences SET internal_note = ? WHERE id = ?', [v.internal_note ?? null, req.params.id]);
  if (!r.affectedRows) fail(404, 'not_found');
  await audit(req, { action: 'absence.note', entity_type: 'absence', entity_id: req.params.id as string, after: v });
  res.json({ ok: true });
});

absencesRouter.delete('/absences/:id', can('absences.manage'), async (req, res) => {
  const a = await one('SELECT * FROM rider_absences WHERE id = ?', [req.params.id]);
  if (!a) fail(404, 'not_found');
  await exec('DELETE FROM rider_absences WHERE id = ?', [req.params.id]);
  await audit(req, { action: 'absence.delete', entity_type: 'absence', entity_id: req.params.id as string, before: a, severity: 'warning' });
  res.json({ ok: true });
});

// ---------- import: the company's report or the template ----------
const dt = (v: any): string | null | undefined => {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace('T', ' ');
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 19).replace('T', ' ');
  const s = cellStr(v);
  const m = s?.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return undefined;
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')} ${(m[4] ?? '0').padStart(2, '0')}:${m[5] ?? '00'}:${m[6] ?? '00'}`;
};
export const absenceImport: ImportDef = {
  name: 'absences', perm: 'absences.import', matchOn: 'abs.match_on', options: ['create_riders'],
  columns: {
    rider_id: ['riders.rider_id', 'rider id', 'rider_id', 'riderid'], start: ['abs.start', 'absence start', 'start', 'start_at', 'from'],
    end: ['abs.end', 'absence end', 'end', 'end_at', 'to'], external_id: ['abs.number', 'absence id', 'absence number', 'id'],
    days: ['abs.days', 'days', 'number of days', 'duration'], reason: ['abs.reason', 'reason'], paid: ['abs.paid', 'paid', 'is paid'],
    status: ['abs.company_status', 'status'], contract: ['abs.contract', 'company', 'contract'], comment: ['abs.company_comment', 'comment', 'company comment'],
    internal_note: ['abs.internal_note', 'internal note'],
  },
  requiredColumns: [['rider_id'], ['start'], ['end']],
  async parse(row) {
    const rid = cellStr(row.rider_id);
    if (!rid || !/^\d{1,20}$/.test(rid)) return 'no_key';
    const start = dt(row.start);
    if (!start) return 'invalid_value';
    let end = dt(row.end);
    if (end === undefined) return 'invalid_value';
    end ??= start.slice(0, 10) + ' 23:59:59'; // an empty end is a single day
    if (end < start) return 'end_before_start';
    const days = cellNum(row.days) ?? (Date.parse(end.replace(' ', 'T')) - Date.parse(start.replace(' ', 'T'))) / 86400000;
    if (days === undefined || days < 0) return 'invalid_value';
    const ext = cellStr(row.external_id, 60);
    const data = {
      rider_id: Number(rid), start_at: start, end_at: end, days: Math.round(days * 1000) / 1000, external_id: ext,
      reason: cellStr(row.reason, 40), paid: cellBool(row.paid), status: cellStr(row.status, 40), contract: cellStr(row.contract, 150),
      company_comment: cellStr(row.comment, 500), internal_note: cellStr(row.internal_note, 500),
    };
    return { line: 0, key: ext ? `x:${ext}` : `r:${rid}:${start}:${end}`, data, label: `#${rid} ${start.slice(0, 10)}` };
  },
  async existing(items) {
    const m = new Map<string, any>();
    const exts = items.map((i) => i.data.external_id).filter(Boolean);
    if (exts.length) for (const a of await q('SELECT * FROM rider_absences WHERE external_id IN (?)', [exts])) m.set(`x:${a.external_id}`, a);
    for (const i of items.filter((x) => !x.data.external_id)) {
      const a = await one('SELECT * FROM rider_absences WHERE rider_id = ? AND start_at = ? AND end_at = ? AND external_id IS NULL', [i.data.rider_id, i.data.start_at, i.data.end_at]);
      if (a) m.set(i.key, a);
    }
    return m;
  },
  async check(it, _ex, ctx) {
    if (ctx.options.create_riders) return null;
    return (await one('SELECT 1 FROM riders WHERE id = ?', [it.data.rider_id])) ? null : 'rider_not_registered';
  },
  async counts(items, existing, ctx): Promise<Record<string, number>> {
    if (!ctx.options.create_riders) return {};
    const ids = [...new Set(items.map((i) => i.data.rider_id))];
    const known = new Set((await q<any>('SELECT id FROM riders WHERE id IN (?)', [ids.length ? ids : [0]])).map((r) => r.id));
    return { new_riders: ids.filter((id) => !known.has(id)).length, matched: existing.size };
  },
  async write(it, ex, ctx) {
    const { internal_note, ...data } = it.data;
    if (ex) {
      if (ctx.mode === 'skip') return 'skipped';
      // replacing never touches the office's internal note
      await exec('UPDATE rider_absences SET ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [data, ex.id]);
      return 'replaced';
    }
    if (!(await one('SELECT 1 FROM riders WHERE id = ?', [data.rider_id]))) {
      if (!ctx.options.create_riders) return 'skipped';
      // a temporary name; the note asks for the details to be completed
      await exec("INSERT INTO riders (id, full_name, status, notes) VALUES (?, ?, 'active', ?)", [data.rider_id, `Rider ${data.rider_id}`, 'Created by the absences import — complete the details.']);
    }
    await exec('INSERT INTO rider_absences SET ?', [{ ...data, internal_note }]);
    return 'inserted';
  },
};
absencesRouter.use('/absences/import', importRoutes(absenceImport));
