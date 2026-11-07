// Phase 1, plans aligned with LogisTap: the Free plan a company falls back to, the extra quotas (delivery platforms,
// contracts), "data access paused" above the limits, features locked by plan, the device limit, the annual discount
// and downgrades that wait for the renewal.
// Usage, from server/, against a disposable install on port 4100 whose platform owner is admin / Admin12345!:
//   node test/plans.mjs http://localhost:4100
import assert from "node:assert/strict";

const base = process.argv[2] ?? "http://localhost:4100";
assert.match(base, /^http:\/\/(?:localhost|127\.0\.0\.1):(4100|4200)$/, "Disposable test ports only");
const stamp = Date.now().toString(36);
let checks = 0;
const check = (cond, msg) => { assert.ok(cond, msg); checks++; };

function client() {
  let cookie = "";
  const api = async (method, path, body) => {
    const opts = { method, headers: { cookie, connection: "close" } };
    if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers["content-type"] = "application/json"; }
    const r = await fetch(base + "/api" + path, opts);
    const sc = r.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch { /* empty */ }
    return { s: r.status, j, text };
  };
  const signIn = async (username, password, extra = {}) => {
    const ch = (await api("GET", "/auth/challenge")).j;
    return api("POST", "/auth/login", { username, password, challengeId: ch.id, code: ch.code, ...extra });
  };
  const login = async (username, password) => { const r = await signIn(username, password); assert.equal(r.s, 200, `login ${username}: ${r.text}`); };
  return { api, signIn, login };
}
const must = (r, what) => { if (r.s >= 400) { console.error(what, r.s, r.text); process.exit(1); } return r.j; };

const O = client();
await O.login("admin", "Admin12345!");
const signup = async (tag) => {
  const c = client(), email = `${tag}-${stamp}@example.com`;
  must(await c.api("POST", "/public/signup", { company_name: `${tag} ${stamp}`, full_name: "Owner", email, phone: "0500000000", password: "Passw0rd!x", confirm: "Passw0rd!x" }), "signup " + tag);
  await c.login(email, "Passw0rd!x");
  const me = must(await c.api("GET", "/me"), "me");
  return { c, email, id: me.company.id };
};
const savePlan = async (key, values) => must(await O.api("PUT", `/platform/plans/${key}`, values), "save plan " + key);
const qaPlan = `qa_${stamp}`.slice(0, 28);
const small = { name_ar: "اختبار", name_en: "QA", price_monthly: 100, max_riders: 3, max_users: 1, max_vehicles: 2, max_platforms: 1, max_contracts: 1, max_devices: 2, features: [], is_public: 0, is_active: 1, sort: 1 };
await savePlan(qaPlan, small);

// --- the plans: Free is there, every plan has the new limits, the annual price follows the 15% rule when left empty
const all = await (async () => must(await O.api("GET", "/platform/plans"), "plans"))();
const free = all.find((p) => p.key === "free");
check(free && free.max_riders === 10 && free.max_users === 0, "a Free plan exists: 10 riders, the owner's account only");
for (const p of all.filter((x) => ["starter", "growth", "scale"].includes(x.key))) check(p.max_platforms != null && p.max_contracts != null && p.max_devices != null, `${p.key} has platform, contract and device limits`);
const pub = must(await client().api("GET", "/public/plans"), "public plans");
check(pub.every((p) => typeof p.price_annual === "number"), "public plans carry the annual price");
await savePlan(qaPlan, { ...small, is_public: 1, price_annual: "" });
let mine = must(await client().api("GET", "/public/plans"), "public plans").find((p) => p.key === qaPlan);
check(mine && mine.price_annual === 1020, "an empty annual price is 12 months less 15%");
must(await O.api("PUT", "/platform/billing-settings", { annual_discount: 20 }), "discount 20%");
mine = must(await client().api("GET", "/public/plans"), "public plans").find((p) => p.key === qaPlan);
check(mine.price_annual === 960, "the discount is a platform setting");
must(await O.api("PUT", "/platform/billing-settings", { annual_discount: 15 }), "discount back");
await savePlan(qaPlan, { ...small, is_public: 1, price_annual: 999 });
mine = must(await client().api("GET", "/public/plans"), "public plans").find((p) => p.key === qaPlan);
check(mine.price_annual === 999, "a typed annual price wins over the rule");
await savePlan(qaPlan, { ...small, is_public: 0 });

