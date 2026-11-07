// Phase 4, servicing log, accident records and vehicle papers: the vehicle under maintenance while a service is in
// progress and back in service after the last one, completing, cancelling and paying a service, the rider taken
// from the current assignment, accident stages and their history, papers and the missing count, deletes refused
// for history, the audit trail, and that one company can never see or touch another company's records.
// Usage, from server/, against a disposable install on port 4100 whose platform owner is admin / Admin12345!:
//   node test/fleet-log.mjs http://localhost:4100
import assert from "node:assert/strict";

const base = process.argv[2] ?? "http://localhost:4100";
assert.match(base, /^http:\/\/(?:localhost|127\.0\.0\.1):(4100|4200|4300)$/, "Disposable test ports only");
const stamp = Date.now().toString(36);
let checks = 0;
const check = (cond, msg) => { assert.ok(cond, msg); checks++; };

function client() {
  let cookie = "";
  const api = async (method, path, body) => {
    const opts = { method, headers: { cookie, connection: "close" } };
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers["content-type"] = "application/json"; }
    const r = await fetch(base + "/api" + path, opts);
    const sc = r.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch { /* empty */ }
    return { s: r.status, j, text };
  };
  const login = async (username, password) => {
    const ch = (await api("GET", "/auth/challenge")).j;
    const r = await api("POST", "/auth/login", { username, password, challengeId: ch.id, code: ch.code });
    assert.equal(r.s, 200, `login ${username}: ${r.text}`);
  };
  return { api, login };
}
const must = (r, what) => { if (r.s >= 400) { console.error(what, r.s, r.text); process.exit(1); } return r.j; };
const signup = async (tag) => {
  const c = client(), email = `${tag}-${stamp}@example.com`;
  must(await c.api("POST", "/public/signup", { company_name: `${tag} ${stamp}`, full_name: "Owner", email, phone: "0500000000", password: "Passw0rd!x", confirm: "Passw0rd!x" }), "signup " + tag);
  await c.login(email, "Passw0rd!x");
  return c;
};
const a = await signup("fleet-a"), b = await signup("fleet-b");

// --- setup: two vehicles, a rider holding the first one
const rid = 8000000 + Math.floor(Math.random() * 900000);
must(await a.api("POST", "/riders", { id: rid, full_name: "Fleet Rider" }), "rider");
const v1 = must(await a.api("POST", "/vehicles", { plate: `ا ب ج ${stamp.slice(-4)}`, vehicle_type: "motorcycle" }), "vehicle 1").id;
const v2 = must(await a.api("POST", "/vehicles", { plate: `د ه و ${stamp.slice(-4)}`, vehicle_type: "motorcycle" }), "vehicle 2").id;
must(await a.api("POST", "/vehicle-assignments", { vehicle_id: v1, rider_id: rid, start_date: new Date().toISOString().slice(0, 10) }), "assign");
const vstatus = async (id) => must(await a.api("GET", `/vehicles/${id}`), "vehicle").status;

// --- servicing: scheduled → in progress (maintenance) → completed (back in service)
const s1 = must(await a.api("POST", "/vehicle-services", { vehicle_id: v1, service_type: "periodic", workshop: "Al Noor", scheduled_for: "2026-12-01" }), "service 1").id;
let s = must(await a.api("GET", `/vehicle-services/${s1}`), "get s1");
check(s.status === "scheduled" && s.rider_id === rid, "a new service is scheduled, with the rider holding the vehicle");
check(await vstatus(v1) === "active", "a scheduled service does not stop the vehicle");
let r = await a.api("POST", `/vehicle-services/${s1}/pay`, { amount: 10 });
check(r.s === 409 && r.j.error === "service_not_completed", "an unfinished service cannot be paid");
must(await a.api("POST", `/vehicle-services/${s1}/start`), "start");
check(await vstatus(v1) === "maintenance", "a service in progress puts the vehicle under maintenance");
r = await a.api("POST", `/vehicle-services/${s1}/start`);
check(r.s === 409 && r.j.error === "service_not_scheduled", "a started service cannot start again");
const s2 = must(await a.api("POST", "/vehicle-services", { vehicle_id: v1, service_type: "tires", start: true }), "service 2").id;
must(await a.api("POST", `/vehicle-services/${s1}/complete`, { cost: 450, odometer: 12000 }), "complete 1");
check(await vstatus(v1) === "maintenance", "the vehicle stays under maintenance while another service is in progress");
check(must(await a.api("GET", `/vehicles/${v1}`), "odo").odometer === 12000, "the odometer moves forward");
r = await a.api("POST", `/vehicle-services/${s2}/cancel`, {});
check(r.s === 422 && r.j.fields?.reason === "required", "cancelling needs a reason");
must(await a.api("POST", `/vehicle-services/${s2}/cancel`, { reason: "parts not available" }), "cancel 2");
check(await vstatus(v1) === "active", "the vehicle is back in service when its last service ends");
r = await a.api("POST", `/vehicle-services/${s2}/complete`, { cost: 10 });
check(r.s === 409 && r.j.error === "service_closed", "a cancelled service cannot be completed");

