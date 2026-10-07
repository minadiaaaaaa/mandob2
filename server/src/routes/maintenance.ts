import { Router, type Request } from 'express';
import multer from 'multer';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { crc32 } from 'node:zlib';
import { DATA_DIR, STORAGE_DIR, dbConfig, exec, one, q, setSetting, setting, settingInt } from '../db.js';
import { clean, eq, fail, list, listAll, sendExport, type Query, type Spec } from '../http.js';
import { can } from '../auth.js';
import { audit } from '../audit.js';
import { appKey } from './system.js';
import { generateNotifications } from './dashboard.js';
import { notifyUsers } from '../notify.js';
import { sendMail } from '../mail.js';

export const maintenanceRouter = Router();

// ======================================================================== 11.7 system errors
export async function logError(e: any, req?: Request, level: 'error' | 'critical' | 'warning' = 'error') {
  try {
    await exec('INSERT INTO error_log (level, code, module, message, route, method, user_id, request_id, stack) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      level, String(e?.code ?? e?.name ?? 'Error').slice(0, 80), req ? String(req.originalUrl.split('?')[0].split('/')[2] ?? '').slice(0, 80) : 'server',
      String(e?.message ?? e).slice(0, 1000), req ? req.originalUrl.slice(0, 255) : null, req?.method ?? null, req?.user?.id ?? null, req?.rid ?? null, String(e?.stack ?? '').slice(0, 20000)]);
  } catch { /* the log must never break the response */ }
}
const errSpec: Spec = {
  from: 'FROM error_log e LEFT JOIN users u ON u.id = e.user_id', select: 'e.*, u.full_name user_name',
  search: ['e.message', 'e.code', 'e.route'],
  filters: { level: eq('e.level'), method: eq('e.method'), from: (v) => ['e.created_at >= ?', [v]], to: (v) => ['e.created_at < DATE_ADD(?, INTERVAL 1 DAY)', [v]] },
  sorts: { time: 'e.id' }, defaultSort: '-time',
};
maintenanceRouter.get('/logs/errors', can('logs.view'), async (req, res) => res.json(await list(errSpec, req.query as Query)));
maintenanceRouter.get('/logs/errors/export', can('logs.export'), async (req, res) => {
  await sendExport(req, res, { format: 'csv', title: 'err_log.title', rows: await listAll(errSpec, req.query as Query), cols: [
    { key: 'created_at', label: 'err_log.time' }, { key: 'level', label: 'err_log.level' }, { key: 'code', label: 'err_log.code' }, { key: 'module', label: 'err_log.module' },
    { key: 'message', label: 'err_log.message' }, { key: 'route', label: 'err_log.route' }, { key: 'user_name', label: 'err_log.user' }] });
});
maintenanceRouter.delete('/logs/errors/:id', can('logs.delete'), async (req, res) => {
  await exec('DELETE FROM error_log WHERE id = ?', [req.params.id]);
  await audit(req, { action: 'error_log.delete', entity_id: req.params.id as string, severity: 'warning' });
  res.json({ ok: true });
});

// ======================================================================== 11.8 scheduled jobs
// A five-field cron (minute hour day month weekday), read in the organization's time zone.
export const CRON_RE = /^(\S+\s+){4}\S+$/;
function field(spec: string, v: number, min: number, max: number) {
  return spec.split(',').some((part) => {
    const [range, stepS] = part.split('/');
    const step = Number(stepS ?? 1);
    const [a, b] = range === '*' ? [min, max] : range.includes('-') ? range.split('-').map(Number) : [Number(range), stepS ? max : Number(range)];
    return Number.isFinite(a) && Number.isFinite(b) && step > 0 && v >= a && v <= b && (v - a) % step === 0;
  });
}
export function cronValid(expr: string) {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return false;
  return f.every((x) => /^(\*|\d+(-\d+)?)(\/\d+)?(,(\*|\d+(-\d+)?)(\/\d+)?)*$/.test(x));
}
export function cronMatches(expr: string, d: { minute: number; hour: number; day: number; month: number; weekday: number }) {
  const [mi, h, dom, mo, dow] = expr.trim().split(/\s+/);
  return field(mi, d.minute, 0, 59) && field(h, d.hour, 0, 23) && field(dom, d.day, 1, 31) && field(mo, d.month, 1, 12) && field(dow, d.weekday === 0 && dow.includes('7') ? 7 : d.weekday, 0, 7);
}
async function localNow(at = new Date()) {
  const tz = (await setting('org.timezone')) || 'Asia/Riyadh';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' })
    .formatToParts(at).map((x) => [x.type, x.value]));
  return { minute: Number(p.minute), hour: Number(p.hour) % 24, day: Number(p.day), month: Number(p.month), weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}
