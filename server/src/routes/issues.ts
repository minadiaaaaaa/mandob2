import { Router, type Request } from 'express';
import { exec, one, q, tx } from '../db.js';
import { clean, fail, fieldError, where, type Query, type Spec } from '../http.js';
import { can, has } from '../auth.js';
import { audit } from '../audit.js';
import { attachAny, upload } from '../files.js';

// 3.5 Rider issues: conversations with riders. The page polls for new messages.
// ponytail: no live socket and no "typing…" indicator; polling every few seconds. Add a WebSocket if it must be instant.
export const issuesRouter = Router();

const UNREAD = "(SELECT COUNT(*) FROM rider_issue_messages m WHERE m.issue_id = i.id AND m.author = 'rider' AND (i.staff_read_at IS NULL OR m.created_at > i.staff_read_at))";
const LAST = '(SELECT m.id FROM rider_issue_messages m WHERE m.issue_id = i.id ORDER BY m.id DESC LIMIT 1)';
const spec = (me: number): Spec => ({
  from: 'FROM rider_issues i JOIN riders r ON r.id = i.rider_id LEFT JOIN users ua ON ua.id = i.assignee_id',
  select: `i.*, r.full_name, ua.full_name assignee_name, ${UNREAD} unread,
    (SELECT LEFT(COALESCE(m.body, ''), 140) FROM rider_issue_messages m WHERE m.id = ${LAST}) last_body,
    (SELECT m.author FROM rider_issue_messages m WHERE m.id = ${LAST}) last_author,
    (SELECT m.internal FROM rider_issue_messages m WHERE m.id = ${LAST}) last_internal`,
  search: ['i.subject', 'r.full_name', 'CAST(r.id AS CHAR)'],
  filters: {
    status: (v) => (v === 'active' ? "i.status IN ('open','in_progress')" : ['i.status = ?', [v]]),
    category: (v) => ['i.category = ?', [v]], priority: (v) => ['i.priority = ?', [v]], rider: (v) => ['i.rider_id = ?', [v]],
    unread: () => `${UNREAD} > 0`,
    assignee: (v) => (v === 'mine' ? [`i.assignee_id = ?`, [me]] : v === 'unassigned' ? 'i.assignee_id IS NULL' : null),
  },
  sorts: { activity: 'i.last_activity_at' },
  defaultSort: '-activity',
});

issuesRouter.get('/issues', can('rider_portal.view_issues'), async (req, res) => {
  const query = req.query as Query;
  const s = spec(req.user!.id);
  const w = where(s, query, ['status', 'unread']);
  const [stats] = await q(`SELECT COALESCE(SUM(i.status = 'open'),0) open, COALESCE(SUM(i.status = 'in_progress'),0) in_progress,
    COALESCE(SUM(${UNREAD} > 0),0) unread, COALESCE(SUM(i.status = 'resolved'),0) resolved ${s.from}${w.sql}`, w.params);
  const wf = where(s, query);
  const page = Math.max(1, Number(query.page) || 1);
  const [{ n }] = await q<any>(`SELECT COUNT(*) n ${s.from}${wf.sql}`, wf.params);
  const rows = await q(`SELECT ${s.select} ${s.from}${wf.sql} ORDER BY i.last_activity_at DESC LIMIT 30 OFFSET ?`, [...wf.params, (page - 1) * 30]);
  res.json({ rows, total: Number(n), page, pageSize: 30, stats });
});

// The sidebar counter: conversations with unread rider messages.
export async function unreadIssues() {
  const [{ n }] = await q<any>(`SELECT COUNT(*) n FROM rider_issues i WHERE ${UNREAD} > 0`);
  return Number(n);
}

// Who a conversation can be assigned to. The full list needs the permission to view users.
issuesRouter.get('/issues/assignees', can('rider_portal.view_issues'), async (req, res) => {
  if (has(req, 'users.view')) return res.json(await q("SELECT id, full_name FROM users WHERE status = 'active' ORDER BY full_name"));
  res.json([{ id: req.user!.id, full_name: req.user!.full_name }]);
});

async function getIssue(id: unknown) {
  const i = await one<any>(`SELECT i.*, r.full_name, r.status rider_status, r.phone, co.name company_name, ci.name_ar city_ar, ci.name_en city_en,
    ua.full_name assignee_name, (SELECT COUNT(*) FROM rider_issue_messages WHERE issue_id = i.id) messages
    FROM rider_issues i JOIN riders r ON r.id = i.rider_id LEFT JOIN companies co ON co.id = r.company_id LEFT JOIN cities ci ON ci.id = r.city_id
    LEFT JOIN users ua ON ua.id = i.assignee_id WHERE i.id = ?`, [id]);
  if (!i) fail(404, 'not_found');
  return i;
}
// Messages with their files. `after` for polling, `before` for "Show earlier messages".
export async function messages(issueId: number, opts: { after?: number; before?: number; staff: boolean }) {
  const cond = opts.after ? 'AND m.id > ?' : opts.before ? 'AND m.id < ?' : '';
  const p = opts.after ?? opts.before;
  const rows = await q<any>(`SELECT m.id, m.author, m.body, m.internal, m.created_at, u.full_name user_name FROM rider_issue_messages m
    LEFT JOIN users u ON u.id = m.user_id WHERE m.issue_id = ? ${opts.staff ? '' : 'AND m.internal = 0'} ${cond}
    ORDER BY m.id DESC LIMIT 50`, p ? [issueId, p] : [issueId]);
  rows.reverse();
  const ids = rows.map((m) => String(m.id));
  const files = ids.length ? await q<any>("SELECT id, entity_id, attachment_type, file_name, mime, size FROM attachments WHERE entity_type = 'issue_message' AND entity_id IN (?)", [ids]) : [];
  return rows.map((m) => ({ ...m, files: files.filter((f) => f.entity_id === String(m.id)) }));
}

