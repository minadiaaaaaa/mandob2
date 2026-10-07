import { Router, type Request } from 'express';
import { exec, one, q } from '../db.js';
import { clean, eq, fail, list, listAll, sendExport, where, type Query, type Spec } from '../http.js';
import { can } from '../auth.js';
import { audit } from '../audit.js';
import { cellStr, importRoutes, type ImportDef } from '../importer.js';

// 6.3 Branding verification: start-of-shift photos. The automatic check and the staff review never merge.
// ponytail: no image checker ships with this build (face/card/screen detection need ML models), so photos stay
// "Not checked yet" and the status bar says the tools are unavailable. Staff review works in full.
export const brandingRouter = Router();

const EFFECTIVE = 'COALESCE(b.override_result, b.check_result)';
const spec: Spec = {
  from: 'FROM branding_photos b JOIN riders r ON r.id = b.rider_id LEFT JOIN contracts k ON k.id = r.contract_id',
  select: `b.*, ${EFFECTIVE} result, r.full_name, r.alias, r.phone, r.account_holder_phone, r.company_id`,
  search: [(s) => (/^\d+$/.test(s) ? ['(b.rider_id = ? OR r.phone LIKE ?)', [Number(s), `%${s}%`]] : ['(r.full_name LIKE ? OR r.alias LIKE ? OR r.phone LIKE ? OR r.email LIKE ?)', Array(4).fill(`%${s}%`)])],
  filters: {
    from: (v) => ['b.captured_at >= ?', [v]], to: (v) => ['b.captured_at < DATE_ADD(?, INTERVAL 1 DAY)', [v]],
    result: (v) => [`${EFFECTIVE} = ?`, [v]], card: eq('b.card_review'), source: eq('b.source_review'),
    suspect: () => "b.suspect_card = 1 AND b.card_review = 'none'", screen: () => "b.suspect_screen = 1 AND b.source_review = 'none'",
    company: eq('r.company_id'), contract: (v) => ['(r.contract_id = ? OR b.contract_name = (SELECT name FROM contracts WHERE id = ?))', [v, v]],
  },
  sorts: { captured: 'b.captured_at, b.id', rider: 'r.full_name' },
  defaultSort: '-captured',
};

brandingRouter.get('/branding', can('performance.view'), async (req, res) => {
  const query = req.query as Query;
  const w = where(spec, query);
  const [stats] = await q(`SELECT COUNT(*) photos, COALESCE(SUM(${EFFECTIVE} = 'fine'),0) fine, COALESCE(SUM(${EFFECTIVE} IN ('blurred','no_face','unreadable')),0) look,
    COALESCE(SUM(b.card_review = 'none'),0) awaiting, COALESCE(SUM(b.suspect_card = 1 AND b.card_review = 'none'),0) suspects,
    COALESCE(SUM(b.suspect_screen = 1 AND b.source_review = 'none'),0) screens, COALESCE(SUM(b.card_review = 'not_visible'),0) no_card,
    COALESCE(SUM(b.check_result = 'pending'),0) queue, COALESCE(SUM(b.check_result = 'failed'),0) failed ${spec.from}${w.sql}`, w.params);
  const [{ reviews }] = await q<any>("SELECT COUNT(*) reviews FROM branding_photos WHERE card_review IN ('visible','not_visible')");
  const [{ sreviews }] = await q<any>("SELECT COUNT(*) sreviews FROM branding_photos WHERE source_review IN ('direct','screen')");
  res.json({ ...(await list(spec, query)), stats, tools: { face: 'unavailable', card: 'unavailable', screen: 'unavailable', reviews: Number(reviews), screen_reviews: Number(sreviews) } });
});

brandingRouter.get('/branding/export', can('performance.export'), async (req, res) => {
  const rows = await listAll(spec, req.query as Query, 50000);
  await sendExport(req, res, { format: 'xlsx', title: 'brand.title', rows, cols: [
    { key: 'rider_id', label: 'riders.rider_id' }, { key: 'full_name', label: 'brand.rider' }, { key: 'captured_at', label: 'brand.captured' },
    { key: 'result', label: 'brand.result', fill: (r) => (r.result === 'fine' ? 'green' : r.result === 'no_face' ? 'red' : r.result === 'pending' || r.result === 'failed' ? 'grey' : 'amber') },
    { key: 'card_review', label: 'brand.card', fill: (r) => (r.card_review === 'visible' ? 'green' : r.card_review === 'not_visible' ? 'red' : null) },
    { key: 'source_review', label: 'brand.source', fill: (r) => (r.source_review === 'screen' ? 'red' : null) }, { key: 'card_note', label: 'common.notes' },
    { key: 'contract_name', label: 'brand.contract' }, { key: 'photo_url', label: 'brand.photo' },
  ] });
});

