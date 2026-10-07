import { Router, type Request, type Response } from 'express';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import { randomBytes } from 'node:crypto';
import { HttpError, fail, langOf, latinDigits, tr } from './http.js';
import { can } from './auth.js';
import { upload } from './files.js';
import { audit } from './audit.js';
import { tx } from './db.js';

// One import definition per screen. The flow is always: File → Preview (writes nothing) → Result.
export type Row = Record<string, any>;
export type Parsed = { line: number; key: string; data: Row; label?: string; warnings?: string[] };
export type ImportDef = {
  name: string;
  perm: string;
  columns: Record<string, string[]>;      // field → translation keys / aliases its header may carry
  requiredColumns: string[][];            // the file must carry one column of each group
  templateColumns?: string[];             // the template's columns when not all of them
  matchOn: string;                        // translation key shown in the preview
  maxRows?: number;
  options?: string[];                     // extra switches the screen sends, e.g. create_riders
  parse(r: Row, ctx: Ctx): Promise<Parsed | string>;   // a string is a problem code
  existing(items: Parsed[], ctx: Ctx): Promise<Map<string, any>>;
  check?(item: Parsed, existing: any, ctx: Ctx): Promise<string | null>; // a code turns the row into a problem
  write(item: Parsed, existing: any, ctx: Ctx): Promise<'inserted' | 'replaced' | 'skipped' | string>;
  counts?(items: Parsed[], existing: Map<string, any>, ctx: Ctx): Promise<Record<string, number>>;
};
export type Ctx = { req: Request; mode: 'skip' | 'replace'; options: Record<string, boolean>; present: Set<string>; cache: Map<string, any>; result: Record<string, number> };

const LANGS = ['ar', 'en', 'bn', 'ur'];
const norm = (s: string) => latinDigits(String(s)).toLowerCase().replace(/[\s_\-.()/:]+/g, '');

function headerMap(def: ImportDef, headers: string[]) {
  const alias = new Map<string, string>();
  for (const [field, keys] of Object.entries(def.columns)) {
    for (const k of keys) {
      alias.set(norm(k), field);
      for (const l of LANGS) alias.set(norm(tr(l, k)), field);
    }
  }
  const map: Record<string, string> = {};
  const unknown: string[] = [];
  const duplicate: string[] = [];
  for (const h of headers) {
    const f = alias.get(norm(h));
    if (!f) unknown.push(h);
    else if (Object.values(map).includes(f)) duplicate.push(h); // the first is taken
    else map[h] = f;
  }
  return { map, unknown, duplicate };
}

export function readSheet(buf: Buffer) {
  let wb: XLSX.WorkBook;
  try { wb = XLSX.read(buf, { type: 'buffer', cellDates: true, dense: true }); }
  catch { throw new HttpError(422, 'file_unreadable'); }
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Row>(ws, { defval: null, raw: true });
  const headers = (XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 })[0] ?? []).map((h) => String(h ?? '').trim()).filter(Boolean);
  return { rows, headers };
}

// ---------- cell readers ----------
export const cellStr = (v: any, max?: number) => {
  if (v === null || v === undefined) return null;
  const s = latinDigits(String(v instanceof Date ? v.toISOString().slice(0, 10) : v)).trim();
  if (!s || s === '-' || /^n\/?a$/i.test(s)) return null;
  return max ? s.slice(0, max) : s;
};
export function cellDate(v: any): string | null | undefined {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const s = cellStr(v);
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return undefined; // unreadable
}
export function cellBool(v: any): number | null {
  const s = cellStr(v)?.toLowerCase();
  if (s == null) return null;
  if (['نعم', 'yes', 'true', '1', 'y'].includes(s)) return 1;
  if (['لا', 'no', 'false', '0', 'n'].includes(s)) return 0;
  return null;
}
export const cellNum = (v: any) => {
  const s = cellStr(v);
  if (s == null) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
};

// ---------- the preview store: valid for 30 minutes ----------
const previews = new Map<string, { user: number; def: string; items: Parsed[]; mode: 'skip' | 'replace'; options: Record<string, boolean>; present: Set<string>; at: number }>();
const TTL = 30 * 60 * 1000;

