// Phase 7, tax invoices: buyers with a valid VAT number, drafts and their totals, the open-drafts limit of the plan,
// issuing (number, counter, UUID, the hash chain starting from ZATCA's first value, the hash of the XML, the QR with
// seller, VAT number, time, total and VAT), issued invoices that never change, credit notes, the sandbox signing on a
// plan with ZATCA phase 2 (hash, signature and public key in the QR, a signature that verifies), the plan gate, and
// isolation between companies.
// Usage, from server/, against a disposable install on port 4100 whose platform owner is admin / Admin12345!:
//   node test/invoices.mjs http://localhost:4100
import assert from "node:assert/strict";
import { createHash, createPublicKey, verify } from "node:crypto";

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
const readTlv = (b64) => { const b = Buffer.from(b64, "base64"); const out = {}; for (let i = 0; i < b.length;) { out[b[i]] = b.subarray(i + 2, i + 2 + b[i + 1]); i += 2 + b[i + 1]; } return out; };
const signup = async (tag) => {
  const c = client(), email = `${tag}-${stamp}@example.com`;
  must(await c.api("POST", "/public/signup", { company_name: `${tag} ${stamp}`, full_name: "Owner", email, phone: "0500000000", password: "Passw0rd!x", confirm: "Passw0rd!x" }), "signup " + tag);
  await c.login(email, "Passw0rd!x");
  return { c, id: must(await c.api("GET", "/me"), "me").company.id };
};
const O = client(); await O.login("admin", "Admin12345!");
const A = await signup("inv-a"), B = await signup("inv-b");
const a = A.c, b = B.c;
const SELLER_VAT = "300000000000003", BUYER_VAT = "311111111111113";

// --- buyers
let r = await a.api("POST", "/invoice-buyers", { name: "Bad VAT", vat_number: "123" });
check(r.s === 422 && r.j.fields?.vat_number === "vat_invalid", "a VAT number is 15 digits starting and ending with 3");
const hs = must(await a.api("POST", "/companies", { name: `HungerStation ${stamp}` }), "platform").id;
const k1 = must(await a.api("POST", "/contracts", { company_id: hs, name: `Tabuk ${stamp}` }), "contract").id;
const buyer = must(await a.api("POST", "/invoice-buyers", { name: `HungerStation LLC ${stamp}`, vat_number: BUYER_VAT, cr_number: "1010101010", address: "Olaya St", city: "Riyadh", postal_code: "12211", company_id: hs }), "buyer").id;
const noVat = must(await a.api("POST", "/invoice-buyers", { name: `No VAT buyer ${stamp}` }), "buyer 2").id;

// --- drafts and totals
r = await a.api("POST", "/invoices", { buyer_id: buyer, lines: [{ description: "x", quantity: 0, unit_price: 1 }] });
check(r.s === 422 && r.j.fields?.quantity === "too_small", "a line's quantity is more than zero");
const i1 = must(await a.api("POST", "/invoices", { buyer_id: buyer, contract_id: k1, supply_from: "2026-10-01", supply_to: "2026-10-31",
  lines: [{ description: "Delivery services October", quantity: 1, unit_price: 10000 }, { description: "Fuel allowance", quantity: 3, unit_price: 33.335, vat_rate: 15 }] }), "draft").id;
let inv = must(await a.api("GET", `/invoices/${i1}`), "get draft");
check(inv.status === "draft" && inv.number === null && Number(inv.subtotal) === 10100.02 && Number(inv.vat_total) === 1515 && Number(inv.total) === 11615.02, "prices and lines are rounded to halalas and the totals add them");
r = await a.api("PATCH", `/invoices/${i1}`, { supply_to: "2026-09-01" });
check(r.s === 422 && r.j.fields?.supply_to === "end_before_start", "the supply period is in order");

