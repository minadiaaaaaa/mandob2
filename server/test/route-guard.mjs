// Every API address checks a permission with can(), or is one of the known exceptions below, each with the
// reason it is safe. A new address that does neither fails this test, so a missing check is caught before release.
// Runs without a server: node test/route-guard.mjs (from server/).
import assert from "node:assert/strict";
import { manual } from "./route-inventory.mjs";

const EXCEPTIONS = [
  [/^\/auth\//, "sign-in itself: the challenge code, login and logout"],
  [/^\/public\//, "public by design: branding, plans and company sign-up"],
  [/^\/portal\//, "rider portal: riderAuth checks the rider's own session (portal.ts)"],
  [/^\/platform\//, "owner dashboard: platformOnly guards the whole /platform router (auth.ts)"],
  [/^\/(me|profile)(\/|$)/, "the signed-in user's own account"],
  [/^\/lookups\//, "option lists for forms: requireUser, scoped to the company"],
  [/^\/meta\//, "badges and business rules: requireUser, filtered by the user's permissions"],
  [/^\/notifications\/mine$/, "the user's own notifications: requireUser"],
  [/^\/bookmarks(\/:id)?$/, "the user's own saved links: requireUser, every query has the user's id (tools.ts)"],
  [/^\/plan\/usage$/, "the plan counters every screen shows (37/50): requireUser, the user's own company only"],
  [/^\/scans\//, "temporary uploads: requireUser, each scan bound to its uploader (scans.ts)"],
  [/^\/sync\/ingest$/, "the browser extension: its own company token, checked in the handler (sync.ts)"],
  [/^\/email\/branding$/, "checks email_templates.update or smtp.update inside the handler (email.ts)"],
];
const unexplained = manual.filter((r) => !EXCEPTIONS.some(([re]) => re.test(r.path)));
assert.deepEqual(unexplained.map((r) => `${r.method} ${r.path} (${r.file}:${r.line})`), [],
  "addresses without can() that are not a known exception: add can(...) or, if it is truly safe, an exception with its reason");
console.log(`ROUTE GUARD PASSED: ${manual.length} exceptions, all explained`);