// --- payment
r = await a.api("POST", `/vehicle-services/${s1}/pay`, { amount: 500 });
check(r.s === 422 && r.j.fields?.amount === "more_than_cost", "paying more than the cost is refused");
must(await a.api("POST", `/vehicle-services/${s1}/pay`, { amount: 200, ref: "TR-1" }), "pay part");
let l = must(await a.api("GET", "/vehicle-services"), "list");
check(l.stats.total === 2 && l.stats.completed === 1 && l.stats.cancelled === 1 && Number(l.stats.cost) === 450 && Number(l.stats.unpaid) === 250, "the cards count statuses, cost and what is unpaid");
check(must(await a.api("GET", "/vehicle-services?unpaid=1"), "unpaid").total === 1, "the unpaid filter");
must(await a.api("POST", `/vehicle-services/${s1}/pay`, { amount: 450 }), "pay full");
check(must(await a.api("GET", "/vehicle-services?unpaid=1"), "unpaid").total === 0, "fully paid is no longer unpaid");
r = await a.api("PATCH", `/vehicle-services/${s1}`, { cost: 100 });
check(r.s === 409 && r.j.error === "cost_below_paid", "the cost cannot drop below what was paid");
r = await a.api("DELETE", `/vehicle-services/${s1}`);
check(r.s === 409 && r.j.error === "service_not_deletable", "a completed service stays in the log");
check((await a.api("DELETE", `/vehicle-services/${s2}`)).s === 200, "a cancelled one can be deleted");
check(must(await a.api("GET", `/vehicle-services?vehicle=${v2}`), "v2").total === 0, "the vehicle filter");

// --- accidents and their stages
let acc = await a.api("POST", "/vehicle-accidents", { vehicle_id: v1, occurred_at: "2026-11-01T14:30", severity: "moderate", authority: "najm", location: "King Fahd Rd", lat: 28.38, lng: 36.57 });
const a1 = must(acc, "accident").id;
let x = must(await a.api("GET", `/vehicle-accidents/${a1}`), "get accident");
check(x.stage === "report_pending" && x.rider_id === rid && x.occurred_at.startsWith("2026-11-01 14:30"), "a new accident waits for the report, with the rider and the time");
check(x.events.length === 1 && x.events[0].to_stage === "report_pending", "the first stage is in the history");
r = await a.api("POST", "/vehicle-accidents", { vehicle_id: v1, occurred_at: "yesterday", severity: "minor", authority: "najm" });
check(r.s === 422 && r.j.fields?.occurred_at === "invalid_date", "the date and time must be valid");
r = await a.api("POST", "/vehicle-accidents", { vehicle_id: v1, occurred_at: "2026-11-01 10:00", severity: "huge", authority: "najm" });
check(r.s === 422 && r.j.fields?.severity === "invalid", "the severity is one of three");
r = await a.api("PATCH", `/vehicle-accidents/${a1}`, { stage: "completed" });
check(r.s === 422 && r.j.error === "stage_by_action", "the stage changes only by moving it");
must(await a.api("POST", `/vehicle-accidents/${a1}/stage`, { to: "claim_pending" }), "forward two");
r = await a.api("POST", `/vehicle-accidents/${a1}/stage`, { to: "assessment_pending" });
check(r.s === 422 && r.j.fields?.note === "note_required_to_go_back", "going back needs a note");
must(await a.api("POST", `/vehicle-accidents/${a1}/stage`, { to: "assessment_pending", note: "Taqdeer asked again" }), "back with note");
must(await a.api("POST", `/vehicle-accidents/${a1}/stage`, { to: "completed" }), "complete");
x = must(await a.api("GET", `/vehicle-accidents/${a1}`), "get accident 2");
check(x.stage === "completed" && x.completed_at && x.events.length === 4 && x.events[1].note === "Taqdeer asked again", "every move is in the history, newest first");
r = await a.api("POST", `/vehicle-accidents/${a1}/stage`, { to: "completed" });
check(r.s === 409 && r.j.error === "same_stage", "moving to the same stage is refused");
// a repair linked to the accident
const s3 = must(await a.api("POST", "/vehicle-services", { vehicle_id: v1, service_type: "accident_repair", accident_id: a1 }), "repair").id;
r = await a.api("POST", "/vehicle-services", { vehicle_id: v2, service_type: "accident_repair", accident_id: a1 });
check(r.s === 422 && r.j.fields?.accident_id === "accident_other_vehicle", "a repair must be of the accident's vehicle");
check(must(await a.api("GET", `/vehicle-accidents/${a1}`), "acc").services.length === 1, "the accident lists its repairs");
r = await a.api("DELETE", `/vehicle-accidents/${a1}`);
check(r.s === 409 && r.j.error === "accident_in_use", "an accident with a repair cannot be deleted");
l = must(await a.api("GET", "/vehicle-accidents"), "acc list");
check(l.total === 1 && l.stats.completed === 1 && l.stats.report_pending === 0, "the accident cards count by stage");
check(must(await a.api("GET", "/vehicle-accidents?severity=severe"), "sev").total === 0, "the severity filter");

