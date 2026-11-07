// Phase 2, branches and job titles: defaults every company gets, plan limits (custom titles only), the main-branch
// and built-in rules, "in use" deletes, riders and vehicles getting a branch from every path, filters, imports,
// bulk moves, the audit trail, and that one company can never see or use another company's branches.
// Usage, from server/, against a disposable install on port 4100 whose platform owner is admin / Admin12345!:
//   node test/branches.mjs http://localhost:4100
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

const O = client();
await O.login("admin", "Admin12345!");
const signup = async (tag) => {
  const c = client(), email = `${tag}-${stamp}@example.com`;
  must(await c.api("POST", "/public/signup", { company_name: `${tag} ${stamp}`, full_name: "Owner", email, phone: "0500000000", password: "Passw0rd!x", confirm: "Passw0rd!x" }), "signup " + tag);
  await c.login(email, "Passw0rd!x");
  return { c, id: must(await c.api("GET", "/me"), "me").company.id };
};
const A = await signup("branches-a"), B = await signup("branches-b");
const a = A.c, b = B.c;

// --- every new company starts with its main branch and the built-in titles
let br = must(await a.api("GET", "/branches"), "branches");
const main = br.rows[0];
check(br.total === 1 && main.is_default === 1 && main.name_en === "Main branch", "a new company has one main branch");
const ds = must(await a.api("GET", "/designations"), "designations");
const driver = ds.rows.find((d) => d.builtin_key === "driver"), supervisor = ds.rows.find((d) => d.builtin_key === "supervisor");
check(ds.total === 2 && driver && supervisor, "and the built-in titles Driver and Supervisor");
let use = must(await a.api("GET", "/plan/usage"), "usage");
check(use.usage.branches === 1 && use.usage.designations === 0, "the main branch counts, the built-in titles do not");
check(use.limits.branches === 2 && use.limits.designations === 2, "the trial plan (Starter) allows 2 branches and 2 custom titles");

// --- plan limits through the plan engine
const jeddah = must(await a.api("POST", "/branches", { name_ar: `جدة ${stamp}`, name_en: `Jeddah ${stamp}` }), "branch 2").id;
let r = await a.api("POST", "/branches", { name_ar: `الدمام ${stamp}` });
check(r.s === 402 && r.j.error === "plan_limit_reached" && r.j.params?.kind === "branches", "a third branch is over the plan's limit");
r = await a.api("POST", "/branches", { name_ar: main.name_ar });
check(r.s === 422 && r.j.fields?.name_ar === "name_taken", "branch names are unique in the company");
const t1 = must(await a.api("POST", "/designations", { name_ar: `منسق ${stamp}`, name_en: "Coordinator" }), "title 1").id;
must(await a.api("POST", "/designations", { name_ar: `محاسب ${stamp}` }), "title 2");
r = await a.api("POST", "/designations", { name_ar: `ثالث ${stamp}` });
check(r.s === 402 && r.j.params?.kind === "designations", "a third custom title is over the plan's limit");

// --- the main branch and the built-in titles stay
check((await a.api("POST", `/branches/${main.id}/deactivate`)).j?.error === "branch_is_default", "the main branch cannot be switched off");
check((await a.api("DELETE", `/branches/${main.id}`)).j?.error === "branch_is_default", "nor deleted");
check((await a.api("POST", `/designations/${driver.id}/deactivate`)).j?.error === "designation_builtin", "a built-in title cannot be switched off");
check((await a.api("DELETE", `/designations/${supervisor.id}`)).j?.error === "designation_builtin", "nor deleted");
must(await a.api("PATCH", `/designations/${driver.id}`, { name_en: "Delivery driver" }), "rename a built-in title");
check(must(await a.api("GET", `/designations/${driver.id}`), "title").name_en === "Delivery driver", "but it can be renamed");

// --- riders and vehicles: the defaults when none is given, the chosen one otherwise
const rid = 7_100_000 + Math.floor(Math.random() * 90_000);
must(await a.api("POST", "/riders", { id: rid, full_name: "Branch Rider One" }), "rider without branch");
let rider = must(await a.api("GET", `/riders/${rid}`), "rider");
check(rider.branch_id === main.id && rider.designation_id === driver.id, "a rider added without a branch gets the main branch and Driver");
must(await a.api("POST", "/riders", { id: rid + 1, full_name: "Branch Rider Two", branch_id: jeddah, designation_id: t1 }), "rider in Jeddah");
rider = must(await a.api("GET", `/riders/${rid + 1}`), "rider 2");
check(rider.branch_id === jeddah && rider.designation_en === "Coordinator", "a rider keeps the branch and title given");
const veh = must(await a.api("POST", "/vehicles", { plate: `ب ر ${stamp.slice(-4)}`, vehicle_type: "car" }), "vehicle").id;
check(must(await a.api("GET", `/vehicles/${veh}`), "vehicle").branch_id === main.id, "a vehicle added without a branch gets the main branch");

