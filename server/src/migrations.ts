// Numbered schema migrations. schema.sql is the baseline every install starts from; every change after it
// is a step here. Each step runs once per database (recorded in schema_migrations), under a lock so two
// servers starting together cannot both run it, and its helpers check information_schema first, so a step
// that was half applied can safely run again (MySQL 8 has no ADD COLUMN IF NOT EXISTS).
// Rules for new steps: never edit or reorder an existing step; add the next number. New columns are nullable
// or have a default, so existing companies keep working.
import { asPlatform, executeScript, q, withNamedLock } from './db.js';
import { identifier } from './sql.js';
import { FREE_PLAN, LIMIT_COLUMNS, PLAN_DEFAULTS } from './domain/plans.js';

export type Migration = { id: number; name: string; up: () => Promise<void> };

export async function columnExists(table: string, column: string) {
  const [r] = await q<{ n: number }>('SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [table, column]);
  return Number(r.n) > 0;
}
export async function indexExists(table: string, index: string) {
  const [r] = await q<{ n: number }>('SELECT COUNT(*) n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?', [table, index]);
  return Number(r.n) > 0;
}
export async function constraintExists(table: string, name: string) {
  const [r] = await q<{ n: number }>('SELECT COUNT(*) n FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?', [table, name]);
  return Number(r.n) > 0;
}
// `definition` is trusted SQL written in this file, never user input.
export async function addColumn(table: string, column: string, definition: string) {
  if (!(await columnExists(table, column))) await executeScript(`ALTER TABLE ${identifier(table)} ADD COLUMN ${identifier(column)} ${definition}`);
}
export async function addIndex(table: string, index: string, columns: string[], unique = false) {
  if (!(await indexExists(table, index)))
    await executeScript(`ALTER TABLE ${identifier(table)} ADD ${unique ? 'UNIQUE ' : ''}INDEX ${identifier(index)} (${columns.map(identifier).join(', ')})`);
}
export async function dropIndex(table: string, index: string) {
  if (await indexExists(table, index)) await executeScript(`ALTER TABLE ${identifier(table)} DROP INDEX ${identifier(index)}`);
}

// The steps, in order.
export const MIGRATIONS: Migration[] = [
  {
    // Lists of the fast-growing tables filter by company first, then by date or record.
    id: 1, name: 'company-first indexes on growing tables',
    up: async () => {
      await addIndex('audit_log', 'ix_t_created', ['tenant_id', 'created_at']);
      await addIndex('audit_log', 'ix_t_entity', ['tenant_id', 'entity_type', 'entity_id']);
      await addIndex('login_attempts', 'ix_t_created', ['tenant_id', 'created_at']);
      await addIndex('email_log', 'ix_t_created', ['tenant_id', 'created_at']);
      await addIndex('error_log', 'ix_t_created', ['tenant_id', 'created_at']);
      await addIndex('attachments', 'ix_t_entity', ['tenant_id', 'entity_type', 'entity_id']);
      await addIndex('live_points', 'ix_t_rider_at', ['tenant_id', 'rider_id', 'at']);
      await addIndex('rider_change_requests', 'ix_t_status', ['tenant_id', 'status', 'created_at']);
      await addIndex('sessions', 'ix_t_user', ['tenant_id', 'user_id', 'status']);
      await addIndex('notifications', 'ix_t_user', ['tenant_id', 'user_id', 'created_at']);
      await addIndex('cron_runs', 'ix_t_job', ['tenant_id', 'job']);
    },
  },
  {
    // A rider's number (the delivery app's ID) is unique inside a company, not across the platform: a rider who
    // moves to another company can be registered there, and a company can no longer find out which numbers another
    // company holds. Every link to a rider becomes (tenant_id, rider_id).
    id: 2, name: 'rider key per company',
    // The links are a fixed list (the baseline schema's), not read back from the database: if the step stops after
    // dropping the old keys, the rerun still knows every link it has to re-create.
    up: async () => {
      for (const [table, column] of RIDER_LINKS) {
        for (const fk of await singleColumnRiderKeys(table, column)) await executeScript(`ALTER TABLE ${identifier(table)} DROP FOREIGN KEY ${identifier(fk)}`);
        await addIndex(table, `ix_t_${column}`, ['tenant_id', column]);
      }
      const pk = await q<{ c: string }>("SELECT COLUMN_NAME c FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'riders' AND CONSTRAINT_NAME = 'PRIMARY' ORDER BY ORDINAL_POSITION");
      if (pk.map((r) => r.c).join(',') !== 'tenant_id,id') await executeScript('ALTER TABLE riders DROP PRIMARY KEY, ADD PRIMARY KEY (tenant_id, id)');
      for (const [table, column] of RIDER_LINKS) {
        const name = `fk_${table}_${column}`.slice(0, 64);
        if (!(await constraintExists(table, name)))
          await executeScript(`ALTER TABLE ${identifier(table)} ADD CONSTRAINT ${identifier(name)} FOREIGN KEY (tenant_id, ${identifier(column)}) REFERENCES riders (tenant_id, id)`);
      }
    },
  },
  {
    // Plans like LogisTap's (phase 1): the Free plan a company falls back to, the extra quotas, the device limit,
    // features per plan, an annual price that may follow the discount, and a downgrade that waits for the renewal.
    // Existing plans keep their prices and limits; only the new columns get the defaults of plans.ts.
    id: 3, name: 'plans aligned with LogisTap',
    up: async () => {
      for (const c of LIMIT_COLUMNS) await addColumn('plans', c, 'INT NULL');
      await executeScript('ALTER TABLE plans MODIFY price_annual DECIMAL(10,2) NULL DEFAULT NULL');
      await addColumn('tenants', 'next_plan_key', 'VARCHAR(30) NULL');
      await addColumn('tenants', 'next_payment_id', 'INT NULL');
      // the defaults' annual price of 0 was a placeholder: leave it to the discount rule
      await q('UPDATE plans SET price_annual = NULL WHERE price_annual = 0 AND price_monthly = 0');
      for (const p of PLAN_DEFAULTS) {
        await q('INSERT IGNORE INTO plans (`key`, name_ar, name_en, price_monthly, price_annual, sort) VALUES (?, ?, ?, 0, NULL, ?)', [p.key, p.name_ar, p.name_en, p.sort]);
        const set = Object.fromEntries(Object.entries(p.limits).filter(([k]) => k !== 'max_riders' && k !== 'max_users' && k !== 'max_vehicles'));
        await q('UPDATE plans SET ?, features = COALESCE(features, ?) WHERE `key` = ?', [set, JSON.stringify(p.features), p.key]);
        if (p.key === FREE_PLAN) await q('UPDATE plans SET max_riders = ?, max_users = ?, max_vehicles = ? WHERE `key` = ?', [p.limits.max_riders, p.limits.max_users, p.limits.max_vehicles, p.key]);
      }
      // companies whose trial or period already ended were read-only; from now on they are on Free
      await q("UPDATE tenants SET plan_key = ?, status = 'active', period_ends_at = NULL, billing_cycle = 'monthly', updated_at = UTC_TIMESTAMP() WHERE status = 'expired'", [FREE_PLAN]);
    },
  },
  {
    // Phase 2: riders get a branch and a job title, vehicles a branch (tables in schema.sql). The keys include the
    // company, so a record can only point at a branch of its own company. Filling the existing records with the
    // company's main branch and "Driver" is done by ensureCompanyDefaults (domain/branches.ts) after the migrations.
    id: 4, name: 'branches and designations',
    up: async () => {
      for (const [table, column, target] of BRANCH_LINKS) {
        await addColumn(table, column, 'INT NULL');
        await addIndex(table, `ix_t_${column}`, ['tenant_id', column]);
        const name = `fk_${table}_${column}`;
        if (!(await constraintExists(table, name)))
          await executeScript(`ALTER TABLE ${identifier(table)} ADD CONSTRAINT ${identifier(name)} FOREIGN KEY (tenant_id, ${identifier(column)}) REFERENCES ${identifier(target)} (tenant_id, id)`);
      }
    },
  },
  {
    // Phase 3: platform IDs and their transfer history (tables in schema.sql). Owner and worker point at a rider of
    // the same company, and a transfer at a platform ID of the same company. The transfer rows keep the rider
    // numbers without a key, so the history outlives nothing it should not: riders with history cannot be deleted
    // (routes/riders.ts blockers), and the number stays readable either way.
    id: 5, name: 'platform ids',
    up: async () => {
      for (const [table, column, target] of PLATFORM_ID_LINKS) {
        const name = `fk_${table}_${column}`.slice(0, 64);
        if (!(await constraintExists(table, name)))
          await executeScript(`ALTER TABLE ${identifier(table)} ADD CONSTRAINT ${identifier(name)} FOREIGN KEY (tenant_id, ${identifier(column)}) REFERENCES ${identifier(target)} (tenant_id, id)`);
      }
    },
  },
];
// Links to riders added after the baseline (migration 2 keeps its own fixed list, RIDER_LINKS).
export const PLATFORM_ID_LINKS: [string, string, string][] = [
  ['platform_ids', 'owner_rider_id', 'riders'], ['platform_ids', 'worker_rider_id', 'riders'], ['platform_id_transfers', 'platform_id', 'platform_ids'],
];
const BRANCH_LINKS: [string, string, string][] =[['riders', 'branch_id', 'branches'], ['riders', 'designation_id', 'designations'], ['vehicles', 'branch_id', 'branches']];

// Every column of the baseline schema that points at a rider.
export const RIDER_LINKS: [string, string][] = [
  ['advances', 'rider_id'], ['billing', 'rider_id'], ['branding_photos', 'rider_id'], ['daily_performance', 'rider_id'], ['fines', 'rider_id'],
  ['fuel_cards', 'rider_id'], ['leaves', 'rider_id'], ['monthly_ratings', 'rider_id'], ['rider_absences', 'rider_id'], ['rider_accounts', 'rider_id'],
  ['rider_change_requests', 'rider_id'], ['rider_documents', 'rider_id'], ['rider_issues', 'rider_id'], ['vehicle_assignments', 'rider_id'],
  ['vehicle_registrations', 'user_rider_id'], ['wallet_entries', 'rider_id'], ['wallet_snapshots', 'rider_id'],
];
// The old one-column keys from `column` to riders(id), whatever this install happened to name them.
async function singleColumnRiderKeys(table: string, column: string) {
  const rows = await q<{ c: string }>(`SELECT k.CONSTRAINT_NAME c FROM information_schema.KEY_COLUMN_USAGE k
    WHERE k.TABLE_SCHEMA = DATABASE() AND k.TABLE_NAME = ? AND k.REFERENCED_TABLE_NAME = 'riders'
    GROUP BY k.CONSTRAINT_NAME HAVING COUNT(*) = 1 AND MAX(k.COLUMN_NAME) = ?`, [table, column]);
  return rows.map((r) => r.c);
}

const LOCK = 'mandoob:migrations';
// Applies every step not yet recorded; returns the ids it applied. Runs in platform scope (schema is shared).
export async function runMigrations(steps: Migration[] = MIGRATIONS): Promise<number[]> {
  return asPlatform(async () => {
    await executeScript(`CREATE TABLE IF NOT EXISTS schema_migrations (
      id INT PRIMARY KEY, name VARCHAR(150) NOT NULL, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    return withNamedLock(LOCK, async () => {
      const done = new Set((await q<{ id: number }>('SELECT id FROM schema_migrations')).map((r) => r.id));
      const ids = steps.map((s) => s.id);
      if (new Set(ids).size !== ids.length || ids.some((id, i) => i > 0 && id <= ids[i - 1])) throw new Error('Migration ids must be unique and increasing');
      const applied: number[] = [];
      for (const step of steps) {
        if (done.has(step.id)) continue;
        await step.up();
        await q('INSERT INTO schema_migrations (id, name) VALUES (?, ?)', [step.id, step.name]);
        console.log(`migration ${step.id} applied: ${step.name}`);
        applied.push(step.id);
      }
      return applied;
    }, 60);
  });
}
