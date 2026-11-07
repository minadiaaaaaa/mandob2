// Phase 8, smaller tools:
// - Saved links: each user's own links (only they see them), and community links the platform owner shares with
//   every company (a user can save one to their own).
// - Closing the company: the company asks (with its name typed again and a reason); the platform owner sees the
//   request on the company's row and decides. Asking again or taking it back is allowed until then.
// - Print lists: riders and vehicles with the columns chosen on the screen, plus blank columns (for a signature,
//   an amount), as Excel.
import { Router } from 'express';
import { asPlatform, exec, one, q } from '../db.js';
import { clean, fail, fieldError, sendExport, type Col } from '../http.js';
import { can, platformOnly, requireUser } from '../auth.js';
import { audit } from '../audit.js';

export const toolsRouter = Router();
const id = (req: { params: Record<string, string | string[]> }) => String(req.params.id);
const httpUrl = (v: string) => { try { const u = new URL(v); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; } };
const LINK = { title: { req: true, max: 150 }, url: { req: true, max: 500 }, note: { max: 255 } };

// ---------- saved links ----------
toolsRouter.get('/bookmarks', requireUser, async (req, res) => {
  const mine = await q('SELECT id, title, url, note, created_at FROM bookmarks WHERE user_id = ? ORDER BY title', [req.user!.id]);
  const community = await asPlatform(() => q('SELECT id, title, url, note FROM community_links WHERE is_active = 1 ORDER BY sort, title'));
  res.json({ mine, community });
});
toolsRouter.post('/bookmarks', requireUser, async (req, res) => {
  const v = clean(req.body, LINK);
  if (!httpUrl(v.url)) fieldError('url', 'url_invalid');
  const [{ n }] = await q<{ n: number }>('SELECT COUNT(*) n FROM bookmarks WHERE user_id = ?', [req.user!.id]);
  if (Number(n) >= 200) fail(422, 'too_many_bookmarks');
  if (await one('SELECT 1 FROM bookmarks WHERE user_id = ? AND url = ?', [req.user!.id, v.url])) fieldError('url', 'bookmark_exists');
  const r = await exec('INSERT INTO bookmarks SET ?', [{ ...v, user_id: req.user!.id }]);
  res.json({ id: r.insertId });
});
toolsRouter.patch('/bookmarks/:id', requireUser, async (req, res) => {
  const v = clean(req.body, LINK, true);
  if (v.url && !httpUrl(v.url)) fieldError('url', 'url_invalid');
  for (const k of ['title', 'url'] as const) if (k in v && !v[k]) fieldError(k, 'required');
  // only one's own links: the user is part of the condition
  const r = await exec('UPDATE bookmarks SET ? WHERE id = ? AND user_id = ?', [v, id(req), req.user!.id]);
  if (!r.affectedRows) fail(404, 'not_found');
  res.json({ ok: true });
});
toolsRouter.delete('/bookmarks/:id', requireUser, async (req, res) => {
  const r = await exec('DELETE FROM bookmarks WHERE id = ? AND user_id = ?', [id(req), req.user!.id]);
  if (!r.affectedRows) fail(404, 'not_found');
  res.json({ ok: true });
});
// the platform owner's community links
toolsRouter.get('/platform/community-links', platformOnly, async (_req, res) => res.json(await asPlatform(() => q('SELECT * FROM community_links ORDER BY sort, title'))));
toolsRouter.post('/platform/community-links', platformOnly, async (req, res) => {
  const v = clean(req.body, { ...LINK, sort: { type: 'int' } });
  if (!httpUrl(v.url)) fieldError('url', 'url_invalid');
  const r = await asPlatform(() => exec('INSERT INTO community_links SET ?', [v]));
  await audit(req, { action: 'community_link.create', entity_type: 'community_link', entity_id: r.insertId, after: v });
  res.json({ id: r.insertId });
});
toolsRouter.patch('/platform/community-links/:id', platformOnly, async (req, res) => {
  const v = clean(req.body, { ...LINK, sort: { type: 'int' }, is_active: { type: 'bool' } }, true);
  if (v.url && !httpUrl(v.url)) fieldError('url', 'url_invalid');
  const r = await asPlatform(() => exec('UPDATE community_links SET ? WHERE id = ?', [v, id(req)]));
  if (!r.affectedRows) fail(404, 'not_found');
  await audit(req, { action: 'community_link.update', entity_type: 'community_link', entity_id: id(req), after: v });
  res.json({ ok: true });
});
toolsRouter.delete('/platform/community-links/:id', platformOnly, async (req, res) => {
  await asPlatform(() => exec('DELETE FROM community_links WHERE id = ?', [id(req)]));
  await audit(req, { action: 'community_link.delete', entity_type: 'community_link', entity_id: id(req), severity: 'warning' });
  res.json({ ok: true });
});