// --- filters
let list = must(await a.api("GET", `/riders?branch=${jeddah}`), "riders by branch");
check(list.total === 1 && list.rows[0].id === rid + 1, "the riders list filters by branch");
check(must(await a.api("GET", `/riders?designation=${driver.id}`), "riders by title").rows.every((x) => x.designation_id === driver.id), "and by job title");
check(must(await a.api("GET", `/vehicles?branch=${jeddah}`), "vehicles by branch").total === 0, "the vehicles list filters by branch");
check((await a.api("GET", `/advances?branch=${jeddah}`)).s === 200 && (await a.api("GET", `/performance?branch=${jeddah}`)).s === 200, "advances and daily performance take the branch filter");
check(must(await a.api("GET", `/reports/riders?branch=${jeddah}`), "report").rows.length === 1, "reports take the branch filter");

// --- bulk moves
must(await a.api("POST", "/vehicles/bulk-branch", { ids: [veh], branch_id: jeddah }), "move vehicle");
check(must(await a.api("GET", `/vehicles?branch=${jeddah}`), "vehicles").total === 1, "vehicles move to another branch in bulk");
must(await a.api("POST", "/riders/bulk-edit", { ids: [rid], changes: { designation_id: supervisor.id } }), "bulk title");
check(must(await a.api("GET", `/riders/${rid}`), "rider").designation_id === supervisor.id, "riders get a job title in bulk");

// --- in use: switched off, not deleted; a switched-off branch is not given to records
r = await a.api("DELETE", `/branches/${jeddah}`);
check(r.s === 409 && r.j.error === "branch_in_use" && r.j.params.riders === 1 && r.j.params.vehicles === 1, "a branch in use cannot be deleted, and says what uses it");
must(await a.api("POST", `/branches/${jeddah}/deactivate`), "switch off Jeddah");
r = await a.api("PATCH", `/riders/${rid}`, { branch_id: jeddah });
check(r.s === 422 && r.j.fields?.branch_id === "branch_unavailable", "a switched-off branch is not given to a record");
r = await a.api("PATCH", `/riders/${rid}`, { branch_id: "", designation_id: "" });
check(r.s === 422 && r.j.fields?.branch_id === "required", "an edit cannot leave a rider without a branch");
check((await a.api("PATCH", `/vehicles/${veh}`, { branch_id: "" })).j?.fields?.branch_id === "required", "nor a vehicle");
must(await a.api("PATCH", `/riders/${rid + 1}`, { branch_id: jeddah, alias: "keeps it" }), "keeps its own branch");
check(must(await a.api("GET", `/riders/${rid + 1}`), "r2").branch_id === jeddah, "a record keeps a branch that was switched off since");
check(!must(await a.api("GET", "/lookups/branches"), "lookups").some((x) => x.id === jeddah), "the pickers leave out switched-off branches");
const dammam = must(await a.api("POST", "/branches", { name_ar: `الدمام ${stamp}` }), "branch while one is off").id;
r = await a.api("POST", `/branches/${jeddah}/activate`);
check(r.s === 402 && r.j.params?.kind === "branches", "switching a branch back on takes a plan place again");

// --- the main branch moves
must(await a.api("POST", `/branches/${dammam}/make-default`), "make Dammam main");
br = must(await a.api("GET", "/branches"), "branches");
check(br.rows.filter((x) => x.is_default).length === 1 && br.rows.find((x) => x.is_default).id === dammam, "exactly one main branch after the change");
check((await a.api("POST", `/branches/${jeddah}/make-default`)).j?.error === "branch_inactive", "a switched-off branch cannot become the main one");
must(await a.api("POST", "/riders", { id: rid + 2, full_name: "Branch Rider Three" }), "rider 3");
check(must(await a.api("GET", `/riders/${rid + 2}`), "r3").branch_id === dammam, "new records go to the new main branch");

