import type { Request } from 'express';
import { exec } from './db.js';

type Entry = {
  action: string; entity_type?: string; entity_id?: unknown;
  severity?: 'info' | 'warning' | 'error' | 'critical'; status?: 'success' | 'failed' | 'error' | 'pending' | 'denied';
  actor_type?: 'user' | 'system' | 'api' | 'guest' | 'job' | 'rider'; actor_id?: number; actor_name?: string; before?: unknown; after?: unknown; details?: string;
};

const SECRET = /password|token|secret|hash/i;
const scrub = (o: unknown) => o && typeof o === 'object'
  ? Object.fromEntries(Object.entries(o as Record<string, unknown>).filter(([k]) => !SECRET.test(k)))
  : o ?? null;

// Every write action is recorded with who, on what, and the values before and after. Secrets never are.
export async function audit(req: Request | null, e: Entry) {
  try {
    await exec(`INSERT INTO audit_log (action, entity_type, entity_id, actor_type, actor_id, actor_name, status, severity, ip, route, request_id, user_agent, before_json, after_json, details)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      e.action, e.entity_type ?? null, e.entity_id == null ? null : String(e.entity_id),
      e.actor_type ?? (req?.user ? 'user' : 'guest'), e.actor_id ?? req?.user?.id ?? null, e.actor_name ?? req?.user?.full_name ?? null,
      e.status ?? 'success', e.severity ?? 'info',
      req ? (req.ip ?? '').replace(/^::ffff:/, '') : null, req ? `${req.method} ${req.originalUrl}`.slice(0, 255) : null, req?.rid ?? null,
      req ? (req.headers['user-agent'] ?? '').slice(0, 255) : null,
      e.before === undefined ? null : JSON.stringify(scrub(e.before)), e.after === undefined ? null : JSON.stringify(scrub(e.after)),
      e.details?.slice(0, 1000) ?? null,
    ]);
  } catch (err) {
    console.error('audit failed', err);
  }
}
