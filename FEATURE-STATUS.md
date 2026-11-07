# Feature status: LOGISTAP-MISSING.md vs the code

Checked 2026-11-07 on commit `bb6eb1c` (branch `mysql-migration`). Updated the same day after phase 2 (branches and job titles, uncommitted).

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
| **4** | **10** | **21** | 35 |

**Cross-cutting gap: languages.** `bn.json` and `ur.json` have 711 keys, while `ar.json` has 4,185 and `en.json` has 4,138. Bengali and Urdu cover only the rider portal (`rp.*`) and common/error strings. Every staff screen falls back to English in those two languages (`web/src/i18n.tsx`, `t()`). So no existing staff feature meets "all 4 languages". New features will add all four. Translating the old staff screens into bn/ur is a separate job.

**Isolation check:** company B read company A's applicant and got 404. B's applicant list total was 0.

## Table

| # | Feature | Status | DB | Server | UI | Works locally | Evidence | What's missing |
|---|---|---|---|---|---|---|---|---|
| 1 | Branches | ✅ | ✓ `branches` with `tenant_id` (`schema.sql`); `riders.branch_id` and `vehicles.branch_id` with composite foreign keys `(tenant_id, branch_id)` (`migrations.ts` step 4) | ✓ `routes/branches.ts` (list, export, add, edit, switch off/on, make main, delete); `branches.*` permissions (`perms.ts`); `QUOTAS.branches` (`domain/plans.ts`); rules in `domain/branches.ts`; branch filter on riders, vehicles, documents, daily performance, ratings, advances, alerts and reports | ✓ `pages/system/Branches.tsx` at `/admin/branches`, menu under System; branch on the rider and vehicle forms, lists, profiles and imports; bulk move; all 4 languages | Yes. `test/branches.mjs` has 50+ checks: limits, main branch, in use, filters, import and isolation. Also checked in the browser in Arabic and English, desktop and phone, as two companies | — | — |
| 2 | Designations (job titles) | ✅ | ✓ `designations` with `tenant_id` and `builtin_key` (Driver, Supervisor); `riders.designation_id` with a composite key | ✓ same router; `designations.*` permissions; `QUOTAS.designations` counts custom titles only | ✓ `/admin/designations`; job title on the rider form, list, profile, bulk edit and import; all 4 languages | Yes. Same test file, plus the browser check | — | — |
| 3 | Visa and sponsor | ❌ | — | — | — | — | `riders` has no visa or sponsor columns (`schema.sql:159-191`) | Everything |
| 4 | Employee bank accounts (many) | ❌ | — | — | — | — | No bank or IBAN columns anywhere | Everything |
| 5 | Hiring stages | 🟡 | ✓ statuses new/review/approved/rejected/withdrawn/hired (`schema.sql:254`) | ✓ `routes/applicants.ts:51-183`, MATRIX `perms.ts:15` | ✓ `pages/riders/Applicants.tsx`, `App.tsx:111-115`, `layout.tsx:35`; ar/en | Create 200, status "review" 200, stage "contacted" **422** | `routes/applicants.ts:30` | Stage pipeline new→contacted→interview→documents→ready; bn/ur |
| 6 | Exited employees | ❌ | Only `riders.status = terminated` (`schema.sql:166`) | — | Only the "terminated" card (`RidersList.tsx:72`) | — | — | Exit date, settlement status (clean/debt/complete) with note, detail page |
| 7 | Driver documents "missing" column | 🟡 | ✓ `rider_documents` (`schema.sql:214`, types id/license/health/driver_card/ajeer) | ✓ `missing` filter (`routes/riders.ts:128`) | ✓ Missing column and filter (`RidersList.tsx:43`, `:86`) | `/riders?missing=ajeer` 200 | `routes/riders.ts:135` sorts only by rider/id | Sort by most missing, "other document" type, profile photo/passport in the same table; bn/ur |
| 8 | Accident records | ❌ | — | — | — | — | — | Everything (severity, Najm/traffic, stages, location, attachments) |
| 9 | Full servicing log | 🟡 | Oil only: `oil_schedules`, `oil_changes` (`schema.sql:426-451`) | ✓ oil routes (`routes/fleet2.ts:649-789`) | ✓ Oil screens (`App.tsx:173-183`) | `/oil-changes` 200 | `vehicles.status = maintenance` is a look-alike (`routes/fleet.ts:173-179`) | Service types, schedule, in progress→completed with date, pay cost, cancel |
| 10 | Vehicle documents in one table | 🟡 | Separate `operation_cards` (`schema.sql:300`) and `vehicle_registrations` (`:327`) | ✓ `routes/fleet.ts:371`, `:532` | Separate screens (`App.tsx:137-145`) | Both lists 200 | — | One table; vehicle photo, key handover, missing column |
| 11 | Platform IDs | ✅ | ✓ `platform_ids` (number unique per platform, owner, worker, status) and `platform_id_transfers` with `tenant_id`; keys to riders and between them per company (`migrations.ts` step 5) | ✓ `routes/platformIds.ts` (list with status cards and filters, profile with history, create, edit, transfer, delete, export, import), rules in `domain/platformIds.ts`, `platform_ids.*` permissions incl. `transfer`; riders linked to an ID cannot be deleted (`routes/riders.ts` blockers) | ✓ `pages/riders/PlatformIds.tsx` at `/admin/platform-ids` (menu: Riders), transfer and history panels, import page, IDs on the rider profile; all 4 languages | Yes. `test/platform-ids.mjs` 54 checks (rules, transfers and their order, import, audit, isolation between two companies). Checked in the browser in Arabic and English, desktop and phone | — |
| 12 | Daily targets | ❌ | `daily_performance` holds actual figures only (`schema.sql:759-780`) | — | — | — | — | Everything |
| 13 | Driver quality report upload | 🟡 | `monthly_ratings` with segment A-F (`schema.sql:808-822`) | ✓ `routes/performance.ts:330-424`, import `:424` | ✓ `Ratings.tsx`, `App.tsx:209-210` | Template xlsx 200 | Closest match | Upload of the "Delivery Quality Segment" file (its columns and CSV); bn/ur |
| 14 | Shared IDs in the monthly report | ✅ | ✓ from `platform_id_transfers` | ✓ `GET /platform-ids/shared?month=` (`sharedIds` in `domain/platformIds.ts`: the holder at the start of the month plus everyone it moved to) | ✓ "Shared IDs" tab on the Platform IDs page with a month picker | Yes. Same test file (this month, a holder from the previous month, a month with no changes) and the browser | — (linked from the Performance page) |
| 15 | Report screenshot/print | ❌ | — | `reports.print` permission is unused (`perms.ts:45`) | No print button in `Reports.tsx` | — | — | Print and screenshot |
| 16 | Company finance (accounts, categories, entries, suppliers) | ❌ | `fines`, `wallet_entries` and `billing` are platform imports (look-alike) | — | — | — | — | Everything |
| 17 | Obligations | ❌ | — | — | — | — | — | Everything |
| 18 | Assets and inventory | ❌ | — | — | — | — | — | Everything |
| 19 | Tax invoice maker + ZATCA phase 2 | ❌ | Plan limits and the `zatca_phase2` feature flag only (`plans.ts:21`, `:26`) | `requireFeature('zatca_phase2')` is never used | — | — | `fines.invoice_no` is a look-alike | Everything |
| 20 | Payroll | ❌ | Only `advances.deduct_from = salary` (`schema.sql:603`) | — | — | — | — | Everything |
| 21 | Payment records | ❌ | `subscription_payments` is SaaS billing (look-alike) | — | — | — | — | Everything |
| 22 | Rider clearance statement | ❌ | — | — | — | — | — | Everything |
| 23 | Company health % / profile completeness | ❌ | — | — | — | — | — | Everything |
| 24 | Risk score (employees, vehicles) | ❌ | — | — | — | — | — | Everything |
| 25 | Finance on the dashboard | ❌ | — | No finance block (`routes/dashboard.ts:20`) | `Dashboard.tsx:59-72` shows advances only | — | Needs #16-17 | Balance, monthly net flow, overdue/pending/upcoming |
| 26 | Dashboard cards: days left, branches, designations | ❌ (counters exist since phase 2: Branches 2/2 and custom titles on their pages and on Billing) | `tenants.period_ends_at` exists | `days_left` in `/me` | Banner only when 7 days or fewer are left (`layout.tsx:307-322`) | — | — | The three cards |
| 27 | Print lists with chosen and blank columns + Excel | 🟡 | n/a | Fixed-column export (`routes/riders.ts:151-165`); `riders.print` permission unused | `ExportButton` (`ui/common.tsx:87`) | Riders export xlsx 200 | — | Column picker, blank columns, print, vehicles too |
| 28 | Rider ID card maker | ❌ | — | `driver_cards.print` permission unused | `RiderCards.tsx` is profile cards (look-alike) | — | — | Everything |
| 29 | Saved links | ❌ | — | — | — | — | — | Everything |
| 30 | Excel template per section | 🟡 | n/a | ✓ `importer.ts:105` template, `:118` preview/validate, `:174` run; 18 screens use it | ✓ Per-screen import wizards | Vehicles template 200 | — | Not on every section (riders documents, platform IDs, transactions); no single "data management" page |
| 31 | Company legal data | 🟡 | Settings keys `org.cr_number`, `tax_number`, `unified_number` (`routes/system.ts:16-17`) | ✓ `organization.*` (`perms.ts:68`) | ✓ Settings > organization | Org keys read 200 | — | City CR number and expiry, VAT certificate expiry, GOSI, Qiwa, labour office |
| 32 | Close company request | ❌ | — | No route in `saas.ts` | — | — | — | Everything |
| P1 | OCR reading | ❌ | n/a | `scans.ts:44-47` always returns `unavailable` | Upload UI exists | — | Stub | A real reading engine |
| P2 | Lists: status cards + plan counter | 🟡 | ✓ `QUOTAS` (`domain/plans.ts:10-17`) | ✓ `/plan/usage` | ✓ `PlanCounter` (`RidersList.tsx:61`, `Vehicles.tsx:71`), all 4 languages | Usage 200 | Counter done in phase 1 | Cards working/ready/waiting/on leave (these need statuses that don't exist yet) |
| P3 | HungerStation Live | 🟡 | ✓ `live_board`, `live_points`, `live_days` (`schema.sql:859-895`) | ✓ `routes/live.ts`; `requireFeature('live_rider_details')` (`:171`, `:188`) | ✓ `Live.tsx`, `App.tsx:213-215` | Board 200; rider details on Free **402 feature_locked** | — | Android app, Partner Center + Rooster sources, `live_multi_city` gate is never enforced |
