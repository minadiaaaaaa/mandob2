import { Router, type Request } from 'express';
import { exec, one, q, tx } from '../db.js';
import { clean, eq, fail, fieldError, inList, list, listAll, sendExport, today, where, type Query, type Spec } from '../http.js';
import { can } from '../auth.js';
import { audit } from '../audit.js';
import { cellBool, cellDate, cellNum, cellStr, importRoutes, type ImportDef } from '../importer.js';

export const applicantsRouter = Router();

// An applicant "already is a rider" when a rider has the same phone or the same ID number.
const spec: Spec = {
  from: `FROM applicants a LEFT JOIN cities ci ON ci.id = a.city_id
    LEFT JOIN riders hr ON hr.id = a.rider_id
    LEFT JOIN riders mr ON a.rider_id IS NULL AND (mr.phone = a.phone OR (a.national_id IS NOT NULL AND mr.national_id = a.national_id))`,
  select: `a.*, ci.name_ar city_ar, ci.name_en city_en, hr.full_name hired_name, MIN(mr.id) matching_rider_id`,
  groupBy: 'a.id',
  search: ['a.full_name', 'a.name_en', 'a.phone', 'a.national_id', 'CAST(a.id AS CHAR)'],
  filters: {
    status: inList('a.status'), city: eq('a.city_id'),
    featured: (v) => ['a.featured = ?', [v === 'yes' ? 1 : 0]],
    official: (v) => v === 'yes' ? '(a.rider_id IS NOT NULL OR mr.id IS NOT NULL)' : '(a.rider_id IS NULL AND mr.id IS NULL)',
    own_vehicle: (v) => ['a.has_vehicle = ?', [v === 'yes' ? 1 : 0]],
  },
  sorts: { featured: 'a.featured', name: 'a.full_name', phone: 'a.phone', city: 'ci.name_ar', own_vehicle: 'a.has_vehicle', status: 'a.status', official: 'a.rider_id', filed: 'a.created_at' },
  defaultSort: '-filed',
};

const rules = {
  full_name: { req: true, max: 150 }, name_en: { max: 150 }, phone: { req: true, max: 20 }, national_id: { max: 30 }, nationality: { max: 100 },
  birth_date: { type: 'date' as const }, city_id: { type: 'int' as const }, status: { enum: ['new', 'review', 'approved', 'rejected', 'withdrawn'] },
  heard_from: { max: 100 }, featured: { type: 'bool' as const }, featured_reason: { max: 255 }, notes: { max: 500 },
  has_vehicle: { type: 'bool' as const }, vehicle_type: { max: 50 }, vehicle_plate: { max: 30 }, vehicle_maker: { max: 60 }, vehicle_model: { max: 60 },
  vehicle_year: { type: 'int' as const, min: 1950, max: new Date().getFullYear() + 2 },
};

async function checkUnique(v: Record<string, any>, id = 0) {
  if (v.phone) {
    const d = await one<any>('SELECT full_name FROM applicants WHERE phone = ? AND id <> ?', [v.phone, id]);
    if (d) fieldError('phone', 'applicant_phone_taken', { name: d.full_name });
  }
  if (v.national_id) {
    const d = await one<any>('SELECT full_name FROM applicants WHERE national_id = ? AND id <> ?', [v.national_id, id]);
    if (d) fieldError('national_id', 'applicant_nid_taken', { name: d.full_name });
  }
}
function vehicleRules(v: Record<string, any>, before?: any) {
  const has = v.has_vehicle ?? before?.has_vehicle;
  if (has && !(v.vehicle_type ?? before?.vehicle_type)) fieldError('vehicle_type', 'required');
}

applicantsRouter.get('/applicants', can('applicants.view'), async (req, res) => {
  const query = req.query as Query;
  const data = await list(spec, query);
  const w = where(spec, query);
  const [stats] = await q(`SELECT COUNT(*) total, COALESCE(SUM(status IN ('new','review')),0) open, COALESCE(SUM(status = 'new'),0) \`new\`, COALESCE(SUM(status = 'review'),0) review,
    COALESCE(SUM(status = 'approved'),0) approved, COALESCE(SUM(status = 'rejected'),0) rejected, COALESCE(SUM(status = 'hired'),0) hired,
    COALESCE(SUM(status = 'withdrawn'),0) withdrawn, COALESCE(SUM(has_vehicle),0) own_vehicle, COALESCE(SUM(featured),0) featured, COALESCE(SUM(official),0) official
    FROM (SELECT a.status, a.has_vehicle, a.featured, (a.rider_id IS NOT NULL OR MIN(mr.id) IS NOT NULL) official ${spec.from}${w.sql} GROUP BY a.id) t`, w.params);
  res.json({ ...data, stats });
});

