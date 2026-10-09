// End-to-end check of the API against a FRESH install (it creates companies, riders, vehicles…).
// Usage: from server/, node test/smoke.mjs http://localhost:4200 — disposable fixtures only.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const base = process.argv[2] ?? 'http://localhost:4100';
assert.match(base, /^http:\/\/(?:localhost|127\.0\.0\.1):(4100|4200)$/, 'Disposable test ports only');
let cookie = '';
async function api(method, path, body, raw = false) {
  const opts = { method, headers: { cookie, connection: 'close' } };
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
ok(await api('PATCH', '/settings/organization', { name: 'مؤسسة مندوب', tax_number: '300123456700003' }), 'org');
const org = await api('GET', '/public/org');
assert.equal(org['org.name'], 'مؤسسة مندوب');

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

// --- ch3.1 leaves
const lv = ok(await api('POST', '/leaves', { rider_id: 4000001, start_date: '2026-11-01', end_date: '2026-11-03', leave_type: 'emergency', reason: 'ظرف عائلي' }), 'leave');
assert.equal(lv.letter_no, 'LV-2026-0001');
const lvOver = await api('POST', '/leaves', { rider_id: 4000001, start_date: '2026-11-03', end_date: '2026-11-04', leave_type: 'annual', reason: 'x' });
assert.equal(lvOver.fields?.start_date, 'leave_overlap'); assert.equal(lvOver.params?.letter, 'LV-2026-0001');
assert.equal((await api('POST', '/leaves', { rider_id: 4000001, start_date: '2026-12-05', end_date: '2026-12-01', leave_type: 'annual', reason: 'x' })).fields?.end_date, 'end_before_start');
ok(await api('POST', `/leaves/${lv.id}/answer`, { decision: 'approved', note: 'by email' }), 'approve leave');
assert.equal((await api('POST', `/leaves/${lv.id}/answer`, { decision: 'rejected' })).error, 'leave_already_answered');
ok(await api('PATCH', `/leaves/${lv.id}`, { start_date: '2026-11-20', reason: 'نص معدل' }), 'edit wording');
let lvr = await api('GET', `/leaves/${lv.id}`);
assert.equal(lvr.start_date, '2026-11-01', 'dates are locked after the answer'); assert.equal(lvr.reason, 'نص معدل'); assert.equal(lvr.days, 3);
assert.equal((await api('DELETE', `/leaves/${lv.id}`)).error, 'leave_answered_cancel_instead');
const letter = await api('GET', `/leaves/${lv.id}/letter`, undefined, true);
assert.ok((await letter.text()).includes('محمد أحمد'));
const doc = await api('GET', `/leaves/${lv.id}/letter?download=doc`, undefined, true);
assert.match(doc.headers.get('content-type'), /msword/);
ok(await api('POST', `/leaves/${lv.id}/cancel`, { note: 'withdrawn' }), 'cancel leave');
const lv2 = ok(await api('POST', '/leaves', { rider_id: 4000001, start_date: '2026-11-02', leave_type: 'sick', reason: 'مرض' }), 'leave after cancel');
assert.equal(lv2.letter_no, 'LV-2026-0002');
const lvl = await api('GET', '/leaves');
assert.equal(lvl.stats.awaiting, 1); assert.equal(lvl.total, 2);
assert.equal((await api('GET', '/leaves?from=2026-11-03&to=2026-11-30')).total, 1, 'a leave shows when its days overlap the period');

// --- ch3.2 absences import
const absCsv = 'Rider ID,Absence start,Absence end,Absence number,Reason,Paid,Internal note\n4000001,2026-11-02 00:00,2026-11-02 23:59,A1,VACATION,no,first\n99999999,2026-11-02,,A2,SICKNESS,yes,\n4000001,2026-11-05,,A1,OTHER,,\n';
let fa = new FormData(); fa.append('file', new Blob([absCsv], { type: 'text/csv' }), 'abs.csv'); fa.append('mode', 'replace');
let apv = ok(await api('POST', '/absences/import/preview', fa), 'abs preview');
assert.equal(apv.new, 1); assert.equal(apv.problems, 2, 'unknown rider and duplicate number');
ok(await api('POST', '/absences/import/run', { token: apv.token }), 'abs run');
let abl = await api('GET', '/absences');
assert.equal(abl.total, 1); assert.equal(abl.rows[0].letter_no, 'LV-2026-0002', 'matched with the overlapping leave'); assert.equal(abl.stats.unpaid, 1);
ok(await api('PATCH', `/absences/${abl.rows[0].id}/note`, { internal_note: 'office note' }), 'abs note');
fa = new FormData(); fa.append('file', new Blob(['Rider ID,Absence start,Absence end,Absence number,Reason\n4000001,2026-11-02 00:00,2026-11-02 23:59,A1,SICKNESS\n'], { type: 'text/csv' }), 'abs.csv'); fa.append('mode', 'replace');
apv = ok(await api('POST', '/absences/import/preview', fa), 'abs preview 2');
assert.equal(apv.replace, 1);
ok(await api('POST', '/absences/import/run', { token: apv.token }), 'abs run 2');
abl = await api('GET', '/absences');
assert.equal(abl.rows[0].reason, 'SICKNESS'); assert.equal(abl.rows[0].internal_note, 'office note', 'replacing keeps the office note');
assert.equal((await api('GET', '/absences/export', undefined, true)).status, 200);

// --- ch3.3 advances
const adv = ok(await api('POST', '/advances', { rider_id: 4000002, amount: 1000, installments: 3 }), 'advance');
assert.match(adv.number, /^ADV-\d{4}-0001$/);
assert.equal((await api('POST', '/advances', { rider_id: 4000002, amount: 50 })).fields?.rider_id, 'advance_open_exists');
assert.equal((await api('POST', '/advances', { rider_id: 4000001, amount: 999999 })).fields?.amount, 'advance_over_max');
assert.equal((await api('POST', `/advances/${adv.id}/disburse`, {})).error, 'advance_wrong_status', 'approval comes before payout');
ok(await api('POST', `/advances/${adv.id}/approve`), 'approve advance');
ok(await api('POST', `/advances/${adv.id}/disburse`, { method: 'bank', date: '2026-01-31' }), 'disburse');
let ad = await api('GET', `/advances/${adv.id}`);
assert.deepEqual(ad.installments_list.map((i) => [i.due_date, i.amount]), [['2026-02-28', 333.33], ['2026-03-31', 333.33], ['2026-04-30', 333.34]]);
const [i1, i2, i3] = ad.installments_list;
assert.equal((await api('POST', `/advance-installments/${i1.id}/repay`, { amount: 400 })).fields?.amount, 'repay_over_remaining');
ok(await api('POST', `/advance-installments/${i1.id}/repay`, { amount: 100 }), 'part repay');
assert.equal((await api('GET', `/advances/${adv.id}`)).status, 'repaying');
ok(await api('POST', `/advance-installments/${i1.id}/repay`, {}), 'repay rest');
ok(await api('POST', `/advance-installments/${i2.id}/waive`, { reason: 'goodwill' }), 'waive');
assert.equal((await api('POST', `/advance-installments/${i2.id}/repay`, {})).error, 'installment_closed');
const due = await api('GET', '/advances/due?window=365');
assert.equal(due.total, 1); assert.equal(due.stats.overdue, 1, 'overdue instalments always appear');
ok(await api('POST', `/advance-installments/${i3.id}/repay`, {}), 'repay last');
ad = await api('GET', `/advances/${adv.id}`);
assert.equal(ad.status, 'settled'); assert.equal(ad.outstanding, 0);
const advl = await api('GET', '/advances');
assert.equal(advl.stats.repaid, 666.67);
console.log('ch3.1-3.3 ok');

// --- ch3.5 conversations (the rider side is tested with the portal)
const fi = new FormData(); fi.append('rider_id', '4000001'); fi.append('subject', 'Wallet balance'); fi.append('category', 'payment'); fi.append('body', 'مرحباً، بخصوص المحفظة');
const iss = ok(await api('POST', '/issues', fi), 'issue');
const bad = new FormData(); bad.append('rider_id', '4000001'); bad.append('subject', 'ab');
assert.equal((await api('POST', '/issues', bad)).fields?.subject, 'too_short');
const fm = new FormData(); fm.append('body', 'internal only'); fm.append('internal', '1');
fm.append('files', new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), 'x.html');
ok(await api('POST', `/issues/${iss.id}/messages`, fm), 'internal note');
const fexe = new FormData(); fexe.append('files', new Blob(['MZ'], { type: 'application/octet-stream' }), 'run.exe');
assert.equal((await api('POST', `/issues/${iss.id}/messages`, fexe)).error, 'file_type_not_allowed');
let issv = await api('GET', `/issues/${iss.id}`);
assert.equal(issv.status, 'in_progress'); assert.equal(issv.list.length, 2); assert.equal(issv.list[1].internal, 1);
const html = await api('GET', `/attachments/${issv.list[1].files[0].id}/file`, undefined, true);
assert.match(html.headers.get('content-disposition'), /^attachment/, 'an HTML file never opens inline');
ok(await api('PATCH', `/issues/${iss.id}`, { status: 'resolved', priority: 'urgent' }), 'resolve');
assert.ok((await api('GET', `/issues/${iss.id}`)).resolved_at);
assert.equal((await api('GET', '/issues?status=resolved')).total, 1);
console.log('ch3.5 ok');

