import { asSystem } from '../db.js';
import { Router, type Request } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STORAGE_DIR, exec, one, q, setSetting, setting, tx } from '../db.js';
import { addDays, clean, daysBetween, eq, fail, fieldError, inList, list, listAll, sendExport, today, where, type Query, type Spec } from '../http.js';
import { can, has } from '../auth.js';
import { audit } from '../audit.js';
import { attach, removeAttachment, upload } from '../files.js';
import { notifyUsers } from '../notify.js';

// 3.1 Rider leaves: the office's request letter to the delivery company, then the company's answer.
export const leavesRouter = Router();

const TYPES = ['emergency', 'annual', 'sick', 'unpaid', 'other'] as const;
const LIVE = "('pending','approved')";

const spec = (day: string): Spec => ({
  from: `FROM leaves l JOIN riders r ON r.id = l.rider_id LEFT JOIN companies co ON co.id = r.company_id
    LEFT JOIN users ua ON ua.id = l.answered_by LEFT JOIN users uc ON uc.id = l.created_by`,
  select: `l.*, r.full_name, r.national_id, co.name company_name, ua.full_name answered_by_name, uc.full_name created_by_name,
    DATEDIFF(l.end_date, l.start_date) + 1 days, (l.status = 'approved' AND '${day}' BETWEEN l.start_date AND l.end_date) on_leave`,
  search: ['r.full_name', 'r.alias', 'CAST(r.id AS CHAR)', 'r.national_id', 'l.letter_no', 'l.reason'],
  filters: {
    status: inList('l.status'), type: eq('l.leave_type'), source: eq('l.source'), rider: eq('l.rider_id'),
    // a leave shows when any of its days falls in the period
    from: (v) => ['l.end_date >= ?', [v]], to: (v) => ['l.start_date <= ?', [v]],
  },
  sorts: { letter: 'l.seq_year, l.seq', rider: 'r.full_name', date: 'l.start_date', status: 'l.status', created: 'l.created_at' },
  defaultSort: '-date',
});

leavesRouter.get('/leaves', can('leaves.view'), async (req, res) => {
  const day = await today();
  const s = spec(day);
  const query = req.query as Query;
  const w = where(s, query);
  const [stats] = await q(`SELECT COALESCE(SUM(l.status = 'pending'),0) awaiting, COALESCE(SUM(l.status = 'pending' AND l.source = 'rider'),0) rider_pending,
    COALESCE(SUM(l.status = 'approved' AND ? BETWEEN l.start_date AND l.end_date),0) on_leave,
    COALESCE(SUM(l.status IN ${LIVE} AND l.start_date BETWEEN ? AND ?),0) starting_soon, COALESCE(SUM(l.status = 'approved'),0) approved,
    COALESCE(SUM(l.status = 'rejected'),0) rejected ${s.from}${w.sql}`, [day, day, addDays(day, 7), ...w.params]);
  res.json({ ...(await list(s, query)), stats });
});

leavesRouter.get('/leaves/export', can('leaves.export'), async (req, res) => {
  const rows = await listAll(spec(await today()), req.query as Query);
  await sendExport(req, res, { format: 'csv', title: 'leaves.title', rows, cols: [
    { key: 'letter_no', label: 'leaves.letter_no' }, { key: 'rider_id', label: 'riders.rider_id' }, { key: 'full_name', label: 'leaves.rider' },
    { key: 'leave_type', label: 'leaves.type' }, { key: 'start_date', label: 'leaves.from' }, { key: 'end_date', label: 'leaves.to' }, { key: 'days', label: 'leaves.days' },
    { key: 'reason', label: 'leaves.reason' }, { key: 'status', label: 'leaves.status' }, { key: 'answer_note', label: 'leaves.answer' },
    { key: 'source', label: 'leaves.source' }, { key: 'created_at', label: 'leaves.created' },
  ] });
});

