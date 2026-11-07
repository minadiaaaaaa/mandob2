// Phase 7: tax invoices, credit notes and their buyers, and the ZATCA sandbox switch. The rules live in
// domain/invoices.ts. Plan quotas: buyers kept, open drafts, invoices issued a month (domain/plans.ts QUOTAS);
// the sandbox signing needs the plan's zatca_phase2 feature.
import { Router } from 'express';
import { exec, one, q, tx } from '../db.js';
import { clean, fail, fieldError, list, today, where, type Spec } from '../http.js';
import { can } from '../auth.js';
import { audit } from '../audit.js';
import { features, loadTenant } from '../domain/subscription.js';
import { withQuota } from '../domain/quotas.js';
import { creditInvoice, invoiceXml, issueInvoice, saveLines, setZatcaMode, validVat, zatcaMode } from '../domain/invoices.js';

export const invoicesRouter = Router();
const id = (req: { params: Record<string, string | string[]> }) => String(req.params.id);
const hasZatca = async (req: any) => (await features(await loadTenant(Number(req.user!.tenant_id)))).includes('zatca_phase2');

// ---------- buyers ----------
const BUYER_RULES = { name: { req: true, max: 200 }, name_en: { max: 200 }, vat_number: { type: 'digits' as const, max: 15 }, cr_number: { max: 30 },
  address: { max: 300 }, city: { max: 100 }, postal_code: { max: 10 }, country: { max: 2 }, email: { type: 'email' as const, max: 150 }, company_id: { type: 'int' as const } };
async function checkBuyer(v: Record<string, any>, idNow = 0) {
  if (v.vat_number && !validVat(v.vat_number)) fieldError('vat_number', 'vat_invalid');
  if (v.name && (await one('SELECT 1 FROM invoice_buyers WHERE name = ? AND id <> ?', [v.name, idNow]))) fieldError('name', 'name_taken');
  if (v.company_id != null && !(await one('SELECT 1 FROM companies WHERE id = ?', [v.company_id]))) fieldError('company_id', 'invalid');
}
invoicesRouter.get('/invoice-buyers', can('invoices.view'), async (_req, res) =>
  res.json(await q(`SELECT b.*, co.name platform, (SELECT COUNT(*) FROM invoices i WHERE i.buyer_id = b.id) invoices FROM invoice_buyers b
    LEFT JOIN companies co ON co.id = b.company_id ORDER BY b.is_active DESC, b.name`)));
