# Phase 2 design: branches and designations

Covers FEATURE-STATUS items 1 (Branches), 2 (Designations) and the branch/designation part of 26 (counters; the dashboard
cards themselves are phase 8). Both tables belong to **each company** (tenant). The platform owner only sets the limits
on the plan, which the plan editor already has (`max_branches`, `max_designations`).

## 1. Data (server/src/schema.sql + migration 4)

```sql
CREATE TABLE IF NOT EXISTS branches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  name_ar VARCHAR(100) NOT NULL,
  name_en VARCHAR(100) NULL,
  city_id INT NULL,                        -- optional, FK cities(id) (platform table)
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  notes VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL,
  UNIQUE KEY uq_branch_name (tenant_id, name_ar),
  UNIQUE KEY uq_branch_tenant_id (tenant_id, id),   -- target of the company-safe foreign keys below
  FOREIGN KEY (city_id) REFERENCES cities(id)
);
CREATE TABLE IF NOT EXISTS designations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  name_ar VARCHAR(100) NOT NULL,
  name_en VARCHAR(100) NULL,
  builtin_key ENUM('driver','supervisor') NULL,      -- NULL = custom (counts against the plan)
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL,
  UNIQUE KEY uq_designation_name (tenant_id, name_ar),
  UNIQUE KEY uq_designation_builtin (tenant_id, builtin_key),
  UNIQUE KEY uq_designation_tenant_id (tenant_id, id)
);
```

- New nullable columns:
  - `riders.branch_id`, `riders.designation_id`
  - `vehicles.branch_id`
- Each column gets an index `(tenant_id, branch_id)` and a **composite foreign key**, for example `(tenant_id, branch_id) → branches (tenant_id, id)`.
  - The database itself then refuses to link a rider to another company's branch, even if a route forgets to check.
- Both tables go into `TENANT_TABLES` in `tenancy.ts`.

**Migration 4 ("branches and designations")** is idempotent and keeps existing data. For every company:
1. Create one default branch, «الفرع الرئيسي» / "Main branch".
2. Create the built-in designations «سائق» / Driver and «مشرف» / Supervisor.
3. Set `branch_id` = the default branch on riders and vehicles where it is NULL.
4. Set `designation_id` = Driver on riders where it is NULL.

`riders.occupation` (the iqama profession) stays as it is; a designation is a different thing.

New companies get the same defaults at sign-up. One function, `ensureCompanyDefaults(tenant)` in the new `domain/branches.ts`, is used by both the migration and sign-up.

## 2. Plan rules (no hard-coded limits)

- `branches` and `designations` move from `LATER_QUOTAS` into `QUOTAS` (`domain/plans.ts`):
  - branches: counted `is_active = 1`, off `is_active = 0`.
  - designations: counted `is_active = 1 AND builtin_key IS NULL`. Built-in designations never count, so "Designations 0/2 custom".
- The quota engine gets one small general addition: a `free` marker (a column that, when set, means "never counted"). This lets the insert guard skip the built-ins.
- The insert guard's table list in `db.ts` will be built from `QUOTAS` instead of a hand-written regex, so a new quota can't be forgotten there.
- Plan defaults are unchanged:

| Plan | Branches | Custom designations |
|---|---|---|
| Free | 1 | 0 |
| Starter | 2 | 2 |
| Growth | 5 | 5 |
| Scale | 10 | 10 |

- The default branch counts as a branch, so Free = the main branch only.
- Reactivating a branch or custom designation goes through `withQuota`, as companies and contracts already do.
- Downgrades: the existing "plan too small" check loops over every quota, so it will refuse a downgrade and list branches or designations that are over the new limit. No extra code is needed.
- **Over the limit after falling back to Free:** existing branches and designations keep working. Only adding or reactivating is blocked.
  - They are **not** "paused" like riders, because pausing a branch would hide all of its riders.

## 3. Business rules (`domain/branches.ts`, defined once on the server)

1. Each company always has exactly one default branch. The default can't be deactivated or deleted. "Make default" moves the flag in one transaction.
2. A branch or custom designation that is in use can't be deleted: 409 `branch_in_use` / `designation_in_use` with the counts of riders and vehicles. It can be deactivated instead.
   - In phase 6, salary rules join this check.
3. An inactive branch or designation is hidden from pickers and can't be given to new or edited records. Records that already have it keep it.
4. Built-in designations can be renamed but not deactivated or deleted.
5. A rider created **without** a branch or designation gets the default branch and Driver. A vehicle created without a branch gets the default branch.
   - This covers the form, applicant hire, imports and sync, so no record is ever left without a branch.
6. The branch or designation given must be active and belong to the company. The check uses `one()`, which is already company-scoped, and the composite foreign key backs it up. Otherwise the answer is 422 `field: branch_id`.
7. Imports: the riders and vehicles templates gain a «الفرع» / Branch column, and riders also gain «المسمى» / Designation. Values are matched by Arabic or English name.
   - An unknown name is a row error. It is **not** created automatically, because that would bypass the plan limit.
