import type { NextFunction, Request, Response } from 'express';
import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, q, setting } from './db.js';

// ---------- errors: codes, not prose, so the client shows them in the user's language ----------
export class HttpError extends Error {
  constructor(public status: number, public code: string, public params: Record<string, unknown> = {}, public fields?: Record<string, string>) {
    super(code);
  }
}
export const fail = (status: number, code: string, params: Record<string, unknown> = {}): never => {
  throw new HttpError(status, code, params);
};

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, params: err.params, fields: err.fields });
  if (err?.setup) return res.status(503).json({ error: 'setup_required', setup: true });
  if (err?.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'duplicate', params: { detail: err.sqlMessage } });
  if (err?.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ error: 'in_use' });
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'file_too_large' });
  console.error(err);
  res.status(500).json({ error: 'server_error' });
}

// ---------- input cleaning ----------
type Rule = {
  req?: boolean; max?: number; min?: number; type?: 'str' | 'int' | 'num' | 'date' | 'email' | 'bool' | 'digits' | 'phone' | 'time';
  enum?: readonly string[]; minLen?: number;
};
const AR_DIGITS = /[٠-٩۰-۹]/g;
export const latinDigits = (s: string) => s.replace(AR_DIGITS, (d) => String((d.charCodeAt(0) & 0xf) % 10));

// Returns only the fields the rules know. With partial=true (edit screens) absent fields are skipped,
// so an edit saves only what changed.
export function clean(body: Record<string, any>, rules: Record<string, Rule>, partial = false) {
  const out: Record<string, any> = {};
  const fields: Record<string, string> = {};
  for (const [k, r] of Object.entries(rules)) {
    if (partial && !(k in body)) continue;
    let v = body[k];
    if (typeof v === 'string') v = v.trim();
    if (v === '' || v === undefined) v = null;
    if (v === null) {
      if (r.req) fields[k] = 'required';
      // On create an empty optional field is left out so the column default applies; on edit it clears the value.
      else if (partial) out[k] = r.type === 'bool' ? 0 : null;
      continue;
    }
    const t = r.type ?? 'str';
    if (t === 'bool') { out[k] = v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0; continue; }
    if (typeof v === 'string') v = latinDigits(v);
    if (t === 'int' || t === 'num') {
      const n = Number(v);
      if (!Number.isFinite(n) || (t === 'int' && !Number.isInteger(n))) { fields[k] = 'invalid_number'; continue; }
      if (r.min !== undefined && n < r.min) { fields[k] = 'too_small'; continue; }
      if (r.max !== undefined && n > r.max) { fields[k] = 'too_large'; continue; }
      out[k] = n; continue;
    }
    v = String(v);
    if (t === 'date' && !(/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)))) { fields[k] = 'invalid_date'; continue; }
    if (t === 'time' && !/^\d{2}:\d{2}$/.test(v)) { fields[k] = 'invalid'; continue; }
    if (t === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { fields[k] = 'invalid_email'; continue; }
    if (t === 'digits' && !/^\d+$/.test(v)) { fields[k] = 'digits_only'; continue; }
    if (t === 'phone' && !/^\+?[\d\s()-]{5,}$/.test(v)) { fields[k] = 'invalid_phone'; continue; }
    if (r.enum && !r.enum.includes(v)) { fields[k] = 'invalid'; continue; }
    if (r.minLen && v.length < r.minLen) { fields[k] = 'too_short'; continue; }
    if (r.max && v.length > r.max) { fields[k] = 'too_long'; continue; }
    out[k] = v;
  }
  if (Object.keys(fields).length) throw new HttpError(422, 'validation', {}, fields);
  return out;
}
export const fieldError = (field: string, code: string, params: Record<string, unknown> = {}): never => {
  throw new HttpError(422, code, params, { [field]: code });
};

// ---------- dates ----------
export async function today() {
  const tz = (await setting('org.timezone')) || 'Asia/Riyadh';
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}
export const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
// Monthly steps: if the day does not exist in the target month, use its last day.
export function addMonths(d: string, n: number) {
  const [y, m, day] = d.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target.toISOString().slice(0, 10);
}
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);

