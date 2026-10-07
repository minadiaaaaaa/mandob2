import { Router, type Request } from 'express';
import { exec, one, q, tx } from '../db.js';
import { HttpError, clean, fail, fieldError, inList, eq, list, listAll, sendExport, today, where, type Spec, type Query } from '../http.js';
import { can, has } from '../auth.js';
import { audit } from '../audit.js';
import { claimScan } from '../scans.js';
import { removeAttachment } from '../files.js';
import { cellDate, cellStr, importRoutes, type ImportDef } from '../importer.js';

export const ridersRouter = Router();

// ---------- the five rider documents ----------
export const DOC_TYPES = {
  id: { module: 'id_documents', label: 'docs.id' },
  license: { module: 'driving_licenses', label: 'docs.license' },
  health: { module: 'health_certs', label: 'docs.health' },
  driver_card: { module: 'driver_cards', label: 'docs.driver_card' },
  ajeer: { module: 'ajeer_permits', label: 'docs.ajeer' },
} as const;
export type DocType = keyof typeof DOC_TYPES;
const isDocType = (t: string): t is DocType => t in DOC_TYPES;

const hijri = { max: 10 };
const DOC_RULES: Record<DocType, Record<string, any>> = {
  id: { id_kind: { req: true, enum: ['national_id', 'iqama', 'passport'] }, version_number: { max: 10 }, place_of_issue: { max: 100 }, issue_date: { type: 'date' }, expiry_date: { req: true, type: 'date' } },
  license: { doc_number: { req: true, max: 50 }, license_type: { req: true, max: 100 }, license_type_en: { max: 100 }, issue_date: { type: 'date' }, expiry_date: { req: true, type: 'date' } },
  health: { doc_number: { req: true, max: 50 }, cert_type: { req: true, max: 100 }, issuing_authority: { max: 150 }, issue_date: { type: 'date' }, expiry_date: { req: true, type: 'date' }, issue_date_hijri: hijri, expiry_date_hijri: hijri },
  driver_card: { doc_number: { req: true, max: 50 }, transport_license_id: { req: true, type: 'int' }, card_category: { enum: ['yearly', 'half_yearly', 'quarterly', 'temporary'] }, issue_date: { type: 'date' }, expiry_date: { req: true, type: 'date' } },
  ajeer: { doc_number: { req: true, max: 50 }, beneficiary_company_id: { type: 'int' }, contract_summary: { max: 255 }, work_locations: { max: 255 }, issue_date: { type: 'date' }, expiry_date: { req: true, type: 'date' } },
};

function checkHijri(v: Record<string, any>) {
  for (const k of ['issue_date_hijri', 'expiry_date_hijri']) {
    if (!v[k]) continue;
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v[k]);
    if (!m || +m[1] < 1300 || +m[1] > 1550 || +m[2] > 12 || +m[3] > 30) fieldError(k, 'invalid_hijri');
  }
}

// Saving a document always records a new version that becomes current; the previous one becomes superseded.
async function saveDocument(req: Request, riderId: number, type: DocType, body: Record<string, any>) {
  const mod = DOC_TYPES[type].module;
  if (!has(req, `${mod}.create`)) throw new HttpError(403, 'forbidden', { perm: `${mod}.create` });
  if (body.scan && !has(req, `${mod}.upload`)) throw new HttpError(403, 'forbidden', { perm: `${mod}.upload` });
  const v = clean(body, DOC_RULES[type]);
  if (v.issue_date && v.expiry_date && v.expiry_date < v.issue_date) fieldError('expiry_date', 'expiry_before_issue');
  checkHijri(v);
  if (v.doc_number) {
    const dup = await one<any>('SELECT d.rider_id, r.full_name FROM rider_documents d JOIN riders r ON r.id = d.rider_id WHERE d.doc_type = ? AND d.doc_number = ?', [type, v.doc_number]);
    if (dup) fieldError('doc_number', 'doc_number_taken', { name: dup.full_name, rider: dup.rider_id });
  }
  if (v.transport_license_id && !(await one('SELECT 1 FROM transport_licenses WHERE id = ?', [v.transport_license_id]))) fieldError('transport_license_id', 'invalid');
  return tx(async () => {
    await exec('UPDATE rider_documents SET is_current = 0 WHERE rider_id = ? AND doc_type = ? AND is_current = 1', [riderId, type]);
    const r = await exec('INSERT INTO rider_documents SET ?', [{ ...v, rider_id: riderId, doc_type: type, created_by: req.user!.id }]);
    await claimScan(req, body.scan, `rider_doc_${type}`, r.insertId);
    await audit(req, { action: 'rider_document.create', entity_type: `rider_doc_${type}`, entity_id: r.insertId, after: { rider_id: riderId, ...v } });
    return r.insertId;
  });
}

