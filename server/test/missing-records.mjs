// Every address that changes or deletes one record must say "not found" for a record that does not exist,
// instead of answering ok (and writing an audit entry for a change that never happened).
// Run after smoke.mjs on the disposable install (platform owner admin / Admin12345!).
import assert from "node:assert/strict";
import { routes } from "./route-inventory.mjs";

const base = (process.argv[2] ?? "http://127.0.0.1:4100") + "/api";
assert.match(base, /^http:\/\/(localhost|127\.0\.0\.1):(4100|4200)\/api$/, "Disposable test ports only");
let cookie = "";
const api = async (method, path, body) => {
  const r = await fetch(base + path, { method, headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const sc = r.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  return { s: r.status, j: await r.json().catch(() => ({})) };
};
const ch = (await api("GET", "/auth/challenge")).j;
assert.equal((await api("POST", "/auth/login", { username: "admin", password: "Admin12345!", challengeId: ch.id, code: ch.code })).s, 200);

const MISSING = "987654321";
// addresses where a missing id is legitimately not an error
const EXEMPT = new Set([
  "POST /notifications/:id/read", // marking an unknown notification read is a no-op by design
  "DELETE /languages/:code/keys/:key", // "back to the default text": nothing to remove is already the default
]);
const offenders = [];
let tried = 0;
for (const r of routes) {
  if (r.method === "GET" || !/:(id|key|rider|code)\b/.test(r.path) || EXEMPT.has(`${r.method} ${r.path}`)) continue;
  if (/\/(import|scans)\b|\/attachments\b|\/sync\/|\/portal\b|\/platform\//.test(r.path)) continue;
  const path = r.path.replace(/:(id|key|rider|code|userId|category|type)\b/g, MISSING);
  const res = await api(r.method, path, {});
  tried++;
  if (res.s < 400) offenders.push(`${r.method} ${r.path} → ${res.s} (${r.file}:${r.line})`);
}
console.log(`tried ${tried} change addresses with a missing record`);
assert.deepEqual(offenders, [], "answered ok for a missing record:\n" + offenders.join("\n"));
console.log("MISSING RECORD CHECKS PASSED:", tried);
