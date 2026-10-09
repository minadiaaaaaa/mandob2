import { reportFile } from "./support/reports.mjs";
// Fresh headless browser; never operates the user's browser. Disposable fixtures only.
import assert from "node:assert/strict";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
const { chromium } = await import(
  pathToFileURL(process.env.QA_PLAYWRIGHT_MODULE).href
);
const origin = process.argv[2] || "http://127.0.0.1:4200";
assert.ok(/^http:\/\/(localhost|127\.0\.0\.1):(4100|4200)$/.test(origin));
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.QA_BROWSER_PATH,
});
const reportPath = reportFile(
  "browser-verification.json",
  process.env.QA_BROWSER_REPORT,
);
const previous =
  process.env.QA_RESUME_REPORT === "1"
    ? JSON.parse(fs.readFileSync(reportPath, "utf8"))
    : null;
if (previous) assert.equal(previous.origin, origin);
const previousFailures = new Set(
  previous?.failures?.map((r) => r.role + "|" + r.path),
);
const results =
  previous?.results?.filter(
    (r) =>
      !r.errors.length &&
      !r.apiErrors.length &&
      !previousFailures.has(r.role + "|" + r.path),
  ) ?? [];
const failures = [];
let completed = false;
const app = fs.readFileSync("../web/src/App.tsx", "utf8");
const paths = [
  ...new Set(
    [
      ...app
        .slice(app.indexOf('<Route path="/admin"'))
        .matchAll(/<Route path="([^":*]+)"/g),
    ]
      .map((m) => m[1])
      .filter((p) => !p.startsWith("/") && p !== "profile"),
  ),
];
async function login(page, user, password) {
  console.log("UI login:", user);
  await page.goto(origin + "/admin/login");
  await page.locator('input[maxlength="6"]:enabled').waitFor();
  await page.locator('input[autocomplete="username"]').fill(user);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  const code = await page.locator("span.font-mono.text-lg").innerText();
  await page.locator('input[maxlength="6"]').fill(code);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(origin + "/admin");
  console.log("UI login passed:", user);
}
try {
  for (const [index, role] of [
    "Super Admin",
    "Fleet Manager",
    "Documents Officer",
    "Data Entry",
    "Viewer",
    "Empty role",
  ].entries()) {
    const context = await browser.newContext({
      viewport: { width: 1365, height: 900 },
    });
    context.setDefaultTimeout(20000);
    context.setDefaultNavigationTimeout(30000);
    const page = await context.newPage();
    await login(
      page,
      index === 5 ? "night.user" : "security.role." + index,
      index === 5 ? "NightUser123" : "RoleTest2026!",
    );
    const me = await (await context.request.get(origin + "/api/me")).json();
    const perms = new Set(me.perms);
    const makeVisit = (page) => {
      let errors = [];
      let apiErrors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("response", (r) => {
        if (r.url().includes("/api/") && r.status() >= 500)
          apiErrors.push({
            url: r.url().replace(origin, ""),
            status: r.status(),
          });
      });
      return async (path) => {
        if (previous && results.some((r) => r.role === role && r.path === path))
          return;
        errors = [];
        apiErrors = [];
        const started = Date.now();
        await page.goto(origin + path);
        await page.waitForLoadState("networkidle");
        const text = await page.locator("body").innerText();
        const slug = path.replace("/admin/", "");
        const source = app
          .split("\n")
          .find((line) => line.includes(`path="${slug}"`));
        const required = source?.match(/element=\{g\((\[[^\]]+\]|'[^']+')/);
        const keys = required
          ? [...required[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
          : [];
        const denied = keys.length > 0 && !keys.some((k) => perms.has(k));
        const guardShown =
          text.includes("لا يمكنك فتح هذه الشاشة") ||
          text.includes("You cannot open this screen");
        const result = {
          role,
          path,
          title: await page.title(),
          bodyLength: text.length,
          milliseconds: Date.now() - started,
          denied,
          guardShown,
          errors: [...errors],
          apiErrors: [...apiErrors],
        };
        results.push(result);
        if (
          errors.length ||
          apiErrors.length ||
          text.length < 20 ||
          page.url().includes("/admin/login") ||
          (denied && !guardShown)
        )
          failures.push(result);
        if (results.length % 10 === 0)
          console.log("Browser pages checked:", results.length);
      };
    };
    const visit = makeVisit(page);
    await visit("/admin");
    await visit("/admin/profile");
    // Every static admin screen as owner; all main operational and protected screens for each other role.
    const selected =
      index === 0
        ? paths
        : [
            "riders",
            "vehicles",
            "leaves",
            "advances",
            "companies",
            "performance",
            "rider-issues",
            "users",
            "roles",
            "settings",
            "backups",
          ];
    let next = 0;
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        const worker = await context.newPage();
        const check = makeVisit(worker);
        while (next < selected.length)
          await check("/admin/" + selected[next++]);
        await worker.close();
      }),
    );
    if (index === 0)
      for (const p of [
        "riders/4000001",
        "riders/4000001/edit",
        "riders/id-documents",
        "riders/driving-licenses",
        "reports/riders",
      ])
        await visit("/admin/" + p);
    console.log(
      "Browser screens checked:",
      role,
      results.filter((r) => r.role === role).length,
    );
    await context.close();
  }
  const guest = await browser.newContext();
  const page = await guest.newPage();
  await page.goto(origin + "/admin/riders");
  await page.waitForLoadState("networkidle");
  assert.ok(page.url().includes("/admin/login"), "Guest redirected to login");
  await guest.close();
  for (const [id, password] of [
    ["4000001", "OfficePass2026"],
    ["8800002", "SecondRider2026"],
  ]) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    await page.goto(origin + "/rider/login");
    await page.locator('input[autocomplete="username"]').fill(id);
    await page.locator('button[type="submit"]').click();
    await page.locator('input[autocomplete="current-password"]').fill(password);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(origin + "/rider");
    let errors = [];
    let apiErrors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (r.url().includes("/api/") && r.status() >= 500)
        apiErrors.push({
          url: r.url().replace(origin, ""),
          status: r.status(),
        });
    });
    for (const suffix of [
      "",
      "/profile",
      "/attendance",
      "/performance",
      "/ratings",
      "/requests",
      "/leaves",
      "/issues",
      "/security",
      "/help",
    ]) {
      errors = [];
      apiErrors = [];
      await page.goto(origin + "/rider" + suffix);
      await page.waitForLoadState("networkidle");
      const text = await page.locator("body").innerText();
      const result = {
        role: "Rider " + id,
        path: "/rider" + suffix,
        bodyLength: text.length,
        errors: [...errors],
        apiErrors: [...apiErrors],
      };
      results.push(result);
      if (
        errors.length ||
        apiErrors.length ||
        text.length < 20 ||
        page.url().includes("/rider/login")
      )
        failures.push(result);
    }
    assert.equal(
      (await context.request.get(origin + "/api/users")).status(),
      401,
    );
    await context.request.post(origin + "/api/portal/logout");
    assert.equal(
      (await context.request.get(origin + "/api/portal/me")).status(),
      401,
    );
    await page.goto(origin + "/rider");
    await page.waitForURL(/\/rider\/login/);
    console.log("Mobile browser rider checked:", id);
    await context.close();
  }
  completed = true;
} finally {
  await browser.close();
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        origin,
        resumedFrom: previous?.generatedAt,
        completed,
        passed: completed && failures.length === 0,
        total: results.length,
        failures,
        results,
      },
      null,
      2,
    ),
  );
}
assert.equal(failures.length, 0, JSON.stringify(failures));
console.log("BROWSER QA PASSED:", results.length);
