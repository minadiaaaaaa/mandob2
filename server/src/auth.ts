import type { NextFunction, Request, Response } from 'express';
import { createHash, randomBytes, randomInt, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { exec, one, q, settingInt } from './db.js';
import { HttpError } from './http.js';
import { audit } from './audit.js';

const scrypt = promisify(_scrypt) as (p: string, s: Buffer, n: number) => Promise<Buffer>;

export type SessionUser = { id: number; username: string; full_name: string; email: string; role_id: number; role_name: string; locale: string | null; perms: Set<string>; sessionId: number };
declare global {
  namespace Express {
    interface Request { user?: SessionUser; rid?: string }
  }
}

export async function hashPassword(p: string) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${(await scrypt(p, salt, 64)).toString('hex')}`;
}
export async function verifyPassword(p: string, stored: string) {
  const [, salt, hash] = stored.split('$');
  if (!salt || !hash) return false;
  const got = await scrypt(p, Buffer.from(salt, 'hex'), 64);
  return timingSafeEqual(got, Buffer.from(hash, 'hex'));
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const clientIp = (req: Request) => (req.ip ?? '').replace(/^::ffff:/, '');
const COOKIE = 'lsp_sid';

export function readCookie(req: Request, name: string) {
  const m = (req.headers.cookie ?? '').split(/;\s*/).find((c) => c.startsWith(`${name}=`));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}

// ---------- verification code shown on the sign-in screen ----------
// 6 characters without O, I, 0 and 1 so they are not confused.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export async function issueChallenge(ip: string) {
  const id = randomBytes(16).toString('hex');
  const code = Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  const ttl = await settingInt('auth.challenge_ttl_seconds', 120);
  await exec('INSERT INTO login_challenges (id, code, ip, expires_at) VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND))', [id, code, ip, ttl]);
  return { id, code, ttl };
}

// ---------- IP blocks ----------
export async function ipBlocked(ip: string) {
  const b = await one<{ id: number; expires_at: string | null; expired: number }>(
    "SELECT id, expires_at, expires_at IS NOT NULL AND expires_at < UTC_TIMESTAMP() expired FROM blocked_ips WHERE ip = ? AND status = 'blocked'", [ip]);
  if (!b) return false;
  if (b.expired) { // a temporary block lifts itself at the first connection after it ends
    await exec("UPDATE blocked_ips SET status = 'lifted' WHERE id = ?", [b.id]);
    return false;
  }
  return true;
}

async function recordAttempt(req: Request, typed: string | null, userId: number | null, success: boolean, reason: string | null) {
  await exec('INSERT INTO login_attempts (username_typed, user_id, success, reason, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)',
    [typed, userId, success ? 1 : 0, reason, clientIp(req), (req.headers['user-agent'] ?? '').slice(0, 255)]);
}

async function maybeBlockIp(ip: string) {
  const limit = await settingInt('auth.block_ip_after_failures', 20);
  const win = await settingInt('auth.window_minutes', 15);
  const mins = await settingInt('auth.lockout_minutes', 15);
  const [{ n }] = await q<{ n: number }>('SELECT COUNT(*) n FROM login_attempts WHERE ip = ? AND success = 0 AND created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE)', [ip, win]);
  if (n >= limit) {
    await exec(`INSERT INTO blocked_ips (ip, reason, failed_attempts, status, expires_at) VALUES (?, ?, ?, 'blocked', DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE))
      ON DUPLICATE KEY UPDATE reason = VALUES(reason), failed_attempts = VALUES(failed_attempts), status = 'blocked', expires_at = VALUES(expires_at), blocked_by = NULL, created_at = UTC_TIMESTAMP()`,
    [ip, `Automatic: ${n} failed sign-in attempts within ${win} minutes; blocked for ${mins} minutes`, n, mins]);
    await audit(null, { action: 'ip.auto_block', entity_type: 'blocked_ip', entity_id: ip, severity: 'warning', actor_type: 'system', details: `${n} failures` });
  }
}

const reject = async (req: Request, typed: string | null, userId: number | null, reason: string, code: string, params: Record<string, unknown> = {}, newChallenge = true) => {
  await recordAttempt(req, typed, userId, false, reason);
  await maybeBlockIp(clientIp(req));
  const challenge = newChallenge ? await issueChallenge(clientIp(req)) : undefined;
  throw new HttpError(code === 'too_many' ? 429 : 401, code, { ...params, challenge });
};

export async function login(req: Request, res: Response) {
  const { username, password, challengeId, code } = req.body ?? {};
  const ip = clientIp(req);
  const typed = typeof username === 'string' ? username.trim() : null;
  if (!typed || !password || !code) return reject(req, typed, null, 'missing_credentials', 'fill_required', {}, false);
  if (await ipBlocked(ip)) return reject(req, typed, null, 'ip_blocked', 'ip_blocked', {}, false);

  const [{ recent }] = await q<{ recent: number }>('SELECT COUNT(*) recent FROM login_attempts WHERE ip = ? AND success = 0 AND created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MINUTE)', [ip]);
  if (recent >= 10) return reject(req, typed, null, 'rate_limited', 'too_many');

  const ch = await one<{ id: string; code: string; attempts: number; used_at: string | null; expired: number }>(
    'SELECT id, code, attempts, used_at, expires_at < UTC_TIMESTAMP() expired FROM login_challenges WHERE id = ?', [challengeId ?? '']);
  if (!ch) return reject(req, typed, null, 'challenge_required', 'enter_code');
  if (ch.used_at) return reject(req, typed, null, 'challenge_used', 'code_used');
  if (ch.attempts >= 5) return reject(req, typed, null, 'challenge_attempts_exceeded', 'too_many');
  if (ch.expired) return reject(req, typed, null, 'challenge_expired', 'code_expired');
  if (String(code).trim().toUpperCase() !== ch.code) {
    await exec('UPDATE login_challenges SET attempts = attempts + 1 WHERE id = ?', [ch.id]);
    return reject(req, typed, null, 'challenge_invalid', ch.attempts >= 1 ? 'too_many' : 'code_invalid');
  }
  await exec('UPDATE login_challenges SET used_at = UTC_TIMESTAMP() WHERE id = ?', [ch.id]);

  const u = await one<any>(`SELECT u.*, locked_until IS NOT NULL AND locked_until < UTC_TIMESTAMP() lock_over,
      CEIL(TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), locked_until) / 60) lock_minutes
    FROM users u WHERE username = ? OR email = ?`, [typed, typed]);
  if (!u) return reject(req, typed, null, 'unknown_user', 'bad_credentials');
  if (u.status === 'disabled') return reject(req, typed, u.id, 'account_disabled', 'account_suspended');
  if (u.status === 'locked') {
    if (u.locked_until && u.lock_over) await exec("UPDATE users SET status = 'active', locked_until = NULL WHERE id = ?", [u.id]);
    else return reject(req, typed, u.id, 'account_locked', 'account_locked', { minutes: Math.max(1, u.lock_minutes ?? 0) || '' });
  }
  if (!(await verifyPassword(String(password), u.password_hash))) {
    await recordAttempt(req, typed, u.id, false, 'bad_password');
    // Only password failures since the last successful sign-in, inside the window, count towards the lock.
    const max = await settingInt('auth.max_login_attempts', 5);
    const win = await settingInt('auth.window_minutes', 15);
    const mins = await settingInt('auth.lockout_minutes', 15);
    const [{ n }] = await q<{ n: number }>(`SELECT COUNT(*) n FROM login_attempts WHERE user_id = ? AND success = 0 AND reason = 'bad_password'
      AND created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE)
      AND created_at > COALESCE((SELECT MAX(created_at) FROM login_attempts WHERE user_id = ? AND success = 1), '1970-01-01')`, [u.id, win, u.id]);
    if (n >= max) {
      await exec("UPDATE users SET status = 'locked', locked_until = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE) WHERE id = ?", [mins, u.id]);
      await audit(null, { action: 'user.auto_lock', entity_type: 'user', entity_id: u.id, severity: 'warning', actor_type: 'system' });
    }
    await maybeBlockIp(ip);
    throw new HttpError(401, n >= max ? 'account_locked' : 'bad_credentials', { minutes: mins, challenge: await issueChallenge(ip) });
  }

  const token = randomBytes(32).toString('hex');
  const ttl = await settingInt('auth.session_ttl_minutes', 120);
  await exec('INSERT INTO sessions (token_hash, user_id, ip, user_agent, expires_at) VALUES (?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE))',
    [sha256(token), u.id, ip, (req.headers['user-agent'] ?? '').slice(0, 255), ttl]);
  await exec('UPDATE users SET last_login_at = UTC_TIMESTAMP() WHERE id = ?', [u.id]);
  await recordAttempt(req, typed, u.id, true, null);
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${ttl * 60}${req.secure ? '; Secure' : ''}`);
  res.json({ ok: true });
}

