# Mandoob: security review

Date: 2026-11-07. Scope and rules: `SECURITY-REVIEW-PROMPT.md`. No code was changed for this review.

## How it was done

- **Code reading** of the server (`server/src`, about 10,000 lines), the web app (`web/src`) and the shared translations. Priority order: tenant isolation, authentication, authorization, SaaS billing, injection, XSS, files, CSRF/CORS, secrets, abuse limits, deployment, dependencies.
- **Confirmation on a disposable local install**: http://127.0.0.1:4100, database `mandoob_test_quick` on the local test MariaDB. Companies, users and data were created through sign-up, then deleted with the database. I used this instead of the `pnpm dev` copy on :4000 so your own dev database was never touched. No production URL, third-party site or real data was used, and nothing was load-tested.
- **Tools:**
  - `pnpm audit --prod` in `server/` and `web/`.
  - Semgrep 1.184.0 **could not run** on this Windows install. `semgrep-core` fails with "Failed to obtain target files", even on an ASCII-path copy of the code. The static pass was done by hand instead, with small scripts that list SQL strings with interpolated values, tables with `tenant_id` that are not scoped, and GET routes that write.
  - The project's own tests were also run: route guard, permission matrix, tenant isolation.
- **Not covered:** denial of service (only judged from advisories and code), deployed configs (`deploy/`, `vercel.json` and `wrangler.jsonc` were removed in phase 0, so they are no longer in the repo), dev-only dependencies.

## Findings (most severe first)

| # | Severity | Title |
|---|---|---|
| 1 | **High** | Stored XSS in the email template preview lets a Fleet Manager act as the company Admin |
| 2 | **Medium** | `TRUST_PROXY=1` trusts every forwarded address: IP limits and blocks can be bypassed |
| 3 | **Medium** | No security headers (CSP, clickjacking protection, HSTS…) |
| 4 | **Medium** | Reachable denial-of-service advisory in `body-parser` (via Express 5) |
| 5 | Low | CSV exports keep spreadsheet formulas (formula injection) |
| 6 | Low | `nodemailer` address-parser advisories |
| 7 | Low | The on-screen sign-in code is readable by scripts (not an anti-automation control) |
| 8 | Low | Sign-up limit is kept in memory, per process |
| 9 | Low | Upload type is taken from the browser's declared type; the scan preview lacks `nosniff` |
| 10 | Low | Restore accepts unencrypted archives |
| 11 | Info | `first-login.txt` keeps the owner's generated password until deleted by hand |

---

### 1. High: stored XSS in the email template preview, privilege escalation inside a company

**Location**
- `web/src/pages/system/Email.tsx:106` and `:218`: `<iframe srcDoc={preview.html}>` / `srcDoc={html}` with **no `sandbox` attribute**.
- `server/src/routes/email.ts:31` (PATCH template) stores `body_html` as written. `:59-63` (preview) and `:125-129` (branding preview) return it inside the frame unchanged.
- `server/src/perms.ts:111`: the built-in **Fleet Manager** role gets `email_templates.update`, but no user or role management.

**What an attacker could do.** A staff member with a role that can edit templates (Fleet Manager by default) saves a template that contains a `<script>` or an `onerror=` handler. An `iframe srcDoc` without `sandbox` runs on the app's own origin. When the Admin (or anyone else) opens that template's preview, the script runs with their session cookie. It can call any API the Admin can: create a new Admin account, change roles, export riders, change SMTP settings. The same applies to the branding preview.

**Steps to reproduce (localhost)**
1. Sign up a company, and as its Admin create a user with the built-in Fleet Manager role.
2. Sign in as the Fleet Manager and run `PATCH /api/email/templates/expiry.driver_card` with
   `{"body_html":"<p>hi</p><script>fetch('/api/me')</script><img src=x onerror=\"…\">"}`. The answer is 200.
3. Sign in as the Admin and open Email, then Templates, then Preview (`POST /api/email/templates/expiry.driver_card/preview`).

