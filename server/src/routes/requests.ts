import { Router, type Request } from 'express';
import { exec, one, q, tx } from '../db.js';
import { clean, eq, fail, fieldError, list, where, type Query, type Spec } from '../http.js';
import { can } from '../auth.js';
import { audit } from '../audit.js';
import { copyAttachment } from '../files.js';

// 3.4 Data change requests from the rider portal. Nothing changes in the rider's record before approval.
export const requestsRouter = Router();

const FILES = "(SELECT COUNT(*) FROM attachments WHERE entity_type = 'change_request' AND entity_id = cr.id)";
const spec: Spec = {
  from: 'FROM rider_change_requests cr JOIN riders r ON r.id = cr.rider_id LEFT JOIN users u ON u.id = cr.reviewed_by',
  select: `cr.*, r.full_name, u.full_name reviewed_by_name, ${FILES} files`,
  search: ['r.full_name', 'CAST(r.id AS CHAR)'],
  filters: {
    status: (v) => (v === 'any' ? null : ['cr.status = ?', [v]]), type: eq('cr.type'), doc_type: eq('cr.doc_type'), rider: eq('cr.rider_id'),
    from: (v) => ['cr.created_at >= ?', [v]], to: (v) => ['cr.created_at < DATE_ADD(?, INTERVAL 1 DAY)', [v]],
  },
  sorts: { submitted: 'cr.created_at' },
  defaultSort: '-submitted',
};

requestsRouter.get('/change-requests', can('rider_portal.view_requests'), async (req, res) => {
  const query = req.query as Query;
  const w = where(spec, query, ['status']); // the cards are themselves the status filter
  const [stats] = await q(`SELECT COALESCE(SUM(cr.status = 'pending'),0) pending, COALESCE(SUM(cr.status = 'approved'),0) approved,
    COALESCE(SUM(cr.status = 'rejected'),0) rejected ${spec.from}${w.sql}`, w.params);
  res.json({ ...(await list(spec, query)), stats });
});

// The values the request would replace, read from the rider's record now.
async function currentValues(cr: any) {
  if (cr.type === 'contact') return one<any>('SELECT phone, email FROM riders WHERE id = ?', [cr.rider_id]);
  if (cr.type === 'document' && cr.doc_type !== 'other') {
    const d = await one<any>(`SELECT d.id, CASE WHEN d.doc_type = 'id' THEN r.national_id ELSE d.doc_number END doc_number, d.issue_date, d.expiry_date
      FROM rider_documents d JOIN riders r ON r.id = d.rider_id WHERE d.rider_id = ? AND d.doc_type = ? AND d.is_current = 1`, [cr.rider_id, cr.doc_type]);
    return d ?? null;
  }
  return null;
}
const parse = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);

requestsRouter.get('/change-requests/:id', can('rider_portal.view_requests'), async (req, res) => {
  const cr = await one<any>(`SELECT ${spec.select}, r.status rider_status, r.phone, co.name company_name ${spec.from} LEFT JOIN companies co ON co.id = r.company_id WHERE cr.id = ?`, [req.params.id]);
  if (!cr) fail(404, 'not_found');
  const files = await q("SELECT id, attachment_type, file_name, mime, size FROM attachments WHERE entity_type = 'change_request' AND entity_id = ? ORDER BY id", [String(cr.id)]);
  const photo = await one<any>("SELECT id FROM attachments WHERE entity_type = 'rider' AND entity_id = ? AND attachment_type = 'photo' AND is_current = 1", [String(cr.rider_id)]);
  res.json({ ...cr, payload: parse(cr.payload), snapshot: parse(cr.snapshot), current: await currentValues(cr), files, current_photo: photo?.id ?? null });
});

async function pending(id: unknown) {
  const cr = await one<any>('SELECT * FROM rider_change_requests WHERE id = ?', [id]);
  if (!cr) fail(404, 'not_found');
  // reviewed by someone else meanwhile, or withdrawn by the rider
  if (cr.status !== 'pending') fail(409, 'request_not_pending');
  return { ...cr, payload: parse(cr.payload) };
}

