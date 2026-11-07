// Phase 6, company finance and payroll: accounts and balances, built-in categories, entries in and out with the
// category direction, void instead of edit, transfers as a pair, obligations with monthly payments due made ahead,
// paying and voiding a payment, assets, stock that cannot go below zero, a service paid from an account, salary
// rules (the most specific applies), a payroll sheet from performance, fines and advances, finalize / reopen / pay
// with signed proof (fines deducted, instalments repaid, money out recorded), the settlement statement, finance
// closed to the built-in non-admin roles, and isolation between companies.
// Usage, from server/, against a disposable install on port 4100 whose platform owner is admin / Admin12345!:
//   node test/finance.mjs http://localhost:4100
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
    const r = await api("POST", "/auth/login", { username, password, challengeId: ch.id, code: ch.code, replace_oldest: true });
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
const num = (x) => Number(x);
const a = await signup("fin-a"), b = await signup("fin-b");
// the company's calendar day (new companies use Asia/Riyadh), not the UTC one
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date()), month = today.slice(0, 7);
const upload = async (c, entity_type, entity_id, attachment_type) => {
  const fd = new FormData();
  fd.append("entity_type", entity_type); fd.append("entity_id", String(entity_id)); if (attachment_type) fd.append("attachment_type", attachment_type);
  fd.append("file", new Blob(["%PDF-1.4\nsigned"], { type: "application/pdf" }), "proof.pdf");
  return c.api("POST", "/attachments", fd);
};

// --- setup steps, accounts, built-in categories
let o = must(await a.api("GET", "/company-finance/overview"), "overview");
check(o.balance === 0 && o.setup.account === false && o.setup.categories === true && o.setup.entry === false, "a new company starts with the built-in categories and no account");
const cats = must(await a.api("GET", "/fin-categories"), "cats");
const cat = (k) => cats.find((c) => c.builtin_key === k).id;
check(["fuel", "salaries", "rent", "maintenance", "platform_income"].every((k) => cats.some((c) => c.builtin_key === k)), "the built-in categories exist");
const cash = must(await a.api("POST", "/fin-accounts", { name: "Cash box", kind: "cash", opening_balance: 1000 }), "cash").id;
let r = await a.api("POST", "/fin-accounts", { name: "Bank", kind: "bank", iban: "SA0380000000608010167518" });
check(r.s === 422 && r.j.fields?.iban === "iban_invalid", "a bank account's IBAN is checked");
const bank = must(await a.api("POST", "/fin-accounts", { name: "Bank", kind: "bank", bank_name: "Al Rajhi", iban: "SA0380000000608010167519", opening_balance: 50000 }), "bank").id;
check((await a.api("POST", "/fin-accounts", { name: "Bank", kind: "bank" })).j?.fields?.name === "name_taken", "account names are unique");

