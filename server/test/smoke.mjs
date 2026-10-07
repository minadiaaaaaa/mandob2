// End-to-end check of the API against a FRESH install (it creates companies, riders, vehicles…).
// Usage: node server/test/smoke.mjs http://localhost:4000   — admin user: admin / Admin12345!
import assert from 'node:assert/strict';
const base = process.argv[2] ?? 'http://localhost:4100';
let cookie = '';
async function api(method, path, body, raw = false) {
  const opts = { method, headers: { cookie } };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['content-type'] = 'application/json'; }
  const r = await fetch(base + '/api' + path, opts);
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  if (raw) return r;
  const j = await r.json().catch(() => ({}));
  return { ...j, _s: r.status, _body: j };
}
const ok = (r, msg) => { if (r._s >= 400) { console.error(msg, r._s, JSON.stringify(r._body)); process.exit(1); } return r; };

// --- sign in with the on-screen code
let ch = await api('GET', '/auth/challenge');
let r = await api('POST', '/auth/login', { username: 'admin', password: 'wrong-password', challengeId: ch.id, code: ch.code });
assert.equal(r.error, 'bad_credentials');
ch = r.params.challenge;
r = await api('POST', '/auth/login', { username: 'admin', password: 'Admin12345!', challengeId: ch.id, code: 'ZZZZZZ' });
assert.equal(r.error, 'code_invalid');
ch = r.params.challenge;
ok(await api('POST', '/auth/login', { username: 'admin@example.com', password: 'Admin12345!', challengeId: ch.id, code: ch.code.toLowerCase() }), 'login');
const me = ok(await api('GET', '/me'), 'me');
assert.ok(me.perms.includes('riders.view'));
console.log('login ok, perms', me.perms.length);

// --- arabic text round trip
ok(await api('PATCH', '/settings/organization', { name: 'مؤسسة تايسون للخدمات اللوجستية', tax_number: '300123456700003' }), 'org');
const org = await api('GET', '/public/org');
assert.equal(org['org.name'], 'مؤسسة تايسون للخدمات اللوجستية');

// --- companies, contracts
const co = ok(await api('POST', '/companies', { name: 'HungerStation', email: 'ops@hs.example', operator_id: '7788' }), 'company');
const dup = await api('POST', '/companies', { name: 'HungerStation' });
assert.equal(dup.fields?.name, 'company_name_taken');
const k = ok(await api('POST', '/contracts', { company_id: co.id, name: 'Riyadh 3PL', description: 'Main' }), 'contract');
const cities = await api('GET', '/lookups/cities');
const riyadh = cities._body.find((c) => c.name_en === 'Riyadh');

// --- transport licence, vehicles, operation card with two vehicles
const tl = ok(await api('POST', '/transport-licenses', { number: 'TL-1001', city_id: riyadh.id, expiry_date: '2027-06-30', activity_ar: 'نقل' }), 'licence');
const v1 = ok(await api('POST', '/vehicles', { plate: 'أ ب ج 1234', plate_en: '1234 abj', vehicle_type: 'motorcycle', maker: 'Honda', year: 2024 }), 'vehicle');
const v1dup = await api('POST', '/vehicles', { plate: 'اب ج1234', vehicle_type: 'car' });
assert.equal(v1dup.fields?.plate, 'plate_taken', 'plate normalisation catches hamza/spaces');
const v2 = ok(await api('POST', '/vehicles', { plate: 'د ر س 5678', vehicle_type: 'car', card: { number: 'OC-1', transport_license_id: tl.id, expiry_date: '2026-10-20' } }), 'vehicle+card');
ok(await api('PATCH', `/operation-cards/${v2.card_id}`, { vehicle_ids: [v2.id, v1.id] }), 'card vehicles');
const card = await api('GET', `/operation-cards/${v2.card_id}`);
assert.equal(card.vehicles.length, 2);
const vl = await api('GET', '/vehicles?search=1234');
assert.equal(vl.total, 1);
assert.equal((await api('GET', '/vehicles')).stats.cards_soon, 2, 'both vehicles carry a card expiring within 30 days');

