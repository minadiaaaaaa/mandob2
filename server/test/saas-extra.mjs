// SaaS checks beyond isolation: sign-up rules, suspension, extending, rejecting and approving payments,
// downgrades that no longer fit, one pending request at a time, receipts, and the owner-only pages.
// Usage, from server/, against a disposable install on port 4100 whose platform owner is admin / Admin12345!:
//   node test/saas-extra.mjs http://localhost:4100
import assert from "node:assert/strict";

const base = process.argv[2] ?? "http://localhost:4100";
assert.match(base, /^http:\/\/(?:localhost|127\.0\.0\.1):(4100|4200)$/, "Disposable test ports only");
const stamp = Date.now().toString(36);
let checks = 0;
const check = (cond, msg) => { assert.ok(cond, msg); checks++; };

function client(ip) {
  let cookie = "";
  const api = async (method, path, body) => {
    const headers = { cookie, connection: "close" };
    if (ip) headers["x-forwarded-for"] = ip;
    const opts = { method, headers };
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) { opts.body = JSON.stringify(body); headers["content-type"] = "application/json"; }
    const r = await fetch(base + "/api" + path, opts);
    const sc = r.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch { /* file */ }
    return { s: r.status, j, text, type: r.headers.get("content-type") };
  };
  const login = async (username, password) => {
    const ch = (await api("GET", "/auth/challenge")).j;
    return api("POST", "/auth/login", { username, password, challengeId: ch.id, code: ch.code });
  };
  return { api, login };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const signup = (c, email, extra = {}) => c.api("POST", "/public/signup", {
  company_name: `Extra ${stamp}`, full_name: "Owner", email, phone: "0500000000", password: "Passw0rd!x", confirm: "Passw0rd!x", ...extra,
});

// --- sign-up rules
const guest = client();
const plans = (await guest.api("GET", "/public/plans")).j;
check(Array.isArray(plans) && plans.length === 4 && plans[0].key === "free", "public plans list, Free first");
check((await signup(guest, `x-${stamp}@example.com`, { confirm: "different" })).j.fields?.confirm === "passwords_differ", "confirm must match");
check((await signup(guest, "not-an-email")).j.fields?.email, "email is validated");
check((await signup(guest, `y-${stamp}@example.com`, { password: "short" })).j.fields?.password, "password minimum length");
const email = `c-${stamp}@example.com`;
check((await signup(guest, email)).s === 200, "sign-up works");
check((await signup(guest, email)).j.fields?.email === "email_taken", "the same email cannot sign up twice");
check((await signup(guest, "admin@example.com")).j.fields?.email === "email_taken", "a platform owner email is taken too");

const C = client();
check((await C.login(email, "Passw0rd!x")).s === 200, "new company signs in");
const me = (await C.api("GET", "/me")).j;
check(me.company?.state === "trial" && me.company.days_left === 14, "14-day trial");
check(me.perms.includes("subscription.manage"), "the company owner manages the subscription");
check(me.role === "Admin", "the company owner is its Admin (Super Admin is the platform owner's alone)");
check(me.platform_owner === false, "the company Admin is not the platform owner");
for (const name of ["Super Admin", "super_admin", " SUPER  ADMIN "])
  check((await C.api("POST", "/roles", { name })).j.fields?.name === "role_name_reserved", `a company cannot name a role ${JSON.stringify(name)}`);
check((await C.api("GET", "/roles")).j.rows.every((r) => r.name !== "Super Admin"), "no Super Admin role inside a company");
const billing = (await C.api("GET", "/billing")).j;
check(billing.limits.riders === 50 && billing.limits.vehicles === 60 && billing.limits.users === 2, "trial uses Starter limits");
check(billing.usage.users === 0, "the owner is not counted as a staff account");

