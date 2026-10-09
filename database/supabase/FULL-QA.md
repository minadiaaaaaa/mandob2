# Application QA — 9 October 2026

Destructive business scenarios ran against an isolated `mandoob_test_fullqa` schema in the selected Supabase project, using separate local files and disabled scheduling. The schema was removed after successful completion, and its absence was verified. The production `public` schema received metadata checks and normal owner login/read/logout checks only. Local PostgreSQL/PGlite also passed the complete smoke suite after the fixes. The production application remains available on localhost port 4000.

## Coverage

| Suite | Cases | Result |
| --- | ---: | --- |
| API permission matrix: guest, five built-in staff roles, empty custom role | 1,779 | Passed |
| Authorized GET routes across all five staff roles | 624 | Passed |
| Direct RLS reads: two riders × all 64 tables | 128 | Passed |
| Invalid JSON/size, closed setup, portal authentication, session ownership/replay, SQL input and rating regression | 76 | Passed |
| Staff role business writes, read-back and file uploads | 38 | Passed |
| Vehicle registration and fuel card lifecycle/validation | 23 | Passed |
| Real UI create/edit/read-back and stored HTML escaping | 3 | Passed |
| Expired sessions, inactive role, password/device revocation, expired/locked rider codes | 16 | Passed |
| Populated detail/edit/report/settings browser pages | 51 | Passed |
| Browser navigation: all static owner screens, five staff roles, empty role, two mobile riders | 185 | Passed |
| Public pages, missing page and guest redirects | 8 | Passed |
| Production owner reads | 14 | Passed |
| Production database security metadata checks | 7 | Passed |

The separate smoke suite covers riders/documents, companies/contracts, applicants/hiring, fleet assignments, oil/insurance, renewal logs, leave approval and overlap, advances/disbursement/repayment, financial imports, performance/ratings, branding, live ingest, CSV/Excel, audit, mail configuration, backup/restore, languages, and rider portal requests/issues/password/email/session workflows. Its embedded security suite verifies immediate permission grants/revocation, disabled staff, temporary scan ownership/path traversal, and cross-rider conversations. Direct PostgreSQL tests also verify concurrent rider requests, rejected ownership reassignment, hidden internal messages, attachment parent ownership, no-context denial, anonymous/authenticated denial, transaction rollback isolation, restricted runtime membership and concurrent leave numbering.

The browser run was interrupted by the desktop suspending network I/O. Passed navigation records were preserved; the remaining checks ran with fresh browser sessions after restarting the test API. The completed run passed all 185 role/rider navigation checks. This interruption was an environment failure, not an application HTTP failure.

## Defects found and fixed

1. Malformed and oversized JSON produced HTTP 500. They now return 400 and 413 with stable error codes; unsupported request encoding returns 415. Expected parser failures no longer enter the unexpected system-error log. A real HTTP regression test verifies valid requests continue to work.
2. The rider's monthly-rating card still called MySQL `CHAR(ASCII(...))`. PostgreSQL now uses `CHR`; API regression fixtures verify both the current segment floor and next segment floor, and the rider detail page renders successfully.

## How authorization works

Staff module/action permissions are enforced by Express against permissions loaded afresh for every request. PostgreSQL validates the trusted staff actor and permits staff operations; it does **not** independently reproduce the staff permission matrix. Rider ownership is enforced by PostgreSQL RLS as well as portal route checks. Browser roles have no direct table or sequence privileges. The runtime login cannot bypass RLS or become `postgres`.

RLS reads inspect every table, including tables with no rows for the tested riders. Populated ownership/write cases have additional fixtures in `security-db.ts`; the all-table read count is not a claim that every possible row shape or write was exercised.

## Reproducing the tests

Run server unit tests/typecheck and the web build with their existing npm scripts. From `server/`, `test/qa-run.ps1` prepares a unique disposable Supabase schema, runs the smoke, permission, database, workflow and headless-browser suites, and stops the test server/drops the schema in `finally`. Configure `QA_PLAYWRIGHT_MODULE` to an installed Playwright module and `QA_BROWSER_PATH` to a Chromium/Edge executable first. The runner requires the existing ignored `.env`; it never prints connection credentials. Test HTTP scripts restrict themselves to localhost ports 4100/4200. Production read scripts are separate and explicitly named.

## Limits

SMTP delivery was exercised with the application's local test transport, not a real customer's mail account. HungerStation synchronization was tested through token-authenticated ingestion and its expected sign-in-required path; live provider login needs configured credentials/extension. Automatic scan OCR currently returns `unavailable`; manual entry and scan ownership work. No Cloudflare deployment was part of this run. Headless browser checks use Chromium/Edge; other browser engines and large-scale load testing were not performed. The web build passes with a bundle-size advisory.

Detailed machine-readable results are local `.qa-reports/*-verification.json` reports and `.qa-reports/full-permissions.json` (ignored by Git). Passing these checks is evidence for the listed scenarios, not a guarantee against every possible defect.