// --- papers of an accident: an attachment of type accident
const fd = new FormData();
fd.append("entity_type", "accident"); fd.append("entity_id", String(a1));
fd.append("file", new Blob(["%PDF-1.4\nNajm report"], { type: "application/pdf" }), "najm.pdf");
must(await a.api("POST", "/attachments", fd), "accident paper");
check(must(await a.api("GET", "/vehicle-accidents"), "acc list").rows[0].papers === 1, "an accident shows how many papers it has");

// --- vehicle papers: the missing count and the note
let p = must(await a.api("GET", "/vehicle-papers"), "papers");
let row1 = p.rows.find((x) => x.id === v1);
check(row1 && row1.missing === 4 && p.stats.total === 2 && p.stats.missing === 2, "a vehicle with no papers misses all four");
const photo = new FormData();
photo.append("entity_type", "vehicle"); photo.append("entity_id", String(v1)); photo.append("attachment_type", "photo");
photo.append("file", new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])], { type: "image/png" }), "car.png");
must(await a.api("POST", "/attachments", photo), "photo");
const fake = new FormData();
fake.append("entity_type", "vehicle"); fake.append("entity_id", String(v1)); fake.append("attachment_type", "key_handover");
fake.append("file", new Blob(["<html><script>alert(1)</script>"], { type: "application/pdf" }), "key.pdf");
r = await a.api("POST", "/attachments", fake);
check(r.s === 415, "a file that is not what it claims is refused");
must(await a.api("PATCH", `/vehicles/${v1}/papers-note`, { papers_note: "key with the supervisor" }), "note");
p = must(await a.api("GET", "/vehicle-papers"), "papers 2");
row1 = p.rows.find((x) => x.id === v1);
check(row1.missing === 3 && row1.photo_id && row1.papers_note === "key with the supervisor", "the photo counts and the note is kept");
check(p.rows[0].missing >= p.rows[p.rows.length - 1].missing, "the most missing comes first");
check(must(await a.api("GET", "/vehicle-papers?missing=1"), "papers missing").rows.length === 2, "the missing filter");

// --- the vehicle's profile, and deletes that would lose history
const log = must(await a.api("GET", `/vehicles/${v1}/fleet-log`), "fleet log");
check(log.services.length === 2 && log.accidents.length === 1, "the vehicle's profile lists its servicing and accidents");
r = await a.api("DELETE", `/vehicles/${v1}`);
check(r.s === 409 && r.j.params.blockers.some((x) => x.what === "services") && r.j.params.blockers.some((x) => x.what === "accidents"), "a vehicle with servicing or accidents cannot be deleted");
r = await a.api("DELETE", `/riders/${rid}`);
check(r.s === 409 && r.j.params.blockers.some((x) => x.what === "accidents"), "nor a rider with accidents");

// --- exports and the audit trail
check((await a.api("GET", "/vehicle-services/export?format=csv")).text.includes("Al Noor"), "the servicing export");
check((await a.api("GET", "/vehicle-accidents/export?format=csv")).text.includes("King Fahd Rd"), "the accident export");
const au = must(await a.api("GET", "/logs/audit?search=vehicle_&pageSize=100"), "audit").rows.map((x) => x.action);
for (const act of ["vehicle_service.create", "vehicle_service.start", "vehicle_service.complete", "vehicle_service.cancel", "vehicle_service.pay", "vehicle_accident.create", "vehicle_accident.stage"])
  check(au.includes(act), `audit has ${act}`);

// --- another company sees nothing and can use nothing
check(must(await b.api("GET", "/vehicle-services"), "b svc").total === 0, "another company's servicing list is empty");
check(must(await b.api("GET", "/vehicle-accidents"), "b acc").total === 0, "and its accident list");
check(must(await b.api("GET", "/vehicle-papers"), "b papers").rows.length === 0, "and its papers table");
for (const [m, path] of [["GET", `/vehicle-services/${s3}`], ["POST", `/vehicle-services/${s3}/start`], ["POST", `/vehicle-services/${s3}/cancel`], ["DELETE", `/vehicle-services/${s3}`],
  ["GET", `/vehicle-accidents/${a1}`], ["POST", `/vehicle-accidents/${a1}/stage`], ["DELETE", `/vehicle-accidents/${a1}`], ["PATCH", `/vehicles/${v1}/papers-note`]])
  check([404, 422].includes((await b.api(m, path, m === "GET" || m === "DELETE" ? undefined : { reason: "x", to: "completed", papers_note: "x" })).s), `another company cannot ${m} ${path}`);
r = await b.api("POST", "/vehicle-services", { vehicle_id: v1, service_type: "periodic" });
check(r.s === 422 && r.j.fields?.vehicle_id === "vehicle_not_found", "nor use another company's vehicle");
check(must(await a.api("GET", `/vehicle-services/${s3}`), "s3 intact").status === "scheduled", "and A's record is untouched");

console.log(`fleet-log.mjs: ${checks} checks passed`);
