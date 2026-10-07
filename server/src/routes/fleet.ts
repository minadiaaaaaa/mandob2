import { Router, type Request } from 'express';
import { exec, one, q, tx } from '../db.js';
import { HttpError, clean, eq, fail, fieldError, inList, list, listAll, plateKey, sendExport, today, where, type Query, type Spec } from '../http.js';
import { can, has } from '../auth.js';
import { audit } from '../audit.js';
import { claimScan } from '../scans.js';
import { cellDate, cellNum, cellStr, importRoutes, type ImportDef } from '../importer.js';

export const fleetRouter = Router();
const expiryDays = (col: string, day: string) => `DATEDIFF(${col}, '${day}')`;

// The renewal log (chapter 5) is written by the renew actions of the fleet screens too.
export async function logRenewal(req: Request, r: {
  doc_kind: string; doc_id: number; new_doc_id?: number | null; owner_type: 'rider' | 'vehicle' | 'organization'; owner_label: string | null;
  previous_number?: string | null; new_number?: string | null; previous_expiry: string | null; new_expiry: string; operation?: string;
  renewal_date?: string; cost?: number | null; reference?: string | null; notes?: string | null;
}) {
  const res = await exec('INSERT INTO renewals SET ?', [{ operation: 'renewal', renewal_date: await today(), ...r, recorded_by: req.user!.id }]);
  await audit(req, { action: 'renewal.create', entity_type: r.doc_kind, entity_id: r.doc_id, after: r });
  return res.insertId;
}
const renewRules = {
  new_expiry: { req: true, type: 'date' as const }, new_issue: { type: 'date' as const }, new_number: { max: 100 },
  operation: { enum: ['renewal', 'replacement', 'reissue', 'correction'] }, cost: { type: 'num' as const, min: 0 }, reference: { max: 100 }, notes: { max: 500 },
};

// ======================================================================== vehicles
const VEHICLE_RULES = {
  plate: { req: true, max: 30 }, plate_en: { max: 30 }, vehicle_type: { req: true, max: 50 }, registration_type: { max: 60 }, maker: { max: 60 },
  model: { max: 60 }, color: { max: 40 }, year: { type: 'int' as const, min: 1900, max: new Date().getFullYear() + 1 }, chassis: { max: 30 },
  weight: { type: 'int' as const, min: 0, max: 99999 }, capacity: { type: 'int' as const, min: 0, max: 999 },
  ownership: { enum: ['owned', 'rented'] }, status: { enum: ['active', 'maintenance', 'retired'] }, odometer: { type: 'int' as const, min: 0 },
};

function vehicleSpec(day: string): Spec {
  return {
    from: `FROM vehicles v LEFT JOIN operation_card_vehicles ocv ON ocv.vehicle_id = v.id AND ocv.is_current = 1 LEFT JOIN operation_cards oc ON oc.id = ocv.card_id`,
    select: `v.*, oc.id card_id, oc.number card_number, oc.expiry_date card_expiry, ${expiryDays('oc.expiry_date', day)} card_days,
      (SELECT COUNT(*) FROM operation_card_vehicles WHERE card_id = oc.id) card_vehicles,
      (SELECT GROUP_CONCAT(CONCAT(r.id, '\t', r.full_name) SEPARATOR '\n') FROM vehicle_assignments a JOIN riders r ON r.id = a.rider_id WHERE a.vehicle_id = v.id AND a.is_current = 1) riders`,
    search: [
      'v.plate', 'v.plate_en', (s) => ['v.plate_key LIKE ?', [`%${plateKey(s)}%`]], 'v.maker', 'v.model', 'v.chassis',
      'v.id IN (SELECT x.vehicle_id FROM operation_card_vehicles x JOIN operation_cards y ON y.id = x.card_id WHERE y.number LIKE ?)',
      'v.id IN (SELECT vehicle_id FROM vehicle_registrations WHERE serial LIKE ?)',
      (s) => ['v.id IN (SELECT a.vehicle_id FROM vehicle_assignments a JOIN riders r ON r.id = a.rider_id WHERE a.is_current = 1 AND (r.full_name LIKE ? OR CAST(r.id AS CHAR) LIKE ?))', [`%${s}%`, `%${s}%`]],
    ],
    filters: {
      status: inList('v.status'), type: eq('v.vehicle_type'), ownership: eq('v.ownership'), maker: eq('v.maker'), registration_type: eq('v.registration_type'),
      assignment: (v) => `${v === 'assigned' ? '' : 'NOT '}EXISTS (SELECT 1 FROM vehicle_assignments a WHERE a.vehicle_id = v.id AND a.is_current = 1)`,
      card: (v) => v === 'yes' ? 'oc.id IS NOT NULL' : 'oc.id IS NULL',
    },
    sorts: { plate: 'v.plate', year: 'v.year', status: 'v.status', ownership: 'v.ownership', make: 'v.maker', card: 'oc.expiry_date' },
    defaultSort: 'plate',
  };
}

async function vehicleUnique(v: Record<string, any>, id = 0) {
  if (v.plate) {
    const d = await one<any>('SELECT id, plate FROM vehicles WHERE plate_key = ? AND id <> ?', [plateKey(v.plate), id]);
    if (d) fieldError('plate', 'plate_taken', { plate: d.plate, id: d.id });
  }
  if (v.plate_en) {
    const d = await one<any>('SELECT id, plate FROM vehicles WHERE plate_en = ? AND id <> ?', [v.plate_en, id]);
    if (d) fieldError('plate_en', 'plate_taken', { plate: d.plate, id: d.id });
  }
  if (v.chassis && !/^[A-Za-z0-9]{5,30}$/.test(v.chassis)) fieldError('chassis', 'chassis_format');
}
function normalizeVehicle(v: Record<string, any>) {
  if (v.plate) v.plate_key = plateKey(v.plate);
  if (v.plate_en) v.plate_en = v.plate_en.replace(/\s+/g, '').toUpperCase();
  if ('odometer' in v && v.odometer === null) v.odometer = 0;
  return v;
}

// Makes the card current for a vehicle; its previous card stays as "Previous".
async function linkCard(cardId: number, vehicleId: number) {
  await exec('UPDATE operation_card_vehicles SET is_current = 0 WHERE vehicle_id = ? AND card_id <> ?', [vehicleId, cardId]);
  await exec('INSERT INTO operation_card_vehicles (card_id, vehicle_id, is_current) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE is_current = 1', [cardId, vehicleId]);
}
async function linkRegistration(regId: number, vehicleId: number) {
  await exec('UPDATE vehicle_registrations SET is_current = 0 WHERE vehicle_id = ? AND id <> ?', [vehicleId, regId]);
  await exec('UPDATE vehicle_registrations SET vehicle_id = ?, is_current = 1 WHERE id = ?', [vehicleId, regId]);
}

