// Phase 4: the servicing log and accident records, defined once for the screens and the tests.
//
// Servicing: scheduled → in_progress → completed, or cancelled from either. While a vehicle has a service in
// progress it is under maintenance; when its last one ends it is back in service (taking a plan place again if it
// was out). Only a completed service can be paid; the payment is kept on the record.
//
// Accidents: report_pending → assessment_pending → claim_pending → completed. A stage may move forward one or more
// steps; going back needs a note. Every move is kept in vehicle_accident_events.
import { exec, one, q, tx } from '../db.js';
import { fail, fieldError } from '../http.js';
import { comesBack, ensureQuota } from './quotas.js';

export const SERVICE_TYPES = ['periodic', 'repair', 'accident_repair', 'tires', 'battery', 'inspection', 'other'] as const;
export const SERVICE_STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled'] as const;
export const ACCIDENT_SEVERITIES = ['minor', 'moderate', 'severe'] as const;
export const ACCIDENT_AUTHORITIES = ['najm', 'murur'] as const;
export const ACCIDENT_STAGES = ['report_pending', 'assessment_pending', 'claim_pending', 'completed'] as const;
export type AccidentStage = (typeof ACCIDENT_STAGES)[number];

// The vehicle and rider a record names must be this company's (queries are company-scoped; the keys refuse
// another company's ids too). A retired vehicle gets no new records.
export async function checkFleetLinks(v: Record<string, any>, current: Record<string, any> = {}) {
  if (v.vehicle_id != null && Number(v.vehicle_id) !== Number(current.vehicle_id)) {
    const veh = await one<{ status: string }>('SELECT status FROM vehicles WHERE id = ?', [v.vehicle_id]);
    if (!veh) fieldError('vehicle_id', 'vehicle_not_found');
    if (veh!.status === 'retired') fieldError('vehicle_id', 'vehicle_retired');
  }
  if (v.rider_id != null && Number(v.rider_id) !== Number(current.rider_id)) {
    if (!(await one('SELECT 1 FROM riders WHERE id = ?', [v.rider_id]))) fieldError('rider_id', 'rider_not_found');
  }
  if (v.accident_id != null && Number(v.accident_id) !== Number(current.accident_id)) {
    const a = await one<{ vehicle_id: number }>('SELECT vehicle_id FROM vehicle_accidents WHERE id = ?', [v.accident_id]);
    if (!a) fieldError('accident_id', 'accident_not_found');
    if (Number(a!.vehicle_id) !== Number(v.vehicle_id ?? current.vehicle_id)) fieldError('accident_id', 'accident_other_vehicle');
  }
}

// The rider holding the vehicle now, for a new record that names none.
export async function currentHolder(vehicleId: number | string) {
  return (await one<{ rider_id: number }>('SELECT rider_id FROM vehicle_assignments WHERE vehicle_id = ? AND is_current = 1 ORDER BY id DESC LIMIT 1', [vehicleId]))?.rider_id ?? null;
}

// ---------- servicing ----------
// After a service starts or ends: under maintenance while any service of the vehicle is in progress, otherwise back
// in service if it was under maintenance. A retired vehicle is left alone.
async function syncVehicleStatus(vehicleId: number) {
  const v = await one<{ status: string }>('SELECT status FROM vehicles WHERE id = ? FOR UPDATE', [vehicleId]);
  if (!v || v.status === 'retired') return;
  const open = await one("SELECT 1 FROM vehicle_services WHERE vehicle_id = ? AND status = 'in_progress' LIMIT 1", [vehicleId]);
  const want = open ? 'maintenance' : 'active';
  if (v.status === want) return;
  if (comesBack('vehicles', v.status, want)) await ensureQuota('vehicles', 1);
  await exec('UPDATE vehicles SET status = ? WHERE id = ?', [want, vehicleId]);
}

type Service = { id: number; vehicle_id: number; status: string; cost: string | null; paid_amount: string | null };
async function lockService(id: number | string) {
  const s = await one<Service>('SELECT id, vehicle_id, status, cost, paid_amount FROM vehicle_services WHERE id = ? FOR UPDATE', [id]);
  if (!s) fail(404, 'not_found');
  return s!;
}