async function nextRun(expr: string) {
  if (!cronValid(expr)) return null;
  const now = Date.now();
  for (let i = 1; i <= 60 * 24 * 8; i++) {
    const t = new Date(Math.floor(now / 60000) * 60000 + i * 60000);
    if (cronMatches(expr, await localNow(t))) return t.toISOString();
  }
  return null;
}

type Out = { records?: number; notifications?: number; details?: Record<string, unknown> };
type Job = { name: string; key: string; def: string; run: () => Promise<Out>; enabled?: () => Promise<boolean> };
export const JOBS: Job[] = [
  { name: 'document_expiry', key: 'notifications.generator_cron', def: '0 6 * * *', run: async () => { const n = await generateNotifications(); return { records: n, notifications: n }; } },
  // ponytail: no image checker is installed, so these two finish with nothing to do
  { name: 'branding_checks', key: 'branding.checks_cron', def: '*/5 * * * *', run: async () => ({ records: 0, details: { checker: 'unavailable' } }) },
  { name: 'branding_learn', key: 'branding.learn_cron', def: '0 4 * * *', run: async () => ({ records: 0, details: { model: 'unavailable' } }) },
  { name: 'branding_sync', key: 'sync.branding_cron', def: '0 10 * * *', enabled: async () => (await setting('sync.auto')) !== '0', run: () => scheduledSync(['branding_photos']) },
  { name: 'data_sync', key: 'sync.cron', def: '0 15 * * *', enabled: async () => (await setting('sync.auto')) !== '0', run: () => scheduledSync(['daily_performance', 'monthly_ratings', 'fines', 'wallet', 'absences']) },
  { name: 'auto_backup', key: 'backup.cron', def: '0 3 * * *', enabled: async () => (await setting('backup.auto_enabled')) !== '0', run: autoBackup },
  { name: 'log_cleanup', key: 'logs.cleanup_cron', def: '30 3 * * *', run: cleanup },
];
// With no browser on the server, a scheduled sync can only record that it needs a sign-in.
async function scheduledSync(sources: string[]): Promise<Out> {
  let n = 0;
  for (const s of sources) {
    const src = await one<any>('SELECT enabled FROM sync_sources WHERE code = ?', [s]);
    if (src && !src.enabled) continue;
    await exec("INSERT INTO sync_runs (source, report_day, status, trigger_type, finished_at, message) VALUES (?, DATE_SUB(CURDATE(), INTERVAL 1 DAY), 'needs_sign_in', 'scheduled', UTC_TIMESTAMP(), 'no_server_browser')", [s]);
    n++;
  }
  return { records: n, details: { status: 'needs_sign_in' } };
}
async function cleanup(): Promise<Out> {
  const keep = async (k: string, def: number, min = 1) => Math.max(min, await settingInt(k, def));
  const r = [
    await exec('DELETE FROM audit_log WHERE created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)', [await keep('logs.audit_retention_days', 365, 90)]),
    await exec('DELETE FROM login_attempts WHERE created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)', [await keep('logs.login_retention_days', 180, 60)]),
    await exec('DELETE FROM error_log WHERE created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)', [await keep('logs.error_retention_days', 90)]),
    await exec('DELETE FROM cron_runs WHERE started_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)', [await keep('logs.cron_retention_days', 90)]),
    await exec('DELETE FROM email_log WHERE created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)', [await keep('logs.email_retention_days', 180)]),
    await exec("DELETE FROM sessions WHERE status <> 'active' AND last_activity_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)", [await keep('logs.session_retention_days', 30)]),
    await exec('DELETE FROM notifications WHERE read_at IS NOT NULL AND read_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)', [await keep('notifications.retention_days', 180)]),
  ];
  return { records: r.reduce((s, x) => s + x.affectedRows, 0) };
}