async function apply(req: Request, cr: any) {
  const files = await q<any>("SELECT id, attachment_type FROM attachments WHERE entity_type = 'change_request' AND entity_id = ?", [String(cr.id)]);
  const by = req.user!.id;
  if (cr.type === 'contact') {
    const set = Object.fromEntries(Object.entries(cr.payload).filter(([k, v]) => ['phone', 'email'].includes(k) && v));
    if (Object.keys(set).length) await exec('UPDATE riders SET ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [set, cr.rider_id]);
  } else if (cr.type === 'photo') {
    const f = files.find((x) => x.attachment_type === 'photo') ?? files[0];
    if (f) await copyAttachment(f.id, 'rider', cr.rider_id, 'photo', by);
  } else {
    const doc = cr.doc_type === 'other' ? null : await one<any>('SELECT id FROM rider_documents WHERE rider_id = ? AND doc_type = ? AND is_current = 1', [cr.rider_id, cr.doc_type]);
    if (doc) {
      // the ID number itself never changes from a request: only its dates and files
      const set: Record<string, unknown> = {};
      if (cr.payload.doc_number && cr.doc_type !== 'id') set.doc_number = cr.payload.doc_number;
      if (cr.payload.issue_date) set.issue_date = cr.payload.issue_date;
      if (cr.payload.expiry_date) { set.expiry_date = cr.payload.expiry_date; set.status = 'valid'; }
      if (Object.keys(set).length) await exec('UPDATE rider_documents SET ? WHERE id = ?', [set, doc.id]);
      for (const f of files) await copyAttachment(f.id, `rider_doc_${cr.doc_type}`, doc.id, null, by);
    } else {
      // no document of this type: the files are kept on the rider, and no document is created
      for (const f of files) await copyAttachment(f.id, 'rider', cr.rider_id, `doc_${cr.doc_type}`, by);
    }
  }
}

requestsRouter.post('/change-requests/:id/approve', can('rider_portal.review_requests'), async (req, res) => {
  const v = clean(req.body, { note: { max: 500 } });
  const cr = await pending(req.params.id);
  try {
    await tx(async () => {
      await apply(req, cr);
      await exec("UPDATE rider_change_requests SET status = 'approved', review_note = ?, reviewed_by = ?, reviewed_at = UTC_TIMESTAMP() WHERE id = ?", [v.note ?? null, req.user!.id, cr.id]);
    });
  } catch (e: any) {
    if (e?.code === 'ER_DUP_ENTRY') fail(409, 'request_value_taken');
    throw e;
  }
  await audit(req, { action: 'change_request.approve', entity_type: 'rider', entity_id: cr.rider_id, after: cr.payload, details: `#${cr.id} ${cr.type}` });
  res.json({ ok: true });
});

requestsRouter.post('/change-requests/:id/reject', can('rider_portal.review_requests'), async (req, res) => {
  const v = clean(req.body, { note: { max: 500 } });
  if (!v.note) fieldError('note', 'reject_note_required');
  const cr = await pending(req.params.id);
  await exec("UPDATE rider_change_requests SET status = 'rejected', review_note = ?, reviewed_by = ?, reviewed_at = UTC_TIMESTAMP() WHERE id = ?", [v.note, req.user!.id, cr.id]);
  await audit(req, { action: 'change_request.reject', entity_type: 'rider', entity_id: cr.rider_id, details: `#${cr.id}: ${v.note}` });
  res.json({ ok: true });
});

// Filed from the rider portal (chapter 12): one pending request of each type at a time.
export async function fileChangeRequest(riderId: number, r: { type: 'contact' | 'photo' | 'document'; doc_type?: string | null; payload: Record<string, unknown>; rider_note?: string | null }) {
  const dup = await one('SELECT 1 FROM rider_change_requests WHERE rider_id = ? AND type = ? AND status = ?', [riderId, r.type, 'pending']);
  if (dup) fail(409, 'request_pending_exists');
  const snapshot = await currentValues({ rider_id: riderId, type: r.type, doc_type: r.doc_type });
  const ins = await exec('INSERT INTO rider_change_requests SET ?', [{ rider_id: riderId, type: r.type, doc_type: r.doc_type ?? null,
    payload: JSON.stringify(r.payload), snapshot: snapshot ? JSON.stringify(snapshot) : null, rider_note: r.rider_note ?? null }]);
  return ins.insertId;
}
