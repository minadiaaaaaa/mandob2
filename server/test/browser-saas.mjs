// The SaaS journey in a real (headless) browser, never the user's own browser:
// a company signs up from the form, signs in, sees its trial, sends a plan request; the platform owner approves it;
// the company sees the paid plan. Then every admin page is opened on a phone and a computer, in light and dark mode,
// and must not spill sideways or log console errors.
// Usage, from server/: QA_PLAYWRIGHT_MODULE=… QA_BROWSER_PATH=… node test/browser-saas.mjs http://127.0.0.1:4100
import assert from "node:assert/strict";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { reportFile } from "./support/reports.mjs";

const { chromium } = await import(pathToFileURL(process.env.QA_PLAYWRIGHT_MODULE).href);
const origin = process.argv[2] || "http://127.0.0.1:4100";
assert.ok(/^http:\/\/(localhost|127\.0\.0\.1):(4100|4200)$/.test(origin), "Disposable test ports only");
const browser = await chromium.launch({ headless: true, executablePath: process.env.QA_BROWSER_PATH });
const stamp = Date.now().toString(36);
const email = `ui-${stamp}@example.com`;
const steps = [];
const step = (s) => { steps.push(s); console.log("ok:", s); };

async function signIn(page, user, password) {
  await page.goto(origin + "/admin/login");
  await page.locator('input[maxlength="6"]:enabled').waitFor();
  await page.locator('input[autocomplete="username"]').fill(user);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.locator('input[maxlength="6"]').fill(await page.locator("span.font-mono.text-lg").innerText());
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(origin + "/admin");
}
const errorsOf = (page) => { const list = []; page.on("pageerror", (e) => list.push(String(e))); page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) list.push(m.text()); }); return list; };