const runningJobs = new Set<string>();
export async function runJob(job: Job, manual: boolean) {
  if (runningJobs.has(job.name)) fail(409, 'job_running');
  runningJobs.add(job.name);
  const id = (await exec('INSERT INTO cron_runs (job, manual) VALUES (?, ?)', [job.name, manual ? 1 : 0])).insertId;
  const started = Date.now();
  let out: Out = {}; let error: string | null = null;
  try {
    // a job switched off in its own settings wakes up and ends without doing any work
    out = job.enabled && !(await job.enabled()) ? { details: { skipped: 'disabled' } } : await job.run();
  } catch (e: any) { error = String(e?.message ?? e).slice(0, 1000); await logError(e); }
  finally { runningJobs.delete(job.name); }
  const [{ emails }] = await q<any>('SELECT COUNT(*) emails FROM email_log WHERE created_at >= FROM_UNIXTIME(?)', [Math.floor(started / 1000)]);
  await exec('UPDATE cron_runs SET finished_at = UTC_TIMESTAMP(), outcome = ?, records = ?, notifications = ?, emails = ?, error = ?, details = ? WHERE id = ?',
    [error ? 'failed' : 'completed', out.records ?? 0, out.notifications ?? 0, Number(emails), error, JSON.stringify(out.details ?? {}), id]);
  // the managers get a summary — except for runs that had nothing to do, so a five-minute check does not flood them
  if (error || out.records) {
    const duration = `${Math.round((Date.now() - started) / 1000)}s`;
    await notifyUsers('all', { category: 'system', severity: error ? 'critical' : 'info', title: error ? 'note.job_failed' : 'note.job_done', params: { job: job.name, records: out.records ?? 0 }, link: '/admin/cron-jobs' });
    for (const u of await q<any>("SELECT u.email, u.full_name FROM users u JOIN notification_prefs p ON p.user_id = u.id AND p.category = 'system' AND p.email = 1 WHERE u.status = 'active'"))
      await sendMail({ template: 'system.jobs', to: u.email, toName: u.full_name, vars: { job_name: job.name, status: error ? 'failed' : 'completed', duration } });
  }
  return { id, outcome: error ? 'failed' : 'completed', error };
}
let lastTick = '';
export function startScheduler() {
  setInterval(async () => {
    try {
      // a run that stays "running" for more than an hour is dead
      await exec("UPDATE cron_runs SET outcome = 'failed', finished_at = UTC_TIMESTAMP(), error = 'stale' WHERE outcome = 'running' AND started_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 60 MINUTE)");
      const now = await localNow();
      const tick = `${now.day}-${now.hour}-${now.minute}`;
      if (tick === lastTick) return;
      lastTick = tick;
      for (const job of JOBS) {
        const expr = (await setting(job.key)) || job.def;
        if (cronValid(expr) && cronMatches(expr, now) && !runningJobs.has(job.name)) runJob(job, false).catch(() => {});
      }
    } catch { /* not installed yet */ }
  }, 20000).unref();
}

maintenanceRouter.get('/cron-jobs', can('cron_jobs.view'), async (_req, res) => {
  const out = [];
  for (const j of JOBS) {
    const expr = (await setting(j.key)) || j.def;
    const last = await one<any>('SELECT * FROM cron_runs WHERE job = ? ORDER BY id DESC LIMIT 1', [j.name]);
    out.push({ name: j.name, key: j.key, expr, enabled: j.enabled ? await j.enabled() : true, next: await nextRun(expr), running: runningJobs.has(j.name), last: last ?? null });
  }
  res.json(out);
});
const runSpec: Spec = {
  from: 'FROM cron_runs r', select: 'r.*, TIMESTAMPDIFF(SECOND, r.started_at, r.finished_at) seconds',
  search: ['r.job', 'r.error'],
  filters: { job: eq('r.job'), outcome: eq('r.outcome'), from: (v) => ['r.started_at >= ?', [v]], to: (v) => ['r.started_at < DATE_ADD(?, INTERVAL 1 DAY)', [v]] },
  sorts: { started: 'r.id' }, defaultSort: '-started',
};
maintenanceRouter.get('/cron-jobs/runs', can('cron_jobs.view'), async (req, res) => res.json(await list(runSpec, req.query as Query)));
maintenanceRouter.get('/cron-jobs/runs/export', can('cron_jobs.export'), async (req, res) => {
  await sendExport(req, res, { format: 'csv', title: 'cron.title', rows: await listAll(runSpec, req.query as Query), cols: [
    { key: 'started_at', label: 'cron.started' }, { key: 'job', label: 'cron.job' }, { key: 'outcome', label: 'cron.outcome' }, { key: 'seconds', label: 'cron.duration' },
    { key: 'records', label: 'cron.records' }, { key: 'notifications', label: 'cron.notifications' }, { key: 'emails', label: 'cron.emails' }, { key: 'error', label: 'cron.error' }] });
});
maintenanceRouter.post('/cron-jobs/:name/run', can('cron_jobs.run'), async (req, res) => {
  const j = JOBS.find((x) => x.name === req.params.name);
  if (!j) fail(404, 'not_found');
  await audit(req, { action: 'cron.run', details: j!.name });
  res.json(await runJob(j!, true));
});