export async function logout(req: Request, res: Response) {
  const tok = readCookie(req, COOKIE);
  if (tok) await exec("UPDATE sessions SET status = 'signed_out', ended_at = UTC_TIMESTAMP() WHERE token_hash = ? AND status = 'active'", [sha256(tok)]);
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.json({ ok: true });
}

export async function permsOf(roleId: number) {
  const rows = await q<{ perm: string }>('SELECT rp.perm FROM role_permissions rp JOIN roles r ON r.id = rp.role_id AND r.is_active = 1 WHERE rp.role_id = ?', [roleId]);
  return new Set(rows.map((r) => r.perm));
}

// Attaches req.user when the session is valid. Permission changes apply at the next request.
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const tok = readCookie(req, COOKIE);
  if (!tok) return next();
  const s = await one<any>(`SELECT s.id sid, s.expires_at < UTC_TIMESTAMP() expired, u.id, u.username, u.full_name, u.email, u.role_id, u.locale, u.status, r.name role_name
    FROM sessions s JOIN users u ON u.id = s.user_id JOIN roles r ON r.id = u.role_id WHERE s.token_hash = ? AND s.status = 'active'`, [sha256(tok)]);
  if (!s) return next();
  if (s.expired) {
    await exec("UPDATE sessions SET status = 'expired', ended_at = UTC_TIMESTAMP() WHERE id = ?", [s.sid]);
    return next();
  }
  if (s.status !== 'active' || (await ipBlocked(clientIp(req)))) return next();
  await exec('UPDATE sessions SET last_activity_at = UTC_TIMESTAMP() WHERE id = ? AND last_activity_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 SECOND)', [s.sid]);
  req.user = { id: s.id, username: s.username, full_name: s.full_name, email: s.email, role_id: s.role_id, role_name: s.role_name, locale: s.locale, perms: await permsOf(s.role_id), sessionId: s.sid };
  next();
}

export function requireUser(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) throw new HttpError(401, 'session_ended');
  next();
}

// can('riders.view') or can('roles.view', 'permissions.view') → any of them is enough.
export const can = (...perms: string[]) => async (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) throw new HttpError(401, 'session_ended');
  if (perms.some((p) => req.user!.perms.has(p))) return next();
  await audit(req, { action: 'access.denied', severity: 'warning', status: 'denied', details: perms.join(' | ') });
  throw new HttpError(403, 'forbidden', { perm: perms[0] });
};
export const has = (req: Request, perm: string) => !!req.user?.perms.has(perm);
