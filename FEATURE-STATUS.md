# Feature status: LOGISTAP-MISSING.md vs the code

Checked 2026-11-07 on commit `bb6eb1c` (branch `mysql-migration`). Updated the same day after phases 2–8 (last commit `c6219a3`). Each phase has its own integration test in `server/test/`, all run by `qa-run-mysql.ps1`.

**How it was checked**
- DB: `server/src/schema.sql` and `migrations.ts`.
- Server: routes, `perms.ts` MATRIX and plan checks.
- UI: `App.tsx` route, `layout.tsx` menu and the page.
- i18n: `shared/i18n/*.json`.
- Works locally: the main action was run once on the disposable test install (port 4100, DB `mandoob_test_quick`) as two new test companies. The script is `feature-probe.mjs` in the session scratchpad. The browser QA suite (`browser-qa.mjs`, 187 checks) already opens the existing screens.

**Rule**
- ✅ Done: all four layers exist and the feature worked.
- 🟡 Partial: some layers exist.
- ❌ Missing: nothing exists.
- Look-alikes don't count. Examples: the "monthly invoices" import is not a tax invoice maker, an Ajeer permit is not a platform ID, and `vehicles.status = maintenance` is not a servicing log.

## Counts

| ✅ Done | 🟡 Partial | ❌ Missing | Total |
|---|---|---|---|
| **33** | **1** | **1** | 35 |

**Cross-cutting gap: languages.** `bn.json` and `ur.json` have 711 keys, while `ar.json` has 4,185 and `en.json` has 4,138. Bengali and Urdu cover only the rider portal (`rp.*`) and common/error strings. Every staff screen falls back to English in those two languages (`web/src/i18n.tsx`, `t()`). So no existing staff feature meets "all 4 languages". Every feature built in phases 2–8 has all four languages. Translating the old staff screens into bn/ur is a separate job.

**Isolation check:** company B read company A's applicant and got 404. B's applicant list total was 0.

## Table