// ======================================================================== 11.9 backups
// One archive holds the database and every uploaded file: a stored zip, sealed with the server key (AES-256-GCM).
// ponytail: the archive is built in memory; fine for a fleet office, stream it if the files grow past a few GB.
const BK_DIR = join(DATA_DIR, 'backups');
mkdirSync(BK_DIR, { recursive: true });
const SKIP = new Set(['backups', 'restores']); // the backup list and restore history describe the archives; they are never inside one
const MAGIC = Buffer.from('LSPBK1');
const keyFp = () => createHash('sha256').update(appKey()).digest('hex').slice(0, 16);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

function zip(files: { name: string; data: Buffer }[]) {
  const parts: Buffer[] = []; const dirs: Buffer[] = []; let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name); const crc = crc32(f.data);
    const head = Buffer.alloc(30); head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6);
    head.writeUInt32LE(crc, 14); head.writeUInt32LE(f.data.length, 18); head.writeUInt32LE(f.data.length, 22); head.writeUInt16LE(name.length, 26);
    parts.push(head, name, f.data);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(f.data.length, 20); cd.writeUInt32LE(f.data.length, 24); cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(offset, 42);
    dirs.push(cd, name);
    offset += 30 + name.length + f.data.length;
  }
  const dirBuf = Buffer.concat(dirs);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Math.min(files.length, 0xffff), 8); end.writeUInt16LE(Math.min(files.length, 0xffff), 10);
  end.writeUInt32LE(dirBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dirBuf, end]);
}
function unzip(buf: Buffer) {
  const out = new Map<string, Buffer>();
  let i = 0;
  while (i + 30 <= buf.length && buf.readUInt32LE(i) === 0x04034b50) {
    if (buf.readUInt16LE(i + 8) !== 0) throw new Error('compressed archives are not supported');
    const size = buf.readUInt32LE(i + 18); const nameLen = buf.readUInt16LE(i + 26); const extra = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + nameLen).toString('utf8');
    const start = i + 30 + nameLen + extra;
    out.set(name, buf.subarray(start, start + size));
    i = start + size;
  }
  return out;
}
const seal = (plain: Buffer) => { const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', appKey(), iv); const data = Buffer.concat([c.update(plain), c.final()]); return Buffer.concat([MAGIC, iv, c.getAuthTag(), data]); };
function open(file: Buffer) {
  if (!file.subarray(0, 6).equals(MAGIC)) return file; // a backup taken before encryption
  const d = createDecipheriv('aes-256-gcm', appKey(), file.subarray(6, 18));
  d.setAuthTag(file.subarray(18, 34));
  return Buffer.concat([d.update(file.subarray(34)), d.final()]);
}
function walk(dir: string, out: string[] = []) {
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (f !== 'tmp') walk(p, out); } else out.push(p);
  }
  return out;
}
async function tableNames() {
  return (await q<any>('SELECT TABLE_NAME t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = ?', [dbConfig()!.database, 'BASE TABLE'])).map((r) => r.t).filter((t) => !SKIP.has(t));
}

