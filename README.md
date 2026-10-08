# Logistics Services Platform

A rebuild of the system described in `Logistics-Services-User-Guide.pdf`: an admin system for delivery
operators that run riders on HungerStation and similar apps. It has an admin panel (`/admin`), a rider portal
(`/rider`) and a public site (`/`). Screens, fields, rules and wording follow the guide.

Stack: Node 24 + Express + MySQL 8 (server), React + Vite + Tailwind (web), 4 languages (ar, en, bn, ur) with RTL.

## Run it

```bash
pnpm setup                 # installs server/ and web/ dependencies
cp .env.example .env       # fill DB_USER / DB_PASSWORD / DB_NAME (or let the wizard ask)
pnpm dev                   # API on :4000, web on :5173 (proxies /api)
```

Open http://localhost:5173/setup. The six-step **Platform Setup Wizard** creates the database, tables, the five
built-in roles and default settings, the organization details and the first Super Admin. Then sign in at `/admin/login`.

Production: `pnpm build && pnpm start`. The API serves `web/dist` on the same port.

Check: `pnpm smoke`. Run it against a **fresh** install (admin / Admin12345!). It walks every chapter end to end:
sign-in with the on-screen code, riders and documents, fleet, leaves, advances, conversations, finance imports,
reports and notifications, performance and sync, email, jobs, backups and restore, languages, the rider portal
(sign-in, update requests, leaves, conversations, email codes, password reset), and the role protections.

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