| # | Feature | Status | DB | Server | UI | Works locally | Evidence | What's missing |
|---|---|---|---|---|---|---|---|---|
| 1 | Branches | ✅ | ✓ `branches` with `tenant_id` (`schema.sql`); `riders.branch_id` and `vehicles.branch_id` with composite foreign keys `(tenant_id, branch_id)` (`migrations.ts` step 4) | ✓ `routes/branches.ts` (list, export, add, edit, switch off/on, make main, delete); `branches.*` permissions (`perms.ts`); `QUOTAS.branches` (`domain/plans.ts`); rules in `domain/branches.ts`; branch filter on riders, vehicles, documents, daily performance, ratings, advances, alerts and reports | ✓ `pages/system/Branches.tsx` at `/admin/branches`, menu under System; branch on the rider and vehicle forms, lists, profiles and imports; bulk move; all 4 languages | Yes. `test/branches.mjs` has 50+ checks: limits, main branch, in use, filters, import and isolation. Also checked in the browser in Arabic and English, desktop and phone, as two companies | — | — |
| 2 | Designations (job titles) | ✅ | ✓ `designations` with `tenant_id` and `builtin_key` (Driver, Supervisor); `riders.designation_id` with a composite key | ✓ same router; `designations.*` permissions; `QUOTAS.designations` counts custom titles only | ✓ `/admin/designations`; job title on the rider form, list, profile, bulk edit and import; all 4 languages | Yes. Same test file, plus the browser check | — | — |
| 3 | Visa and sponsor | ✅ | Rider visa, sponsor and passport columns (migration 7) | `routes/employees.ts`, rules in `domain/employees.ts` | Rider form and employee file (`pages/riders/Employees.tsx`); all 4 languages | Yes. `test/employees.mjs` | — | — |
| 4 | Employee bank accounts (many) | ✅ | `rider_bank_accounts` with `tenant_id` (migration 7) | `/riders/:id/bank-accounts`, `/rider-bank-accounts/:id`; IBAN checked with mod 97 (`domain/employees.ts`) | Bank accounts panel on the employee file | Yes. `test/employees.mjs` and `src/employees.test.ts` | — | — |
| 5 | Hiring stages | ✅ | Applicant stages new→contacted→interview→documents→ready (migration 7) | `routes/applicants.ts` | `Applicants.tsx` stage pipeline; all 4 languages | Yes. `test/employees.mjs` | — | — |
| 6 | Exited employees | ✅ | `riders.exit_date`, `exit_reason`, `exit_clearance` (clear/in debt/settled), `exit_note` (migration 7) | `/riders-exited` (+ export), `/riders/:id/exit` | `/admin/riders/exited` with status cards | Yes. `test/employees.mjs` | — | — |
| 7 | Driver documents "missing" column | ✅ | Existing documents and files | `/rider-papers`: eight papers incl. photo, passport and "other"; most missing first (`riderPapers` in `domain/employees.ts`) | `/admin/riders/papers` | Yes. `test/employees.mjs` | — | — |
| 8 | Accident records | ✅ | Accident tables with `tenant_id` and composite keys (migration 6, `FLEET_LINKS`) | `/vehicle-accidents` (+ stage, export): severity, Najm/traffic, stages, location, attachments | `/admin/vehicle-accidents` (`pages/fleet/FleetLog.tsx`) | Yes. `test/fleet-log.mjs` | — | — |
| 9 | Full servicing log | ✅ | Service records (migration 6) | `/vehicle-services`: start, complete, pay (writes a finance entry when an account is given), cancel, export | `/admin/vehicle-services` | Yes. `test/fleet-log.mjs` | — | — |
| 10 | Vehicle documents in one table | ✅ | `vehicles.papers_note` (migration 6) | `/vehicle-papers`: photo, registration, key handover, operation card; most missing first (`domain/fleetLog.ts`) | `/admin/vehicle-papers` | Yes. `test/fleet-log.mjs` | — | — |
| 11 | Platform IDs | ✅ | ✓ `platform_ids` (number unique per platform, owner, worker, status) and `platform_id_transfers` with `tenant_id`; keys to riders and between them per company (`migrations.ts` step 5) | ✓ `routes/platformIds.ts` (list with status cards and filters, profile with history, create, edit, transfer, delete, export, import), rules in `domain/platformIds.ts`, `platform_ids.*` permissions incl. `transfer`; riders linked to an ID cannot be deleted (`routes/riders.ts` blockers) | ✓ `pages/riders/PlatformIds.tsx` at `/admin/platform-ids` (menu: Riders), transfer and history panels, import page, IDs on the rider profile; all 4 languages | Yes. `test/platform-ids.mjs` 54 checks (rules, transfers and their order, import, audit, isolation between two companies). Checked in the browser in Arabic and English, desktop and phone | — |
| 12 | Daily targets | ✅ | Per-company setting | GET/PUT `/performance-targets`; targets come with the performance list (`routes/performance.ts`) | Target panel on `Performance.tsx` | Yes. `test/tools.mjs` | — | — |
| 13 | Driver quality report upload | ✅ | `monthly_ratings` (existing) | The import accepts the "Delivery Quality Segment" column names (`routes/performance.ts`) | `Ratings.tsx` import | Type-check only: no upload test with a real exported file | — | A test with a real HungerStation file |
| 14 | Shared IDs in the monthly report | ✅ | ✓ from `platform_id_transfers` | ✓ `GET /platform-ids/shared?month=` (`sharedIds` in `domain/platformIds.ts`: the holder at the start of the month plus everyone it moved to) | ✓ "Shared IDs" tab on the Platform IDs page with a month picker | Yes. Same test file (this month, a holder from the previous month, a month with no changes) and the browser | — (linked from the Performance page) |
| 15 | Report screenshot/print | ✅ | n/a | n/a | Print buttons on `Reports.tsx` and `Performance.tsx` | Checked in the browser | — | — |
| 16 | Company finance (accounts, categories, entries, suppliers) | ✅ | `fin_*` tables with `tenant_id` (migration 8, `FINANCE_LINKS`) | `routes/companyFinance.ts`: accounts, categories, entries (void, never edit), transfers, suppliers, export; `company_finance.*` permissions | `/admin/company-finance` (`CompanyFinance.tsx`) | Yes. `test/finance.mjs` (62 checks) | — | — |
| 17 | Obligations | ✅ | `fin_obligations`, `fin_obligation_dues` | `/fin-obligations`, `/fin-dues` (pay, skip) | Obligations tab | Yes. `test/finance.mjs` | — | — |
| 18 | Assets and inventory | ✅ | `fin_assets`, `fin_stock` and its moves | `/fin-assets`, `/fin-stock`, `/fin-stock/:id/moves` | Assets and stock tabs | Yes. `test/finance.mjs` | — | — |
| 19 | Tax invoice maker + ZATCA phase 2 | ✅ (sandbox) | Invoices, lines and buyers (migration 9, `INVOICE_LINKS`); invoice quotas in `QUOTAS` | `routes/invoices.ts`, `domain/invoices.ts`: UBL 2.1 XML, SHA-256 hash, PIH chain, ICV, TLV QR, credit notes; sandbox signing needs `zatca_phase2` | `/admin/invoices` (`Invoices.tsx`, QR code) | Yes. `test/invoices.mjs` (40 checks) | — | Production onboarding with ZATCA (a real CSID from the Fatoora portal): only the sandbox key exists |
| 20 | Payroll | ✅ | Payroll sheets, lines and salary rules (migration 8) | `/payroll` (recalculate keeps line IDs, finalize, reopen, pay, export), `/salary-rules` | `/admin/payroll` (`Payroll.tsx`) | Yes. `test/finance.mjs` | — | — |
| 21 | Payment records | ✅ | Finance entries | Dues, payroll and service payments write finance entries | Entries list in company finance | Yes. `test/finance.mjs`, `test/fleet-log.mjs` | — | — |
| 22 | Rider clearance statement | ✅ | From payroll, advances and finance | `/riders/:id/settlement` | `/admin/riders/:id/settlement` (printable) | Yes. `test/finance.mjs` | — | — |
| 23 | Company health % / profile completeness | ✅ | Org settings, accounts, documents | `domain/health.ts` (`profileCompleteness` with weights 15/30/15/15/25, `companyDashboard`), in `/dashboard` | `DashboardCompany.tsx` on the dashboard | Yes. `test/tools.mjs` and the browser | — | — |
| 24 | Risk score (employees, vehicles) | ✅ | — | Rider and vehicle risk in `companyDashboard` | Dashboard sections | Yes. `test/tools.mjs` | — | — |
| 25 | Finance on the dashboard | ✅ | — | `finance` block in `/dashboard` for users with finance access | Dashboard finance cards | Yes. `test/tools.mjs` | — | — |
| 26 | Dashboard cards: days left, branches, designations | ✅ | — | `company.cards` in `/dashboard` | Dashboard cards | Yes. `test/tools.mjs` and the browser | — | — |
| 27 | Print lists with chosen and blank columns + Excel | ✅ | n/a | `/print-lists/{riders,vehicles}` (+ `/export`); only known columns are accepted | `/admin/print-lists/riders`, `/admin/print-lists/vehicles` | Yes. `test/tools.mjs` and the browser | — | — |
| 28 | Rider ID card maker | ✅ | n/a | `/id-cards` | `/admin/id-cards` with QR and print | Yes. `test/tools.mjs` and the browser | — | — |
| 29 | Saved links | ✅ | `bookmarks` (per user, in `TENANT_TABLES`), `community_links` (platform owner) | `/bookmarks`, `/platform/community-links` (`platformOnly`) | `/admin/bookmarks` | Yes. `test/tools.mjs` and the browser | — | — |
| 30 | Excel template per section | ✅ | n/a | Existing importers | `/admin/data-management`: one page with every section's template and import | Checked in the browser | — | — |
| 31 | Company legal data | ✅ | Settings keys incl. city CR number and expiry, VAT certificate expiry, GOSI, Qiwa, labor office (ORG_RULES in `routes/system.ts`) | `organization.*` | Settings > organization | Yes. `test/tools.mjs` | — | — |
| 32 | Close company request | ✅ | `tenants.closure_requested_at`, `closure_reason` (migration 10) | `/company/closure` GET/POST/DELETE (the company name is typed again) | Card on Billing; badge on the owner's company list | Yes. `test/tools.mjs` | — | — |
| P1 | OCR reading | ❌ (not built) | n/a | `scans.ts` still returns `unavailable` | Upload UI exists | — | Stub | Needs an external reading engine (a paid OCR service or a self-hosted model). Not built on purpose |
| P2 | Lists: status cards + plan counter | ✅ | `QUOTAS` | `/plan/usage`; rider stats working/ready/on leave (`routes/riders.ts`) | `PlanCounter` and status cards on `RidersList.tsx` | Yes. `test/tools.mjs` | — | — |
| P3 | HungerStation Live | 🟡 | `live_board`, `live_points`, `live_days` | `routes/live.ts`; `requireFeature('live_rider_details')` | `Live.tsx` | Board 200; rider details on Free 402 | — | Not built: the Android app, Partner Center and Rooster sources (need the platforms' own access), and the `live_multi_city` gate |