// --- staff accounts limit (Starter: 2 besides the owner)
const roles = (await C.api("GET", "/roles/options")).j;
const viewer = (Array.isArray(roles) ? roles : roles.rows ?? []).find((r) => r.name === "Viewer") ?? (Array.isArray(roles) ? roles : roles.rows)[0];
const staffIds = [];
for (let i = 1; i <= 2; i++) {
  const r = await C.api("POST", "/users", { username: `staff${i}-${stamp}`, full_name: `Staff ${i}`, email: `s${i}-${stamp}@example.com`, password: "Staffpass123!", confirm: "Staffpass123!", role_id: viewer.id });
  check(r.s === 200, `staff account ${i} within the limit: ${r.text.slice(0, 120)}`);
  staffIds.push(r.j.id);
}
const third = await C.api("POST", "/users", { username: `staff3-${stamp}`, full_name: "Staff 3", email: `s3-${stamp}@example.com`, password: "Staffpass123!", confirm: "Staffpass123!", role_id: viewer.id });
check(third.s === 402 && third.j.error === "plan_limit_reached", "third staff account refused on Starter");
// usernames are unique on the whole platform
const dupUser = await C.api("POST", "/users", { username: "admin", full_name: "X", email: `z-${stamp}@example.com`, password: "Staffpass123!", confirm: "Staffpass123!", role_id: viewer.id });
check(dupUser.s >= 400, "a username of another company cannot be reused");

// --- staff of the company sign in into the same company and cannot reach the owner pages
const S = client();
check((await S.login(`staff1-${stamp}`, "Staffpass123!")).s === 200, "staff signs in");
check((await S.api("GET", "/me")).j.company?.id === me.company.id, "staff lands in their company");
for (const p of ["/platform/overview", "/platform/tenants", "/platform/plans", "/platform/payments", "/backups", "/blocked-ips", "/languages"])
  check((await C.api("GET", p)).s === 403, `company owner refused ${p}`);

// --- requests: receipt, one pending at a time, too small a plan, reject then approve
const fd = new FormData();
fd.set("plan_key", "growth"); fd.set("billing_cycle", "annual"); fd.set("reference", "TRX-R1");
fd.set("receipt", new Blob([Buffer.from("%PDF-1.4\n%test receipt\n")], { type: "application/pdf" }), "receipt.pdf");
const req1 = await C.api("POST", "/billing/request", fd);
check(req1.s === 200, "request with a receipt: " + req1.text.slice(0, 120));
check((await C.api("POST", "/billing/request", { plan_key: "scale", billing_cycle: "monthly" })).j?.error === "payment_pending", "one pending request at a time");

const O = client();
check((await O.login("admin", "Admin12345!")).s === 200, "owner signs in");

