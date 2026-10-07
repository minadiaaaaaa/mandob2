import { Router, type Request, type Response } from 'express';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import { ROOT, exec, one, q, setSetting, setting, settingInt } from '../db.js';
import { addDays, clean, daysBetween, eq, fail, list, today, type Query, type Spec } from '../http.js';
import { can } from '../auth.js';
import { audit } from '../audit.js';
import { ingestRows, type ImportDef } from '../importer.js';
import { performanceImport, ratingImport } from './performance.js';
import { brandingImport } from './branding.js';
import { fineImport, walletImport } from './finance.js';
import { absenceImport } from './absences.js';
import { liveIngest } from './live.js';

// 6.5–6.7 Data sync. The guide's main route is a browser on the server signed in to Google; this build has none,
// so it runs on the guide's other route: the browser extension sends the report tables to the ingest address.
// ponytail: no server-side Chrome. "Sync now" records each pending day as "Needs sign-in" with the reason;
// the extension (or any script holding the token) delivers the data. Add a headless browser if it must run unattended.
export const syncRouter = Router();
export const ingestRouter = Router();

type Source = { code: string; def: ImportDef; feeds: string; group: 'reports' | 'photos'; mode: 'skip' | 'replace'; wholeTable?: boolean };
const SOURCES: Source[] = [
  { code: 'daily_performance', def: performanceImport, feeds: '/admin/performance', group: 'reports', mode: 'replace' },
  { code: 'branding_photos', def: brandingImport, feeds: '/admin/branding', group: 'photos', mode: 'skip' },
  { code: 'monthly_ratings', def: ratingImport, feeds: '/admin/rider-ratings', group: 'reports', mode: 'replace', wholeTable: true },
  { code: 'fines', def: fineImport, feeds: '/admin/finance/fines', group: 'reports', mode: 'skip' },
  { code: 'wallet', def: walletImport, feeds: '/admin/finance/wallet', group: 'reports', mode: 'replace' },
  { code: 'absences', def: absenceImport, feeds: '/admin/absences', group: 'reports', mode: 'replace' },
];
const byCode = (c: string) => SOURCES.find((s) => s.code === c);

let running = false;
async function sourceState(s: Source, day: string) {
  const row = await one<any>('SELECT * FROM sync_sources WHERE code = ?', [s.code]) ?? { code: s.code, enabled: 1, sync_from: null, create_riders: 0, report_url: null };
  const yesterday = addDays(day, -1);
  const done = new Set((await q<any>("SELECT DISTINCT report_day d FROM sync_runs WHERE source = ? AND status = 'succeeded'", [s.code])).map((r) => r.d));
  let pending: string[] = [];
  if (s.wholeTable) pending = done.has(yesterday) ? [] : [yesterday]; // read in full: one pending read per day
  else for (let d = row.sync_from && row.sync_from <= yesterday ? row.sync_from : yesterday; d <= yesterday && pending.length < 400; d = addDays(d, 1)) if (!done.has(d)) pending.push(d);
  const last = await one<any>('SELECT id, status, started_at, report_day FROM sync_runs WHERE source = ? ORDER BY id DESC LIMIT 1', [s.code]);
  const lastDay = (await one<any>("SELECT MAX(report_day) d FROM sync_runs WHERE source = ? AND status = 'succeeded'", [s.code]))?.d ?? null;
  return { ...row, enabled: !!row.enabled, create_riders: !!row.create_riders, feeds: s.feeds, group: s.group, pending: row.enabled ? pending.length : 0, next_day: pending[0] ?? null, last_day: lastDay, last_run: last ?? null, pending_days: pending };
}
// With no server browser, the session is "via the extension" once the extension has uploaded recently.
async function sessionState() {
  const last = await one<any>("SELECT MAX(started_at) at FROM sync_runs WHERE trigger_type = 'extension'");
  const token = !!(await setting('sync.token_hash'));
  return { state: token && last?.at && daysBetween(String(last.at).slice(0, 10), await today()) <= 7 ? 'extension' : 'none', last_upload: last?.at ?? null, token, server_browser: false };
}