fleetRouter.get('/vehicles', can('vehicles.view'), async (req, res) => {
  const day = await today();
  const spec = vehicleSpec(day);
  const query = req.query as Query;
  const w = where(spec, query);
  const cd = expiryDays('oc.expiry_date', day);
  const [stats] = await q(`SELECT COUNT(*) total, COALESCE(SUM(v.status='active'),0) active, COALESCE(SUM(v.status='maintenance'),0) maintenance,
    COALESCE(SUM(v.status='retired'),0) retired, COALESCE(SUM(v.ownership='owned'),0) owned, COALESCE(SUM(v.ownership='rented'),0) rented,
    COALESCE(SUM(EXISTS (SELECT 1 FROM vehicle_assignments a WHERE a.vehicle_id = v.id AND a.is_current = 1)),0) with_rider,
    COALESCE(SUM(${cd} BETWEEN 0 AND 30),0) cards_soon, COALESCE(SUM(${cd} < 0),0) cards_expired ${spec.from}${w.sql}`, w.params);
  const facets = await q(`SELECT DISTINCT vehicle_type t, maker m, registration_type rt FROM vehicles`);
  res.json({ ...(await list(spec, query)), stats: { ...stats, unassigned: stats.total - stats.with_rider },
    facets: { types: [...new Set(facets.map((f: any) => f.t).filter(Boolean))], makers: [...new Set(facets.map((f: any) => f.m).filter(Boolean))], registration_types: [...new Set(facets.map((f: any) => f.rt).filter(Boolean))] } });
});

fleetRouter.get('/vehicles/export', can('vehicles.export'), async (req, res) => {
  const rows = await listAll(vehicleSpec(await today()), req.query as Query);
  await sendExport(req, res, { format: 'xlsx', title: 'vehicles.title', rows, cols: [
    { key: 'plate', label: 'vehicles.plate' }, { key: 'plate_en', label: 'vehicles.plate_en' }, { key: 'registration_type', label: 'vehicles.registration_type' },
    { key: 'vehicle_type', label: 'vehicles.type' }, { key: 'maker', label: 'vehicles.maker' }, { key: 'model', label: 'vehicles.model' }, { key: 'color', label: 'vehicles.color' },
    { key: 'year', label: 'vehicles.year' }, { key: 'chassis', label: 'vehicles.chassis' }, { key: 'weight', label: 'vehicles.weight' }, { key: 'capacity', label: 'vehicles.capacity' },
    { key: 'ownership', label: 'vehicles.ownership' }, { key: 'odometer', label: 'vehicles.odometer' }, { key: 'status', label: 'vehicles.status' },
    { key: 'riders', label: 'vehicles.current_rider', value: (r) => r.riders?.split('\n').map((x: string) => x.split('\t')[1]).join(', ') },
    { key: 'card_number', label: 'vehicles.card' }, { key: 'card_expiry', label: 'vehicles.card_expiry', fill: (r) => r.card_days == null ? null : r.card_days < 0 ? 'red' : r.card_days <= 30 ? 'amber' : 'green' },
  ] });
});

fleetRouter.get('/vehicles/options', can('vehicles.view', 'operation_cards.view', 'vehicle_registrations.view', 'vehicle_insurance.view', 'vehicle_assignments.view', 'fuel_cards.view', 'oil_changes.view'), async (_req, res) => {
  res.json(await q(`SELECT v.id, v.plate, v.plate_en, v.maker, v.model, v.vehicle_type, v.status, a.rider_id holder_id, r.full_name holder_name,
      (SELECT 1 FROM oil_schedules WHERE vehicle_id = v.id) has_schedule
    FROM vehicles v LEFT JOIN vehicle_assignments a ON a.vehicle_id = v.id AND a.is_current = 1 LEFT JOIN riders r ON r.id = a.rider_id ORDER BY v.plate`));
});

fleetRouter.get('/vehicles/:id', can('vehicles.view'), async (req, res) => {
  const day = await today();
  const v = await one<any>('SELECT * FROM vehicles WHERE id = ?', [req.params.id]);
  if (!v) fail(404, 'not_found');
  const riders = await q(`SELECT r.id, r.full_name, r.phone, a.start_date FROM vehicle_assignments a JOIN riders r ON r.id = a.rider_id WHERE a.vehicle_id = ? AND a.is_current = 1`, [v.id]);
  const card = await one<any>(`SELECT oc.*, ${expiryDays('oc.expiry_date', day)} days_left, (SELECT COUNT(*) FROM operation_card_vehicles WHERE card_id = oc.id) vehicles
    FROM operation_card_vehicles x JOIN operation_cards oc ON oc.id = x.card_id WHERE x.vehicle_id = ? AND x.is_current = 1`, [v.id]);
  const registration = await one<any>(`SELECT *, ${expiryDays('expiry_date', day)} days_left FROM vehicle_registrations WHERE vehicle_id = ? AND is_current = 1`, [v.id]);
  const cardVehicles = card ? await q(`SELECT v2.id, v2.plate, v2.maker, v2.model, x.is_current,
      (SELECT GROUP_CONCAT(r.full_name SEPARATOR ', ') FROM vehicle_assignments a JOIN riders r ON r.id = a.rider_id WHERE a.vehicle_id = v2.id AND a.is_current = 1) riders,
      (SELECT serial FROM vehicle_registrations WHERE vehicle_id = v2.id AND is_current = 1 LIMIT 1) registration
    FROM operation_card_vehicles x JOIN vehicles v2 ON v2.id = x.vehicle_id WHERE x.card_id = ? ORDER BY v2.plate`, [card.id]) : [];
  res.json({ ...v, riders, card, registration, card_vehicles: cardVehicles });
});

fleetRouter.post('/vehicles', can('vehicles.create'), async (req, res) => {
  const v = normalizeVehicle(clean(req.body, VEHICLE_RULES));
  await vehicleUnique(v);
  const body = req.body;
  if (body.card && !has(req, 'operation_cards.create')) fail(403, 'forbidden', { perm: 'operation_cards.create' });
  if (body.current_card_id && !has(req, 'operation_cards.update')) fail(403, 'forbidden', { perm: 'operation_cards.update' });
  if (body.current_registration_id && !has(req, 'vehicle_registrations.update')) fail(403, 'forbidden', { perm: 'vehicle_registrations.update' });
  // The vehicle and its card are created together: if one fails, neither is saved.
  const out = await tx(async () => {
    const r = await exec('INSERT INTO vehicles SET ?', [{ ownership: 'owned', status: 'active', odometer: 0, ...v }]);
    let cardId: number | null = null;
    if (body.card) cardId = await createCard(req, body.card, [r.insertId]);
    else if (body.current_card_id) await linkCard(Number(body.current_card_id), r.insertId);
    if (body.current_registration_id) await linkRegistration(Number(body.current_registration_id), r.insertId);
    return { id: r.insertId, card_id: cardId };
  });
  await audit(req, { action: 'vehicle.create', entity_type: 'vehicle', entity_id: out.id, after: v });
  res.json(out);
});

