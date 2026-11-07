// Phase 5, employee files: visa, sponsor and passport on the rider, bank accounts (IBAN check, one main account),
// the new hiring stages, the exit date set when a rider is terminated and the exit record, the exited list with the
// advances still owed, the rider papers table with its missing count, and isolation between companies.
// Usage, from server/, against a disposable install on port 4100 whose platform owner is admin / Admin12345!:
//   node test/employees.mjs http://localhost:4100
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
const a = await signup("emp-a"), b = await signup("emp-b");
const rid = 6000000 + Math.floor(Math.random() * 900000);
const today = new Date().toISOString().slice(0, 10);

// --- visa, sponsor and passport on the rider
must(await a.api("POST", "/riders", { id: rid, full_name: "Visa Rider", hire_date: "2026-01-10", visa_number: "V-778", visa_type: "work", visa_expiry: "2027-03-01", sponsor_name: "Himmat Co", sponsor_number: "700123", passport_number: "BX12345", passport_expiry: "2030-01-01" }), "rider");
let r = must(await a.api("GET", `/riders/${rid}`), "get rider");
check(r.visa_number === "V-778" && r.sponsor_name === "Himmat Co" && r.passport_number === "BX12345" && String(r.visa_expiry).startsWith("2027-03-01"), "the rider keeps visa, sponsor and passport");
let x = await a.api("PATCH", `/riders/${rid}`, { visa_expiry: "not a date" });
check(x.s === 422 && x.j.fields?.visa_expiry === "invalid_date", "dates are checked");

// --- bank accounts
const IBAN = "SA0380000000608010167519";
x = await a.api("POST", `/riders/${rid}/bank-accounts`, { bank_name: "Al Rajhi", iban: "SA0380000000608010167518" });
check(x.s === 422 && x.j.fields?.iban === "iban_invalid", "a wrong IBAN is refused");
const b1 = must(await a.api("POST", `/riders/${rid}/bank-accounts`, { bank_name: "Al Rajhi", iban: "sa03 8000 0000 6080 1016 7519" }), "bank 1").id;
let banks = must(await a.api("GET", `/riders/${rid}/bank-accounts`), "banks");
check(banks.length === 1 && banks[0].iban === IBAN && banks[0].is_primary === 1, "the first account is the main one, IBAN without spaces");
x = await a.api("POST", `/riders/${rid}/bank-accounts`, { bank_name: "Again", iban: IBAN });
check(x.s === 422 && x.j.fields?.iban === "iban_taken", "the same IBAN twice is refused");
const b2 = must(await a.api("POST", `/riders/${rid}/bank-accounts`, { bank_name: "SNB", iban: "GB82WEST12345698765432", is_primary: true }), "bank 2").id;
banks = must(await a.api("GET", `/riders/${rid}/bank-accounts`), "banks 2");
check(banks.length === 2 && banks.filter((x) => x.is_primary).length === 1 && banks[0].id === b2, "a new main account takes over; one main only");
must(await a.api("DELETE", `/rider-bank-accounts/${b2}`), "delete main");
banks = must(await a.api("GET", `/riders/${rid}/bank-accounts`), "banks 3");
check(banks.length === 1 && banks[0].id === b1 && banks[0].is_primary === 1, "when the main one goes, the other becomes main");

// --- hiring stages
const ap = must(await a.api("POST", "/applicants", { full_name: "New Hire", phone: `05${String(Date.now()).slice(-8)}` }), "applicant").id;
for (const st of ["contacted", "interview", "documents", "approved"]) must(await a.api("PATCH", `/applicants/${ap}`, { status: st }), `stage ${st}`);
const al = must(await a.api("GET", "/applicants"), "applicants");
check(al.stats.approved === 1 && "contacted" in al.stats && "interview" in al.stats && "documents" in al.stats, "the applicant list counts the new stages");
must(await a.api("PATCH", `/applicants/${ap}`, { status: "interview" }), "back to interview");
check(must(await a.api("GET", "/applicants?status=interview"), "f").total === 1 && must(await a.api("GET", "/applicants"), "s").stats.open === 1, "an applicant at interview is open and filterable");