// Plates: spaces and the spellings of hamza do not matter when matching.
export const plateKey = (s: string) => latinDigits(s).replace(/\s+/g, '').replace(/[أإآ]/g, 'ا').toUpperCase();

// ---------- lists: search, filters, sorting, pages ----------
export type Query = Record<string, string | undefined>;
type Filter = (v: string, q: Query) => string | [string, unknown[]] | null;
export type Spec = {
  from: string;
  select: string;
  groupBy?: string;
  search?: (string | ((term: string) => [string, unknown[]]))[];
  searchDigits?: string;
  filters?: Record<string, Filter>;
  sorts: Record<string, string>;
  defaultSort: string;
};

export function where(spec: Spec, query: Query, skip: string[] = []) {
  const parts: string[] = [];
  const params: unknown[] = [];
  const s = latinDigits(query.search?.trim() ?? '');
  if (s) {
    if (spec.searchDigits && /^\d+$/.test(s)) { parts.push(`${spec.searchDigits} = ?`); params.push(s); }
    else if (spec.search?.length) {
      // a string with its own "?" is used as written (e.g. a subquery); a function gets the raw term (e.g. plate keys)
      const ors: string[] = [];
      for (const c of spec.search) {
        if (typeof c === 'function') { const [sql, p] = c(s); ors.push(sql); params.push(...p); }
        else { ors.push(c.includes('?') ? c : `${c} LIKE ?`); params.push(`%${s}%`); }
      }
      parts.push(`(${ors.join(' OR ')})`);
    }
  }
  for (const [name, f] of Object.entries(spec.filters ?? {})) {
    const v = query[name];
    if (v === undefined || v === '' || skip.includes(name)) continue;
    const r = f(v, query);
    if (!r) continue;
    if (typeof r === 'string') parts.push(r);
    else { parts.push(r[0]); params.push(...r[1]); }
  }
  return { sql: parts.length ? ` WHERE ${parts.join(' AND ')}` : '', params };
}

function orderBy(spec: Spec, query: Query) {
  const raw = query.sort || spec.defaultSort;
  const desc = raw.startsWith('-');
  const col = spec.sorts[desc ? raw.slice(1) : raw] ?? spec.sorts[spec.defaultSort.replace(/^-/, '')];
  return ` ORDER BY ${col} ${desc ? 'DESC' : 'ASC'}`;
}

export async function list(spec: Spec, query: Query) {
  const w = where(spec, query);
  const pageSize = [10, 25, 50, 100].includes(Number(query.pageSize)) ? Number(query.pageSize) : 25;
  const page = Math.max(1, Number(query.page) || 1);
  const group = spec.groupBy ? ` GROUP BY ${spec.groupBy}` : '';
  const countSql = spec.groupBy
    ? `SELECT COUNT(*) n FROM (SELECT 1 ${spec.from}${w.sql}${group}) t`
    : `SELECT COUNT(*) n ${spec.from}${w.sql}`;
  const [{ n }] = await q<{ n: number }>(countSql, w.params);
  const rows = await q(`SELECT ${spec.select} ${spec.from}${w.sql}${group}${orderBy(spec, query)} LIMIT ? OFFSET ?`, [...w.params, pageSize, (page - 1) * pageSize]);
  return { rows, total: Number(n), page, pageSize };
}

export async function listAll(spec: Spec, query: Query, cap = 10000) {
  const w = where(spec, query);
  const group = spec.groupBy ? ` GROUP BY ${spec.groupBy}` : '';
  return q(`SELECT ${spec.select} ${spec.from}${w.sql}${group}${orderBy(spec, query)} LIMIT ${cap}`, w.params);
}

