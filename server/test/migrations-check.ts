// The migration runner on the disposable test database: each step runs once, a half-applied step can run
// again, the helpers are idempotent, ids must increase, and every real step is recorded after startup.
import assert from "node:assert/strict";
import { asPlatform, closeDb, dbConfig, executeScript, q, withTenant } from "../src/db.js";
import { ensureCompanyDefaults } from "../src/domain/branches.js";
import { MIGRATIONS, PLATFORM_ID_LINKS, RIDER_LINKS, addColumn, addIndex, columnExists, indexExists, runMigrations, type Migration } from "../src/migrations.js";

assert.match(dbConfig()?.database ?? "", /^mandoob_test[a-z0-9_]*$/, "Disposable test databases only");
let checks = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++; };
try {
  await asPlatform(async () => {
    // the real steps were applied when the server started
    const recorded = (await q<{ id: number }>("SELECT id FROM schema_migrations ORDER BY id")).map((r) => r.id);
    ok(MIGRATIONS.every((m) => recorded.includes(m.id)), "every real migration is recorded");
    ok((await runMigrations()).length === 0, "a second start applies nothing");

    await executeScript("DROP TABLE IF EXISTS qa_mig; CREATE TABLE qa_mig (id INT PRIMARY KEY, tenant_id INT NOT NULL DEFAULT 0)");
    let runs = 0;
    const steps: Migration[] = [
      { id: 900001, name: "qa add column", up: async () => { runs++; await addColumn("qa_mig", "note", "VARCHAR(20) NULL"); } },
      { id: 900002, name: "qa add index", up: async () => { runs++; await addIndex("qa_mig", "ix_qa_note", ["tenant_id", "note"]); } },
    ];
    await q("DELETE FROM schema_migrations WHERE id >= 900000");
    ok((await runMigrations(steps)).join() === "900001,900002", "new steps run in order");
    ok(await columnExists("qa_mig", "note"), "column added");
    ok(await indexExists("qa_mig", "ix_qa_note"), "index added");
    ok((await runMigrations(steps)).length === 0 && runs === 2, "steps run only once");
    // a step whose change landed but was not recorded (crash in between) runs again without failing
    await q("DELETE FROM schema_migrations WHERE id = 900002");
    ok((await runMigrations(steps)).join() === "900002", "half-applied step runs again safely");
    await addColumn("qa_mig", "note", "VARCHAR(20) NULL");
    await addIndex("qa_mig", "ix_qa_note", ["tenant_id", "note"]);
    ok(true, "helpers are idempotent");
    await assert.rejects(runMigrations([steps[1], steps[0]]), /increasing/);
    checks++;
    await q("DELETE FROM schema_migrations WHERE id >= 900000");
    await executeScript("DROP TABLE qa_mig");

    // migration 2 stopped after dropping the rider links: running it again re-creates every one of them
    const riderFks = async () => Number((await q<{ n: number }>(`SELECT COUNT(DISTINCT CONSTRAINT_NAME) n FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = 'riders' AND COLUMN_NAME = 'tenant_id'`))[0].n);
    // links added by later steps (platform IDs, migration 5) are counted on top and left alone here
    const later = PLATFORM_ID_LINKS.filter(([, , target]) => target === "riders").length;
    ok((await riderFks()) === RIDER_LINKS.length + later, `all ${RIDER_LINKS.length + later} rider links are per company`);
    for (const [table, column] of RIDER_LINKS) await executeScript(`ALTER TABLE \`${table}\` DROP FOREIGN KEY \`fk_${table}_${column}\``);
    ok((await riderFks()) === later, "links dropped (simulated crash)");
    await q("DELETE FROM schema_migrations WHERE id = 2");
    ok((await runMigrations()).join() === "2", "migration 2 runs again");
    ok((await riderFks()) === RIDER_LINKS.length + later, "every rider link is back after the rerun");

    // migration 5 stopped half way: running it again adds back the platform ID links
    for (const [table, column] of PLATFORM_ID_LINKS) await executeScript(`ALTER TABLE \`${table}\` DROP FOREIGN KEY \`fk_${table}_${column}\``);
    await q("DELETE FROM schema_migrations WHERE id = 5");
    ok((await runMigrations()).join() === "5", "migration 5 runs again");
    ok((await riderFks()) === RIDER_LINKS.length + later, "the platform ID links are back after the rerun");

    // phase 2: a company from before branches existed (no branch, records without one) gets its main branch, the
    // built-in titles and a branch on every record; running it again changes nothing
    const [{ id: t }] = await q<{ id: number }>("SELECT COALESCE(MAX(id), 0) + 1 id FROM tenants");
    await q("INSERT INTO tenants (id, slug, name, plan_key, status) VALUES (?, ?, 'QA old company', 'free', 'active')", [t, `qa-old-${t}`]);
    await q("INSERT INTO riders (id, tenant_id, full_name) VALUES (9900001, ?, 'Old rider'), (9900002, ?, 'Old rider 2')", [t, t]);
    await q("INSERT INTO vehicles (tenant_id, plate, plate_key, vehicle_type) VALUES (?, 'QA 1', 'QA1', 'car')", [t]);
    await ensureCompanyDefaults(t);
    await ensureCompanyDefaults(t);
    const counts = async () => (await q<any>(`SELECT (SELECT COUNT(*) FROM branches WHERE tenant_id = ?) b, (SELECT COUNT(*) FROM branches WHERE tenant_id = ? AND is_default = 1) d,
      (SELECT COUNT(*) FROM designations WHERE tenant_id = ?) t, (SELECT COUNT(*) FROM riders WHERE tenant_id = ? AND (branch_id IS NULL OR designation_id IS NULL)) r,
      (SELECT COUNT(*) FROM vehicles WHERE tenant_id = ? AND branch_id IS NULL) v`, [t, t, t, t, t]))[0];
    const c = await counts();
    ok(Number(c.b) === 1 && Number(c.d) === 1 && Number(c.t) === 2, "an old company gets one main branch and the two built-in titles, once");
    ok(Number(c.r) === 0 && Number(c.v) === 0, "every old rider and vehicle gets a branch (and riders a title)");
    // the keys include the company: a rider cannot point at another company's branch even by a raw query
    const [{ other }] = await q<{ other: number }>("SELECT id other FROM branches WHERE tenant_id <> ? LIMIT 1", [t]);
    await assert.rejects(q("UPDATE riders SET branch_id = ? WHERE tenant_id = ? AND id = 9900001", [other, t]), /foreign key/i);
    checks++;
    await withTenant(t, async () => { await q("DELETE FROM riders"); await q("DELETE FROM vehicles"); await q("DELETE FROM designations"); await q("DELETE FROM branches"); });
    await q("DELETE FROM tenants WHERE id = ?", [t]);
  });
  console.log("MIGRATION CHECKS PASSED:", checks);
} finally {
  await closeDb();
}
