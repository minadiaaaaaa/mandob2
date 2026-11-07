Role: work as a senior software engineer and architect who owns Mandoob for the long term. Everything you deliver must be production quality: clean design, correct data, secure, tested, verified in the running app, and explained. Use the skills listed below at the points shown. If a skill isn't available, do that step manually and say so.

Project: Mandoob, a multi-company SaaS for delivery operators, at
C:\Users\Mina diaa\Desktop\مندوب\tayson-logistics

Situation: earlier work produced ARCHITECTURE-AUDIT.md and SECURITY-REPORT.md and changed many files, but the features in LOGISTAP-MISSING.md were never built. As of 2026-11-07, server/src/schema.sql has no tables for branches, designations, accidents, servicing, platform IDs, salaries, invoices, company finance, bookmarks or exited employees. Building these features is now the main job.

Read first: LOGISTAP-MISSING.md (the list), LOGISTAP-FEATURES.md (screen details), LOGISTAP-PROMPT.md (SaaS model, architecture standards, build order), ARCHITECTURE-AUDIT.md, SECURITY-REPORT.md, README.md.

=== Step 0: protect current work ===
- Show me `git status` and a short summary of the uncommitted changes. Ask whether to commit them before you start.
- Skill: `differential-review` on the uncommitted diff, to confirm the earlier changes didn't break anything or add risk.
- Skill: `init` if there is no CLAUDE.md: write one with the project's commands, structure, tenancy, permission and plan rules, so every later step follows them.

=== Step 1: verify every feature (read-only) ===
- Skill: `audit-context-building` to map the codebase: modules, data flow, tenancy, permissions, plan checks.
- Skill: `Explore` agent for the wide searches across server/, web/ and shared/.
- For EVERY item in LOGISTAP-MISSING.md (items 1–32 and the 3 partial rows), check four layers:
  1. DB: a table or columns in schema.sql, with tenant_id.
  2. Server: a route, a permission in perms.ts, and a plan check in saas.ts where needed.
  3. UI: a page reachable from the menu, with strings in all 4 languages in shared/i18n/.
  4. Works: skill `run`. Start the app, open the screen, and do the main action once with test data.
- Write FEATURE-STATUS.md: | # | Feature | Status | DB | Server | UI | Works locally | Evidence (file:line) | What's missing |
- Done (✅) only when all four layers exist and it worked. Partial (🟡) if some exist. Missing (❌) if none do. No evidence means not done: plans, TODOs, placeholders and look-alikes don't count ("monthly billing" is not the tax invoice maker, Ajeer permits are not platform IDs).
- Send me the counts (Done / Partial / Missing), then stop and wait for my approval.

=== Step 2: build, one phase at a time (order from LOGISTAP-PROMPT.md) ===
For each phase:
1. Design. Skill: `Plan` agent / plan mode. Cover tables (keys, indexes, constraints, tenant_id, money as DECIMAL or halalas, UTC dates), routes, business rules (defined once on the server), screens, permissions, plan quota and gating, migration of existing companies, and tests. For each table and screen, say whether it belongs to the platform or to a company. Wait for my approval.
2. Build. Use test-first where possible. Follow the existing patterns, reuse the existing helpers, keep routes thin, and add all 4 languages. No hard-coded limits: every limit goes through the plan engine in saas.ts.
3. Quality gate, all required before you report the phase as done:
   - All tests pass (old and new).
   - Skill `code-review` (high) on the phase diff, then fix the findings.
   - Skill `simplify` to remove duplication and needless complexity.
   - Skill `security-review` on the phase diff. Add `static-analysis:semgrep` (important only) and `insecure-defaults:audit` when the phase touches tenancy, permissions, billing, finance, uploads or ZATCA. Run `fp-check` on any high or critical finding before acting on it.
   - Skill `sharp-edges` when you design a new shared API or module, such as the plan/quota engine or the finance ledger.
   - Skill `run`: start the app and use every new screen in Arabic (RTL) and English, on desktop and mobile width. Use two test companies and confirm neither can see the other's data.
4. Report. Update FEATURE-STATUS.md with the new evidence, then summarize what was done, the review findings and their fixes, and what is left. Wait for my approval before the next phase.

At the end of all phases: skill `supply-chain-risk-auditor` on any new dependencies, then a final `FEATURE-STATUS.md` with every item ✅ and its evidence.

Rules: keep existing data and features working, and make migrations idempotent and backward-compatible. Don't commit or push unless I ask. Don't open or log into logistap.com, because the files have everything you need. Don't start new audits or big refactors unless they block the feature you are building.