// "a,b" → IN (?, ?) filter
export const inList = (col: string): Filter => (v) => {
  const vals = v.split(',').filter(Boolean);
  return vals.length ? [`${col} IN (${vals.map(() => '?').join(',')})`, vals] : null;
};
export const eq = (col: string): Filter => (v) => [`${col} = ?`, [v]];

// ---------- translations shared with the web app ----------
const dicts = new Map<string, Record<string, string>>();
function dict(lang: string) {
  if (!dicts.has(lang)) {
    try { dicts.set(lang, JSON.parse(readFileSync(join(ROOT, '..', 'shared', 'i18n', `${lang}.json`), 'utf8'))); }
    catch { dicts.set(lang, {}); }
  }
  return dicts.get(lang)!;
}
export function tr(lang: string, key: string, vars: Record<string, unknown> = {}) {
  const s = dict(lang)[key] ?? dict('en')[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}
export async function langOf(req: Request) {
  return req.user?.locale || (await setting('org.default_language')) || 'ar';
}

// ---------- export to Excel / CSV ----------
export type Col = { key: string; label: string; value?: (r: any) => unknown; fill?: (r: any) => string | null; width?: number };
const FILL: Record<string, string> = { red: 'FFFDE2E2', amber: 'FFFEF3C7', green: 'FFDCFCE7', blue: 'FFDBEAFE', grey: 'FFF1F5F9' };

export async function sendExport(req: Request, res: Response, opts: {
  format: 'xlsx' | 'csv'; title: string; cols: Col[]; rows: any[]; filters?: string; summary?: [string, unknown][];
}) {
  const lang = await langOf(req);
  const headers = opts.cols.map((c) => tr(lang, c.label));
  const cell = (c: Col, r: any) => { const v = c.value ? c.value(r) : r[c.key]; return v === null || v === undefined || v === '' ? '-' : v; };
  const title = tr(lang, opts.title);
  const date = new Date().toISOString().slice(0, 10);
  const fname = encodeURIComponent(`${title} ${date}.${opts.format}`);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fname}`);

  if (opts.format === 'csv') {
    const esc = (v: unknown) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [headers.map(esc).join(','), ...opts.rows.map((r) => opts.cols.map((c) => esc(cell(c, r))).join(','))];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return res.send('﻿' + lines.join('\r\n'));
  }

  // The Excel file carries the organization details, the title, the filters and the counts, then the table.
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(title.slice(0, 31), { views: [{ rightToLeft: lang === 'ar' || lang === 'ur' }] });
  const org = await q<{ key: string; value: string }>("SELECT `key`, value FROM settings WHERE `key` IN ('org.name','org.cr_number','org.tax_number')");
  const o = Object.fromEntries(org.map((r) => [r.key, r.value]));
  const head = [o['org.name'], [o['org.cr_number'] && `${tr(lang, 'org.cr_number')}: ${o['org.cr_number']}`, o['org.tax_number'] && `${tr(lang, 'org.tax_number')}: ${o['org.tax_number']}`].filter(Boolean).join('   '), title, opts.filters, `${tr(lang, 'export.records')}: ${opts.rows.length}`, ...(opts.summary ?? []).map(([k, v]) => `${tr(lang, k)}: ${v}`), `${tr(lang, 'export.generated')}: ${new Date().toLocaleString('en-GB')}`].filter(Boolean) as string[];
  head.forEach((line, i) => { const r = ws.addRow([line]); r.font = { bold: i < 3, size: i === 2 ? 14 : 11 }; });
  ws.addRow([]);
  const hr = ws.addRow(headers);
  hr.font = { bold: true };
  hr.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } }; });
  for (const r of opts.rows) {
    const row = ws.addRow(opts.cols.map((c) => cell(c, r)));
    opts.cols.forEach((c, i) => {
      const f = c.fill?.(r);
      if (f && FILL[f]) row.getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL[f] } };
    });
  }
  ws.columns.forEach((c, i) => { c.width = opts.cols[i]?.width ?? Math.min(40, Math.max(12, headers[i]?.length + 4 || 12)); });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  await wb.xlsx.write(res);
  res.end();
}