syncRouter.get('/sync', can('sync.view'), async (_req, res) => {
  const day = await today();
  const sources = [];
  for (const s of SOURCES) { const { pending_days: _p, ...st } = await sourceState(s, day); sources.push(st); }
  res.json({
    sources, session: await sessionState(), running,
    schedule: { enabled: (await setting('sync.auto')) !== '0', reports_time: (await setting('sync.reports_time')) || '15:00', photos_time: (await setting('sync.photos_time')) || '10:00',
      max_days: await settingInt('sync.max_days', 7) },
  });
});
// The top-bar button: needs sign-in, pending days, running.
syncRouter.get('/sync/status', can('sync.view'), async (_req, res) => {
  const day = await today();
  let pending = 0;
  for (const s of SOURCES) pending += (await sourceState(s, day)).pending;
  const last = await one<any>("SELECT source, status, started_at FROM sync_runs ORDER BY id DESC LIMIT 1");
  const lastDay = (await one<any>("SELECT MAX(report_day) d FROM sync_runs WHERE status = 'succeeded'"))?.d ?? null;
  res.json({ session: await sessionState(), pending, running, last_run: last ?? null, last_day: lastDay });
});

// "Sync now": every pending day of every active source, oldest first, up to the per-run limit.
// The first day that needs a sign-in stops the rest.
syncRouter.post('/sync/run', can('sync.run'), async (req, res) => {
  const v = clean(req.body, { source: {}, day: { type: 'date' } });
  if (running) fail(409, 'sync_running');
  const day = await today();
  if (v.day && v.day >= day) fail(422, 'sync_day_not_past');
  running = true;
  const out: any[] = [];
  try {
    for (const s of SOURCES.filter((x) => !v.source || x.code === v.source)) {
      const st = await sourceState(s, day);
      if (!st.enabled && !v.day) continue;
      const days = v.day ? [v.day] : st.pending_days.slice(0, await settingInt('sync.max_days', 7));
      for (const d of days) {
        await exec("INSERT INTO sync_runs (source, report_day, status, trigger_type, user_id, finished_at, message) VALUES (?, ?, 'needs_sign_in', 'manual', ?, UTC_TIMESTAMP(), ?)",
          [s.code, d, req.user!.id, 'no_server_browser']);
        out.push({ source: s.code, day: d, status: 'needs_sign_in' });
        break;
      }
      if (out.length) break;
    }
  } finally { running = false; }
  await audit(req, { action: 'sync.run', details: JSON.stringify(out) });
  res.json({ runs: out, nothing: !out.length });
});

syncRouter.patch('/sync/schedule', can('sync.update'), async (req, res) => {
  const v = clean(req.body, { enabled: { type: 'bool' }, reports_time: { type: 'time' }, photos_time: { type: 'time' }, max_days: { type: 'int', min: 1, max: 366 } }, true);
  if ('enabled' in v) await setSetting('sync.auto', v.enabled ? '1' : '0');
  if (v.reports_time) await setSetting('sync.reports_time', v.reports_time);
  if (v.photos_time) await setSetting('sync.photos_time', v.photos_time);
  if (v.max_days) await setSetting('sync.max_days', String(v.max_days));
  await audit(req, { action: 'sync.schedule', after: v });
  res.json({ ok: true });
});
syncRouter.patch('/sync/sources/:code', can('sync.update'), async (req, res) => {
  const s = byCode(String(req.params.code));
  if (!s) fail(404, 'not_found');
  const v = clean(req.body, { enabled: { type: 'bool' }, sync_from: { type: 'date' }, create_riders: { type: 'bool' }, report_url: { max: 500 } }, true);
  if (v.sync_from && v.sync_from >= (await today())) fail(422, 'sync_day_not_past');
  await exec('INSERT INTO sync_sources SET code = ?, ? ON DUPLICATE KEY UPDATE ?', [s!.code, v, v]);
  await audit(req, { action: 'sync.source', entity_type: 'sync_source', entity_id: s!.code, after: v });
  res.json({ ok: true });
});