invoicesRouter.post('/invoice-buyers', can('invoices.create'), async (req, res) => {
  const v = clean(req.body, BUYER_RULES);
  await checkBuyer(v);
  // the insert guard counts it against the plan's buyers
  const r = await exec('INSERT INTO invoice_buyers SET ?', [v]);
  await audit(req, { action: 'invoice_buyer.create', entity_type: 'invoice_buyer', entity_id: r.insertId, after: v });
  res.json({ id: r.insertId });
});
invoicesRouter.patch('/invoice-buyers/:id', can('invoices.update'), async (req, res) => {
  const before = await one<any>('SELECT * FROM invoice_buyers WHERE id = ?', [id(req)]);
  if (!before) fail(404, 'not_found');
  const v = clean(req.body, { ...BUYER_RULES, name: { max: 200 }, is_active: { type: 'bool' as const } }, true);
  if (v.name === null) fieldError('name', 'required');
  await checkBuyer(v, before.id);
  if (Object.keys(v).length) {
    await withQuota('invoice_buyers', !before.is_active && v.is_active ? 1 : 0, () => exec('UPDATE invoice_buyers SET ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [v, before.id]));
    await audit(req, { action: 'invoice_buyer.update', entity_type: 'invoice_buyer', entity_id: before.id, before, after: v });
  }
  res.json({ ok: true });
});

// ---------- invoices ----------
const SPEC: Spec = {
  from: 'FROM invoices i JOIN invoice_buyers b ON b.id = i.buyer_id LEFT JOIN contracts k ON k.id = i.contract_id LEFT JOIN invoices o ON o.id = i.original_id',
  select: 'i.id, i.kind, i.status, i.number, i.icv, i.issue_date, i.supply_from, i.supply_to, i.subtotal, i.vat_total, i.total, i.zatca_status, i.created_at, b.name buyer_name, k.name contract_name, o.number original_number',
  search: ['i.number', 'b.name', 'k.name'],
  filters: { status: (v) => ['i.status = ?', [v]], kind: (v) => ['i.kind = ?', [v]], buyer: (v) => ['i.buyer_id = ?', [v]],
    month: (v) => (/^\d{4}-\d{2}$/.test(v) ? ['i.issue_date >= ? AND i.issue_date < DATE_ADD(?, INTERVAL 1 MONTH)', [`${v}-01`, `${v}-01`]] : null) },
  sorts: { number: 'i.icv', date: 'i.issue_date', total: 'i.total', created: 'i.id' }, defaultSort: '-created',
};
invoicesRouter.get('/invoices', can('invoices.view'), async (req, res) => {
  const query = req.query as Record<string, string>;
  const data = await list(SPEC, query);
  const w = where(SPEC, query, ['status']);
  const [stats] = await q(`SELECT COALESCE(SUM(i.status = 'draft'),0) drafts, COALESCE(SUM(i.status = 'issued' AND i.kind = 'invoice'),0) issued,
    COALESCE(SUM(i.status = 'credited'),0) credited, COALESCE(SUM(IF(i.status <> 'draft' AND i.kind = 'invoice', i.total, 0)),0) invoiced,
    COALESCE(SUM(IF(i.kind = 'credit', i.total, 0)),0) credits ${SPEC.from}${w.sql}`, w.params);
  res.json({ ...data, stats, zatca: { mode: await zatcaMode(), allowed: await hasZatca(req) } });
});
invoicesRouter.get('/invoices/:id', can('invoices.view'), async (req, res) => {
  const [inv] = await q(`SELECT i.*, b.name buyer_name, k.name contract_name, o.number original_number ${SPEC.from} WHERE i.id = ?`, [id(req)]);
  if (!inv) fail(404, 'not_found');
  const lines = await q('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY sort, id', [id(req)]);
  const credits = await q("SELECT id, number, total, issue_date FROM invoices WHERE original_id = ? ORDER BY id", [id(req)]);
  res.json({ ...inv, lines, credits });
});
invoicesRouter.get('/invoices/:id/xml', can('invoices.view'), async (req, res) => {
  const xml = await invoiceXml(id(req));
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="invoice-${id(req)}.xml"`);
  res.send(xml);
});
const LINE = { description: { req: true, max: 255 }, quantity: { req: true, type: 'num' as const, min: 0.001 }, unit_price: { req: true, type: 'num' as const, min: 0 }, vat_rate: { type: 'num' as const, min: 0, max: 100 } };
function cleanLines(raw: unknown) {
  if (!Array.isArray(raw)) return undefined;
  if (raw.length > 200) fail(422, 'too_many_lines');
  return raw.map((l, i) => {
    try { const v = clean(l, LINE); return { ...v, vat_rate: v.vat_rate ?? 15 } as { description: string; quantity: number; unit_price: number; vat_rate: number }; }
    catch (e: any) { throw Object.assign(e, { params: { ...(e.params ?? {}), line: i + 1 } }); }
  });
}
const HEAD = { buyer_id: { req: true, type: 'int' as const }, contract_id: { type: 'int' as const }, issue_date: { type: 'date' as const }, supply_from: { type: 'date' as const },
  supply_to: { type: 'date' as const }, notes: { max: 500 } };
async function checkHead(v: Record<string, any>, cur: Record<string, any> = {}) {
  if (v.buyer_id != null && !(await one('SELECT 1 FROM invoice_buyers WHERE id = ? AND is_active = 1', [v.buyer_id]))) fieldError('buyer_id', 'invalid');
  if (v.contract_id != null && !(await one('SELECT 1 FROM contracts WHERE id = ?', [v.contract_id]))) fieldError('contract_id', 'invalid');
  const from = v.supply_from !== undefined ? v.supply_from : cur.supply_from, to = v.supply_to !== undefined ? v.supply_to : cur.supply_to;
  if (from && to && String(to).slice(0, 10) < String(from).slice(0, 10)) fieldError('supply_to', 'end_before_start');
}
invoicesRouter.post('/invoices', can('invoices.create'), async (req, res) => {
  const v = clean(req.body, HEAD);
  await checkHead(v);
  const lines = cleanLines(req.body?.lines) ?? [];
  // a new invoice is a draft: the insert guard counts it against the plan's open drafts
  const iid = await tx(async () => {
    const r = await exec('INSERT INTO invoices SET ?', [{ ...v, kind: 'invoice', status: 'draft', created_by: req.user!.id }]);
    await saveLines(r.insertId, lines);
    return r.insertId;
  });
  await audit(req, { action: 'invoice.create', entity_type: 'invoice', entity_id: iid, after: { ...v, lines: lines.length } });
  res.json({ id: iid });
});
invoicesRouter.patch('/invoices/:id', can('invoices.update'), async (req, res) => {
  const before = await one<any>('SELECT * FROM invoices WHERE id = ?', [id(req)]);
  if (!before) fail(404, 'not_found');
  if (before.status !== 'draft') fail(409, 'invoice_not_draft');
  const v = clean(req.body, { ...HEAD, buyer_id: { type: 'int' as const } }, true);
  if (v.buyer_id === null) fieldError('buyer_id', 'required');
  await checkHead(v, before);
  const lines = cleanLines(req.body?.lines);
  await tx(async () => {
    if (Object.keys(v).length) await exec('UPDATE invoices SET ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [v, before.id]);
    if (lines) await saveLines(before.id, lines);
  });
  await audit(req, { action: 'invoice.update', entity_type: 'invoice', entity_id: before.id, before, after: { ...v, lines: lines?.length } });
  res.json({ ok: true });
});
invoicesRouter.delete('/invoices/:id', can('invoices.delete'), async (req, res) => {
  const before = await one<any>('SELECT * FROM invoices WHERE id = ?', [id(req)]);
  if (!before) fail(404, 'not_found');
  if (before.status !== 'draft') fail(409, 'invoice_not_draft');
  await tx(async () => { await exec('DELETE FROM invoice_lines WHERE invoice_id = ?', [before.id]); await exec('DELETE FROM invoices WHERE id = ?', [before.id]); });
  await audit(req, { action: 'invoice.delete', entity_type: 'invoice', entity_id: before.id, before, severity: 'warning' });
  res.json({ ok: true });
});
invoicesRouter.post('/invoices/:id/issue', can('invoices.issue'), async (req, res) => {
  const r = await issueInvoice(id(req), req.user!.id, await today(), await hasZatca(req));
  await audit(req, { action: 'invoice.issue', entity_type: 'invoice', entity_id: id(req), after: r, severity: 'warning' });
  res.json({ ok: true, ...r });
});
invoicesRouter.post('/invoices/:id/credit', can('invoices.issue'), async (req, res) => {
  const v = clean(req.body, { reason: { req: true, max: 255 } });
  const cid = await creditInvoice(id(req), v.reason, req.user!.id, await today(), await hasZatca(req));
  await audit(req, { action: 'invoice.credit', entity_type: 'invoice', entity_id: id(req), after: { credit_note: cid, reason: v.reason }, severity: 'warning' });
  res.json({ ok: true, id: cid });
});

// ---------- ZATCA sandbox ----------
invoicesRouter.get('/invoices-zatca', can('invoices.view'), async (req, res) => res.json({ mode: await zatcaMode(), allowed: await hasZatca(req) }));
invoicesRouter.put('/invoices-zatca', can('invoices.settings'), async (req, res) => {
  const v = clean(req.body, { mode: { req: true, enum: ['off', 'sandbox'] } });
  if (v.mode === 'sandbox' && !(await hasZatca(req))) fail(402, 'feature_locked', { feature: 'zatca_phase2' });
  await setZatcaMode(v.mode as 'off' | 'sandbox');
  await audit(req, { action: 'invoice.zatca_mode', after: v, severity: 'warning' });
  res.json({ ok: true });
});
