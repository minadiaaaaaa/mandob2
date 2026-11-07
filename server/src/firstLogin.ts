// server/data/first-login.txt holds the platform owner's generated password (seed.ts) until it is no longer needed:
// it is deleted as soon as that password is replaced, so it never stays on disk by accident.
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './db.js';

export const FIRST_LOGIN_FILE = () => join(DATA_DIR, 'first-login.txt');

// Called after a staff password change; removes the file when it is that user's (the platform owner's).
export function forgetFirstLogin(tenant: number, username: string) {
  const file = FIRST_LOGIN_FILE();
  if (tenant !== 0 || !existsSync(file)) return;
  try {
    const m = /^Username:\s*(.+)$/m.exec(readFileSync(file, 'utf8'));
    if (m && m[1].trim() === username) { unlinkSync(file); console.log('first-login.txt deleted: the owner set a new password'); }
  } catch { /* the file stays; nothing else depends on it */ }
}
