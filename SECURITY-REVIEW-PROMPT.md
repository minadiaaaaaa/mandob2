## Who I am and what this is

I am the owner and developer of **Mandoob**, a multi-company SaaS for delivery operators. The code is at:
`C:\Users\Mina diaa\Desktop\مندوب\tayson-logistics`

I want a **defensive security review of my own application**, so I can find and fix weaknesses before real companies use it.

## Scope

- **In scope:** this repository's code (`server/`, `web/`, `shared/`, `database/`, `deploy/`, `vercel.json`, `wrangler.jsonc`, `dev.mjs`), its dependencies, and **my local copy** running on `http://localhost:4000` (API) and `http://localhost:5173` (web), started with `pnpm dev`.
- **Test data only:** use the accounts from the project's seed or example config, or create test companies through sign-up on localhost. Record any test credentials you create in a local file, not in chat.
- **Out of scope:** any production or deployed URL (Vercel, Cloudflare), any third-party site or service (including logistap.com, HungerStation, ZATCA), and any real customer data. No denial-of-service or load attacks, not even against localhost.

## Your role

Work as a **senior application security engineer**. Read the code first, then confirm the findings that matter by testing on localhost. Every finding needs evidence. Clearly separate confirmed issues from suspicions.

## What to review (highest priority first)

1. **Tenant isolation:** can one company read or change another company's data? Check every route and query for `tenant_id` scoping through `tenancy.ts`, including IDs in URLs, exports, imports, file downloads, backups, notifications and the live board. Test it with two test companies.
2. **Authentication:**
   - Admin login, including the 6-character on-screen code.
   - Rider portal login, with rider ID or iqama plus password.
   - Password reset and email verification codes, lockouts and `login_attempts`, `blocked_ips`, `TRUST_PROXY` handling.
   - Session creation, expiry and sign-out from other devices.
3. **Authorization:**
   - Does every action check `perms.ts`?
   - Can staff exceed their role? Can a rider reach admin APIs or another rider's data?
   - Can a company reach platform-owner (`Platform.tsx`, `asPlatform`) functions?
4. **SaaS and billing logic:**
   - Can plan limits (`saas.ts`, `plan_limit_reached`) be bypassed, for example through bulk import or races?
   - Can an expired or suspended company still write?
   - Can a company approve its own payment or change its plan, prices or add-ons?
5. **Injection:** SQL (`sql.ts`, `db.ts`, any string-built queries, ORDER BY or column names taken from input), and formula injection in Excel/CSV exports.
6. **XSS and frontend:** `dangerouslySetInnerHTML`, email templates, translation overrides, rider issue messages, file names. Also the CSP and security headers.
7. **File uploads and downloads** (`files.ts`, `scans.ts`, attachments, receipts, voice notes): type and size checks, path traversal, served content-type, access control on downloads.
8. **CSRF and CORS** on cookie-based endpoints.
9. **Secrets and crypto:** `.env`, `server/data/app.key`, `first-login.txt`, the `secrets` table, backup encryption, password hashing, randomness of codes and tokens. Look for secrets committed to git or exposed to the frontend bundle.
10. **Rate limiting and abuse:** sign-up, login, code verification, email sending.
11. **Deployment config:** `vercel.json`, `wrangler.jsonc`, the Cloudflare worker and tunnel, `HOST` binding. Check what is publicly exposed (from the config only; don't probe the deployed URLs).
12. **Dependencies:** run `pnpm audit` in `server/` and `web/` and report anything high or critical that is actually reachable.

## Skills and tools to use (if available)

- `audit-context-building` first, to map the code and its trust boundaries.
- `/security-review` and `semgrep` (important-only mode first) for the static pass.
- `fp-check` on every high or critical finding before you report it, to rule out false positives.
- `run` to start the app locally for dynamic checks.
- `code-review` on your fixes.

## Report

Write `SECURITY-REPORT.md` at the project root. For each finding include:
- **Severity** (critical / high / medium / low) and a **title**.
- **Location** (file:line).
- **What an attacker could do,** and the steps to reproduce it on localhost.
- **Evidence:** a request and response, or the code path.
- **The fix.**

Order the findings by severity, and end with a short list of things that were checked and found safe.

## After the report

- **Wait for my approval** before changing any code.
- Then fix one finding at a time, critical first, with a test that proves the issue is gone. Keep existing data and features working.
- Don't commit or push unless I ask.