// A new service; `start` puts it in progress at once (the vehicle is at the workshop now).
export async function createService(v: Record<string, any>, userId: number | null, start: boolean) {
  await checkFleetLinks(v);
  const row = { ...v, rider_id: v.rider_id !== undefined ? v.rider_id : await currentHolder(v.vehicle_id), created_by: userId };
  return tx(async () => {
    const r = await exec(`INSERT INTO vehicle_services SET ?${start ? ", status = 'in_progress', started_at = UTC_TIMESTAMP()" : ''}`, [row]);
    if (start) await syncVehicleStatus(Number(v.vehicle_id));
    return r.insertId;
  });
}

export async function startService(id: number | string) {
  return tx(async () => {
    const s = await lockService(id);
    if (s.status !== 'scheduled') fail(409, 'service_not_scheduled');
    await exec("UPDATE vehicle_services SET status = 'in_progress', started_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP() WHERE id = ?", [id]);
    await syncVehicleStatus(s.vehicle_id);
  });
}

// `done` (YYYY-MM-DD, default now) is when the work ended; the cost is what the workshop charged.
export async function completeService(id: number | string, o: { cost?: number | null; odometer?: number | null; details?: string | null; done?: string | null }) {
  return tx(async () => {
    const s = await lockService(id);
    if (s.status !== 'in_progress' && s.status !== 'scheduled') fail(409, 'service_closed');
    const set: Record<string, any> = { status: 'completed' };
    if (o.cost !== undefined) set.cost = o.cost;
    if (o.odometer != null) set.odometer = o.odometer;
    if (o.details) set.details = o.details;
    await exec(`UPDATE vehicle_services SET ?, completed_at = ${o.done ? '?' : 'UTC_TIMESTAMP()'}, started_at = COALESCE(started_at, completed_at), updated_at = UTC_TIMESTAMP() WHERE id = ?`,
      o.done ? [set, `${o.done} 12:00:00`, id] : [set, id]);
    // the odometer only goes forward
    if (o.odometer != null) await exec('UPDATE vehicles SET odometer = GREATEST(odometer, ?) WHERE id = ?', [o.odometer, s.vehicle_id]);
    await syncVehicleStatus(s.vehicle_id);
  });
}

export async function cancelService(id: number | string, reason: string) {
  return tx(async () => {
    const s = await lockService(id);
    if (s.status === 'completed' || s.status === 'cancelled') fail(409, 'service_closed');
    await exec("UPDATE vehicle_services SET status = 'cancelled', cancelled_at = UTC_TIMESTAMP(), cancel_reason = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?", [reason, id]);
    await syncVehicleStatus(s.vehicle_id);
  });
}

