// MySQL replacement for the fixture part of the former PostgreSQL full-db-read.ts (its RLS checks are covered by
// tenant-isolation.mjs now). Runs after smoke.mjs on the disposable test database, inside the platform's company 0.
import assert from "node:assert/strict";
import { closeDb, dbConfig, enterTenantForScript, exec } from "../src/db.js";

assert.match(dbConfig()?.database ?? "", /^mandoob_test[a-z0-9_]*$/, "Disposable test databases only");
enterTenantForScript(0);
try {
  // The smoke suite deliberately exhausts rider sign-in limits; age those attempts before the next scripts sign riders in.
  await exec("UPDATE rider_login_attempts SET created_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 20 MINUTE)");
  // A rating month with its segment floors, read back by edge-cases.mjs (floor and the next segment's floor).
  await exec("INSERT INTO rating_cutoffs (month, segment, min_final) VALUES ('2037-01', 'A', 0.95), ('2037-01', 'B', 0.85)");
  await exec("INSERT INTO monthly_ratings (rider_id, month, segment, final_score) VALUES (4000001, '2037-01', 'B', 0.90)");
  console.log("MYSQL FIXTURES READY");
} finally {
  await closeDb();
}