// Saves the documents that were filled in; a refused document does not undo the rider.
async function saveDocuments(req: Request, riderId: number, docs: Record<string, any> | undefined) {
  const failed: { type: string; error: string; params?: unknown; fields?: unknown }[] = [];
  for (const [type, body] of Object.entries(docs ?? {})) {
    if (!isDocType(type) || !body) continue;
    if (!Object.entries(body).some(([k, v]) => v !== null && v !== '' && v !== undefined && k !== 'cert_type')) continue; // an untouched section is not sent
    try { await saveDocument(req, riderId, type, body); }
    catch (e: any) {
      if (!(e instanceof HttpError)) throw e;
      failed.push({ type, error: e.code, params: e.params, fields: e.fields });
    }
  }
  return failed;
}

// ---------- vehicle assignment from the rider form ----------
export async function assignVehicle(req: Request, riderId: number, vehicleId: number | null, date?: string) {
  const day = date ?? (await today());
  const cur = await one<{ id: number; vehicle_id: number }>('SELECT id, vehicle_id FROM vehicle_assignments WHERE rider_id = ? AND is_current = 1', [riderId]);
  if (cur?.vehicle_id === vehicleId) return;
  if (vehicleId) {
    const holder = await one<any>('SELECT r.id, r.full_name FROM vehicle_assignments a JOIN riders r ON r.id = a.rider_id WHERE a.vehicle_id = ? AND a.is_current = 1 AND a.rider_id <> ?', [vehicleId, riderId]);
    if (holder) fieldError('vehicle_id', 'vehicle_taken', { name: holder.full_name });
  }
  if (cur) await exec('UPDATE vehicle_assignments SET is_current = 0, end_date = ? WHERE id = ?', [day, cur.id]);
  if (vehicleId) await exec('INSERT INTO vehicle_assignments (rider_id, vehicle_id, start_date) VALUES (?, ?, ?)', [riderId, vehicleId, day]);
  await audit(req, { action: 'assignment.change', entity_type: 'rider', entity_id: riderId, before: { vehicle_id: cur?.vehicle_id ?? null }, after: { vehicle_id: vehicleId } });
}

// ---------- list ----------
const riderRules = {
  full_name: { req: true, max: 150 }, name_en: { max: 150 }, alias: { max: 150 }, national_id: { max: 30 },
  status: { enum: ['active', 'inactive', 'suspended', 'terminated'] }, company_id: { type: 'int' as const }, contract_id: { type: 'int' as const },
  city_id: { type: 'int' as const }, hire_date: { type: 'date' as const }, occupation: { max: 150 }, phone: { type: 'phone' as const, max: 30 },
  account_holder_phone: { type: 'phone' as const, max: 30 }, email: { type: 'email' as const, max: 150 }, language: { enum: ['ar', 'en', 'bn'] },
  nationality: { max: 100 }, birth_date: { type: 'date' as const }, birth_place: { max: 150 },
  blood_type: { enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] }, notes: { max: 500 },
};