export function importRoutes(def: ImportDef) {
  const r = Router();

  r.get('/template', can(def.perm), async (req: Request, res: Response) => {
    const lang = await langOf(req);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Template');
    ws.addRow((def.templateColumns ?? Object.keys(def.columns)).map((f) => tr(lang, def.columns[f][0]))).font = { bold: true };
    ws.columns.forEach((c) => { c.width = 22; });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${def.name}-template.xlsx"`);
    await audit(req, { action: `${def.name}.template_download` });
    await wb.xlsx.write(res);
    res.end();
  });

  r.post('/preview', can(def.perm), upload.single('file'), async (req: Request, res: Response) => {
    if (!req.file) fail(422, 'file_required');
    if (req.file!.size > 5 * 1024 * 1024 * 4) fail(413, 'file_too_large');
    const mode = req.body.mode === 'replace' ? 'replace' : 'skip';
    const options = Object.fromEntries((def.options ?? []).map((o) => [o, req.body[o] === '1' || req.body[o] === 'true']));
    const { rows, headers } = readSheet(req.file!.buffer);
    const { map, unknown, duplicate } = headerMap(def, headers);
    const present = new Set(Object.values(map));
    const missingRequired = def.requiredColumns.filter((g) => !g.some((f) => present.has(f)));
    if (missingRequired.length) throw new HttpError(422, 'missing_required_column', { columns: missingRequired.map((g) => g.join(' / ')) });
    const max = def.maxRows ?? 5000;
    if (rows.length > max) fail(422, 'too_many_rows', { max });

    const ctx: Ctx = { req, mode, options, present, cache: new Map(), result: {} };
    const items: Parsed[] = [];
    const problems: { line: number; reason: string }[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < rows.length; i++) {
      const raw: Row = {};
      for (const [h, f] of Object.entries(map)) raw[f] = rows[i][h];
      const line = i + 2;
      const p = await def.parse(raw, ctx);
      if (typeof p === 'string') { problems.push({ line, reason: p }); continue; }
      p.line = line;
      if (seen.has(p.key)) { problems.push({ line, reason: 'duplicate_in_file' }); continue; }
      seen.add(p.key);
      items.push(p);
    }
    const existing = await def.existing(items, ctx);
    if (def.check) {
      for (const it of [...items]) {
        const p = await def.check(it, existing.get(it.key), ctx);
        if (p) { problems.push({ line: it.line, reason: p }); items.splice(items.indexOf(it), 1); }
      }
      problems.sort((a, b) => a.line - b.line);
    }
    const isNew = items.filter((it) => !existing.has(it.key)).length;
    const token = randomBytes(12).toString('hex');
    previews.set(token, { user: req.user!.id, def: def.name, items, mode, options, present, at: Date.now() });
    for (const [k, v] of previews) if (Date.now() - v.at > TTL) previews.delete(k);
    const fields = Object.keys(def.columns);
    res.json({
      token, matchOn: def.matchOn,
      rows: rows.length, readable: items.length, new: isNew,
      replace: mode === 'replace' ? items.length - isNew : 0,
      skip: mode === 'skip' ? items.length - isNew : 0,
      problems: problems.length, problemList: problems.slice(0, 10),
      unknownColumns: unknown, duplicateColumns: duplicate,
      absentColumns: fields.filter((f) => !present.has(f)),
      warnings: [...new Set(items.flatMap((i) => i.warnings ?? []))].slice(0, 20),
      extra: def.counts ? await def.counts(items, existing, ctx) : {},
      sample: items.slice(0, 12).map((it) => ({ line: it.line, key: it.key, label: it.label, action: existing.has(it.key) ? (mode === 'replace' ? 'replace' : 'skip') : 'insert' })),
    });
  });

  r.post('/run', can(def.perm), async (req: Request, res: Response) => {
    const p = previews.get(req.body.token);
    if (!p || p.user !== req.user!.id || p.def !== def.name || Date.now() - p.at > TTL) fail(410, 'preview_expired');
    previews.delete(req.body.token);
    const ctx: Ctx = { req, mode: p!.mode, options: p!.options, present: p!.present, cache: new Map(), result: {} };
    const result: Record<string, number> = { inserted: 0, replaced: 0, skipped: 0, failed: 0 };
    ctx.result = result;
    await tx(async () => {
      const existing = await def.existing(p!.items, ctx);
      for (const it of p!.items) {
        const out = await def.write(it, existing.get(it.key), ctx);
        result[out] = (result[out] ?? 0) + 1;
      }
    });
    await audit(req, { action: `${def.name}.import`, details: JSON.stringify(result) });
    res.json(result);
  });

  return r;
}
