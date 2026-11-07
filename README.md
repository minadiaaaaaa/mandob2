# مندوب (Mandoob)

A rebuild of the system described in `Logistics-Services-User-Guide.pdf`: an admin system for delivery
operators that run riders on HungerStation and similar apps. It has an admin panel (`/admin`), a rider portal
(`/rider`) and a public site (`/`). Screens, fields, rules and wording follow the guide.

Stack: Node 24 + Express + MySQL 8 / MariaDB 10.6+ (server), React + Vite + Tailwind (web), 4 languages (ar, en, bn, ur) with RTL.

## Requirements

| Tool | Version | Note |
|---|---|---|
| Node.js | 24 or newer | the server runs TypeScript directly through `tsx` |
| pnpm | 9 or newer | `npm install -g pnpm` |
| MySQL or MariaDB | MySQL 8 / MariaDB 10.6 or newer | any host; on Hostinger use hPanel › Databases, and open it with phpMyAdmin |
| Git | any | to clone the repository |

## Run it locally (development)

**1. Get the code and the dependencies**

```bash
git clone https://github.com/Fadysamy9/mandoob.git
cd mandoob
pnpm setup                 # installs server/ and web/ dependencies
```

**2. Create a MySQL database**

Create an empty database with `utf8mb4` (for example `mandoob`) and a user with full rights on it. Locally that can be XAMPP/Laragon/MySQL; on
Hostinger use *hPanel › Databases › MySQL Databases*. The server creates the 67 tables from `server/src/schema.sql` when it starts; every
statement is idempotent, so an existing installation is kept as it is.

**3. Settings file**

```bash
cp .env.example .env       # Windows PowerShell: Copy-Item .env.example .env
```

Fill in `.env`:

| Key | Meaning | Default |
|---|---|---|
| `DATABASE_URL` | `mysql://user:password@host:3306/database`; percent-encode password characters. Or use `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | the wizard's `server/data/config.json` |
| `DB_SSL` / `DB_SSL_CA_FILE` | `1` and an optional CA file for a remote server that requires TLS | off |
| `DB_POOL_SIZE` | maximum server database connections | `10` |
| `HOST` | listening address; set deliberately for remote deployment | `127.0.0.1` |
| `PORT` | API port | `4000` |
| `TRUST_PROXY` | the proxies in front of the server: the number of hops (`1` for one Nginx) or their addresses/subnets separated by commas, so limits and lockouts see the real client IP. Never trust every hop | `0` |
| `APP_KEY` | optional base64 32-byte key that encrypts secrets and backups; without it, `server/data/app.key` is generated | — |

`.env` is in `.gitignore`. Never commit it or send database credentials to the frontend. The wizard uses the configured server connection. Without `DATABASE_URL` / `DB_*`, the wizard saves the connection it tested in `server/data/config.json`.

**4. Start**

```bash
pnpm dev                   # API on http://localhost:4000, web on http://localhost:5173 (proxies /api)
```

**5. First start (no setup screens)**

At start the server creates or completes the tables, the settings, the five built-in roles, the plans and the Saudi cities.
The first time, it also creates the platform owner's account from `OWNER_EMAIL` / `OWNER_PASSWORD` / `OWNER_NAME`
(username: the part of the email before `@`). Without `OWNER_PASSWORD` a random password is written to
`server/data/first-login.txt`; change it from the profile and delete the file. The organisation details, logos and SMTP
are set later from *System › Settings* and *System › Email templates*.

**6. Sign in**

| Address | Who | How |
|---|---|---|
| http://localhost:5173/admin/login | office staff | username or email, password, and the 6-character code shown on the screen |
| http://localhost:5173/rider/login | riders | the rider ID and the initial password set by office staff |
| http://localhost:5173/ | anyone | public website |

Office staff must set the initial portal password in the rider file before the rider can sign in. ID-only login is blocked. Riders can verify their email and change their password in *Security*. Email verification and password-reset codes require **SMTP to be configured**.

## Run it in production

```bash
pnpm build                 # builds web/dist
pnpm start                 # one port (PORT, default 4000) serves the API and the built site
```

- Put it behind Nginx or a similar proxy with HTTPS, and set `TRUST_PROXY=1`. Session cookies are marked `Secure`
  automatically on HTTPS.
- Keep it running with a service manager, for example `pm2 start "pnpm start" --name lsp` or a systemd unit.
- **Back up `server/data/` together with the database.** It holds the uploaded files (`storage/`), the
  encryption key (`app.key`) and `config.json`. Backups made in *System › Backups* are encrypted with that key:
  without it they cannot be restored.
- Scheduled jobs (expiry alerts, emails, backups, log cleanup, sync) run inside the API process, using the
  organization's timezone. Only one API instance should run.

## HungerStation browser extension (optional)

Daily performance, ratings, branding photos and the live board can be read from the HungerStation pages:

1. In the admin panel, open *Performance › Sync* and create the extension token. It is shown once, so copy it.
2. In Chrome, open `chrome://extensions`, turn on *Developer mode*, choose *Load unpacked* and select `server/extension`.
3. In the extension popup, enter the system address (for example `https://your-domain`) and the token, then save.
4. Open the report page in HungerStation, choose the report type and the day in the popup, and click send.

