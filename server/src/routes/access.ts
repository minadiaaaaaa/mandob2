import { Router } from 'express';
import { isIP } from 'node:net';
import { exec, one, q, tx } from '../db.js';
import { clean, eq, fail, fieldError, list, listAll, sendExport, type Spec } from '../http.js';
import { can, clientIp, has, hashPassword } from '../auth.js';
import { audit } from '../audit.js';
import { ADMIN_PERMS, ALL_PERMS, MATRIX } from '../perms.js';

export const accessRouter = Router();

// ---------- the "never without an administrator" rules ----------
// Holders of a permission = active users on active roles that hold it.
async function holders(perm: string, excludeUser?: number, excludeRole?: number) {
  const [{ n }] = await q<{ n: number }>(`SELECT COUNT(*) n FROM users u JOIN roles r ON r.id = u.role_id AND r.is_active = 1
    JOIN role_permissions rp ON rp.role_id = r.id AND rp.perm = ? WHERE u.status = 'active' AND u.id <> ? AND r.id <> ?`, [perm, excludeUser ?? 0, excludeRole ?? 0]);
  return n;
}
async function isLastManager(userId: number) {
  const u = await one<any>(`SELECT u.status, r.is_active, EXISTS(SELECT 1 FROM role_permissions WHERE role_id = u.role_id AND perm = 'users.update') p FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`, [userId]);
  return !!u && u.status === 'active' && !!u.is_active && !!u.p && (await holders('users.update', userId)) === 0;
}
// Administrative permissions this role alone holds among active roles with active users.
async function protectedPerms(roleId: number) {
  const out: string[] = [];
  for (const p of ADMIN_PERMS) {
    const mine = await one(`SELECT 1 FROM role_permissions rp JOIN roles r ON r.id = rp.role_id AND r.is_active = 1 WHERE rp.role_id = ? AND rp.perm = ?
      AND EXISTS (SELECT 1 FROM users WHERE role_id = r.id AND status = 'active')`, [roleId, p]);
    if (mine && (await holders(p, undefined, roleId)) === 0) out.push(p);
  }
  return out;
}

// ---------- users ----------
const usersSpec: Spec = {
  from: 'FROM users u JOIN roles r ON r.id = u.role_id',
  select: 'u.id, u.username, u.full_name, u.email, u.status, u.last_login_at, u.created_at, u.role_id, r.name role_name',
  search: ['u.username', 'u.full_name', 'u.email'],
  filters: { role: eq('u.role_id'), status: eq('u.status') },
  sorts: { account: 'u.full_name', status: 'u.status', last_login: 'u.last_login_at', created: 'u.created_at' },
  defaultSort: 'account',
};
const userRules = {
  username: { req: true, max: 50, minLen: 3 }, full_name: { req: true, max: 150 }, email: { req: true, type: 'email' as const, max: 150 },
  role_id: { req: true, type: 'int' as const }, status: { enum: ['active', 'disabled', 'locked'] },
};
async function checkUnique(v: Record<string, any>, id = 0) {
  if (v.username && !/^[A-Za-z0-9._-]{3,50}$/.test(v.username)) fieldError('username', 'username_format');
  if (v.username && (await one('SELECT 1 FROM users WHERE username = ? AND id <> ?', [v.username, id]))) fieldError('username', 'username_taken');
  if (v.email && (await one('SELECT 1 FROM users WHERE email = ? AND id <> ?', [v.email, id]))) fieldError('email', 'email_taken');
  if (v.role_id && !(await one('SELECT 1 FROM roles WHERE id = ? AND is_active = 1', [v.role_id]))) fieldError('role_id', 'role_inactive');
}