// --- issuing needs the seller's details
r = await a.api("POST", `/invoices/${i1}/issue`);
check(r.s === 409 && ["seller_name_missing", "seller_vat_invalid"].includes(r.j.error), "the seller's name and VAT number are needed");
must(await a.api("PATCH", "/settings/organization", { name: `Himmat Logistics ${stamp}`, tax_number: SELLER_VAT, cr_number: "7000000001", address: "Tabuk" }), "org");
const d2 = must(await a.api("POST", "/invoices", { buyer_id: noVat, lines: [{ description: "x", quantity: 1, unit_price: 10 }] }), "no vat draft").id;
check((await a.api("POST", `/invoices/${d2}/issue`)).j?.error === "buyer_vat_invalid", "a tax invoice needs the buyer's VAT number");
check((await a.api("POST", `/invoices/${must(await a.api("POST", "/invoices", { buyer_id: buyer }), "empty").id}/issue`)).j?.error === "invoice_no_lines", "an invoice without lines cannot be issued");

// --- the open-drafts limit (Starter: 5)
const usage = must(await a.api("GET", "/plan/usage"), "usage");
check(usage.usage.open_invoice_drafts === 3 && usage.limits.open_invoice_drafts === 5 && usage.usage.invoice_buyers === 2, "drafts and buyers are counted against the plan");
must(await a.api("POST", "/invoices", { buyer_id: buyer }), "draft 4");
must(await a.api("POST", "/invoices", { buyer_id: buyer }), "draft 5");
r = await a.api("POST", "/invoices", { buyer_id: buyer });
check(r.s === 402 && r.j.error === "plan_limit_reached" && r.j.params?.kind === "open_invoice_drafts", "a sixth open draft is over the plan's limit");

// --- issue: number, counter, chain, hash, QR
const iss = must(await a.api("POST", `/invoices/${i1}/issue`), "issue");
inv = must(await a.api("GET", `/invoices/${i1}`), "issued");
const year = inv.issue_date.slice(0, 4);
check(inv.status === "issued" && inv.number === `INV-${year}-00001` && inv.icv === 1 && /^[0-9a-f-]{36}$/.test(inv.uuid) && iss.number === inv.number, "the first invoice is number 1, counter 1, with a UUID");
check(inv.pih === "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==", "the first one chains to ZATCA's starting value");
const xml1 = await a.api("GET", `/invoices/${i1}/xml`);
check(xml1.type.includes("application/xml") && xml1.text.includes("<cbc:InvoiceTypeCode name=\"0100000\">388</cbc:InvoiceTypeCode>") && xml1.text.includes(BUYER_VAT) && xml1.text.includes(SELLER_VAT), "the UBL XML is a tax invoice with both VAT numbers");
check(createHash("sha256").update(xml1.text, "utf8").digest("base64") === inv.invoice_hash, "the stored hash is the hash of its XML");
let qr = readTlv(inv.qr);
check(qr[1].toString() === `Himmat Logistics ${stamp}` && qr[2].toString() === SELLER_VAT && qr[4].toString() === "11615.02" && qr[5].toString() === "1515.00" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(qr[3].toString()), "the QR holds seller, VAT number, time, total and VAT");
check(!qr[6] && inv.zatca_status === "none", "without the sandbox, no signature");
check((await a.api("PATCH", `/invoices/${i1}`, { notes: "x" })).j?.error === "invoice_not_draft", "an issued invoice never changes");
check((await a.api("DELETE", `/invoices/${i1}`)).j?.error === "invoice_not_draft", "nor is deleted");
check(must(await a.api("GET", "/plan/usage"), "u2").usage.invoices_month === 1, "the invoice counts in the month");

// --- the sandbox is gated by the plan
r = await a.api("PUT", "/invoices-zatca", { mode: "sandbox" });
check(r.s === 402 && r.j.error === "feature_locked", "the ZATCA sandbox is not on Starter");
must(await O.api("PATCH", `/platform/tenants/${A.id}`, { plan_key: "scale", status: "active", period_ends_at: "2030-01-01" }), "A on Scale");
must(await a.api("PUT", "/invoices-zatca", { mode: "sandbox" }), "sandbox on");
check(must(await a.api("GET", "/invoices-zatca"), "z").mode === "sandbox", "the sandbox is on");
const i2 = must(await a.api("POST", "/invoices", { buyer_id: buyer, lines: [{ description: "Delivery services November", quantity: 2, unit_price: 500 }] }), "draft 2").id;
must(await a.api("POST", `/invoices/${i2}/issue`), "issue 2");
const inv2 = must(await a.api("GET", `/invoices/${i2}`), "issued 2");
check(inv2.number === `INV-${year}-00002` && inv2.icv === 2 && inv2.pih === inv.invoice_hash, "the next invoice chains to the one before");
qr = readTlv(inv2.qr);
check(inv2.zatca_status === "sandbox_signed" && qr[6].toString() === inv2.invoice_hash && qr[7] && qr[8], "the sandbox QR carries the hash, the signature and the public key");
const pub = createPublicKey({ key: qr[8], format: "der", type: "spki" });
check(verify("sha256", Buffer.from(inv2.invoice_hash, "utf8"), pub, Buffer.from(qr[7].toString(), "base64")), "the signature verifies with the public key");

