import { Router } from 'express';
import { exec, one, q, setSetting, setting, settingInt } from '../db.js';
import { addDays, clean, fail, latinDigits, today } from '../http.js';
import { can } from '../auth.js';
import { audit } from '../audit.js';
import { cellNum, cellStr } from '../importer.js';

// 3.6–3.9 Live riders. The platform board arrives through the sync ingest (source "live"), every minute.
// Standing = staying within a radius of one point; a location older than 15 minutes is stale.
export const liveRouter = Router();

const FRESH_MIN = 15;
async function cfg() {
  return {
    enabled: (await setting('live.enabled')) !== '0', cities: (await setting('live.cities')) ?? '', interval: await settingInt('live.interval', 60),
    radius: await settingInt('live.radius_m', 150), min_stop: await settingInt('live.min_stop_min', 20), keep_days: await settingInt('live.keep_days', 30),
    wallet_limit: await settingInt('live.wallet_limit', 500), day_start: await settingInt('live.day_start_hour', 5),
  };
}
// The working day is not the calendar day: a shift that runs past midnight belongs to the day it started.
async function workDay(at = new Date()) {
  const tz = (await setting('org.timezone')) || 'Asia/Riyadh';
  const shifted = new Date(at.getTime() - (await settingInt('live.day_start_hour', 5)) * 3600000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(shifted);
}
const metres = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371000; const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r; const dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// ---------- ingest: one row per rider on the board ----------
const pick = (row: Record<string, unknown>, ...keys: string[]) => {
  for (const [k, v] of Object.entries(row)) if (keys.includes(k.toLowerCase().replace(/[\s_-]+/g, ''))) return v;
  return undefined;
};
export async function liveIngest(rows: Record<string, unknown>[]) {
  const c = await cfg();
  if (!c.enabled) return { ok: false, error: 'live_reading_off' };
  const now = new Date();
  const day = await workDay(now);
  const nowSql = now.toISOString().slice(0, 19).replace('T', ' ');
  let read = 0;
  for (const row of rows.slice(0, 5000)) {
    const id = Number(latinDigits(String(pick(row, 'riderid', 'id') ?? '')));
    if (!id) continue;
    const num = (...k: string[]) => { const v = cellNum(pick(row, ...k)); return v == null ? null : v; };
    const lat = num('lat', 'latitude'); const lng = num('lng', 'lon', 'longitude');
    const status = cellStr(pick(row, 'status', 'state'), 40)?.toLowerCase().replace(/\s+/g, '_') ?? null;
    const b = {
      rider_id: id, name: cellStr(pick(row, 'name', 'ridername'), 150), status, seen_at: nowSql, work_day: day,
      lat, lng, located_at: lat != null ? nowSql : null, shift_start: cellStr(pick(row, 'shiftstart'), 10), shift_end: cellStr(pick(row, 'shiftend'), 10),
      worked_min: num('workedmin', 'worked'), late_min: num('latemin', 'late'), breaks: num('breaks'), break_min: num('breakmin'),
      completed: num('completed', 'deliveries'), cancelled: num('cancelled'), active_orders: num('activeorders', 'orders'), wallet: num('wallet', 'walletbalance'),
    };
    await exec('INSERT INTO live_board SET ? ON DUPLICATE KEY UPDATE ?', [b, Object.fromEntries(Object.entries(b).filter(([k, v]) => k !== 'rider_id' && (v !== null || k === 'status')))]);
    if (lat != null && lng != null) {
      await exec('INSERT INTO live_points (rider_id, at, work_day, lat, lng, accuracy, status, has_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, nowSql, day, lat, lng, num('accuracy'), status, (b.active_orders ?? 0) > 0 ? 1 : 0]);
    }
    // the platform's figures are the day's totals, so shifts are not added up twice
    await exec(`INSERT INTO live_days (rider_id, work_day, shifts, worked_min, late_min, breaks, break_min, completed, cancelled, wallet) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE shifts = COALESCE(VALUES(shifts), shifts), worked_min = COALESCE(VALUES(worked_min), worked_min), late_min = COALESCE(VALUES(late_min), late_min),
      breaks = COALESCE(VALUES(breaks), breaks), break_min = COALESCE(VALUES(break_min), break_min), completed = COALESCE(VALUES(completed), completed),
      cancelled = COALESCE(VALUES(cancelled), cancelled), wallet = COALESCE(VALUES(wallet), wallet)`,
      [id, day, num('shifts'), b.worked_min, b.late_min, b.breaks, b.break_min, b.completed, b.cancelled, b.wallet]);
    read++;
  }
  await setSetting('live.last_read', nowSql);
  await exec('DELETE FROM live_points WHERE at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY) LIMIT 10000', [c.keep_days]);
  return { ok: true, read };
}

// ---------- stops: a run of points that stays within the radius of where it started ----------
type Pt = { at: string; lat: number; lng: number; status: string | null; has_order: number };
export function stops(points: Pt[], radius: number, minMinutes: number) {
  const out: { from: string; to: string; minutes: number; lat: number; lng: number; with_order: boolean; statuses: Record<string, number>; open: boolean }[] = [];
  let i = 0;
  while (i < points.length) {
    let j = i;
    while (j + 1 < points.length && metres(points[i], points[j + 1]) <= radius) j++;
    const minutes = (Date.parse(points[j].at.replace(' ', 'T') + 'Z') - Date.parse(points[i].at.replace(' ', 'T') + 'Z')) / 60000;
    if (minutes >= minMinutes) {
      const seg = points.slice(i, j + 1);
      const statuses: Record<string, number> = {};
      for (const p of seg) statuses[p.status ?? 'unknown'] = (statuses[p.status ?? 'unknown'] ?? 0) + 1;
      out.push({ from: points[i].at, to: points[j].at, minutes: Math.round(minutes), lat: points[i].lat, lng: points[i].lng,
        with_order: seg.filter((p) => p.has_order).length * 2 >= seg.length, statuses, open: j === points.length - 1 });
    }
    i = j + 1;
  }
  return out;
}
const pts = (riderId: number, day: string) => q<any>('SELECT at, lat, lng, status, has_order FROM live_points WHERE rider_id = ? AND work_day = ? ORDER BY at', [riderId, day])
  .then((r) => r.map((p) => ({ ...p, lat: Number(p.lat), lng: Number(p.lng) })));

// ======================================================================== 3.6 the board
liveRouter.get('/live', can('live_riders.view'), async (_req, res) => {
  const c = await cfg();
  const board = await q<any>(`SELECT b.*, r.id known, TIMESTAMPDIFF(MINUTE, b.located_at, UTC_TIMESTAMP()) loc_age FROM live_board b LEFT JOIN riders r ON r.id = b.rider_id
    WHERE b.seen_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${FRESH_MIN} MINUTE)`);
  for (const b of board) {
    const p = b.loc_age != null && b.loc_age <= FRESH_MIN ? await pts(b.rider_id, b.work_day) : [];
    // standing since: walk back from the latest point while it stays within the radius
    let since: string | null = null;
    if (p.length) { const last = p[p.length - 1]; for (let i = p.length - 1; i >= 0 && metres(last, p[i]) <= c.radius; i--) since = p[i].at; }
    b.standing_min = since ? Math.round((Date.now() - Date.parse(since.replace(' ', 'T') + 'Z')) / 60000) : null;
    b.stale = b.lat != null && (b.loc_age == null || b.loc_age > FRESH_MIN);
    b.over = b.standing_min != null && b.standing_min >= c.min_stop;
    b.wallet_over = b.wallet != null && Number(b.wallet) > c.wallet_limit;
  }
  // fixed order: longest standing, then most late, then name
  board.sort((a, b) => (b.standing_min ?? -1) - (a.standing_min ?? -1) || (b.late_min ?? 0) - (a.late_min ?? 0) || String(a.name).localeCompare(String(b.name)));
  const st = (s: string) => board.filter((b) => b.status === s).length;
  res.json({ rows: board, last_read: await setting('live.last_read'), radius: c.radius, min_stop: c.min_stop,
    stats: { board: board.length, working: st('working'), late: board.filter((b) => b.status === 'late' || b.late_min > 0).length, break: st('on_break'),
      standing: board.filter((b) => b.over).length, wallet: board.filter((b) => b.wallet_over).length } });
});

// ======================================================================== 3.7 the day's report
async function report(query: Record<string, any>) {
  const c = await cfg();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(query.day ?? '') ? query.day : await workDay();
  const min = [20, 30, 40, 50, 60, 90, 120].includes(Number(query.min_stop)) ? Number(query.min_stop) : c.min_stop;
  const riders = await q<any>(`SELECT d.*, b.name, b.status now_status, r.id known, r.full_name, b.wallet board_wallet,
    (SELECT attendance_rate FROM daily_performance p WHERE p.rider_id = d.rider_id AND p.work_date = d.work_day) attendance
    FROM live_days d LEFT JOIN live_board b ON b.rider_id = d.rider_id LEFT JOIN riders r ON r.id = d.rider_id WHERE d.work_day = ?`, [day]);
  const out = [];
  for (const r of riders) {
    const s = stops(await pts(r.rider_id, day), c.radius, min);
    const total = s.reduce((a, x) => a + x.minutes, 0);
    const longest = Math.max(0, ...s.map((x) => x.minutes));
    const idle = s.filter((x) => !x.with_order);
    const hours = (r.worked_min ?? 0) / 60;
    const perHour = hours >= 0.25 ? (r.completed ?? 0) / hours : null;
    // high: twice the limit in total, or one stop of 1.5× the limit, with under one order per hour worked
    const level = (total >= 2 * min || longest >= 1.5 * min) && (perHour === null || perHour < 1) ? 'high' : total >= min ? 'medium' : 'normal';
    out.push({ ...r, name: r.full_name ?? r.name, stops: s.length, total, longest, idle_min: idle.reduce((a, x) => a + x.minutes, 0), idle_n: idle.length,
      idle_longest: Math.max(0, ...idle.map((x) => x.minutes)), per_hour: perHour, level, standing_now: s.some((x) => x.open) });
  }
  let rows = out;
  const term = latinDigits(String(query.search ?? '').trim());
  if (term) rows = rows.filter((r) => String(r.rider_id) === term || String(r.name ?? '').includes(term));
  if (query.standing_only) rows = rows.filter((r) => r.stops > 0);
  if (Number(query.idle) > 0) rows = rows.filter((r) => r.idle_min >= Number(query.idle));
  const SORT: Record<string, (a: any, b: any) => number> = {
    standing: (a, b) => b.total - a.total, weakest: (a, b) => (a.per_hour ?? 99) - (b.per_hour ?? 99), late: (a, b) => (b.late_min ?? 0) - (a.late_min ?? 0),
    least_worked: (a, b) => (a.worked_min ?? 0) - (b.worked_min ?? 0), idle: (a, b) => b.idle_min - a.idle_min,
  };
  rows.sort(SORT[Number(query.idle) > 0 ? 'idle' : query.sort ?? 'standing'] ?? SORT.standing);
  return { day, min_stop: min, rows, all: out };
}
liveRouter.get('/live/report', can('live_riders.view'), async (req, res) => {
  const r = await report(req.query as any);
  const sum = (k: string) => r.all.reduce((a: number, x: any) => a + Number(x[k] ?? 0), 0);
  res.json({ day: r.day, min_stop: r.min_stop, rows: r.rows, stats: { riders: r.all.length, over: r.all.filter((x) => x.stops > 0).length, high: r.all.filter((x) => x.level === 'high').length,
    idle: r.all.filter((x) => x.idle_n > 0).length, idle_min: sum('idle_min'), total: sum('total'), completed: sum('completed') } });
});
liveRouter.get('/live/report/export', can('live_riders.view'), async (req, res) => {
  const r = await report({ ...req.query, search: '' }); // the search by name does not carry over to the file
  const cols = ['rider_id', 'name', 'shifts', 'worked_min', 'late_min', 'break_min', 'breaks', 'completed', 'per_hour', 'stops', 'total', 'longest', 'idle_min', 'idle_n', 'idle_longest', 'attendance', 'wallet'];
  const esc = (v: unknown) => { const s = v == null ? '' : typeof v === 'number' ? String(Math.round(v * 100) / 100) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="live-report-${r.day}.csv"`);
  res.send('﻿' + [cols.join(','), ...r.rows.map((x: any) => cols.map((k) => esc(x[k])).join(','))].join('\r\n'));
});

// ======================================================================== 3.8 a rider's day
liveRouter.get('/live/riders/:id', can('live_riders.view'), async (req, res) => {
  const id = Number(req.params.id);
  const c = await cfg();
  const b = await one<any>('SELECT b.*, r.id known, r.full_name, r.phone FROM live_board b LEFT JOIN riders r ON r.id = b.rider_id WHERE b.rider_id = ?', [id]);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.day ?? '')) ? String(req.query.day) : b?.work_day ?? (await workDay());
  if (day > (await workDay())) fail(422, 'future_day');
  const p = await pts(id, day);
  const d = await one<any>('SELECT * FROM live_days WHERE rider_id = ? AND work_day = ?', [id, day]);
  const perf = await one<any>('SELECT attendance_rate, acceptance_rate, completed, lost_hours FROM daily_performance WHERE rider_id = ? AND work_date = ?', [id, day]);
  // the status through the day, as segments
  const timeline: { status: string; from: string; to: string }[] = [];
  for (const x of p) { const last = timeline[timeline.length - 1]; if (last && last.status === (x.status ?? 'unknown')) last.to = x.at; else timeline.push({ status: x.status ?? 'unknown', from: x.at, to: x.at }); }
  const sample = p.length > 400 ? p.filter((_, i) => i % Math.ceil(p.length / 400) === 0) : p;
  res.json({ rider: b ?? { rider_id: id }, day, prev: addDays(day, -1), next: addDays(day, 1), min_stop: c.min_stop, live: d,
    stops: stops(p, c.radius, 10).sort((a, x) => x.minutes - a.minutes), timeline, route: sample, points: p.length,
    first: p[0]?.at ?? null, last: p[p.length - 1]?.at ?? null, performance: perf ?? null });
});
liveRouter.get('/live/riders/:id/points.csv', can('live_riders.view'), async (req, res) => {
  const day = String(req.query.day ?? await workDay());
  const p = await q<any>('SELECT at, lat, lng, accuracy, status, has_order FROM live_points WHERE rider_id = ? AND work_day = ? ORDER BY at', [req.params.id, day]);
  const tz = (await setting('org.timezone')) || 'Asia/Riyadh';
  const local = (s: string) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, dateStyle: 'short', timeStyle: 'medium' }).format(new Date(s.replace(' ', 'T') + 'Z'));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="points-${req.params.id}-${day}.csv"`);
  res.send('﻿time,latitude,longitude,accuracy_m,status,has_order\r\n' + p.map((x) => [local(x.at), x.lat, x.lng, x.accuracy ?? '', x.status ?? '', x.has_order ? 'yes' : 'no'].join(',')).join('\r\n'));
});

// ======================================================================== 3.9 the board session card and its settings
liveRouter.get('/live/session', can('live_riders.view'), async (_req, res) => {
  const c = await cfg();
  const last = await setting('live.last_read');
  const [counts] = await q<any>(`SELECT (SELECT COUNT(*) FROM live_points WHERE work_day = ?) today,
    (SELECT COUNT(*) FROM live_board WHERE seen_at = (SELECT MAX(seen_at) FROM live_board)) riders`, [await workDay()]);
  const fresh = last && Date.now() - Date.parse(last.replace(' ', 'T') + 'Z') < 10 * 60000;
  res.json({ state: last ? (fresh ? 'working' : 'expired') : 'none', last_read: last, today_points: Number(counts.today), riders: Number(counts.riders), settings: c });
});
liveRouter.patch('/live/settings', can('live_riders.manage'), async (req, res) => {
  const v = clean(req.body, {
    enabled: { type: 'bool' }, cities: { max: 200 }, interval: { type: 'int', min: 30, max: 600 }, radius_m: { type: 'int', min: 50, max: 2000 },
    min_stop_min: { type: 'int', min: 5, max: 600 }, keep_days: { type: 'int', min: 7, max: 730 },
  }, true);
  if (v.cities && !/^\d+(,\s*\d+)*$/.test(v.cities)) fail(422, 'invalid');
  for (const [k, val] of Object.entries(v)) await setSetting(`live.${k}`, val == null ? null : String(val));
  await audit(req, { action: 'live.settings', after: v });
  res.json({ ok: true });
});
liveRouter.delete('/live/session', can('live_riders.manage'), async (req, res) => {
  await setSetting('live.last_read', null);
  await audit(req, { action: 'live.session_remove', severity: 'warning' });
  res.json({ ok: true });
});
