# مندوب (Mandoob)

A rebuild of the system described in `Logistics-Services-User-Guide.pdf`: an admin system for delivery
operators that run riders on HungerStation and similar apps. It has an admin panel (`/admin`), a rider portal
(`/rider`) and a public site (`/`). Screens, fields, rules and wording follow the guide.

Stack: Node 24 + Express + PostgreSQL on Supabase (server), React + Vite + Tailwind (web), 4 languages (ar, en, bn, ur) with RTL.

## Requirements

| Tool | Version | Note |
|---|---|---|
| Node.js | 24 or newer | the server runs TypeScript directly through `tsx` |
| pnpm | 9 or newer | `npm install -g pnpm` |
| PostgreSQL | Supabase project | connect through the session pooler with TLS |
| Git | any | to clone the repository |

## Run it locally (development)

**1. Get the code and the dependencies**

```bash
git clone https://github.com/Fadysamy9/mandoob.git
cd mandoob
pnpm setup                 # installs server/ and web/ dependencies
```

**2. Create a Supabase project**

Use Connect → Session pooler for an IPv4-compatible connection. The setup wizard creates the tables in an empty destination; an existing initialized schema is preserved. The PostgreSQL schema and defaults are in `database/supabase/`.

**3. Settings file**

```bash
cp .env.example .env       # Windows PowerShell: Copy-Item .env.example .env
```

Fill in `.env`:

| Key | Meaning | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL session pooler URL; percent-encode password characters | required |
| `DATABASE_APP_URL` | restricted runtime connection provisioned by `server/test/provision-runtime.ts`; required for RLS | required |
| `DB_SSL_CA_FILE` | Supabase CA certificate, relative to `server/` | `../database/supabase/prod-ca-2021.crt` |
| `DB_POOL_SIZE` | maximum server database connections | `5` |
| `HOST` | listening address; set deliberately for remote deployment | `127.0.0.1` |
| `PORT` | API port | `4000` |
| `TRUST_PROXY` | `1` behind Nginx or a load balancer, so lockouts see the real client IP | `0` |
| `APP_KEY` | optional base64 32-byte key that encrypts secrets and backups; without it, `server/data/app.key` is generated | — |

`.env` is in `.gitignore`. Never commit it or send database credentials to the frontend. The wizard uses the configured server connection. An alternative PostgreSQL connection can be saved locally if `DATABASE_URL` is absent.

**4. Start**

```bash
pnpm dev                   # API on http://localhost:4000, web on http://localhost:5173 (proxies /api)
```

**5. Setup wizard (first run only)**

Open http://localhost:5173/setup and go through the six steps:

1. **Database:** test the connection and save it.
2. **Tables & Data:** creates the 64 tables, default settings, the five built-in roles and the Saudi cities.
3. **Platform Info:** organization name in Arabic and English, logos, registration documents.
4. **Admin Account:** the first Super Admin (name, email, password). The username is the part of the email before `@`.
5. **Email (SMTP):** optional here; it can also be set later from *System › Email templates › SMTP settings*.
6. **Complete:** the wizard closes for good. Every visit to `/setup` after this is refused.

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

## The database

- `database/supabase/schema.sql` is the PostgreSQL structure (64 tables). The installer applies it only to an empty destination. Future schema changes require reviewed PostgreSQL migrations.
- `database/supabase/seed.sql` contains repository defaults; it creates no accounts or operational data.
- `server/src/sql.ts` binds query parameters and translates legacy application query templates to PostgreSQL. `mysql2` is no longer a runtime dependency.
- The former MySQL schema files remain as migration references only; the application does not execute them.
- Express enforces the existing staff/rider session permissions. Browser Data API access to application tables is closed with RLS and revoked grants; this application does not use Supabase Auth.
- Backups restore inside a PostgreSQL transaction, respecting foreign-key order and repairing identity sequences. Uploaded files and encryption keys remain in `server/data/`; keep that directory with your database backup.

For the destructive smoke test, use `server/test/prepare-postgres.ts` with an isolated `DB_SCHEMA=mandoob_test_*`, a separate `APP_DATA_DIR`, `PORT=4100` and `DISABLE_SCHEDULER=1`. The preparation script refuses the public schema. Never point the smoke test at live operational data.

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
| Every page goes to `/setup` | The wizard has not finished, or `.env` / `server/data/config.json` points to another database. |
| `ER_ACCESS_DENIED_ERROR` at start | Wrong `DB_USER` / `DB_PASSWORD` in `.env`. |
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
| 11 Settings, attachments, activity log, login attempts, setup wizard, email templates and SMTP, email log, system errors, scheduled jobs, backups with restore, languages editor | ✅ |
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

Generated QA reports are saved in `.qa-reports/` and ignored by Git. The historical coverage summary is in `database/supabase/FULL-QA.md`; use `server/test/qa-run.ps1` for the isolated full suite.