accessRouter.get('/users', can('users.view'), async (req, res) => {
  if (req.query.role && !has(req, 'roles.view')) delete req.query.role;
  res.json(await list(usersSpec, req.query as any));
});
accessRouter.get('/users/export', can('users.export'), async (req, res) => {
  const rows = await listAll(usersSpec, req.query as any);
  await sendExport(req, res, { format: 'csv', title: 'users.title', rows, cols: [
    { key: 'username', label: 'users.username' }, { key: 'full_name', label: 'users.full_name' }, { key: 'email', label: 'users.email' },
    { key: 'role_name', label: 'users.role' }, { key: 'status', label: 'users.status' }, { key: 'last_login_at', label: 'users.last_login' }, { key: 'created_at', label: 'users.created' },
  ] });
});
accessRouter.get('/users/:id', can('users.view'), async (req, res) => {
  const u = await one<any>(`SELECT u.id, u.username, u.full_name, u.email, u.status, u.role_id, u.last_login_at, u.created_at, u.updated_at, r.name role_name, r.is_active role_active
    FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`, [req.params.id]);
  if (!u) fail(404, 'not_found');
  const perms = (await q<{ perm: string }>('SELECT perm FROM role_permissions WHERE role_id = ?', [u.role_id])).map((p) => p.perm);
  const [{ n }] = await q<{ n: number }>("SELECT COUNT(*) n FROM sessions WHERE user_id = ? AND status = 'active' AND expires_at > UTC_TIMESTAMP()", [u.id]);
  res.json({ ...u, perms, open_sessions: n, last_manager: await isLastManager(u.id), self: u.id === req.user!.id });
});
accessRouter.post('/users', can('users.create'), async (req, res) => {
  const v = clean(req.body, { ...userRules, password: { req: true, minLen: 10 } });
  if (req.body.password !== req.body.confirm) fieldError('confirm', 'passwords_differ');
  await checkUnique(v);
  const { password, ...rest } = v;
  const r = await exec('INSERT INTO users SET ?', [{ ...rest, status: rest.status ?? 'active', password_hash: await hashPassword(password) }]);
  await audit(req, { action: 'user.create', entity_type: 'user', entity_id: r.insertId, after: rest });
  res.json({ id: r.insertId });
});
accessRouter.patch('/users/:id', can('users.update'), async (req, res) => {
  const id = Number(req.params.id);
  const { status: _s, ...rules } = userRules;
  const v = clean(req.body, rules, true);
  const before = await one<any>('SELECT username, full_name, email, role_id FROM users WHERE id = ?', [id]);
  if (!before) fail(404, 'not_found');
  if (v.role_id && v.role_id !== before.role_id) {
    if (id === req.user!.id) fail(409, 'cannot_change_own_role');
    const newHas = await one("SELECT 1 FROM role_permissions WHERE role_id = ? AND perm = 'users.update'", [v.role_id]);
    if (!newHas && (await isLastManager(id))) fail(409, 'last_manager');
  }
  await checkUnique(v, id);
  if (Object.keys(v).length) await exec('UPDATE users SET ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [v, id]);
  await audit(req, { action: 'user.update', entity_type: 'user', entity_id: id, before, after: v });
  res.json({ ok: true });
});
accessRouter.post('/users/:id/password', can('users.update'), async (req, res) => {
  if (!req.body.password || String(req.body.password).length < 10) fieldError('password', 'password_min_10');
  await exec('UPDATE users SET password_hash = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [await hashPassword(req.body.password), req.params.id]);
  const r = await exec("UPDATE sessions SET status = 'revoked', ended_at = UTC_TIMESTAMP() WHERE user_id = ? AND status = 'active'", [req.params.id]);
  await audit(req, { action: 'user.set_password', entity_type: 'user', entity_id: req.params.id, severity: 'warning' });
  res.json({ ended: r.affectedRows });
});
accessRouter.post('/users/:id/disable', can('users.deactivate'), async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user!.id) fail(409, 'cannot_disable_self');
  if (await isLastManager(id)) fail(409, 'last_manager');
  await exec("UPDATE users SET status = 'disabled', updated_at = UTC_TIMESTAMP() WHERE id = ?", [id]);
  const r = await exec("UPDATE sessions SET status = 'revoked', ended_at = UTC_TIMESTAMP() WHERE user_id = ? AND status = 'active'", [id]);
  await audit(req, { action: 'user.disable', entity_type: 'user', entity_id: id, severity: 'warning' });
  res.json({ ended: r.affectedRows });
});
accessRouter.post('/users/:id/activate', can('users.activate'), async (req, res) => {
  await exec("UPDATE users SET status = 'active', locked_until = NULL, updated_at = UTC_TIMESTAMP() WHERE id = ?", [req.params.id]);
  await audit(req, { action: 'user.activate', entity_type: 'user', entity_id: req.params.id });
  res.json({ ok: true });
});
accessRouter.delete('/users/:id', can('users.delete'), async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user!.id) fail(409, 'cannot_delete_self');
  if (await isLastManager(id)) fail(409, 'last_manager');
  // An account with a history cannot be deleted; the history keeps its name.
  const holding = (await q<{ k: string; n: number }>(`
    SELECT 'audit_log' k, COUNT(*) n FROM audit_log WHERE actor_id = ? UNION ALL
    SELECT 'login_log', COUNT(*) FROM login_attempts WHERE user_id = ? UNION ALL
    SELECT 'attachments', COUNT(*) FROM attachments WHERE uploaded_by = ? UNION ALL
    SELECT 'renewals', COUNT(*) FROM renewals WHERE recorded_by = ?`, [id, id, id, id])).filter((h) => h.n > 0);
  if (holding.length) fail(409, 'user_has_history', { holding });
  await exec('DELETE FROM sessions WHERE user_id = ?', [id]);
  await exec('DELETE FROM users WHERE id = ?', [id]);
  await audit(req, { action: 'user.delete', entity_type: 'user', entity_id: id, severity: 'critical' });
  res.json({ ok: true });
});