// --- the limit cannot be got round by switching something back on (phase 0.3)
// staff: disable one, add another in its place, then turning the first back on is refused
check((await C.api("POST", `/users/${staffIds[0]}/disable`)).s === 200, "staff 1 disabled");
const stand = await C.api("POST", "/users", { username: `staff4-${stamp}`, full_name: "Staff 4", email: `s4-${stamp}@example.com`, password: "Staffpass123!", confirm: "Staffpass123!", role_id: viewer.id });
check(stand.s === 200, "a disabled account frees its place");
const back = await C.api("POST", `/users/${staffIds[0]}/activate`);
check(back.s === 402 && back.j.error === "plan_limit_reached", "turning a disabled account back on beyond the limit is refused");
// riders: Starter's rider limit set to 1
const st = (await O.api("GET", "/platform/plans")).j.find((p) => p.key === "starter");
await O.api("PUT", "/platform/plans/starter", { ...st, max_riders: 1, max_vehicles: 1 });
await wait(10500);
const rx = String(8300000 + Math.floor(Math.random() * 99999)), ry = String(Number(rx) + 1), rz = String(Number(rx) + 2);
check((await C.api("POST", "/riders", { id: rx, full_name: "Quota X" })).s === 200, "rider X within the limit");
check((await C.api("PATCH", `/riders/${rx}`, { status: "terminated" })).s === 200, "rider X terminated");
check((await C.api("POST", "/riders", { id: ry, full_name: "Quota Y" })).s === 200, "a terminated rider frees its place");
const px = await C.api("PATCH", `/riders/${rx}`, { status: "active" });
check(px.s === 402 && px.j.error === "plan_limit_reached", "bringing a terminated rider back beyond the limit is refused");
const bx = await C.api("POST", "/riders/bulk-edit", { ids: [Number(rx)], changes: { status: "active" } });
check(bx.s === 402 && bx.j.error === "plan_limit_reached", "bulk edit cannot bring a terminated rider back beyond the limit");
check((await C.api("POST", "/riders/bulk-edit", { ids: [Number(ry)], changes: { status: "inactive" } })).s === 200, "a counted rider can still change status");
// two requests at the same moment for the last place: only one gets it
check((await C.api("PATCH", `/riders/${ry}`, { status: "terminated" })).s === 200, "rider Y terminated: one place free");
const race = await Promise.all([rz, String(Number(rx) + 3), String(Number(rx) + 4)].map((id) => C.api("POST", "/riders", { id, full_name: "Race " + id })));
check(race.filter((r) => r.s === 200).length === 1 && race.filter((r) => r.s === 402).length === 2, `parallel adds stop at the limit (${race.map((r) => r.s).join(",")})`);
// vehicles: a retired vehicle cannot come back beyond the limit, from the form or "return to service"
const va = await C.api("POST", "/vehicles", { plate: `ر ر ر ${String(Date.now()).slice(-4)}`, vehicle_type: "car" });
check(va.s === 200, "vehicle A within the limit");
check((await C.api("PATCH", `/vehicles/${va.j.id}`, { status: "retired" })).s === 200, "vehicle A retired");
check((await C.api("POST", "/vehicles", { plate: `س س س ${String(Date.now()).slice(-4)}`, vehicle_type: "car" })).s === 200, "a retired vehicle frees its place");
check((await C.api("PATCH", `/vehicles/${va.j.id}`, { status: "active" })).j?.error === "plan_limit_reached", "a retired vehicle cannot come back beyond the limit");
check((await C.api("POST", `/vehicles/${va.j.id}/service`)).j?.error === "plan_limit_reached", "return to service cannot bring a retired vehicle back beyond the limit");
await O.api("PUT", "/platform/plans/starter", { ...st });
await wait(10500);
const pend = (await O.api("GET", "/platform/payments?status=pending")).j.find((p) => p.id === req1.j.id);
check(pend && pend.receipt_id, "owner sees the request with its receipt");
const rc = await O.api("GET", `/platform/payments/${req1.j.id}/receipt`);
check(rc.s === 200 && /pdf/.test(rc.type ?? ""), "owner opens the receipt");
check((await C.api("GET", `/platform/payments/${req1.j.id}/receipt`)).s === 403, "a company cannot use the owner's receipt address");
check((await O.api("POST", `/platform/payments/${req1.j.id}/reject`, { note: "amount missing" })).s === 200, "owner rejects");
check((await O.api("POST", `/platform/payments/${req1.j.id}/approve`, {})).j?.error === "already_reviewed", "a reviewed payment cannot be reviewed again");
const hist = (await C.api("GET", "/billing")).j.payments[0];
check(hist.status === "rejected" && hist.review_note === "amount missing", "company sees the rejection and the note");

// a plan below what is used is refused: set Starter's staff limit to 1 with 2 staff accounts
const starter = (await O.api("GET", "/platform/plans")).j.find((p) => p.key === "starter");
check((await O.api("PUT", "/platform/plans/starter", { ...starter, max_users: 1 })).s === 200, "owner edits a limit");
check((await C.api("POST", "/billing/request", { plan_key: "starter", billing_cycle: "monthly" })).j?.error === "plan_too_small", "downgrade that does not fit is refused");
check((await O.api("PUT", "/platform/plans/starter", { ...starter })).s === 200, "limit restored");
// a plan taken off sale cannot be requested
const scale = (await O.api("GET", "/platform/plans")).j.find((p) => p.key === "scale");
await O.api("PUT", "/platform/plans/scale", { ...scale, is_public: 0 });
check((await C.api("POST", "/billing/request", { plan_key: "scale", billing_cycle: "monthly" })).j?.fields?.plan_key === "invalid", "plan off sale refused");
check(!(await guest.api("GET", "/public/plans")).j.some((p) => p.key === "scale"), "plan off sale hidden from sign-up");
await O.api("PUT", "/platform/plans/scale", { ...scale, is_public: 1 });

