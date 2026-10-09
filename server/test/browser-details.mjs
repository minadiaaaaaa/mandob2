import { reportFile } from "./support/reports.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
const { chromium } = await import(
  pathToFileURL(process.env.QA_PLAYWRIGHT_MODULE).href
);
const origin = process.argv[2] || "http://127.0.0.1:4100";
assert.ok(/^http:\/\/(localhost|127\.0\.0\.1):(4100|4200)$/.test(origin));
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.QA_BROWSER_PATH,
});
const context = await browser.newContext();
const results = [];
const failures = [];
const skipped = [];
try {
  const ch = await (
    await context.request.get(origin + "/api/auth/challenge")
  ).json();
  assert.equal(
    (
      await context.request.post(origin + "/api/auth/login", {
        data: {
          username: "admin",
          password: "Admin12345!",
          challengeId: ch.id,
          code: ch.code,
        },
      })
    ).status(),
    200,
  );
  const app = fs
    .readFileSync("../web/src/App.tsx", "utf8")
    .split('<Route path="/admin"')[1];
  const dynamic = [...app.matchAll(/path="([^"*]+):id([^"]*)"/g)].map((m) => ({
    prefix: m[1],
    suffix: m[2],
  }));
  const cache = new Map();
  const paths = [];
  for (const { prefix, suffix } of dynamic) {
    const list = prefix.replace(/\/$/, "");
    if (["performance/riders", "live/riders"].includes(list)) {
      paths.push("/admin/" + prefix + "4000001" + suffix);
      continue;
    }
    if (!cache.has(list)) {
      const endpoint =
        { "rider-applicants": "applicants", "rider-issues": "issues" }[list] ||
        list;
      const r = await context.request.get(origin + "/api/" + endpoint);
      const data = await r.json();
      const rows = Array.isArray(data) ? data : data.rows;
      cache.set(
        list,
        r.status() === 200
          ? rows?.find((row) => row.id !== undefined)?.id
          : undefined,
      );
    }
    const id = cache.get(list);
    if (id !== undefined) paths.push("/admin/" + prefix + id + suffix);
    else
      skipped.push({
        list,
        reason: "No matching populated fixture/list endpoint",
      });
  }
  for (const name of ["vehicles", "riders", "documents", "advances"])
    paths.push("/admin/reports/" + name);
  for (const tab of ["organization", "platform", "system", "secrets"])
    paths.push("/admin/settings/" + tab);
  const page = await context.newPage();
  let errors = [];
  let apiErrors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (r.url().includes("/api/") && r.status() >= 500)
      apiErrors.push({ path: r.url().replace(origin, ""), status: r.status() });
  });
  for (const path of paths) {
    errors = [];
    apiErrors = [];
    await page.goto(origin + path);
    await page.waitForLoadState("networkidle");
    const text = await page.locator("body").innerText();
    const result = {
      path,
      bodyLength: text.length,
      errors: [...errors],
      apiErrors: [...apiErrors],
    };
    results.push(result);
    if (errors.length || apiErrors.length || text.length < 20)
      failures.push(result);
    if (results.length % 10 === 0)
      console.log("Detail pages checked:", results.length);
  }
} finally {
  await browser.close();
  fs.writeFileSync(
    reportFile("browser-detail-verification.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        origin,
        total: results.length,
        failures,
        skipped,
        results,
      },
      null,
      2,
    ),
  );
}
assert.equal(failures.length, 0, JSON.stringify(failures));
console.log("DETAIL BROWSER QA PASSED:", results.length);