fleetRouter.patch('/vehicles/:id', can('vehicles.update'), async (req, res) => {
  const id = Number(req.params.id);
  const before = await one<any>('SELECT * FROM vehicles WHERE id = ?', [id]);
  if (!before) fail(404, 'not_found');
  const v = normalizeVehicle(clean(req.body, VEHICLE_RULES, true));
  await vehicleUnique(v, id);
  await tx(async () => {
    if (Object.keys(v).length) await exec('UPDATE vehicles SET ? WHERE id = ?', [v, id]);
    if (req.body.current_card_id) { if (!has(req, 'operation_cards.update')) fail(403, 'forbidden', { perm: 'operation_cards.update' }); await linkCard(Number(req.body.current_card_id), id); }
    if (req.body.current_registration_id) { if (!has(req, 'vehicle_registrations.update')) fail(403, 'forbidden', { perm: 'vehicle_registrations.update' }); await linkRegistration(Number(req.body.current_registration_id), id); }
  });
  await audit(req, { action: 'vehicle.update', entity_type: 'vehicle', entity_id: id, before, after: v });
  res.json({ ok: true });
});

fleetRouter.post('/vehicles/:id/maintenance', can('vehicles.deactivate'), async (req, res) => {
  await exec("UPDATE vehicles SET status = 'maintenance' WHERE id = ?", [req.params.id]);
  await audit(req, { action: 'vehicle.maintenance', entity_type: 'vehicle', entity_id: req.params.id });
  res.json({ ok: true });
});
fleetRouter.post('/vehicles/:id/service', can('vehicles.activate'), async (req, res) => {
  await exec("UPDATE vehicles SET status = 'active' WHERE id = ?", [req.params.id]);
  await audit(req, { action: 'vehicle.return_to_service', entity_type: 'vehicle', entity_id: req.params.id });
  res.json({ ok: true });
});

async function vehicleBlockers(ids: number[]) {
  return q<{ vehicle_id: number; what: string; n: number }>(`
    SELECT vehicle_id, 'operation_cards' what, COUNT(*) n FROM operation_card_vehicles WHERE vehicle_id IN (?) GROUP BY vehicle_id UNION ALL
    SELECT vehicle_id, 'assignments', COUNT(*) FROM vehicle_assignments WHERE vehicle_id IN (?) GROUP BY vehicle_id UNION ALL
    SELECT vehicle_id, 'insurance', COUNT(*) FROM vehicle_insurance WHERE vehicle_id IN (?) GROUP BY vehicle_id UNION ALL
    SELECT vehicle_id, 'registrations', COUNT(*) FROM vehicle_registrations WHERE vehicle_id IN (?) GROUP BY vehicle_id UNION ALL
    SELECT vehicle_id, 'fuel_cards', COUNT(*) FROM fuel_cards WHERE vehicle_id IN (?) GROUP BY vehicle_id UNION ALL
    SELECT vehicle_id, 'oil_schedule', COUNT(*) FROM oil_schedules WHERE vehicle_id IN (?) GROUP BY vehicle_id`, [ids, ids, ids, ids, ids, ids]);
}
async function deleteVehicles(req: Request, ids: number[]) {
  if (!ids.length) fail(422, 'nothing_selected');
  if (ids.length > 200) fail(422, 'max_200');
  const b = await vehicleBlockers(ids);
  if (b.length) fail(409, 'vehicle_linked', { blockers: b });
  await exec('DELETE FROM oil_changes WHERE vehicle_id IN (?)', [ids]);
  await exec('DELETE FROM vehicles WHERE id IN (?)', [ids]);
  for (const id of ids) await audit(req, { action: 'vehicle.delete', entity_type: 'vehicle', entity_id: id, severity: 'critical' });
}
fleetRouter.delete('/vehicles/:id', can('vehicles.delete'), async (req, res) => { await deleteVehicles(req, [Number(req.params.id)]); res.json({ ok: true }); });
fleetRouter.post('/vehicles/bulk-delete', can('vehicles.delete'), async (req, res) => { await deleteVehicles(req, (req.body.ids ?? []).map(Number)); res.json({ ok: true }); });

const vehicleImport: ImportDef = {
  name: 'vehicles', perm: 'vehicles.import', matchOn: 'vehicles.plate',
  columns: {
    plate: ['vehicles.plate', 'plate', 'plate number'], plate_en: ['vehicles.plate_en', 'plate (english)'], registration_type: ['vehicles.registration_type'],
    vehicle_type: ['vehicles.type', 'vehicle type', 'type'], maker: ['vehicles.maker', 'make', 'maker'], model: ['vehicles.model', 'model'], color: ['vehicles.color', 'colour', 'color'],
    year: ['vehicles.year', 'year', 'manufacture year'], chassis: ['vehicles.chassis', 'chassis', 'vin'], weight: ['vehicles.weight'], capacity: ['vehicles.capacity'],
    ownership: ['vehicles.ownership'], odometer: ['vehicles.odometer'], status: ['vehicles.status'],
  },
  requiredColumns: [['plate']],
  async parse(row, ctx) {
    const plate = cellStr(row.plate, 30);
    if (!plate) return 'no_key';
    const d: Record<string, any> = { plate };
    for (const k of ['plate_en', 'registration_type', 'vehicle_type', 'maker', 'model', 'color', 'chassis']) if (ctx.present.has(k)) d[k] = cellStr(row[k], 60);
    for (const k of ['year', 'weight', 'capacity', 'odometer']) if (ctx.present.has(k)) { const n = cellNum(row[k]); if (n === undefined) return 'invalid_value'; d[k] = n; }
    const OWN: Record<string, string> = { owned: 'owned', 'ملك': 'owned', 'مملوكة': 'owned', rented: 'rented', 'إيجار': 'rented', 'مستأجرة': 'rented' };
    const ST: Record<string, string> = { active: 'active', 'نشطة': 'active', maintenance: 'maintenance', 'in maintenance': 'maintenance', 'صيانة': 'maintenance', retired: 'retired', 'خارج الخدمة': 'retired' };
    if (ctx.present.has('ownership')) { const o = cellStr(row.ownership)?.toLowerCase(); if (o && !OWN[o]) return 'invalid_value'; d.ownership = o ? OWN[o] : null; }
    if (ctx.present.has('status')) { const s = cellStr(row.status)?.toLowerCase(); if (s && !ST[s]) return 'invalid_value'; d.status = s ? ST[s] : null; }
    return { line: 0, key: plateKey(plate), data: normalizeVehicle(d), label: plate };
  },
  async existing(items) {
    const m = new Map<string, any>();
    if (items.length) for (const r of await q('SELECT * FROM vehicles WHERE plate_key IN (?)', [items.map((i) => i.key)])) m.set(r.plate_key, r);
    return m;
  },
  async check(it, ex) { return !ex && !it.data.vehicle_type ? 'vehicle_type_required' : null; },
  async write(it, ex, ctx) {
    const values = Object.fromEntries(Object.entries(it.data).filter(([, v]) => v !== null && v !== undefined));
    if (ex) {
      if (ctx.mode === 'skip') return 'skipped';
      await exec('UPDATE vehicles SET ? WHERE id = ?', [values, ex.id]);
      return 'replaced';
    }
    await exec('INSERT INTO vehicles SET ?', [values]);
    return 'inserted';
  },
};
fleetRouter.use('/vehicles/import', importRoutes(vehicleImport));