export async function createBackup(type: 'full' | 'db' | 'files', kind: 'manual' | 'auto' | 'safety', note: string | null, userId: number | null) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const file_name = `backup-${stamp}-${kind}-${randomBytes(3).toString('hex')}.zip`;
  const id = (await exec('INSERT INTO backups (file_name, type, kind, note, created_by, key_fp) VALUES (?, ?, ?, ?, ?, ?)', [file_name, type, kind, note, userId, keyFp()])).insertId;
  try {
    const entries: { name: string; data: Buffer }[] = [];
    let rows = 0; let tables: string[] = [];
    if (type !== 'files') {
      tables = await tableNames();
      for (const t of tables) { const r = await q(`SELECT * FROM \`${t}\``); rows += r.length; entries.push({ name: `db/${t}.json`, data: Buffer.from(JSON.stringify(r)) }); }
    }
    let files = 0; let missing = 0;
    if (type !== 'db') {
      for (const p of walk(STORAGE_DIR)) { entries.push({ name: `files/${relative(STORAGE_DIR, p).split(sep).join('/')}`, data: readFileSync(p) }); files++; }
      for (const a of await q<any>('SELECT stored_name FROM attachments')) if (!existsSync(join(STORAGE_DIR, a.stored_name))) missing++;
    }
    entries.unshift({ name: 'manifest.json', data: Buffer.from(JSON.stringify({ app: 'logistics-services-platform', type, tables, rows, files, missing, created_at: new Date().toISOString() })) });
    const sealed = seal(zip(entries));
    writeFileSync(join(BK_DIR, file_name), sealed);
    await exec("UPDATE backups SET status = 'completed', tables_n = ?, rows_n = ?, files_n = ?, missing_files = ?, size = ?, checksum = ? WHERE id = ?",
      [tables.length, rows, files, missing, sealed.length, sha(sealed), id]);
  } catch (e: any) {
    await exec("UPDATE backups SET status = 'failed', error = ? WHERE id = ?", [String(e?.message ?? e).slice(0, 1000), id]);
    throw e;
  }
  return id;
}
async function autoBackup(): Promise<Out> {
  const type = ((await setting('backup.type')) || 'full') as 'full';
  const id = await createBackup(type, 'auto', null, null);
  // after a new automatic backup, the ones beyond the number kept go; manual, safety and uploaded ones stay
  const keep = await settingInt('backup.keep_count', 14);
  const old = await q<any>("SELECT id, file_name FROM backups WHERE kind = 'auto' ORDER BY id DESC LIMIT 1000 OFFSET ?", [keep]);
  for (const b of old) { if (existsSync(join(BK_DIR, b.file_name))) unlinkSync(join(BK_DIR, b.file_name)); await exec('DELETE FROM backups WHERE id = ?', [b.id]); }
  return { records: 1, details: { backup: id, pruned: old.length } };
}

