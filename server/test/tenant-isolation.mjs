// Company isolation (SaaS): two companies sign up; company A records data with unique markers, then company B
// reads every GET address of the API, including A's record numbers, and must never see A's data or change it.
// Also checks the plan limit and the read-only mode after the trial ends.
// Usage, from server/, against a disposable install on port 4100 whose platform owner is admin@example.com / Admin12345!:
//   node test/tenant-isolation.mjs http://localhost:4100
import assert from "node:assert/strict";
import { routes } from "./route-inventory.mjs";

const base = process.argv[2] ?? "http://localhost:4100";
assert.match(base, /^http:\/\/(?:localhost|127\.0\.0\.1):(4100|4200)$/, "Disposable test ports only");
const stamp = Date.now().toString(36);
const MARK = `ZZA${stamp}`; // appears only in company A's data

function client(ip) {
  let cookie = "";
  const api = async (method, path, body) => {
    const opts = { method, headers: { cookie, connection: "close", ...(ip ? { "x-forwarded-for": ip } : {}) } };
    if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers["content-type"] = "application/json"; }
    const r = await fetch(base + "/api" + path, opts);
    const sc = r.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* file or empty */ }
    return { s: r.status, j: json, text };
  };
  const login = async (username, password) => {
    const ch = (await api("GET", "/auth/challenge")).j;
    const r = await api("POST", "/auth/login", { username, password, challengeId: ch.id, code: ch.code });
    assert.equal(r.s, 200, `login ${username}: ${r.text}`);
  };
  return { api, login };
}
const must = (r, what) => { if (r.s >= 400) { console.error(what, r.s, r.text); process.exit(1); } return r.j; };

// --- two companies sign up (14-day trial on the Starter plan)
const A = client(), B = client(), owner = client();
const emailA = `a-${stamp}@example.com`, emailB = `b-${stamp}@example.com`;
for (const [c, email, name] of [[A, emailA, `${MARK} Logistics`], [B, emailB, `Beta ${stamp}`]]) {
  must(await c.api("POST", "/public/signup", { company_name: name, company_name_en: name, full_name: "Owner", email, phone: "0500000000", password: "Passw0rd!x", confirm: "Passw0rd!x" }), "signup");
  await c.login(email, "Passw0rd!x");
}
const meA = must(await A.api("GET", "/me"), "me A");
assert.equal(meA.company.state, "trial");
assert.equal(meA.company.days_left, 14);
assert.equal(meA.platform_owner, false);

// --- company A records data that carries the marker
const co = must(await A.api("POST", "/companies", { name: `${MARK} Platform` }), "company");
const k = must(await A.api("POST", "/contracts", { company_id: co.id, name: `${MARK} contract` }), "contract");
const v = must(await A.api("POST", "/vehicles", { plate: `س ص ع ${String(Date.now()).slice(-4)}`, vehicle_type: "car", maker: MARK }), "vehicle");
const riderId = String(9000000 + Math.floor(Math.random() * 999999));
must(await A.api("POST", "/riders", { id: riderId, full_name: `${MARK} Rider`, national_id: "2" + String(Date.now()).slice(-9), company_id: co.id, contract_id: k.id, phone: "0551112233" }), "rider");
const lv = must(await A.api("POST", "/leaves", { rider_id: Number(riderId), leave_type: "annual", start_date: "2026-12-01", end_date: "2026-12-05", reason: MARK }), "leave");
const ids = { id: [co.id, k.id, v.id, riderId, lv?.id].filter(Boolean), rider: riderId, key: "x", code: "ar", type: "id", name: "document_expiry" };

