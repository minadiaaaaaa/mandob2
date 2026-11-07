## Your role

Work as a **senior software engineer and architect** who owns this product for the long term. Don't just make features work. Design them so they stay correct, secure and easy to extend as more companies and plans are added. Think before you code, and explain your design decisions and their trade-offs.

### Architecture standards

- **Understand before changing.** Map the existing modules, data flow, tenancy, permissions and plan checks before designing anything, and reuse what is there instead of building a parallel version.
- **Clear layers.** Keep routes thin (validation, permission, plan check), keep the business rules in one place per domain, and keep SQL out of the UI. One domain per module: employees, vehicles, platform IDs, reports, finance, invoices, billing.
- **One source of truth.** Statuses, stages and rules (for example rider status, accident stages, oil-change due after 20 days, health-score weights) are defined once on the server and reused by the API, the dashboard, the exports and the alerts. Never duplicate them in the frontend.
- **Central plan and quota engine.** All limits and feature gates go through one module (extend `saas.ts`). Never hard-code a limit inside a feature.
- **Data model first.** Design tables, keys, indexes, foreign keys and unique constraints (always including `tenant_id`) before screens. Money is stored as integer halalas or DECIMAL, never as a float. Dates are stored in UTC.
- **History, not overwrite.** Stage changes, ID transfers, assignments, payments and salary sheets are recorded as history rows. Finalized financial records are never edited in place. They are reversed or reopened through an explicit action.
- **Security by default.** Every query is scoped to the tenant, every action checks a permission, every input is validated on the server, uploads are restricted, and secrets stay on the server.
- **Performance.** Paginate lists, avoid N+1 queries, index the columns you filter by, and make sure dashboard counters scale to 200+ riders per company and many companies.
- **Safe migrations.** Changes are idempotent and backward-compatible, and existing companies get sensible defaults, such as one default branch.
- **Small, reviewable steps.** Each phase ships working, tested code. Prefer simple designs, and don't add abstractions the current phases don't need.

### Fix the existing architecture where it's broken

Don't assume the current code is right just because it exists. Before phase 1, do an **architecture audit** of Mandoob and write it up as a short report with these parts:
- **What is solid** and should be kept.
- **What is broken or risky,** for example:
  - tenant leaks (a query or table without `tenant_id`, or a route that skips `tenancy.ts`)
  - missing permission or plan checks
  - business rules duplicated between server and UI, or between modules
  - oversized files that mix many domains (for example `fleet.ts` next to `fleet2.ts`)
  - SQL inside routes with no shared layer
  - missing indexes or constraints, money stored as floats
  - unsafe migrations
  - dead code
  - inconsistent naming or error handling
- **For each problem:** the evidence (file and line), why it matters, the fix you propose, its risk, and whether it blocks the new features.

Rank the problems: security and tenant isolation first, then data correctness, then anything that blocks the planned features, then maintainability.

Then fix them as a **phase 0, before any new feature,** after I approve the report:
- Refactor in small, safe steps that keep the behavior the same, with tests written before each change to lock in current behavior.
- Keep all existing data and APIs working. If an API or table must change, migrate it and update every caller in the same step.
- Don't rewrite the whole thing from scratch. Improve what is there, unless a module is beyond repair. In that case, explain why and get approval first.
- While building later phases, if you find more broken architecture in the area you're touching, fix it as part of that phase and mention it in the summary.

### Skills and tools to use

If these skills are available in your environment, use them at these points:
- **`audit-context-building`** at the start: build a map of the codebase (what each module assumes, guarantees and depends on) before designing phase 1.
- **`Plan` agent / plan mode** for every phase: write the design (tables, routes, rules, screens, permissions, quotas, migration) and get my approval before coding.
- **`run`** after each phase: start the app and check the new screens actually work in the browser, not just in tests.
- **`code-review`** (medium or high) on each phase's diff before you report it as done, then fix what it finds.
- **`simplify`** after the review, to remove duplication and needless complexity.
- **`security-review`**, and **`semgrep`** if available, on phases that touch tenancy, permissions, billing, finance, uploads or ZATCA.
- **`Explore` agent** for wide searches across the codebase, so your context stays focused.

If a skill isn't available, do the same step manually and say so.

## The project

You are working on **Mandoob**, at:
`C:\Users\Mina diaa\Desktop\مندوب\tayson-logistics`