// --- company A on the small plan: delivery platforms and contracts count, switching back on counts again
const A = await signup("plan-a");
must(await O.api("PATCH", `/platform/tenants/${A.id}`, { plan_key: qaPlan }), "A on the QA plan");
const co1 = must(await A.c.api("POST", "/companies", { name: `P1 ${stamp}` }), "first platform");
const over = await A.c.api("POST", "/companies", { name: `P2 ${stamp}` });
check(over.s === 402 && over.j.error === "plan_limit_reached" && over.j.params?.kind === "platforms", "a second delivery platform is over the limit");
must(await A.c.api("POST", `/companies/${co1.id}/disable`), "disable the first");
const co2 = must(await A.c.api("POST", "/companies", { name: `P2 ${stamp}` }), "a switched-off platform frees its place");
check((await A.c.api("POST", `/companies/${co1.id}/enable`)).s === 402, "switching the first back on is over the limit");
must(await A.c.api("POST", "/contracts", { company_id: co2.id, name: "K1" }), "first contract");
check((await A.c.api("POST", "/contracts", { company_id: co2.id, name: "K2" })).j?.params?.kind === "contracts", "a second contract is over the limit");
// a record added as "not counted" (terminated) never needs a place
for (let i = 1; i <= 3; i++) must(await A.c.api("POST", "/riders", { id: `77${stamp.length}${i}${String(Date.now()).slice(-5)}`, full_name: `R${i}` }), "rider " + i);
check((await A.c.api("POST", "/riders", { id: `78${String(Date.now()).slice(-7)}`, full_name: "R4" })).s === 402, "the fourth rider is over the limit");
check((await A.c.api("POST", "/riders", { id: `79${String(Date.now()).slice(-7)}`, full_name: "Gone", status: "terminated" })).s === 200, "a rider added as terminated takes no place");
const usage = must(await A.c.api("GET", "/plan/usage"), "usage counters");
check(usage.usage.riders === 3 && usage.limits.riders === 3 && usage.usage.platforms === 1 && usage.limits.platforms === 1 && usage.usage.contracts === 1, "usage counters for every quota");

// --- features locked by plan
check((await A.c.api("GET", "/live/riders/1")).j?.error === "feature_locked", "rider details in Live are locked on a plan without them");
await savePlan(qaPlan, { ...small, features: ["live_rider_details"] });
check((await A.c.api("GET", "/live/riders/1")).j?.error !== "feature_locked", "switched on in the plan, they open");
check(must(await A.c.api("GET", "/me"), "me").company.features.includes("live_rider_details"), "/me lists the plan's features for the screens");

// --- the device limit: two devices per account; a third sign-in is refused unless the oldest device is signed out
const d2 = client(), d3 = client();
await d2.login(A.email, "Passw0rd!x");
const third = await d3.signIn(A.email, "Passw0rd!x");
check(third.s === 409 && third.j.error === "device_limit_reached" && third.j.params?.max === 2, "a third device is refused with the limit");
check(!!third.j.params?.challenge, "the refusal hands a new code for the retry");
check((await d3.signIn(A.email, "wrong-password-1", { replace_oldest: true })).s === 401, "the oldest device is only signed out after the right password");
check((await d3.signIn(A.email, "Passw0rd!x", { replace_oldest: true })).s === 200, "signing out the oldest device lets the new one in");
check((await A.c.api("GET", "/riders")).s === 401, "the oldest device was signed out");
const devices = must(await d3.api("GET", "/profile/devices"), "my devices");
check(devices.max_devices === 2 && devices.active === 2, "My devices shows 2 / 2");
A.c = d3;