// --- ch8 finance imports and screens
const imp = async (path, csv, extra = {}) => {
  const f = new FormData(); f.append('file', new Blob([csv], { type: 'text/csv' }), 'f.csv'); f.append('mode', extra.mode ?? 'skip');
  if (extra.create) f.append('create_riders', '1');
  const pv = ok(await api('POST', `${path}/preview`, f), `${path} preview`);
  return { pv, run: pv.readable ? ok(await api('POST', `${path}/run`, { token: pv.token }), `${path} run`) : null };
};
let fx = await imp('/finance/fines/import', 'Rider ID,Date,Category,Amount,Invoice number,Status\n4000001,2026-09-03,Speeding,300,INV1,\n4000002,2026-09-10,No helmet,150,,dropped\n4000001,bad,X,1,,\n,2026-09-01,Y,1,,\n4000001,2026-09-03,Speeding,300,INV1,\n7777777,2026-09-04,Parking,100,,\n');
assert.equal(fx.pv.problems, 3, 'bad date, no rider id, duplicate in file');
assert.deepEqual(fx.pv.problemList.map((p) => p.reason), ['bad_date', 'no_rider_id', 'duplicate_in_file']);
assert.equal(fx.pv.extra.unknown_riders, 1);
assert.equal(fx.run.inserted, 2); assert.equal(fx.run.skipped, 1, 'the unknown rider is left out');
let fines = await api('GET', '/finance/fines');
assert.equal(fines.total, 2); assert.equal(fines.stats.total, 450); assert.equal(fines.stats.top.full_name, 'محمد أحمد');
const sp = fines.rows.find((x) => x.category === 'Speeding');
ok(await api('PATCH', `/finance/fines/${sp.id}`, { status: 'disputed', internal_note: 'appeal #12' }), 'fine status');
assert.equal((await api('PATCH', `/finance/fines/${sp.id}`, { amount: 150, category: 'ignored' })).error, undefined);
fx = await imp('/finance/fines/import', 'Rider ID,Date,Category,Amount,Invoice number\n4000001,2026-09-03,Speeding,150,INV1\n', { mode: 'replace' });
assert.equal(fx.run.replaced, 1);
fines = await api('GET', `/finance/fines?search=4000001`);
assert.equal(fines.rows[0].status, 'disputed', 'an import never resets the office status');
assert.equal((await api('GET', '/finance/fines?amount_min=200')).stats.total, 300, 'the cards ignore the amount fields');
const nb = (await api('GET', '/finance/fines?search=No%20helmet')).rows[0];
assert.equal((await api('PATCH', `/finance/fines/${nb.id}`, { amount: 150 })).error, undefined);
fx = await imp('/finance/wallet/import', 'Rider ID,Balance,Snapshot date\n4000001,-120.5,2026-10-01\n4000001,-80,2026-10-05\n4000002,40,2026-10-05\n');
assert.equal(fx.run.inserted, 3);
fx = await imp('/finance/wallet/import', 'Rider ID,Date,Amount,Description\n4000001,2026-10-02,-25,COD shortage\n4000001,2026-10-02,-25,COD shortage\n4000001,2026-10-03,15,Bonus\n');
assert.equal(fx.run.inserted, 2);
const bal = await api('GET', '/finance/wallet/balances');
assert.equal(bal.rows[0].balance, -80, 'the worst balance first, from the latest snapshot'); assert.equal(bal.stats.net, -40); assert.equal(bal.stats.owed, -80);
assert.equal((await api('GET', '/finance/wallet/history/4000001'))._body.length, 2);
fx = await imp('/finance/billing/import', 'Rider ID,Month,Contract,Completed orders,Basic payment,Total deductions,Amount incl VAT,Net FTR,Fine late\n4000001,2026-09,Riyadh 3PL,320,4100,250,4200,40,-30\n4000002,09-2026,,100,1200,0,1300,,\n4000003,2026-13,,1,1,1,1,1,1\n');
assert.equal(fx.pv.problemList[0].reason, 'bad_month'); assert.equal(fx.run.inserted, 2);
const bill = await api('GET', '/finance/billing?month=2026-09');
assert.equal(bill.stats.riders, 2); assert.equal(bill.totals.amount_incl_vat, 5500); assert.equal(bill.rows[0].full_name, 'محمد أحمد', 'largest amount first');
const fsum = await api('GET', '/finance/rider/4000001');
assert.equal(fsum.wallet.balance, -80); assert.equal(fsum.fines.n, 1); assert.equal(fsum.billing.month, '2026-09');
assert.equal((await api('GET', '/finance/billing/export?month=2026-09', undefined, true)).status, 200);
console.log('ch8 ok');