// --- B sees none of it on any address of the API
const leaks = [];
let checked = 0;
const fill = (path) => path.replace(/:(\w+)/g, (_m, p) => encodeURIComponent(String(ids[p] ?? ids.id[0])));
for (const r of routes.filter((x) => x.method === "GET")) {
  const paths = r.path.includes(":id") ? ids.id.map((id) => r.path.replace(":id", id)) : [r.path];
  for (const p of paths) {
    const res = await B.api("GET", fill(p));
    checked++;
    if (res.text.includes(MARK)) leaks.push(`GET ${fill(p)} → ${res.s}`);
  }
}
// and cannot change or delete it
for (const [method, path, body] of [
  ["PATCH", `/riders/${riderId}`, { full_name: "hijacked" }],
  ["PATCH", `/vehicles/${v.id}`, { maker: "hijacked" }],
  ["PATCH", `/companies/${co.id}`, { name: "hijacked" }],
  ["DELETE", `/riders/${riderId}`],
  ["DELETE", `/vehicles/${v.id}`],
]) {
  // some addresses answer "ok" when nothing matched; what counts is that A's records stay as they were
  await B.api(method, path, body);
}
const after = JSON.stringify([
  must(await A.api("GET", `/riders/${riderId}`), "rider still A"),
  must(await A.api("GET", `/vehicles/${v.id}`), "vehicle still A"),
  must(await A.api("GET", `/companies/${co.id}`), "company still A"),
]);
if (after.includes("hijacked")) leaks.push("B changed A's data");
for (const want of [`${MARK} Rider`, `"maker":"${MARK}"`, `${MARK} Platform`]) if (!after.includes(want)) leaks.push(`B deleted or changed: ${want}`);
assert.equal(leaks.length, 0, "LEAKS:\n" + leaks.join("\n"));
// names unique inside a company may repeat in another company
must(await B.api("POST", "/companies", { name: `${MARK} Platform` }), "same name in company B");
// the same rider number in two companies (phase 0.5): registering it tells B nothing about A, and each portal
// sign-in reaches its own company's rider once the company code is given
must(await B.api("POST", "/riders", { id: riderId, full_name: "B Rider", phone: "0559998877" }), "company B registers the same rider number");
const bRider = must(await B.api("GET", `/riders/${riderId}`), "B reads its rider");
assert.equal(bRider.full_name ?? bRider.rider?.full_name, "B Rider", "B sees its own rider, not A's");
assert.ok(!JSON.stringify(bRider).includes(MARK), "B's rider file holds nothing of A's");
const slugA = meA.company.slug, slugB = must(await B.api("GET", "/me"), "me B").company.slug;
must(await A.api("POST", `/riders/${riderId}/portal/reset-password`, { password: "RiderA1234", confirm: "RiderA1234" }), "portal password A");
must(await B.api("POST", `/riders/${riderId}/portal/reset-password`, { password: "RiderB1234", confirm: "RiderB1234" }), "portal password B");
const lone = String(Number(riderId) + 1);
must(await B.api("POST", "/riders", { id: lone, full_name: "Only in B" }), "a number held by one company only");
must(await B.api("POST", `/riders/${lone}/portal/reset-password`, { password: "Lone12345", confirm: "Lone12345" }), "portal password lone");
// without a company code the first step looks the same for a shared number and a single one: nothing leaks
const first = async (id) => (await client().api("POST", "/portal/login", { rider_id: id })).j;
assert.deepEqual(await first(riderId), await first(lone), "the first step never tells that a number exists in another company");
// the password decides which company's rider it is, with or without the code from the link
for (const [password, slug, name] of [["RiderA1234", "", `${MARK} Rider`], ["RiderB1234", "", "B Rider"], ["RiderA1234", slugA, `${MARK} Rider`], ["RiderB1234", slugB, "B Rider"]]) {
  const rc = client();
  await rc.api("POST", "/portal/login", { rider_id: riderId, company: slug });
  must(await rc.api("POST", "/portal/login", { rider_id: riderId, company: slug, password }), `rider sign-in (${slug || "no code"})`);
  const prof = must(await rc.api("GET", "/portal/profile"), "portal profile");
  assert.ok(JSON.stringify(prof).includes(name), `the password reached ${name}`);
}
assert.equal((await client().api("POST", "/portal/login", { rider_id: riderId, password: "Wrong12345" })).j?.error, "portal_bad_credentials", "a wrong password on a shared number is just a wrong password");
// a stale code remembered on the device (another company's) never blocks a number held only once
const rl = client();
await rl.api("POST", "/portal/login", { rider_id: lone, company: slugA });
must(await rl.api("POST", "/portal/login", { rider_id: lone, company: slugA, password: "Lone12345" }), "a stale company code does not block the rider");
// guessing passwords on a shared number meets the same limit as any sign-in (10 failures per network)
const guesser = client(`203.0.113.${Math.floor(Math.random() * 200) + 20}`);
let refused = 0;
for (let i = 0; i < 11; i++) if ((await guesser.api("POST", "/portal/login", { rider_id: riderId, password: `Guess${i}xyz` })).s === 429) refused++;
assert.ok(refused >= 1, "password guessing on a shared number is limited");
assert.equal((await guesser.api("POST", "/portal/login", { rider_id: riderId, password: "RiderA1234" })).s, 429, "even the right password waits once the limit is reached");
console.log("same rider number in two companies: kept apart, nothing leaks, the password picks the rider, guessing is limited");
console.log(`isolation ok: ${checked} reads and 5 writes by company B saw nothing of company A`);

