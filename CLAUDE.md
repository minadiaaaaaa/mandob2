# Mandoob (مندوب)

Multi-company SaaS for delivery operators: riders, vehicles, platforms/contracts, performance, finance, rider portal.
The platform owner is company (tenant) 0; every subscribed company is its own tenant.

## Layout
- `server/` Node 24 + Express 5 + TypeScript (run by tsx, no build), MySQL 8 / MariaDB via mysql2.
  - `src/index.ts` middleware order: tenant 0 → ready → `authenticate` → platform maintenance → public/signup/portal routers → `subscriptionGate` → `pausedGate` → staff routers.
  - `src/schema.sql` full schema, idempotent (`CREATE TABLE IF NOT EXISTS`); `src/migrations.ts` numbered changes for existing installs (`schema_migrations`, named lock). `src/seed.ts` `bootstrap()` runs both at every start.
  - `src/tenancy.ts` rewrites every query for the current company; `src/db.ts` holds `q/one/exec/tx`, `withTenant`, `asPlatform`, the quota insert guard.
  - `src/perms.ts` permission `MATRIX` (module → actions) and built-in roles. `src/auth.ts` sessions, `can(...)`, `platformOnly`.
  - `src/domain/` business rules defined once: `plans.ts` (quotas, features, plan defaults), `quotas.ts`, `subscription.ts`, `rules.ts`.
  - `src/routes/*.ts` one router per module; `saas.ts` = signup, billing, owner platform pages, plan gates.
  - `src/http.ts` `clean()` validation, `list()`/`Spec` for paged lists, `sendExport`, `fail`, `mustExist`.
- `web/` React 19 + Vite + Tailwind 4. Pages in `src/pages/<area>/`, routes in `src/App.tsx`, menu in `src/layout.tsx`, shared UI in `src/ui/` (`kit.tsx`, `common.tsx`, `plan.tsx`).
- `shared/i18n/{ar,en,bn,ur}.json` every UI string, all four languages. Arabic is RTL.

## Commands (pnpm is not on PATH here: use `npx --yes pnpm`)
- Dev: `npx --yes pnpm dev` (API :4000 + web). Typecheck: `npx --yes pnpm typecheck`.
- Unit tests: `cd server && npx tsx --test src/**/*.test.ts`.
- Full test plan (local MariaDB on 127.0.0.1:3307, disposable DB only):
  `cd server; $env:QA_DATABASE_URL='mysql://root:localtest@127.0.0.1:3307/mandoob_test_full'; $env:QA_BROWSER_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'; & .\test\qa-run-mysql.ps1`
  Do not pipe it through `*>&1`: Vite writes to stderr and PowerShell then fails the step.
- Tests only ever use `mandoob_test*` databases and ports 4100/4200. Never the user's dev DB on :4000.

## Rules for every change
- **Tenancy**: every company-owned table has `tenant_id INT NOT NULL` and must be added to `TENANT_TABLES` in `tenancy.ts`. Route code never filters by tenant itself. Platform-wide reads use `asPlatform`, owner-only routes use `platformOnly`. A query on company data without a company throws.
- **Permissions**: new module → add to `MATRIX` in `perms.ts`; every route uses `can('module.action')` (or is an explained exception in `test/route-guard.mjs`).
- **Plans**: no hard-coded limits. Countable records are declared in `QUOTAS` (`domain/plans.ts`) and enforced by the insert guard / `withQuota`; paid features use `requireFeature`. `LATER_QUOTAS` (invoice_buyers, open_invoice_drafts, invoices_month) already have plan columns and wait for their screens.
- **Branches and job titles** (`domain/branches.ts`): every new rider goes through `withRiderDefaults` and every vehicle through `withVehicleDefaults` (main branch, Driver). A given branch or title is checked with `checkBranch` / `checkDesignation`.
- **Locking reads** (`FOR UPDATE`, `LOCK IN SHARE MODE`) on one company table are filtered in their WHERE by tenancy.ts, so they see the latest rows. Keep them to one company table.
- **Audit** every create/update/delete with `audit(req, {...})`.
- **Data**: keep existing data; new columns nullable or with defaults; money as DECIMAL(12,2); dates stored UTC.
- **i18n**: new strings in all four JSON files; errors are codes (`err.*`), not prose.
- Keep routes thin; reuse `clean`, `list`, `sendExport`, `mustExist`.
- Don't commit or push unless asked. Don't open or sign in to logistap.com. Don't print passwords in chat.

## Reference docs
LOGISTAP-MISSING.md (features to build), LOGISTAP-FEATURES.md (screen details), LOGISTAP-PROMPT.md (build order, standards), FEATURE-STATUS.md (what exists), ARCHITECTURE-AUDIT.md, SECURITY-REPORT.md.
