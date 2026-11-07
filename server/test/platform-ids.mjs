// Phase 3, platform IDs: owner and worker ("self" by default), the first assignment in the history, transfers and
// their order, the worker changing only by transfer, shared IDs of a month, the status cards and filters, the
// rider profile list, riders that cannot be deleted while linked, export, import (a changed worker is a transfer),
// the audit trail, permissions, and that one company can never see or use another company's IDs or riders.
// Usage, from server/, against a disposable install on port 4100 whose platform owner is admin / Admin12345!:
//   node test/platform-ids.mjs http://localhost:4100
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
    return { s: r.status, j, text, type: r.headers.get("content-type") ?? "" };
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
const a = await signup("pids-a"), b = await signup("pids-b");

// --- setup: a platform with a contract, a second platform, four riders
const hs = must(await a.api("POST", "/companies", { name: `HungerStation ${stamp}` }), "platform").id;
const other = must(await a.api("POST", "/companies", { name: `Other ${stamp}` }), "platform 2").id;
const k1 = must(await a.api("POST", "/contracts", { company_id: hs, name: `Contract ${stamp}` }), "contract").id;
const kOther = must(await a.api("POST", "/contracts", { company_id: other, name: `Other contract ${stamp}` }), "contract 2").id;
const rid = 7000000 + Math.floor(Math.random() * 900000);
for (let i = 0; i < 4; i++) must(await a.api("POST", "/riders", { id: rid + i, full_name: `PID Rider ${i}` }), `rider ${i}`);
const [r0, r1, r2, r3] = [rid, rid + 1, rid + 2, rid + 3];

// --- create: the worker is the owner unless given, and the first assignment is history
const p1 = must(await a.api("POST", "/platform-ids", { id_number: `ID${stamp}1`, company_id: hs, contract_id: k1, owner_rider_id: r0 }), "id 1").id;
let p = must(await a.api("GET", `/platform-ids/${p1}`), "get 1");
check(p.worker_rider_id === r0 && p.is_self === 1 && p.status === "active", "a new ID is worked by its owner, active");
check(p.history.length === 1 && p.history[0].from_rider_id === null && p.history[0].to_rider_id === r0, "the first assignment is in the history");
const p2 = must(await a.api("POST", "/platform-ids", { id_number: `ID${stamp}2`, company_id: hs, owner_rider_id: r1, worker_rider_id: r2, status: "pending" }), "id 2").id;
p = must(await a.api("GET", `/platform-ids/${p2}`), "get 2");
check(p.worker_rider_id === r2 && p.is_self === 0, "an ID can be worked by someone other than its owner");
const p3 = must(await a.api("POST", "/platform-ids", { id_number: `ID${stamp}3`, company_id: other, worker_rider_id: null }), "id 3").id;
p = must(await a.api("GET", `/platform-ids/${p3}`), "get 3");
check(p.worker_rider_id === null && p.history.length === 0, "an ID can start with nobody on it");

// --- validation
let r = await a.api("POST", "/platform-ids", { id_number: `ID${stamp}1`, company_id: hs });
check(r.s === 422 && r.j.fields?.id_number === "id_number_taken", "an ID number is unique on its platform");
check(must(await a.api("POST", "/platform-ids", { id_number: `ID${stamp}1`, company_id: other }), "same number other platform").id > 0, "the same number may exist on another platform");
r = await a.api("POST", "/platform-ids", { id_number: `X${stamp}`, company_id: hs, contract_id: kOther });
check(r.s === 422 && r.j.fields?.contract_id === "contract_not_of_platform", "the contract must belong to the platform");
r = await a.api("POST", "/platform-ids", { id_number: `X${stamp}`, company_id: hs, owner_rider_id: 999999999 });
check(r.s === 422 && r.j.fields?.owner_rider_id === "rider_not_found", "the owner must be a rider of the company");
r = await a.api("POST", "/platform-ids", { id_number: `X${stamp}`, company_id: hs, status: "lost" });
check(r.s === 422 && r.j.fields?.status === "invalid", "the status is one of the four");
r = await a.api("PATCH", `/platform-ids/${p1}`, { worker_rider_id: r3 });
check(r.s === 422 && r.j.error === "worker_by_transfer", "the worker changes only by a transfer");
must(await a.api("PATCH", `/platform-ids/${p1}`, { status: "blocked", notes: "checked" }), "edit");
check(must(await a.api("GET", `/platform-ids/${p1}`), "get").status === "blocked", "an edit saves the status");
must(await a.api("PATCH", `/platform-ids/${p1}`, { status: "active" }), "edit back");
r = await a.api("PATCH", `/platform-ids/${p2}`, { id_number: `ID${stamp}1` });
check(r.s === 422 && r.j.fields?.id_number === "id_number_taken", "an edit cannot take another ID's number");