Mandoob is a multi-company (SaaS) admin system for delivery operators that run riders on HungerStation and similar platforms. It has an admin panel at `/admin`, a rider portal at `/rider` and a public site at `/`.
Stack: Node 24 + Express + MySQL 8 / MariaDB in `server/`, React + Vite + Tailwind in `web/`, translations in `shared/i18n/` for 4 languages (ar, en, bn, ur), with RTL.

## This is a SaaS product — keep that in mind in every change

Mandoob is **not** a system for one company. It is a SaaS platform, like LogisTap:
- **The platform owner** (us) runs the system, sets plans and prices, approves payments, and manages every company from the owner panel (`Platform.tsx`).
- **Many delivery companies** sign up on their own, each gets a trial, then subscribes to a plan and pays monthly or annually.
- **Each company is fully isolated.** It only ever sees its own riders, vehicles, finance and settings (`tenant_id` on every table, enforced in `tenancy.ts`). One company must never see or affect another.
- **Every feature is controlled by the plan.** It counts against a quota (riders, vehicles, users, branches, platforms, contracts, designations, invoices…) and may be locked to higher plans. So every new module needs its quota and its gating decided up front.
- Settings that belong to the whole platform (plans, prices, tax, maintenance mode) live with the platform owner. Settings that belong to one company (branches, designations, targets, salary rules, alerts) live inside that company.

When you design each phase, state for every new table and screen whether it belongs to the **platform** or to a **company**, which **quota** it uses, and which **plans** it is available on.

## Goal

Bring Mandoob up to the features and business logic of a competing product, **LogisTap**.

**Your main job is to build every missing feature listed in `LOGISTAP-MISSING.md`** (all of the "❌" items and the "🟡" items that are only partly done), following the build order below. The architecture fixes in phase 0 are only there to prepare a solid base for these features. They are not a replacement for them. You are done only when every item in that file is built, tested and working. Every LogisTap page was checked on 2026-11-06 and compared against Mandoob's code. The results are in three files at the project root. Read them first, together with `README.md`:
- `LOGISTAP-MISSING.md`: what Mandoob lacks, in priority order (Arabic).
- `LOGISTAP-FEATURES.md`: every LogisTap screen, its fields and its flows (Arabic).
- This file.

Do not open or log into logistap.com. Everything you need is in these files.

## What Mandoob already has (don't rebuild it)

- Companies (`tenants`), sign-up (`Signup.tsx`) and a platform-owner panel (`Platform.tsx`).
- Plans with rider, user and vehicle limits, enforced in `server/src/routes/saas.ts` (HTTP 402 `plan_limit_reached`). Per-company add-ons (`extra_riders`, `extra_users`, `extra_vehicles`), monthly or annual billing, and payment by uploaded transfer receipt that the platform owner approves.
- A 14-day trial on Starter. When it ends, the company becomes **read-only**.
- Riders, rider documents (iqama, license, health, driver card, Ajeer permit), applicants, leaves, absences, advances and installments, fines, wallet, monthly rider billing import, vehicles, oil changes, vehicle assignments, operation cards, insurance, daily performance, ratings, HungerStation live board, rider portal with requests and issues, expiry alerts, roles and permissions, sessions and "my devices", dark mode, backups, email templates, languages.
- A document-scan screen in `scans.ts`. It always answers `unavailable`, so there is no real OCR yet.

## How LogisTap works (functional reference)

This describes LogisTap's features and rules as a user sees them, from our own account. Use it only as a functional reference. Write our own design and code, and never copy their code, text, branding or assets.

### Plans and subscription

| Plan | Admin users | Employees | Vehicles | Notes |
|---|---|---|---|---|
| Free | owner only | 10 | — | no end date |
| Starter | 2 | 50 | 60 | |
| Growth | 5 | 100 | 120 | |
| Scale | 8 | 200 | 240 | |
| Extended Scale | extra capacity added on top of Scale | | | |
| Premium | extra features | | | |

- **More quotas per plan:** branches, platforms, contracts, custom designations, invoice buyers, open invoice drafts, invoices per month. The UI shows usage as counters everywhere, for example "Employees 37/50", "Branches 1/2", "Designations 0/2 custom", "1 platform / 3 · 1 contract / 6".
- **Features locked by plan:** HungerStation Live for more than one city, the Android companion app, rider details in Live, and ZATCA Phase 2 integration.
- **Billing:** monthly, or annual at 15% off. Payment is either a checkout page or an uploaded transfer receipt plus a notification, which sets the status to "payment under review". Support runs over WhatsApp, and there is a "Contact sales" button for custom plans.
- **Changing plans:** upgrades apply immediately and downgrades apply at renewal. If the company's data exceeds the new plan's limits, the change is refused and the screen lists what is over the limit.
- **When a plan ends:** the company falls back to **Free** and nothing is deleted. Records above the Free limits show "data access paused" until the company upgrades.
- **Device limit:** each account may sign in from a fixed number of devices (2/2 was seen), and devices can be removed from "My devices".

