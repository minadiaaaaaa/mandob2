// Branches and job titles (designations) of one company: the rules every screen, import and sync share (phase 2).
// Every company has exactly one default branch and the built-in titles Driver and Supervisor. A rider or vehicle
// added without a branch or title gets the defaults, so no record is ever left without one.
import { asPlatform, exec, one, q, withTenant } from '../db.js';
import { fieldError } from '../http.js';

const BUILTIN_DESIGNATIONS = [
  { builtin_key: 'driver', name_ar: 'سائق', name_en: 'Driver' },
  { builtin_key: 'supervisor', name_ar: 'مشرف', name_en: 'Supervisor' },
] as const;
const DEFAULT_BRANCH = { name_ar: 'الفرع الرئيسي', name_en: 'Main branch' };

// Gives a company what it needs before its first rider: the default branch, the built-in titles, and a branch and
// title on every record that has none (records from before phase 2). Idempotent; runs at sign-up and at start-up for
// the companies companiesMissingDefaults() names. The main branch and the built-in titles belong to every company,
// whatever its plan, so they are written outside the plan check (asPlatform, with the company named).
export async function ensureCompanyDefaults(tenant: number) {
  await withTenant(tenant, async () => {
    if (!(await one('SELECT 1 FROM branches WHERE is_default = 1'))) {
      // none marked: a branch already called "Main branch" (names are unique), else the oldest active one, else a new one
      const r = await exec('UPDATE branches SET is_default = 1, is_active = 1 ORDER BY name_ar = ? DESC, is_active DESC, id LIMIT 1', [DEFAULT_BRANCH.name_ar]);
      if (!r.affectedRows) await asPlatform(() => exec('INSERT INTO branches SET ?', [{ ...DEFAULT_BRANCH, tenant_id: tenant, is_default: 1 }]));
    }
    for (const d of BUILTIN_DESIGNATIONS) {
      if (await one('SELECT 1 FROM designations WHERE builtin_key = ?', [d.builtin_key])) continue;
      // a custom title of the same name (names are unique) becomes the built-in one
      const same = await one<{ id: number }>('SELECT id FROM designations WHERE name_ar = ?', [d.name_ar]);
      if (same) await exec('UPDATE designations SET builtin_key = ?, is_active = 1 WHERE id = ?', [d.builtin_key, same.id]);
      else await asPlatform(() => exec('INSERT INTO designations SET ?', [{ ...d, tenant_id: tenant }]));
    }
    const { branch_id, designation_id } = await recordDefaults();
    await exec('UPDATE riders SET branch_id = ? WHERE branch_id IS NULL', [branch_id]);
    await exec('UPDATE riders SET designation_id = ? WHERE designation_id IS NULL', [designation_id]);
    await exec('UPDATE vehicles SET branch_id = ? WHERE branch_id IS NULL', [branch_id]);
  });
}

// The companies (the platform's own included) that still lack their main branch or built-in titles, or have a rider
// or vehicle without a branch: one query at start-up instead of the full check for every company. Each test is one
// probe of a (tenant_id, …) index.
export async function companiesMissingDefaults() {
  return (await asPlatform(() => q<{ id: number }>(`SELECT id FROM (SELECT 0 id UNION SELECT id FROM tenants) t
    WHERE NOT EXISTS (SELECT 1 FROM branches b WHERE b.tenant_id = t.id AND b.is_default = 1)
      OR (SELECT COUNT(*) FROM designations d WHERE d.tenant_id = t.id AND d.builtin_key IS NOT NULL) < ?
      OR EXISTS (SELECT 1 FROM riders r WHERE r.tenant_id = t.id AND r.branch_id IS NULL)
      OR EXISTS (SELECT 1 FROM riders r WHERE r.tenant_id = t.id AND r.designation_id IS NULL)
      OR EXISTS (SELECT 1 FROM vehicles v WHERE v.tenant_id = t.id AND v.branch_id IS NULL)`, [BUILTIN_DESIGNATIONS.length]))).map((r) => r.id);
}