maintenanceRouter.get('/backups', can('backups.view'), async (_req, res) => {
  const rows = await q<any>(`SELECT b.*, u.full_name created_by_name, (SELECT CONCAT(r.status, '|', r.created_at) FROM restores r WHERE r.backup_id = b.id ORDER BY r.id DESC LIMIT 1) last_restore
    FROM backups b LEFT JOIN users u ON u.id = b.created_by ORDER BY b.id DESC`);
  const known = new Set(rows.map((r) => r.file_name));
  const orphans = readdirSync(BK_DIR).filter((f) => f.endsWith('.zip') && !known.has(f)).map((f) => ({ name: f, size: statSync(join(BK_DIR, f)).size }));
  const restores = await q('SELECT r.*, u.full_name user_name FROM restores r LEFT JOIN users u ON u.id = r.user_id ORDER BY r.id DESC LIMIT 50');
  const expr = (await setting('backup.cron')) || '0 3 * * *';
  res.json({ rows: rows.map((r) => ({ ...r, on_disk: existsSync(join(BK_DIR, r.file_name)), other_key: r.key_fp && r.key_fp !== keyFp() })), orphans, restores, key_fp: keyFp(),
    schedule: { enabled: (await setting('backup.auto_enabled')) !== '0', type: (await setting('backup.type')) || 'full', cron: expr, keep: await settingInt('backup.keep_count', 14), next: (await setting('backup.auto_enabled')) !== '0' ? await nextRun(expr) : null } });
});
maintenanceRouter.post('/backups', can('backups.create'), async (req, res) => {
  const v = clean(req.body, { type: { enum: ['full', 'db', 'files'] }, note: { max: 500 } });
  const id = await createBackup(v.type ?? 'full', 'manual', v.note ?? null, req.user!.id);
  await audit(req, { action: 'backup.create', entity_type: 'backup', entity_id: id, after: v });
  res.json({ id });
});
async function backupOf(id: unknown) {
  const b = await one<any>('SELECT * FROM backups WHERE id = ?', [id]);
  if (!b) fail(404, 'not_found');
  if (!existsSync(join(BK_DIR, b.file_name))) fail(410, 'backup_file_missing');
  return b;
}
maintenanceRouter.post('/backups/:id/verify', can('backups.verify'), async (req, res) => {
  const b = await backupOf(req.params.id);
  const actual = sha(readFileSync(join(BK_DIR, b.file_name)));
  res.json({ ok: actual === b.checksum, expected: b.checksum, actual });
});
maintenanceRouter.get('/backups/:id/download', can('backups.download'), async (req, res) => {
  const b = await backupOf(req.params.id);
  await audit(req, { action: 'backup.download', entity_type: 'backup', entity_id: b.id, severity: 'warning' });
  res.download(join(BK_DIR, b.file_name), b.file_name);
});
// What the restore panel shows before anything happens.
maintenanceRouter.get('/backups/:id/contents', can('backups.view'), async (req, res) => {
  const b = await backupOf(req.params.id);
  try {
    const m = JSON.parse(unzip(open(readFileSync(join(BK_DIR, b.file_name)))).get('manifest.json')?.toString() ?? 'null');
    res.json({ ok: !!m, manifest: m });
  } catch { res.json({ ok: false, error: 'other_key' }); }
});
maintenanceRouter.delete('/backups/:id', can('backups.delete'), async (req, res) => {
  const b = await one<any>('SELECT * FROM backups WHERE id = ?', [req.params.id]);
  if (!b) fail(404, 'not_found');
  if (existsSync(join(BK_DIR, b.file_name))) unlinkSync(join(BK_DIR, b.file_name));
  await exec('DELETE FROM backups WHERE id = ?', [b.id]);
  await audit(req, { action: 'backup.delete', entity_type: 'backup', entity_id: b.id, severity: 'critical', details: b.file_name });
  res.json({ ok: true });
});
async function register(file_name: string, kind: 'upload' | 'registered', note: string | null, userId: number) {
  const buf = readFileSync(join(BK_DIR, file_name));
  let manifest: any = null; let other = false;
  try { manifest = JSON.parse(unzip(open(buf)).get('manifest.json')?.toString() ?? 'null'); } catch { other = true; }
  if (!manifest && !other) { unlinkSync(join(BK_DIR, file_name)); fail(422, 'not_a_backup'); }
  await exec("INSERT INTO backups (file_name, status, type, kind, note, tables_n, rows_n, files_n, missing_files, size, encrypted, key_fp, checksum, created_by) VALUES (?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [file_name, manifest?.type ?? 'full', kind, note, manifest?.tables?.length ?? null, manifest?.rows ?? null, manifest?.files ?? null, manifest?.missing ?? null, buf.length,
      buf.subarray(0, 6).equals(MAGIC) ? 1 : 0, other ? 'other' : keyFp(), sha(buf), userId]);
  return { other_key: other };
}
const bigUpload = multer({ dest: join(BK_DIR, 'incoming'), limits: { fileSize: 4 * 1024 ** 3 } });
maintenanceRouter.post('/backups/upload', can('backups.create'), bigUpload.single('file'), async (req, res) => {
  if (!req.file) fail(422, 'file_required');
  if (!/\.zip$/i.test(req.file!.originalname)) { unlinkSync(req.file!.path); fail(415, 'file_type_not_allowed'); }
  const name = `upload-${Date.now()}-${req.file!.originalname.replace(/[^\w.-]/g, '_')}`;
  renameSync(req.file!.path, join(BK_DIR, name));
  const r = await register(name, 'upload', req.body?.note ?? null, req.user!.id);
  await audit(req, { action: 'backup.upload', details: name });
  res.json(r);
});
maintenanceRouter.post('/backups/register', can('backups.create'), async (req, res) => {
  const name = String(req.body?.name ?? '');
  if (!/^[\w.-]+\.zip$/.test(name) || !existsSync(join(BK_DIR, name))) fail(404, 'not_found');
  res.json(await register(name, 'registered', req.body?.note ?? null, req.user!.id));
});
maintenanceRouter.put('/backups/schedule', can('backups.settings'), async (req, res) => {
  const v = clean(req.body, { enabled: { type: 'bool' }, type: { enum: ['full', 'db', 'files'] }, time: { type: 'time' }, cron: { max: 100 }, keep: { type: 'int', min: 1, max: 365 } }, true);
  const expr = v.cron || (v.time ? `${Number(v.time.slice(3))} ${Number(v.time.slice(0, 2))} * * *` : null);
  if (expr && !cronValid(expr)) fail(422, 'invalid_cron');
  if ('enabled' in v) await setSetting('backup.auto_enabled', v.enabled ? '1' : '0');
  if (v.type) await setSetting('backup.type', v.type);
  if (expr) await setSetting('backup.cron', expr);
  if (v.keep) await setSetting('backup.keep_count', String(v.keep));
  await audit(req, { action: 'backup.schedule', after: v });
  res.json({ ok: true });
});