// --- entries
r = await a.api("POST", "/fin-entries", { direction: "out", account_id: cash, category_id: cat("platform_income"), amount: 10 });
check(r.s === 422 && r.j.fields?.category_id === "category_other_direction", "money out cannot use an income category");
r = await a.api("POST", "/fin-entries", { direction: "out", account_id: cash, amount: 0 });
check(r.s === 422, "an amount must be more than zero");
r = await a.api("POST", "/fin-entries", { direction: "out", account_id: cash, amount: 5, entry_date: "2099-01-01" });
check(r.s === 422 && r.j.fields?.entry_date === "date_in_future", "an entry cannot be in the future");
const sup = must(await a.api("POST", "/fin-suppliers", { name: `Petromin ${stamp}`, vat_number: "300000000000003" }), "supplier").id;
const fuel = must(await a.api("POST", "/fin-entries", { direction: "out", account_id: cash, category_id: cat("fuel"), supplier_id: sup, amount: 150, description: "Fuel week 1" }), "fuel").id;
must(await a.api("POST", "/fin-entries", { direction: "in", account_id: bank, category_id: cat("platform_income"), amount: 20000, reference: "HS-NOV" }), "income");
let acc = must(await a.api("GET", "/fin-accounts"), "accounts");
check(num(acc.find((x) => x.id === cash).balance) === 850 && num(acc.find((x) => x.id === bank).balance) === 70000, "balances are opening plus in minus out");
r = await a.api("PATCH", `/fin-entries/${fuel}`, { amount: 100 });
check(r.s === 422 && r.j.error === "entry_money_fixed", "an entry's amount cannot be edited");
must(await a.api("PATCH", `/fin-entries/${fuel}`, { description: "Fuel week one" }), "edit words");
r = await a.api("POST", `/fin-entries/${fuel}/void`, {});
check(r.s === 422 && r.j.fields?.reason === "required", "voiding needs a reason");
must(await a.api("POST", `/fin-entries/${fuel}/void`, { reason: "wrong amount" }), "void");
acc = must(await a.api("GET", "/fin-accounts"), "accounts 2");
check(num(acc.find((x) => x.id === cash).balance) === 1000, "a voided entry leaves the balance");
check(must(await a.api("GET", "/fin-entries?voided=1"), "voided").rows[0].void_reason === "wrong amount", "and stays in the history with its reason");
check((await a.api("POST", `/fin-entries/${fuel}/void`, { reason: "again" })).j?.error === "entry_voided", "an entry is voided once");
r = await a.api("PATCH", `/fin-accounts/${cash}`, { opening_balance: 5 });
check(r.s === 200, "the opening balance can change while every entry is voided");
must(await a.api("PATCH", `/fin-accounts/${cash}`, { opening_balance: 1000 }), "opening back");

// --- transfers
must(await a.api("POST", "/fin-transfers", { from_account_id: bank, to_account_id: cash, amount: 2000, note: "cash for fuel" }), "transfer");
acc = must(await a.api("GET", "/fin-accounts"), "accounts 3");
check(num(acc.find((x) => x.id === cash).balance) === 3000 && num(acc.find((x) => x.id === bank).balance) === 68000, "a transfer moves money between accounts");
check((await a.api("POST", "/fin-transfers", { from_account_id: bank, to_account_id: bank, amount: 1 })).j?.fields?.to_account_id === "same_account", "not to the same account");
o = must(await a.api("GET", "/company-finance/overview"), "overview 2");
check(o.flow.inflow === 20000 && o.flow.outflow === 0 && o.flow.net === 20000, "the month's flow leaves out transfers and voided entries");
check(o.balance === 71000 && o.setup.account && o.setup.entry, "the company balance is every active account's");
const tr = must(await a.api("GET", "/fin-entries?search=cash for fuel"), "tr").rows[0];
must(await a.api("POST", `/fin-entries/${tr.id}/void`, { reason: "mistake" }), "void transfer");
acc = must(await a.api("GET", "/fin-accounts"), "accounts 4");
check(num(acc.find((x) => x.id === cash).balance) === 1000 && num(acc.find((x) => x.id === bank).balance) === 70000, "voiding one side voids the pair");