function riderSpec(day: string): Spec {
  return {
    from: `FROM riders r
      LEFT JOIN companies co ON co.id = r.company_id LEFT JOIN contracts k ON k.id = r.contract_id LEFT JOIN cities ci ON ci.id = r.city_id
      LEFT JOIN vehicle_assignments va ON va.rider_id = r.id AND va.is_current = 1 LEFT JOIN vehicles v ON v.id = va.vehicle_id
      LEFT JOIN (SELECT rider_id, GROUP_CONCAT(DISTINCT doc_type) types, SUM(expiry_date < '${day}') expired
        FROM rider_documents WHERE is_current = 1 GROUP BY rider_id) d ON d.rider_id = r.id`,
    select: `r.id, r.full_name, r.name_en, r.alias, r.national_id, r.phone, r.status, r.company_id, co.name company_name, k.name contract_name,
      ci.name_ar city_ar, ci.name_en city_en, v.id vehicle_id, v.plate vehicle_plate, d.types doc_types, COALESCE(d.expired, 0) docs_expired, r.hire_date, r.nationality`,
    search: ['r.full_name', 'r.name_en', 'r.alias', 'CAST(r.id AS CHAR)', 'r.phone', 'r.account_holder_phone', 'r.national_id',
      'r.id IN (SELECT rider_id FROM rider_documents WHERE doc_number LIKE ?)'],
    filters: {
      company: (v) => v === 'none' ? 'r.company_id IS NULL' : ['r.company_id = ?', [v]],
      contract: (v) => v === 'none' ? 'r.contract_id IS NULL' : ['r.contract_id = ?', [v]],
      city: eq('r.city_id'),
      status: inList('r.status'),
      vehicle: (v) => v === 'yes' ? 'va.id IS NOT NULL' : 'va.id IS NULL',
      vehicle_type: eq('v.vehicle_type'),
      documents: (v) => ({
        complete: "d.types IS NOT NULL AND LENGTH(d.types) - LENGTH(REPLACE(d.types, ',', '')) = 4 AND d.expired = 0",
        incomplete: "d.types IS NOT NULL AND LENGTH(d.types) - LENGTH(REPLACE(d.types, ',', '')) < 4",
        some_expired: 'd.expired > 0',
        none: 'd.types IS NULL',
      } as Record<string, string>)[v] ?? null,
      missing: (v) => ['NOT EXISTS (SELECT 1 FROM rider_documents x WHERE x.rider_id = r.id AND x.doc_type = ? AND x.is_current = 1)', [v]],
      nationality: eq('r.nationality'),
      language: eq('r.language'),
      has_phone: (v) => v === 'yes' ? "r.phone IS NOT NULL AND r.phone <> ''" : "(r.phone IS NULL OR r.phone = '')",
      hired_from: (v) => ['r.hire_date >= ?', [v]],
      hired_to: (v) => ['r.hire_date <= ?', [v]],
    },
    sorts: { rider: 'r.full_name', id: 'r.id' },
    defaultSort: 'rider',
  };
}
ridersRouter.get('/riders', can('riders.view'), async (req, res) => {
  const spec = riderSpec(await today());
  const query = req.query as Query;
  const data = await list(spec, query);
  // Cards follow the search and the company, contract, city, status and vehicle filters only.
  const w = where(spec, query, ['vehicle_type', 'documents', 'missing', 'nationality', 'language', 'has_phone', 'hired_from', 'hired_to']);
  const [stats] = await q(`SELECT COUNT(*) total, COALESCE(SUM(r.status = 'active'),0) active, COALESCE(SUM(r.status = 'inactive'),0) inactive,
    COALESCE(SUM(r.status = 'suspended'),0) suspended, COALESCE(SUM(r.status = 'terminated'),0) \`terminated\`, COALESCE(SUM(va.id IS NOT NULL),0) with_vehicle,
    COALESCE(SUM(r.company_id IS NULL),0) no_company, COALESCE(SUM(r.contract_id IS NULL),0) no_contract ${spec.from}${w.sql}`, w.params);
  res.json({ ...data, stats });
});

ridersRouter.get('/riders/export', can('riders.export'), async (req, res) => {
  const spec = riderSpec(await today());
  const query: Query = { ...(req.query as Query), sort: 'rider' };
  // The file follows the search and the company, contract, city, status and vehicle filters, like the cards.
  for (const k of ['vehicle_type', 'documents', 'missing', 'nationality', 'language', 'has_phone', 'hired_from', 'hired_to']) delete query[k];
  const rows = await listAll(spec, query);
  const full = rows.length ? await q('SELECT * FROM riders WHERE id IN (?)', [rows.map((r: any) => r.id)]) : [];
  const byId = new Map(full.map((r: any) => [r.id, r]));
  const STATUS: Record<string, string> = { active: 'Active', inactive: 'Stopped', suspended: 'Suspended', terminated: 'Ended' };
  await sendExport(req, res, {
    format: 'xlsx', title: 'riders.title', rows: rows.map((r: any) => ({ ...byId.get(r.id), ...r })), cols: [
      { key: 'id', label: 'riders.rider_id' }, { key: 'full_name', label: 'riders.full_name' }, { key: 'name_en', label: 'riders.name_en' },
      { key: 'alias', label: 'riders.alias' }, { key: 'national_id', label: 'riders.national_id' }, { key: 'nationality', label: 'riders.nationality' },
      { key: 'birth_date', label: 'riders.birth_date' }, { key: 'birth_place', label: 'riders.birth_place' }, { key: 'blood_type', label: 'riders.blood_type' },
      { key: 'phone', label: 'riders.phone' }, { key: 'account_holder_phone', label: 'riders.account_holder_phone' }, { key: 'email', label: 'riders.email' },
      { key: 'language', label: 'riders.language' }, { key: 'company_name', label: 'riders.company' }, { key: 'contract_name', label: 'riders.contract' },
      { key: 'city_ar', label: 'riders.city' }, { key: 'vehicle_plate', label: 'riders.vehicle' }, { key: 'occupation', label: 'riders.occupation' },
      { key: 'hire_date', label: 'riders.hire_date' }, { key: 'status', label: 'riders.status_col', value: (r) => STATUS[r.status] }, { key: 'notes', label: 'riders.notes' },
    ],
  });
});