// ---------- letter settings (before /leaves/:id) ----------
const IMG = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
async function settingsOut() {
  const imgs = await q<any>("SELECT id, attachment_type FROM attachments WHERE entity_type = 'organization' AND is_current = 1 AND attachment_type IN ('leave_logo','leave_stamp','leave_signature')");
  const has_ = (t: string) => imgs.find((i) => i.attachment_type === t)?.id ?? null;
  return {
    establishment_name: (await setting('leave.establishment_name')) ?? '', default_reason: (await setting('leave.default_reason')) ?? '',
    email_requires_file: (await setting('leave.email_requires_file')) === '1', auto_stamp: (await setting('leave.auto_stamp')) === '1',
    logo: has_('leave_logo'), stamp: has_('leave_stamp'), signature: has_('leave_signature'),
  };
}
leavesRouter.get('/leaves/settings', can('leaves.view'), async (_req, res) => res.json(await settingsOut()));
leavesRouter.patch('/leaves/settings', can('leaves.settings', 'leaves.stamp'), async (req, res) => {
  const v = clean(req.body, { establishment_name: { max: 150 }, default_reason: { max: 500 }, email_requires_file: { type: 'bool' }, auto_stamp: { type: 'bool' } }, true);
  const settingsOnly = ['establishment_name', 'default_reason', 'email_requires_file'];
  if (settingsOnly.some((k) => k in v) && !has(req, 'leaves.settings')) fail(403, 'forbidden', { perm: 'leaves.settings' });
  if ('default_reason' in v && !v.default_reason) fieldError('default_reason', 'required');
  if ('auto_stamp' in v) {
    if (!has(req, 'leaves.stamp')) fail(403, 'forbidden', { perm: 'leaves.stamp' });
    const s = await settingsOut();
    if (v.auto_stamp && !(s.stamp && s.signature)) fieldError('auto_stamp', 'stamp_images_needed');
  }
  for (const [k, val] of Object.entries(v)) await setSetting(`leave.${k}`, typeof val === 'number' ? String(val) : val ?? '');
  await audit(req, { action: 'leave.settings', after: v });
  res.json(await settingsOut());
});
leavesRouter.post('/leaves/settings/image/:type', can('leaves.settings', 'leaves.stamp'), upload.single('file'), async (req, res) => {
  const type = req.params.type as string;
  if (!['logo', 'stamp', 'signature'].includes(type)) fail(404, 'not_found');
  if (!has(req, type === 'logo' ? 'leaves.settings' : 'leaves.stamp')) fail(403, 'forbidden', { perm: type === 'logo' ? 'leaves.settings' : 'leaves.stamp' });
  if (!req.file) fail(422, 'file_required');
  if (!(req.file!.mimetype in IMG)) fail(415, 'file_type_not_allowed');
  if (req.file!.size > (type === 'logo' ? 2 : 5) * 1024 * 1024) fail(413, 'file_too_large', { max: type === 'logo' ? 2 : 5 });
  // ponytail: the stamp and signature are kept as uploaded; the white paper is not removed. Add an image library if that matters.
  await attach(req, 'organization', 1, req.file!, `leave_${type}`, null);
  res.json(await settingsOut());
});
leavesRouter.delete('/leaves/settings/image/:type', can('leaves.settings', 'leaves.stamp'), async (req, res) => {
  const type = req.params.type as string;
  if (!['logo', 'stamp', 'signature'].includes(type)) fail(404, 'not_found');
  if (!has(req, type === 'logo' ? 'leaves.settings' : 'leaves.stamp')) fail(403, 'forbidden', { perm: type === 'logo' ? 'leaves.settings' : 'leaves.stamp' });
  for (const a of await q<any>("SELECT id FROM attachments WHERE entity_type = 'organization' AND attachment_type = ?", [`leave_${type}`])) await removeAttachment(a.id);
  // deleting the stamp or the signature switches automatic stamping off
  if (type !== 'logo') await setSetting('leave.auto_stamp', '0');
  await audit(req, { action: 'leave.settings_image_delete', details: type, severity: 'warning' });
  res.json(await settingsOut());
});

// ---------- the letter ----------
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
async function dataUri(type: string) {
  const a = await one<any>("SELECT stored_name, mime FROM attachments WHERE entity_type = 'organization' AND is_current = 1 AND attachment_type = ?", [type]);
  if (!a || !existsSync(join(STORAGE_DIR, a.stored_name))) return null;
  return `data:${a.mime};base64,${readFileSync(join(STORAGE_DIR, a.stored_name)).toString('base64')}`;
}
const TYPE_AR: Record<string, string> = { emergency: 'إجازة اضطرارية', annual: 'إجازة سنوية', sick: 'إجازة مرضية', unpaid: 'إجازة بدون راتب', other: 'إجازة' };
export const autoParagraph = (l: { leave_type: string; days: number; start_date: string; end_date: string; reason: string }) =>
  `نأمل منكم التكرم بالموافقة على منح المندوب الموضحة بياناته أعلاه ${TYPE_AR[l.leave_type]} لمدة ${l.days} ${l.days === 1 ? 'يوم' : l.days <= 10 ? 'أيام' : 'يوماً'}` +
  (l.days === 1 ? ` بتاريخ ${l.start_date}` : ` اعتباراً من ${l.start_date} حتى ${l.end_date}`) + `، وذلك بسبب ${l.reason}.`;

