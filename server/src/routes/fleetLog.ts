// Phase 4: the servicing log, accident records and the vehicle papers table. The rules live in domain/fleetLog.ts.
// A company's own data on every plan: no quota, no feature gate (a service may bring a vehicle back into service,
// which takes a plan place like any other return to service).
import { Router } from 'express';
import { exec, one, q, tx } from '../db.js';
import { clean, fail, fieldError, list, listAll, sendExport, today, where, type Spec } from '../http.js';
import { can } from '../auth.js';
import { audit } from '../audit.js';
import {
  ACCIDENT_AUTHORITIES, ACCIDENT_SEVERITIES, ACCIDENT_STAGES, SERVICE_STATUSES, SERVICE_TYPES, accidentUse, cancelService, checkFleetLinks,
  completeService, createAccident, createService, moveAccident, payService, startService, vehiclePapers, type AccidentStage,
} from '../domain/fleetLog.js';
import { categoryByKey, checkEntry, createEntry } from '../domain/companyFinance.js';

export const fleetLogRouter = Router();
const id = (req: { params: Record<string, string | string[]> }) => String(req.params.id);

// ======================================================================== servicing
const SERVICE_SPEC: Spec = {
  from: `FROM vehicle_services s JOIN vehicles v ON v.id = s.vehicle_id LEFT JOIN riders r ON r.id = s.rider_id`,
  select: `s.*, v.plate, v.plate_en, v.maker, v.model, r.full_name rider_name,
    (s.status = 'completed' AND s.cost IS NOT NULL AND COALESCE(s.paid_amount, 0) < s.cost) unpaid`,
  search: ['v.plate', 'v.plate_en', 'r.full_name', 's.workshop', 's.details'],
  filters: {
    status: (v) => (v === 'open' ? "s.status IN ('scheduled','in_progress')" : ['s.status = ?', [v]]),
    type: (v) => ['s.service_type = ?', [v]],
    vehicle: (v) => ['s.vehicle_id = ?', [v]],
    rider: (v) => ['s.rider_id = ?', [v]],
    unpaid: (v) => (v === '1' ? "s.status = 'completed' AND s.cost IS NOT NULL AND COALESCE(s.paid_amount, 0) < s.cost" : null),
    from: (v) => ['COALESCE(s.completed_at, s.started_at, s.scheduled_for, s.created_at) >= ?', [v]],
    to: (v) => ['COALESCE(s.completed_at, s.started_at, s.scheduled_for, s.created_at) < DATE_ADD(?, INTERVAL 1 DAY)', [v]],
  },
  sorts: { plate: 'v.plate', status: 's.status', scheduled: 's.scheduled_for', completed: 's.completed_at', cost: 's.cost', created: 's.created_at' },
  defaultSort: '-created',
};
const SERVICE_RULES = {
  vehicle_id: { req: true, type: 'int' as const }, rider_id: { type: 'int' as const }, accident_id: { type: 'int' as const },
  service_type: { req: true, enum: SERVICE_TYPES }, details: { max: 1000 }, workshop: { max: 150 }, scheduled_for: { type: 'date' as const },
  odometer: { type: 'int' as const, min: 0 },
};
const SERVICE_COLS = [
  { key: 'id', label: 'common.id' }, { key: 'plate', label: 'svc.vehicle' }, { key: 'rider_name', label: 'svc.rider' },
  { key: 'service_type', label: 'svc.type' }, { key: 'details', label: 'svc.details' }, { key: 'workshop', label: 'svc.workshop' },
  { key: 'status', label: 'svc.status' }, { key: 'scheduled_for', label: 'svc.scheduled_for' }, { key: 'started_at', label: 'svc.started_at' },
  { key: 'completed_at', label: 'svc.completed_at' }, { key: 'cost', label: 'svc.cost' }, { key: 'paid_amount', label: 'svc.paid_amount' },
  { key: 'paid_on', label: 'svc.paid_on' }, { key: 'cancel_reason', label: 'svc.cancel_reason' },
];