// ---------- one rider ----------
async function riderProfile(req: Request, id: number) {
  const r = await one<any>(`SELECT r.*, co.name company_name, co.email company_email, co.operator_id, k.name contract_name, ci.name_ar city_ar, ci.name_en city_en,
      va.id assignment_id, va.start_date assigned_since, v.id vehicle_id, v.plate vehicle_plate, v.maker vehicle_maker, v.model vehicle_model
    FROM riders r LEFT JOIN companies co ON co.id = r.company_id LEFT JOIN contracts k ON k.id = r.contract_id LEFT JOIN cities ci ON ci.id = r.city_id
    LEFT JOIN vehicle_assignments va ON va.rider_id = r.id AND va.is_current = 1 LEFT JOIN vehicles v ON v.id = va.vehicle_id WHERE r.id = ?`, [id]);
  if (!r) fail(404, 'rider_not_found');
  delete r.portal_password_hash;
  const day = await today();
  const docs: Record<string, any> = {};
  for (const [type, { module }] of Object.entries(DOC_TYPES)) {
    if (!has(req, `${module}.view`)) continue;
    const d = await one<any>(`SELECT d.*, t.number transport_license_number, c.name beneficiary_company_name, DATEDIFF(d.expiry_date, ?) days_left,
        (SELECT COUNT(*) FROM rider_documents WHERE rider_id = d.rider_id AND doc_type = d.doc_type) versions
      FROM rider_documents d LEFT JOIN transport_licenses t ON t.id = d.transport_license_id LEFT JOIN companies c ON c.id = d.beneficiary_company_id
      WHERE d.rider_id = ? AND d.doc_type = ? AND d.is_current = 1`, [day, id, type]);
    docs[type] = d ?? null;
    if (d && has(req, `${module}.download`)) {
      d.files = await q("SELECT id, file_name, mime, size, is_current, created_at FROM attachments WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC", [`rider_doc_${type}`, String(d.id)]);
    }
  }
  return { ...r, documents: docs };
}

ridersRouter.get('/riders/:id', can('riders.view'), async (req, res) => {
  if (!/^\d+$/.test(req.params.id as string)) fail(404, 'rider_not_found');
  res.json(await riderProfile(req, Number(req.params.id)));
});

async function checkRider(v: Record<string, any>, id: number, current?: any) {
  if (v.national_id) {
    const dup = await one<any>('SELECT id, full_name FROM riders WHERE national_id = ? AND id <> ?', [v.national_id, id]);
    if (dup) fieldError('national_id', 'national_id_taken', { name: dup.full_name });
  }
  const birth = v.birth_date !== undefined ? v.birth_date : current?.birth_date;
  const hire = v.hire_date !== undefined ? v.hire_date : current?.hire_date;
  if (birth && hire && hire < birth) fieldError('hire_date', 'hire_before_birth');
  const company = v.company_id !== undefined ? v.company_id : current?.company_id;
  const contract = v.contract_id !== undefined ? v.contract_id : current?.contract_id;
  if (contract) {
    const k = await one<any>('SELECT company_id FROM contracts WHERE id = ?', [contract]);
    if (!k || k.company_id !== company) fieldError('contract_id', 'contract_other_company');
  }
}

ridersRouter.post('/riders', can('riders.create'), async (req, res) => {
  const body = req.body ?? {};
  const idRaw = String(body.id ?? '').trim();
  if (!/^\d{1,20}$/.test(idRaw)) fieldError('id', 'rider_id_digits');
  const id = Number(idRaw);
  const v = clean(body, riderRules);
  const taken = await one<any>('SELECT full_name FROM riders WHERE id = ?', [id]);
  if (taken) fieldError('id', 'rider_id_taken', { name: taken.full_name });
  await checkRider(v, id);
  await tx(async () => {
    await exec('INSERT INTO riders SET ?', [{ ...v, id, status: v.status ?? 'active' }]);
    if (body.vehicle_id) await assignVehicle(req, id, Number(body.vehicle_id), v.hire_date ?? undefined);
  });
  await audit(req, { action: 'rider.create', entity_type: 'rider', entity_id: id, after: v });
  const failed = await saveDocuments(req, id, body.documents);
  res.json({ id, failed });
});