applicantsRouter.get('/applicants/export', can('applicants.export'), async (req, res) => {
  await sendExport(req, res, { format: 'xlsx', title: 'applicants.title', rows: await listAll(spec, req.query as Query), cols: [
    { key: 'id', label: 'applicants.application_no' }, { key: 'full_name', label: 'applicants.full_name' }, { key: 'name_en', label: 'applicants.name_en' },
    { key: 'phone', label: 'applicants.phone' }, { key: 'national_id', label: 'applicants.national_id' }, { key: 'nationality', label: 'applicants.nationality' },
    { key: 'birth_date', label: 'applicants.birth_date' }, { key: 'city_ar', label: 'applicants.city' }, { key: 'has_vehicle', label: 'applicants.own_vehicle' },
    { key: 'vehicle_type', label: 'applicants.vehicle_type' }, { key: 'vehicle_plate', label: 'applicants.plate' }, { key: 'vehicle_maker', label: 'applicants.maker' },
    { key: 'vehicle_model', label: 'applicants.model' }, { key: 'vehicle_year', label: 'applicants.year' }, { key: 'heard_from', label: 'applicants.heard_from' },
    { key: 'notes', label: 'common.notes' }, { key: 'status', label: 'applicants.status' }, { key: 'featured', label: 'applicants.featured' },
    { key: 'featured_reason', label: 'applicants.why_featured' }, { key: 'created_at', label: 'applicants.filed_on' },
  ] });
});

applicantsRouter.get('/applicants/:id', can('applicants.view'), async (req, res) => {
  const a = await one<any>(`SELECT a.*, ci.name_ar city_ar, ci.name_en city_en, fu.full_name featured_by_name, ru.full_name reviewed_by_name,
      hr.full_name hired_name, hr.status hired_status, hr.hire_date hired_date
    FROM applicants a LEFT JOIN cities ci ON ci.id = a.city_id LEFT JOIN users fu ON fu.id = a.featured_by LEFT JOIN users ru ON ru.id = a.reviewed_by
    LEFT JOIN riders hr ON hr.id = a.rider_id WHERE a.id = ?`, [req.params.id]);
  if (!a) fail(404, 'not_found');
  const match = a.rider_id ? null : await one('SELECT id, full_name, status FROM riders WHERE phone = ? OR (? IS NOT NULL AND national_id = ?) LIMIT 1', [a.phone, a.national_id, a.national_id]);
  res.json({ ...a, matching_rider: match ?? null });
});

applicantsRouter.post('/applicants', can('applicants.create'), async (req, res) => {
  const { status: _s, ...createRules } = rules;
  const v = clean(req.body, createRules);
  vehicleRules(v);
  await checkUnique(v);
  if (v.featured) Object.assign(v, { featured_by: req.user!.id, featured_at: new Date() });
  const r = await exec('INSERT INTO applicants SET ?', [{ ...v, status: 'new' }]);
  await audit(req, { action: 'applicant.create', entity_type: 'applicant', entity_id: r.insertId, after: v });
  res.json({ id: r.insertId });
});

applicantsRouter.patch('/applicants/:id', can('applicants.update'), async (req, res) => {
  const before = await one<any>('SELECT * FROM applicants WHERE id = ?', [req.params.id]);
  if (!before) fail(404, 'not_found');
  const v = clean(req.body, rules, true);
  if (before.status === 'hired') delete v.status; // only hiring or linking writes "hired"
  vehicleRules(v, before);
  await checkUnique(v, before.id);
  if (v.status && v.status !== before.status) Object.assign(v, { reviewed_by: req.user!.id, reviewed_at: new Date() });
  if (v.featured !== undefined && v.featured !== before.featured) Object.assign(v, v.featured ? { featured_by: req.user!.id, featured_at: new Date() } : { featured_by: null, featured_at: null });
  await exec('UPDATE applicants SET ? WHERE id = ?', [v, before.id]);
  await audit(req, { action: 'applicant.update', entity_type: 'applicant', entity_id: before.id, before, after: v });
  res.json({ ok: true });
});

applicantsRouter.post('/applicants/:id/feature', can('applicants.update'), async (req, res) => {
  const on = req.body.featured ? 1 : 0;
  await exec('UPDATE applicants SET featured = ?, featured_by = ?, featured_at = ? WHERE id = ?', [on, on ? req.user!.id : null, on ? new Date() : null, req.params.id]);
  await audit(req, { action: on ? 'applicant.feature' : 'applicant.unfeature', entity_type: 'applicant', entity_id: req.params.id });
  res.json({ ok: true });
});

