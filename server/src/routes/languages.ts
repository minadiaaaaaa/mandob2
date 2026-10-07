import { Router } from 'express';
import ExcelJS from 'exceljs';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, exec, one, q, setSetting, setting } from '../db.js';
import { clean, fail, fieldError } from '../http.js';
import { can } from '../auth.js';
import { audit } from '../audit.js';
import { upload } from '../files.js';
import { readSheet } from '../importer.js';

// 11.10 Languages & translations. Arabic is the reference; an upload or an edit is saved as an override on top
// of the language file, and the interface reads the overrides when it loads — "Rebuild now" publishes them.
export const languagesRouter = Router();
export const publicLanguagesRouter = Router();

const BUILTIN: Record<string, { name_native: string; name_en: string; dir: 'rtl' | 'ltr' }> = {
  ar: { name_native: 'العربية', name_en: 'Arabic', dir: 'rtl' }, en: { name_native: 'English', name_en: 'English', dir: 'ltr' },
  bn: { name_native: 'বাংলা', name_en: 'Bengali', dir: 'ltr' }, ur: { name_native: 'اردو', name_en: 'Urdu', dir: 'rtl' },
};
const file = (lang: string): Record<string, string> => { try { return JSON.parse(readFileSync(join(ROOT, '..', 'shared', 'i18n', `${lang}.json`), 'utf8')); } catch { return {}; } };
const ref = () => file('ar');
async function overrides(lang: string) {
  return Object.fromEntries((await q<any>('SELECT tkey, value FROM translation_overrides WHERE lang = ?', [lang])).map((r) => [r.tkey, r.value]));
}
async function all() {
  const custom = await q<any>('SELECT * FROM languages ORDER BY code');
  return [...Object.entries(BUILTIN).map(([code, l]) => ({ code, ...l, builtin: true })), ...custom.filter((c) => !BUILTIN[c.code]).map((c) => ({ ...c, builtin: false }))];
}
const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

// What the interface loads: the languages to offer and every override.
publicLanguagesRouter.get('/public/i18n', async (_req, res) => {
  const rows = await q<any>('SELECT lang, tkey, value FROM translation_overrides');
  const overridesBy: Record<string, Record<string, string>> = {};
  for (const r of rows) (overridesBy[r.lang] ??= {})[r.tkey] = r.value;
  res.json({ languages: (await all()).map(({ code, name_native, dir, font, flag }: any) => ({ code, name: name_native, dir, font, flag })), overrides: overridesBy, version: (await setting('i18n.version')) ?? '0' });
});

languagesRouter.get('/languages', can('languages.view'), async (_req, res) => {
  const keys = Object.keys(ref());
  const out = [];
  for (const l of await all()) {
    const o = await overrides(l.code);
    const base = l.builtin ? file(l.code) : {};
    const translated = keys.filter((k) => (o[k] ?? base[k] ?? '').toString().trim()).length;
    out.push({ ...l, translated, missing: keys.length - translated, overrides: Object.keys(o).length, completeness: keys.length ? Math.round((translated / keys.length) * 1000) / 10 : 0 });
  }
  const build = { status: (await setting('i18n.build_status')) ?? 'idle', at: await setting('i18n.build_at'), pending: (await setting('i18n.pending')) === '1' };
  res.json({ languages: out, keys: keys.length, build });
});

languagesRouter.get('/languages/:code/keys', can('languages.view'), async (req, res) => {
  const code = String(req.params.code);
  const l = (await all()).find((x) => x.code === code);
  if (!l) fail(404, 'not_found');
  const ar = ref(); const en = file('en'); const base = l!.builtin ? file(code) : {}; const o = await overrides(code);
  const s = String(req.query.search ?? '').toLowerCase();
  let rows = Object.keys(ar).map((k) => ({ key: k, ar: ar[k], en: en[k] ?? null, value: o[k] ?? base[k] ?? null, overridden: k in o }));
  if (req.query.show === 'missing') rows = rows.filter((r) => !r.value);
  if (req.query.show === 'overridden') rows = rows.filter((r) => r.overridden);
  if (s) rows = rows.filter((r) => [r.key, r.ar, r.en, r.value].some((x) => String(x ?? '').toLowerCase().includes(s)));
  const page = Math.max(1, Number(req.query.page) || 1);
  res.json({ rows: rows.slice((page - 1) * 50, page * 50), total: rows.length, page, pageSize: 50 });
});

