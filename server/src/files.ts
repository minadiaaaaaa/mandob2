import { Router, type Request } from 'express';
import multer from 'multer';
import { randomBytes } from 'node:crypto';
import { copyFileSync, mkdirSync, unlinkSync, writeFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { STORAGE_DIR, exec, one, q, settingInt } from './db.js';
import { HttpError, fail } from './http.js';
import { can, has } from './auth.js';
import { audit } from './audit.js';

export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 26 * 1024 * 1024, files: 10 } });

export const DOC_MIME: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'application/pdf': '.pdf',
};

// Which module's "view" a record type belongs to; the attachments permissions sit on top of it.
const MODULE_OF: Record<string, string> = {
  organization: 'organization', user: 'users', rider: 'riders', applicant: 'applicants', contract: 'contracts',
  rider_doc_id: 'id_documents', rider_doc_license: 'driving_licenses', rider_doc_health: 'health_certs',
  rider_doc_driver_card: 'driver_cards', rider_doc_ajeer: 'ajeer_permits',
  vehicle: 'vehicles', transport_license: 'transport_licenses', operation_card: 'operation_cards',
  vehicle_registration: 'vehicle_registrations', insurance_policy: 'insurance_policies', vehicle_insurance: 'vehicle_insurance',
  fuel_card: 'fuel_cards', oil_change: 'oil_changes', renewal: 'renewals', advance: 'advances', leave: 'leaves', absence: 'absences',
  // a full permission where the module has no "view"
  change_request: 'rider_portal.view_requests', issue_message: 'rider_portal.view_issues',
};

export async function storeFile(file: Express.Multer.File, allowed = DOC_MIME) {
  const ext = allowed[file.mimetype];
  if (!ext) fail(415, 'file_type_not_allowed');
  const max = await settingInt('platform.max_upload_mb', 10);
  if (file.size > max * 1024 * 1024) fail(413, 'file_too_large', { max });
  const sub = new Date().toISOString().slice(0, 7);
  mkdirSync(join(STORAGE_DIR, sub), { recursive: true });
  const stored = `${sub}/${randomBytes(12).toString('hex')}${ext}`;
  writeFileSync(join(STORAGE_DIR, stored), file.buffer);
  return stored;
}