// ======================================================================== transport licences
const TL_RULES = {
  number: { req: true, max: 50 }, city_id: { req: true, type: 'int' as const }, issue_date: { type: 'date' as const }, expiry_date: { req: true, type: 'date' as const },
  activity_ar: { max: 255 }, activity_en: { max: 255 }, status: { enum: ['valid', 'expired', 'suspended'] }, notes: { max: 500 },
};
function tlSpec(day: string): Spec {
  const d = expiryDays('t.expiry_date', day);
  return {
    from: 'FROM transport_licenses t JOIN cities ci ON ci.id = t.city_id',
    select: `t.*, ci.name_ar city_ar, ci.name_en city_en, ${d} days_left,
      (SELECT COUNT(*) FROM rider_documents WHERE transport_license_id = t.id) driver_cards, (SELECT COUNT(*) FROM operation_cards WHERE transport_license_id = t.id) operation_cards`,
    search: ['t.number', 't.activity_ar', 't.activity_en', 'ci.name_ar', 'ci.name_en'],
    filters: {
      city: eq('t.city_id'), status: eq('t.status'),
      expiry: (v) => ({ expired: `${d} < 0`, within30: `${d} BETWEEN 0 AND 30`, beyond30: `${d} > 30` } as Record<string, string>)[v] ?? null,
      from: (v) => ['t.expiry_date >= ?', [v]], to: (v) => ['t.expiry_date <= ?', [v]],
    },
    sorts: { number: 't.number', city: 'ci.name_ar', expiry: 't.expiry_date', status: 't.status' },
    defaultSort: 'expiry',
  };
}
fleetRouter.get('/transport-licenses', can('transport_licenses.view'), async (req, res) => {
  const day = await today();
  const d = expiryDays('expiry_date', day);
  const [stats] = await q(`SELECT COUNT(*) total, COALESCE(SUM(status='valid'),0) valid, COALESCE(SUM(${d} BETWEEN 0 AND 30),0) within30,
    COALESCE(SUM(${d} < 0),0) past, COALESCE(SUM(status='suspended'),0) suspended, COUNT(DISTINCT city_id) cities FROM transport_licenses`);
  res.json({ ...(await list(tlSpec(day), req.query as Query)), stats });
});
fleetRouter.get('/transport-licenses/options', can('transport_licenses.view', 'driver_cards.view', 'operation_cards.view'), async (_req, res) => {
  res.json(await q(`SELECT t.id, t.number, t.expiry_date, t.status, ci.name_ar city_ar, ci.name_en city_en FROM transport_licenses t JOIN cities ci ON ci.id = t.city_id ORDER BY t.status = 'valid' DESC, t.expiry_date DESC`));
});
fleetRouter.get('/transport-licenses/export', can('transport_licenses.view'), async (req, res) => {
  await sendExport(req, res, { format: 'csv', title: 'tl.title', rows: await listAll(tlSpec(await today()), req.query as Query), cols: [
    { key: 'id', label: 'common.id' }, { key: 'number', label: 'tl.number' }, { key: 'city_ar', label: 'tl.city' }, { key: 'activity_ar', label: 'tl.activity_ar' },
    { key: 'activity_en', label: 'tl.activity_en' }, { key: 'issue_date', label: 'tl.issued' }, { key: 'expiry_date', label: 'tl.expires' }, { key: 'days_left', label: 'docs.remaining' },
    { key: 'status', label: 'tl.status' }, { key: 'driver_cards', label: 'tl.driver_cards' }, { key: 'operation_cards', label: 'tl.operation_cards' }, { key: 'notes', label: 'common.notes' },
  ] });
});
fleetRouter.get('/transport-licenses/:id', can('transport_licenses.view'), async (req, res) => {
  const spec = tlSpec(await today());
  const r = await one<any>(`SELECT ${spec.select} ${spec.from} WHERE t.id = ?`, [req.params.id]);
  if (!r) fail(404, 'not_found');
  res.json(r);
});
async function tlCheck(v: Record<string, any>, id = 0, before?: any) {
  if (v.number && (await one('SELECT 1 FROM transport_licenses WHERE number = ? AND id <> ?', [v.number, id]))) fieldError('number', 'licence_number_taken');
  const issue = v.issue_date !== undefined ? v.issue_date : before?.issue_date;
  const exp = v.expiry_date !== undefined ? v.expiry_date : before?.expiry_date;
  if (issue && exp && exp < issue) fieldError('expiry_date', 'expiry_before_issue');
}
export async function createLicense(req: Request, body: any) {
  if (!has(req, 'transport_licenses.create')) throw new HttpError(403, 'forbidden', { perm: 'transport_licenses.create' });
  const v = clean(body, TL_RULES);
  await tlCheck(v);
  const r = await exec('INSERT INTO transport_licenses SET ?', [{ status: 'valid', ...v }]);
  await claimScan(req, body.scan, 'transport_license', r.insertId);
  await audit(req, { action: 'transport_license.create', entity_type: 'transport_license', entity_id: r.insertId, after: v });
  return r.insertId;
}
fleetRouter.post('/transport-licenses', can('transport_licenses.create'), async (req, res) => res.json({ id: await tx(() => createLicense(req, req.body)) }));
fleetRouter.patch('/transport-licenses/:id', can('transport_licenses.update'), async (req, res) => {
  const before = await one<any>('SELECT * FROM transport_licenses WHERE id = ?', [req.params.id]);
  if (!before) fail(404, 'not_found');
  const v = clean(req.body, TL_RULES, true);
  await tlCheck(v, before.id, before);
  await exec('UPDATE transport_licenses SET ? WHERE id = ?', [v, before.id]);
  // Bringing the expiry forward or suspending pulls the cover from the cards issued under the licence.
  const risky = (v.expiry_date && v.expiry_date < before.expiry_date) || (v.status === 'suspended' && before.status !== 'suspended');
  await audit(req, { action: 'transport_license.update', entity_type: 'transport_license', entity_id: before.id, severity: risky ? 'warning' : 'info', before, after: v });
  res.json({ ok: true });
});
fleetRouter.delete('/transport-licenses/:id', can('transport_licenses.delete'), async (req, res) => {
  const [{ n }] = await q<any>('SELECT (SELECT COUNT(*) FROM rider_documents WHERE transport_license_id = ?) + (SELECT COUNT(*) FROM operation_cards WHERE transport_license_id = ?) n', [req.params.id, req.params.id]);
  if (n) fail(409, 'licence_has_cards');
  await exec('DELETE FROM transport_licenses WHERE id = ?', [req.params.id]);
  await audit(req, { action: 'transport_license.delete', entity_type: 'transport_license', entity_id: req.params.id, severity: 'critical' });
  res.json({ ok: true });
});