// the amount of a request is the plan's price at the moment it is sent
const growth = (await O.api("GET", "/platform/plans")).j.find((p) => p.key === "growth");
await O.api("PUT", "/platform/plans/growth", { ...growth, price_monthly: 499, price_annual: 5090 });
const req2 = await C.api("POST", "/billing/request", { plan_key: "growth", billing_cycle: "annual", reference: "TRX-R2" });
check(req2.s === 200, "second request");
check((await C.api("GET", "/billing")).j.payments[0].amount === 5090, "request carries the yearly price");
check((await O.api("POST", `/platform/payments/${req2.j.id}/approve`, { note: "ok" })).s === 200, "owner approves");
await wait(10500);
const after = (await C.api("GET", "/me")).j.company;
check(after.state === "active" && after.plan_key === "growth" && after.days_left >= 364, "annual Growth starts for a year");

// --- a rider of the company signs in to the portal, and the company has a sync token
const riderId = String(8200000 + Math.floor(Math.random() * 99999));
check((await C.api("POST", "/riders", { id: riderId, full_name: "Portal Rider" })).s === 200, "company adds a rider");
check((await C.api("POST", `/riders/${riderId}/portal/reset-password`, { password: "Rider12345", confirm: "Rider12345" })).s === 200, "office sets the rider's portal password");
const R = client();
const riderLogin = async (c) => { await c.api("POST", "/portal/login", { rider_id: riderId }); return c.api("POST", "/portal/login", { rider_id: riderId, password: "Rider12345" }); };
check((await riderLogin(R)).s === 200, "rider signs in to the portal");
check((await R.api("GET", "/portal/me")).s === 200, "rider portal works");
const syncToken = (await C.api("POST", "/sync/token")).j.token;
const ingest = () => fetch(base + "/api/sync/ingest", { method: "POST", headers: { authorization: `Bearer ${syncToken}`, "content-type": "application/json" }, body: JSON.stringify({ source: "live", rows: [] }) }).then(async (r) => ({ s: r.status, j: await r.json().catch(() => ({})) }));
check((await ingest()).s === 200, "sync token accepted while the company is usable");

// --- email: a company without its own mail server sends through the platform's (phase 0.7)
check((await O.api("PUT", "/email/smtp/system", { host: "smtp.platform.invalid", port: 587, enabled: 0 })).s === 200, "platform mail off");
check((await O.api("PUT", "/email/smtp/riders", { host: "smtp.platform.invalid", port: 587, enabled: 0 })).s === 200, "platform rider mail off");
check((await R.api("POST", "/portal/security/email", { email: `r-${stamp}@example.com` })).j?.error === "email_unavailable", "no mail server anywhere: rider email is unavailable");
check((await O.api("PUT", "/email/smtp/system", { host: "smtp.platform.invalid", port: 587, enabled: 1, sender_name: "Platform" })).s === 200, "platform mail on");
check((await R.api("POST", "/portal/security/email", { email: `r-${stamp}@example.com` })).s === 200, "the company's rider gets a code through the platform's mail server");
const own = (await C.api("GET", "/email/smtp")).j;
check(!JSON.stringify(own).includes("smtp.platform.invalid"), "the company's mail settings never show the platform's server");
const sent = (await C.api("GET", "/email/log")).j.rows?.[0];
check(sent && sent.to_email === `r-${stamp}@example.com`, "the message is in the company's own email log");

