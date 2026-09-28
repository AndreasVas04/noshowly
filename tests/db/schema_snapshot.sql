-- Everything the migrations define, one line per item in a stable order.
-- scripts/test-db.sh takes a snapshot before and after running every
-- migration a second time; the two must be identical.

SELECT kind, name, detail
FROM (
  SELECT 'column' AS kind, table_name || '.' || column_name AS name,
         concat_ws(' ', data_type, is_nullable, column_default) AS detail
  FROM information_schema.columns WHERE table_schema = 'public'
  UNION ALL
  SELECT 'constraint', conrelid::regclass::text || '.' || conname,
         pg_get_constraintdef(oid) || CASE WHEN convalidated THEN '' ELSE ' (not validated)' END
  FROM pg_constraint WHERE connamespace = 'public'::regnamespace
  UNION ALL
  SELECT 'index', indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'
  UNION ALL
  SELECT 'policy', tablename || '.' || policyname,
         concat_ws(' | ', cmd, roles::text, qual, with_check)
  FROM pg_policies WHERE schemaname = 'public'
  UNION ALL
  SELECT 'row level security', relname, relrowsecurity::text
  FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
  UNION ALL
  SELECT 'table privilege', table_name || ' ' || grantee, string_agg(privilege_type, ',' ORDER BY privilege_type)
  FROM information_schema.role_table_grants WHERE table_schema = 'public'
  GROUP BY table_name, grantee
  UNION ALL
  SELECT 'column privilege', table_name || '.' || column_name || ' ' || grantee, privilege_type
  FROM information_schema.column_privileges WHERE table_schema = 'public' AND grantee = 'anon'
  UNION ALL
  SELECT 'function', p.oid::regprocedure::text,
         md5(pg_get_functiondef(p.oid)) || ' ' || coalesce(p.proacl::text, 'default privileges')
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
  UNION ALL
  SELECT 'trigger', tgrelid::regclass::text || '.' || tgname, pg_get_triggerdef(oid)
  FROM pg_trigger WHERE NOT tgisinternal
  UNION ALL
  SELECT 'extension', extname, extnamespace::regnamespace::text FROM pg_extension
  UNION ALL
  SELECT 'publication', pubname, schemaname || '.' || tablename FROM pg_publication_tables
  UNION ALL
  SELECT 'bucket', id, public::text FROM storage.buckets
  UNION ALL
  SELECT 'rows', 'users', count(*)::text FROM public.users
  UNION ALL
  SELECT 'rows', 'salons', count(*)::text FROM public.salons
  UNION ALL
  SELECT 'rows', 'appointments', count(*)::text FROM public.appointments
  UNION ALL
  SELECT 'rows', 'reminders by status', string_agg(status, ',' ORDER BY status) FROM public.reminders
) snapshot
ORDER BY kind, name, detail;
