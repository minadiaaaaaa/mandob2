// Clears the rider portal's failed sign-ins from this machine on the disposable test database, so a test that
// deliberately reaches the guessing limit (tenant-isolation.mjs) does not block the portal for the scripts after it.
import assert from "node:assert/strict";
import { asPlatform, closeDb, dbConfig, exec } from "../../src/db.js";

assert.match(dbConfig()?.database ?? "", /^mandoob_test[a-z0-9_]*$/, "Disposable test databases only");
try {
  const r = await asPlatform(() => exec("DELETE FROM rider_login_attempts WHERE ip IN ('127.0.0.1', '::1', '::ffff:127.0.0.1') AND success = 0"));
  console.log("portal failures cleared:", r.affectedRows);
} finally {
  await closeDb();
}