**Differences to fix in Mandoob:** there is no Free plan, and expiry makes the company read-only instead of falling back to Free. There are no quotas besides riders, users and vehicles, no feature gating, no downgrade-at-renewal or over-limit check, no 15% annual rule, and no device limit.

### Dashboard

- **Company health %** ("Good Standing") is computed from rules: missing or expired documents, risk scores, and how complete the profile is.
- **Company profile %** is weighted: identity 15, legal data 30, contact 15, bank 15, documents 25.
- **Cards:** active admin users, days left in the subscription, branches, designations.
- **Employees section:** Working / Ready / Waiting / On leave. Also riders missing required files, expiring soon, expired, a **risk score**, and the nearest expiry dates.
- **Vehicles section:** Working / Servicing / Reserved / Unavailable. Also invalid authorization, expiring soon, expired, risk, and **"Oil change due: last oil change over 20 days ago"**.
- **Finance section:** company balance (cash and bank accounts), monthly net cash flow (income minus expense), overdue payments, pending employee transactions, upcoming payments, and an "action required" list.

### Employees

- Status: Working, Waiting, Ready, On leave (leave shows the days remaining).
- Every employee has a **designation** and a **branch**. Driver and Supervisor are built in, and custom designations count against the plan.
- The profile includes visa and sponsor (kafeel), **several bank accounts** (bank and IBAN), attachments, transactions, history, and a button to go to the next employee.
- **Rider papers** are a matrix of Selfie, Iqama, License, Passport, Medical, Driver card, Ajeer contract and Other, plus a "Missing" count. Rows are sorted from most missing to least.
- **Recruitment** is a pipeline: New → Contacted → Interview → Documents → Ready, with name, phone, source, stage and notes.
- **Exited employees** have an exit date, a transactions status (clear / in debt / settled) with a free-text note, and their own detail page. They are still included in the data exports.

### Vehicles

- Status: Working, Reserved, Servicing, Unavailable. Each vehicle has an authorized driver and the authorization expiry, the actual driver, and a branch. Quick actions: Assign driver, Remove driver, Complete servicing, History.
- **Vehicle papers** are a matrix of Vehicle picture, Istemara, **Key handover**, Operation card and Note, plus a "Missing" count.
- **Servicing:** schedule a service, pick its type (for example accident repair), add details, then move it from In progress to Complete with a completion date. It has **Payment** (records the cost in finance), Edit and Cancel.
- **Accidents:** severity (minor / moderate / severe), the authority (Najm or Murur), date and time, details, location and papers. The stages are Pending Najm/Murur report → Pending Taqdeer (assessment) → Pending insurance claim → Completed.

### Rider accounts (platform IDs)

- Each platform ID has an **Owner** and a **Worker**, the rider actually working on it, who may differ from the owner ("Self" when they are the same). It also has a platform, a contract and a status (Active / Pending / Blocked / Expired).
- An ID can be **transferred** to another rider, and the transfer is recorded in a history.
- The monthly report flags **Shared IDs**: one ID worked by more than one rider.

### Progress reports

- **Daily report:** pick the platform, branch and date (previous / next day), then import. There is a **Set target** (default 15 orders, 8 duty hours, 2 declined at most). Columns are orders, declined, duty time, remarks and month total, with Save, Clear and **Screenshot**.
- **Import templates** are saved while you import a report, so the next import reuses them.
- **Monthly report:** month, year, platform and branch. Columns are total orders, average duty time, report days and rank, with Shared IDs, Print and Download.
- **Riders quality report:** upload a "Delivery Quality Segment" file (CSV or Excel), then download or clear it.

### Finance