// --- platform maintenance: every company is closed, the owner keeps working (phase 0.7)
check((await O.api("PUT", "/platform/maintenance", { on: 1, message: "back soon" })).s === 200, "owner switches platform maintenance on");
const closed = await C.api("GET", "/riders");
check(closed.s === 503 && closed.j.error === "maintenance" && closed.j.params?.message === "back soon", "companies see the maintenance message");
check((await O.api("GET", "/platform/tenants")).s === 200, "the owner keeps working during maintenance");
check((await R.api("GET", "/portal/profile")).s === 503, "the rider portal is closed too");
check((await client().api("POST", "/public/signup", { company_name: "Late" })).s === 503, "no new sign-ups during maintenance");
check((await client().api("POST", "/sync/ingest", {})).s === 503, "the extension's sync waits too");
check((await client().api("GET", "/auth/challenge")).s === 200, "signing in stays open (so the owner can get in)");
check((await O.api("PUT", "/platform/maintenance", { on: 0, message: "" })).s === 200, "owner switches maintenance off");
check((await C.api("GET", "/riders")).s === 200, "companies work again");

// --- extend, suspend, reactivate
const tid = me.company.id;
check((await O.api("POST", `/platform/tenants/${tid}/extend`, { days: 10 })).s === 200, "owner extends");
await wait(10500);
check((await C.api("GET", "/me")).j.company.days_left >= 374, "extension added to the paid period");
check((await O.api("PATCH", `/platform/tenants/${tid}`, { status: "suspended", owner_note: "test" })).s === 200, "owner suspends");
await wait(10500);
check((await C.api("GET", "/riders")).j?.error === "company_suspended", "a suspended company is stopped even with an open session");
check((await client().login(email, "Passw0rd!x")).j?.error === "company_suspended", "a suspended company cannot sign in");
check((await R.api("GET", "/portal/me")).j?.error === "company_suspended", "a suspended company's rider is stopped even with an open portal session");
check((await riderLogin(client())).j?.error === "company_suspended", "a suspended company's rider cannot sign in to the portal");
check((await ingest()).j?.error === "company_suspended", "a suspended company's sync token is refused");
check((await O.api("PATCH", `/platform/tenants/${tid}`, { status: "active" })).s === 200, "owner reactivates");
await wait(10500);
check((await C.api("GET", "/riders")).s === 200, "reactivated company works again");
// a company the owner marks expired: riders can look, but not send anything; sync stops
// (a period that simply ends falls back to Free instead: test/plans.mjs)
const paidUntil = (await O.api("GET", `/platform/tenants?search=${encodeURIComponent(email)}`)).j[0].period_ends_at;
check((await O.api("PATCH", `/platform/tenants/${tid}`, { status: "expired" })).s === 200, "owner marks the company expired");
await wait(10500);
check((await R.api("GET", "/portal/me")).s === 200, "an ended company's rider can still read the portal");
check((await R.api("POST", "/portal/leaves", { leave_type: "annual", start_date: "2030-01-01" })).j?.error === "subscription_inactive", "an ended company's rider cannot send requests");
check((await ingest()).j?.error === "subscription_inactive", "an ended company's sync is refused");
check((await O.api("PATCH", `/platform/tenants/${tid}`, { status: "active", period_ends_at: paidUntil.slice(0, 10) })).s === 200, "owner restores the period");
await wait(10500);
check((await R.api("GET", "/portal/me")).s === 200, "rider portal works again");

// --- the owner's lists
const list = (await O.api("GET", `/platform/tenants?search=${encodeURIComponent(email)}`)).j;
check(list.length === 1 && list[0].users === 2, "owner search, staff count without the owner");
check((await O.api("GET", "/platform/tenants?status=suspended")).j.every((t) => t.status === "suspended"), "owner filters by status");
const ov = (await O.api("GET", "/platform/overview")).j;
check(ov.counts.total >= 1 && Number(ov.money.revenue_30) > 0, "overview counts and revenue");
check((await O.api("PUT", "/platform/plans/Bad Key", { name_ar: "x", name_en: "x" })).s >= 400, "invalid plan key refused");

console.log(`SAAS EXTRA CHECKS PASSED: ${checks}`);