## Checks

```bash
pnpm typecheck                                      # server and web type checks
node server/test/smoke.mjs http://localhost:4100    # end-to-end test
```

Run the smoke test on a **fresh** install whose Super Admin is `admin@example.com` / `Admin12345!` (username
`admin`). It walks every chapter end to end:
- sign-in with the on-screen code; riders and documents; fleet;
- leaves, advances and conversations; finance imports; reports and notifications;
- performance and sync; email, jobs, backups and restore; languages;
- the rider portal: sign-in, update requests, leaves, conversations, email codes, password reset;
- the role protections.

It changes data, so never run it against a live database.

## SaaS: many companies on one installation

- **Sign-up:** `/signup` opens a company account with a 14-day free trial on the Starter plan. Everyone signs in on the same
  `/admin/login`; usernames and emails are unique on the platform, so the account names its company.
- **Isolation:** every company-owned table has `tenant_id`. `server/src/tenancy.ts` rewrites each query before it is sent
  (company-filtered sources, `tenant_id` added to inserts, conditions added to updates and deletes); a query on company data without a
  company is refused. `server/test/tenant-isolation.mjs` signs up two companies and checks that one never sees or changes the other's data.
- **Plans:** Starter, Growth, Scale (LogisTap's tiers). Prices, limits (riders, vehicles, staff accounts) and which plans are on sale are
  edited in *Platform › Plans & prices*; an empty limit is unlimited. A new rider, vehicle or account beyond the limit is refused from any
  screen, import or sync.
- **Payments:** a company chooses a plan in *System › Plan & billing*, transfers to the bank account set in the owner dashboard and sends the
  reference and receipt. The platform owner approves it in *Platform › Payments*: the plan starts and runs a month or a year after the
  current end. When a trial or period ends the company can still read and export, but changes are paused until it renews.
- **Platform owner:** the account created at the first start from `OWNER_EMAIL` (company 0). Only it sees *Platform*, backups, blocked networks and languages.
- **Known limit:** a rider ID (the delivery app's ID) is unique on the whole platform, so the same rider cannot be registered in two companies at once.

## The database

- `server/src/schema.sql` is the baseline MySQL structure every install starts from (`CREATE TABLE IF NOT EXISTS`). Every change after it is a numbered step in `server/src/migrations.ts`, recorded in `schema_migrations` and applied once per database at start (it checks `information_schema` first, so a half-applied step can run again). Never edit an existing step; add the next number, with new columns nullable or defaulted. `database/schema.sql` is the baseline as a single file for phpMyAdmin › Import; the server still applies the migrations on its next start.
- `server/src/sql.ts` expands `?` placeholders (objects after `SET`, lists, `VALUES` rows) and escapes every value with the MySQL driver.
- Connections run in UTC with `ANSI_QUOTES` and strict mode. JSON columns read the same on MySQL 8 and on MariaDB, where JSON is stored as text.
- Express enforces the staff/rider session permissions on every route.
- Backups restore inside one transaction, parents before children; MySQL moves `AUTO_INCREMENT` past the restored ids. Uploaded files and encryption keys remain in `server/data/`; keep that directory with your database backup.
- Business rules (statuses, each document's alert period) live once in `server/src/domain/rules.ts`; screens read them from `GET /meta/rules`. Plan limits go through `server/src/domain/quotas.ts` (`ensureQuota` on every add and every switch back on, under a lock per company); a company's standing (trial, active, ended, suspended) is `server/src/domain/subscription.ts`.
- Plans (phase 1) are declared once in `server/src/domain/plans.ts`: the quotas (riders, vehicles, staff accounts, delivery platforms, contracts; branches, designations and invoice limits are stored for the phases that add their screens), the device limit per account, the features a plan can include, the Free plan and the annual discount (an empty annual price is 12 months less `platform.annual_discount`, 15% by default). When a trial or paid period ends the company falls back to Free (nothing deleted); records above the limits are "paused" (`pausedGate`): the oldest stay open, the rest open again after an upgrade. A smaller plan approved during a paid period starts when that period ends. Test: `server/test/plans.mjs`.

For the destructive smoke test, point `DATABASE_URL` at a throwaway database (for example `mysql://root:pw@127.0.0.1:3306/mandoob_test`), with a separate `APP_DATA_DIR`, `PORT=4100` and `DISABLE_SCHEDULER=1`, `OWNER_EMAIL=admin@example.com` and `OWNER_PASSWORD=Admin12345!`, then `node server/test/smoke.mjs http://localhost:4100`. Never point the smoke test at live operational data.

Main groups of tables:

| Group | Tables |
|---|---|
| Access | `users`, `roles`, `role_permissions`, `sessions`, `login_challenges`, `login_attempts`, `blocked_ips`, `audit_log` |
| Riders | `riders`, `rider_documents`, `applicants`, `leaves`, `rider_absences`, `advances`, `advance_installments`, `rider_change_requests`, `rider_issues`, `rider_issue_messages` |
| Fleet | `vehicles`, `operation_cards`, `operation_card_vehicles`, `vehicle_registrations`, `transport_licenses`, `insurance_companies`, `insurance_policies`, `vehicle_insurance`, `vehicle_assignments`, `fuel_cards`, `oil_schedules`, `oil_changes`, `renewals` |
| Performance & finance | `daily_performance`, `branding_photos`, `monthly_ratings`, `rating_cutoffs`, `sync_sources`, `sync_runs`, `live_board`, `live_points`, `live_days`, `fines`, `wallet_snapshots`, `wallet_entries`, `billing` |
| Rider portal | `rider_accounts`, `rider_sessions`, `rider_login_attempts`, `rider_codes` |
| System | `settings`, `secrets`, `attachments`, `notifications`, `notification_prefs`, `email_templates`, `email_log`, `error_log`, `cron_runs`, `backups`, `restores`, `languages`, `translation_overrides`, `cities`, `companies`, `contracts` |

## Project layout

```
server/src/          API (Express 5): index.ts, auth.ts, schema.sql, seed.ts, routes/ (one file per area)
server/extension/    Chrome extension for the HungerStation reports
server/test/         smoke.mjs end-to-end test
web/src/             React app: pages/ (admin screens), pages/portal/ (rider portal), ui/ (shared components)
shared/i18n/         ar, en, bn, ur translations used by both server and web
database/            schema.sql, the full database structure
```

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| The server stops with "No database" | `DATABASE_URL` (or `DB_*`) is missing from `.env`. |
| `ER_ACCESS_DENIED_ERROR` at start | Wrong user or password in `DATABASE_URL` / `DB_USER` / `DB_PASSWORD`. |
| Port 4000 or 5173 is busy | Change `PORT` in `.env`. For the web dev server, set `API_PORT` to the same value. |
| Riders get "Email service unavailable" | SMTP is not set up or not enabled: *System › Email templates › SMTP settings*. |
| "Too many attempts" for many riders | The portal allows 10 failures in 15 minutes per network. Wait 15 minutes. |
| A restored backup will not open | It was made with a different `server/data/app.key` / `APP_KEY`. |

## What is built

| Guide chapter | Status |
|---|---|
| 1 General interface: sign-in with verification code, sidebar with expiry badges, tables, import wizard, attachments, permissions | ✅ |
| 2 Riders: list, add/edit with 5 documents, profile, bulk edit, import, applicants (hire / link), 5 document follow-up screens | ✅ |
| 3 Leaves and request letters, absences, advances and instalments, change requests, rider conversations (files and voice), live riders and live report | ✅ |
| 4 Fleet: vehicles, operation cards, vehicle registrations, insurance companies, policies and covers, assignments, fuel cards, oil changes | ✅ |
| 5 Expiry alerts, renewal log, transport licences | ✅ |
| 6 Daily performance, scorecard, branding verification, monthly ratings, HungerStation sync | ✅ |
| 7 Delivery companies and contracts | ✅ |
| 8 Fines, wallet, monthly billing, the rider's financial summary | ✅ |
| 9 Dashboard, reports, notifications and notification preferences | ✅ |
| 10 Administration: users, roles and permission matrix, active sessions, blocked IPs, profile, lockout and IP blocking | ✅ |
| 11 Settings, attachments, activity log, login attempts, automatic first start, email templates and SMTP, email log, system errors, scheduled jobs, backups with restore, languages editor | ✅ |
| 12 Rider portal (sign-in by rider ID, overview, profile, attendance photos, performance, ratings, update requests, leaves, conversations, security, help), the office's portal account card, public website | ✅ |

## Known limits

Each one has a `ponytail:` note in the code where it applies.

- **Document reading (OCR).** Scans upload and attach, but the reader answers "unavailable", so fields are typed by
  hand, which is the guide's own fallback.
- **HungerStation sync.** There is no browser on the server, so a server-side run records "needs sign-in". Reports arrive
  through the browser extension in `server/extension` (a token-protected ingest address).
- **Branding photo checks.** There is no image model, so photos stay "Being checked" until staff review them.
- **Conversations** refresh every few seconds instead of a live socket; there is no "typing…" indicator.
- **Leave letters** print to PDF from the browser; the Word download is the same letter saved as `.doc`.
- **Rider portal days.** With no work schedule, a day without an imported report and without a recorded absence counts
  as a day off rather than "Absent".
- **Languages.** Arabic and English cover everything. Bengali and Urdu cover the core interface and the whole rider
  portal; other admin screens fall back to English, as the guide describes.
- **12.16 rider guides.** Only the Arabic PDF (`rider-portal-guide-ar.pdf`) is in the repository.

Generated QA reports are saved in `.qa-reports/` and ignored by Git. The full test plan is `TEST-PLAN.md`; run it with `server/test/qa-run-mysql.ps1` (set `QA_DATABASE_URL` to a throwaway `mandoob_test…` database and `QA_BROWSER_PATH` to Chrome or Edge).
