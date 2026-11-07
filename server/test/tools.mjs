// Phase 8, the dashboard and the smaller tools: company health, profile completeness and its weights, the
// employee and vehicle sections, finance on the dashboard, daily targets, the rider list's work-state cards, saved
// links per user and community links, the closure request, print lists (only known columns, blank columns, Excel),
// ID cards, the new legal fields, and isolation between companies.
// Usage, from server/, against a disposable install on port 4100 whose platform owner is admin / Admin12345!:
//   node test/tools.mjs http://localhost:4100
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
    if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers["content-type"] = "application/json"; }
    const r = await fetch(base + "/api" + path, opts);
    const sc = r.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch { /* empty */ }
    return { s: r.status, j, text, type: r.headers.get("content-type") ?? "" };
  };
  const login = async (username, password) => {
    const ch = (await api("GET", "/auth/challenge")).j;
    const r = await api("POST", "/auth/login", { username, password, challengeId: ch.id, code: ch.code, replace_oldest: true });
    assert.equal(r.s, 200, `login ${username}: ${r.text}`);
  };
  return { api, login };
}
const must = (r, what) => { if (r.s >= 400) { console.error(what, r.s, r.text); process.exit(1); } return r.j; };
const signup = async (tag) => {
  const c = client(), email = `${tag}-${stamp}@example.com`, name = `${tag} ${stamp}`;
  must(await c.api("POST", "/public/signup", { company_name: name, full_name: "Owner", email, phone: "0500000000", password: "Passw0rd!x", confirm: "Passw0rd!x" }), "signup " + tag);
  await c.login(email, "Passw0rd!x");
  return { c, id: must(await c.api("GET", "/me"), "me").company.id, name };
};
const O = client(); await O.login("admin", "Admin12345!");
const A = await signup("tools-a"), B = await signup("tools-b");
const a = A.c, b = B.c;
const dayOff = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

// --- the dashboard's company part
let d = must(await a.api("GET", "/dashboard"), "dashboard");
check(d.company && typeof d.company.health.percent === "number" && ["good", "attention", "at_risk"].includes(d.company.health.label), "the dashboard has company health");
const w = d.company.profile.sections;
check(w.identity.weight === 15 && w.legal.weight === 30 && w.contact.weight === 15 && w.bank.weight === 15 && w.documents.weight === 25, "the profile weights are 15/30/15/15/25");
check(d.company.cards.branches === 1 && d.company.cards.designations === 2 && d.company.cards.days_left > 0, "the cards: branches, titles, days left");
const p0 = d.company.profile.percent;
must(await a.api("PATCH", "/settings/organization", { name: A.name, name_en: "Tools A", cr_number: "1010", tax_number: "300000000000003", unified_number: "7001", city_cr_number: "55", vat_cert_expiry: "2027-01-01", gosi_number: "G1", support_email: "a@example.com", support_phone: "0500000000", address: "Tabuk" }), "org");
must(await a.api("POST", "/fin-accounts", { name: "Bank", kind: "bank", iban: "SA0380000000608010167519" }), "bank");
d = must(await a.api("GET", "/dashboard"), "dashboard 2");
check(d.company.profile.percent > p0 && d.company.profile.sections.legal.score === 30 && d.company.profile.sections.bank.score === 15 && d.company.profile.sections.contact.score === 15, "filling the profile raises its completeness");
check(d.finance && d.finance.accounts === 1 && "pending_employee" in d.finance, "an admin sees finance on the dashboard");
const org = must(await a.api("GET", "/settings/organization"), "org get").values;
check(org.city_cr_number === "55" && String(org.vat_cert_expiry).startsWith("2027-01-01") && org.gosi_number === "G1", "the new legal fields are kept");

// --- riders and vehicles in their sections; work-state cards
const rid = 9300000 + Math.floor(Math.random() * 600000);
for (let i = 0; i < 3; i++) must(await a.api("POST", "/riders", { id: rid + i, full_name: `Tools Rider ${i}` }), `rider ${i}`);
const v1 = must(await a.api("POST", "/vehicles", { plate: `ع غ ف ${stamp.slice(-4)}`, vehicle_type: "motorcycle" }), "vehicle").id;
must(await a.api("POST", "/vehicle-assignments", { vehicle_id: v1, rider_id: rid }), "assign");
const lv = must(await a.api("POST", "/leaves", { rider_id: rid + 1, leave_type: "annual", start_date: dayOff(-1), end_date: dayOff(1), reason: "Rest" }), "leave");
must(await a.api("POST", `/leaves/${lv.id}/answer`, { decision: "approved" }), "approve leave");
d = must(await a.api("GET", "/dashboard"), "dashboard 3");
check(d.company.riders.working === 1 && d.company.riders.on_leave === 1 && d.company.riders.ready === 1, "working, on leave and ready riders");
check(d.company.riders.missing_papers === 3 && d.company.riders.risk === 100, "riders with no papers are all at risk");
check(d.company.vehicles.working === 1 && d.company.vehicles.reserved === 0, "the vehicle with a rider is working");
const rl = must(await a.api("GET", "/riders"), "riders list");
check(rl.stats.working === 1 && rl.stats.on_leave === 1 && rl.stats.ready === 1, "the rider list shows the same work-state cards");