function ids(req: Request) {
  const list: number[] = (req.body.ids ?? []).map(Number);
  if (!list.length) fail(422, 'nothing_selected');
  if (list.length > 200) fail(422, 'max_200');
  return list;
}
applicantsRouter.post('/applicants/bulk-feature', can('applicants.update'), async (req, res) => {
  const list = ids(req);
  const on = req.body.featured ? 1 : 0;
  await exec('UPDATE applicants SET featured = ?, featured_by = ?, featured_at = ? WHERE id IN (?)', [on, on ? req.user!.id : null, on ? new Date() : null, list]);
  res.json({ updated: list.length });
});
applicantsRouter.post('/applicants/bulk-status', can('applicants.update'), async (req, res) => {
  const list = ids(req);
  const status = req.body.status;
  if (!rules.status.enum.includes(status)) fail(422, 'invalid');
  const [{ n }] = await q<{ n: number }>("SELECT COUNT(*) n FROM applicants WHERE id IN (?) AND status = 'hired'", [list]);
  if (n) fail(409, 'applicant_hired_in_selection');
  await exec('UPDATE applicants SET status = ?, reviewed_by = ?, reviewed_at = UTC_TIMESTAMP() WHERE id IN (?)', [status, req.user!.id, list]);
  await audit(req, { action: 'applicant.bulk_status', entity_type: 'applicant', details: `${list.length} → ${status}` });
  res.json({ updated: list.length });
});
async function deleteApplicants(req: Request, list: number[]) {
  const [{ n }] = await q<{ n: number }>("SELECT COUNT(*) n FROM applicants WHERE id IN (?) AND status = 'hired'", [list]);
  if (n) fail(409, 'applicant_hired_in_selection');
  await exec('DELETE FROM applicants WHERE id IN (?)', [list]);
  for (const id of list) await audit(req, { action: 'applicant.delete', entity_type: 'applicant', entity_id: id, severity: 'warning' });
}
applicantsRouter.delete('/applicants/:id', can('applicants.delete'), async (req, res) => {
  await deleteApplicants(req, [Number(req.params.id)]);
  res.json({ ok: true });
});
applicantsRouter.post('/applicants/bulk-delete', can('applicants.delete'), async (req, res) => {
  await deleteApplicants(req, ids(req));
  res.json({ ok: true });
});

// Hire: turns an approved applicant into a rider. Same rules as adding a rider.
applicantsRouter.post('/applicants/:id/hire', can('applicants.hire'), can('riders.create'), async (req, res) => {
  const a = await one<any>('SELECT * FROM applicants WHERE id = ?', [req.params.id]);
  if (!a) fail(404, 'not_found');
  if (a.status !== 'approved' || a.rider_id) fail(409, 'applicant_not_approved');
  const idRaw = String(req.body.rider_id ?? '').trim();
  if (!/^\d{1,20}$/.test(idRaw)) fieldError('rider_id', 'rider_id_digits');
  const riderId = Number(idRaw);
  const taken = await one<any>('SELECT full_name FROM riders WHERE id = ?', [riderId]);
  if (taken) fieldError('rider_id', 'rider_id_taken', { name: taken.full_name });
  if (a.national_id) {
    const dup = await one<any>('SELECT full_name FROM riders WHERE national_id = ?', [a.national_id]);
    if (dup) fieldError('rider_id', 'national_id_taken', { name: dup.full_name });
  }
  const city = req.body.city_id ? Number(req.body.city_id) : a.city_id;
  const day = await today();
  await tx(async () => {
    await exec('INSERT INTO riders SET ?', [{
      id: riderId, full_name: a.full_name, name_en: a.name_en, national_id: a.national_id, nationality: a.nationality, birth_date: a.birth_date,
      phone: a.phone, city_id: city, status: 'active', hire_date: day, notes: [a.notes, `Application #${a.id}`].filter(Boolean).join(' — ').slice(0, 500),
    }]);
    await exec("UPDATE applicants SET status = 'hired', rider_id = ?, reviewed_by = ?, reviewed_at = UTC_TIMESTAMP() WHERE id = ?", [riderId, req.user!.id, a.id]);
  });
  await audit(req, { action: 'applicant.hire', entity_type: 'applicant', entity_id: a.id, after: { rider_id: riderId } });
  res.json({ rider_id: riderId });
});