type LetterData = {
  letter_no: string | null; created_at?: string; rider_id: number; full_name: string; national_id: string | null; company_name: string | null;
  leave_type: string; start_date: string; end_date: string; reason: string; reason_paragraph: string | null; stamped?: number;
};
export async function letterHtml(l: LetterData, sample = false) {
  const days = daysBetween(l.start_date, l.end_date) + 1;
  const org = (await setting('leave.establishment_name')) || (await setting('org.name')) || '';
  const logo = (await dataUri('leave_logo')) ?? (await dataUri('logo'));
  const stamp = l.stamped ? await dataUri('leave_stamp') : null;
  const sign = l.stamped ? await dataUri('leave_signature') : null;
  const date = (l.created_at ?? (await today())).slice(0, 10);
  const row = (k: string, v: unknown) => `<tr><th>${k}</th><td>${esc(v) || '—'}</td></tr>`;
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(l.letter_no ?? '')}</title><style>
  @page { size: A4; margin: 18mm; }
  body { font-family: "IBM Plex Sans Arabic", "Segoe UI", Tahoma, sans-serif; color: #111; font-size: 14px; line-height: 1.9; margin: 0; }
  .page { max-width: 180mm; margin: 0 auto; padding: 8mm 0; position: relative; }
  .head { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0f766e; padding-bottom: 8px; margin-bottom: 18px; }
  .head img { max-height: 70px; max-width: 200px; }
  .meta { font-size: 12px; text-align: left; direction: ltr; }
  .basmala { text-align: center; font-size: 16px; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; margin: 14px 0; }
  th, td { border: 1px solid #999; padding: 6px 10px; text-align: right; }
  th { background: #f1f5f9; width: 32%; font-weight: 600; }
  .sign { margin-top: 36px; display: flex; justify-content: flex-start; gap: 24px; align-items: flex-end; min-height: 110px; }
  .sign img { max-height: 110px; max-width: 160px; }
  .sample { position: absolute; inset: 35% 0 auto; text-align: center; font-size: 90px; color: rgba(220,38,38,.18); transform: rotate(-20deg); pointer-events: none; }
  </style></head><body><div class="page">
  ${sample ? '<div class="sample">نموذج</div>' : ''}
  <div class="head">${logo ? `<img src="${logo}" alt="">` : '<div></div>'}<div class="meta">No: ${esc(l.letter_no ?? '—')}<br>Date: ${date}</div></div>
  ${logo ? '' : '<div class="basmala">بسم الله الرحمن الرحيم</div>'}
  <p>السادة / ${esc(l.company_name || 'شركة التوصيل')} المحترمين</p>
  <p>السلام عليكم ورحمة الله وبركاته، وبعد:</p>
  <p><b>الموضوع: طلب ${TYPE_AR[l.leave_type]} للمندوب ${esc(l.full_name)}</b></p>
  <table>${row('اسم المندوب', l.full_name)}${row('رقم المندوب', l.rider_id)}${row('رقم الإقامة / الهوية', l.national_id)}${row('نوع الإجازة', TYPE_AR[l.leave_type])}
  ${row('من تاريخ', l.start_date)}${row('إلى تاريخ', l.end_date)}${row('عدد الأيام', days)}${row('السبب', l.reason)}</table>
  <p>${esc(l.reason_paragraph || autoParagraph({ ...l, days }))}</p>
  <p>وتقبلوا فائق الاحترام والتقدير،</p>
  <p><b>${esc(org)}</b></p>
  <div class="sign">${stamp ? `<img src="${stamp}" alt="">` : ''}${sign ? `<img src="${sign}" alt="">` : ''}</div>
  </div></body></html>`;
}

leavesRouter.get('/leaves/settings/sample', can('leaves.view'), async (_req, res) => {
  const day = await today();
  const s = await settingsOut();
  res.type('html').send(await letterHtml({ letter_no: 'LV-0000-0000', rider_id: 4000000, full_name: 'محمد أحمد', national_id: '2000000000', company_name: null,
    leave_type: 'emergency', start_date: day, end_date: addDays(day, 2), reason: s.default_reason, reason_paragraph: null, stamped: s.auto_stamp ? 1 : 0 }, true));
});

// The preview while creating or editing: nothing is saved.
leavesRouter.post('/leaves/preview', can('leaves.create', 'leaves.update'), async (req, res) => {
  const b = req.body ?? {};
  const r = b.rider_id ? await one<any>('SELECT r.id, r.full_name, r.national_id, co.name company_name FROM riders r LEFT JOIN companies co ON co.id = r.company_id WHERE r.id = ?', [b.rider_id]) : null;
  const day = await today();
  const start = /^\d{4}-\d{2}-\d{2}$/.test(b.start_date ?? '') ? b.start_date : day;
  const end = /^\d{4}-\d{2}-\d{2}$/.test(b.end_date ?? '') && b.end_date >= start ? b.end_date : start;
  res.type('html').send(await letterHtml({
    letter_no: b.letter_no ?? null, rider_id: r?.id ?? 0, full_name: r?.full_name ?? '—', national_id: r?.national_id ?? null, company_name: r?.company_name ?? null,
    leave_type: TYPES.includes(b.leave_type) ? b.leave_type : 'emergency', start_date: start, end_date: end, reason: String(b.reason ?? '').slice(0, 500),
    reason_paragraph: b.reason_paragraph ? String(b.reason_paragraph).slice(0, 1000) : null, stamped: b.stamped ? 1 : 0,
  }));
});

// ---------- one request ----------
async function getLeave(id: unknown) {
  const l = await one<any>(`SELECT ${spec('1970-01-01').select} ${spec('1970-01-01').from} WHERE l.id = ?`, [id]);
  if (!l) fail(404, 'not_found');
  return l;
}
leavesRouter.get('/leaves/:id', can('leaves.view'), async (req, res) => {
  const l = await getLeave(req.params.id);
  res.json({ ...l, auto_paragraph: autoParagraph(l) });
});

leavesRouter.get('/leaves/:id/letter', can('leaves.view'), async (req, res) => {
  const l = await getLeave(req.params.id);
  const html = await letterHtml(l);
  if (req.query.download === 'doc') {
    if (!has(req, 'leaves.print')) fail(403, 'forbidden', { perm: 'leaves.print' });
    await audit(req, { action: 'leave.letter_download', entity_type: 'leave', entity_id: l.id, details: `${l.letter_no}${l.stamped ? ' (stamped)' : ''}` });
    // Word opens an HTML document saved with the .doc extension.
    res.setHeader('Content-Type', 'application/msword');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${l.full_name} ${l.letter_no}.doc`)}`);
    return res.send(html);
  }
  if (req.query.print) await audit(req, { action: 'leave.letter_print', entity_type: 'leave', entity_id: l.id, details: l.letter_no });
  res.type('html').send(html);
});

const RULES = {
  rider_id: { req: true, type: 'int' as const }, start_date: { req: true, type: 'date' as const }, end_date: { type: 'date' as const },
  leave_type: { req: true, enum: TYPES }, reason: { req: true, max: 500 }, reason_paragraph: { max: 1000 }, internal_note: { max: 4000 },
};
export async function overlap(riderId: number, start: string, end: string, except = 0) {
  const o = await one<any>(`SELECT letter_no, start_date FROM leaves WHERE rider_id = ? AND id <> ? AND status IN ${LIVE} AND start_date <= ? AND end_date >= ?`, [riderId, except, end, start]);
  if (o) fieldError('start_date', 'leave_overlap', { letter: o.letter_no, date: o.start_date });
}
// The stamp is placed when the option is on, both images exist, the user may stamp, and the request is live.
async function stampFor(req: Request, status: string) {
  const s = await settingsOut();
  return s.auto_stamp && s.stamp && s.signature && has(req, 'leaves.stamp') && ['pending', 'approved'].includes(status) ? 1 : 0;
}
export async function createLeave(req: Request | null, v: Record<string, any>, source: 'office' | 'rider') {
  const year = Number(v.start_date.slice(0, 4));
  return tx(async () => {
    await q('SELECT pg_advisory_xact_lock(41002, ?::int)', [year]);
    const [{ n }] = await asSystem(() => q<any>('SELECT COALESCE(MAX(seq), 0) + 1 n FROM leaves WHERE seq_year = ?', [year]));
    const letter_no = `LV-${year}-${String(n).padStart(4, '0')}`;
    const stamped = req && source === 'office' ? await stampFor(req, 'pending') : 0;
    const r = await exec('INSERT INTO leaves SET ?', [{ ...v, seq_year: year, seq: n, letter_no, source, stamped, created_by: source === 'office' ? req?.user?.id ?? null : null }]);
    return { id: r.insertId, letter_no };
  });
}

leavesRouter.post('/leaves', can('leaves.create'), async (req, res) => {
  const v = clean(req.body, RULES);
  v.end_date ??= v.start_date;
  if (v.end_date < v.start_date) fieldError('end_date', 'end_before_start');
  const r = await one<any>('SELECT status FROM riders WHERE id = ?', [v.rider_id]);
  if (!r) fieldError('rider_id', 'rider_not_found');
  if (r.status === 'terminated') fieldError('rider_id', 'rider_terminated');
  await overlap(v.rider_id, v.start_date, v.end_date);
  const out = await createLeave(req, v, 'office');
  await audit(req, { action: 'leave.create', entity_type: 'leave', entity_id: out.id, after: { ...v, letter_no: out.letter_no } });
  res.json(out);
});

leavesRouter.patch('/leaves/:id', can('leaves.update'), async (req, res) => {
  const before = await one<any>('SELECT * FROM leaves WHERE id = ?', [req.params.id]);
  if (!before) fail(404, 'not_found');
  // After the answer only the texts can change; the rider never changes.
  const rules = before.status === 'pending' ? { ...RULES } : { reason: RULES.reason, reason_paragraph: RULES.reason_paragraph, internal_note: RULES.internal_note };
  delete (rules as any).rider_id;
  const v = clean(req.body, rules, true);
  if ('reason' in v && !v.reason) fieldError('reason', 'required');
  const start = v.start_date ?? before.start_date;
  const end = 'end_date' in v ? v.end_date ?? start : before.end_date < start ? start : before.end_date;
  if (end < start) fieldError('end_date', 'end_before_start');
  if (before.status === 'pending') { v.start_date = start; v.end_date = end; await overlap(before.rider_id, start, end, before.id); }
  v.stamped = await stampFor(req, before.status);
  await exec('UPDATE leaves SET ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [v, before.id]);
  await audit(req, { action: 'leave.update', entity_type: 'leave', entity_id: before.id, before, after: v });
  res.json({ ok: true });
});

leavesRouter.post('/leaves/:id/answer', can('leaves.approve'), async (req, res) => {
  const v = clean(req.body, { decision: { req: true, enum: ['approved', 'rejected'] }, note: { max: 500 } });
  const l = await one<any>('SELECT * FROM leaves WHERE id = ?', [req.params.id]);
  if (!l) fail(404, 'not_found');
  if (l.status !== 'pending') fail(409, 'leave_already_answered');
  await exec('UPDATE leaves SET status = ?, answer_note = ?, answered_by = ?, answered_at = UTC_TIMESTAMP() WHERE id = ?', [v.decision, v.note ?? null, req.user!.id, l.id]);
  await audit(req, { action: `leave.${v.decision}`, entity_type: 'leave', entity_id: l.id, details: v.note });
  res.json({ ok: true });
});

leavesRouter.post('/leaves/:id/cancel', can('leaves.cancel'), async (req, res) => {
  const v = clean(req.body, { note: { max: 500 } });
  const l = await one<any>('SELECT * FROM leaves WHERE id = ?', [req.params.id]);
  if (!l) fail(404, 'not_found');
  if (!['pending', 'approved'].includes(l.status)) fail(409, 'leave_cannot_cancel');
  await exec("UPDATE leaves SET status = 'cancelled', answer_note = COALESCE(?, answer_note), answered_by = ?, answered_at = UTC_TIMESTAMP() WHERE id = ?", [v.note ?? null, req.user!.id, l.id]);
  await audit(req, { action: 'leave.cancel', entity_type: 'leave', entity_id: l.id, details: v.note, severity: 'warning' });
  res.json({ ok: true });
});

leavesRouter.delete('/leaves/:id', can('leaves.delete'), async (req, res) => {
  const l = await one<any>('SELECT * FROM leaves WHERE id = ?', [req.params.id]);
  if (!l) fail(404, 'not_found');
  if (l.status !== 'pending') fail(409, 'leave_answered_cancel_instead');
  await exec('DELETE FROM leaves WHERE id = ?', [l.id]);
  await audit(req, { action: 'leave.delete', entity_type: 'leave', entity_id: l.id, before: l, severity: 'critical' });
  res.json({ ok: true });
});

// A request filed from the rider portal (chapter 12) reaches the admin users in the app.
export async function leaveFromRider(riderId: number, v: Record<string, any>) {
  const out = await createLeave(null, v, 'rider');
  await notifyUsers('all', { category: 'general', severity: 'info', title: 'note.leave_from_rider', params: { letter: out.letter_no }, entity_type: 'leave', entity_id: out.id, link: `/admin/leaves/${out.id}` });
  return out;
}