async function setOverride(lang: string, key: string, value: string, userId: number) {
  const ar = ref();
  if (!(key in ar)) return 'unknown_key';
  const v = value.trim();
  if (!v) return 'empty';
  if (v.length > 5000) return 'too_long';
  // the placeholders between curly brackets must stay as they are
  if (vars(v) !== vars(ar[key])) return 'placeholder_mismatch';
  await exec('INSERT INTO translation_overrides (lang, tkey, value, updated_by) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by), updated_at = UTC_TIMESTAMP()', [lang, key, v, userId]);
  await setSetting('i18n.pending', '1');
  return null;
}
languagesRouter.put('/languages/:code/keys/:key', can('languages.manage'), async (req, res) => {
  const err = await setOverride(String(req.params.code), String(req.params.key), String(req.body?.value ?? ''), req.user!.id);
  if (err) fieldError('value', `translation_${err}`);
  await audit(req, { action: 'translation.edit', entity_type: 'language', entity_id: req.params.code as string, details: req.params.key as string });
  res.json({ ok: true });
});
languagesRouter.delete('/languages/:code/keys/:key', can('languages.manage'), async (req, res) => {
  await exec('DELETE FROM translation_overrides WHERE lang = ? AND tkey = ?', [req.params.code, req.params.key]);
  await setSetting('i18n.pending', '1');
  res.json({ ok: true });
});

languagesRouter.post('/languages', can('languages.manage'), async (req, res) => {
  const v = clean(req.body, { code: { req: true, max: 10 }, dir: { req: true, enum: ['rtl', 'ltr'] }, name_native: { req: true, max: 60 }, name_en: { req: true, max: 60 }, font: { max: 100 }, flag: { max: 16 } });
  if (!/^[a-z]{2,3}(-[A-Z]{2})?$/.test(v.code)) fieldError('code', 'language_code_format');
  if (BUILTIN[v.code] || (await one('SELECT 1 FROM languages WHERE code = ?', [v.code]))) fieldError('code', 'language_exists');
  await exec('INSERT INTO languages SET ?', [v]);
  await setSetting('i18n.pending', '1');
  await audit(req, { action: 'language.create', entity_type: 'language', entity_id: v.code });
  res.json({ ok: true });
});
languagesRouter.delete('/languages/:code', can('languages.manage'), async (req, res) => {
  const code = String(req.params.code);
  if (BUILTIN[code]) fail(409, 'language_builtin');
  const backup = await q('SELECT tkey, value FROM translation_overrides WHERE lang = ?', [code]);
  await setSetting(`i18n.deleted.${code}`, JSON.stringify(backup)); // a copy of its translations is kept
  await exec('DELETE FROM translation_overrides WHERE lang = ?', [code]);
  await exec('DELETE FROM languages WHERE code = ?', [code]);
  await setSetting('i18n.pending', '1');
  await audit(req, { action: 'language.delete', entity_type: 'language', entity_id: code, severity: 'critical' });
  res.json({ ok: true });
});

