import { Router, type Request } from 'express';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { STORAGE_DIR } from './db.js';
import { DOC_MIME, attach, upload } from './files.js';
import { fail } from './http.js';
import { requireUser } from './auth.js';

// A scan attached in a form lives here until the record is saved. Unsaved scans are removed after two hours.
const TMP = join(STORAGE_DIR, 'tmp');
mkdirSync(TMP, { recursive: true });
const TWO_HOURS = 2 * 3600 * 1000;

setInterval(() => {
  for (const f of readdirSync(TMP)) {
    const p = join(TMP, f);
    if (Date.now() - statSync(p).mtimeMs > TWO_HOURS) unlinkSync(p);
  }
}, 10 * 60 * 1000).unref();

export const scansRouter = Router();
scansRouter.use(requireUser);

scansRouter.post('/', upload.single('file'), async (req, res) => {
  const f = req.file;
  if (!f) fail(422, 'file_required');
  if (!DOC_MIME[f!.mimetype]) fail(415, 'file_type_not_allowed');
  if (f!.size > 10 * 1024 * 1024) fail(413, 'file_too_large', { max: 10 });
  const token = randomBytes(12).toString('hex');
  writeFileSync(join(TMP, token), f!.buffer);
  writeFileSync(join(TMP, `${token}.json`), JSON.stringify({ name: Buffer.from(f!.originalname, 'latin1').toString('utf8'), mime: f!.mimetype, size: f!.size, user: req.user!.id }));
  res.json({ token, name: f!.originalname, size: f!.size, mime: f!.mimetype });
});

scansRouter.get('/:token', (req, res) => {
  const meta = ownMeta(req, req.params.token);
  if (!meta) fail(410, 'scan_gone');
  res.setHeader('Content-Type', meta!.mime);
  res.send(readFileSync(join(TMP, req.params.token)));
});

// Automatic reading of documents. The original platform reads text PDFs directly and uses OCR for images.
// ponytail: no reading engine yet — every reader answers "unavailable" and the form stays usable for manual entry.
scansRouter.post('/:token/read', (req, res) => {
  if (!ownMeta(req, req.params.token)) fail(410, 'scan_gone');
  res.json({ status: 'unavailable', fields: [] });
});

scansRouter.delete('/:token', (req, res) => {
  if (!/^[a-f0-9]{24}$/.test(req.params.token)) fail(404, 'scan_gone');
  ownMeta(req, req.params.token);
  for (const f of [req.params.token, `${req.params.token}.json`]) if (existsSync(join(TMP, f))) unlinkSync(join(TMP, f));
  res.json({ ok: true });
});

function readMeta(token: string): { name: string; mime: string; size: number; user: number } | null {
  if (!/^[a-f0-9]{24}$/.test(token)) return null;
  const p = join(TMP, `${token}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

function ownMeta(req: Request, token: string) {
  const meta = readMeta(token);
  if (meta && meta.user !== req.user?.id) fail(404, 'scan_gone');
  return meta;
}

// Moves a scan from the temporary area onto a record as its current attachment.
export async function claimScan(req: Request, token: string | null | undefined, entityType: string, entityId: string | number, attachmentType: string | null = null, note: string | null = null) {
  if (!token) return null;
  const meta = ownMeta(req, token);
  if (!meta) fail(410, 'scan_gone');
  const buffer = readFileSync(join(TMP, token));
  const id = await attach(req, entityType, entityId, { buffer, mimetype: meta!.mime, size: meta!.size, originalname: Buffer.from(meta!.name, 'utf8').toString('latin1') } as Express.Multer.File, attachmentType, note);
  for (const f of [token, `${token}.json`]) if (existsSync(join(TMP, f))) unlinkSync(join(TMP, f));
  return id;
}