// --- ch9 dashboard, reports, notifications
const dash = ok(await api('GET', '/dashboard'), 'dashboard');
assert.ok(dash.alerts.expired >= 1); assert.equal(dash.figures.vehicles.total, 3); assert.ok(dash.charts.doc_kinds.length > 3);
assert.ok(Array.isArray(dash.charts.deliveries), 'every part loads on its own');
assert.ok(dash.events.length > 0);
const rv = ok(await api('GET', '/reports/riders?search=4000001'), 'report');
assert.equal(rv.total, 1, 'digits match the rider number');
assert.equal((await api('GET', '/reports/documents?validity=expired')).stats['alerts.s.expired'] > 0, true);
assert.equal((await api('GET', '/reports/advances/export', undefined, true)).status, 200);
assert.equal((await api('GET', '/reports/nope'))._s, 404);
const gen1 = ok(await api('POST', '/notifications/generate'), 'generate');
assert.ok(gen1.created > 0);
assert.equal((await api('POST', '/notifications/generate')).created, 0, 'not repeated on the same day');
const mine = await api('GET', '/notifications/mine');
assert.ok(mine.unread > 0); assert.equal(mine.top, 'critical');
const nlog = await api('GET', '/notifications?kind=rider');
assert.ok(nlog.total > 0, 'riders get their own documents');
ok(await api('POST', `/notifications/${mine.rows[0].id}/read`), 'mark read');
ok(await api('PUT', '/notifications/preferences/oil_change', { in_app: false }), 'mute oil');
const prefs = await api('GET', '/notifications/preferences');
assert.equal(prefs._body.find((p) => p.category === 'oil_change').customised, true);
console.log('ch9 ok');