// --- riders with documents and a vehicle
const rider = ok(await api('POST', '/riders', {
  id: '4000001', full_name: 'محمد أحمد', name_en: 'Mohammed Ahmed', national_id: '2456789012', company_id: co.id, contract_id: k.id, city_id: riyadh.id,
  phone: '0551234567', vehicle_id: v1.id, birth_date: '1995-01-01', hire_date: '2025-01-01',
  documents: {
    id: { id_kind: 'iqama', expiry_date: '2026-12-01' },
    license: { doc_number: 'L-77', license_type: 'نقل خفيف', expiry_date: '2027-01-01' },
    health: { doc_number: 'H-1', cert_type: 'صحية', expiry_date: '2026-10-10', issue_date_hijri: '1447-03-01' },
    driver_card: { doc_number: 'DC-1', transport_license_id: tl.id, card_category: 'yearly', expiry_date: '2027-03-01' },
    ajeer: { doc_number: 'AJ-1', expiry_date: '2025-01-01' },
  },
}), 'rider');
assert.deepEqual(rider.failed, []);
const r2taken = await api('POST', '/riders', { id: '4000002', full_name: 'Rahim Uddin', vehicle_id: v1.id });
assert.equal(r2taken.fields?.vehicle_id, 'vehicle_taken');
assert.equal((await api('GET', '/riders/4000002'))._s, 404, 'refused save leaves no rider');
ok(await api('POST', '/riders', { id: '4000002', full_name: 'Rahim Uddin' }), 'rider2');
const taken = await api('GET', '/riders/4000002');
assert.equal(taken._s, 200);
const dupId = await api('POST', '/riders', { id: '4000001', full_name: 'X' });
assert.equal(dupId.fields?.id, 'rider_id_taken');
const badContract = await api('POST', '/riders', { id: '4000003', full_name: 'Y', contract_id: k.id });
assert.equal(badContract.fields?.contract_id, 'contract_other_company');
const list = await api('GET', '/riders?search=L-77');
assert.equal(list.total, 1, 'search by licence number');
assert.equal(list.stats.with_vehicle, 1);
const prof = await api('GET', '/riders/4000001');
assert.equal(prof.vehicle_plate, 'أ ب ج 1234');
assert.equal(prof.documents.ajeer.days_left < 0, true);
const ajeerList = await api('GET', '/rider-documents/ajeer?validity=expired');
assert.equal(ajeerList.total, 1);
assert.equal(ajeerList.stats.expired, 1);
// new version of the licence supersedes the old one
ok(await api('PATCH', '/riders/4000001', { documents: { license: { doc_number: 'L-78', license_type: 'نقل خفيف', expiry_date: '2029-01-01' } } }), 'new licence version');
const lic = await api('GET', '/rider-documents/license?in_force=superseded');
assert.equal(lic.total, 1);
const del = await api('DELETE', '/riders/4000001');
assert.equal(del.error, 'rider_linked');
// bulk edit refuses a contract from another company
const co2 = ok(await api('POST', '/companies', { name: 'Keeta' }), 'company2');
const be = await api('POST', '/riders/bulk-edit', { ids: [4000001, 4000002], changes: { company_id: co2.id, contract_id: k.id } });
assert.equal(be.fields?.contract_id, 'contract_other_company');
ok(await api('POST', '/riders/bulk-edit', { ids: [4000002], changes: { status: 'inactive', city_id: riyadh.id } }), 'bulk edit');

// --- assignments: closing the previous, refusing a taken vehicle
const v3 = ok(await api('POST', '/vehicles', { plate: 'ص ق ع 9999', vehicle_type: 'car' }), 'v3');
const as = ok(await api('POST', '/vehicle-assignments', { rider_id: 4000001, vehicle_id: v3.id, start_date: '2026-10-01' }), 'assign v3');
const prof2 = await api('GET', '/riders/4000001');
assert.equal(prof2.vehicle_id, v3.id, 'previous assignment closed');
const takenV = await api('POST', '/vehicle-assignments', { rider_id: 4000002, vehicle_id: v3.id });
assert.equal(takenV.fields?.vehicle_id, 'vehicle_taken');

// --- oil changes roll the schedule forward
const sch = ok(await api('POST', '/oil-changes', { vehicle_id: v3.id, interval_days: 90, last_change: '2026-01-10' }), 'schedule');
let s = await api('GET', `/oil-changes/${sch.id}`);
assert.equal(s.next_due, '2026-04-10');
const rec = ok(await api('POST', '/oil-changes/history', { change_date: '2026-09-01', vehicles: [{ vehicle_id: v3.id, odometer: 12000 }, { vehicle_id: 99999 }] }), 'record');
assert.equal(rec.recorded.length, 1); assert.equal(rec.rejected[0].reason, 'no_such_vehicle');
s = await api('GET', `/oil-changes/${sch.id}`);
assert.equal(s.last_change, '2026-09-01');
const low = await api('POST', '/oil-changes/history', { change_date: '2026-09-20', vehicles: [{ vehicle_id: v3.id, odometer: 100 }] });
assert.equal(low.rejected[0].reason, 'odometer_below_earlier');

