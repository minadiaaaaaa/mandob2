import { reportFile } from "./support/reports.mjs";
// Positive GET coverage for all built-in roles; no production writes.
import assert from "node:assert/strict";
import fs from "node:fs";
import { routes } from "./route-inventory.mjs";
const origin = process.argv[2] || "http://127.0.0.1:4200";
assert.ok(/^http:\/\/(localhost|127\.0\.0\.1):(4100|4200)$/.test(origin));
const results = [];
for (const [index, role] of [
  "Super Admin",
  "Fleet Manager",
  "Documents Officer",
  "Data Entry",
  "Viewer",
].entries()) {
  let cookie = "";
  const call = async (path) => {
    const r = await fetch(origin + "/api" + path, {
      headers: { cookie, connection: "close" },
    });
    const text = await r.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {}
    return { status: r.status, error: body?.error, body };
  };
  const ch = (await call("/auth/challenge")).body;
  const r = await fetch(origin + "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", connection: "close" },
    body: JSON.stringify({
      username: "security.role." + index,
      password: "RoleTest2026!",
      challengeId: ch.id,
      code: ch.code,
    }),
  });
  assert.equal(r.status, 200);
  cookie = r.headers.get("set-cookie").split(";")[0];
  const perms = new Set((await call("/me")).body.perms);
  const jobs = routes.filter(
    (r) => r.method === "GET" && r.perms.some((p) => perms.has(p)),
  );
  let next = 0;
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (next < jobs.length) {
        const route = jobs[next++];
        const path = route.path.replace(
          /:([\w]+)/g,
          (_, k) =>
            ({
              id: "999999",
              name: "riders",
              account: "system",
              type: "id",
              key: "system.smtp_test",
              lang: "en",
              code: "en",
            })[k] || "999999",
        );
        const r = await call(path);
        results.push({ role, path, status: r.status, error: r.error });
      }
    }),
  );
  console.log("Read endpoints checked:", role, jobs.length);
}
const failures = results.filter(
  (r) => r.status >= 500 || r.status === 401 || r.status === 403,
);
fs.writeFileSync(
  reportFile("read-verification.json", process.env.QA_READ_REPORT),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      origin,
      total: results.length,
      failures,
      results,
    },
    null,
    2,
  ),
);
assert.equal(failures.length, 0, JSON.stringify(failures));
console.log("READ ENDPOINTS PASSED:", results.length);
