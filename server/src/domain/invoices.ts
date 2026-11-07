// Phase 7, tax invoices and credit notes, with what ZATCA (the Saudi tax authority's e-invoicing, "Fatoora")
// asks of them, defined once.
// - A line's net is quantity × unit price; its VAT is the net × rate; both rounded to halalas. The invoice adds them.
// - Issuing is final: the invoice gets the next number and counter (ICV), a UUID, the hash of the invoice before it
//   (PIH; the first one uses ZATCA's starting value), the hash of its own UBL XML and a QR. A wrong invoice is
//   corrected by a credit note (type 381) that points at it; the original is then "credited".
// - The QR is ZATCA's TLV: seller name, VAT number, time, total and VAT (tags 1-5). In sandbox mode (the plan's
//   zatca_phase2 feature, switched on by the company) the invoice is also signed with the company's own sandbox key
//   (ECDSA secp256k1) and the QR carries the hash, the signature and the public key (tags 6-8).
//   Sandbox signing proves the data is ready for phase 2; sending to ZATCA needs the company's CSID from the
//   Fatoora portal and is not done here.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { exec, one, q, setSetting, setting, tx } from '../db.js';
import { fail, fieldError } from '../http.js';
import { decrypt, encrypt } from '../routes/system.js';
import { ensureQuota } from './quotas.js';

export const ZATCA_FIRST_PIH = 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==';
const money = (n: number) => Math.round(n * 100) / 100;
// A Saudi VAT number: 15 digits, starting and ending with 3.
export const validVat = (v: string | null | undefined) => !!v && /^3\d{13}3$/.test(v);

export function lineTotals(l: { quantity: number; unit_price: number; vat_rate: number }) {
  const net = money(Number(l.quantity) * Number(l.unit_price));
  return { net, vat: money((net * Number(l.vat_rate)) / 100) };
}