// ======================================================================== operation cards
const CARD_RULES = {
  number: { req: true, max: 50 }, transport_license_id: { req: true, type: 'int' as const }, issue_date: { type: 'date' as const },
  expiry_date: { req: true, type: 'date' as const }, renew_date: { type: 'date' as const }, status: { enum: ['valid', 'expired', 'suspended', 'cancelled'] }, notes: { max: 500 },
};
async function cardCheck(v: Record<string, any>, id = 0, before?: any) {
  if (v.number && (await one('SELECT 1 FROM operation_cards WHERE number = ? AND id <> ?', [v.number, id]))) fieldError('number', 'card_number_taken');
  const issue = v.issue_date !== undefined ? v.issue_date : before?.issue_date;
  const exp = v.expiry_date !== undefined ? v.expiry_date : before?.expiry_date;
  if (issue && exp && exp < issue) fieldError('expiry_date', 'expiry_before_issue');
}
async function createCard(req: Request, body: any, vehicleIds: number[]) {
  if (body.new_license) body.transport_license_id = await createLicense(req, body.new_license);
  const v = clean(body, CARD_RULES);
  await cardCheck(v);
  if (!vehicleIds.length) fieldError('vehicle_id', 'required');
  const r = await exec('INSERT INTO operation_cards SET ?', [{ status: 'valid', ...v }]);
  for (const vid of vehicleIds) await linkCard(r.insertId, vid);
  await claimScan(req, body.scan, 'operation_card', r.insertId);
  await audit(req, { action: 'operation_card.create', entity_type: 'operation_card', entity_id: r.insertId, after: { ...v, vehicles: vehicleIds } });
  return r.insertId;
}
function cardSpec(day: string, windowDays: number): Spec {
  const d = expiryDays('oc.expiry_date', day);
  return {
    from: 'FROM operation_cards oc JOIN transport_licenses tl ON tl.id = oc.transport_license_id',
    select: `oc.*, tl.number license_number, ${d} days_left,
      (SELECT GROUP_CONCAT(CONCAT(v.id, '\t', v.plate, '\t', COALESCE(v.maker,''), '\t', COALESCE(v.model,''), '\t', COALESCE(v.year,'')) SEPARATOR '\n')
        FROM operation_card_vehicles x JOIN vehicles v ON v.id = x.vehicle_id WHERE x.card_id = oc.id) vehicles,
      EXISTS (SELECT 1 FROM attachments WHERE entity_type = 'operation_card' AND entity_id = oc.id) has_scan`,
    search: ['oc.number', 'tl.number', 'oc.id IN (SELECT x.card_id FROM operation_card_vehicles x JOIN vehicles v ON v.id = x.vehicle_id WHERE v.plate LIKE ? )',
      (s) => ['oc.id IN (SELECT x.card_id FROM operation_card_vehicles x JOIN vehicles v ON v.id = x.vehicle_id WHERE v.plate_key LIKE ?)', [`%${plateKey(s)}%`]]],
    filters: {
      expiry_state: (v) => ({ expired: `${d} < 0`, near: `${d} BETWEEN 0 AND 30`, valid: `${d} > 30` } as Record<string, string>)[v] ?? null,
      status: eq('oc.status'),
      scan: (v) => `${v === 'yes' ? '' : 'NOT '}EXISTS (SELECT 1 FROM attachments WHERE entity_type = 'operation_card' AND entity_id = oc.id)`,
      vehicle: (v) => ['oc.id IN (SELECT card_id FROM operation_card_vehicles WHERE vehicle_id = ?)', [v]],
      window: () => `${d} <= ${windowDays}`,
    },
    sorts: { number: 'oc.number', expiry: 'oc.expiry_date', remaining: d, status: 'oc.status' },
    defaultSort: 'expiry',
  };
}
fleetRouter.get('/operation-cards', can('operation_cards.view'), async (req, res) => {
  const day = await today();
  const d = expiryDays('expiry_date', day);
  // These cards are always about all the cards, whatever the filter.
  const [stats] = await q(`SELECT COUNT(*) total, (SELECT COUNT(*) FROM operation_card_vehicles) vehicles, COALESCE(SUM(${d} < 0),0) expired,
    COALESCE(SUM(${d} BETWEEN 0 AND 30),0) near, COALESCE(SUM(status = 'valid'),0) valid,
    COALESCE(SUM(NOT EXISTS (SELECT 1 FROM attachments WHERE entity_type = 'operation_card' AND entity_id = operation_cards.id)),0) no_scan FROM operation_cards`);
  res.json({ ...(await list(cardSpec(day, Number(req.query.window) || 30), req.query as Query)), stats });
});
fleetRouter.get('/operation-cards/options', can('operation_cards.view'), async (_req, res) => {
  res.json(await q('SELECT id, number, expiry_date, (SELECT COUNT(*) FROM operation_card_vehicles WHERE card_id = oc.id) vehicles FROM operation_cards oc ORDER BY number'));
});
fleetRouter.get('/operation-cards/export', can('operation_cards.export'), async (req, res) => {
  const rows = await listAll(cardSpec(await today(), Number(req.query.window) || 30), req.query as Query);
  await sendExport(req, res, { format: req.query.format === 'csv' ? 'csv' : 'xlsx', title: 'cards.title', rows, cols: [
    { key: 'number', label: 'cards.number' }, { key: 'license_number', label: 'cards.license' },
    { key: 'vehicles', label: 'cards.vehicle', value: (r) => r.vehicles?.split('\n').map((x: string) => x.split('\t')[1]).join(', ') },
    { key: 'issue_date', label: 'cards.issue_date' }, { key: 'expiry_date', label: 'cards.expiry_date', fill: (r) => r.days_left < 0 ? 'red' : r.days_left <= 30 ? 'amber' : 'green' },
    { key: 'renew_date', label: 'cards.renew_date' }, { key: 'days_left', label: 'docs.remaining' }, { key: 'status', label: 'cards.status' }, { key: 'notes', label: 'common.notes' },
  ] });
});
fleetRouter.get('/operation-cards/:id', can('operation_cards.view'), async (req, res) => {
  const day = await today();
  const c = await one<any>(`SELECT oc.*, tl.number license_number, tl.expiry_date license_expiry, ${expiryDays('oc.expiry_date', day)} days_left
    FROM operation_cards oc JOIN transport_licenses tl ON tl.id = oc.transport_license_id WHERE oc.id = ?`, [req.params.id]);
  if (!c) fail(404, 'not_found');
  c.vehicles = await q(`SELECT v.id, v.plate, v.maker, v.model, v.year, x.is_current,
      (SELECT GROUP_CONCAT(r.full_name SEPARATOR ', ') FROM vehicle_assignments a JOIN riders r ON r.id = a.rider_id WHERE a.vehicle_id = v.id AND a.is_current = 1) riders,
      (SELECT serial FROM vehicle_registrations WHERE vehicle_id = v.id AND is_current = 1 LIMIT 1) registration
    FROM operation_card_vehicles x JOIN vehicles v ON v.id = x.vehicle_id WHERE x.card_id = ? ORDER BY v.plate`, [c.id]);
  res.json(c);
});
fleetRouter.post('/operation-cards', can('operation_cards.create'), async (req, res) => {
  const body = req.body;
  const id = await tx(async () => {
    let vehicleIds: number[] = [];
    if (body.new_vehicle) {
      if (!has(req, 'vehicles.create')) fail(403, 'forbidden', { perm: 'vehicles.create' });
      const v = normalizeVehicle(clean({ vehicle_type: 'car', ...body.new_vehicle }, VEHICLE_RULES));
      await vehicleUnique(v);
      vehicleIds.push((await exec('INSERT INTO vehicles SET ?', [v])).insertId);
    } else if (body.vehicle_id) vehicleIds.push(Number(body.vehicle_id));
    vehicleIds = [...new Set([...vehicleIds, ...(body.more_vehicles ?? []).map(Number)])];
    return createCard(req, body, vehicleIds);
  });
  res.json({ id });
});
fleetRouter.patch('/operation-cards/:id', can('operation_cards.update'), async (req, res) => {
  const id = Number(req.params.id);
  const before = await one<any>('SELECT * FROM operation_cards WHERE id = ?', [id]);
  if (!before) fail(404, 'not_found');
  const v = clean(req.body, CARD_RULES, true);
  await cardCheck(v, id, before);
  await tx(async () => {
    if (Object.keys(v).length) await exec('UPDATE operation_cards SET ? WHERE id = ?', [v, id]);
    if (Array.isArray(req.body.vehicle_ids)) {
      const wanted: number[] = req.body.vehicle_ids.map(Number);
      if (!wanted.length) fieldError('vehicle_id', 'required');
      // Vehicles removed from the list are unlinked from this card.
      await exec('DELETE FROM operation_card_vehicles WHERE card_id = ? AND vehicle_id NOT IN (?)', [id, wanted]);
      const have = new Set((await q<{ vehicle_id: number }>('SELECT vehicle_id FROM operation_card_vehicles WHERE card_id = ?', [id])).map((r) => r.vehicle_id));
      for (const vid of wanted) if (!have.has(vid)) await linkCard(id, vid);
    }
    await claimScan(req, req.body.scan, 'operation_card', id);
  });
  await audit(req, { action: 'operation_card.update', entity_type: 'operation_card', entity_id: id, before, after: v });
  res.json({ ok: true });
});
async function deleteCard(req: Request, id: number) {
  await exec("DELETE FROM attachments WHERE entity_type = 'operation_card' AND entity_id = ?", [String(id)]);
  await exec('DELETE FROM operation_cards WHERE id = ?', [id]);
  await audit(req, { action: 'operation_card.delete', entity_type: 'operation_card', entity_id: id, severity: 'critical' });
}
fleetRouter.delete('/operation-cards/:id', can('operation_cards.delete'), async (req, res) => { await deleteCard(req, Number(req.params.id)); res.json({ ok: true }); });
// Bulk delete runs card by card and reports how many succeeded.
fleetRouter.post('/operation-cards/bulk-delete', can('operation_cards.delete'), async (req, res) => {
  let deleted = 0;
  const failed: { id: number; error: string }[] = [];
  for (const id of (req.body.ids ?? []).map(Number).slice(0, 200)) {
    try { await deleteCard(req, id); deleted++; } catch (e: any) { failed.push({ id, error: e.code ?? 'error' }); }
  }
  res.json({ deleted, failed });
});