// The branch and title a new record gets when none is given (inside the current company), in one query.
type Defaults = { branch_id: number | null; designation_id: number | null };
async function recordDefaults(): Promise<Defaults> {
  const [r] = await q<Defaults>(`SELECT (SELECT id FROM branches WHERE is_default = 1 LIMIT 1) branch_id,
    (SELECT id FROM designations WHERE builtin_key = 'driver' LIMIT 1) designation_id`);
  return r;
}
// New rider / vehicle values with the defaults filled in where the caller gave none (read only then). An import
// passes `cache` (its ctx.cache) so the defaults are read once per file, not once per row.
async function defaultsFor(cache?: Map<string, any>): Promise<Defaults> {
  if (!cache) return recordDefaults();
  if (!cache.has('org:defaults')) cache.set('org:defaults', await recordDefaults());
  return cache.get('org:defaults');
}
export async function withRiderDefaults<T extends Record<string, unknown>>(v: T, cache?: Map<string, any>) {
  if (v.branch_id != null && v.designation_id != null) return v;
  const d = await defaultsFor(cache);
  return { ...v, branch_id: v.branch_id ?? d.branch_id, designation_id: v.designation_id ?? d.designation_id };
}
export async function withVehicleDefaults<T extends Record<string, unknown>>(v: T, cache?: Map<string, any>) {
  return v.branch_id != null ? v : { ...v, branch_id: (await defaultsFor(cache)).branch_id };
}

// A branch or title given to a record must be active and belong to this company (queries are company-scoped, and
// the (tenant_id, branch_id) foreign key refuses another company's id even if this check were skipped).
// Not given (undefined): nothing to check. Emptied on an edit (null): refused, every record keeps a branch and title.
// `current`: the value the record already has may stay even if it was switched off since.
async function checkActive(table: 'branches' | 'designations', code: string, id: unknown, field: string, current?: unknown) {
  if (id === undefined) return;
  if (id === null) fieldError(field, 'required');
  if (current != null && Number(current) === Number(id)) return;
  if (!(await one(`SELECT 1 FROM ${table} WHERE id = ? AND is_active = 1`, [id]))) fieldError(field, code);
}
export const checkBranch = (id: unknown, field = 'branch_id', current?: unknown) => checkActive('branches', 'branch_unavailable', id, field, current);
export const checkDesignation = (id: unknown, field = 'designation_id', current?: unknown) => checkActive('designations', 'designation_unavailable', id, field, current);

// Import files name the branch or title (Arabic or English, any case); unknown names are row errors, never created on
// the fly (that would go round the plan's limit). Returns the id, null for an empty cell, or false for an unknown name.
export async function importOrgId(cache: Map<string, any>, kind: 'branches' | 'designations', name: string | null): Promise<number | null | false> {
  if (!name) return null;
  const key = `org:names:${kind}`;
  if (!cache.has(key)) {
    const m = new Map<string, number>();
    for (const r of await q<{ id: number; name_ar: string; name_en: string | null }>(`SELECT id, name_ar, name_en FROM ${kind} WHERE is_active = 1`))
      for (const n of [r.name_ar, r.name_en]) if (n) m.set(n.trim().toLowerCase(), r.id);
    cache.set(key, m);
  }
  return cache.get(key).get(name.trim().toLowerCase()) ?? false;
}

// What still uses a branch or title (a used one can be switched off but not deleted).
export async function branchUse(id: number | string) {
  const [r] = await q<{ riders: number; vehicles: number }>('SELECT (SELECT COUNT(*) FROM riders WHERE branch_id = ?) riders, (SELECT COUNT(*) FROM vehicles WHERE branch_id = ?) vehicles', [id, id]);
  return { riders: Number(r.riders), vehicles: Number(r.vehicles) };
}
export async function designationUse(id: number | string) {
  const [r] = await q<{ riders: number }>('SELECT COUNT(*) riders FROM riders WHERE designation_id = ?', [id]);
  return { riders: Number(r.riders) };
}