// Download: every key with the Arabic, the English and this language's current text.
languagesRouter.get('/languages/:code/export', can('languages.view'), async (req, res) => {
  const code = String(req.params.code);
  const l = (await all()).find((x) => x.code === code);
  if (!l) fail(404, 'not_found');
  const ar = ref(); const en = file('en'); const base = l!.builtin ? file(code) : {}; const o = await overrides(code);
  const rows = Object.keys(ar).map((k) => ({ key: k, ar: ar[k], en: en[k] ?? '', [code]: o[k] ?? base[k] ?? '' }));
  const fmt = String(req.query.format ?? 'xlsx');
  res.setHeader('Content-Disposition', `attachment; filename="translation-${code}.${fmt}"`);
  if (fmt === 'json') return res.json(Object.fromEntries(rows.map((r) => [r.key, r[code]])));
  if (fmt === 'csv') {
    const esc = (s: unknown) => { const t = String(s ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return res.send('﻿' + [`key,ar,en,${code}`, ...rows.map((r) => [r.key, r.ar, r.en, r[code]].map(esc).join(','))].join('\r\n'));
  }
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet(code);
  ws.addRow(['key', 'ar', 'en', code]).font = { bold: true };
  for (const r of rows) ws.addRow([r.key, r.ar, r.en, r[code]]);
  ws.columns.forEach((c, i) => { c.width = i === 0 ? 34 : 50; });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  await wb.xlsx.write(res); res.end();
});

// Upload: analyse first (writes nothing), then apply.
const pendingUploads = new Map<string, { lang: string; user: number; values: Record<string, string>; at: number }>();
languagesRouter.post('/languages/:code/import/analyse', can('languages.manage'), upload.single('file'), async (req, res) => {
  const code = String(req.params.code);
  if (!(await all()).some((x) => x.code === code)) fail(404, 'not_found');
  if (!req.file) fail(422, 'file_required');
  if (req.file!.size > 5 * 1024 * 1024) fail(413, 'file_too_large', { max: 5 });
  let values: Record<string, string> = {};
  if (/\.json$/i.test(req.file!.originalname)) {
    try { values = JSON.parse(req.file!.buffer.toString('utf8')); } catch { fail(422, 'file_unreadable'); }
  } else {
    const { rows } = readSheet(req.file!.buffer);
    for (const r of rows) { const k = String(r.key ?? '').trim(); if (k) values[k] = String(r[code] ?? r.translation ?? r.value ?? '').trim(); }
  }
  const ar = ref(); const cur = { ...(file(code)), ...(await overrides(code)) };
  const c = { values: 0, new: 0, changed: 0, unchanged: 0, unknown: 0, empty: 0, placeholder_errors: 0, missing_after: 0 };
  const accepted: Record<string, string> = {};
  for (const [k, raw] of Object.entries(values)) {
    c.values++;
    const v = String(raw ?? '').trim();
    if (!(k in ar)) { c.unknown++; continue; }
    if (!v) { c.empty++; continue; }
    if (vars(v) !== vars(ar[k])) { c.placeholder_errors++; continue; }
    if (!cur[k]) c.new++; else if (cur[k] !== v) c.changed++; else { c.unchanged++; continue; }
    accepted[k] = v;
  }
  c.missing_after = Object.keys(ar).filter((k) => !(accepted[k] ?? cur[k])).length;
  const token = randomBytes(10).toString('hex');
  pendingUploads.set(token, { lang: code, user: req.user!.id, values: accepted, at: Date.now() });
  res.json({ token, ...c });
});
languagesRouter.post('/languages/:code/import/apply', can('languages.manage'), async (req, res) => {
  const p = pendingUploads.get(String(req.body?.token));
  if (!p || p.lang !== req.params.code || p.user !== req.user!.id || Date.now() - p.at > 30 * 60000) fail(410, 'preview_expired');
  pendingUploads.delete(String(req.body.token));
  let n = 0;
  for (const [k, v] of Object.entries(p!.values)) if (!(await setOverride(p!.lang, k, v, req.user!.id))) n++;
  await audit(req, { action: 'translation.import', entity_type: 'language', entity_id: p!.lang, details: `${n} values` });
  res.json({ applied: n });
});

// "Rebuild now": publish the overrides. The interface fetches them at load, so the build is immediate.
languagesRouter.post('/languages/rebuild', can('languages.manage'), async (req, res) => {
  await setSetting('i18n.version', String(Date.now()));
  await setSetting('i18n.build_status', 'succeeded');
  await setSetting('i18n.build_at', new Date().toISOString().slice(0, 19).replace('T', ' '));
  await setSetting('i18n.pending', '0');
  await audit(req, { action: 'translation.rebuild' });
  res.json({ ok: true });
});
