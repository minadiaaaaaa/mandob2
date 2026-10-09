import { reportFile } from "../../server/test/support/reports.mjs";
// Local PostgreSQL validation. Pass the installed @electric-sql/pglite module path.
// node database/supabase/validate.mjs <absolute-path-to-pglite/dist/index.js>
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(resolve(here, name), "utf8");
if (!process.argv[2])
  throw new Error("Pass the PGlite module path; no remote database is used.");
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const db = new PGlite();
const manifest = JSON.parse(read("manifest.json"));
const count = async (table) =>
  Number(
    (await db.query(`SELECT count(*) AS n FROM public."${table}"`)).rows[0].n,
  );
const reject = async (sql, code, params = []) => {
  try {
    await db.query(sql, params);
    assert.fail("Expected SQL rejection");
  } catch (error) {
    assert.equal(error.code, code);
  }
};
try {
  // Model Supabase roles, including legacy automatic grants on new objects.
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
    GRANT USAGE ON SCHEMA public TO anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;`);
  await db.exec(read("schema.sql"));
  await db.exec(read("seed.sql"));
  await db.exec(read("seed.sql"));
  const verification = await db.exec(read("verify.sql"));
  assert.equal(verification[0].rows.length, 64);
  assert.equal(verification.at(-1).rows.length, 0);
  assert.equal(await count("settings"), manifest.defaults.settings);
  assert.equal(await count("roles"), manifest.defaults.roles);
  assert.equal(
    await count("role_permissions"),
    manifest.defaults.rolePermissions,
  );
  assert.equal(await count("cities"), manifest.defaults.cities);
  assert.equal(
    await count("email_templates"),
    manifest.defaults.emailTemplates,
  );
  assert.equal(await count("users"), 0);
  assert.equal(
    (
      await db.query(
        `SELECT value FROM settings WHERE key = 'system.installed'`,
      )
    ).rows[0].value,
    "0",
  );
  const actual = (
    await db.query(`SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`)
  ).rows;
  for (const table of manifest.tables) {
    assert.deepEqual(
      actual
        .filter((r) => r.table_name === table.table)
        .map((r) => r.column_name),
      table.columns,
    );
  }
  const tables = (
    await db.query(`SELECT relname, relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r'`)
  ).rows;
  assert.equal(tables.length, 64);
  assert(tables.every((t) => t.relrowsecurity));
  assert.equal(
    Number(
      (
        await db.query(`SELECT count(*) AS n FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
    WHERE n.nspname='public' AND c.contype='f'`)
      ).rows[0].n,
    ),
    manifest.tables.reduce((n, t) => n + t.foreignKeys, 0),
  );
  for (const role of ["anon", "authenticated"]) {
    for (const table of tables) {
      for (const privilege of [
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE",
        "TRUNCATE",
        "REFERENCES",
        "TRIGGER",
      ]) {
        const result = await db.query(
          "SELECT has_table_privilege($1, $2, $3) AS allowed",
          [role, `public.${table.relname}`, privilege],
        );
        assert.equal(
          result.rows[0].allowed,
          false,
          `${role}: ${table.relname} ${privilege}`,
        );
      }
    }
    const sequences = (
      await db.query(
        `SELECT sequencename FROM pg_sequences WHERE schemaname='public'`,
      )
    ).rows;
    for (const sequence of sequences) {
      for (const privilege of ["USAGE", "SELECT", "UPDATE"]) {
        const result = await db.query(
          "SELECT has_sequence_privilege($1, $2, $3) AS allowed",
          [role, `public.${sequence.sequencename}`, privilege],
        );
        assert.equal(result.rows[0].allowed, false);
      }
    }
    await db.exec(`SET ROLE ${role}`);
    await reject("SELECT * FROM public.users", "42501");
    await db.exec("RESET ROLE");
  }
  await reject(
    `INSERT INTO riders (id,full_name,status) VALUES (1,'Invalid','unknown')`,
    "23514",
  );
  await reject(
    `INSERT INTO riders (id,full_name,portal_enabled) VALUES (1,'Invalid',2)`,
    "23514",
  );
  await reject(
    `INSERT INTO riders (id,full_name,company_id) VALUES (1,'Invalid',999999)`,
    "23503",
  );
  await db.query(
    `INSERT INTO riders (id,full_name,created_at) VALUES (1,'مندوب اختبار','2026-10-09T10:00:00Z')`,
  );
  await db.query(
    `INSERT INTO fines (rider_id,fine_date,category,amount) VALUES (1,'2026-10-09',$1,123.45)`,
    ["x".repeat(150) + "a"],
  );
  await reject(
    `INSERT INTO fines (rider_id,fine_date,category,amount) VALUES (1,'2026-10-09',$1,123.45)`,
    "23505",
    ["x".repeat(150) + "b"],
  );
  await db.query(
    `INSERT INTO wallet_entries (rider_id,entry_date,description,amount) VALUES (1,'2026-10-09',$1,12.34)`,
    ["x".repeat(200) + "a"],
  );
  await reject(
    `INSERT INTO wallet_entries (rider_id,entry_date,description,amount) VALUES (1,'2026-10-09',$1,12.34)`,
    "23505",
    ["x".repeat(200) + "b"],
  );
  assert.equal(
    Number((await db.query("SELECT amount FROM fines")).rows[0].amount),
    123.45,
  );
  await db.query(
    `INSERT INTO rider_change_requests (rider_id,type,payload) VALUES (1,'contact',$1::jsonb)`,
    ['{"phone":"123"}'],
  );
  assert.equal(
    (
      await db.query(
        `SELECT payload->>'phone' AS phone FROM rider_change_requests`,
      )
    ).rows[0].phone,
    "123",
  );
  // RLS still denies rows if a future deployment accidentally adds SELECT grants.
  await db.exec(
    "BEGIN; GRANT SELECT ON public.riders TO authenticated; SET LOCAL ROLE authenticated;",
  );
  assert.equal((await db.query("SELECT * FROM public.riders")).rows.length, 0);
  await db.exec("ROLLBACK;");
  // Check PostgreSQL cascades preserved from MySQL.
  await db.exec(`INSERT INTO roles (name) VALUES ('validation-only');
    INSERT INTO role_permissions (role_id,perm) SELECT id,'validation.only' FROM roles WHERE name='validation-only';
    DELETE FROM roles WHERE name='validation-only';`);
  assert.equal(
    Number(
      (
        await db.query(
          `SELECT count(*) AS n FROM role_permissions WHERE perm='validation.only'`,
        )
      ).rows[0].n,
    ),
    0,
  );
  const result = {
    checkedAt: new Date().toISOString(),
    engine: "PGlite (local PostgreSQL, in memory)",
    tables: tables.length,
    columns: actual.length,
    foreignKeys: manifest.tables.reduce((n, t) => n + t.foreignKeys, 0),
    defaults: manifest.defaults,
    checks: [
      "schema executes",
      "all columns preserved",
      "all foreign keys preserved",
      "seed is repeatable",
      "64 tables have RLS",
      "browser roles have no table or sequence privileges",
      "RLS blocks rows after accidental SELECT grant",
      "enum and 0/1 constraints",
      "foreign key rejection",
      "cascade deletion",
      "prefix unique indexes",
      "exact decimal amounts",
      "JSONB",
    ],
    remoteSupabaseApplied: false,
  };
  writeFileSync(
    reportFile("validation.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await db.close();
}