// ---------- roles & permissions ----------
accessRouter.get('/roles', can('roles.view'), async (req, res) => {
  const s = `%${req.query.search ?? ''}%`;
  const rows = await q(`SELECT r.*, (SELECT COUNT(*) FROM users WHERE role_id = r.id) users, (SELECT COUNT(*) FROM role_permissions WHERE role_id = r.id) perms
    FROM roles r WHERE r.name LIKE ? ORDER BY r.id`, [s]);
  const [stats] = await q(`SELECT COUNT(*) roles, SUM(is_active) active, (SELECT COUNT(*) FROM users) users, (SELECT COUNT(*) FROM role_permissions) perms FROM roles`);
  res.json({ rows, stats, total: ALL_PERMS.length });
});
accessRouter.get('/roles/options', can('roles.view', 'users.view'), async (_req, res) => {
  res.json(await q('SELECT id, name, is_active FROM roles ORDER BY name'));
});
accessRouter.get('/roles/catalog', can('roles.view', 'permissions.view'), async (_req, res) => res.json({ matrix: MATRIX, admin: ADMIN_PERMS }));
accessRouter.get('/roles/:id', can('roles.view'), async (req, res) => {
  const r = await one<any>('SELECT r.*, (SELECT COUNT(*) FROM users WHERE role_id = r.id) users FROM roles r WHERE id = ?', [req.params.id]);
  if (!r) fail(404, 'not_found');
  const perms = (await q<{ perm: string }>('SELECT perm FROM role_permissions WHERE role_id = ?', [r.id])).map((p) => p.perm);
  res.json({ ...r, perms, total: ALL_PERMS.length, protected: await protectedPerms(r.id) });
});
const roleRules = { name: { req: true, max: 60, minLen: 2 }, description: { max: 255 } };
accessRouter.post('/roles', can('roles.create'), async (req, res) => {
  const v = clean(req.body, roleRules);
  if (await one('SELECT 1 FROM roles WHERE name = ?', [v.name])) fieldError('name', 'role_name_taken');
  const r = await exec('INSERT INTO roles SET ?', [v]);
  await audit(req, { action: 'role.create', entity_type: 'role', entity_id: r.insertId, after: v });
  res.json({ id: r.insertId });
});
accessRouter.patch('/roles/:id', can('roles.update'), async (req, res) => {
  const v = clean(req.body, roleRules, true);
  if (v.name && (await one('SELECT 1 FROM roles WHERE name = ? AND id <> ?', [v.name, req.params.id]))) fieldError('name', 'role_name_taken');
  const before = await one('SELECT name, description FROM roles WHERE id = ?', [req.params.id]);
  await exec('UPDATE roles SET ? WHERE id = ?', [v, req.params.id]);
  await audit(req, { action: 'role.update', entity_type: 'role', entity_id: req.params.id, before, after: v });
  res.json({ ok: true });
});
// Saving the matrix replaces the whole set; protected administrative permissions cannot be removed.
accessRouter.put('/roles/:id/permissions', can('permissions.update'), async (req, res) => {
  const id = Number(req.params.id);
  const wanted = new Set<string>((req.body.perms ?? []).filter((p: string) => ALL_PERMS.includes(p)));
  const current = new Set((await q<{ perm: string }>('SELECT perm FROM role_permissions WHERE role_id = ?', [id])).map((p) => p.perm));
  for (const p of await protectedPerms(id)) if (!wanted.has(p)) fail(409, 'protected_permission', { perm: p });
  const added = [...wanted].filter((p) => !current.has(p));
  const removed = [...current].filter((p) => !wanted.has(p));
  await tx(async () => {
    await exec('DELETE FROM role_permissions WHERE role_id = ?', [id]);
    if (wanted.size) await exec('INSERT INTO role_permissions (role_id, perm) VALUES ?', [[...wanted].map((p) => [id, p])]);
  });
  await audit(req, { action: 'role.permissions', entity_type: 'role', entity_id: id, severity: 'warning', before: { removed }, after: { added } });
  res.json({ added: added.length, removed: removed.length });
});
accessRouter.post('/roles/:id/disable', can('roles.deactivate'), async (req, res) => {
  const [{ n }] = await q<{ n: number }>("SELECT COUNT(*) n FROM users WHERE role_id = ? AND status = 'active'", [req.params.id]);
  if (n) fail(409, 'role_has_active_users', { n });
  if ((await protectedPerms(Number(req.params.id))).length) fail(409, 'last_manager');
  await exec('UPDATE roles SET is_active = 0 WHERE id = ?', [req.params.id]);
  await audit(req, { action: 'role.disable', entity_type: 'role', entity_id: req.params.id, severity: 'warning' });
  res.json({ ok: true });
});
accessRouter.post('/roles/:id/activate', can('roles.activate'), async (req, res) => {
  await exec('UPDATE roles SET is_active = 1 WHERE id = ?', [req.params.id]);
  await audit(req, { action: 'role.activate', entity_type: 'role', entity_id: req.params.id });
  res.json({ ok: true });
});
accessRouter.delete('/roles/:id', can('roles.delete'), async (req, res) => {
  const [{ n }] = await q<{ n: number }>('SELECT COUNT(*) n FROM users WHERE role_id = ?', [req.params.id]);
  if (n) fail(409, 'role_has_users', { n });
  await exec('DELETE FROM roles WHERE id = ?', [req.params.id]);
  await audit(req, { action: 'role.delete', entity_type: 'role', entity_id: req.params.id, severity: 'critical' });
  res.json({ ok: true });
});