brandingRouter.get('/branding/:id', can('performance.view'), async (req, res) => {
  const b = await one<any>(`SELECT ${spec.select}, uc.full_name card_by_name, us.full_name source_by_name, uo.full_name override_by_name ${spec.from}
    LEFT JOIN users uc ON uc.id = b.card_by LEFT JOIN users us ON us.id = b.source_by LEFT JOIN users uo ON uo.id = b.override_by WHERE b.id = ?`, [req.params.id]);
  if (!b) fail(404, 'not_found');
  res.json(b);
});

// One rule for single and bulk edits: an answer, "clear" to withdraw the review, or "undo" to restore the check result.
const REVIEW = { card_review: { enum: ['visible', 'not_visible', 'unclear', 'clear'] }, source_review: { enum: ['direct', 'screen', 'unclear', 'clear'] },
  override_result: { enum: ['fine', 'blurred', 'no_face', 'unreadable', 'undo'] }, card_note: { max: 300 } };
function reviewSet(req: Request, v: Record<string, any>) {
  const set: string[] = []; const p: unknown[] = [];
  if (v.card_review) { set.push('card_review = ?, card_by = ?, card_at = UTC_TIMESTAMP()'); p.push(v.card_review === 'clear' ? 'none' : v.card_review, req.user!.id); }
  if ('card_note' in v) { set.push('card_note = ?'); p.push(v.card_note); }
  if (v.source_review) { set.push('source_review = ?, source_by = ?, source_at = UTC_TIMESTAMP()'); p.push(v.source_review === 'clear' ? 'none' : v.source_review, req.user!.id); }
  if (v.override_result) { set.push('override_result = ?, override_by = ?'); p.push(v.override_result === 'undo' ? null : v.override_result, req.user!.id); }
  if (!set.length) fail(422, 'no_field_chosen');
  return { sql: set.join(', '), p };
}
brandingRouter.patch('/branding/:id', can('performance.update'), async (req, res) => {
  const v = clean(req.body, REVIEW, true);
  const s = reviewSet(req, v);
  const r = await exec(`UPDATE branding_photos SET ${s.sql} WHERE id = ?`, [...s.p, req.params.id]);
  if (!r.affectedRows) fail(404, 'not_found');
  await audit(req, { action: 'branding.review', entity_type: 'branding_photo', entity_id: req.params.id as string, after: v });
  res.json({ ok: true });
});
brandingRouter.post('/branding/bulk', can('performance.update'), async (req, res) => {
  const ids: number[] = (req.body.ids ?? []).map(Number);
  if (!ids.length) fail(422, 'nothing_selected');
  if (ids.length > 1000) fail(422, 'max_1000');
  const s = reviewSet(req, clean(req.body, REVIEW, true));
  const r = await exec(`UPDATE branding_photos SET ${s.sql} WHERE id IN (?)`, [...s.p, ids]);
  await audit(req, { action: 'branding.bulk_review', details: `${r.affectedRows} photos` });
  res.json({ applied: r.affectedRows });
});
// "Mark the rest of this page fine": photos nobody judged get "card visible"; judged ones do not change.
brandingRouter.post('/branding/mark-fine', can('performance.update'), async (req, res) => {
  const ids: number[] = (req.body.ids ?? []).map(Number);
  if (!ids.length) fail(422, 'nothing_selected');
  const r = await exec("UPDATE branding_photos SET card_review = 'visible', card_by = ?, card_at = UTC_TIMESTAMP() WHERE id IN (?) AND card_review = 'none'", [req.user!.id, ids]);
  await audit(req, { action: 'branding.mark_fine', details: `${r.affectedRows} photos` });
  res.json({ applied: r.affectedRows });
});
// Re-check clears the measurements and keeps the staff review.
brandingRouter.post('/branding/:id/recheck', can('performance.update'), async (req, res) => {
  await exec("UPDATE branding_photos SET check_result = 'pending', measurements = NULL, checked_at = NULL, suspect_card = 0, suspect_screen = 0 WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
});
brandingRouter.post('/branding/retry-failed', can('performance.update'), async (req, res) => {
  const w = where(spec, req.query as Query);
  const r = await exec(`UPDATE branding_photos b JOIN riders r ON r.id = b.rider_id LEFT JOIN contracts k ON k.id = r.contract_id SET b.check_result = 'pending'${w.sql ? `${w.sql} AND` : ' WHERE'} b.check_result = 'failed'`, w.params);
  res.json({ queued: r.affectedRows });
});
brandingRouter.post('/branding/run-queue', can('performance.update'), async (_req, res) => res.json({ available: false }));
async function removePhotos(req: Request, ids: number[]) {
  if (!ids.length) fail(422, 'nothing_selected');
  if (ids.length > 500) fail(422, 'max_500');
  const r = await exec('DELETE FROM branding_photos WHERE id IN (?)', [ids]);
  await audit(req, { action: 'branding.delete', severity: 'warning', details: `${r.affectedRows} photos` });
  return r.affectedRows;
}
brandingRouter.delete('/branding/:id', can('performance.delete'), async (req, res) => res.json({ deleted: await removePhotos(req, [Number(req.params.id)]) }));
brandingRouter.post('/branding/bulk-delete', can('performance.delete'), async (req, res) => res.json({ deleted: await removePhotos(req, (req.body.ids ?? []).map(Number)) }));

// ---------- import: every row carries its own capture time; rider + time identify a photo ----------
const when = (v: unknown): string | null => {
  if (v instanceof Date) return new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace('T', ' ');
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 19).replace('T', ' ');
  const m = cellStr(v)?.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4].padStart(2, '0')}:${m[5]}:${m[6] ?? '00'}` : null;
};
export const brandingImport: ImportDef = {
  name: 'branding', perm: 'performance.import', matchOn: 'brand.match_on', options: ['skip_unknown', 'recheck_changed'], maxRows: 50000,
  columns: {
    rider_id: ['riders.rider_id', 'rider id', 'rider_id'], captured_at: ['brand.captured', 'created at', 'created_at', 'captured at'],
    photo_url: ['brand.photo', 'photo', 'photo url', 'image'], contract_name: ['brand.contract', 'contract name', 'contract'],
  },
  requiredColumns: [['rider_id'], ['captured_at'], ['photo_url']],
  async parse(row) {
    const s = cellStr(row.rider_id);
    const at = when(row.captured_at);
    const url = cellStr(row.photo_url, 1000);
    if (!s || !/^\d{1,20}$/.test(s) || !at || !url || !/^https?:\/\//i.test(url)) return 'unreadable_row';
    return { line: 0, key: `${s}|${at}`, data: { rider_id: Number(s), captured_at: at, photo_url: url, contract_name: cellStr(row.contract_name, 150) }, label: `#${s} ${at}` };
  },
  async existing(items, ctx) {
    ctx.cache.set('items', items);
    const m = new Map<string, any>();
    for (const i of items) { const x = await one('SELECT id, photo_url FROM branding_photos WHERE rider_id = ? AND captured_at = ?', [i.data.rider_id, i.data.captured_at]); if (x) m.set(i.key, x); }
    return m;
  },
  async counts(items, existing) {
    const ids = [...new Set(items.map((i) => i.data.rider_id))];
    const known = new Set(ids.length ? (await q<any>('SELECT id FROM riders WHERE id IN (?)', [ids])).map((r) => r.id) : []);
    const days = [...new Set(items.map((i) => i.data.captured_at.slice(0, 10)))];
    const recorded = days.length ? (await q<any>('SELECT DISTINCT DATE(captured_at) d FROM branding_photos WHERE DATE(captured_at) IN (?)', [days])).length : 0;
    const keys = new Set(items.map((i) => i.key));
    const wouldDelete = days.length ? (await q<any>('SELECT rider_id, captured_at FROM branding_photos WHERE DATE(captured_at) IN (?)', [days])).filter((p) => !keys.has(`${p.rider_id}|${p.captured_at}`)).length : 0;
    return { new_photos: items.filter((i) => !existing.has(i.key)).length, changed: items.filter((i) => existing.get(i.key) && existing.get(i.key).photo_url !== i.data.photo_url).length,
      unchanged: items.filter((i) => existing.get(i.key)?.photo_url === i.data.photo_url).length, would_delete: wouldDelete, recorded_days: recorded,
      unknown_riders: ids.filter((id) => !known.has(id)).length };
  },
  async write(it, ex, ctx) {
    const day = it.data.captured_at.slice(0, 10);
    // "Replace the day": the day's photos that are not in the file go, with their reviews
    if (ctx.mode === 'replace' && !ctx.cache.has(`cleared:${day}`)) {
      ctx.cache.set(`cleared:${day}`, true);
      const keep = (ctx.cache.get('items') as any[]).filter((i) => i.data.captured_at.startsWith(day)).map((i) => [i.data.rider_id, i.data.captured_at]);
      const r = await exec(`DELETE FROM branding_photos WHERE DATE(captured_at) = ?${keep.length ? ' AND (rider_id, captured_at) NOT IN (?)' : ''}`, keep.length ? [day, keep] : [day]);
      ctx.result.replaced_days = (ctx.result.replaced_days ?? 0) + r.affectedRows;
    }
    if (!(await one('SELECT 1 FROM riders WHERE id = ?', [it.data.rider_id]))) return 'skipped';
    if (ex) {
      if (ex.photo_url === it.data.photo_url) return 'skipped';
      const recheck = ctx.options.recheck_changed !== false;
      await exec(`UPDATE branding_photos SET photo_url = ?${recheck ? ", check_result = 'pending', measurements = NULL, checked_at = NULL" : ''} WHERE id = ?`, [it.data.photo_url, ex.id]);
      return 'replaced';
    }
    await exec('INSERT INTO branding_photos SET ?', [it.data]);
    ctx.result.queued = (ctx.result.queued ?? 0) + 1;
    return 'inserted';
  },
};
brandingRouter.use('/branding-import', importRoutes(brandingImport));
