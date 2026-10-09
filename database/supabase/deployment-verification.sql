SELECT metric, actual, expected, actual = expected AS passed FROM (VALUES
('tables', (SELECT count(*)::text FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'), '64'),
('columns', (SELECT count(*)::text FROM information_schema.columns WHERE table_schema='public'), '730'),
('foreign_keys', (SELECT count(*)::text FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND c.contype='f'), '40'),
('rls_enabled', (SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity), '64'),
('settings', (SELECT count(*)::text FROM public.settings), '112'),
('roles', (SELECT count(*)::text FROM public.roles), '5'),
('role_permissions', (SELECT count(*)::text FROM public.role_permissions), '807'),
('cities', (SELECT count(*)::text FROM public.cities), '25'),
('email_templates', (SELECT count(*)::text FROM public.email_templates), '17'),
('users', (SELECT count(*)::text FROM public.users), '0'),
('installed', (SELECT value FROM public.settings WHERE key='system.installed'), '0'),
('browser_table_grants', (SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN (VALUES ('anon'),('authenticated')) AS r(role_name) CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) AS p(privilege) WHERE n.nspname='public' AND c.relkind='r' AND has_table_privilege(r.role_name,c.oid,p.privilege)), '0'),
('browser_sequence_grants', (SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN (VALUES ('anon'),('authenticated')) AS r(role_name) CROSS JOIN (VALUES ('USAGE'),('SELECT'),('UPDATE')) AS p(privilege) WHERE n.nspname='public' AND c.relkind='S' AND has_sequence_privilege(r.role_name,c.oid,p.privilege)), '0')
) AS checks(metric, actual, expected);