**Evidence** (`sec-confirm.mjs`, run on :4100):
```
fleet manager can manage users: false
fleet manager can edit templates: true
fleet manager saves a template with a script: 200
admin preview returns the script unchanged: true
```
In the browser, the returned HTML was put into an `iframe srcdoc` exactly as `Email.tsx` does. The script read `/api/me` with the Admin's session and answered `sec-…@example.com / Admin / perms:313`.

**Fix**
- Add `sandbox=""` to every `srcDoc` iframe. That means no `allow-scripts` and no `allow-same-origin`. Locations: `Email.tsx:106`, `:218`, and also `Leaves.tsx:21` as defence in depth (its HTML is escaped, see the safe list).
- Remove scripts on save: strip `<script>`, `on*=` attributes and `javascript:` URLs from `body_html` on the server, because the same HTML is also sent by email.
- Consider whether Fleet Manager should edit email templates at all.
- The CSP in finding 3 adds a second layer.

### 2. Medium: `TRUST_PROXY=1` trusts every forwarded address

**Location:** `server/src/index.ts:38`, `app.set('trust proxy', process.env.TRUST_PROXY === '1')`. That is the boolean `true`, which trusts **all** hops. `README.md:49` and `:85` tell you to set `TRUST_PROXY=1` behind Nginx.

**What an attacker could do.** With `true`, Express takes the left-most `X-Forwarded-For` value, which the client controls. Every IP-based protection then uses an address the attacker picks:
- sign-in failures per minute (`auth.ts:97`)
- automatic IP blocks (`auth.ts:73-75`)
- the rider portal guessing limit (`portal.ts:68`)
- sign-ups per hour (`saas.ts:66`)
- the IPs recorded in the logs

Password guessing is then limited only by the per-account lock (5 tries), and an attacker can spread guesses across many accounts.

**Steps to reproduce (localhost):** start the server with `TRUST_PROXY=1` and send wrong sign-ins with a different `X-Forwarded-For` each time.

**Evidence:**
```
14 wrong sign-ins, each with a new X-Forwarded-For: bad_credentials ×14   (never "too_many")
12 wrong sign-ins from one forwarded address: bad_credentials ×10, too_many ×2
```

**Fix.** Trust exactly the proxies you run:
- `app.set('trust proxy', 1)` for a single Nginx in front, or the proxy's address or subnet.
- Make `TRUST_PROXY` take a number of hops or a list of addresses, and update the README.
- Never use `true`.

### 3. Medium: no security headers

**Location:** `server/src/index.ts` (no header middleware). Evidence, from the headers on `/` and `/api/me`:
```
content-security-policy: none   x-frame-options: none   strict-transport-security: none
referrer-policy: none           x-content-type-options: none (app pages)   x-powered-by: Express
```

**What an attacker could do**
- **Clickjacking:** any site can frame `/admin` and trick a signed-in Admin into clicking buttons such as delete, approve or restore.
- **No CSP:** nothing limits the damage of an XSS like finding 1.
- **No HSTS:** after the first HTTPS visit, a network attacker can still downgrade to HTTP.
- **`X-Powered-By`** advertises the framework.

**Fix.** One small middleware (or `helmet`):
- `Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'`. Check that the built app needs nothing else.
- `X-Frame-Options: DENY`.
- `Strict-Transport-Security` (only when served over HTTPS).
- `Referrer-Policy: strict-origin-when-cross-origin`.
- `X-Content-Type-Options: nosniff`.
- `app.disable('x-powered-by')`.

### 4. Medium: reachable `body-parser` denial of service

**Location:** `server/package.json:13` `express ^5.2.1` pulls in `body-parser` older than 2.4.0. The parsers are `index.ts:40-41` `express.json(...)`, which inflate gzip/deflate bodies by default, on every `/api` request, signed in or not.

**Advisory (`pnpm audit`, high):** "body-parser vulnerable to Denial of Service via trailing bytes after a compressed request body", fixed in 2.4.0.

**What an attacker could do:** send crafted compressed bodies, without signing in, to tie up the server. **Not tested**, because DoS is out of scope; this rests on the advisory and the code path.