fleetLogRouter.get('/vehicle-services', can('vehicle_services.view'), async (req, res) => {
  const query = req.query as Record<string, string>;
  const data = await list(SERVICE_SPEC, query);
  const w = where(SERVICE_SPEC, query, ['status', 'unpaid']);
  const [stats] = await q(`SELECT COUNT(*) total, COALESCE(SUM(s.status = 'scheduled'),0) scheduled, COALESCE(SUM(s.status = 'in_progress'),0) in_progress,
    COALESCE(SUM(s.status = 'completed'),0) completed, COALESCE(SUM(s.status = 'cancelled'),0) cancelled,
    COALESCE(SUM(CASE WHEN s.status = 'completed' THEN s.cost END),0) cost,
    COALESCE(SUM(CASE WHEN s.status = 'completed' AND s.cost IS NOT NULL THEN GREATEST(s.cost - COALESCE(s.paid_amount, 0), 0) END),0) unpaid ${SERVICE_SPEC.from}${w.sql}`, w.params);
  res.json({ ...data, stats });
});
fleetLogRouter.get('/vehicle-services/export', can('vehicle_services.export'), async (req, res) =>
  sendExport(req, res, { format: req.query.format === 'csv' ? 'csv' : 'xlsx', title: 'svc.title', rows: await listAll(SERVICE_SPEC, req.query as any), cols: SERVICE_COLS }));
