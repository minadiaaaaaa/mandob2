import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DB_SCHEMA, ROOT, q, exec, executeScript, closeDb } from "../src/db.js";
import { identifier } from "../src/sql.js";
import { hashPassword } from "../src/auth.js";
if (!/^mandoob_test_[a-z0-9_]+$/.test(DB_SCHEMA))
  throw new Error("Only an isolated mandoob_test_* schema can be reset");
if (process.argv.includes("--cleanup")) {
  await executeScript(`DROP SCHEMA IF EXISTS ${identifier(DB_SCHEMA)} CASCADE`);
  await closeDb();
  console.log("Removed isolated test schema:", DB_SCHEMA);
  process.exit(0);
}
const [existing] = await q(
  "SELECT 1 FROM information_schema.schemata WHERE schema_name = ?",
  [DB_SCHEMA],
);
if (!existing) {
  await executeScript(`CREATE SCHEMA ${identifier(DB_SCHEMA)}`);
  await executeScript(
    readFileSync(join(ROOT, "../database/supabase/schema.sql"), "utf8").replace(
      /public\./g,
      `${identifier(DB_SCHEMA)}.`,
    ),
  );
} else {
  const tables = await q<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = ?",
    [DB_SCHEMA],
  );
  await executeScript(
    `TRUNCATE ${tables.map((t) => `${identifier(DB_SCHEMA)}.${identifier(t.table_name)}`).join(",")} RESTART IDENTITY CASCADE`,
  );
}
await executeScript(
  readFileSync(join(ROOT, "../database/supabase/seed.sql"), "utf8").replace(
    /public\./g,
    `${identifier(DB_SCHEMA)}.`,
  ),
);
await exec(
  `INSERT INTO users(username,full_name,email,password_hash,role_id) SELECT 'admin','Test Admin','admin@example.com',?,id FROM roles WHERE name='Super Admin'`,
  [await hashPassword("Admin12345!")],
);
await exec(`UPDATE settings SET value='1' WHERE "key"='system.installed'`);
await executeScript(
  readFileSync(join(ROOT, "../database/supabase/rls.sql"), "utf8")
    .replace(/public\./g, `${identifier(DB_SCHEMA)}.`)
    .replaceAll("SCHEMA public", `SCHEMA ${identifier(DB_SCHEMA)}`),
);
console.log("Isolated PostgreSQL smoke database prepared:", DB_SCHEMA);
await closeDb();