const runSpec: Spec = {
  from: 'FROM sync_runs s LEFT JOIN users u ON u.id = s.user_id',
  select: 's.*, u.full_name user_name, TIMESTAMPDIFF(SECOND, s.started_at, s.finished_at) seconds',
  search: ['s.message', 'CAST(s.report_day AS CHAR)'],
  filters: { status: eq('s.status'), source: eq('s.source'), from: (v) => ['s.report_day >= ?', [v]], to: (v) => ['s.report_day <= ?', [v]] },
  sorts: { started: 's.id' }, defaultSort: '-started',
};
syncRouter.get('/sync/runs', can('sync.view'), async (req, res) => res.json(await list(runSpec, req.query as Query)));

// ---------- the extension's token: one for the whole system, shown once ----------
const hash = (t: string) => createHash('sha256').update(t).digest('hex');
syncRouter.post('/sync/token', can('sync.manage_session'), async (req, res) => {
  const token = randomBytes(24).toString('base64url');
  await setSetting('sync.token_hash', hash(token));
  await audit(req, { action: 'sync.token_issue', severity: 'warning' });
  res.json({ token });
});
syncRouter.delete('/sync/token', can('sync.manage_session'), async (req, res) => {
  await setSetting('sync.token_hash', null);
  await audit(req, { action: 'sync.token_revoke', severity: 'warning' });
  res.json({ ok: true });
});

// The extension, zipped on the fly (stored, no compression).
syncRouter.get('/sync/extension.zip', can('sync.view'), (_req, res) => {
  const dir = join(ROOT, 'extension');
  const files = readdirSync(dir).map((name) => ({ name: `lsp-sync/${name}`, data: readFileSync(join(dir, name)) }));
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="lsp-sync-extension.zip"');
  res.send(zip(files));
});
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
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dirBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dirBuf, end]);
}

// ---------- the ingest address (no session: the token) ----------
async function tokenOk(req: Request) {
  const stored = await setting('sync.token_hash');
  const got = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  if (!stored || !got) return false;
  const a = Buffer.from(hash(got)); const b = Buffer.from(stored);
  return a.length === b.length && timingSafeEqual(a, b);
}
ingestRouter.post('/sync/ingest', async (req: Request, res: Response) => {
  if (!(await tokenOk(req))) return res.status(401).json({ error: 'token_refused' });
  if (req.body?.source === 'live') { const r = await liveIngest(req.body.rows ?? []); return res.json(r); }
  const s = byCode(String(req.body?.source ?? ''));
  if (!s) return res.status(422).json({ error: 'not_a_sync_source' });
  const day = String(req.body?.day ?? '');
  if (!s.wholeTable && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return res.status(422).json({ error: 'set_one_day' });
  if (!s.wholeTable && day >= (await today())) return res.status(422).json({ error: 'report_shows_today' });
  const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 50000) : [];
  if (!rows.length) return res.status(422).json({ error: 'no_rows' });
  if (running) return res.status(409).json({ error: 'sync_running' });
  running = true;
  const runId = (await exec("INSERT INTO sync_runs (source, report_day, status, trigger_type) VALUES (?, ?, 'running', 'extension')", [s.code, s.wholeTable ? addDays(await today(), -1) : day])).insertId;
  try {
    const src = await one<any>('SELECT create_riders FROM sync_sources WHERE code = ?', [s.code]);
    // the daily sync replaces the day's rows with the report's rows
    if (s.code === 'daily_performance') await exec("DELETE FROM daily_performance WHERE work_date = ? AND source = 'sync'", [day]);
    const r = await ingestRows(s.def, req, rows, s.mode, { create_riders: !!src?.create_riders, create_contracts: true, skip_unknown: true, recheck_changed: true }, { day, sync: '1' });
    await exec("UPDATE sync_runs SET status = 'succeeded', finished_at = UTC_TIMESTAMP(), rows_read = ?, added = ?, replaced = ? WHERE id = ?", [r.read, r.inserted, r.replaced, runId]);
    res.json({ ok: true, ...r });
  } catch (e: any) {
    const status = e?.code === 'missing_required_column' ? 'skipped' : 'failed';
    await exec('UPDATE sync_runs SET status = ?, finished_at = UTC_TIMESTAMP(), message = ? WHERE id = ?', [status, String(e?.code ?? e?.message ?? e).slice(0, 1000), runId]);
    res.status(422).json({ error: e?.code ?? 'server_error', params: e?.params });
  } finally { running = false; }
});