issuesRouter.get('/issues/:id', can('rider_portal.view_issues'), async (req, res) => {
  const i = await getIssue(req.params.id);
  const before = Number(req.query.before) || undefined;
  const after = Number(req.query.after) || undefined;
  res.json({ ...i, list: await messages(i.id, { before, after, staff: true }) });
});

// Read when the last message is on screen and the tab is visible.
issuesRouter.post('/issues/:id/read', can('rider_portal.view_issues'), async (req, res) => {
  await exec('UPDATE rider_issues SET staff_read_at = NOW(3) WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

export const files10 = upload.array('files', 10);
export async function addMessage(req: Request, issueId: number, author: 'rider' | 'staff', body: string | null, internal: boolean, userId: number | null) {
  const files = (req.files ?? []) as Express.Multer.File[];
  if (body && body.length > 5000) fieldError('body', 'too_long');
  if (!body?.trim() && !files.length) fieldError('body', 'message_empty');
  return tx(async () => {
    const m = await exec('INSERT INTO rider_issue_messages (issue_id, author, user_id, body, internal) VALUES (?, ?, ?, ?, ?)', [issueId, author, userId, body?.trim() || null, internal ? 1 : 0]);
    for (const f of files) await attachAny(null, 'issue_message', m.insertId, f, f.mimetype.startsWith('audio/') ? 'voice' : null, userId);
    await exec('UPDATE rider_issues SET last_activity_at = NOW(3) WHERE id = ?', [issueId]);
    return m.insertId;
  });
}

issuesRouter.post('/issues/:id/messages', can('rider_portal.manage_issues'), files10, async (req, res) => {
  const i = await getIssue(req.params.id);
  const internal = req.body.internal === '1' || req.body.internal === 'true';
  const id = await addMessage(req, i.id, 'staff', req.body.body ?? null, internal, req.user!.id);
  // the team's first public reply moves an open conversation to "In progress"
  if (!internal && i.status === 'open') await exec("UPDATE rider_issues SET status = 'in_progress' WHERE id = ?", [i.id]);
  await exec('UPDATE rider_issues SET staff_read_at = NOW(3) WHERE id = ?', [i.id]);
  res.json({ id });
});

issuesRouter.patch('/issues/:id', can('rider_portal.manage_issues'), async (req, res) => {
  const i = await getIssue(req.params.id);
  const v = clean(req.body, { status: { enum: ['open', 'in_progress', 'resolved', 'closed'] }, priority: { enum: ['low', 'normal', 'high', 'urgent'] }, assignee_id: { type: 'int' } }, true);
  if (v.assignee_id) {
    const u = await one<any>('SELECT status FROM users WHERE id = ?', [v.assignee_id]);
    if (!u || u.status !== 'active') fieldError('assignee_id', 'assignee_inactive');
  }
  if (v.status === 'resolved' && i.status !== 'resolved') v.resolved_at = new Date();
  if (v.status === 'closed' && i.status !== 'closed') v.closed_at = new Date();
  if (Object.keys(v).length) await exec('UPDATE rider_issues SET ? WHERE id = ?', [v, i.id]);
  await audit(req, { action: 'issue.update', entity_type: 'issue', entity_id: i.id, before: { status: i.status, priority: i.priority, assignee_id: i.assignee_id }, after: v });
  res.json({ ok: true });
});

// A conversation the team opens with a rider starts "In progress".
issuesRouter.post('/issues', can('rider_portal.manage_issues'), files10, async (req, res) => {
  const v = clean(req.body, {
    rider_id: { req: true, type: 'int' }, subject: { req: true, minLen: 3, max: 200 },
    category: { enum: ['account', 'performance', 'attendance', 'payment', 'vehicle', 'app', 'other'] }, priority: { enum: ['low', 'normal', 'high', 'urgent'] },
  });
  if (!(await one('SELECT 1 FROM riders WHERE id = ?', [v.rider_id]))) fieldError('rider_id', 'rider_not_found');
  const id = await tx(async () => {
    const r = await exec("INSERT INTO rider_issues SET ?, status = 'in_progress', opened_by = 'staff', staff_read_at = NOW(3)", [{ ...v, created_by: req.user!.id, assignee_id: req.user!.id }]);
    await addMessage(req, r.insertId, 'staff', req.body.body ?? null, false, req.user!.id);
    return r.insertId;
  });
  await audit(req, { action: 'issue.create', entity_type: 'issue', entity_id: id, after: v });
  res.json({ id });
});

// ---------- used by the rider portal (chapter 12) ----------
export async function riderMessage(req: Request, issueId: number, riderId: number) {
  const i = await one<any>('SELECT * FROM rider_issues WHERE id = ? AND rider_id = ?', [issueId, riderId]);
  if (!i) fail(404, 'not_found');
  if (i.status === 'closed') fail(409, 'issue_closed');
  const id = await addMessage(req, i.id, 'rider', req.body.body ?? null, false, null);
  // a rider's reply reopens a resolved conversation
  if (i.status === 'resolved') await exec("UPDATE rider_issues SET status = 'open', resolved_at = NULL WHERE id = ?", [i.id]);
  return id;
}