// --- obligations
const start = `${month}-01`;
const ob = must(await a.api("POST", "/fin-obligations", { title: `Office rent ${stamp}`, kind: "monthly", amount: 3000, start_date: "2026-01-05", supplier_id: sup, category_id: cat("rent") }), "rent").id;
r = await a.api("POST", "/fin-obligations", { title: "x", kind: "once", amount: 10, start_date: today, category_id: cat("platform_income") });
check(r.s === 422 && r.j.fields?.category_id === "category_other_direction", "an obligation uses an expense category");
let dues = must(await a.api("GET", "/fin-dues?status=all"), "dues").filter((d) => d.obligation_id === ob);
check(dues.length >= 10 && dues[0].due_date.startsWith("2026-01-05"), "a monthly obligation makes a payment due every month from its start");
let sum = must(await a.api("GET", "/fin-obligations"), "obl").summary;
check(sum.overdue_count >= 9 && sum.overdue >= 27000, "the past ones are overdue");
must(await a.api("POST", `/fin-dues/${dues[0].id}/pay`, { account_id: bank, reference: "TR-55" }), "pay due");
check((await a.api("POST", `/fin-dues/${dues[0].id}/pay`, { account_id: bank })).j?.error === "due_closed", "a payment is paid once");
const paidEntry = must(await a.api("GET", "/fin-entries?search=Office rent"), "rent entry").rows[0];
check(num(paidEntry.amount) === 3000 && paidEntry.source_type === "obligation_due" && paidEntry.supplier_id === sup, "paying writes the money-out entry");
must(await a.api("POST", `/fin-entries/${paidEntry.id}/void`, { reason: "paid twice by mistake" }), "void rent");
check(must(await a.api("GET", "/fin-dues?status=all"), "dues 2").find((d) => d.id === dues[0].id).status === "due", "voiding the payment makes the due unpaid again");
must(await a.api("POST", `/fin-dues/${dues[1].id}/skip`), "skip");
check((await a.api("DELETE", `/fin-obligations/${ob}`)).s === 200, "an obligation with no payment made can be deleted");
const once = must(await a.api("POST", "/fin-obligations", { title: `Insurance ${stamp}`, kind: "once", amount: 1200, start_date: start }), "once").id;
const onceDues = must(await a.api("GET", "/fin-dues?status=all"), "d3").filter((d) => d.obligation_id === once);
check(onceDues.length === 1, "a one-off bill has one payment due");

// --- assets and stock
must(await a.api("POST", "/fin-assets", { name: "Honda Wave", category: "motorcycle", value: 7000, purchase_date: "2026-02-01" }), "asset");
const as2 = must(await a.api("POST", "/fin-assets", { name: "Old helmet rack", value: 500 }), "asset 2").id;
must(await a.api("PATCH", `/fin-assets/${as2}`, { status: "disposed" }), "dispose");
const assets = must(await a.api("GET", "/fin-assets"), "assets");
check(assets.total === 7000 && assets.rows.find((x) => x.id === as2).disposed_on, "the assets value counts those in use; a disposed one gets its date");
const item = must(await a.api("POST", "/fin-stock", { name: `Helmet ${stamp}`, unit: "pcs", min_quantity: 2 }), "item").id;
must(await a.api("POST", `/fin-stock/${item}/moves`, { direction: "in", quantity: 5, unit_cost: 80 }), "in 5");
r = await a.api("POST", `/fin-stock/${item}/moves`, { direction: "out", quantity: 6 });
check(r.s === 422 && r.j.fields?.quantity === "not_enough_stock" && r.j.params?.have === 5, "nothing goes out that is not in stock");
const rid = 9100000 + Math.floor(Math.random() * 800000);
must(await a.api("POST", "/riders", { id: rid, full_name: "Payroll Rider One" }), "rider");
must(await a.api("POST", `/fin-stock/${item}/moves`, { direction: "out", quantity: 4, rider_id: rid, note: "new hire" }), "out 4");
const stock = must(await a.api("GET", "/fin-stock"), "stock").find((x) => x.id === item);
check(num(stock.quantity) === 1, "the quantity is in minus out");
check(must(await a.api("GET", `/fin-stock/${item}/moves`), "moves").rows[0].rider_name === "Payroll Rider One", "a move out can name the rider it went to");

// --- a service paid from an account
const v1 = must(await a.api("POST", "/vehicles", { plate: `ف ن ك ${stamp.slice(-4)}`, vehicle_type: "motorcycle" }), "vehicle").id;
const sv = must(await a.api("POST", "/vehicle-services", { vehicle_id: v1, service_type: "repair", start: true }), "service").id;
must(await a.api("POST", `/vehicle-services/${sv}/complete`, { cost: 300 }), "complete");
must(await a.api("POST", `/vehicle-services/${sv}/pay`, { amount: 300, account_id: cash }), "pay service");
const se = must(await a.api("GET", "/fin-entries?search=service"), "service entry").rows.find((x) => x.source_type === "service");
check(se && num(se.amount) === 300 && se.category_id === cat("maintenance"), "paying a service from an account writes the entry under Maintenance");