// --- transfers
r = await a.api("POST", `/platform-ids/${p1}/transfer`, { to_rider_id: r0 });
check(r.s === 409 && r.j.error === "same_worker", "a transfer to the same rider is refused");
const tomorrow = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
r = await a.api("POST", `/platform-ids/${p1}/transfer`, { to_rider_id: r1, date: tomorrow });
check(r.s === 422 && r.j.fields?.date === "date_in_future", "a transfer cannot be dated in the future");
r = await a.api("POST", `/platform-ids/${p1}/transfer`, { to_rider_id: r1, date: "2000-01-01" });
check(r.s === 422 && r.j.fields?.date === "before_last_transfer", "a transfer cannot be dated before the last change");
must(await a.api("POST", `/platform-ids/${p1}/transfer`, { to_rider_id: r1, reason: "covering" }), "transfer 1");
must(await a.api("POST", `/platform-ids/${p1}/transfer`, { to_rider_id: r3 }), "transfer 2");
p = must(await a.api("GET", `/platform-ids/${p1}`), "after transfers");
check(p.worker_rider_id === r3 && p.owner_rider_id === r0 && p.is_self === 0, "the worker moved, the owner stayed");
check(p.history.length === 3 && p.history[0].to_rider_id === r3 && p.history[0].from_rider_id === r1 && p.history[1].reason === "covering", "every transfer is in the history, newest first, with its reason");
check(p.history.every((h, i, all) => i === 0 || h.transferred_at <= all[i - 1].transferred_at), "the history is in order");
must(await a.api("POST", `/platform-ids/${p3}/transfer`, { to_rider_id: r2 }), "assign 3");
check(must(await a.api("GET", `/platform-ids/${p3}`), "p3").worker_rider_id === r2, "an ID with nobody on it can be given to a rider");
must(await a.api("POST", `/platform-ids/${p3}/transfer`, { to_rider_id: null, reason: "left" }), "unassign 3");
check(must(await a.api("GET", `/platform-ids/${p3}`), "p3").worker_rider_id === null, "and taken back to nobody");

// --- shared IDs: more than one rider this month
const month = new Date().toISOString().slice(0, 7);
const sh = must(await a.api("GET", `/platform-ids/shared?month=${month}`), "shared");
const s1 = sh.rows.find((x) => x.id === p1);
check(s1 && s1.riders.length === 3 && s1.riders.some((x) => x.id === r0) && s1.transfers === 3, "an ID worked by three riders this month is shared");
check(!sh.rows.some((x) => x.id === p2), "an ID worked by one rider is not shared, even when that rider is not the owner");
check(!sh.rows.some((x) => x.id === p3), "an ID given to one rider and taken back is not shared");
// the rider who held an ID when the month began counts for that month
const d0 = new Date(); const prevMonth = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
const p4 = must(await a.api("POST", "/platform-ids", { id_number: `ID${stamp}4`, company_id: hs, worker_rider_id: null }), "id 4").id;
must(await a.api("POST", `/platform-ids/${p4}/transfer`, { to_rider_id: r3, date: prevMonth }), "held since last month");
must(await a.api("POST", `/platform-ids/${p4}/transfer`, { to_rider_id: r2 }), "moved this month");
const s4 = must(await a.api("GET", `/platform-ids/shared?month=${month}`), "shared 4").rows.find((x) => x.id === p4);
check(s4 && s4.riders.length === 2 && s4.riders.some((x) => x.id === r3) && s4.transfers === 1, "the rider holding the ID when the month began is one of its riders");
check(!must(await a.api("GET", `/platform-ids/shared?month=${prevMonth.slice(0, 7)}`), "shared prev").rows.some((x) => x.id === p4), "last month it had one rider: not shared");
const last = must(await a.api("GET", "/platform-ids/shared?month=2000-01"), "shared old");
check(last.rows.length === 0, "nothing was shared in a month before any transfer");