fleetLogRouter.get('/vehicle-services/:id', can('vehicle_services.view'), async (req, res) => {
  const [row] = await q(`SELECT ${SERVICE_SPEC.select}, a.occurred_at accident_at ${SERVICE_SPEC.from} LEFT JOIN vehicle_accidents a ON a.id = s.accident_id WHERE s.id = ?`, [id(req)]);
  if (!row) fail(404, 'not_found');
  res.json(row);
});
fleetLogRouter.post('/vehicle-services', can('vehicle_services.create'), async (req, res) => {
  const v = clean(req.body, SERVICE_RULES);
  if (!('rider_id' in (req.body ?? {}))) delete v.rider_id;
  const sid = await createService(v, req.user!.id, !!req.body?.start);
  await audit(req, { action: 'vehicle_service.create', entity_type: 'vehicle_service', entity_id: sid, after: { ...v, start: !!req.body?.start } });
  res.json({ id: sid });
});
fleetLogRouter.patch('/vehicle-services/:id', can('vehicle_services.update'), async (req, res) => {
  const before = await one<any>('SELECT * FROM vehicle_services WHERE id = ?', [id(req)]);
  if (!before) fail(404, 'not_found');
  // the status, dates and payment change only through their own actions; a closed record keeps its vehicle
  const v = clean(req.body, { ...SERVICE_RULES, vehicle_id: { type: 'int' as const }, service_type: { enum: SERVICE_TYPES }, cost: { type: 'num' as const, min: 0 } }, true);
  if (v.vehicle_id !== undefined && Number(v.vehicle_id) !== Number(before.vehicle_id) && before.status !== 'scheduled') fail(409, 'service_vehicle_fixed');
  if (v.cost !== undefined && before.status !== 'completed') fail(409, 'service_not_completed');
  if (v.cost != null && before.paid_amount != null && v.cost < Number(before.paid_amount)) fail(409, 'cost_below_paid');
  await checkFleetLinks(v, before);
  if (Object.keys(v).length) {
    await exec('UPDATE vehicle_services SET ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [v, id(req)]);
    await audit(req, { action: 'vehicle_service.update', entity_type: 'vehicle_service', entity_id: id(req), before, after: v });
  }
  res.json({ ok: true });
});
fleetLogRouter.post('/vehicle-services/:id/start', can('vehicle_services.update'), async (req, res) => {
  await startService(id(req));
  await audit(req, { action: 'vehicle_service.start', entity_type: 'vehicle_service', entity_id: id(req) });
  res.json({ ok: true });
});
fleetLogRouter.post('/vehicle-services/:id/complete', can('vehicle_services.update'), async (req, res) => {
  const v = clean(req.body, { cost: { type: 'num', min: 0 }, odometer: { type: 'int', min: 0 }, details: { max: 1000 }, done: { type: 'date' } });
  if (v.done && v.done > (await today())) fail(422, 'date_in_future');
  await completeService(id(req), v);
  await audit(req, { action: 'vehicle_service.complete', entity_type: 'vehicle_service', entity_id: id(req), after: v });
  res.json({ ok: true });
});
fleetLogRouter.post('/vehicle-services/:id/cancel', can('vehicle_services.update'), async (req, res) => {
  const v = clean(req.body, { reason: { req: true, max: 255 } });
  await cancelService(id(req), v.reason);
  await audit(req, { action: 'vehicle_service.cancel', entity_type: 'vehicle_service', entity_id: id(req), after: v, severity: 'warning' });
  res.json({ ok: true });
});
fleetLogRouter.post('/vehicle-services/:id/pay', can('vehicle_services.pay'), async (req, res) => {
  const v = clean(req.body, { amount: { req: true, type: 'num' }, paid_on: { type: 'date' }, ref: { max: 100 }, account_id: { type: 'int' } });
  const day = await today();
  if (v.paid_on && v.paid_on > day) fail(422, 'date_in_future');
  // paid from one of the company's accounts: the money-out entry is written too (Maintenance), checked first
  const entry = v.account_id ? { entry_date: v.paid_on ?? day, direction: 'out' as const, account_id: v.account_id, category_id: await categoryByKey('maintenance'),
    amount: v.amount, description: `service #${id(req)}`, reference: v.ref ?? null, source_type: 'service', source_id: Number(id(req)) } : null;
  if (entry) await checkEntry(entry, day);
  await payService(id(req), { amount: v.amount, paid_on: v.paid_on ?? day, ref: v.ref });
  if (entry) {
    // a second payment of the same service replaces the entry of the first
    await exec("UPDATE fin_entries SET voided_at = UTC_TIMESTAMP(), void_reason = 'service payment changed' WHERE source_type = 'service' AND source_id = ? AND voided_at IS NULL", [Number(id(req))]);
    await createEntry(entry, req.user!.id, day);
  }
  await audit(req, { action: 'vehicle_service.pay', entity_type: 'vehicle_service', entity_id: id(req), after: v });
  res.json({ ok: true });
});
// Only a record that never happened can be deleted; a completed one is history.
fleetLogRouter.delete('/vehicle-services/:id', can('vehicle_services.delete'), async (req, res) => {
  const before = await one<any>('SELECT * FROM vehicle_services WHERE id = ?', [id(req)]);
  if (!before) fail(404, 'not_found');
  if (before.status === 'in_progress' || before.status === 'completed') fail(409, 'service_not_deletable');
  await exec('DELETE FROM vehicle_services WHERE id = ?', [id(req)]);
  await audit(req, { action: 'vehicle_service.delete', entity_type: 'vehicle_service', entity_id: id(req), before, severity: 'critical' });
  res.json({ ok: true });
});

// ======================================================================== accidents
const ACCIDENT_SPEC: Spec = {
  from: 'FROM vehicle_accidents a JOIN vehicles v ON v.id = a.vehicle_id LEFT JOIN riders r ON r.id = a.rider_id',
  select: `a.*, v.plate, v.plate_en, v.maker, v.model, r.full_name rider_name,
    (SELECT COUNT(*) FROM attachments f WHERE f.entity_type = 'accident' AND f.entity_id = CAST(a.id AS CHAR)) papers`,
  search: ['v.plate', 'v.plate_en', 'r.full_name', 'a.report_number', 'a.location', 'a.details'],
  filters: {
    stage: (v) => (v === 'active' ? "a.stage <> 'completed'" : ['a.stage = ?', [v]]),
    severity: (v) => ['a.severity = ?', [v]],
    authority: (v) => ['a.authority = ?', [v]],
    vehicle: (v) => ['a.vehicle_id = ?', [v]],
    rider: (v) => ['a.rider_id = ?', [v]],
    from: (v) => ['a.occurred_at >= ?', [v]],
    to: (v) => ['a.occurred_at < DATE_ADD(?, INTERVAL 1 DAY)', [v]],
  },
  sorts: { occurred: 'a.occurred_at', plate: 'v.plate', stage: 'a.stage', severity: 'a.severity' },
  defaultSort: '-occurred',
};
const ACCIDENT_RULES = {
  vehicle_id: { req: true, type: 'int' as const }, rider_id: { type: 'int' as const }, occurred_at: { req: true, max: 19 },
  severity: { req: true, enum: ACCIDENT_SEVERITIES }, authority: { req: true, enum: ACCIDENT_AUTHORITIES }, report_number: { max: 60 },
  location: { max: 255 }, lat: { type: 'num' as const, min: -90, max: 90 }, lng: { type: 'num' as const, min: -180, max: 180 }, details: { max: 2000 },
  assessment_amount: { type: 'num' as const, min: 0 }, claim_amount: { type: 'num' as const, min: 0 }, rider_share: { type: 'num' as const, min: 0 },
};
const ACCIDENT_COLS = [
  { key: 'id', label: 'common.id' }, { key: 'occurred_at', label: 'acc.occurred_at' }, { key: 'plate', label: 'acc.vehicle' }, { key: 'rider_name', label: 'acc.rider' },
  { key: 'severity', label: 'acc.severity' }, { key: 'authority', label: 'acc.authority' }, { key: 'report_number', label: 'acc.report_number' },
  { key: 'location', label: 'acc.location' }, { key: 'stage', label: 'acc.stage' }, { key: 'assessment_amount', label: 'acc.assessment_amount' },
  { key: 'claim_amount', label: 'acc.claim_amount' }, { key: 'rider_share', label: 'acc.rider_share' }, { key: 'details', label: 'acc.details' },
];
// "YYYY-MM-DDTHH:MM" or "YYYY-MM-DD HH:MM[:SS]" from a date-time input, in the company's own clock as typed
function occurredAt(v: Record<string, any>) {
  if (v.occurred_at === undefined) return;
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2})?$/.exec(String(v.occurred_at));
  if (!m || Number.isNaN(Date.parse(`${m[1]}T${m[2]}:00Z`))) fieldError('occurred_at', 'invalid_date');
  v.occurred_at = `${m![1]} ${m![2]}:00`;
}