// --- payroll: rules, a sheet, pay
const main = must(await a.api("GET", "/branches"), "branches").rows[0].id;
const general = must(await a.api("POST", "/salary-rules", { name: `General ${stamp}`, base_salary: 1000, per_order: 5 }), "rule general").id;
const branchRule = must(await a.api("POST", "/salary-rules", { name: `Main ${stamp}`, branch_id: main, base_salary: 1500, per_order: 6, target_orders: 10, target_bonus: 200 }), "rule branch").id;
for (const [d, n] of [[`${month}-01`, 6], [`${month}-02`, 5]]) must(await a.api("POST", "/performance", { rider_id: rid, work_date: d, completed: n }), "perf");
const fd = new FormData();
fd.append("file", new Blob([`Rider id,Date,Category,Amount,Invoice\n${rid},${month}-01,Speeding,100,F-${stamp}\n`], { type: "text/csv" }), "fines.csv");
fd.append("mode", "skip");
must(await a.api("POST", "/finance/fines/import/run", { token: must(await a.api("POST", "/finance/fines/import/preview", fd), "fines preview").token }), "fines run");
const adv = must(await a.api("POST", "/advances", { rider_id: rid, amount: 600, installments: 2, first_due: `${month}-01`, deduct_from: "salary" }), "advance").id;
must(await a.api("POST", `/advances/${adv}/approve`, {}), "approve");
must(await a.api("POST", `/advances/${adv}/disburse`, { method: "cash" }), "disburse");
r = await a.api("POST", "/payroll", { period: "2099-01" });
check(r.s === 422 && r.j.fields?.period === "date_in_future", "no sheet for a future month");
const sh = must(await a.api("POST", "/payroll", { period: month }), "sheet").id;
check((await a.api("POST", "/payroll", { period: month, branch_id: main })).j?.error === "sheet_exists", "a branch sheet cannot overlap the all-branches one");
let s = must(await a.api("GET", `/payroll/${sh}`), "sheet get");
let line = s.lines.find((l) => l.rider_id === rid);
check(line && line.rule_id === branchRule, "the most specific rule applies (the branch one)");
check(line.orders === 11 && num(line.base) === 1500 && num(line.orders_pay) === 66 && num(line.bonus) === 200, "base, orders × rate and the target bonus");
check(num(line.fines) === 100 && num(line.advances) === 300 && num(line.net) === 1366, "less the month's open fines and the instalment due");
must(await a.api("PATCH", `/payroll-lines/${line.id}`, { addition: 50, note: "fuel allowance" }), "line edit");
must(await a.api("POST", "/performance", { rider_id: rid, work_date: `${month}-03`, completed: 4 }), "more perf");
must(await a.api("POST", `/payroll/${sh}/recalculate`), "recalc");
line = must(await a.api("GET", `/payroll/${sh}`), "sheet 2").lines.find((l) => l.rider_id === rid);
check(line.orders === 15 && num(line.addition) === 50 && line.note === "fuel allowance" && num(line.net) === 1500 + 90 + 200 + 50 - 100 - 300, "recalculating follows the data and keeps the hand-typed lines");
must(await a.api("PATCH", `/salary-rules/${branchRule}`, { is_active: false }), "rule off");
must(await a.api("POST", `/payroll/${sh}/recalculate`), "recalc 2");
check(must(await a.api("GET", `/payroll/${sh}`), "s3").lines.find((l) => l.rider_id === rid).rule_id === general, "with the branch rule off, the general one applies");
must(await a.api("PATCH", `/salary-rules/${branchRule}`, { is_active: true }), "rule on");
must(await a.api("POST", `/payroll/${sh}/recalculate`), "recalc 3");
check((await a.api("POST", `/payroll/${sh}/pay`, { account_id: bank })).j?.error === "sheet_not_finalized", "a draft cannot be paid");
must(await a.api("POST", `/payroll/${sh}/finalize`), "finalize");
check((await a.api("PATCH", `/payroll-lines/${line.id}`, { addition: 1 })).j?.error === "sheet_locked", "a finalized sheet is locked");
must(await a.api("POST", `/payroll/${sh}/reopen`), "reopen");
must(await a.api("POST", `/payroll/${sh}/finalize`), "finalize 2");
check((await a.api("POST", `/payroll/${sh}/pay`, { account_id: bank })).j?.error === "proof_required", "paying needs the signed proof");
must(await upload(a, "payroll_sheet", sh, "proof"), "proof");
s = must(await a.api("GET", `/payroll/${sh}`), "sheet 4");
must(await a.api("POST", `/payroll/${sh}/pay`, { account_id: bank }), "pay sheet");
s = must(await a.api("GET", `/payroll/${sh}`), "sheet paid");
check(s.status === "paid" && s.entry_id, "the sheet is paid");
check((await a.api("POST", `/payroll/${sh}/reopen`)).j?.error === "sheet_paid", "a paid sheet cannot be reopened");
const pe = must(await a.api("GET", "/fin-entries?search=payroll"), "pay entry").rows.find((x) => x.source_type === "payroll");
check(pe && num(pe.amount) === num(s.total_net) && pe.category_id === cat("salaries"), "one money-out entry for the sheet, under Salaries");
check((await a.api("POST", `/fin-entries/${pe.id}/void`, { reason: "x" })).j?.error === "entry_from_payroll", "a payroll entry is not voided by hand");
const advNow = must(await a.api("GET", `/advances/${adv}`), "advance after");
check(advNow.status === "repaying", "the instalment taken is repaid");
const paidHist = must(await a.api("GET", "/payroll?status=paid"), "paid history");
check(paidHist.length === 1 && paidHist[0].proofs === 1, "the paid history lists the sheet with its proof");
const stl = must(await a.api("GET", `/riders/${rid}/settlement`), "settlement");
check(stl.payroll.length === 1 && stl.advances.length === 1 && num(stl.advances[0].remaining) === 300 && stl.fines.length === 0 && stl.owed === 300, "the settlement shows the pay and what is still owed");