// ---------- active sessions (all users) ----------
const sessionsSpec: Spec = {
  from: 'FROM sessions s LEFT JOIN users u ON u.id = s.user_id LEFT JOIN roles r ON r.id = u.role_id',
  select: `s.id, s.user_id, s.status, s.ip, s.user_agent, s.created_at, s.last_activity_at, s.expires_at, u.full_name, r.name role_name,
    s.status = 'active' AND s.expires_at > UTC_TIMESTAMP() live`,
  search: ['s.ip', 'u.full_name', 'u.username', 's.user_agent'],
  filters: {
    status: (v) => v === 'expired' ? "(s.status = 'expired' OR (s.status = 'active' AND s.expires_at <= UTC_TIMESTAMP()))"
      : v === 'active' ? "s.status = 'active' AND s.expires_at > UTC_TIMESTAMP()" : ['s.status = ?', [v]],
    from: (v) => ['s.created_at >= ?', [v]], to: (v) => ['s.created_at < DATE_ADD(?, INTERVAL 1 DAY)', [v]],
  },
  sorts: { status: 's.status', started: 's.created_at', last_activity: 's.last_activity_at', expires: 's.expires_at' },
  defaultSort: '-last_activity',
};
accessRouter.get('/sessions', can('sessions.view'), async (req, res) => {
  const r = await list(sessionsSpec, req.query as any);
  res.json({ ...r, rows: r.rows.map((s: any) => ({ ...s, current: s.id === req.user!.sessionId, status: s.status === 'active' && !s.live ? 'expired' : s.status })) });
});
accessRouter.delete('/sessions/:id', can('sessions.delete'), async (req, res) => {
  const r = await exec("UPDATE sessions SET status = 'revoked', ended_at = UTC_TIMESTAMP() WHERE id = ? AND status = 'active'", [req.params.id]);
  if (!r.affectedRows) fail(409, 'session_already_ended');
  await audit(req, { action: 'session.end', entity_type: 'session', entity_id: req.params.id, severity: 'warning' });
  res.json({ ok: true, self: Number(req.params.id) === req.user!.sessionId });
});
accessRouter.post('/sessions/user/:userId/end-all', can('sessions.delete'), async (req, res) => {
  const r = await exec("UPDATE sessions SET status = 'revoked', ended_at = UTC_TIMESTAMP() WHERE user_id = ? AND status = 'active'", [req.params.userId]);
  await audit(req, { action: 'session.end_all', entity_type: 'user', entity_id: req.params.userId, severity: 'warning' });
  res.json({ ended: r.affectedRows, self: Number(req.params.userId) === req.user!.id });
});