const cardImport: ImportDef = {
  name: 'operation_cards', perm: 'operation_cards.create', matchOn: 'cards.number',
  columns: {
    number: ['cards.number', 'card number'], plate: ['vehicles.plate', 'plate', 'plate number'], license: ['cards.license', 'transport licence number', 'license number'],
    expiry_date: ['cards.expiry_date', 'expiry date'], issue_date: ['cards.issue_date', 'issue date'], renew_date: ['cards.renew_date'], status: ['cards.status', 'status'],
    current: ['cards.current_card', 'current card'], notes: ['common.notes', 'notes'],
  },
  requiredColumns: [['number'], ['plate'], ['license'], ['expiry_date']],
  async parse(row) {
    const number = cellStr(row.number, 50);
    const plate = cellStr(row.plate, 30);
    const lic = cellStr(row.license, 50);
    const exp = cellDate(row.expiry_date);
    if (!number || !plate || !lic || !exp) return exp === undefined ? 'invalid_value' : 'missing_required';
    const v = await one<{ id: number }>('SELECT id FROM vehicles WHERE plate_key = ?', [plateKey(plate)]);
    if (!v) return 'vehicle_not_registered';
    const t = await one<{ id: number }>('SELECT id FROM transport_licenses WHERE number = ?', [lic]);
    if (!t) return 'licence_not_registered';
    const issue = cellDate(row.issue_date); const renew = cellDate(row.renew_date);
    if (issue === undefined || renew === undefined) return 'invalid_value';
    const st = cellStr(row.status)?.toLowerCase() ?? null;
    if (st && !['valid', 'expired', 'suspended', 'cancelled'].includes(st)) return 'invalid_value';
    return { line: 0, key: number, label: plate, data: { number, vehicle_id: v.id, transport_license_id: t.id, expiry_date: exp, issue_date: issue, renew_date: renew, status: st, notes: cellStr(row.notes, 500) } };
  },
  async existing(items) {
    const m = new Map<string, any>();
    if (items.length) for (const r of await q('SELECT * FROM operation_cards WHERE number IN (?)', [items.map((i) => i.key)])) m.set(r.number, r);
    return m;
  },
  async counts(items) {
    let becomes = 0;
    for (const it of items) if (!(await one('SELECT 1 FROM operation_card_vehicles WHERE vehicle_id = ? AND is_current = 1', [it.data.vehicle_id]))) becomes++;
    return { becomes_current: becomes };
  },
  async write(it, ex, ctx) {
    const { vehicle_id, ...data } = it.data;
    const values = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null && v !== undefined));
    let cardId: number;
    let outcome: 'inserted' | 'replaced' | 'skipped';
    if (ex) {
      if (ctx.mode === 'skip') return 'skipped';
      await exec('UPDATE operation_cards SET ? WHERE id = ?', [values, ex.id]);
      cardId = ex.id; outcome = 'replaced';
    } else {
      cardId = (await exec('INSERT INTO operation_cards SET ?', [{ status: 'valid', ...values }])).insertId; outcome = 'inserted';
    }
    // A new card becomes current for its vehicle only if the vehicle has no current card.
    const cur = await one('SELECT 1 FROM operation_card_vehicles WHERE vehicle_id = ? AND is_current = 1 AND card_id <> ?', [vehicle_id, cardId]);
    await exec('INSERT INTO operation_card_vehicles (card_id, vehicle_id, is_current) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE card_id = card_id', [cardId, vehicle_id, cur ? 0 : 1]);
    if (!cur) ctx.result.became_current = (ctx.result.became_current ?? 0) + 1;
    return outcome;
  },
};
fleetRouter.use('/operation-cards/import', importRoutes(cardImport));