// --- credit note
r = await a.api("POST", `/invoices/${i1}/credit`, {});
check(r.s === 422 && r.j.fields?.reason === "required", "a credit note needs a reason");
const cn = must(await a.api("POST", `/invoices/${i1}/credit`, { reason: "Wrong month billed" }), "credit").id;
const c1 = must(await a.api("GET", `/invoices/${cn}`), "credit note");
check(c1.kind === "credit" && c1.status === "issued" && c1.number === `CN-${year}-00001` && c1.icv === 3 && c1.pih === inv2.invoice_hash && Number(c1.total) === 11615.02, "a credit note is numbered on its own, in the same chain, for the same total");
check(must(await a.api("GET", `/invoices/${i1}`), "orig").status === "credited", "the original is credited");
const xmlc = await a.api("GET", `/invoices/${cn}/xml`);
check(xmlc.text.includes(">381</cbc:InvoiceTypeCode>") && xmlc.text.includes(`<cbc:ID>INV-${year}-00001</cbc:ID>`) && xmlc.text.includes("Wrong month billed"), "its XML is type 381 and names the invoice it corrects");
check((await a.api("POST", `/invoices/${i1}/credit`, { reason: "again" })).j?.error === "invoice_not_creditable", "an invoice is credited once");
check((await a.api("GET", `/invoices/${d2}/xml`)).j?.error === "invoice_not_issued", "a draft has no XML");
const list = must(await a.api("GET", "/invoices"), "list");
check(Number(list.stats.invoiced) === Number(inv.total) + Number(inv2.total) && Number(list.stats.credits) === 11615.02, "the totals of invoices and credit notes");

// --- audit
const au = must(await a.api("GET", "/logs/audit?search=invoice&pageSize=100"), "audit").rows.map((x) => x.action);
for (const act of ["invoice.create", "invoice.issue", "invoice.credit", "invoice.zatca_mode", "invoice_buyer.create"]) check(au.includes(act), `audit has ${act}`);

// --- another company sees nothing and uses nothing
check(must(await b.api("GET", "/invoices"), "b list").total === 0, "another company's list is empty");
check((await b.api("GET", `/invoices/${i1}`)).s === 404 && (await b.api("GET", `/invoices/${i1}/xml`)).s === 404, "it cannot read A's invoice or XML");
check((await b.api("POST", `/invoices/${i1}/credit`, { reason: "x" })).s === 404, "nor credit it");
check((await b.api("POST", "/invoices", { buyer_id: buyer })).j?.fields?.buyer_id === "invalid", "nor use A's buyer");
must(await b.api("PATCH", "/settings/organization", { name: `B Co ${stamp}`, tax_number: "399999999999993" }), "b org");
const bb = must(await b.api("POST", "/invoice-buyers", { name: `B buyer ${stamp}`, vat_number: BUYER_VAT }), "b buyer").id;
const bi = must(await b.api("POST", "/invoices", { buyer_id: bb, lines: [{ description: "x", quantity: 1, unit_price: 1 }] }), "b inv").id;
must(await b.api("POST", `/invoices/${bi}/issue`), "b issue");
const binv = must(await b.api("GET", `/invoices/${bi}`), "b issued");
check(binv.icv === 1 && binv.number.endsWith("-00001") && binv.pih.startsWith("NWZlY2Vi"), "each company has its own counter and chain");

console.log(`invoices.mjs: ${checks} checks passed`);