**Fix:** update `express` so that `body-parser` is 2.4.0 or later, and refresh the lockfile. Unless a client sends compressed JSON, also set `inflate: false` (the extension's ingest call may need checking).

Other advisories in the same audit:
- `multer` older than 2.5.0 (high, `fileFilter`): **not reachable**, the code never uses `fileFilter`.
- `qs` `stringify` (moderate): not reachable, the server only parses.
- `uuid` via `exceljs` (moderate): not reachable, no buffer argument is used.
- Update them anyway.
- `web/`: no known vulnerabilities.

### 5. Low: CSV exports keep spreadsheet formulas

**Location:** `server/src/http.ts:219`. The CSV escaping handles quotes and commas, but not cells that start with `=`, `+`, `-`, `@`, tab or CR.

**What an attacker could do:** a value saved by someone in the company, or brought in by an import or the delivery-platform sync, becomes a live formula when another staff member opens the export in Excel. For example `=HYPERLINK(...)` links to a phishing page; older Excel versions with DDE could do worse. The XLSX exports are safe: ExcelJS writes strings as text.

**Evidence:** a platform named `=HYPERLINK("http://example.invalid/","open")` exports as
`1,"=HYPERLINK(""http://example.invalid/"",""open"")",1,0,0,…`

**Fix:** in `esc`, put `'` in front of any value that starts with one of those characters.

### 6. Low: `nodemailer` address-parser advisories

`nodemailer ^10.0.16` older than 10.1.4: three moderate advisories, in which crafted addresses can add or redirect recipients. The addresses the app sends to are checked as e-mail addresses on most paths (`clean(..., type: 'email')`), so the risk is low. **Fix:** update to 10.1.4 or later.

### 7. Low: the on-screen sign-in code is readable by scripts

**Location:** `auth.ts:40-45`. `GET /api/auth/challenge` answers `{"id","code","ttl"}`, so the "type the code" step stops nobody who automates the sign-in; the project's own tests do exactly that. The real protection is the rate limits and locks, which finding 2 can weaken. **Fix:** treat the code as a UI step only, keep the limits as the control (fix 2), and consider a real challenge after repeated failures.

### 8. Low: sign-up limit kept in memory

**Location:** `saas.ts:55-66`. Five sign-ups per hour per address, kept in a `Map` inside the process: it resets on every restart, is not shared between processes, and uses the forwarded address (finding 2). **Fix:** count recent sign-ups in the database per address (as `login_attempts` does), after fixing 2.

### 9. Low: upload type trusted from the browser; scan preview without `nosniff`

**Location:** `files.ts:29-31` and `scans.ts:27` accept a file when its declared `Content-Type` is on the list, without looking at its contents. `scans.ts:39` serves the temporary scan with that type and without `X-Content-Type-Options: nosniff`. Attachments are served with `nosniff` and a fixed list of inline types (`files.ts`, `sendStored`), and scans are visible only to their uploader, so the impact is low. **Fix:** check the first bytes (JPEG, PNG, WEBP, GIF, PDF signatures), and add `nosniff` plus `Content-Disposition` in `scans.ts`.

### 10. Low: restore accepts unencrypted archives

**Location:** `maintenance.ts:242`. A file without the `LSPBK1` header is opened as plain zip "from before encryption". Only the platform owner can upload and restore. But a plain archive handed to the owner (social engineering) would replace every company's data, including users and password hashes, with no integrity check beyond the checksum stored at upload time. **Fix:** refuse unencrypted archives unless a clear "legacy backup" option is ticked, and show the tables and row counts in the confirmation (partly done already).

### 11. Info: `first-login.txt`

`seed.ts:198` writes the owner's generated password in plain text to `server/data/first-login.txt` when `OWNER_PASSWORD` is not set. It is not served over HTTP and `server/data/` is in `.gitignore`, but it stays on disk until someone deletes it. **Fix:** delete it automatically after the owner's first sign-in or first password change, or show the password once on the console only.

---

## Checked and found safe

- **Tenant isolation:**
  - Every query goes through `tenancy.ts` `scopeTenant()`. Sources become company-filtered derived tables, UPDATE/DELETE get a company condition, and INSERT gets `tenant_id`.
  - Every one of the 59 tables with a `tenant_id` column is on the scoped list (script check). The 10 shared tables (`plans`, `tenants`, `languages`, `translation_overrides`, `blocked_ips`, `backups`, `restores`, `cities`, `login_challenges`, `schema_migrations`) are written only by owner-only routes (`platformOnly`).
  - A query on company data with no company is refused (`db.ts:97`).
  - The isolation test: company B reads all 334 GET addresses with company A's ids and changes nothing of A's. The same rider number in two companies stays apart, and the portal never reveals the other one.
- **Authorization:**
  - Every route has a permission check or an explained exception (route-guard test, 74 exceptions).
  - Permission matrix test: 1,791 checks.
  - Owner pages refuse company accounts (`platformOnly`, tested).
- **Rider portal:**
  - Files, requests, leaves and conversations are all checked against the signed-in rider (`portal.ts:232-245`, `:449`, `:490`, `:530-548`, `issues.ts:146`).
  - Guessing is limited per address across all companies.
  - Riders never reach staff routes (separate cookie and session table).
- **SQL injection:**
  - Every value is escaped by `formatQuery`, and identifiers are checked against `^[a-z_][a-z0-9_]*$` (`sql.ts:7`).
  - Sort columns come from fixed lists (`http.ts` `orderBy`).
  - The only interpolated SQL fragments are fixed strings (script check).
- **Mass assignment:** request bodies always pass `clean()` with a fixed list of fields before `SET ?`.
- **XSS in the app:** React escapes everything, and there is no `dangerouslySetInnerHTML`, `innerHTML` or `eval`. Leave letters escape every value (`leaves.ts:119-156`). Email variables are escaped (`mail.ts:46`).
- **File downloads:**
  - Only images, PDF, audio, video and plain text open in the browser; everything else downloads as `application/octet-stream` with `nosniff`.
  - File names are encoded in `Content-Disposition`.
  - Stored names are random, and scan tokens are checked against `^[a-f0-9]{24}$`.
  - Restore skips paths with `..`.
  - Rider uploads block executable extensions.
- **CSRF / CORS:**
  - Session cookies are `HttpOnly; SameSite=Lax` (and `Secure` over HTTPS).
  - State changes need POST/PATCH/DELETE with JSON or multipart, which Lax cookies do not accompany from other sites.
  - No GET route writes data (script check).
  - No CORS headers are sent, so other origins cannot read answers.
- **Sessions:**
  - Tokens are 32 random bytes, stored only as SHA-256.
  - They expire, end on sign-out and on password change (other devices), and stop working for disabled or locked users and suspended companies.
  - The new device limit applies only after the right password.
- **Passwords and codes:**
  - Passwords use scrypt with a random salt and a constant-time compare.
  - Reset and verification codes come from `crypto.randomInt`, have 6 digits, expire after 15 minutes, allow 5 tries, only the newest one works, and resending waits 60 s.
  - Account lock after 5 wrong passwords, 10 failures per minute per address, and an automatic block after 20 (all of these depend on fix 2).
- **SaaS and billing:**
  - Plan limits are checked on every insert (`db.ts` insert guard) and every switch back on, under a lock per company (race test).
  - Imports and sync go through the same guard.
  - Suspended or expired companies are stopped for staff, the portal and sync.
  - Only the owner approves payments or edits plans, prices and extra capacity.
  - Prices are computed on the server, never taken from the request.
  - A company cannot change its own plan without an approved payment.
- **Secrets:**
  - No `.env`, key or data file is in git (only `.env.example`, with placeholders).
  - `server/data/` is ignored.
  - Backups are AES-256-GCM with the server key.
  - Nothing secret is in the web bundle; the build reads no secret env vars.
- **Errors:** unexpected errors answer `{"error":"server_error"}`, with no stack trace.
- **Web dependencies:** `pnpm audit --prod` found no known vulnerabilities.

## Suggested order of fixes (after your approval)

1. Finding 1: `sandbox` on the preview frames and script stripping in templates, with a test that saves a script and checks it never runs or survives.
2. Finding 2: exact proxy trust, with a test that a changing `X-Forwarded-For` no longer escapes the limit.
3. Finding 3: security headers, with a test of the headers.
4. Finding 4 and the dependency updates (`express`/`body-parser`, `multer`, `nodemailer`), then the full test plan.
5. Findings 5 to 11, smallest first.
