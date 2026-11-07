// With no setup screens, a fresh database must be ready as soon as the server answers:
// the owner from OWNER_EMAIL / OWNER_PASSWORD signs in, plans exist, and the old /api/setup address is gone.
import assert from "node:assert/strict";

const base = (process.argv[2] ?? "http://127.0.0.1:4100") + "/api";
assert.match(base, /^http:\/\/(localhost|127\.0\.0\.1):(4100|4200)\/api$/, "Disposable test ports only");
let cookie = "";
const api = async (method, path, body) => {
  const r = await fetch(base + path, { method, headers: { cookie, "content-type": "application/json" }, body: body && JSON.stringify(body) });
  const sc = r.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  return { s: r.status, j: await r.json().catch(() => ({})) };
};
const old = await api("GET", "/setup/status");
assert.ok(old.s >= 400 && !("installed" in old.j), "the setup wizard address no longer answers");
const plans = (await api("GET", "/public/plans")).j;
assert.deepEqual(plans.map((p) => p.key), ["free", "starter", "growth", "scale"], "the four plans are created, Free first");
assert.ok(plans.every((p) => p.max_platforms != null && p.max_devices != null), "every plan has the phase 1 limits");
const ch = (await api("GET", "/auth/challenge")).j;
assert.equal((await api("POST", "/auth/login", { username: "admin", password: "Admin12345!", challengeId: ch.id, code: ch.code })).s, 200, "owner signs in");
const me = (await api("GET", "/me")).j;
assert.equal(me.platform_owner, true, "the first account is the platform owner");
assert.ok(me.perms.length > 300, "with every permission");
// the screens read the business rules from the server (phase 0.6)
const rules = (await api("GET", "/meta/rules")).j;
assert.deepEqual(rules.statuses.rider, ["active", "inactive", "suspended", "terminated"], "rider statuses from domain/rules.ts");
assert.equal(rules.expiry_days.id, 60, "Iqama alert period from the company's settings, not a fixed 30");
assert.equal(rules.expiry_days.insurance_policy, 45);
assert.equal(Object.keys(rules.expiry_days).length, 10, "every document type has its alert period");
console.log("BOOTSTRAP CHECKS PASSED");
