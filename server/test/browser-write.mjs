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
try {
  const challenge = await (
    await context.request.get(origin + "/api/auth/challenge")
  ).json();
  assert.equal(
    (
      await context.request.post(origin + "/api/auth/login", {
        data: {
          username: "admin",
          password: "Admin12345!",
          challengeId: challenge.id,
          code: challenge.code,
        },
      })
    ).status(),
    200,
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const ar = JSON.parse(fs.readFileSync("../shared/i18n/ar.json", "utf8"));
  const en = JSON.parse(fs.readFileSync("../shared/i18n/en.json", "utf8"));
  const label = (key) =>
    new RegExp(
      [ar[key], en[key]]
        .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("|"),
    );
  await page.goto(origin + "/admin/riders/new");
  await page.waitForLoadState("networkidle");
  await page.getByLabel(label("riders.rider_id")).fill("8950100");
  const text = '<img src=x onerror="window.qaXss=1"> QA';
  await page.getByLabel(label("riders.full_name")).fill(text);
  const saved = page.waitForResponse(
    (r) =>
      r.url() === origin + "/api/riders" && r.request().method() === "POST",
  );
  await page.locator('button[type="submit"]').click();
  assert.equal((await saved).status(), 200);
  results.push({ check: "Create rider through real UI", passed: true });
  await page.goto(origin + "/admin/riders/8950100");
  await page.waitForLoadState("networkidle");
  assert.ok((await page.locator("body").innerText()).includes(text));
  assert.equal(await page.evaluate(() => window.qaXss), undefined);
  results.push({
    check: "Stored HTML displays as text; no script runs",
    passed: true,
  });
  await page.goto(origin + "/admin/riders/8950100/edit");
  await page.waitForLoadState("networkidle");
  await page.getByLabel(label("riders.full_name")).fill("QA UI Updated");
  const updated = page.waitForResponse(
    (r) =>
      r.url() === origin + "/api/riders/8950100" &&
      r.request().method() === "PATCH",
  );
  await page.locator('button[type="submit"]').click();
  assert.equal((await updated).status(), 200);
  await page.waitForLoadState("networkidle");
  const rider = await (
    await context.request.get(origin + "/api/riders/8950100")
  ).json();
  assert.equal(rider.full_name, "QA UI Updated");
  results.push({
    check: "Edit persisted and read back from Supabase",
    passed: true,
  });
  assert.deepEqual(errors, []);
} finally {
  await context.request.delete(origin + "/api/riders/8950100");
  await browser.close();
  fs.writeFileSync(
    reportFile("browser-write-verification.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        origin,
        total: results.length,
        results,
      },
      null,
      2,
    ),
  );
}
console.log("BROWSER WRITE CHECKS PASSED:", results.length);