// The payment of a completed service: how much, when, and its reference. Paying more than the cost is refused.
export async function payService(id: number | string, p: { amount: number; paid_on: string; ref?: string | null }) {
  return tx(async () => {
    const s = await lockService(id);
    if (s.status !== 'completed') fail(409, 'service_not_completed');
    if (s.cost == null) fieldError('amount', 'service_cost_missing');
    if (p.amount <= 0) fieldError('amount', 'too_small');
    if (p.amount > Number(s.cost)) fieldError('amount', 'more_than_cost', { cost: s.cost });
    await exec('UPDATE vehicle_services SET paid_amount = ?, paid_on = ?, payment_ref = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [p.amount, p.paid_on, p.ref ?? null, id]);
  });
}

// ---------- accidents ----------
export async function createAccident(v: Record<string, any>, userId: number | null) {
  await checkFleetLinks(v);
  const row: Record<string, any> = { ...v, rider_id: v.rider_id !== undefined ? v.rider_id : await currentHolder(v.vehicle_id), created_by: userId };
  return tx(async () => {
    const r = await exec('INSERT INTO vehicle_accidents SET ?', [row]);
    await exec('INSERT INTO vehicle_accident_events SET ?, at = UTC_TIMESTAMP()', [{ accident_id: r.insertId, from_stage: null, to_stage: row.stage ?? 'report_pending', note: null, user_id: userId }]);
    return r.insertId;
  });
}

// Moves an accident to another stage. Forward needs nothing; back needs a note (it undoes a step someone took).
export async function moveAccident(id: number | string, to: AccidentStage, note: string | null, userId: number | null) {
  return tx(async () => {
    const a = await one<{ stage: AccidentStage }>('SELECT stage FROM vehicle_accidents WHERE id = ? FOR UPDATE', [id]);
    if (!a) fail(404, 'not_found');
    const from = a!.stage;
    if (from === to) fail(409, 'same_stage');
    const back = ACCIDENT_STAGES.indexOf(to) < ACCIDENT_STAGES.indexOf(from);
    if (back && !note) fieldError('note', 'note_required_to_go_back');
    await exec(`UPDATE vehicle_accidents SET stage = ?, completed_at = ${to === 'completed' ? 'UTC_TIMESTAMP()' : 'NULL'}, updated_at = UTC_TIMESTAMP() WHERE id = ?`, [to, id]);
    await exec('INSERT INTO vehicle_accident_events SET ?, at = UTC_TIMESTAMP()', [{ accident_id: id, from_stage: from, to_stage: to, note, user_id: userId }]);
    return { from, to };
  });
}

// What still points at an accident (a repair in the servicing log): it can be completed but not deleted then.
export async function accidentUse(id: number | string) {
  const [r] = await q<{ services: number }>('SELECT COUNT(*) services FROM vehicle_services WHERE accident_id = ?', [id]);
  return { services: Number(r.services) };
}

// ---------- the papers of each vehicle ----------
// One row per vehicle: its photo, its current registration (istimara), the key handover, its current operation
// card and a note. `missing` counts the four papers it lacks; the list puts the most missing first.
export const PAPERS = ['photo', 'registration', 'key_handover', 'operation_card'] as const;
export async function vehiclePapers(filters: { search?: string; missing?: string; branch?: string }) {
  const where: string[] = ["v.status <> 'retired'"]; const params: unknown[] = [];
  if (filters.search) { where.push('(v.plate LIKE ? OR v.plate_en LIKE ? OR r.full_name LIKE ?)'); const s = `%${filters.search}%`; params.push(s, s, s); }
  if (filters.branch) { where.push('v.branch_id = ?'); params.push(filters.branch); }
  const rows = await q<any>(`SELECT v.id, v.plate, v.plate_en, v.maker, v.model, v.status, v.papers_note, r.id rider_id, r.full_name rider_name,
      (SELECT a.id FROM attachments a WHERE a.entity_type = 'vehicle' AND a.entity_id = CAST(v.id AS CHAR) AND a.attachment_type = 'photo' ORDER BY a.is_current DESC, a.id DESC LIMIT 1) photo_id,
      (SELECT a.id FROM attachments a WHERE a.entity_type = 'vehicle' AND a.entity_id = CAST(v.id AS CHAR) AND a.attachment_type = 'key_handover' ORDER BY a.is_current DESC, a.id DESC LIMIT 1) key_handover_id,
      (SELECT g.id FROM vehicle_registrations g WHERE g.vehicle_id = v.id AND g.is_current = 1 LIMIT 1) registration_id,
      (SELECT g.expiry_date FROM vehicle_registrations g WHERE g.vehicle_id = v.id AND g.is_current = 1 LIMIT 1) registration_expiry,
      (SELECT x.card_id FROM operation_card_vehicles x WHERE x.vehicle_id = v.id AND x.is_current = 1 LIMIT 1) operation_card_id,
      (SELECT oc.expiry_date FROM operation_card_vehicles x JOIN operation_cards oc ON oc.id = x.card_id WHERE x.vehicle_id = v.id AND x.is_current = 1 LIMIT 1) operation_card_expiry
    FROM vehicles v LEFT JOIN vehicle_assignments va ON va.vehicle_id = v.id AND va.is_current = 1 LEFT JOIN riders r ON r.id = va.rider_id
    WHERE ${where.join(' AND ')} ORDER BY v.plate`, params);
  const out = rows.map((r) => ({ ...r, missing: [r.photo_id, r.registration_id, r.key_handover_id, r.operation_card_id].filter((x) => x == null).length }));
  const filtered = filters.missing === '1' ? out.filter((r) => r.missing > 0) : out;
  // a vehicle with two riders appears once
  const seen = new Set<number>();
  return filtered.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true))).sort((a, b) => b.missing - a.missing || String(a.plate).localeCompare(String(b.plate)));
}