// ---------- blocked IPs ----------
const ipSpec: Spec = {
  from: 'FROM blocked_ips b LEFT JOIN users u ON u.id = b.blocked_by',
  select: `b.*, u.full_name blocked_by_name, b.status = 'blocked' AND (b.expires_at IS NULL OR b.expires_at > UTC_TIMESTAMP()) live`,
  search: ['b.ip', 'b.reason'],
  filters: {
    status: (v) => v === 'blocked' ? "b.status = 'blocked' AND (b.expires_at IS NULL OR b.expires_at > UTC_TIMESTAMP())" : "(b.status = 'lifted' OR b.expires_at <= UTC_TIMESTAMP())",
    from: (v) => ['b.created_at >= ?', [v]], to: (v) => ['b.created_at < DATE_ADD(?, INTERVAL 1 DAY)', [v]],
  },
  sorts: { created: 'b.created_at' }, defaultSort: '-created',
};
accessRouter.get('/blocked-ips', can('blocked_ips.view'), async (req, res) => res.json(await list(ipSpec, req.query as any)));
accessRouter.post('/blocked-ips', can('blocked_ips.create'), async (req, res) => {
  const v = clean(req.body, { ip: { req: true, max: 64 }, reason: { req: true, max: 500 }, expires_at: { type: 'date' } });
  if (!isIP(v.ip)) fieldError('ip', 'invalid_ip');
  if (v.ip === clientIp(req)) fieldError('ip', 'cannot_block_own_ip');
  await exec(`INSERT INTO blocked_ips (ip, reason, status, expires_at, blocked_by) VALUES (?, ?, 'blocked', ?, ?)
    ON DUPLICATE KEY UPDATE reason = VALUES(reason), status = 'blocked', expires_at = VALUES(expires_at), blocked_by = VALUES(blocked_by), created_at = UTC_TIMESTAMP()`,
  [v.ip, v.reason, v.expires_at, req.user!.id]);
  await audit(req, { action: 'ip.block', entity_type: 'blocked_ip', entity_id: v.ip, severity: 'warning', after: v });
  res.json({ ok: true });
});
accessRouter.post('/blocked-ips/:id/lift', can('blocked_ips.update'), async (req, res) => {
  await exec("UPDATE blocked_ips SET status = 'lifted' WHERE id = ?", [req.params.id]);
  await audit(req, { action: 'ip.lift', entity_type: 'blocked_ip', entity_id: req.params.id, severity: 'warning' });
  res.json({ ok: true });
});
accessRouter.delete('/blocked-ips/:id', can('blocked_ips.delete'), async (req, res) => {
  await exec('DELETE FROM blocked_ips WHERE id = ?', [req.params.id]);
  await audit(req, { action: 'ip.delete', entity_type: 'blocked_ip', entity_id: req.params.id, severity: 'warning' });
  res.json({ ok: true });
});