8. A vehicle's branch is independent of its driver's branch, as in LogisTap.

## 4. Server routes (thin, in a new `routes/branches.ts`)

| Route | Permission |
|---|---|
| `GET /branches` (list with rider/vehicle counts, `list()` spec), `GET /branches/export`, `GET /branches/:id` | `branches.view` / `branches.export` |
| `POST /branches`, `PATCH /branches/:id` | `branches.create` / `branches.update` |
| `POST /branches/:id/activate`, `/deactivate`, `/make-default` | `branches.activate` / `branches.deactivate` / `branches.update` |
| `DELETE /branches/:id` | `branches.delete` |
| Same set under `/designations` | `designations.*` |
| `GET /lookups/branches`, `GET /lookups/designations` (active only, `?all=1` for edit screens) | `requireUser` (same as the other lookups) |
| `POST /riders/bulk-branch`, `POST /riders/bulk-designation`, `POST /vehicles/bulk-branch` | `riders.update` / `vehicles.update` |

- Every change is audited: `branch.create`, `branch.update`, `branch.activate`, `branch.deactivate`, `branch.default`, `branch.delete`, and the same set for `designation.*`.
- **Branch filter** (`branch=<id>`, plus `designation=<id>` where riders are listed) is added to these lists and their exports:
  - riders
  - vehicles
  - rider documents (the five document lists)
  - daily performance
  - monthly ratings
  - advances
  - the reports page (riders, vehicles, alerts, advances)
- Riders and vehicles lists and exports gain Branch and Designation columns.

## 5. Permissions (`perms.ts`)

- New modules in the existing `lookups` group (next to cities):
  - `branches: view, create, update, delete, activate, deactivate, export`
  - `designations`: the same actions
- Admin gets them automatically at every start (`seed.ts` gives Admin `ALL_PERMS`).
- The built-in Fleet Manager role of **new** companies gets them without `delete`, following its current rule.
- Existing companies' custom roles are unchanged. Their admins can tick the new permissions on the roles screen.

## 6. Screens (company)

- **Settings → Branches** (`/admin/branches`):
  - Plan counter "Branches 1/2".
  - Table: name (ar/en), city, riders, vehicles, status, "Default" badge.
  - Side panel to add or edit.
  - Row actions: make default, activate/deactivate, delete. A blocked delete explains why.
- **Settings → Designations** (`/admin/designations`):
  - Counter "Custom designations 0/2".
  - Built-ins marked «أساسي» / Built-in.
  - Same actions.
- **Rider form and profile:** Branch and Designation selects (default preselected); shown on the profile.
- **Vehicle form and view:** Branch select.
- **Riders and vehicles lists:** Branch (and Designation) columns, filters, and the bulk "Move to branch" / "Set designation" actions.
- **Other lists:** branch filter on the documents, performance, ratings, advances and reports pages listed above.
- **Billing page:** branches and designations show real usage instead of only the limit (`web/src/plans.ts` moves them from `LATER_KEYS` to `QUOTA_KEYS`).
- **Menu:** both pages under System, next to Organization, each behind its `.view` permission.
- Every new string goes into ar, en, bn and ur. Arabic is RTL; layouts are checked on desktop and mobile width.

## 7. Tests

- **New `test/branches.mjs`**, against the API on the disposable install:
  - create, edit and list
  - Free plan: a second branch is refused with 402, and a first custom designation is refused with 402
  - Starter: limits 2/2
  - built-ins don't count
  - default rules
  - deleting an in-use branch or designation gives 409, and deactivating it then works
  - an inactive branch can't be assigned
  - riders and vehicles without a branch get the defaults
  - import by name, and an unknown name gives a row error
  - bulk move
  - filters return only the matching rows
  - audit entries are written
- **Isolation:** company B can't read, edit, delete, filter by or assign company A's branch or designation. The answers are 404 or 422, and the composite foreign key also refuses a raw cross-company link.
- **`migrations-check.ts`:** the migration backfills an existing company with riders and vehicles, and running it twice changes nothing.
- **`plans.mjs`:** the new quotas appear in usage, in the downgrade "too small" list and in the Billing data.
- **Unit:** `tenancy.test.ts` covers the two new tables. The route guard sees every new route.
- **Browser:** both new pages, the rider and vehicle forms and the filters in Arabic and English, on desktop and mobile width, as two companies.

## 8. Not in this phase

- Restricting a **staff account** to one branch (a supervisor who sees only their branch's riders). LogisTap doesn't show this.
  - It can be added later as `users.branch_id` plus a scope in the list specs.
- Salary rules per branch (phase 6), branch on invoices (phase 7), dashboard cards (phase 8).