fleetLogRouter.get('/vehicle-accidents', can('vehicle_accidents.view'), async (req, res) => {
  const query = req.query as Record<string, string>;
  const data = await list(ACCIDENT_SPEC, query);
  const w = where(ACCIDENT_SPEC, query, ['stage']);
  const [stats] = await q(`SELECT COUNT(*) total, ${ACCIDENT_STAGES.map((s) => `COALESCE(SUM(a.stage = '${s}'),0) ${s}`).join(', ')},
    COALESCE(SUM(a.severity = 'severe'),0) severe ${ACCIDENT_SPEC.from}${w.sql}`, w.params);
  res.json({ ...data, stats });
});
fleetLogRouter.get('/vehicle-accidents/export', can('vehicle_accidents.export'), async (req, res) =>
  sendExport(req, res, { format: req.query.format === 'csv' ? 'csv' : 'xlsx', title: 'acc.title', rows: await listAll(ACCIDENT_SPEC, req.query as any), cols: ACCIDENT_COLS }));
fleetLogRouter.get('/vehicle-accidents/:id', can('vehicle_accidents.view'), async (req, res) => {
  const [row] = await q(`SELECT ${ACCIDENT_SPEC.select} ${ACCIDENT_SPEC.from} WHERE a.id = ?`, [id(req)]);
  if (!row) fail(404, 'not_found');
  const events = await q(`SELECT e.*, u.full_name by_name FROM vehicle_accident_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.accident_id = ? ORDER BY e.at DESC, e.id DESC`, [id(req)]);
  const services = await q("SELECT id, service_type, status, cost, completed_at FROM vehicle_services WHERE accident_id = ? ORDER BY id DESC", [id(req)]);
  res.json({ ...row, events, services });
});
fleetLogRouter.post('/vehicle-accidents', can('vehicle_accidents.create'), async (req, res) => {
  const v = clean(req.body, ACCIDENT_RULES);
  occurredAt(v);
  if (!('rider_id' in (req.body ?? {}))) delete v.rider_id;
  const aid = await createAccident(v, req.user!.id);
  await audit(req, { action: 'vehicle_accident.create', entity_type: 'vehicle_accident', entity_id: aid, after: v });
  res.json({ id: aid });
});
fleetLogRouter.patch('/vehicle-accidents/:id', can('vehicle_accidents.update'), async (req, res) => {
  const before = await one<any>('SELECT * FROM vehicle_accidents WHERE id = ?', [id(req)]);
  if (!before) fail(404, 'not_found');
  if ('stage' in (req.body ?? {})) fail(422, 'stage_by_action');
  const v = clean(req.body, { ...ACCIDENT_RULES, vehicle_id: { type: 'int' as const }, occurred_at: { max: 19 }, severity: { enum: ACCIDENT_SEVERITIES }, authority: { enum: ACCIDENT_AUTHORITIES } }, true);
  occurredAt(v);
  if (v.vehicle_id !== undefined && Number(v.vehicle_id) !== Number(before.vehicle_id) && (await accidentUse(id(req))).services) fail(409, 'accident_in_use');
  await checkFleetLinks(v, before);
  if (Object.keys(v).length) {
    await exec('UPDATE vehicle_accidents SET ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [v, id(req)]);
    await audit(req, { action: 'vehicle_accident.update', entity_type: 'vehicle_accident', entity_id: id(req), before, after: v });
  }
  res.json({ ok: true });
});
fleetLogRouter.post('/vehicle-accidents/:id/stage', can('vehicle_accidents.update'), async (req, res) => {
  const v = clean(req.body, { to: { req: true, enum: ACCIDENT_STAGES }, note: { max: 500 } });
  const r = await moveAccident(id(req), v.to as AccidentStage, v.note ?? null, req.user!.id);
  await audit(req, { action: 'vehicle_accident.stage', entity_type: 'vehicle_accident', entity_id: id(req), before: { stage: r.from }, after: { stage: r.to, note: v.note ?? null } });
  res.json({ ok: true });
});
fleetLogRouter.delete('/vehicle-accidents/:id', can('vehicle_accidents.delete'), async (req, res) => {
  const before = await one<any>('SELECT * FROM vehicle_accidents WHERE id = ?', [id(req)]);
  if (!before) fail(404, 'not_found');
  const use = await accidentUse(id(req));
  if (use.services) fail(409, 'accident_in_use', use);
  await tx(async () => {
    await exec('DELETE FROM vehicle_accident_events WHERE accident_id = ?', [id(req)]);
    await exec('DELETE FROM vehicle_accidents WHERE id = ?', [id(req)]);
  });
  await audit(req, { action: 'vehicle_accident.delete', entity_type: 'vehicle_accident', entity_id: id(req), before, severity: 'critical' });
  res.json({ ok: true });
});

// ======================================================================== the vehicle papers table
fleetLogRouter.get('/vehicle-papers', can('vehicles.view'), async (req, res) => {
  const rows = await vehiclePapers(req.query as Record<string, string>);
  res.json({ rows, stats: { total: rows.length, complete: rows.filter((r) => !r.missing).length, missing: rows.filter((r) => r.missing).length } });
});
fleetLogRouter.patch('/vehicles/:id/papers-note', can('vehicles.update'), async (req, res) => {
  const v = clean(req.body, { papers_note: { max: 500 } }, true);
  const r = await exec('UPDATE vehicles SET papers_note = ? WHERE id = ?', [v.papers_note ?? null, id(req)]);
  if (!r.affectedRows) fail(404, 'not_found');
  await audit(req, { action: 'vehicle.papers_note', entity_type: 'vehicle', entity_id: id(req), after: v });
  res.json({ ok: true });
});
// The servicing and accidents of one vehicle, for its profile
fleetLogRouter.get('/vehicles/:id/fleet-log', can('vehicles.view'), async (req, res) => {
  const services = await q(`SELECT s.id, s.service_type, s.status, s.scheduled_for, s.started_at, s.completed_at, s.cost, s.paid_amount, s.workshop
    FROM vehicle_services s WHERE s.vehicle_id = ? ORDER BY COALESCE(s.completed_at, s.started_at, s.scheduled_for, s.created_at) DESC LIMIT 50`, [id(req)]);
  const accidents = await q(`SELECT a.id, a.occurred_at, a.severity, a.authority, a.stage, r.full_name rider_name FROM vehicle_accidents a
    LEFT JOIN riders r ON r.id = a.rider_id WHERE a.vehicle_id = ? ORDER BY a.occurred_at DESC LIMIT 50`, [id(req)]);
  res.json({ services, accidents });
});