// --- daily targets
check(must(await a.api("GET", "/performance-targets"), "targets").orders === 15, "the default target is 15 orders");
let r = await a.api("PUT", "/performance-targets", { orders: 0, hours: 8, declined: 2 });
check(r.s === 422 && r.j.fields?.orders === "too_small", "a target is at least 1 order");
must(await a.api("PUT", "/performance-targets", { orders: 20, hours: 9, declined: 1 }), "set targets");
check(must(await a.api("GET", "/performance?from=2020-01-01&to=2020-01-01"), "perf").targets.orders === 20, "the performance list carries the company's targets");
check(must(await b.api("GET", "/performance-targets"), "b targets").orders === 15, "another company keeps its own targets");

// --- saved links: each user's own; community links from the owner
r = await a.api("POST", "/bookmarks", { title: "Bad", url: "javascript:alert(1)" });
check(r.s === 422 && r.j.fields?.url === "url_invalid", "only http and https links");
const bm = must(await a.api("POST", "/bookmarks", { title: "Absher", url: "https://www.absher.sa/" }), "bookmark").id;
check((await a.api("POST", "/bookmarks", { title: "Again", url: "https://www.absher.sa/" })).j?.fields?.url === "bookmark_exists", "a link is saved once");
check(must(await b.api("GET", "/bookmarks"), "b links").mine.length === 0, "another company's user sees none of them");
check((await b.api("DELETE", `/bookmarks/${bm}`)).s === 404, "and cannot delete them");
check((await a.api("POST", "/platform/community-links", { title: "x", url: "https://example.com" })).s === 403, "a company cannot add community links");
must(await O.api("POST", "/platform/community-links", { title: `Qiwa ${stamp}`, url: "https://qiwa.sa/" }), "community");
check(must(await b.api("GET", "/bookmarks"), "b links 2").community.some((c) => c.title === `Qiwa ${stamp}`), "every company sees the community links");
must(await a.api("DELETE", `/bookmarks/${bm}`), "delete own");

// --- closing the company
r = await a.api("POST", "/company/closure", { confirm_name: "wrong", reason: "moving" });
check(r.s === 422 && r.j.fields?.confirm_name === "company_name_mismatch", "the company name must be typed again");
must(await a.api("POST", "/company/closure", { confirm_name: A.name, reason: "We are moving to another system" }), "close request");
check(must(await a.api("GET", "/company/closure"), "closure").closure_requested_at, "the request is kept");
const ten = must(await O.api("GET", `/platform/tenants?search=${encodeURIComponent(A.name)}`), "owner list");
const row = (ten.rows ?? ten).find((x) => x.id === A.id);
check(row && row.closure_requested_at && row.closure_reason === "We are moving to another system", "the platform owner sees it on the company's row");
must(await a.api("DELETE", "/company/closure"), "withdraw");
check(!must(await a.api("GET", "/company/closure"), "closure 2").closure_requested_at, "and the company can withdraw it");

// --- print lists
r = await a.api("GET", "/print-lists/riders?cols=");
check(r.s === 422 && r.j.fields?.cols === "choose_columns", "a print list needs a column");
const pl = must(await a.api("GET", "/print-lists/riders?cols=id,full_name,secret_hash,(SELECT 1)&blanks=Amount|Fingerprint"), "print list");
check(pl.cols.join() === "id,full_name" && pl.blanks.join() === "Amount,Fingerprint" && pl.rows.length === 3, "only known columns are used; blank columns are kept by name");
const x = await a.api("GET", "/print-lists/vehicles/export?cols=plate,rider&blanks=Signature&title=Fleet");
check(x.s === 200 && x.type.includes("spreadsheet"), "the list exports to Excel");
check(must(await a.api("GET", "/id-cards"), "cards").length === 3, "ID cards list the working riders");
check(must(await b.api("GET", "/print-lists/riders?cols=id"), "b print").rows.length === 0 && must(await b.api("GET", "/id-cards"), "b cards").length === 0, "another company prints only its own");

console.log(`tools.mjs: ${checks} checks passed`);
