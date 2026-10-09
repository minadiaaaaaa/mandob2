import { reportFile } from "./support/reports.mjs";
// Run after smoke.mjs and security-roles.mjs against disposable fixtures only.
import assert from "node:assert/strict";
import fs from "node:fs";
import { routes } from "./route-inventory.mjs";
const origin = process.argv[2] || "http://127.0.0.1:4200";
assert.ok(
  /^http:\/\/(localhost|127\.0\.0\.1):(4100|4200)$/.test(origin),
  "Disposable test ports only",
);
const results = [];
function client() {
  let cookie = "";
  return async (method, path, body) => {
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
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {}
    return { status: r.status, data, bytes: text.length };
  };
}
async function login(c, username, password) {
  const ch = (await c("GET", "/auth/challenge")).data;
  assert.equal(
    (
      await c("POST", "/auth/login", {
        username,
        password,
        challengeId: ch.id,
        code: ch.code,
      })
    ).status,
    200,
    username,
  );
}
function address(p) {
  return p.replace(
    /:([\w]+)/g,
    (_, k) =>
      ({
        id: "999999",
        rider: "4000001",
        riderId: "4000001",
        name: "riders",
        account: "system",
        type: "id",
        key: "system.smtp_test",
        lang: "en",
        code: "en",
        token: "aaaaaaaaaaaaaaaaaaaaaaaa",
      })[k] || "999999",
  );
}
async function runQueue(jobs, workers = 4) {
  let index = 0;
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (index < jobs.length) {
        const job = jobs[index++];
        await job();
      }
    }),
  );
}
const users = [
  ["guest", null],
  ["Super Admin", "security.role.0"],
  ["Fleet Manager", "security.role.1"],
  ["Documents Officer", "security.role.2"],
  ["Data Entry", "security.role.3"],
  ["Viewer", "security.role.4"],
  ["Empty role", "night.user"],
];
for (const [role, username] of users) {
  const c = client();
  if (username)
    await login(
      c,
      username,
      username === "night.user" ? "NightUser123" : "RoleTest2026!",
    );
  const perms = new Set(username ? (await c("GET", "/me")).data.perms : []);
  const denied = routes.filter((r) => !r.perms.some((p) => perms.has(p)));
  await runQueue(
    denied.map((route) => async () => {
      const response = await c(
        route.method,
        address(route.path),
        route.method === "GET" ? undefined : {},
      );
      results.push({
        role,
        method: route.method,
        path: route.path,
        expected: username ? 403 : 401,
        status: response.status,
        error: response.data?.error,
      });
    }),
  );
  // These shared endpoints still require a staff session.
  for (const path of [
    "/me",
    "/profile",
    "/profile/sessions",
    "/profile/attempts",
    "/lookups/cities",
    "/notifications/mine",
    "/meta/badges",
  ]) {
    const r = await c("GET", path);
    results.push({
      role,
      method: "GET",
      path,
      expected: username ? 200 : 401,
      status: r.status,
      error: r.data?.error,
    });
  }
  console.log("Permission matrix checked:", role, denied.length);
}
const failures = results.filter((r) => r.status !== r.expected);
fs.writeFileSync(
  reportFile("full-permissions.json", process.env.QA_REPORT),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      origin,
      guardedRoutes: routes.length,
      total: results.length,
      failures,
      results,
    },
    null,
    2,
  ),
);
assert.equal(failures.length, 0, JSON.stringify(failures));
console.log("FULL PERMISSION MATRIX PASSED:", results.length);