// --- insurance: one current cover per vehicle, renewal goes to the log
const ic = ok(await api('POST', '/insurance/companies', { name_ar: 'التعاونية' }), 'insurer');
const p1 = ok(await api('POST', '/insurance/policies', { number: 'P-1', company_id: ic.id, expiry_date: '2027-01-01' }), 'policy1');
const p2 = ok(await api('POST', '/insurance/policies', { number: 'P-2', company_id: ic.id, expiry_date: '2027-01-01' }), 'policy2');
const c1 = ok(await api('POST', '/insurance/vehicles', { vehicle_id: v3.id, policy_id: p1.id, expiry_date: '2026-11-01' }), 'cover1');
const c2 = ok(await api('POST', '/insurance/vehicles', { vehicle_id: v3.id, policy_id: p2.id, expiry_date: '2026-12-01' }), 'cover2');
const covers = await api('GET', `/insurance/vehicles?vehicle=${v3.id}&current=current`);
assert.equal(covers.total, 1);
ok(await api('POST', `/insurance/vehicles/${c2.id}/renew`, { new_expiry: '2027-12-01', cost: 900 }), 'renew cover');
const delP = await api('DELETE', `/insurance/policies/${p1.id}`);
assert.equal(delP.error, 'policy_has_covers');

// --- applicants: hire
const ap = ok(await api('POST', '/applicants', { full_name: 'Karim', phone: '0509990000', has_vehicle: true, vehicle_type: 'motorcycle' }), 'applicant');
const early = await api('POST', `/applicants/${ap.id}/hire`, { rider_id: '4000010' });
assert.equal(early.error, 'applicant_not_approved');
ok(await api('PATCH', `/applicants/${ap.id}`, { status: 'approved' }), 'approve');
ok(await api('POST', `/applicants/${ap.id}/hire`, { rider_id: '4000010' }), 'hire');
const hired = await api('GET', `/applicants/${ap.id}`);
assert.equal(hired.status, 'hired'); assert.equal(hired.rider_id, 4000010);
const apl = await api('GET', '/applicants');
assert.equal(apl.stats.hired, 1);

// --- import riders: preview then run
const csv = 'Rider id,Full name,Company,City,Status\n4000020,Ali Hassan,HungerStation,Riyadh,active\n4000020,Dup,,,\n,No key,,,\n4000001,,,,suspended\n';
const fd = new FormData(); fd.append('file', new Blob([csv], { type: 'text/csv' }), 'riders.csv'); fd.append('mode', 'replace');
const pv = ok(await api('POST', '/riders/import/preview', fd), 'preview');
assert.equal(pv.rows, 4); assert.equal(pv.new, 1); assert.equal(pv.replace, 1); assert.equal(pv.problems, 2);
const run = ok(await api('POST', '/riders/import/run', { token: pv.token }), 'run');
assert.equal(run.inserted, 1); assert.equal(run.replaced, 1);
const r1 = await api('GET', '/riders/4000001');
assert.equal(r1.status, 'suspended'); assert.equal(r1.full_name, 'محمد أحمد', 'empty cell does not clear');

// --- exports return files
const x = await api('GET', '/riders/export', undefined, true);
assert.equal(x.status, 200); assert.match(x.headers.get('content-type'), /spreadsheet/);
const c = await api('GET', '/rider-documents/license/export', undefined, true);
assert.equal(c.status, 200);

// --- roles: protected admin permission, new role starts empty
const roles = await api('GET', '/roles');
const sa = roles.rows.find((x) => x.name === 'Super Admin');
const role = await api('GET', `/roles/${sa.id}`);
assert.ok(role.protected.includes('users.update'));
const strip = await api('PUT', `/roles/${sa.id}/permissions`, { perms: [] });
assert.equal(strip.error, 'protected_permission');
const nr = ok(await api('POST', '/roles', { name: 'Night Shift' }), 'role');
const u = ok(await api('POST', '/users', { username: 'night.user', full_name: 'Night User', email: 'night@example.com', password: 'NightUser123', confirm: 'NightUser123', role_id: nr.id }), 'user');
const selfDisable = await api('POST', `/users/${me.id}/disable`);
assert.equal(selfDisable.error, 'cannot_disable_self');

