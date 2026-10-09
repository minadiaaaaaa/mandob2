import { reportFile } from "./support/reports.mjs";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { q, exec, withActor, DB_SCHEMA, closeDb } from "../src/db.js";
import { identifier } from "../src/sql.js";
if (!/^mandoob_test_[a-z0-9_]+$/.test(DB_SCHEMA))
  throw Error("Disposable schema only");
const tables = await q<{ table_name: string }>(
  "SELECT table_name FROM information_schema.tables WHERE table_schema=? AND table_type=? ORDER BY table_name",
  [DB_SCHEMA, "BASE TABLE"],
);
const policies = await q<{ tablename: string; qual: string }>(
  "SELECT tablename,qual FROM pg_policies WHERE schemaname=? AND policyname='app_rider_read'",
  [DB_SCHEMA],
);
const results = [];
try {
  for (const id of [4000001, 8800002])
    for (const { table_name: table } of tables) {
      const rows = await withActor({ kind: "rider", id }, () =>
        q<Record<string, any>>(`SELECT * FROM ${identifier(table)}`),
      );
      const policy = policies.find((p) => p.tablename === table);
      assert.ok(policy, "Missing rider policy: " + table);
      if (policy.qual.includes("false"))
        assert.equal(rows.length, 0, table + " staff-only data");
      if (rows.length && "rider_id" in rows[0])
        assert.ok(
          rows.every((r) => Number(r.rider_id) === id),
          table + " rider ownership",
        );
      if (table === "riders")
        assert.deepEqual(
          rows.map((r) => Number(r.id)),
          [id],
        );
      if (table === "rider_issue_messages")
        assert.ok(
          rows.every((r) => Number(r.internal) === 0),
          "Internal messages hidden",
        );
      if (table === "attachments")
        assert.ok(
          rows.every((r) => r.entity_type !== "organization"),
          "Organization settings/files private",
        );
      results.push({
        rider: id,
        table,
        visibleRows: rows.length,
        passed: true,
      });
    }
  // The smoke suite deliberately exhausts rate limiting. Age only isolated fixture attempts before browser logins.
  await exec(
    "UPDATE rider_login_attempts SET created_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 20 MINUTE)",
  );
  await exec(
    "INSERT INTO rating_cutoffs(month,segment,min_final) VALUES ('2037-01','A',0.95),('2037-01','B',0.85)",
  );
  await exec(
    "INSERT INTO monthly_ratings(rider_id,month,segment,final_score) VALUES (4000001,'2037-01','B',0.90)",
  );
  writeFileSync(
    reportFile("all-table-rls-verification.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        schema: DB_SCHEMA,
        tables: tables.length,
        total: results.length,
        results,
      },
      null,
      2,
    ),
  );
  console.log("ALL TABLE RLS READ CHECKS PASSED:", results.length);
} finally {
  await closeDb();
}