// Link to a rider who already exists: closes the application as hired without creating a second rider.
applicantsRouter.post('/applicants/:id/link', can('applicants.hire'), async (req, res) => {
  const a = await one<any>('SELECT * FROM applicants WHERE id = ?', [req.params.id]);
  if (!a || a.rider_id) fail(409, 'invalid');
  const r = await one<any>('SELECT id FROM riders WHERE phone = ? OR (? IS NOT NULL AND national_id = ?) LIMIT 1', [a.phone, a.national_id, a.national_id]);
  if (!r) fail(409, 'invalid');
  await exec("UPDATE applicants SET status = 'hired', rider_id = ?, reviewed_by = ?, reviewed_at = UTC_TIMESTAMP() WHERE id = ?", [r.id, req.user!.id, a.id]);
  await audit(req, { action: 'applicant.link', entity_type: 'applicant', entity_id: a.id, after: { rider_id: r.id } });
  res.json({ rider_id: r.id });
});

const STATUS_IN: Record<string, string> = {
  new: 'new', 'جديد': 'new', review: 'review', 'under review': 'review', 'قيد المراجعة': 'review', approved: 'approved', 'مقبول': 'approved',
  rejected: 'rejected', 'مرفوض': 'rejected', withdrawn: 'withdrawn', 'منسحب': 'withdrawn',
};
const applicantImport: ImportDef = {
  name: 'applicants', perm: 'applicants.import', matchOn: 'applicants.phone',
  columns: {
    full_name: ['applicants.full_name', 'full name', 'name'], name_en: ['applicants.name_en'], phone: ['applicants.phone', 'phone', 'mobile'],
    national_id: ['applicants.national_id', 'id number'], nationality: ['applicants.nationality'], birth_date: ['applicants.birth_date'],
    city: ['applicants.city', 'city'], has_vehicle: ['applicants.own_vehicle', 'has own vehicle'], vehicle_type: ['applicants.vehicle_type'],
    vehicle_plate: ['applicants.plate'], vehicle_maker: ['applicants.maker'], vehicle_model: ['applicants.model'], vehicle_year: ['applicants.year'],
    heard_from: ['applicants.heard_from'], notes: ['common.notes', 'notes'], status: ['applicants.status', 'status'],
    featured: ['applicants.featured'], featured_reason: ['applicants.why_featured'],
  },
  requiredColumns: [['phone']],
  async parse(row, ctx) {
    const phone = cellStr(row.phone, 20);
    if (!phone) return 'no_key';
    const d: Record<string, any> = { phone };
    for (const k of ['full_name', 'name_en', 'national_id', 'nationality', 'vehicle_type', 'vehicle_plate', 'vehicle_maker', 'vehicle_model', 'heard_from', 'notes', 'featured_reason']) {
      if (ctx.present.has(k)) d[k] = cellStr(row[k], k === 'notes' ? 500 : 150);
    }
    if (ctx.present.has('birth_date')) { const x = cellDate(row.birth_date); if (x === undefined) return 'invalid_value'; d.birth_date = x; }
    if (ctx.present.has('vehicle_year')) { const y = cellNum(row.vehicle_year); if (y === undefined) return 'invalid_value'; d.vehicle_year = y; }
    if (ctx.present.has('has_vehicle')) d.has_vehicle = cellBool(row.has_vehicle);
    if (ctx.present.has('featured')) d.featured = cellBool(row.featured);
    if (ctx.present.has('status')) { const s = cellStr(row.status)?.toLowerCase(); if (s && !STATUS_IN[s]) return 'invalid_value'; d.status = s ? STATUS_IN[s] : null; }
    if (ctx.present.has('city')) {
      const n = cellStr(row.city);
      d.city_id = n ? (await one<{ id: number }>('SELECT id FROM cities WHERE name_ar = ? OR name_en = ?', [n, n]))?.id ?? null : null;
    }
    return { line: 0, key: phone, data: d, label: d.full_name ?? phone };
  },
  async existing(items) {
    const m = new Map<string, any>();
    if (items.length) for (const r of await q('SELECT * FROM applicants WHERE phone IN (?)', [items.map((i) => i.key)])) m.set(r.phone, r);
    return m;
  },
  async check(it, ex) {
    if (!ex && !it.data.full_name) return 'new_without_name';
    if (it.data.national_id && (await one('SELECT 1 FROM applicants WHERE national_id = ? AND phone <> ?', [it.data.national_id, it.key]))) return 'national_id_in_use';
    return null;
  },
  async write(it, ex, ctx) {
    const values = Object.fromEntries(Object.entries(it.data).filter(([, v]) => v !== null && v !== undefined));
    if (ex) {
      if (ctx.mode === 'skip') return 'skipped';
      if (ex.status === 'hired') delete values.status;
      await exec('UPDATE applicants SET ? WHERE id = ?', [values, ex.id]);
      return 'replaced';
    }
    await exec('INSERT INTO applicants SET ?', [{ status: 'new', ...values }]);
    return 'inserted';
  },
};
applicantsRouter.use('/applicants/import', importRoutes(applicantImport));