// --- the owner dashboard: only the platform owner
assert.equal((await A.api("GET", "/platform/tenants")).s, 403, "a company cannot open the owner dashboard");
assert.equal((await A.api("GET", "/backups")).s, 403, "a company cannot read platform backups");
await owner.login("admin", "Admin12345!");
const tenants = must(await owner.api("GET", "/platform/tenants"), "tenants");
const ta = tenants.find((t) => t.email === emailA);
assert.ok(ta && ta.riders === 1 && ta.vehicles === 1, "owner sees A's usage");

// --- plan limit: set Starter's vehicle limit to the current count, then one more is refused
const plans = must(await owner.api("GET", "/platform/plans"), "plans");
const starter = plans.find((p) => p.key === "starter");
must(await owner.api("PUT", "/platform/plans/starter", { ...starter, max_vehicles: 1 }), "limit");
await new Promise((r) => setTimeout(r, 10500)); // the company cache refreshes within 10 s
const over = await A.api("POST", "/vehicles", { plate: `ك ل م ${String(Date.now()).slice(-4)}`, vehicle_type: "car" });
assert.equal(over.s, 402, "plan limit");
assert.equal(over.j.error, "plan_limit_reached");
must(await owner.api("PUT", "/platform/plans/starter", { ...starter }), "limit back");

// --- trial over: the company falls back to Free (phase 1) and keeps working inside Free's limits
must(await owner.api("PATCH", `/platform/tenants/${ta.id}`, { trial_ends_at: "2020-01-01" }), "expire");
assert.equal((await A.api("GET", "/riders")).s, 200, "an ended trial can still read");
assert.equal(must(await A.api("GET", "/me"), "me on Free").company.plan_key, "free", "an ended trial falls back to Free");
// a company the owner marks expired by hand stays read-only until it pays
must(await owner.api("PATCH", `/platform/tenants/${ta.id}`, { status: "expired" }), "owner marks expired");
assert.equal((await A.api("POST", "/companies", { name: "Another" })).s, 402, "an expired company cannot write");
const pay = must(await A.api("POST", "/billing/request", { plan_key: "growth", billing_cycle: "monthly", reference: "TRX-1" }), "request");
const pending = must(await owner.api("GET", "/platform/payments?status=pending"), "payments");
assert.ok(pending.some((p) => p.id === pay.id));
must(await owner.api("POST", `/platform/payments/${pay.id}/approve`, {}), "approve");
await new Promise((r) => setTimeout(r, 10500));
const meA2 = must(await A.api("GET", "/me"), "me A2");
assert.equal(meA2.company.state, "active");
assert.equal(meA2.company.plan_key, "growth");
must(await A.api("POST", "/companies", { name: "Another" }), "write after payment");
console.log("plans ok: limit refused, ended trial on Free, expired is read-only, approved payment re-opens on Growth");
console.log("ALL TENANT CHECKS PASSED");