// --- list: status cards, filters, search, sort
let l = must(await a.api("GET", "/platform-ids"), "list");
check(l.total === 5 && l.stats.active === 4 && l.stats.pending === 1 && l.stats.other_worker === 3, "the cards count by status and by someone else working");
check(must(await a.api("GET", "/platform-ids?status=pending"), "pending").total === 1, "the status filter");
check(must(await a.api("GET", "/platform-ids?status=pending"), "pending").stats.total === 5, "the cards ignore the status filter");
check(must(await a.api("GET", `/platform-ids?platform=${other}`), "other").total === 2, "the platform filter");
check(must(await a.api("GET", `/platform-ids?rider=${r0}`), "rider").total === 1, "the rider filter finds the owner");
check(must(await a.api("GET", `/platform-ids?rider=${r2}`), "rider").total === 2, "and the worker");
check(must(await a.api("GET", "/platform-ids?worker=other"), "other worker").total === 3, "someone else working");
check(must(await a.api("GET", "/platform-ids?worker=none"), "nobody").total === 2, "nobody working");
check(must(await a.api("GET", `/platform-ids?search=ID${stamp}2`), "search").total === 1, "search by number");
check(must(await a.api("GET", "/platform-ids?search=PID Rider 3"), "search").total === 1, "search by rider name");
check(must(await a.api("GET", "/platform-ids?sort=-id_number"), "sort").rows.length === 5, "sorting works");
check(must(await a.api("GET", `/riders/${r0}/platform-ids`), "rider ids").length === 1, "the rider's profile lists the IDs they own or work on");

// --- riders linked to an ID cannot be deleted
r = await a.api("DELETE", `/riders/${r0}`);
check(r.s === 409 && r.j.error === "rider_linked" && r.j.params.blockers.some((x) => x.what === "platform_ids"), "a rider who owns an ID cannot be deleted");

// --- export
r = await a.api("GET", "/platform-ids/export?format=csv");
check(r.s === 200 && r.text.includes(`ID${stamp}2`), "the export holds the IDs");

// --- import: new rows, a changed worker is a transfer, unknown platforms are row errors
const fd = new FormData();
fd.append("file", new Blob([`ID number,Platform,Contract,Owner ID,Worker ID,Status\nNEW${stamp},HungerStation ${stamp},Contract ${stamp},${r2},,active\nID${stamp}2,HungerStation ${stamp},,${r1},${r1},expired\nZZ${stamp},Nowhere ${stamp},,,,\n`], { type: "text/csv" }), "ids.csv");
fd.append("mode", "replace");
const pv = must(await a.api("POST", "/platform-ids/import/preview", fd), "import preview");
check(pv.problems === 1 && pv.problemList[0].reason === "platform_not_found", "an unknown platform is a row error");
must(await a.api("POST", "/platform-ids/import/run", { token: pv.token }), "import run");
l = must(await a.api("GET", `/platform-ids?search=NEW${stamp}`), "imported");
check(l.total === 1 && l.rows[0].worker_rider_id === r2 && l.rows[0].contract_id === k1, "an imported ID gets its contract, worked by its owner");
p = must(await a.api("GET", `/platform-ids/${p2}`), "replaced");
check(p.status === "expired" && p.worker_rider_id === r1 && p.history[0].from_rider_id === r2 && p.history[0].to_rider_id === r1, "a worker changed by the import is a transfer in the history");

// --- audit trail
const au = must(await a.api("GET", "/logs/audit?search=platform_id&pageSize=100"), "audit");
check(["platform_id.create", "platform_id.update", "platform_id.transfer"].every((x) => au.rows.some((row) => row.action === x)), "creates, edits and transfers are audited");

// --- another company sees nothing and can use nothing
check(must(await b.api("GET", "/platform-ids"), "b list").total === 0, "another company's list is empty");
check((await b.api("GET", `/platform-ids/${p1}`)).s === 404, "another company's ID is not found");
check((await b.api("PATCH", `/platform-ids/${p1}`, { status: "expired" })).s === 404, "and cannot be edited");
check((await b.api("POST", `/platform-ids/${p1}/transfer`, { to_rider_id: null })).s === 404, "nor transferred");
check((await b.api("DELETE", `/platform-ids/${p1}`)).s === 404, "nor deleted");
check(must(await b.api("GET", `/platform-ids/shared?month=${month}`), "b shared").rows.length === 0, "nor seen as shared");
const bhs = must(await b.api("POST", "/companies", { name: `B platform ${stamp}` }), "b platform").id;
r = await b.api("POST", "/platform-ids", { id_number: `B${stamp}`, company_id: hs });
check(r.s === 422 && r.j.fields?.company_id === "invalid", "another company's platform cannot be used");
r = await b.api("POST", "/platform-ids", { id_number: `B${stamp}`, company_id: bhs, owner_rider_id: r0 });
check(r.s === 422 && r.j.fields?.owner_rider_id === "rider_not_found", "nor another company's rider");

// --- delete removes the ID and its history
must(await a.api("DELETE", `/platform-ids/${p3}`), "delete");
check((await a.api("GET", `/platform-ids/${p3}`)).s === 404, "a deleted ID is gone");
const sh2 = must(await a.api("GET", `/platform-ids/shared?month=${month}`), "shared after delete");
check(!sh2.rows.some((x) => x.id === p3), "with its history");

console.log(`platform-ids.mjs: ${checks} checks passed`);