// Conversation files: any type except programs and scripts, up to 25 MB.
const BLOCKED = /\.(exe|msi|bat|cmd|com|scr|ps1|vbs|vbe|js|jse|wsf|wsh|sh|jar|apk|dll|cpl|hta|lnk|reg|php|py|pl)$/i;
export async function attachAny(req: Request | null, entityType: string, entityId: string | number, file: Express.Multer.File, attachmentType: string | null, uploadedBy: number | null) {
  const name = Buffer.from(file.originalname, 'latin1').toString('utf8');
  if (BLOCKED.test(name)) fail(415, 'file_type_not_allowed');
  if (file.size > 25 * 1024 * 1024) fail(413, 'file_too_large', { max: 25 });
  const sub = new Date().toISOString().slice(0, 7);
  mkdirSync(join(STORAGE_DIR, sub), { recursive: true });
  const ext = (extname(name).toLowerCase().match(/^\.[a-z0-9]{1,8}$/) ?? [''])[0];
  const stored = `${sub}/${randomBytes(12).toString('hex')}${ext}`;
  writeFileSync(join(STORAGE_DIR, stored), file.buffer);
  const r = await exec('INSERT INTO attachments (entity_type, entity_id, attachment_type, file_name, stored_name, mime, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [entityType, String(entityId), attachmentType, name, stored, file.mimetype || 'application/octet-stream', file.size, uploadedBy]);
  if (req) await audit(req, { action: 'attachment.upload', entity_type: entityType, entity_id: entityId, details: name });
  return r.insertId;
}

// A copy of an attachment on another record (an approved request's file becomes the document's file).
export async function copyAttachment(id: number, entityType: string, entityId: string | number, attachmentType: string | null, uploadedBy: number | null) {
  const a = await one<any>('SELECT * FROM attachments WHERE id = ?', [id]);
  if (!a || !existsSync(join(STORAGE_DIR, a.stored_name))) return null;
  const sub = new Date().toISOString().slice(0, 7);
  mkdirSync(join(STORAGE_DIR, sub), { recursive: true });
  const stored = `${sub}/${randomBytes(12).toString('hex')}${extname(a.stored_name)}`;
  copyFileSync(join(STORAGE_DIR, a.stored_name), join(STORAGE_DIR, stored));
  await exec('UPDATE attachments SET is_current = 0 WHERE entity_type = ? AND entity_id = ? AND attachment_type <=> ?', [entityType, String(entityId), attachmentType]);
  const r = await exec('INSERT INTO attachments (entity_type, entity_id, attachment_type, file_name, stored_name, mime, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [entityType, String(entityId), attachmentType, a.file_name, stored, a.mime, a.size, uploadedBy]);
  return r.insertId;
}

// Saves an attachment. A new file of the same type becomes the current one; the older ones stay as history.
export async function attach(req: Request, entityType: string, entityId: string | number, file: Express.Multer.File, attachmentType: string | null, note: string | null) {
  const stored = await storeFile(file);
  await exec('UPDATE attachments SET is_current = 0 WHERE entity_type = ? AND entity_id = ? AND attachment_type <=> ?', [entityType, String(entityId), attachmentType]);
  const r = await exec('INSERT INTO attachments (entity_type, entity_id, attachment_type, file_name, stored_name, mime, size, note, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [entityType, String(entityId), attachmentType, Buffer.from(file.originalname, 'latin1').toString('utf8'), stored, file.mimetype, file.size, note, req.user?.id ?? null]);
  await audit(req, { action: 'attachment.upload', entity_type: entityType, entity_id: entityId, details: file.originalname });
  return r.insertId;
}

export async function removeAttachment(id: number) {
  const a = await one<any>('SELECT * FROM attachments WHERE id = ?', [id]);
  if (!a) return;
  await exec('DELETE FROM attachments WHERE id = ?', [id]);
  const p = join(STORAGE_DIR, a.stored_name);
  if (existsSync(p)) unlinkSync(p);
  if (a.is_current) { // the newest remaining file becomes current
    await exec(`UPDATE attachments SET is_current = 1 WHERE id = (SELECT id FROM (SELECT id FROM attachments WHERE entity_type = ? AND entity_id = ? AND attachment_type <=> ? ORDER BY id DESC LIMIT 1) t)`,
      [a.entity_type, a.entity_id, a.attachment_type]);
  }
  return a;
}

function checkModule(req: Request, entityType: string) {
  const mod = MODULE_OF[entityType];
  if (!mod) fail(400, 'invalid');
  const perm = mod.includes('.') ? mod : `${mod}.view`;
  if (!has(req, perm)) throw new HttpError(403, 'forbidden', { perm });
}

export const attachmentsRouter = Router();

attachmentsRouter.get('/', can('attachments.view'), async (req, res) => {
  const { entity_type, entity_id } = req.query as Record<string, string>;
  checkModule(req, entity_type);
  res.json(await q(`SELECT a.id, a.attachment_type, a.file_name, a.mime, a.size, a.note, a.is_current, a.created_at, u.full_name uploaded_by_name
    FROM attachments a LEFT JOIN users u ON u.id = a.uploaded_by WHERE entity_type = ? AND entity_id = ? ORDER BY a.id DESC`, [entity_type, entity_id]));
});

attachmentsRouter.post('/', can('attachments.upload'), upload.single('file'), async (req, res) => {
  const { entity_type, entity_id, attachment_type, note } = req.body;
  checkModule(req, entity_type);
  if (!req.file) fail(422, 'file_required');
  res.json({ id: await attach(req, entity_type, entity_id, req.file!, attachment_type || null, note?.slice(0, 255) || null) });
});

attachmentsRouter.post('/:id/current', can('attachments.upload'), async (req, res) => {
  const a = await one<any>('SELECT * FROM attachments WHERE id = ?', [req.params.id]);
  if (!a) fail(404, 'not_found');
  checkModule(req, a.entity_type);
  await exec('UPDATE attachments SET is_current = (id = ?) WHERE entity_type = ? AND entity_id = ? AND attachment_type <=> ?', [a.id, a.entity_type, a.entity_id, a.attachment_type]);
  res.json({ ok: true });
});

attachmentsRouter.get('/:id/file', can('attachments.download', 'attachments.view'), async (req, res) => {
  const a = await one<any>('SELECT * FROM attachments WHERE id = ?', [req.params.id]);
  if (!a) fail(404, 'not_found');
  checkModule(req, a.entity_type);
  const download = req.query.download === '1';
  if (download && !has(req, 'attachments.download')) fail(403, 'forbidden', { perm: 'attachments.download' });
  const name = (req.query.name as string) || a.file_name;
  sendStored(res, a, download, name);
});

// Only types that cannot run scripts open in the browser; anything else (HTML, SVG…) is always downloaded.
const INLINE = /^(image\/(jpeg|png|webp|gif)|application\/pdf|audio\/[\w.+-]+|video\/[\w.+-]+|text\/plain)$/;
export function sendStored(res: import('express').Response, a: { mime: string; file_name: string; stored_name: string }, download: boolean, name = a.file_name) {
  const inline = !download && INLINE.test(a.mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', INLINE.test(a.mime) ? a.mime : 'application/octet-stream');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name.endsWith(extname(a.file_name)) ? name : name + extname(a.file_name))}`);
  res.sendFile(join(STORAGE_DIR, a.stored_name));
}

attachmentsRouter.delete('/:id', can('attachments.delete'), async (req, res) => {
  const a = await one<any>('SELECT entity_type FROM attachments WHERE id = ?', [req.params.id]);
  if (!a) fail(404, 'not_found');
  checkModule(req, a.entity_type);
  const removed = await removeAttachment(Number(req.params.id));
  await audit(req, { action: 'attachment.delete', entity_type: removed.entity_type, entity_id: removed.entity_id, severity: 'warning', details: removed.file_name });
  res.json({ ok: true });
});
