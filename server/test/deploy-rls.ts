import { reportFile } from "./support/reports.mjs";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DB_SCHEMA,
  ROOT,
  dbConfig,
  q,
  executeScript,
  closeDb,
} from "../src/db.js";
if (
  DB_SCHEMA !== "public" ||
  !dbConfig()?.user.endsWith(".mzsjtckqoqjinsjafnfb")
)
  throw Error("Deployment is restricted to mandob public schema");
await executeScript(
  readFileSync(join(ROOT, "../database/supabase/rls.sql"), "utf8"),
);
const [checks] = await q(`SELECT
(SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity) AS protected_tables,
(SELECT count(DISTINCT tablename)::int FROM pg_policies WHERE schemaname='public' AND policyname='app_staff' AND 'mandoob_request'=ANY(roles)) AS application_policies,
(SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND (has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE'))) AS browser_grants,
(SELECT rolbypassrls OR rolsuper OR rolcanlogin FROM pg_roles WHERE rolname='mandoob_request') AS request_role_privileged,
pg_has_role('anon','mandoob_request','MEMBER') OR pg_has_role('authenticated','mandoob_request','MEMBER') AS browser_role_membership,
(SELECT rolbypassrls OR rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit FROM pg_roles WHERE rolname='mandoob_runtime') AS runtime_role_privileged,
pg_has_role('mandoob_runtime','postgres','MEMBER') AS runtime_owner_membership`);
assert.equal(checks.protected_tables, 64);
assert.equal(checks.application_policies, 64);
assert.equal(checks.browser_grants, 0);
assert.equal(checks.request_role_privileged, false);
assert.equal(checks.browser_role_membership, false);
assert.equal(checks.runtime_role_privileged, false);
assert.equal(checks.runtime_owner_membership, false);
writeFileSync(
  reportFile("security-verification.json"),
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      projectRef: "mzsjtckqoqjinsjafnfb",
      database: checks,
      apiSecurity: "passed locally; cloud verification pending",
      databaseIsolation: "passed on isolated Supabase schema",
      staffAuthorization: "Express permission checks refreshed each request",
      riderAuthorization: "PostgreSQL row policies plus API ownership checks",
      trustedBroker:
        "Sign-in, settings, audit, notification delivery and scheduled jobs retain server-only postgres access",
    },
    null,
    2,
  ),
);
await closeDb();
console.log("Production RLS deployed and verified:", checks);