let restoring = false;
maintenanceRouter.post('/backups/:id/restore', can('backups.restore'), async (req, res) => {
  const v = clean(req.body, { confirm: { req: true }, replace_files: { type: 'bool' }, override_checksum: { type: 'bool' } });
  if (v.confirm !== 'RESTORE') fail(422, 'restore_confirm');
  const b = await backupOf(req.params.id);
  if (b.status !== 'completed') fail(409, 'backup_not_completed');
  if (restoring) fail(409, 'restore_running');
  const buf = readFileSync(join(BK_DIR, b.file_name));
  if (sha(buf) !== b.checksum && !v.override_checksum) fail(409, 'checksum_mismatch');
  let entries: Map<string, Buffer>;
  try { entries = unzip(open(buf)); } catch { fail(409, 'backup_other_key'); }
  restoring = true;
  const started = Date.now();
  const rid = (await exec('INSERT INTO restores (backup_id, file_name, user_id) VALUES (?, ?, ?)', [b.id, b.file_name, req.user!.id])).insertId;
  try {
    // a full safety backup of the current state first, so going back stays possible
    const safety = await createBackup('full', 'safety', `before restoring #${b.id}`, req.user!.id);
    let tables = 0; let files = 0;
    for (const [name, data] of entries!) {
      if (!name.startsWith('db/')) continue;
      const t = name.slice(3, -5);
      if (SKIP.has(t) || !/^\w+$/.test(t)) continue;
      const rows = JSON.parse(data.toString());
      await exec(`SET FOREIGN_KEY_CHECKS = 0; DELETE FROM \`${t}\`; SET FOREIGN_KEY_CHECKS = 1;`);
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        const cols = Object.keys(chunk[0]);
        await exec(`SET FOREIGN_KEY_CHECKS = 0; INSERT INTO \`${t}\` (${cols.map((c) => `\`${c}\``).join(',')}) VALUES ?; SET FOREIGN_KEY_CHECKS = 1;`,
          [chunk.map((r: any) => cols.map((c) => (r[c] !== null && typeof r[c] === 'object' ? JSON.stringify(r[c]) : r[c])))]);
      }
      tables++;
    }
    const archived = new Set<string>();
    for (const [name, data] of entries!) {
      if (!name.startsWith('files/')) continue;
      const rel = name.slice(6);
      if (rel.includes('..')) continue;
      archived.add(join(STORAGE_DIR, rel));
      const p = join(STORAGE_DIR, rel);
      mkdirSync(dirname(p), { recursive: true });
      // default mode: archive files are written and a newer file stays as it is
      if (v.replace_files || !existsSync(p)) { writeFileSync(p, data); files++; }
    }
    if (v.replace_files && b.type !== 'db') for (const p of walk(STORAGE_DIR)) if (!archived.has(p)) unlinkSync(p);
    const details = JSON.stringify({ tables, files, seconds: Math.round((Date.now() - started) / 1000), safety });
    await exec("UPDATE restores SET status = 'completed', details = ? WHERE id = ?", [details, rid]);
    await audit(req, { action: 'backup.restore', entity_type: 'backup', entity_id: b.id, severity: 'critical', details });
    const still = await one('SELECT 1 FROM sessions WHERE id = ? AND status = ?', [req.user!.sessionId, 'active']);
    res.json({ ok: true, tables, files, seconds: Math.round((Date.now() - started) / 1000), safety, session_kept: !!still });
  } catch (e: any) {
    await exec("UPDATE restores SET status = 'failed', details = ? WHERE id = ?", [String(e?.message ?? e).slice(0, 1000), rid]);
    throw e;
  } finally { restoring = false; }
});