// --- exit: terminated gets an exit date, the record is kept
x = await a.api("PATCH", `/riders/${rid}/exit`, { exit_reason: "x" });
check(x.s === 409 && x.j.error === "rider_not_exited", "a working rider has no exit record");
must(await a.api("PATCH", `/riders/${rid}`, { status: "terminated" }), "terminate");
r = must(await a.api("GET", `/riders/${rid}`), "after terminate");
check(String(r.exit_date).slice(0, 10) === today, "a terminated rider gets today as exit date");
x = await a.api("PATCH", `/riders/${rid}/exit`, { exit_date: "2025-12-31" });
check(x.s === 422 && x.j.error === "exit_before_hire", "the exit cannot be before the hire date");
x = await a.api("PATCH", `/riders/${rid}/exit`, { exit_date: "2099-01-01" });
check(x.s === 422 && x.j.error === "date_in_future", "nor in the future");
x = await a.api("PATCH", `/riders/${rid}/exit`, { exit_clearance: "maybe" });
check(x.s === 422 && x.j.fields?.exit_clearance === "invalid", "the dues state is one of three");
must(await a.api("PATCH", `/riders/${rid}/exit`, { exit_date: "2026-10-30", exit_reason: "Accidents", exit_clearance: "in_debt", exit_note: "owes 15,000" }), "exit record");
let ex = must(await a.api("GET", "/riders-exited"), "exited");
check(ex.total === 1 && ex.rows[0].id === rid && ex.rows[0].exit_clearance === "in_debt" && ex.rows[0].exit_note === "owes 15,000", "the exited list shows the record");
check(ex.stats.in_debt === 1 && ex.stats.total === 1, "and counts it by dues state");
check(must(await a.api("GET", "/riders-exited?clearance=clear"), "c").total === 0 && must(await a.api("GET", "/riders-exited?clearance=in_debt"), "d").total === 1, "the dues filter");
// bulk terminate stamps the exit date too
const rid2 = rid + 1;
must(await a.api("POST", "/riders", { id: rid2, full_name: "Bulk Rider" }), "rider 2");
must(await a.api("POST", "/riders/bulk-edit", { ids: [rid2], changes: { status: "terminated" } }), "bulk terminate");
check(String(must(await a.api("GET", `/riders/${rid2}`), "r2").exit_date).slice(0, 10) === today, "bulk termination sets the exit date");
check((await a.api("GET", "/riders-exited/export?format=csv")).text.includes("owes 15,000"), "the exited export");

// --- rider papers
const rid3 = rid + 2;
must(await a.api("POST", "/riders", { id: rid3, full_name: "Papers Rider", passport_number: "P1" }), "rider 3");
let pp = must(await a.api("GET", "/rider-papers"), "papers");
let row = pp.rows.find((x) => x.id === rid3);
check(row && row.has.passport === true && row.missing === 6, "a passport number counts; six papers missing");
check(!pp.rows.some((x) => x.id === rid), "riders who left are not in the papers table");
const photo = new FormData();
photo.append("entity_type", "rider"); photo.append("entity_id", String(rid3)); photo.append("attachment_type", "photo");
photo.append("file", new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])], { type: "image/jpeg" }), "me.jpg");
must(await a.api("POST", "/attachments", photo), "selfie");
row = must(await a.api("GET", "/rider-papers"), "papers 2").rows.find((x) => x.id === rid3);
check(row.has.photo === true && row.missing === 5, "the selfie counts");
check(must(await a.api("GET", `/rider-papers?search=${rid3}`), "search").rows.length === 1, "search by rider ID");

// --- audit
const au = must(await a.api("GET", "/logs/audit?search=rider&pageSize=100"), "audit").rows.map((x) => x.action);
for (const act of ["rider_bank.create", "rider_bank.delete", "rider.exit"]) check(au.includes(act), `audit has ${act}`);

// --- another company sees nothing and changes nothing
check(must(await b.api("GET", "/riders-exited"), "b exited").total === 0, "another company's exited list is empty");
check(must(await b.api("GET", "/rider-papers"), "b papers").rows.length === 0, "and its papers table");
check(must(await b.api("GET", `/riders/${rid}/bank-accounts`), "b banks").length === 0, "it cannot read A's bank accounts");
check((await b.api("POST", `/riders/${rid}/bank-accounts`, { bank_name: "X", iban: IBAN })).s === 404, "nor add one");
check((await b.api("PATCH", `/rider-bank-accounts/${b1}`, { bank_name: "X" })).s === 404, "nor edit one");
check((await b.api("DELETE", `/rider-bank-accounts/${b1}`)).s === 404, "nor delete one");
check((await b.api("PATCH", `/riders/${rid}/exit`, { exit_note: "x" })).s === 404, "nor change an exit record");
check(must(await a.api("GET", `/riders/${rid}/bank-accounts`), "a banks").length === 1, "A's accounts are untouched");

console.log(`employees.mjs: ${checks} checks passed`);
