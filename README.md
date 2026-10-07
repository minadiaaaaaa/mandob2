# Logistics Services Platform

A rebuild of the system described in `Logistics-Services-User-Guide.pdf`: an admin system for delivery
operators that run riders on HungerStation and similar apps. It has an admin panel (`/admin`), a rider portal
(`/rider`, later phase) and a public site (`/`). Screens, fields, rules and wording follow the guide.

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

Check: `pnpm smoke`. Run it against a **fresh** install (admin / Admin12345!). It walks through sign-in with the
on-screen code, riders and their documents, fleet, insurance, assignments, oil changes, applicants, import and
export, and the role protections.

## What is built (phase 1)

| Guide chapter | Status |
|---|---|
| 1 General interface: sign-in with verification code, sidebar with expiry badges, tables, import wizard, attachments, permissions | ✅ |
| 2 Riders: list, add/edit with 5 documents, profile, bulk edit, import, applicants (hire / link), 5 document follow-up screens | ✅ |
| 4 Fleet: vehicles, operation cards, vehicle registrations, insurance companies, policies and covers, assignments, fuel cards, oil changes | ✅ |
| 5.3 Transport licences | ✅ |
| 7 Delivery companies and contracts | ✅ |
| 10 Administration: users, roles and permission matrix, active sessions, blocked IPs, profile, lockout and IP blocking | ✅ |
| 11 Settings (organization, platform, system keys, private keys), attachments, activity log, login attempts, setup wizard | ✅ |
| 12.15 Public website | ✅ |

## Not yet built (next phases)

- **Ch. 3** Leaves and letters, absences, advances and instalments, change requests, rider issues (live chat and voice), live riders and live report.
- **Ch. 5.1–5.2** Expiry alerts screen and the renewal log screen. Renewals are already *recorded* by the fleet renew actions.
- **Ch. 6** Daily performance, scorecard, branding verification, monthly ratings, HungerStation sync (server Chrome + browser extension).
- **Ch. 8** Fines, wallet, monthly billing. **Ch. 9** Dashboard charts, reports, notifications.
- **Ch. 11** Email templates and SMTP sending, email log, system errors, scheduled jobs, backups, languages editor.
- **Ch. 12** Rider portal.
- **Document reading (OCR).** Scans upload and attach, but the reader answers "unavailable", so fields are typed by hand,
  which is the guide's own fallback.
- Bengali and Urdu cover the core interface only; untranslated phrases fall back to English, as the guide describes.