// --- finance is closed to non-admin built-in roles
const roles = must(await a.api("GET", "/roles"), "roles");
const fleetRole = (roles.rows ?? roles).find((x) => x.name === "Fleet Manager");
must(await a.api("POST", "/users", { username: `fm-${stamp}`, full_name: "FM", email: `fm-${stamp}@example.com`, role_id: fleetRole.id, password: "Passw0rd!x12", confirm: "Passw0rd!x12" }), "fleet user");
const fm = client(); await fm.login(`fm-${stamp}`, "Passw0rd!x12");
for (const p of ["/fin-accounts", "/fin-entries", "/payroll", "/salary-rules", "/fin-obligations"]) check((await fm.api("GET", p)).s === 403, `a Fleet Manager cannot open ${p}`);

// --- another company sees nothing
check(must(await b.api("GET", "/fin-accounts"), "b acc").length === 0, "another company has no accounts");
check(must(await b.api("GET", "/fin-entries"), "b entries").total === 0, "nor entries");
check(must(await b.api("GET", "/payroll"), "b pay").length === 0, "nor sheets");
check((await b.api("GET", `/payroll/${sh}`)).s === 404, "and cannot open A's sheet");
check((await b.api("POST", `/fin-entries/${pe.id}/void`, { reason: "x" })).s === 404, "nor void A's entry");
check((await b.api("POST", "/fin-entries", { direction: "out", account_id: cash, amount: 1 })).j?.fields?.account_id === "invalid", "nor use A's account");
check((await b.api("GET", `/riders/${rid}/settlement`)).s === 404, "nor see A's rider's settlement");
const bo = must(await b.api("GET", "/company-finance/overview"), "b overview");
check(bo.balance === 0 && bo.dues.overdue_count === 0, "its overview is its own");

console.log(`finance.mjs: ${checks} checks passed`);