ridersRouter.patch('/riders/:id', can('riders.update'), async (req, res) => {
  const id = Number(req.params.id);
  const before = await one<any>('SELECT * FROM riders WHERE id = ?', [id]);
  if (!before) fail(404, 'rider_not_found');
  const body = req.body ?? {};
  const v = clean(body, riderRules, true);
  await checkRider(v, id, before);
  await tx(async () => {
    if (Object.keys(v).length) await exec('UPDATE riders SET ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [v, id]);
    if ('vehicle_id' in body) await assignVehicle(req, id, body.vehicle_id ? Number(body.vehicle_id) : null);
  });
  if (Object.keys(v).length) await audit(req, { action: 'rider.update', entity_type: 'rider', entity_id: id, before: Object.fromEntries(Object.keys(v).map((k) => [k, before[k]])), after: v });
  const failed = await saveDocuments(req, id, body.documents);
  res.json({ id, failed });
});

// "Delete this section's data": the current version, every previous version and their files.
ridersRouter.delete('/riders/:id/documents/:type', can('riders.view'), async (req, res) => {
  const type = req.params.type as string;
  if (!isDocType(type)) fail(404, 'not_found');
  if (!has(req, `${DOC_TYPES[type as DocType].module}.delete`)) fail(403, 'forbidden', { perm: `${DOC_TYPES[type as DocType].module}.delete` });
  const docs = await q<{ id: number }>('SELECT id FROM rider_documents WHERE rider_id = ? AND doc_type = ?', [req.params.id, type]);
  await tx(async () => {
    for (const d of docs) {
      for (const a of await q<{ id: number }>('SELECT id FROM attachments WHERE entity_type = ? AND entity_id = ?', [`rider_doc_${type}`, String(d.id)])) await removeAttachment(a.id);
    }
    await exec('DELETE FROM rider_documents WHERE rider_id = ? AND doc_type = ?', [req.params.id, type]);
  });
  await audit(req, { action: 'rider_document.delete_all', entity_type: 'rider', entity_id: req.params.id as string, severity: 'critical', details: `${type}: ${docs.length}` });
  res.json({ deleted: docs.length });
});

// A rider linked to any other record cannot be deleted; the alternative is "Terminated".
async function blockers(ids: number[]) {
  return q<{ rider_id: number; what: string; n: number }>(`
    SELECT rider_id, 'documents' what, COUNT(*) n FROM rider_documents WHERE rider_id IN (?) GROUP BY rider_id UNION ALL
    SELECT rider_id, 'assignments', COUNT(*) FROM vehicle_assignments WHERE rider_id IN (?) GROUP BY rider_id UNION ALL
    SELECT rider_id, 'fuel_cards', COUNT(*) FROM fuel_cards WHERE rider_id IN (?) GROUP BY rider_id UNION ALL
    SELECT user_rider_id, 'registrations', COUNT(*) FROM vehicle_registrations WHERE user_rider_id IN (?) GROUP BY user_rider_id`, [ids, ids, ids, ids]);
}
async function deleteRiders(req: Request, ids: number[]) {
  if (!ids.length) fail(422, 'nothing_selected');
  if (ids.length > 200) fail(422, 'max_200');
  const b = await blockers(ids);
  if (b.length) fail(409, 'rider_linked', { blockers: b });
  await tx(async () => {
    await exec('UPDATE applicants SET rider_id = NULL WHERE rider_id IN (?)', [ids]);
    await exec('DELETE FROM riders WHERE id IN (?)', [ids]);
  });
  for (const id of ids) await audit(req, { action: 'rider.delete', entity_type: 'rider', entity_id: id, severity: 'critical' });
}
ridersRouter.delete('/riders/:id', can('riders.delete'), async (req, res) => {
  await deleteRiders(req, [Number(req.params.id)]);
  res.json({ ok: true });
});
ridersRouter.post('/riders/bulk-delete', can('riders.delete'), async (req, res) => {
  await deleteRiders(req, (req.body.ids ?? []).map(Number));
  res.json({ ok: true });
});

// Bulk edit: company, contract, city, status. All or nothing; a field cannot be emptied here.
ridersRouter.post('/riders/bulk-edit', can('riders.update'), async (req, res) => {
  const ids: number[] = (req.body.ids ?? []).map(Number);
  if (!ids.length) fail(422, 'nothing_selected');
  if (ids.length > 200) fail(422, 'max_200');
  const changes = clean(req.body.changes ?? {}, {
    company_id: { type: 'int' }, contract_id: { type: 'int' }, city_id: { type: 'int' }, status: { enum: ['active', 'inactive', 'suspended', 'terminated'] },
  }, true);
  for (const [k, val] of Object.entries(changes)) if (val === null) fieldError(k, 'choose_value');
  if (!Object.keys(changes).length) fail(422, 'no_field_chosen');
  if (changes.contract_id) {
    const k = await one<any>('SELECT company_id FROM contracts WHERE id = ?', [changes.contract_id]);
    if (!k) fieldError('contract_id', 'invalid');
    if (changes.company_id) { if (k.company_id !== changes.company_id) fieldError('contract_id', 'contract_other_company'); }
    else {
      const others = await q('SELECT id FROM riders WHERE id IN (?) AND (company_id IS NULL OR company_id <> ?)', [ids, k.company_id]);
      if (others.length) fieldError('contract_id', 'contract_other_company');
    }
  }
  if (changes.company_id && !changes.contract_id) {
    // A contract that is not one of the new company's contracts would be left inconsistent.
    const bad = await q('SELECT r.id FROM riders r JOIN contracts k ON k.id = r.contract_id WHERE r.id IN (?) AND k.company_id <> ?', [ids, changes.company_id]);
    if (bad.length) fieldError('company_id', 'contract_other_company');
  }
  const r = await exec('UPDATE riders SET ?, updated_at = UTC_TIMESTAMP() WHERE id IN (?)', [changes, ids]);
  await audit(req, { action: 'rider.bulk_edit', entity_type: 'rider', entity_id: ids.join(',').slice(0, 60), after: changes, details: `${ids.length} riders` });
  res.json({ updated: r.affectedRows });
});

// Vehicles for the rider form's picker: every vehicle, with its current holder.
ridersRouter.get('/riders-vehicle-options', can('riders.view'), async (_req, res) => {
  res.json(await q(`SELECT v.id, v.plate, v.plate_en, v.maker, v.model, v.vehicle_type, a.rider_id holder_id, r.full_name holder_name
    FROM vehicles v LEFT JOIN vehicle_assignments a ON a.vehicle_id = v.id AND a.is_current = 1 LEFT JOIN riders r ON r.id = a.rider_id ORDER BY v.plate`));
});
ridersRouter.get('/riders-options', can('riders.view', 'vehicle_assignments.view', 'fuel_cards.view', 'vehicle_registrations.view', 'leaves.create', 'advances.create', 'rider_portal.manage_issues', 'absences.view', 'advances.view'), async (req, res) => {
  const s = `%${req.query.search ?? ''}%`;
  // ?active=1 leaves out riders whose service has ended
  const active = req.query.active ? "AND r.status <> 'terminated'" : '';
  res.json(await q(`SELECT r.id, r.full_name, r.alias, r.national_id, r.phone, r.status, co.name company_name FROM riders r LEFT JOIN companies co ON co.id = r.company_id
    WHERE (r.full_name LIKE ? OR r.alias LIKE ? OR CAST(r.id AS CHAR) LIKE ? OR r.phone LIKE ? OR r.national_id LIKE ?) ${active} ORDER BY r.full_name LIMIT 30`, [s, s, s, s, s]));
});

// ---------- the five document follow-up screens ----------
function docSpec(type: DocType, day: string, windowDays: number): Spec {
  const days = `DATEDIFF(d.expiry_date, '${day}')`;
  return {
    from: `FROM rider_documents d JOIN riders r ON r.id = d.rider_id LEFT JOIN companies co ON co.id = r.company_id LEFT JOIN cities ci ON ci.id = r.city_id
      LEFT JOIN companies bc ON bc.id = d.beneficiary_company_id`,
    select: `d.*, r.full_name, r.national_id, co.name company_name, ci.name_ar city_ar, ci.name_en city_en, bc.name beneficiary_company_name,
      ${days} days_left, DATEDIFF(d.expiry_date, d.issue_date) validity_days,
      CASE WHEN d.expiry_date IS NULL THEN 'none' WHEN ${days} < 0 THEN 'expired' WHEN ${days} <= ${windowDays} THEN 'near' ELSE 'valid' END state`,
    search: ['r.full_name', type === 'id' ? 'r.national_id' : 'd.doc_number', 'CAST(r.id AS CHAR)'],
    filters: {
      type: () => [`d.doc_type = ?`, [type]],
      validity: (v) => {
        const conds = v.split(',').map((s) => ({ expired: `${days} < 0`, near: `${days} BETWEEN 0 AND ${windowDays}`, valid: `${days} > ${windowDays}`, none: 'd.expiry_date IS NULL' } as Record<string, string>)[s]).filter(Boolean);
        return conds.length ? `(${conds.join(' OR ')})` : null;
      },
      company: eq('r.company_id'),
      city: eq('r.city_id'),
      in_force: (v) => v === 'superseded' ? 'd.is_current = 0' : v === 'current' ? 'd.is_current = 1' : null,
    },
    sorts: { rider: 'r.full_name', expiry: 'd.expiry_date', remaining: `${days} IS NULL, ${days}` },
    defaultSort: 'remaining',
  };
}
async function docQuery(req: Request) {
  const type = req.params.type as string;
  if (!isDocType(type)) fail(404, 'not_found');
  const query: Query = { ...(req.query as Query), type: '1', in_force: (req.query.in_force as string) ?? 'current' };
  if (!has(req, 'riders.view')) { delete query.company; delete query.city; }
  const windowDays = Math.min(365, Math.max(1, Number(query.window) || 30));
  return { type: type as DocType, query, windowDays, spec: docSpec(type as DocType, await today(), windowDays) };
}
const docGuard = (action: string) => async (req: Request, _res: any, next: any) => {
  const t = req.params.type as string;
  if (!isDocType(t)) fail(404, 'not_found');
  return can(`${DOC_TYPES[t as DocType].module}.${action}`)(req, _res, next);
};

ridersRouter.get('/rider-documents/:type', docGuard('view'), async (req, res) => {
  const { query, spec, windowDays } = await docQuery(req);
  const data = await list(spec, query);
  const w = where(spec, query, ['validity']); // the cards are the distribution of the states themselves
  const days = spec.select.match(/DATEDIFF\(d\.expiry_date, '[^']+'\)/)![0];
  const [stats] = await q(`SELECT COUNT(*) documents, COUNT(DISTINCT d.rider_id) riders, COALESCE(SUM(${days} < 0),0) expired,
    COALESCE(SUM(${days} BETWEEN 0 AND ${windowDays}),0) near, COALESCE(SUM(${days} > ${windowDays}),0) valid, COALESCE(SUM(d.expiry_date IS NULL),0) none ${spec.from}${w.sql}`, w.params);
  res.json({ ...data, stats: { ...stats, window: windowDays } });
});

ridersRouter.get('/rider-documents/:type/export', docGuard('export'), async (req, res) => {
  const { type, query, spec } = await docQuery(req);
  const rows = await listAll(spec, query);
  const fields: Record<DocType, string[]> = {
    id: ['id_kind', 'version_number', 'place_of_issue'], license: ['doc_number', 'license_type', 'license_type_en'],
    health: ['doc_number', 'cert_type', 'issuing_authority', 'issue_date_hijri', 'expiry_date_hijri'],
    driver_card: ['doc_number', 'card_category'], ajeer: ['doc_number', 'beneficiary_company_name', 'contract_summary', 'work_locations'],
  };
  await sendExport(req, res, { format: 'csv', title: DOC_TYPES[type].label, rows, cols: [
    { key: 'id', label: 'common.record_no' }, { key: 'rider_id', label: 'riders.rider_id' }, { key: 'full_name', label: 'riders.rider' },
    { key: 'company_name', label: 'riders.company' }, { key: 'city_ar', label: 'riders.city' },
    ...(type === 'id' ? [{ key: 'national_id', label: 'riders.national_id' }] : []),
    ...fields[type].map((f) => ({ key: f, label: `docs.f.${f}` })),
    { key: 'issue_date', label: 'docs.f.issue_date' }, { key: 'expiry_date', label: 'docs.f.expiry_date' }, { key: 'status', label: 'docs.f.status' },
    { key: 'is_current', label: 'docs.in_force' }, { key: 'state', label: 'docs.validity' }, { key: 'days_left', label: 'docs.remaining' },
    { key: 'validity_days', label: 'docs.validity_days' }, { key: 'notes', label: 'common.notes' },
  ] });
});

// ---------- import riders ----------
const STATUS_IN: Record<string, string> = { active: 'active', inactive: 'inactive', stopped: 'inactive', suspended: 'suspended', terminated: 'terminated', ended: 'terminated' };
async function byName(table: string, col: string, name: string | null, ctx: any, extra = '') {
  if (!name) return null;
  const key = `${table}:${name}:${extra}`;
  if (!ctx.cache.has(key)) {
    const cols = table === 'cities' ? 'name_ar = ? OR name_en = ?' : `${col} = ?`;
    const params = table === 'cities' ? [name, name] : [name];
    const row = await one<{ id: number }>(`SELECT id FROM ${table} WHERE (${cols}) ${extra}`, params);
    ctx.cache.set(key, row?.id ?? 0);
  }
  return ctx.cache.get(key) || 0;
}

export const riderImport: ImportDef = {
  name: 'riders', perm: 'riders.import', matchOn: 'riders.rider_id',
  columns: {
    id: ['riders.rider_id', 'rider_id', 'rider id', 'riderid'], full_name: ['riders.full_name', 'name', 'full name'], name_en: ['riders.name_en', 'name_en'],
    alias: ['riders.alias', 'alias'], national_id: ['riders.national_id', 'id number', 'iqama', 'national id'], nationality: ['riders.nationality'],
    birth_place: ['riders.birth_place'], occupation: ['riders.occupation'], notes: ['riders.notes'], birth_date: ['riders.birth_date', 'date of birth'],
    hire_date: ['riders.hire_date', 'hire date'], blood_type: ['riders.blood_type'], phone: ['riders.phone', 'mobile', 'phone'],
    account_holder_phone: ['riders.account_holder_phone'], email: ['riders.email', 'email'], language: ['riders.language'],
    company: ['riders.company', 'company'], contract: ['riders.contract', 'contract', 'contract name'], city: ['riders.city', 'city'],
    status: ['riders.status_col', 'status'], vehicle: ['riders.vehicle', 'vehicle', 'plate'],
  },
  requiredColumns: [['id', 'national_id']],
  async parse(row, ctx) {
    const id = cellStr(row.id);
    const nid = cellStr(row.national_id, 30);
    if (!id && !nid) return 'no_key';
    if (id && !/^\d{1,20}$/.test(id)) return 'invalid_value';
    const data: Record<string, any> = {};
    for (const k of ['full_name', 'name_en', 'alias', 'nationality', 'birth_place', 'occupation']) if (ctx.present.has(k)) data[k] = cellStr(row[k], 150);
    if (ctx.present.has('notes')) data.notes = cellStr(row.notes, 500);
    if (ctx.present.has('national_id')) data.national_id = nid;
    for (const k of ['birth_date', 'hire_date']) if (ctx.present.has(k)) { const d = cellDate(row[k]); if (d === undefined) return 'invalid_value'; data[k] = d; }
    if (ctx.present.has('blood_type')) { const b = cellStr(row.blood_type)?.toUpperCase() ?? null; if (b && !riderRules.blood_type.enum.includes(b)) return 'invalid_value'; data.blood_type = b; }
    for (const k of ['phone', 'account_holder_phone']) if (ctx.present.has(k)) { const p = cellStr(row[k], 30); if (p && !/^\+?[\d\s()-]{5,}$/.test(p)) return 'invalid_value'; data[k] = p; }
    if (ctx.present.has('email')) { const e = cellStr(row.email, 150); if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return 'invalid_value'; data.email = e; }
    if (ctx.present.has('language')) { const l = cellStr(row.language)?.toLowerCase() ?? null; if (l && !['ar', 'en', 'bn'].includes(l)) return 'invalid_value'; data.language = l; }
    if (ctx.present.has('status')) { const s = cellStr(row.status)?.toLowerCase() ?? null; if (s && !STATUS_IN[s]) return 'invalid_value'; data.status = s ? STATUS_IN[s] : null; }
    const warnings: string[] = [];
    if (ctx.present.has('company')) { const n = cellStr(row.company); const cid = await byName('companies', 'name', n, ctx); if (n && !cid) warnings.push(`company:${n}`); data.company_id = cid || null; }
    if (ctx.present.has('city')) { const n = cellStr(row.city); const cid = await byName('cities', 'name_ar', n, ctx); if (n && !cid) warnings.push(`city:${n}`); data.city_id = cid || null; }
    if (ctx.present.has('contract')) {
      const n = cellStr(row.contract);
      const cid = await byName('contracts', 'name', n, ctx, data.company_id ? `AND company_id = ${Number(data.company_id)}` : '');
      if (n && !cid) warnings.push(`contract:${n}`);
      data.contract_id = cid || null;
    }
    return { line: 0, key: id ? `id:${id}` : `nid:${nid}`, data: { ...data, _id: id ? Number(id) : null }, label: data.full_name ?? '', warnings };
  },
  async existing(items) {
    const ids = items.map((i) => i.data._id).filter(Boolean);
    const nids = items.filter((i) => !i.data._id).map((i) => i.data.national_id).filter(Boolean);
    const m = new Map<string, any>();
    if (ids.length) for (const r of await q('SELECT * FROM riders WHERE id IN (?)', [ids])) m.set(`id:${r.id}`, r);
    if (nids.length) for (const r of await q('SELECT * FROM riders WHERE national_id IN (?)', [nids])) m.set(`nid:${r.national_id}`, r);
    return m;
  },
  // Problems found against the register appear in the preview, with the row number.
  async check(it, ex) {
    const { _id, national_id, full_name } = it.data;
    if (national_id) {
      const dup = await one<any>('SELECT id FROM riders WHERE national_id = ? AND id <> ?', [national_id, ex?.id ?? _id ?? 0]);
      if (dup) return 'national_id_in_use';
    }
    if (!ex && !_id) return 'new_without_id';
    if (!ex && !full_name) return 'new_without_name';
    return null;
  },
  async write(it, ex, ctx) {
    const { _id, ...data } = it.data;
    // An empty cell never clears an existing value.
    const values = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null && v !== undefined));
    if (values.national_id) {
      const dup = await one<any>('SELECT id FROM riders WHERE national_id = ? AND id <> ?', [values.national_id, ex?.id ?? _id ?? 0]);
      if (dup) return 'failed';
    }
    if (ex) {
      if (ctx.mode === 'skip') return 'skipped';
      if (Object.keys(values).length) await exec('UPDATE riders SET ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [values, ex.id]);
      return 'replaced';
    }
    if (!_id) return 'failed';            // matched on ID number and not registered: needs a rider id
    if (!values.full_name) return 'failed'; // the full name is required for a new rider
    await exec('INSERT INTO riders SET ?', [{ status: 'active', ...values, id: _id }]);
    return 'inserted';
  },
};
ridersRouter.use('/riders/import', importRoutes(riderImport));