// --- badges and logs
const b = await api('GET', '/meta/badges');
assert.ok(b.ajeer.expired >= 1);
const logs = await api('GET', '/logs/audit');
assert.ok(logs.total > 10);
const la = await api('GET', '/logs/login');
assert.ok(la.stats.failed >= 2);

// --- ch5: expiry alerts and the renewal log
const al = ok(await api('GET', '/alerts?kind=operation_card'), 'alerts');
assert.equal(al.total, 1, 'one row per operation card');
assert.ok(al.rows[0].owner.includes('1234') && al.rows[0].owner.includes('5678'), 'the card row names all its plates');
const alAll = ok(await api('GET', '/alerts?status=expired'), 'alerts expired');
assert.ok(alAll.rows.every((x) => x.days_left < 0));
assert.equal(alAll.stats.documents, (await api('GET', '/alerts')).stats.documents, 'cards ignore the status filter');
assert.equal((await api('GET', '/alerts/export', undefined, true)).status, 200);
const scanFor = async () => { const f = new FormData(); f.append('file', new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }), 'scan.png'); return ok(await api('POST', '/scans', f), 'scan').token; };
const noScan = await api('POST', '/renewals', { kind: 'operation_card', doc_id: v2.card_id, new_expiry: '2027-10-20' });
assert.equal(noScan.fields?.scan, 'renewal_scan_required');
let scan = await scanFor();
const shorter = await api('POST', '/renewals', { kind: 'operation_card', doc_id: v2.card_id, new_expiry: '2026-01-01', scan });
assert.equal(shorter.fields?.new_expiry, 'renewal_shortens');
const rc = ok(await api('POST', '/renewals', { kind: 'operation_card', doc_id: v2.card_id, new_expiry: '2027-10-20', cost: 150, scan }), 'renew card');
const rcv = await api('GET', `/renewals/${rc.id}`);
assert.equal(rcv.new_doc_id, null, 'operation cards are renewed in place');
assert.equal((await api('GET', `/operation-cards/${v2.card_id}`)).expiry_date, '2027-10-20');
const health = (await api('GET', '/renewals/documents?kind=health'))._body[0];
scan = await scanFor();
const sameNo = await api('POST', '/renewals', { kind: 'health', doc_id: health.id, new_expiry: '2027-10-10', scan });
assert.equal(sameNo.fields?.new_number, 'renewal_number_needed', 'the old certificate keeps its number');
const rh = ok(await api('POST', '/renewals', { kind: 'health', doc_id: health.id, new_expiry: '2027-10-10', new_number: 'H-2', scan }), 'renew health');
const rhv = await api('GET', `/renewals/${rh.id}`);
assert.ok(rhv.new_doc_id && rhv.new_doc_id !== health.id, 'a new current record replaces the old one');
assert.equal((await api('GET', '/riders/4000001')).documents.health.doc_number, 'H-2');
const gone = await api('POST', '/renewals', { kind: 'health', doc_id: health.id, new_expiry: '2028-10-10', new_number: 'H-3', scan: await scanFor() });
assert.equal(gone.error, 'renewal_doc_gone', 'the archived record cannot be renewed again');
ok(await api('POST', '/renewals', { kind: 'health', doc_id: rhv.new_doc_id, new_expiry: '2028-10-10', new_number: 'H-3', scan: await scanFor() }), 'renew again');
assert.equal((await api('GET', `/renewals/${rh.id}`)).chain.length, 2, 'the document chain follows the replaced records');
const rl = ok(await api('GET', '/renewals?kind=health'), 'renewal log');
assert.equal(rl.total, 2);
assert.ok(rl.stats.total >= 4 && rl.stats.cost >= 150);
console.log('ch5 ok');

// --- the new role can open nothing
cookie = '';
ch = await api('GET', '/auth/challenge');
ok(await api('POST', '/auth/login', { username: 'night.user', password: 'NightUser123', challengeId: ch.id, code: ch.code }), 'login night');
const denied = await api('GET', '/riders');
assert.equal(denied._s, 403);
console.log('ALL SMOKE CHECKS PASSED');