// --- ch6 performance, scorecard, ratings, branding, sync and the live board
const pr = ok(await api('POST', '/performance', { rider_id: 4000001, work_date: '2026-09-01', completed: 18, notified: 20, planned_hours: 10, actual_hours: 9.5, attendance_rate: 95, acceptance_rate: 0.97, lost_hours: 0.5 }), 'perf');
assert.equal((await api('GET', `/performance/${pr.id}`)).attendance_rate, 0.95, 'rates are kept as a fraction');
assert.equal((await api('POST', '/performance', { rider_id: 4000001, work_date: '2026-09-01' })).fields?.work_date, 'perf_day_taken');
let pf = new FormData(); pf.append('file', new Blob(['Rider Id,Completed Orders,Attendance Rate,Acceptance Rate,Lost Hours,No Shows,Contract Name\n4000001,8,0.6,0.9,0,0,Riyadh 3PL\n4000002,16,0.99,0.99,0,0,Night Contract\n5550001,3,,,,,\n'], { type: 'text/csv' }), 'p.csv');
pf.append('mode', 'skip'); pf.append('day', '2026-09-02'); pf.append('create_contracts', '1'); pf.append('company_id', String(co.id));
const ppv = ok(await api('POST', '/performance-import/preview', pf), 'perf preview');
assert.equal(ppv.extra.unknown_riders, 1); assert.equal(ppv.extra.new_rows, 3);
const prun = ok(await api('POST', '/performance-import/run', { token: ppv.token }), 'perf run');
assert.equal(prun.inserted, 2); assert.equal(prun.contracts_created, 1);
assert.equal((await api('GET', '/performance?from=2026-09-01&to=2026-09-02')).stats.records, 3);
const sc = ok(await api('GET', '/performance-scorecard?from=2026-09-01&to=2026-09-02'), 'scorecard');
const mo = sc.rows.find((r) => r.id === 4000001);
// 13 orders a day → 1 point, attendance 77.5% → 0, acceptance 93.5% → 1: two points is weak
assert.equal(mo.grade, 'weak'); assert.equal(mo.points, 2); assert.ok(mo.reasons.includes('low_attendance'));
assert.ok(['negligent', 'weak', 'fair', 'strong'].includes(sc.rows[0].grade));
assert.equal((await api('GET', '/performance-scorecard/4000002?from=2026-09-02&to=2026-09-02')).score.grade, 'strong');
let rf = new FormData(); rf.append('file', new Blob(['rider_id,Month,Segment,Gross orders,Completed,Completed in time,Failed by rider\n4000001,2026-09,B,204,200,196,2\n4000002,2026-9,A,100,100,100,0\nx,2026-09,,,,,\n'], { type: 'text/csv' }), 'r.csv');
const rpv = ok(await api('POST', '/ratings/import/preview', rf), 'ratings preview');
ok(await api('POST', '/ratings/import/run', { token: rpv.token }), 'ratings run');
const rtl = ok(await api('GET', '/ratings?month=2026-09'), 'ratings');
const m1 = rtl.rows.find((r) => r.rider_id === 4000001);
assert.equal(m1.on_time, 0.98); assert.equal(m1.fail_rate_score, 0.9902); assert.equal(m1.final_score, 0.9851, 'the worked example of the guide');
assert.equal(rtl.ladder.find((l) => l.segment === 'B').n, 1);
let bf = new FormData(); bf.append('file', new Blob(['Rider Id,Created At,Photo\n4000001,2026-09-02 08:10:00,https://example.com/a.jpg\n4000002,2026-09-02 08:12:00,https://example.com/b.jpg\n'], { type: 'text/csv' }), 'b.csv'); bf.append('mode', 'skip');
const bpv = ok(await api('POST', '/branding-import/preview', bf), 'brand preview');
ok(await api('POST', '/branding-import/run', { token: bpv.token }), 'brand run');
let bl = await api('GET', '/branding');
assert.equal(bl.stats.photos, 2); assert.equal(bl.stats.queue, 2); assert.equal(bl.tools.face, 'unavailable');
ok(await api('PATCH', `/branding/${bl.rows[0].id}`, { card_review: 'not_visible', card_note: 'no vest' }), 'card review');
ok(await api('POST', '/branding/mark-fine', { ids: bl.rows.map((r) => r.id) }), 'mark rest fine');
bl = await api('GET', '/branding');
assert.deepEqual(bl.rows.map((r) => r.card_review).sort(), ['not_visible', 'visible'], 'a judged photo does not change');
assert.equal((await api('GET', '/sync/extension.zip', undefined, true)).headers.get('content-type'), 'application/zip');
const tok = ok(await api('POST', '/sync/token'), 'token').token;
const ingest = (body, t = tok) => fetch(base + '/api/sync/ingest', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` }, body: JSON.stringify(body) }).then(async (r) => ({ s: r.status, ...(await r.json()) }));
assert.equal((await ingest({ source: 'daily_performance', day: '2026-09-03', rows: [{ 'Rider Id': '4000002', 'Completed Orders': '12' }] }, 'wrong')).error, 'token_refused');
assert.equal((await ingest({ source: 'daily_performance', day: '2099-01-01', rows: [{ 'Rider Id': '1' }] })).error, 'report_shows_today');
const ig = await ingest({ source: 'daily_performance', day: '2026-09-03', rows: [{ 'Rider Id': '4000002', 'Completed Orders': '12', 'Attendance Rate': '97%' }] });
assert.equal(ig.inserted, 1);
const runs = await api('GET', '/sync/runs?source=daily_performance');
assert.equal(runs.rows[0].status, 'succeeded'); assert.equal(runs.rows[0].trigger_type, 'extension');
const sy = await api('GET', '/sync');
assert.equal(sy.session.state, 'extension');
const sr = ok(await api('POST', '/sync/run', {}), 'sync now');
assert.equal(sr.runs[0].status, 'needs_sign_in', 'no browser on the server');
assert.equal((await ingest({ source: 'live', rows: [{ 'Rider Id': '4000001', Name: 'M', Status: 'Working', Lat: '24.7136', Lng: '46.6753', Completed: '4', 'Active Orders': '0', Wallet: '600' }] })).read, 1);
const lb = ok(await api('GET', '/live'), 'live');
assert.equal(lb.stats.board, 1); assert.equal(lb.stats.wallet, 1, 'wallet over the limit');
assert.equal((await api('GET', '/live/riders/4000001')).points, 1);
console.log('ch6 ok');

// --- ch11 email, errors, jobs, backups, languages
const tpls = ok(await api('GET', '/email/templates'), 'templates')._body;
assert.ok(tpls.length >= 15, 'the ready-made templates are seeded');
ok(await api('PATCH', '/email/templates/expiry.license', { subject: 'تنبيه {doc_number} {typo_here}' }), 'edit template');
const tv = await api('GET', '/email/templates/expiry.license');
assert.deepEqual(tv.check.undeclared, ['typo_here'], 'a misspelt placeholder is flagged');
assert.equal((await api('POST', '/email/templates/system.smtp_test/deactivate')).error, 'template_required');
const pvw = ok(await api('POST', '/email/templates/expiry.license/preview', { vars: { doc_number: 'L-9' } }), 'preview');
assert.ok(pvw.html.includes('<html') && pvw.subject.includes('L-9'));
assert.equal((await api('POST', '/email/smtp/system/test', { to: 'ops@example.com' })).error, 'email_send_failed', 'no SMTP yet');
ok(await api('PUT', '/email/smtp/system', { host: 'smtp.example.com', port: 587, username: 'ops@example.com', password: 's3cret', sender_email: 'ops@example.com', enabled: true }), 'smtp');
assert.equal((await api('GET', '/email/smtp')).system.has_password, true);
ok(await api('PATCH', '/settings/system', { values: { 'email.dry_run': '1' } }), 'dry run');
ok(await api('POST', '/email/smtp/system/test', { to: 'ops@example.com' }), 'test in dry run');
const elog = await api('GET', '/email/log');
assert.equal(elog.rows[0].status, 'sent'); assert.equal(elog.rows[1].status, 'failed');
ok(await api('POST', `/email/log/${elog.rows[1].id}/retry`), 'retry');
assert.equal((await api('GET', '/email/log')).rows.find((r) => r.id === elog.rows[1].id).status, 'sent');
const jobs = ok(await api('GET', '/cron-jobs'), 'jobs')._body;
assert.equal(jobs.length, 7); assert.ok(jobs.find((j) => j.name === 'document_expiry').next);
assert.equal((await api('POST', '/cron-jobs/log_cleanup/run')).outcome, 'completed');
assert.equal((await api('GET', '/cron-jobs/runs?job=log_cleanup')).total, 1);
const bk = ok(await api('POST', '/backups', { type: 'full', note: 'smoke' }), 'backup');
assert.equal((await api('POST', `/backups/${bk.id}/verify`)).ok, true);
assert.ok((await api('GET', `/backups/${bk.id}/contents`)).manifest.rows > 0);
const ridersBefore = (await api('GET', '/riders')).total;
await api('POST', '/companies', { name: 'Made after the backup' });
assert.equal((await api('POST', `/backups/${bk.id}/restore`, { confirm: 'restore' })).error, 'restore_confirm');
const rs = ok(await api('POST', `/backups/${bk.id}/restore`, { confirm: 'RESTORE' }), 'restore');
assert.ok(rs.safety > bk.id && rs.tables > 20, 'a safety backup is taken first');
if (!rs.session_kept) { cookie = ''; const c2 = await api('GET', '/auth/challenge'); ok(await api('POST', '/auth/login', { username: 'admin', password: 'Admin12345!', challengeId: c2.id, code: c2.code }), 're-login'); }
assert.equal((await api('GET', '/riders')).total, ridersBefore);
assert.equal((await api('GET', '/companies?search=Made%20after')).total, 0, 'the restore brought the data back');
const langs = ok(await api('GET', '/languages'), 'languages');
assert.ok(langs.languages.find((l) => l.code === 'bn').completeness < 100);
assert.equal((await api('PUT', '/languages/bn/keys/alerts.within', { value: 'mismatch' })).fields?.value, 'translation_placeholder_mismatch');
ok(await api('PUT', '/languages/bn/keys/alerts.within', { value: '{n} দিনের মধ্যে' }), 'override');
ok(await api('POST', '/languages', { code: 'fr', dir: 'ltr', name_native: 'Français', name_en: 'French' }), 'new language');
ok(await api('POST', '/languages/rebuild'), 'rebuild');
const pub = await api('GET', '/public/i18n');
assert.equal(pub.overrides.bn['alerts.within'], '{n} দিনের মধ্যে'); assert.ok(pub.languages.some((l) => l.code === 'fr'));
ok(await api('DELETE', '/languages/fr'), 'delete language');
console.log('ch11 ok');

// --- ch12 rider portal: its own sessions, the rider side of requests, leaves and conversations
let rcookie = '';
async function rapi(method, path, body) {
  const opts = { method, headers: { cookie: rcookie, connection: 'close' } };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['content-type'] = 'application/json'; }
  const r = await fetch(base + '/api' + path, opts);
  const sc = r.headers.get('set-cookie');
  if (sc) rcookie = sc.split(';')[0];
  const j = await r.json().catch(() => ({}));
  return { ...j, _s: r.status, _body: j };
}
const lastCode = async () => (await api('GET', '/email/log')).rows[0].subject.match(/(\d{6})/)[1];
const png = () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
const dayPlus = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
assert.equal((await api('GET', '/portal/me')).error, 'rider_session_ended', 'a staff session is not a rider session');
assert.equal((await rapi('POST', '/portal/login', { rider_id: '9999999' })).error, 'portal_bad_credentials');
assert.equal((await rapi('POST', '/portal/login', { rider_id: '4000001' })).error, 'portal_disabled', 'a suspended rider cannot sign in');
ok(await api('POST', '/riders/bulk-edit', { ids: [4000001], changes: { status: 'active' } }), 'reactivate');
assert.equal((await rapi('POST','/portal/login',{rider_id:'4000001'})).error,'portal_password_not_ready');
ok(await api('POST','/riders/4000001/portal/reset-password',{password:'InitialPass2026',confirm:'InitialPass2026'}),'provision');
assert.equal(ok(await rapi('POST', '/portal/login', { rider_id: '4000001', password:'InitialPass2026' }), 'portal login').first, false);
const pme = ok(await rapi('GET', '/portal/me'), 'portal me');
assert.equal(pme.id, 4000001); assert.equal(pme.has_password, true);
const pov = ok(await rapi('GET', '/portal/overview'), 'overview');
assert.equal(pov.completion.items.length, 7); assert.equal(pov.completion.items.find((i) => i.key === 'ajeer').status, 'expired');
const ppf = ok(await rapi('GET', '/portal/profile'), 'profile');
assert.equal(ppf.national_id, '••••••9012', 'the ID number is masked');
const pperf = ok(await rapi('GET', '/portal/performance?from=2026-09-01&to=2026-09-30'), 'performance');
assert.ok(pperf.total.completed >= 18); assert.equal(pperf.absence.days.find((d) => d.day === '2026-09-01').status, 'present');
assert.equal((await rapi('GET', '/portal/performance?from=2026-09-30&to=2026-09-01')).fields?.from, 'start_after_end');
assert.match(await (await fetch(base + '/api/portal/performance/export?from=2026-09-01&to=2026-09-30', { headers: { cookie: rcookie, connection: 'close' } })).text(), /2026-09-01/);
ok(await rapi('GET', '/portal/ratings'), 'ratings'); ok(await rapi('GET', '/portal/attendance'), 'attendance');
// update requests
assert.equal((await rapi('POST', '/portal/requests', { type: 'contact', phone: '0551234567' })).fields?.phone, 'same_as_current');
assert.equal((await rapi('POST', '/portal/requests', { type: 'contact', phone: '12' })).fields?.phone, 'portal_phone_rules');
const pcr = ok(await rapi('POST', '/portal/requests', { type: 'contact', phone: '+966559876543' }), 'contact request');
assert.equal((await rapi('POST', '/portal/requests', { type: 'contact', email: 'm@example.com' })).error, 'request_pending_exists');
const nofile = new FormData(); nofile.append('type', 'document'); nofile.append('doc_type', 'license');
assert.equal((await rapi('POST', '/portal/requests', nofile)).fields?.files, 'file_required');
const docReq = (t) => { const f = new FormData(); f.append('type', 'document'); f.append('doc_type', t); f.append('expiry_date', '2028-01-01'); f.append('files', png(), 'front.png'); f.append('files', png(), 'back.png'); return f; };
const pdr = ok(await rapi('POST', '/portal/requests', docReq('license')), 'document request');
const phr = ok(await rapi('POST', '/portal/requests', docReq('health')), 'another document type is its own request');
ok(await rapi('POST', `/portal/requests/${phr.id}/cancel`), 'cancel request');
const preqs = ok(await rapi('GET', '/portal/requests'), 'requests');
assert.equal(preqs.pending, 2); assert.deepEqual(preqs.rows.find((r) => r.id === pdr.id).files.map((f) => f.attachment_type), ['front', 'back']);
assert.equal((await rapi('GET', `/portal/files/${preqs.rows.find((r) => r.id === pdr.id).files[0].id}`))._s, 200);
assert.equal((await rapi('GET', `/portal/files/${issv.list[1].files[0].id}`))._s, 404, 'a file on an internal note is never the rider\'s');
ok(await api('POST', `/change-requests/${pcr.id}/approve`), 'office approves');
assert.equal((await api('GET', '/riders/4000001')).phone, '+966559876543');
// leaves
assert.equal((await rapi('POST', '/portal/leaves', { leave_type: 'annual', start_date: dayPlus(-2), reason: 'x' })).fields?.start_date, 'leave_in_past');
assert.equal((await rapi('POST', '/portal/leaves', { leave_type: 'annual', start_date: dayPlus(5), end_date: dayPlus(40), reason: 'x' })).fields?.end_date, 'leave_too_long');
assert.equal((await rapi('POST', '/portal/leaves', { leave_type: 'annual', start_date: dayPlus(120), reason: 'x' })).fields?.start_date, 'leave_too_far');
const plv = ok(await rapi('POST', '/portal/leaves', { leave_type: 'emergency', start_date: dayPlus(60), end_date: dayPlus(62), reason: 'ظرف عائلي' }), 'portal leave');
assert.equal((await rapi('POST', '/portal/leaves', { leave_type: 'annual', start_date: dayPlus(62), reason: 'x' })).fields?.start_date, 'leave_overlap_mine');
assert.equal((await api('GET', `/leaves/${plv.id}`)).source, 'rider');
ok(await rapi('POST', `/portal/leaves/${plv.id}/cancel`), 'cancel leave');
assert.equal((await rapi('POST', `/portal/leaves/${plv.id}/cancel`)).error, 'leave_cancel_pending_only');
// conversations
const pis0 = new FormData(); pis0.append('category', 'app'); pis0.append('subject', 'App freezes'); pis0.append('body', 'short');
assert.equal((await rapi('POST', '/portal/issues', pis0)).fields?.body, 'too_short');
const pis1 = new FormData(); pis1.append('category', 'app'); pis1.append('subject', 'App freezes'); pis1.append('body', 'The app freezes when I start a shift.'); pis1.append('priority', 'urgent');
assert.equal((await rapi('POST', '/portal/issues', pis1)).fields?.priority, 'invalid', 'urgent is for the office only');
pis1.set('priority', 'high');
const pis = ok(await rapi('POST', '/portal/issues', pis1), 'portal issue');
assert.equal((await api('GET', `/issues/${pis.id}`)).opened_by, 'rider');
const sr1 = new FormData(); sr1.append('body', 'Please update the app.');
ok(await api('POST', `/issues/${pis.id}/messages`, sr1), 'office reply');
assert.equal((await rapi('GET', '/portal/me')).unread_issues, 2, 'the reply and the office-opened conversation');
const pconv = ok(await rapi('GET', `/portal/issues/${pis.id}`), 'conversation');
assert.equal(pconv.status, 'in_progress'); assert.equal(pconv.list.length, 2); assert.equal(pconv.list[1].user_name, undefined, 'the employee name stays hidden');
ok(await rapi('POST', `/portal/issues/${pis.id}/read`), 'read');
assert.equal((await rapi('GET', '/portal/me')).unread_issues, 1);
assert.ok((await rapi('GET', `/portal/issues/${iss.id}`)).list.every((m) => !m.internal), 'internal notes stay with the office');
const rr = new FormData(); rr.append('body', 'Still a problem');
ok(await rapi('POST', `/portal/issues/${iss.id}/messages`, rr), 'reply to a resolved conversation');
assert.equal((await api('GET', `/issues/${iss.id}`)).status, 'open', 'the reply reopens it');
assert.equal((await rapi('GET', '/portal/issues?status=open')).rows.length, 2);
// security: verify the email, then the password
assert.equal((await rapi('POST', '/portal/security/password', { current:'InitialPass2026', password: 'Rider2026x', confirm: 'Rider2026x' })).error, 'verify_email_first');
ok(await rapi('POST', '/portal/security/email', { email: 'Rider@Example.com' }), 'send code');
const vcode = await lastCode();
assert.equal((await rapi('POST', '/portal/security/email', { email: 'rider@example.com' })).error, 'code_wait');
assert.equal((await rapi('POST', '/portal/security/email/verify', { code: vcode === '000000' ? '111111' : '000000' })).fields?.code, 'code_wrong');
assert.equal(ok(await rapi('POST', '/portal/security/email/verify', { code: vcode }), 'verify').email, 'rider@example.com');
assert.equal((await rapi('POST', '/portal/security/password', { current:'InitialPass2026', password: 'onlyletters', confirm: 'onlyletters' })).fields?.password, 'portal_password_rules');
ok(await rapi('POST', '/portal/security/password', { current:'InitialPass2026', password: 'Rider2026x', confirm: 'Rider2026x' }), 'set password');
const keep = rcookie;
assert.equal((await rapi('POST', '/portal/login', { rider_id: '4000001' })).step, 'password');
assert.equal((await rapi('POST', '/portal/login', { rider_id: '4000001', password: 'wrong-pass1' })).error, 'portal_bad_credentials');
assert.equal(ok(await rapi('POST', '/portal/login', { rider_id: '4000001', password: 'Rider2026x' }), 'login with password').first, false);
// forgot password: the code goes to the verified email, and the reset ends every session
ok(await rapi('POST', '/portal/forgot', { rider_id: '4000001' }), 'forgot');
ok(await rapi('POST', '/portal/reset', { rider_id: '4000001', code: await lastCode(), password: 'NewPass2026', confirm: 'NewPass2026' }), 'reset');
assert.equal((await rapi('GET', '/portal/me')).error, 'rider_session_ended');
rcookie = keep; assert.equal((await rapi('GET', '/portal/me'))._s, 401, 'every device is signed out');
// the office's portal account card
const pac = ok(await api('GET', '/riders/4000001/portal'), 'portal card');
assert.equal(pac.has_password, true); assert.equal(pac.attempts.length, 5);
ok(await rapi('POST', '/portal/login', { rider_id: '4000001', password: 'NewPass2026' }), 'login new password');
assert.equal(ok(await api('POST', '/riders/4000001/portal/disable'), 'disable').ended, 1);
assert.equal((await rapi('POST', '/portal/login', { rider_id: '4000001', password: 'NewPass2026' })).error, 'portal_disabled');
ok(await api('POST', '/riders/4000001/portal/enable'), 'enable');
ok(await api('POST', '/riders/4000001/portal/reset-password',{password:'OfficePass2026',confirm:'OfficePass2026'}), 'office reset');
assert.equal((await rapi('POST', '/portal/login', { rider_id: '4000001' })).step, 'password');
assert.equal(ok(await rapi('POST', '/portal/login', { rider_id: '4000001',password:'OfficePass2026' }), 'office password').first, false);
assert.ok((await rapi('GET', '/portal/security')).verified_email, 'the reset keeps the verified email');
execFileSync(process.execPath, [fileURLToPath(new URL('./security.mjs', import.meta.url)), base], { stdio: 'inherit' });
// 10 failures from one network block the sign-in for a while
let blocked = false;
for (let i = 0; i < 12 && !blocked; i++) blocked = (await rapi('POST', '/portal/login', { rider_id: '1' })).error === 'portal_too_many';
assert.ok(blocked);
console.log('ch12 ok');

// --- the new role can open nothing
cookie = '';
ch = await api('GET', '/auth/challenge');
ok(await api('POST', '/auth/login', { username: 'night.user', password: 'NightUser123', challengeId: ch.id, code: ch.code }), 'login night');
const denied = await api('GET', '/riders');
assert.equal(denied._s, 403);
console.log('ALL SMOKE CHECKS PASSED');