// Saves a draft's lines and totals (the lines given replace the old ones).
export async function saveLines(invoiceId: number, lines: { description: string; quantity: number; unit_price: number; vat_rate: number }[]) {
  let subtotal = 0, vat = 0;
  await exec('DELETE FROM invoice_lines WHERE invoice_id = ?', [invoiceId]);
  for (const [i, raw] of lines.entries()) {
    // the price is kept in halalas, and the totals are worked out from the price as kept
    const l = { ...raw, unit_price: money(Number(raw.unit_price)) };
    const t = lineTotals(l);
    subtotal += t.net; vat += t.vat;
    await exec('INSERT INTO invoice_lines SET ?', [{ invoice_id: invoiceId, description: l.description, quantity: l.quantity, unit_price: l.unit_price, vat_rate: l.vat_rate, net: t.net, vat: t.vat, sort: i }]);
  }
  subtotal = money(subtotal); vat = money(vat);
  await exec('UPDATE invoices SET subtotal = ?, vat_total = ?, total = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [subtotal, vat, money(subtotal + vat), invoiceId]);
}

// ---------- the seller, the sandbox key ----------
async function seller() {
  const [name, name_en, vat, cr, address] = await Promise.all(['org.name', 'org.name_en', 'org.tax_number', 'org.cr_number', 'org.address'].map((k) => setting(k)));
  return { name: name ?? '', name_en, vat_number: vat, cr_number: cr, address };
}
export async function zatcaMode(): Promise<'off' | 'sandbox'> {
  return (await setting('zatca.mode')) === 'sandbox' ? 'sandbox' : 'off';
}
// Switching sandbox on makes the company's own key pair once; the private key is kept encrypted.
export async function setZatcaMode(mode: 'off' | 'sandbox') {
  if (mode === 'sandbox' && !(await setting('zatca.sandbox_key'))) {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
    await setSetting('zatca.sandbox_key', encrypt(privateKey.export({ type: 'sec1', format: 'pem' }).toString()));
  }
  await setSetting('zatca.mode', mode);
}
async function sandboxKey() {
  const stored = await setting('zatca.sandbox_key');
  return stored ? createPrivateKey(decrypt(stored)) : null;
}

// ---------- the QR (ZATCA TLV, base64) ----------
export function tlv(fields: (string | Buffer)[]) {
  return Buffer.concat(fields.map((v, i) => {
    const b = Buffer.isBuffer(v) ? v : Buffer.from(String(v), 'utf8');
    if (b.length > 255) throw new Error('TLV value too long');
    return Buffer.concat([Buffer.from([i + 1, b.length]), b]);
  })).toString('base64');
}
// Reads a QR back (tests and the print view)
export function readTlv(b64: string) {
  const b = Buffer.from(b64, 'base64'); const out: Record<number, Buffer> = {};
  for (let i = 0; i < b.length;) { const tag = b[i], len = b[i + 1]; out[tag] = b.subarray(i + 2, i + 2 + len); i += 2 + len; }
  return out;
}

// ---------- the UBL 2.1 XML ----------
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const amt = (n: unknown) => Number(n).toFixed(2);
export function ublXml(inv: any, lines: any[], s: any, b: any) {
  const party = (p: any, vatTag: boolean) => `<cac:Party>${p.cr_number ? `<cac:PartyIdentification><cbc:ID schemeID="CRN">${esc(p.cr_number)}</cbc:ID></cac:PartyIdentification>` : ''}
      <cac:PostalAddress><cbc:StreetName>${esc(p.address)}</cbc:StreetName><cbc:CityName>${esc(p.city)}</cbc:CityName><cbc:PostalZone>${esc(p.postal_code)}</cbc:PostalZone><cac:Country><cbc:IdentificationCode>${esc(p.country ?? 'SA')}</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
      ${vatTag && p.vat_number ? `<cac:PartyTaxScheme><cbc:CompanyID>${esc(p.vat_number)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : ''}
      <cac:PartyLegalEntity><cbc:RegistrationName>${esc(p.name)}</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party>`;
  const time = String(inv.issued_at).slice(11, 19) || '00:00:00';
  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
  <cbc:ID>${esc(inv.number)}</cbc:ID>
  <cbc:UUID>${esc(inv.uuid)}</cbc:UUID>
  <cbc:IssueDate>${esc(String(inv.issue_date).slice(0, 10))}</cbc:IssueDate>
  <cbc:IssueTime>${time}</cbc:IssueTime>
  <cbc:InvoiceTypeCode name="0100000">${inv.kind === 'credit' ? 381 : 388}</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode>
  <cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode>
  ${inv.kind === 'credit' && inv.original_number ? `<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${esc(inv.original_number)}</cbc:ID></cac:InvoiceDocumentReference></cac:BillingReference>` : ''}
  <cac:AdditionalDocumentReference><cbc:ID>ICV</cbc:ID><cbc:UUID>${inv.icv}</cbc:UUID></cac:AdditionalDocumentReference>
  <cac:AdditionalDocumentReference><cbc:ID>PIH</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${esc(inv.pih)}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference>
  <cac:AccountingSupplierParty>${party(s, true)}</cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>${party(b, true)}</cac:AccountingCustomerParty>
  ${inv.supply_from ? `<cac:Delivery><cbc:ActualDeliveryDate>${esc(String(inv.supply_from).slice(0, 10))}</cbc:ActualDeliveryDate>${inv.supply_to ? `<cbc:LatestDeliveryDate>${esc(String(inv.supply_to).slice(0, 10))}</cbc:LatestDeliveryDate>` : ''}</cac:Delivery>` : ''}
  ${inv.kind === 'credit' ? `<cac:PaymentMeans><cbc:PaymentMeansCode>10</cbc:PaymentMeansCode><cbc:InstructionNote>${esc(inv.credit_reason)}</cbc:InstructionNote></cac:PaymentMeans>` : ''}
  <cac:TaxTotal><cbc:TaxAmount currencyID="SAR">${amt(inv.vat_total)}</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="SAR">${amt(inv.subtotal)}</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="SAR">${amt(inv.subtotal)}</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="SAR">${amt(inv.total)}</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="SAR">${amt(inv.total)}</cbc:PayableAmount></cac:LegalMonetaryTotal>
${lines.map((l, i) => `  <cac:InvoiceLine><cbc:ID>${i + 1}</cbc:ID><cbc:InvoicedQuantity unitCode="PCE">${Number(l.quantity)}</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="SAR">${amt(l.net)}</cbc:LineExtensionAmount><cac:TaxTotal><cbc:TaxAmount currencyID="SAR">${amt(l.vat)}</cbc:TaxAmount><cbc:RoundingAmount currencyID="SAR">${amt(Number(l.net) + Number(l.vat))}</cbc:RoundingAmount></cac:TaxTotal><cac:Item><cbc:Name>${esc(l.description)}</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>${Number(l.vat_rate) > 0 ? 'S' : 'Z'}</cbc:ID><cbc:Percent>${Number(l.vat_rate).toFixed(2)}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item><cac:Price><cbc:PriceAmount currencyID="SAR">${amt(l.unit_price)}</cbc:PriceAmount></cac:Price></cac:InvoiceLine>`).join('\n')}
</Invoice>`;
}

// ---------- issuing ----------
async function nextNumber(kind: 'invoice' | 'credit', year: string) {
  const prefix = kind === 'credit' ? 'CN' : ((await setting('invoice.prefix')) || 'INV');
  const [r] = await q<{ n: number }>('SELECT COUNT(*) n FROM invoices WHERE kind = ? AND number LIKE ?', [kind, `${prefix}-${year}-%`]);
  return `${prefix}-${year}-${String(Number(r.n) + 1).padStart(5, '0')}`;
}

// Issues a draft: checks it, numbers it, chains it to the one before, builds its XML, hash and QR. In one
// transaction, so two invoices issued at the same moment cannot share a counter.
export async function issueInvoice(id: number | string, userId: number | null, today: string, sandboxAllowed: boolean) {
  return tx(async () => {
    const inv = await one<any>('SELECT * FROM invoices WHERE id = ? FOR UPDATE', [id]);
    if (!inv) fail(404, 'not_found');
    if (inv.status !== 'draft') fail(409, 'invoice_not_draft');
    const lines = await q<any>('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY sort, id', [inv.id]);
    if (!lines.length) fail(409, 'invoice_no_lines');
    const s = await seller();
    if (!s.name) fail(409, 'seller_name_missing');
    if (!validVat(s.vat_number)) fail(409, 'seller_vat_invalid');
    const b = await one<any>('SELECT * FROM invoice_buyers WHERE id = ?', [inv.buyer_id]);
    if (!b) fail(409, 'buyer_missing');
    if (!validVat(b.vat_number)) fail(409, 'buyer_vat_invalid');
    await ensureQuota('invoices_month', 1);
    // the counter and the previous hash: the newest issued invoice of this company (locked so nobody else issues)
    const prev = await one<{ icv: number; invoice_hash: string }>("SELECT icv, invoice_hash FROM invoices WHERE status <> 'draft' AND icv IS NOT NULL ORDER BY icv DESC LIMIT 1 FOR UPDATE");
    const icv = (prev?.icv ?? 0) + 1;
    const issueDate = inv.issue_date ? String(inv.issue_date).slice(0, 10) : today;
    if (issueDate > today) fieldError('issue_date', 'date_in_future');
    const [{ now }] = await q<{ now: string }>("SELECT DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s') now");
    const orig = inv.original_id ? await one<any>('SELECT number FROM invoices WHERE id = ?', [inv.original_id]) : null;
    const issued = { ...inv, icv, uuid: randomUUID(), number: await nextNumber(inv.kind, issueDate.slice(0, 4)), issue_date: issueDate, issued_at: now,
      pih: prev?.invoice_hash ?? ZATCA_FIRST_PIH, original_number: orig?.number };
    const buyer = { name: b.name, vat_number: b.vat_number, cr_number: b.cr_number, address: b.address, city: b.city, postal_code: b.postal_code, country: b.country };
    const xml = ublXml(issued, lines, s, buyer);
    const hash = createHash('sha256').update(xml, 'utf8').digest('base64');
    const qrFields: (string | Buffer)[] = [s.name, s.vat_number!, `${now.replace(' ', 'T')}Z`, Number(inv.total).toFixed(2), Number(inv.vat_total).toFixed(2)];
    let signature: string | null = null, zatca = 'none';
    if (sandboxAllowed && (await zatcaMode()) === 'sandbox') {
      const key = await sandboxKey();
      if (key) {
        signature = sign('sha256', Buffer.from(hash, 'utf8'), key).toString('base64');
        const pub = createPublicKey(key).export({ type: 'spki', format: 'der' });
        qrFields.push(hash, signature, pub);
        zatca = 'sandbox_signed';
      }
    }
    await exec(`UPDATE invoices SET status = 'issued', number = ?, icv = ?, uuid = ?, issue_date = ?, issued_at = ?, issued_by = ?, pih = ?, invoice_hash = ?, qr = ?,
      signature = ?, zatca_status = ?, seller_json = ?, buyer_json = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?`,
      [issued.number, icv, issued.uuid, issueDate, now, userId, issued.pih, hash, tlv(qrFields), signature, zatca, JSON.stringify(s), JSON.stringify(buyer), inv.id]);
    if (inv.kind === 'credit' && inv.original_id) await exec("UPDATE invoices SET status = 'credited', updated_at = UTC_TIMESTAMP() WHERE id = ?", [inv.original_id]);
    return { number: issued.number, icv };
  });
}

// A credit note for an issued invoice: the same lines (or the ones given), issued at once.
export async function creditInvoice(id: number | string, reason: string, userId: number | null, today: string, sandboxAllowed: boolean) {
  const inv = await one<any>('SELECT * FROM invoices WHERE id = ?', [id]);
  if (!inv) fail(404, 'not_found');
  if (inv.kind !== 'invoice' || inv.status !== 'issued') fail(409, 'invoice_not_creditable');
  const lines = await q<any>('SELECT description, quantity, unit_price, vat_rate FROM invoice_lines WHERE invoice_id = ? ORDER BY sort, id', [inv.id]);
  // the credit note is born issued, so it never takes a draft place
  const cid = await tx(async () => {
    const r = await exec('INSERT INTO invoices SET ?', [{ kind: 'credit', status: 'issued', buyer_id: inv.buyer_id, contract_id: inv.contract_id, original_id: inv.id,
      credit_reason: reason, issue_date: today, supply_from: inv.supply_from, supply_to: inv.supply_to, created_by: userId }]);
    await exec("UPDATE invoices SET status = 'draft' WHERE id = ?", [r.insertId]);
    await saveLines(r.insertId, lines.map((l) => ({ ...l, quantity: Number(l.quantity), unit_price: Number(l.unit_price), vat_rate: Number(l.vat_rate) })));
    return r.insertId;
  });
  try { await issueInvoice(cid, userId, today, sandboxAllowed); }
  catch (e) { await exec('DELETE FROM invoice_lines WHERE invoice_id = ?', [cid]); await exec('DELETE FROM invoices WHERE id = ?', [cid]); throw e; }
  return cid;
}

export async function invoiceXml(id: number | string) {
  const inv = await one<any>('SELECT i.*, o.number original_number FROM invoices i LEFT JOIN invoices o ON o.id = i.original_id WHERE i.id = ?', [id]);
  if (!inv) fail(404, 'not_found');
  if (inv.status === 'draft') fail(409, 'invoice_not_issued');
  const lines = await q<any>('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY sort, id', [inv.id]);
  return ublXml({ ...inv, issued_at: String(inv.issued_at ?? '').replace('T', ' ') }, lines, JSON.parse(inv.seller_json), JSON.parse(inv.buyer_json));
}