try {
  // ---------- the company: sign-up form
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: "ar" });
  const page = await ctx.newPage();
  const errs = errorsOf(page);
  await page.goto(origin + "/signup");
  const inputs = page.locator("form input");
  const fill = async (i, v) => inputs.nth(i).fill(v);
  await fill(0, `شركة الواجهة ${stamp}`); await fill(1, `UI Co ${stamp}`); await fill(2, "مالك الواجهة");
  await fill(3, email); await fill(4, "0501112222"); await fill(5, "UiPass2026"); await fill(6, "Mismatch2026");
  await page.locator('form button[type="submit"]').click();
  await page.getByText("كلمتا المرور غير متطابقتين").first().waitFor();
  step("sign-up refuses mismatched passwords on screen");
  await fill(6, "UiPass2026");
  await page.locator('form button[type="submit"]').click();
  await page.getByText("أهلاً بك").waitFor();
  step("sign-up form creates the company");
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await page.waitForURL(/\/admin\/login\?u=/);
  assert.equal(await page.locator('input[autocomplete="username"]').inputValue(), email);
  step("sign-in page arrives with the username filled in");
  await signIn(page, email, "UiPass2026");
  await page.getByText(/الفترة التجريبية: باقي 14 يوم/).waitFor();
  step("trial banner shows 14 days");
  assert.ok(!(await page.locator("aside").innerText()).includes("المنصة"), "no owner menu for a company");
  step("company menu has no owner section");

  // add a vehicle from the form
  await page.goto(origin + "/admin/vehicles/new");
  const vin = page.locator("main input[type=text]");
  await vin.nth(0).fill(`ق ل م ${String(Date.now()).slice(-4)}`);
  await vin.nth(2).fill("سيارة");
  await page.getByRole("button", { name: "إضافة مركبة" }).click();
  await page.getByRole("button", { name: "فتح المركبة" }).waitFor();
  step("vehicle added from the form");

  // the plan page and a request
  await page.goto(origin + "/admin/billing");
  await page.getByText("1 / 60").waitFor();
  step("usage shows the new vehicle (1 / 60)");
  await page.getByRole("button", { name: "اختر هذه الباقة" }).nth(1).click();
  await page.locator('[role="dialog"] input').first().fill("TRX-UI-1");
  await page.getByRole("button", { name: "إرسال الطلب" }).click();
  await page.getByText("دفعتك قيد المراجعة").first().waitFor();
  step("plan request sent and shown as under review");

  // ---------- the platform owner approves
  const octx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: "ar" });
  const owner = await octx.newPage();
  const oerrs = errorsOf(owner);
  await signIn(owner, "admin", "Admin12345!");
  await owner.goto(origin + "/admin/platform/payments");
  const row = owner.locator("tr", { hasText: "TRX-UI-1" });
  await row.waitFor();
  await row.getByRole("button", { name: "اعتماد" }).click();
  await owner.getByRole("button", { name: "تأكيد" }).click();
  await owner.getByText("مقبول").first().waitFor().catch(() => {});
  await owner.goto(origin + "/admin/platform/companies");
  await owner.locator("tr", { hasText: email }).getByText("نشط").waitFor();
  step("owner approves; the company shows as active");

  // ---------- the company sees its paid plan (the company cache refreshes within 10 s)
  await page.waitForTimeout(10500);
  await page.goto(origin + "/admin/billing");
  await page.getByText("باقتك", { exact: true }).waitFor();
  await page.getByText("1 / 120").waitFor();
  assert.equal(await page.getByText(/الفترة التجريبية/).count(), 0, "trial banner gone");
  step("company on Growth: limits 120 vehicles, banner gone");
  assert.deepEqual(errs, [], "company console errors: " + errs.join(" | "));
  assert.deepEqual(oerrs, [], "owner console errors: " + oerrs.join(" | "));

  // ---------- every admin page on a phone and a computer, light and dark
  const app = fs.readFileSync("../web/src/App.tsx", "utf8");
  const paths = [...new Set([...app.slice(app.indexOf('<Route path="/admin"')).matchAll(/<Route path="([^":*]+)"/g)].map((m) => m[1]).filter((p) => !p.startsWith("/")))];
  paths.push("platform", "platform/companies", "platform/plans", "platform/payments");
  const layout = [];
  for (const [name, viewport, scheme] of [["phone", { width: 375, height: 812 }, "light"], ["phone", { width: 375, height: 812 }, "dark"], ["computer", { width: 1366, height: 860 }, "light"], ["computer", { width: 1366, height: 860 }, "dark"]]) {
    const c = await browser.newContext({ viewport, colorScheme: scheme, locale: "ar", isMobile: name === "phone", hasTouch: name === "phone" });
    await c.addInitScript((s) => localStorage.setItem("lsp.theme", s), scheme);
    const p = await c.newPage();
    const pe = errorsOf(p);
    await signIn(p, "admin", "Admin12345!");
    for (const path of paths) {
      await p.goto(`${origin}/admin/${path}`);
      await p.waitForLoadState("networkidle").catch(() => {});
      const wide = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      const dark = await p.evaluate(() => document.documentElement.classList.contains("dark"));
      if (wide > 2) layout.push(`${name}/${scheme} /admin/${path} spills ${wide}px`);
      if (dark !== (scheme === "dark")) layout.push(`${name}/${scheme} /admin/${path} theme not applied`);
    }
    if (pe.length) layout.push(`${name}/${scheme} console: ${pe.slice(0, 3).join(" | ")}`);
    await c.close();
    step(`${paths.length} pages checked on ${name}, ${scheme} mode`);
  }
  assert.deepEqual(layout, [], "LAYOUT:\n" + layout.join("\n"));
  fs.writeFileSync(reportFile("browser-saas-verification.json"), JSON.stringify({ generatedAt: new Date().toISOString(), origin, steps }, null, 2));
  console.log(`BROWSER SAAS CHECKS PASSED: ${steps.length} steps`);
} finally {
  await browser.close();
}