// ---------- closing the company ----------
toolsRouter.get('/company/closure', can('subscription.view'), async (req, res) => {
  const t = await asPlatform(() => one<any>('SELECT name, closure_requested_at, closure_reason FROM tenants WHERE id = ?', [req.user!.tenant_id]));
  res.json(t ?? {});
});
toolsRouter.post('/company/closure', can('subscription.manage'), async (req, res) => {
  if (!req.user!.tenant_id) fail(409, 'platform_cannot_close');
  const v = clean(req.body, { confirm_name: { req: true, max: 150 }, reason: { req: true, max: 500 } });
  const t = await asPlatform(() => one<any>('SELECT name FROM tenants WHERE id = ?', [req.user!.tenant_id]));
  if (!t || v.confirm_name.trim() !== String(t.name).trim()) fieldError('confirm_name', 'company_name_mismatch');
  await asPlatform(() => exec('UPDATE tenants SET closure_requested_at = UTC_TIMESTAMP(), closure_reason = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [v.reason, req.user!.tenant_id]));
  await audit(req, { action: 'company.closure_request', entity_type: 'tenant', entity_id: req.user!.tenant_id, after: { reason: v.reason }, severity: 'critical' });
  res.json({ ok: true });
});
toolsRouter.delete('/company/closure', can('subscription.manage'), async (req, res) => {
  await asPlatform(() => exec('UPDATE tenants SET closure_requested_at = NULL, closure_reason = NULL, updated_at = UTC_TIMESTAMP() WHERE id = ?', [req.user!.tenant_id]));
  await audit(req, { action: 'company.closure_cancel', entity_type: 'tenant', entity_id: req.user!.tenant_id, severity: 'warning' });
  res.json({ ok: true });
});

// ---------- print lists ----------
// The columns a list may show (fixed list: a requested column is never turned into SQL).
const RIDER_COLS: Record<string, string> = {
  id: 'r.id', branch: 'br.name_ar', status: 'r.status', alias: 'r.alias', full_name: 'r.full_name', name_en: 'r.name_en', phone: 'r.phone',
  national_id: 'r.national_id', iqama_expiry: "(SELECT d.expiry_date FROM rider_documents d WHERE d.rider_id = r.id AND d.doc_type = 'id' AND d.is_current = 1 LIMIT 1)",
  nationality: 'r.nationality', designation: 'dg.name_ar', company: 'co.name', hire_date: 'r.hire_date', vehicle: 'v.plate',
  iban: '(SELECT ba.iban FROM rider_bank_accounts ba WHERE ba.rider_id = r.id AND ba.is_primary = 1 LIMIT 1)',
  license_expiry: "(SELECT d.expiry_date FROM rider_documents d WHERE d.rider_id = r.id AND d.doc_type = 'license' AND d.is_current = 1 LIMIT 1)",
  health_expiry: "(SELECT d.expiry_date FROM rider_documents d WHERE d.rider_id = r.id AND d.doc_type = 'health' AND d.is_current = 1 LIMIT 1)",
  passport_number: 'r.passport_number', sponsor_name: 'r.sponsor_name',
};
const VEHICLE_COLS: Record<string, string> = {
  plate: 'v.plate', plate_en: 'v.plate_en', vehicle_type: 'v.vehicle_type', maker: 'v.maker', model: 'v.model', year: 'v.year', color: 'v.color',
  chassis: 'v.chassis', status: 'v.status', branch: 'br.name_ar', odometer: 'v.odometer', ownership: 'v.ownership', rider: 'r.full_name',
  registration_serial: '(SELECT g.serial FROM vehicle_registrations g WHERE g.vehicle_id = v.id AND g.is_current = 1 LIMIT 1)',
  registration_expiry: '(SELECT g.expiry_date FROM vehicle_registrations g WHERE g.vehicle_id = v.id AND g.is_current = 1 LIMIT 1)',
  card_number: '(SELECT oc.number FROM operation_card_vehicles x JOIN operation_cards oc ON oc.id = x.card_id WHERE x.vehicle_id = v.id AND x.is_current = 1 LIMIT 1)',
  card_expiry: '(SELECT oc.expiry_date FROM operation_card_vehicles x JOIN operation_cards oc ON oc.id = x.card_id WHERE x.vehicle_id = v.id AND x.is_current = 1 LIMIT 1)',
};
const LISTS = {
  riders: { perm: 'riders.print', cols: RIDER_COLS, from: `FROM riders r LEFT JOIN branches br ON br.id = r.branch_id LEFT JOIN designations dg ON dg.id = r.designation_id
    LEFT JOIN companies co ON co.id = r.company_id LEFT JOIN vehicle_assignments va ON va.rider_id = r.id AND va.is_current = 1 LEFT JOIN vehicles v ON v.id = va.vehicle_id`,
    where: (q: any) => { const w = ["r.status <> 'terminated'"]; const p: unknown[] = []; if (q.branch) { w.push('r.branch_id = ?'); p.push(q.branch); } if (q.status) { w.push('r.status = ?'); p.push(q.status); } return { w, p }; }, order: 'r.full_name' },
  vehicles: { perm: 'vehicles.view', cols: VEHICLE_COLS, from: `FROM vehicles v LEFT JOIN branches br ON br.id = v.branch_id LEFT JOIN vehicle_assignments va ON va.vehicle_id = v.id AND va.is_current = 1 LEFT JOIN riders r ON r.id = va.rider_id`,
    where: (q: any) => { const w = ["v.status <> 'retired'"]; const p: unknown[] = []; if (q.branch) { w.push('v.branch_id = ?'); p.push(q.branch); } if (q.status) { w.push('v.status = ?'); p.push(q.status); } return { w, p }; }, order: 'v.plate' },
} as const;
async function printRows(kind: keyof typeof LISTS, query: Record<string, string>) {
  const L = LISTS[kind];
  const cols = String(query.cols ?? '').split(',').filter((c) => c in L.cols);
  if (!cols.length) fieldError('cols', 'choose_columns');
  const { w, p } = L.where(query);
  const rows = await q(`SELECT ${cols.map((c) => `${(L.cols as Record<string, string>)[c]} AS \`${c}\``).join(', ')} ${L.from} WHERE ${w.join(' AND ')} ORDER BY ${L.order} LIMIT 3000`, p);
  // blank columns are names only (an amount to write in, a signature)
  const blanks = String(query.blanks ?? '').split('|').map((s) => s.trim().slice(0, 40)).filter(Boolean).slice(0, 6);
  return { cols, blanks, rows };
}
for (const kind of Object.keys(LISTS) as (keyof typeof LISTS)[]) {
  toolsRouter.get(`/print-lists/${kind}`, can(LISTS[kind].perm), async (req, res) => res.json(await printRows(kind, req.query as Record<string, string>)));
  toolsRouter.get(`/print-lists/${kind}/export`, can(LISTS[kind].perm), async (req, res) => {
    const { cols, blanks, rows } = await printRows(kind, req.query as Record<string, string>);
    const title = String(req.query.title ?? '').slice(0, 100) || `plist.${kind}`;
    const excelCols: Col[] = [...cols.map((c) => ({ key: c, label: `plist.c.${c}` })), ...blanks.map((b, i) => ({ key: `_blank${i}`, label: b, value: () => ' ' }))];
    await sendExport(req, res, { format: 'xlsx', title, rows, cols: excelCols });
  });
}

// ---------- rider ID cards (the screen draws and prints them) ----------
toolsRouter.get('/id-cards', can('riders.print'), async (req, res) => {
  const w = ["r.status <> 'terminated'"]; const p: unknown[] = [];
  if (req.query.branch) { w.push('r.branch_id = ?'); p.push(req.query.branch); }
  if (req.query.ids) { const ids = String(req.query.ids).split(',').filter((x) => /^\d+$/.test(x)).slice(0, 500); if (ids.length) { w.push('r.id IN (?)'); p.push(ids); } }
  res.json(await q(`SELECT r.id, r.full_name, r.name_en, r.alias, r.national_id, r.phone, dg.name_ar designation_ar, dg.name_en designation_en, co.name platform, br.name_ar branch_ar,
      (SELECT a.id FROM attachments a WHERE a.entity_type = 'rider' AND a.entity_id = CAST(r.id AS CHAR) AND a.attachment_type = 'photo' ORDER BY a.is_current DESC, a.id DESC LIMIT 1) photo_id
    FROM riders r LEFT JOIN designations dg ON dg.id = r.designation_id LEFT JOIN companies co ON co.id = r.company_id LEFT JOIN branches br ON br.id = r.branch_id
    WHERE ${w.join(' AND ')} ORDER BY r.full_name LIMIT 500`, p));
});
