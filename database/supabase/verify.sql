-- Read-only verification after schema.sql and seed.sql on the selected destination.
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname;

-- Expected on a fresh destination: 64 tables, 730 columns, 40 foreign keys.
SELECT
  (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE') AS tables,
  (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public') AS columns,
  (SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname = 'public' AND c.contype = 'f') AS foreign_keys;

-- Expected: 112 / 5 / 807 / 25 / 17 / 0 / '0'.
SELECT
  (SELECT count(*) FROM public.settings) AS settings,
  (SELECT count(*) FROM public.roles) AS roles,
  (SELECT count(*) FROM public.role_permissions) AS role_permissions,
  (SELECT count(*) FROM public.cities) AS cities,
  (SELECT count(*) FROM public.email_templates) AS email_templates,
  (SELECT count(*) FROM public.users) AS users,
  (SELECT value FROM public.settings WHERE key = 'system.installed') AS installed;

-- Expected no rows: no browser role has privileges on public tables or sequences.
SELECT r.role_name, c.relname AS object_name, p.privilege
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role_name)
CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS p(privilege)
WHERE n.nspname = 'public' AND c.relkind = 'r'
  AND has_table_privilege(r.role_name, c.oid, p.privilege)
UNION ALL
SELECT r.role_name, c.relname, p.privilege
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role_name)
CROSS JOIN (VALUES ('USAGE'), ('SELECT'), ('UPDATE')) AS p(privilege)
WHERE n.nspname = 'public' AND c.relkind = 'S'
  AND has_sequence_privilege(r.role_name, c.oid, p.privilege);