// --- imports: branches and titles by name; an unknown one is a row error, never created
const fd = new FormData();
fd.append("file", new Blob([`Rider id,Full name,Branch,Job title\n${rid + 3},Imported Four,الدمام ${stamp},Coordinator\n${rid + 4},Imported Five,Nowhere ${stamp},\n${rid + 5},Imported Six,,\n`], { type: "text/csv" }), "riders.csv");
fd.append("mode", "skip");
const pv = must(await a.api("POST", "/riders/import/preview", fd), "import preview");
check(pv.problems === 1 && pv.problemList[0].reason === "unknown_branch", "an unknown branch name is a row error");
must(await a.api("POST", "/riders/import/run", { token: pv.token }), "import run");
const i4 = must(await a.api("GET", `/riders/${rid + 3}`), "imported 4"), i6 = must(await a.api("GET", `/riders/${rid + 5}`), "imported 6");
check(i4.branch_id === dammam && i4.designation_id === t1, "an imported rider takes the branch and title named in the file");
check(i6.branch_id === dammam && i6.designation_id === driver.id, "and the defaults when the cells are empty");
check(must(await a.api("GET", "/branches"), "branches").total === 3, "the import created no branch");

// --- the change of plan sees the branches
const qaPlan = `qa_br_${stamp}`.slice(0, 28);
must(await O.api("PUT", `/platform/plans/${qaPlan}`, { name_ar: "فرع", name_en: "One branch", price_monthly: 10, max_riders: 100, max_users: 5, max_vehicles: 100, max_platforms: 5, max_contracts: 5, max_branches: 1, max_designations: 0, max_devices: 2, features: [], is_public: 1, is_active: 1, sort: 1 }), "qa plan");
r = await a.api("POST", "/billing/request", { plan_key: qaPlan, billing_cycle: "monthly" });
check(r.s >= 400 && r.j.error === "plan_too_small" && r.j.params.kinds.includes("branches") && r.j.params.kinds.includes("designations"), "a plan with fewer branches or titles than in use is refused");
// on Free (after the plan ends): what exists keeps working, nothing new
// the test plan leaves the public list again, so later scripts see the standard plans only
must(await O.api("PUT", `/platform/plans/${qaPlan}`, { name_ar: "فرع", name_en: "One branch", price_monthly: 10, max_riders: 100, max_users: 5, max_vehicles: 100, max_platforms: 5, max_contracts: 5, max_branches: 1, max_designations: 0, max_devices: 2, features: [], is_public: 0, is_active: 1, sort: 9 }), "hide qa plan");
must(await O.api("PATCH", `/platform/tenants/${A.id}`, { plan_key: "free" }), "A on Free");
check((await a.api("POST", "/branches", { name_ar: `جديد ${stamp}` })).j?.params?.kind === "branches", "on Free no branch can be added above the limit");
check((await a.api("GET", `/riders?branch=${jeddah}`)).s === 200 && (await a.api("PATCH", `/riders/${rid}`, { alias: "still works" })).s === 200, "but existing branches and records keep working");

// --- the audit trail
const audit = must(await a.api("GET", "/logs/audit?search=branch"), "audit").rows.map((x) => x.action);
for (const act of ["branch.create", "branch.deactivate", "branch.default"]) check(audit.includes(act), `audit has ${act}`);

// --- one company never sees or uses another's branches and titles
check((await b.api("GET", `/branches/${jeddah}`)).s === 404, "B cannot read A's branch");
check((await b.api("PATCH", `/branches/${dammam}`, { name_en: "x" })).s === 404, "nor edit it");
check((await b.api("DELETE", `/designations/${t1}`)).s === 404, "nor delete A's title");
check((await b.api("POST", `/branches/${dammam}/make-default`)).s === 404, "nor make it B's main branch");
const bBranches = must(await b.api("GET", "/lookups/branches"), "B lookups");
check(bBranches.length === 1 && !bBranches.some((x) => [jeddah, dammam, main.id].includes(x.id)), "B's pickers show only B's main branch");
r = await b.api("POST", "/riders", { id: rid + 50, full_name: "B rider", branch_id: dammam });
check(r.s === 422 && r.j.fields?.branch_id === "branch_unavailable", "B cannot put a rider in A's branch");
r = await b.api("POST", "/riders", { id: rid + 51, full_name: "B rider", designation_id: t1 });
check(r.s === 422 && r.j.fields?.designation_id === "designation_unavailable", "nor give A's title");
const bVeh = must(await b.api("POST", "/vehicles", { plate: `ج ج ${stamp.slice(-4)}`, vehicle_type: "car" }), "B vehicle").id;
check((await b.api("POST", "/vehicles/bulk-branch", { ids: [bVeh], branch_id: dammam })).j?.fields?.branch_id === "branch_unavailable", "nor move vehicles to it");
check((await b.api("POST", "/vehicles/bulk-branch", { ids: [veh], branch_id: bBranches[0].id })).j?.updated === 0, "nor move A's vehicles to its own branch");
check(must(await b.api("GET", `/riders?branch=${dammam}`), "B filter").total === 0, "filtering by A's branch shows B nothing");

console.log(`BRANCH CHECKS PASSED: ${checks}`);
