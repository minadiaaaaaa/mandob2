import { reportFile } from "./support/reports.mjs";
// Read-only business checks. Login records a normal session/attempt; no fixture creation.
import assert from "node:assert/strict";
import fs from "node:fs";
const origin = "http://127.0.0.1:4000";
const saved = fs.readFileSync("data/first-login.txt", "utf8");
const password = saved.match(/password\s*[:=]\s*([^\r\n]+)/i)?.[1]?.trim();
assert.ok(password, "Local owner credentials unavailable");
let cookie = "";
async function call(method, path, body) {
  const r = await fetch(origin + "/api" + path, {
    method,
    headers: {
      cookie,
      connection: "close",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = r.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  return { status: r.status, data: await r.json() };
}
const ch = (await call("GET", "/auth/challenge")).data;
assert.equal(
  (
    await call("POST", "/auth/login", {
      username: "miza",
      password,
      challengeId: ch.id,
      code: ch.code,
    })
  ).status,
  200,
);
const paths = [
  "/me",
  "/dashboard",
  "/riders",
  "/vehicles",
  "/applicants",
  "/advances",
  "/leaves",
  "/notifications",
  "/backups",
  "/reports/riders",
  "/reports/documents",
  "/email/branding",
  "/roles",
  "/users",
];
const results = [];
for (const path of paths) {
  const r = await call("GET", path);
  results.push({ path, status: r.status });
  assert.equal(r.status, 200, path);
}
await call("POST", "/auth/logout", {});
fs.writeFileSync(
  reportFile("production-read-verification.json"),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      origin,
      owner: "miza",
      total: results.length,
      results,
    },
    null,
    2,
  ),
);
console.log("PRODUCTION OWNER READ CHECKS PASSED:", results.length);