- **Company finance** opens with a 3-step setup: add an account (cash box or bank, with an opening balance), add categories (fuel, salary, rent… which you can rename or switch off), and record the first transaction. After that come money in and out, **assets**, **stock** (in and out), **liabilities** (one-off bills, plus monthly rents and installments), suppliers, and history.
- **Employee finance:** amount due, amount paid and net balance per employee, with categories (for example an insurance share or payroll) and paid history.
- **Invoice maker:** tax invoices between companies (seller and buyer). Each invoice is **created against a platform contract**. It integrates with **ZATCA Phase 2** and has a sandbox mode.
- **Salary systems:** salary rules per branch, salary periods, and a final salary sheet you can print.
- **Paid history:** finalized salary sheets with signed proof of payment. Incomplete finalized sheets can be reopened, and completed ones stay in history.
- **Rider settlement manifest.**

### Other tools

- **Rider list print** and **vehicle list print:** a form title and subject, then you choose the columns (branch, status, nickname, full name in English and Arabic, phone, iqama and its expiry, ID, vehicle, IBAN, health insurance… and for vehicles: type, brand, model, year, color, sequence number, authorization, chassis, inspection, insurance, road permit, odometer, fuel allowance). You can add empty info or value columns (for example Amount or Fingerprint), delete rows, import, print, and download Excel.
- **Database management:** one Excel template per section (employees 28 columns, vehicles 33, platform IDs 10, transactions 9). Download it, edit it, validate it, then update only that section. Each section shows its record count and last update time.
- **Bookmarks:** "My bookmarks" (private) and "Community links".
- **ID card maker:** a Starter template and a HungerStation template, with bulk creation.

### HungerStation Live

- Two sources: **Partner Center** (the new dashboard) and **Rooster** (the previous one), plus "Connect Android app". Some parts are locked by plan.

### Settings sections

- **Company:** names, logo, City CR number and expiry, VAT number and certificate expiry, GOSI, Qiwa, Labor Office, national address, contact, bank details, company documents.
- **My preferences:** language, dark mode, sign out of other devices.
- **Alerts:** which documents send expiry alerts, plus finance alerts.
- **Operations:** branches (a branch used by an employee or a salary rule cannot be removed), designations, platforms and contracts, daily report targets, salary systems, import templates.
- **Finance:** accounts and opening balances, invoice maker, ZATCA.
- **Team & access:** staff get per-section view / edit / delete permissions and sign in on a separate staff domain. **Rider access** is switched on or off for the whole company, uses one fixed company link, and lets riders sign in with their **iqama number and a PIN**. A WhatsApp button sends a rider their login details. It is available to working employees only.
- **Plan & billing**, and **Data** (Excel export and import of everything, and a request to close the company).

## Build order (one phase at a time)

0. **Architecture audit and fixes** (see "Fix the existing architecture where it's broken" above).
1. **Plans alignment:** Free plan and fall-back to Free on expiry, the extra quotas, feature gating, downgrade rules, the annual discount and the device limit, plus usage counters in the UI.
2. **Branches and designations,** linked to employees and vehicles, with branch filters in lists and reports.
3. **Rider accounts:** owner, worker, status, transfer history, shared IDs.
4. **Vehicles:** accidents, full servicing log with payment, vehicle papers matrix with key handover.
5. **Employees:** bank accounts, visa and sponsor, recruitment pipeline, exited employees, missing-documents column.
6. **Finance:** accounts, categories, suppliers, liabilities, assets, stock, salary systems, paid history, settlement manifest.
7. **Tax invoices and ZATCA Phase 2** (sandbox only).
8. **The rest:** company health and risk scores, the dashboard finance section, column-picker prints, ID card maker, daily targets and the screenshot, quality report, bookmarks, Partner Center / Rooster sources, and a real OCR engine in `scans.ts`.

## Rules

- Read the existing code before writing any, and follow its patterns:
  - `server/src/schema.sql`: every statement must be idempotent.
  - `tenancy.ts`: every new table has `tenant_id` and every query is scoped to the company.
  - `perms.ts`: permissions for every new module.
  - `audit.ts`: log every change.
  - `server/src/routes/`, `web/src/pages/` and `web/src/ui/`.
  - `shared/i18n/`: add every new string to all 4 languages.
- Keep existing data intact. New columns must be nullable or have defaults.
- Add tests like the existing `*.test.ts` and keep all tests passing.
- Don't commit or push unless I ask.
- Start with **phase 0**: the architecture audit report, then wait for my approval before fixing anything. After phase 0, continue phase by phase. For each phase, first tell me exactly what you'll change (tables, routes, screens, permissions, migrations of current tenants) and wait for my approval before writing code. After each phase, summarize what was done and what is left, and wait for approval before starting the next.
