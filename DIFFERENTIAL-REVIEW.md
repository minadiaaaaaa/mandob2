# Differential review: commit bb6eb1c (7e1f0bb..bb6eb1c)

Date: 2026-11-07. Scope: the checkpoint commit "Move to MySQL, add SaaS tenancy and LogisTap-aligned plans"
(124 paths; server/src: 41 files, +1928 / −576). Strategy: FOCUSED (medium size). The same code already went
through `code-review` (high) and the full `SECURITY-REPORT.md` review earlier; this pass looks only at what the
diff could have broken or made riskier.

## Risk triage

| Risk | Files |
|---|---|
| HIGH | `tenancy.ts` (new), `db.ts`, `auth.ts`, `routes/saas.ts` (new), `routes/portal.ts`, `routes/access.ts`, `routes/maintenance.ts`, `index.ts`, `schema.sql`, `migrations.ts` |
| MEDIUM | `domain/*` (new), `perms.ts`, `seed.ts`, `routes/{companies,riders,fleet,fleet2,live,sync,system,account}.ts` |
| LOW | web pages, i18n, tests, docs; removed Supabase/Cloudflare/Vercel files |

## Removed security-relevant code and its replacement

| Removed | What it enforced | Replaced by | Verdict |
|---|---|---|---|
| `database/supabase/rls.sql`, `generate-rls.mjs` | Row-level security in PostgreSQL | Query rewriting in `tenancy.ts` (`scopeTenant`) applied in `db.ts:compile`; a company-table query with no company **throws** (`db.ts:97`), platform reads need explicit `asPlatform` | OK. Isolation moved from the database to the app. Checked: every table with `tenant_id` in `schema.sql` is in `TENANT_TABLES` and vice versa (0 mismatches; 9 platform tables). Only `executeScript` skips the rewriter, and it runs DDL only (`migrations.ts`, `seed.ts`). |
| `routes/setup.ts` + `Setup.tsx` (install wizard) | One-time setup closed after install | `bootstrap()` at server start (`index.ts`); `/setup` redirects to login | OK. No unauthenticated setup endpoint remains. |
| PostgreSQL error codes in `http.ts` | 409/422 instead of 500 | MySQL codes in `DB_ERRORS` | OK. |
| Per-name job lock `runningJobs.has(job.name)` | One run per job | Per company: `jobKey = tenant:name` | OK. |

## New attack surface checked

- **Sign-in across companies** (`auth.ts` `login` → `finishLogin`): user looked up platform-wide, then the request runs in the user's company. Sessions join `users` and `roles` on `tenant_id` (`auth.ts` authenticate), so a session cannot pick up a role from another company.
- **Owner-only pages**: `platformOnly` on backups and blocked IPs (`access.ts`, `maintenance.ts`) and the platform router.
- **Quota guard** (`db.ts` `exec`): check and insert share a transaction with `FOR UPDATE`; the owner (tenant 0) is not limited by design.
- **Username/email uniqueness** is checked platform-wide (`access.ts checkUnique`), which sign-in by username needs.

## Findings from this pass

| # | Severity | Where | Finding |
|---|---|---|---|
| D1 | Low | `auth.ts` `finishLogin` | `company_suspended` is answered before the password check, so a stranger can learn that an account exists and its company is suspended. Same pattern already existed for `account_suspended` (disabled user/role). Fix later: check the password first, then report suspension. |
| D2 | Low | `auth.ts` `reject(..., status)` | Plan refusals after the right password (`staff_paused` 402, `device_limit_reached` 409) are stored as failed attempts. They no longer trigger the IP block, but they still count toward the 10-per-minute sign-in limit for that address. Harmless in normal use. |
| — | — | — | No new High/Medium issues. The known items (email preview iframe, `TRUST_PROXY`, security headers, body-parser/nodemailer versions…) are in `SECURITY-REPORT.md` and were present before this commit or are not changed by it. |

## Test coverage of the changed code

Unit (`sql.test.ts`, `tenancy.test.ts`, `http.test.ts`), route guard (every route has a permission or an explained
exception), `tenant-isolation.mjs`, `saas-extra.mjs`, `plans.mjs`, browser QA and `browser-saas.mjs`.
Full run result after the commit: see the end of this file.

## Confidence and limits

Medium-high for tenancy and auth (read in full, plus tests). Web UI changes were not re-read line by line.
Semgrep could not run on this Windows machine (see `SECURITY-REPORT.md`).

## Full test run after the commit

2026-11-07, `test/qa-run-mysql.ps1` on `mandoob_test_full`: all 28 steps passed. Results: unit tests, typechecks, route guard, API suites, tenant isolation, SaaS extra (106), plans (38), browser QA (187), details (51), write (3), public (8), browser SaaS (14 steps).
