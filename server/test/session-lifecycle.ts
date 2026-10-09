import { reportFile } from "./support/reports.mjs";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { exec, q, DB_SCHEMA, closeDb } from "../src/db.js";
import { hashPassword, sha256 } from "../src/auth.js";
assert.match(DB_SCHEMA, /^mandoob_test_[a-z0-9_]+$/);
const origin = "http://127.0.0.1:4100";
const results: any[] = [];
function client() {
  let cookie = "";
  return {
    get cookie() {
      return cookie;
    },
    async call(method: string, path: string, body?: any, expected = 200) {
      const r = await fetch(origin + "/api" + path, {
        method,
        headers: {
          cookie,
          connection: "close",
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const sc = r.headers.get("set-cookie");
      if (sc) cookie = sc.split(";")[0];
      const data: any = await r.json();
      results.push({
        method,
        path,
        expected,
        status: r.status,
        error: data.error,
      });
      assert.equal(r.status, expected, JSON.stringify(results.at(-1)));
      return data;
    },
  };
}
const role = (
  await exec("INSERT INTO roles(name,is_active) VALUES ('QA Session Role',1)")
).insertId;
const user = (
  await exec(
    "INSERT INTO users(username,full_name,email,password_hash,role_id) VALUES ('qa.session','QA Session','qa.session@example.com',?,?)",
    [await hashPassword("SessionTest2026!"), role],
  )
).insertId;
await exec(
  "INSERT INTO riders(id,full_name,status,portal_enabled,portal_password_hash) VALUES (8960001,'QA Session Rider','active',1,?)",
  [await hashPassword("RiderSession2026")],
);
async function login(
  c: ReturnType<typeof client>,
  password = "SessionTest2026!",
) {
  const ch = await c.call("GET", "/auth/challenge");
  await c.call("POST", "/auth/login", {
    username: "qa.session",
    password,
    challengeId: ch.id,
    code: ch.code,
  });
}
try {
  const first = client();
  const second = client();
  await login(first);
  await login(second);
  await first.call(
    "POST",
    "/profile/password",
    {
      current: "wrong",
      password: "ChangedPass2026!",
      confirm: "ChangedPass2026!",
    },
    422,
  );
  await first.call("POST", "/profile/password", {
    current: "SessionTest2026!",
    password: "ChangedPass2026!",
    confirm: "ChangedPass2026!",
  });
  await first.call("GET", "/me");
  await second.call("GET", "/me", undefined, 401);
  await exec("UPDATE roles SET is_active=0 WHERE id=?", [role]);
  await first.call("GET", "/me", undefined, 401);
  await exec("UPDATE roles SET is_active=1 WHERE id=?", [role]);
  await first.call("GET", "/me");
  await exec(
    "UPDATE sessions SET expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 HOUR) WHERE token_hash=?",
    [sha256(first.cookie.split("=")[1])],
  );
  await first.call("GET", "/me", undefined, 401);
  const rider = client();
  await rider.call("POST", "/portal/login", {
    rider_id: "8960001",
    password: "RiderSession2026",
  });
  await rider.call("GET", "/portal/me");
  await exec(
    "INSERT INTO rider_codes(rider_id,purpose,email,code_hash,expires_at) VALUES (8960001,'verify_email','qa.rider@example.com',?,DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE))",
    [sha256("8960001:123456")],
  );
  await rider.call(
    "POST",
    "/portal/security/email/verify",
    { code: "123456" },
    422,
  );
  await exec(
    "UPDATE rider_codes SET expires_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 10 MINUTE),attempts=5 WHERE rider_id=8960001",
  );
  const locked = await rider.call(
    "POST",
    "/portal/security/email/verify",
    { code: "123456" },
    422,
  );
  assert.equal(locked.fields.code, "code_locked");
  await exec(
    "UPDATE rider_sessions SET expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 HOUR) WHERE rider_id=8960001",
  );
  await rider.call("GET", "/portal/me", undefined, 401);
  writeFileSync(
    reportFile("session-verification.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        schema: DB_SCHEMA,
        total: results.length,
        results,
      },
      null,
      2,
    ),
  );
  console.log("SESSION LIFECYCLE CHECKS PASSED:", results.length);
} finally {
  await exec("DELETE FROM users WHERE id=?", [user]);
  await exec("DELETE FROM roles WHERE id=?", [role]);
  for (const table of [
    "rider_accounts",
    "rider_sessions",
    "rider_codes",
    "rider_login_attempts",
  ])
    await exec(`DELETE FROM ${table} WHERE rider_id=?`, [8960001]);
  await exec("DELETE FROM riders WHERE id=8960001");
  await closeDb();
}