// --- downgrade waits for the renewal; a plan too small for the data is refused with what is over
must(await O.api("PATCH", `/platform/tenants/${A.id}`, { plan_key: "growth", status: "active", period_ends_at: "2030-01-01" }), "A on Growth until 2030");
await savePlan(qaPlan, { ...small, is_public: 1, max_riders: 2 });
const tooSmall = await A.c.api("POST", "/billing/request", { plan_key: qaPlan, billing_cycle: "monthly" });
check(tooSmall.s === 422 && tooSmall.j.error === "plan_too_small" && String(tooSmall.j.params?.over).includes("riders"), "a plan too small for the data is refused, naming what is over");
await savePlan(qaPlan, { ...small, is_public: 1 });
const down = must(await A.c.api("POST", "/billing/request", { plan_key: qaPlan, billing_cycle: "monthly" }), "downgrade request");
must(await O.api("POST", `/platform/payments/${down.id}/approve`, {}), "owner approves the downgrade");
let tA = must(await O.api("GET", "/platform/tenants"), "tenants").find((t) => t.id === A.id);
check(tA.plan_key === "growth" && tA.next_plan_key === qaPlan, "an approved downgrade waits for the end of the paid period");
must(await O.api("PATCH", `/platform/tenants/${A.id}`, { period_ends_at: "2020-01-01" }), "the period ends");
const meA = must(await A.c.api("GET", "/me"), "me after renewal").company;
check(meA.plan_key === qaPlan && meA.state === "active" && meA.days_left >= 29, "at the renewal the smaller plan starts with its paid month");
await savePlan(qaPlan, { ...small, is_public: 0 });

// --- the end of a plan: back to Free, nothing deleted, records above Free's limits are paused
const B = await signup("plan-b");
const staffRole = must(await B.c.api("GET", "/roles"), "roles");
const role = (staffRole.rows ?? staffRole).find((r) => !/admin/i.test(r.name)) ?? (staffRole.rows ?? staffRole)[0];
must(await B.c.api("POST", "/users", { username: `staff${stamp}`, full_name: "Staff", email: `staff-${stamp}@example.com`, role_id: role.id, password: "Staffpass12", confirm: "Staffpass12" }), "a staff account");
const ids = [];
for (let i = 0; i < 12; i++) { const id = `6${String(i).padStart(2, "0")}${String(Date.now()).slice(-6)}`; ids.push(id); must(await B.c.api("POST", "/riders", { id, full_name: `B${i}` }), "rider B" + i); }
must(await O.api("PATCH", `/platform/tenants/${B.id}`, { trial_ends_at: "2020-01-01" }), "B's trial ends");
const meB = must(await B.c.api("GET", "/me"), "me B").company;
check(meB.plan_key === "free" && meB.state === "active" && meB.ends_at == null, "an ended trial falls back to Free, with no end date");
check((await B.c.api("POST", "/companies", { name: `B platform ${stamp}` })).s === 200, "on Free the company still works inside the limits");
const list = must(await B.c.api("GET", "/riders?pageSize=50"), "riders on Free");
const paused = list.rows.filter((r) => r.paused).map((r) => String(r.id));
check(list.rows.length === 12 && paused.length === 2, "all 12 riders are kept; the 2 above Free's 10 are marked paused");
check((await B.c.api("GET", `/riders/${paused[0]}`)).j?.error === "record_paused", "a paused rider's file shows data access paused");
check((await B.c.api("GET", `/riders/${ids[0]}`)).s === 200, "the oldest riders stay open");
check((await B.c.api("POST", "/riders", { id: `69${String(Date.now()).slice(-7)}`, full_name: "More" })).s === 402, "no new rider above the limit");
const staff = await client().signIn(`staff${stamp}`, "Staffpass12");
check(staff.s === 402 && staff.j.error === "staff_paused", "Free has only the owner's account: staff sign-in is paused");
check(must(await B.c.api("GET", "/plan/usage"), "usage B").paused?.riders === 2, "the screens learn how many records are paused");
check((await B.c.api("PATCH", `/riders/${paused[1]}`, { full_name: "changed" })).j?.error === "record_paused", "a paused rider cannot be edited");
check((await B.c.api("PATCH", `/riders/${paused[1]}`, { status: "terminated" })).s === 200, "but it can be terminated, to free a place");
// paying again re-opens everything
const pay = must(await B.c.api("POST", "/billing/request", { plan_key: "growth", billing_cycle: "monthly", reference: "TRX" }), "B pays");
must(await O.api("POST", `/platform/payments/${pay.id}/approve`, {}), "approve");
check((await B.c.api("GET", `/riders/${paused[0]}`)).s === 200, "after paying, paused riders open again");
check((await client().signIn(`staff${stamp}`, "Staffpass12")).s === 200, "and staff can sign in again");

console.log("PLAN CHECKS PASSED:", checks);
