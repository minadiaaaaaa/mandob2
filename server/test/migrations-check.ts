// The migration runner on the disposable test database: each step runs once, a half-applied step can run
// again, the helpers are idempotent, ids must increase, and every real step is recorded after startup.
import assert from "node:assert/strict";
import { asPlatform, closeDb, dbConfig, executeScript, q } from "../src/db.js";
import { MIGRATIONS, RIDER_LINKS, addColumn, addIndex, columnExists, indexExists, runMigrations, type Migration } from "../src/migrations.js";

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
    ok((await riderFks()) === RIDER_LINKS.length, `all ${RIDER_LINKS.length} rider links are per company`);
    for (const [table, column] of RIDER_LINKS) await executeScript(`ALTER TABLE \`${table}\` DROP FOREIGN KEY \`fk_${table}_${column}\``);
    ok((await riderFks()) === 0, "links dropped (simulated crash)");
    await q("DELETE FROM schema_migrations WHERE id = 2");
    ok((await runMigrations()).join() === "2", "migration 2 runs again");
    ok((await riderFks()) === RIDER_LINKS.length, "every rider link is back after the rerun");
  });
  console.log("MIGRATION CHECKS PASSED:", checks);
} finally {
  await closeDb();
}