// ======================================================================== vehicle registrations
const REG_RULES = {
  vehicle_id: { req: true, type: 'int' as const }, serial: { req: true, max: 30 }, owner: { req: true, max: 150 }, owner_id_no: { type: 'digits' as const, max: 20, minLen: 4 },
  user_rider_id: { type: 'int' as const }, user_name: { max: 150 }, user_id_no: { type: 'digits' as const, max: 20, minLen: 4 },
  issue_date: { type: 'date' as const }, expiry_date: { type: 'date' as const }, status: { enum: ['valid', 'expired', 'cancelled'] }, is_current: { type: 'bool' as const }, notes: { max: 500 },
};
function regSpec(day: string, within: number): Spec {
  const d = expiryDays('g.expiry_date', day);
  return {
    from: 'FROM vehicle_registrations g JOIN vehicles v ON v.id = g.vehicle_id',
    select: `g.*, v.plate, v.maker, v.model, v.chassis, ${d} days_left`,
    search: ['v.plate', (s) => ['v.plate_key LIKE ?', [`%${plateKey(s)}%`]], 'g.serial', 'g.owner', 'v.chassis'],
    filters: {
      vehicle: eq('g.vehicle_id'), status: eq('g.status'),
      validity: (v) => ({ expired: `${d} < 0`, soon: `${d} BETWEEN 0 AND ${within}`, valid: `${d} > ${within}` } as Record<string, string>)[v] ?? null,
      current: (v) => ['g.is_current = ?', [v === 'current' ? 1 : 0]],
      within: () => `${d} <= ${within}`,
    },
    sorts: { plate: 'v.plate', serial: 'g.serial', expires: 'g.expiry_date', remaining: `g.expiry_date IS NULL, ${d}`, status: 'g.status' },
    defaultSort: 'remaining',
  };
}
fleetRouter.get('/vehicle-registrations', can('vehicle_registrations.view'), async (req, res) => {
  const day = await today();
  const within = Number(req.query.within) || 30;
  const spec = regSpec(day, within);
  const w = where(spec, req.query as Query);
  const d = expiryDays('g.expiry_date', day);
  const [stats] = await q(`SELECT COUNT(*) total, COALESCE(SUM(g.status='valid'),0) valid, COALESCE(SUM(${d} BETWEEN 0 AND ${within}),0) soon,
    COALESCE(SUM(${d} < 0),0) expired, COALESCE(SUM(g.is_current),0) current ${spec.from}${w.sql}`, w.params);
  res.json({ ...(await list(spec, req.query as Query)), stats });
});
fleetRouter.get('/vehicle-registrations/options', can('vehicle_registrations.view'), async (_req, res) => {
  res.json(await q('SELECT g.id, g.serial, g.vehicle_id, v.plate FROM vehicle_registrations g JOIN vehicles v ON v.id = g.vehicle_id ORDER BY g.serial'));
});
fleetRouter.get('/vehicle-registrations/export', can('vehicle_registrations.export'), async (req, res) => {
  const rows = await listAll(regSpec(await today(), Number(req.query.within) || 30), req.query as Query);
  await sendExport(req, res, { format: 'xlsx', title: 'regs.title', rows, cols: [
    { key: 'plate', label: 'regs.plate' }, { key: 'serial', label: 'regs.serial' }, { key: 'owner', label: 'regs.owner' }, { key: 'owner_id_no', label: 'regs.owner_id' },
    { key: 'user_name', label: 'regs.user' }, { key: 'user_id_no', label: 'regs.user_id' }, { key: 'issue_date', label: 'regs.issue_date' },
    { key: 'expiry_date', label: 'regs.expiry_date', fill: (r) => r.days_left == null ? null : r.days_left < 0 ? 'red' : r.days_left <= 30 ? 'amber' : 'green' },
    { key: 'status', label: 'regs.status' }, { key: 'is_current', label: 'regs.current' }, { key: 'notes', label: 'common.notes' },
  ] });
});
fleetRouter.get('/vehicle-registrations/:id', can('vehicle_registrations.view'), async (req, res) => {
  const day = await today();
  const g = await one<any>(`SELECT g.*, v.plate, v.maker, v.model, v.chassis, ${expiryDays('g.expiry_date', day)} days_left, r.full_name user_rider_name
    FROM vehicle_registrations g JOIN vehicles v ON v.id = g.vehicle_id LEFT JOIN riders r ON r.id = g.user_rider_id WHERE g.id = ?`, [req.params.id]);
  if (!g) fail(404, 'not_found');
  g.card = await one(`SELECT oc.id, oc.number, oc.expiry_date FROM operation_card_vehicles x JOIN operation_cards oc ON oc.id = x.card_id WHERE x.vehicle_id = ? AND x.is_current = 1`, [g.vehicle_id]);
  res.json(g);
});
async function regCheck(v: Record<string, any>, id = 0, before?: any) {
  if (v.serial) {
    const d = await one<any>('SELECT id FROM vehicle_registrations WHERE serial = ? AND id <> ?', [v.serial, id]);
    if (d) fieldError('serial', 'serial_taken', { id: d.id });
  }
  const issue = v.issue_date !== undefined ? v.issue_date : before?.issue_date;
  const exp = v.expiry_date !== undefined ? v.expiry_date : before?.expiry_date;
  if (issue && exp && exp < issue) fieldError('expiry_date', 'expiry_before_issue');
  // Linking the user to a rider fills "User" and "User ID" when they were left empty.
  if (v.user_rider_id) {
    const r = await one<any>('SELECT full_name, national_id FROM riders WHERE id = ?', [v.user_rider_id]);
    if (!r) fieldError('user_rider_id', 'invalid');
    if (!(v.user_name ?? before?.user_name)) v.user_name = r.full_name;
    if (!(v.user_id_no ?? before?.user_id_no) && /^\d{4,20}$/.test(r.national_id ?? '')) v.user_id_no = r.national_id;
  }
}
fleetRouter.post('/vehicle-registrations', can('vehicle_registrations.create'), async (req, res) => {
  const v = clean(req.body, REG_RULES);
  if (req.body.is_current === undefined) v.is_current = 1;
  await regCheck(v);
  const id = await tx(async () => {
    if (v.is_current) await exec('UPDATE vehicle_registrations SET is_current = 0 WHERE vehicle_id = ?', [v.vehicle_id]);
    const r = await exec('INSERT INTO vehicle_registrations SET ?', [{ status: 'valid', ...v }]);
    await claimScan(req, req.body.scan, 'vehicle_registration', r.insertId);
    // Details read from the card only complete the vehicle's empty fields.
    if (req.body.vehicle_fill) {
      const veh = await one<any>('SELECT maker, color, chassis, weight, capacity, model, year FROM vehicles WHERE id = ?', [v.vehicle_id]);
      const fill = Object.fromEntries(Object.entries(req.body.vehicle_fill).filter(([k, val]) => k in (veh ?? {}) && !veh[k] && val));
      if (Object.keys(fill).length) await exec('UPDATE vehicles SET ? WHERE id = ?', [fill, v.vehicle_id]);
    }
    return r.insertId;
  });
  await audit(req, { action: 'vehicle_registration.create', entity_type: 'vehicle_registration', entity_id: id, after: v });
  res.json({ id });
});
fleetRouter.patch('/vehicle-registrations/:id', can('vehicle_registrations.update'), async (req, res) => {
  const before = await one<any>('SELECT * FROM vehicle_registrations WHERE id = ?', [req.params.id]);
  if (!before) fail(404, 'not_found');
  const v = clean(req.body, REG_RULES, true);
  await regCheck(v, before.id, before);
  await tx(async () => {
    if (v.is_current) await exec('UPDATE vehicle_registrations SET is_current = 0 WHERE vehicle_id = ? AND id <> ?', [v.vehicle_id ?? before.vehicle_id, before.id]);
    await exec('UPDATE vehicle_registrations SET ? WHERE id = ?', [v, before.id]);
  });
  await audit(req, { action: 'vehicle_registration.update', entity_type: 'vehicle_registration', entity_id: before.id, before, after: v });
  res.json({ ok: true });
});
// Renewal issues a new card and moves to it; the old one goes to the record as expired.
fleetRouter.post('/vehicle-registrations/:id/renew', can('vehicle_registrations.renew'), async (req, res) => {
  const g = await one<any>('SELECT g.*, v.plate FROM vehicle_registrations g JOIN vehicles v ON v.id = g.vehicle_id WHERE g.id = ?', [req.params.id]);
  if (!g) fail(404, 'not_found');
  const v = clean(req.body, renewRules);
  if (v.new_expiry < (await today())) fieldError('new_expiry', 'renewal_in_past');
  const serial = v.new_number ?? g.serial;
  if (await one('SELECT 1 FROM vehicle_registrations WHERE serial = ? AND id <> ?', [serial, g.id]) || serial === g.serial) fieldError('new_number', 'renewal_number_needed');
  const out = await tx(async () => {
    await exec("UPDATE vehicle_registrations SET is_current = 0, status = 'expired' WHERE id = ?", [g.id]);
    const r = await exec('INSERT INTO vehicle_registrations SET ?', [{
      vehicle_id: g.vehicle_id, serial, owner: g.owner, owner_id_no: g.owner_id_no, user_rider_id: g.user_rider_id, user_name: g.user_name, user_id_no: g.user_id_no,
      issue_date: v.new_issue ?? (await today()), expiry_date: v.new_expiry, status: 'valid', is_current: 1, notes: g.notes,
    }]);
    await logRenewal(req, { doc_kind: 'vehicle_registration', doc_id: g.id, new_doc_id: r.insertId, owner_type: 'vehicle', owner_label: g.plate,
      previous_number: g.serial, new_number: serial, previous_expiry: g.expiry_date, new_expiry: v.new_expiry, operation: v.operation ?? 'renewal', cost: v.cost, reference: v.reference, notes: v.notes });
    return r.insertId;
  });
  res.json({ id: out });
});
fleetRouter.delete('/vehicle-registrations/:id', can('vehicle_registrations.delete'), async (req, res) => {
  const [{ n }] = await q<any>(`SELECT (SELECT COUNT(*) FROM attachments WHERE entity_type = 'vehicle_registration' AND entity_id = ?) +
    (SELECT COUNT(*) FROM renewals WHERE doc_kind = 'vehicle_registration' AND (doc_id = ? OR new_doc_id = ?)) n`, [req.params.id, req.params.id, req.params.id]);
  if (n) fail(409, 'registration_has_history');
  await exec('DELETE FROM vehicle_registrations WHERE id = ?', [req.params.id]);
  await audit(req, { action: 'vehicle_registration.delete', entity_type: 'vehicle_registration', entity_id: req.params.id, severity: 'critical' });
  res.json({ ok: true });
});
