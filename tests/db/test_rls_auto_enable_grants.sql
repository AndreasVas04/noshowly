-- 20260929140000_rls_auto_enable_grants.sql: Supabase's automatic RLS
-- function is not executable through the API, and its event trigger still
-- works. The stub has no such function, so this file creates one the way
-- Supabase does (SECURITY DEFINER, EXECUTE for PUBLIC, an event trigger on
-- CREATE TABLE), runs the migration again and checks both. The migration
-- commits, so this file cleans up after itself instead of rolling back.

CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT * FROM pg_event_trigger_ddl_commands()
    WHERE command_tag = 'CREATE TABLE' AND schema_name = 'public'
  LOOP
    EXECUTE format('ALTER TABLE IF EXISTS %s ENABLE ROW LEVEL SECURITY', cmd.object_identity);
  END LOOP;
END;
$$;
CREATE EVENT TRIGGER tests_ensure_rls ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE')
  EXECUTE FUNCTION public.rls_auto_enable();

DO $$
BEGIN
  PERFORM tests.expect('before the migration, anonymous users can execute rls_auto_enable()',
    has_function_privilege('anon', 'public.rls_auto_enable()', 'EXECUTE'));
END $$;

\ir ../../supabase/migrations/20260929140000_rls_auto_enable_grants.sql
\ir ../../supabase/migrations/20260929140000_rls_auto_enable_grants.sql

DO $$
BEGIN
  PERFORM tests.expect('anonymous users cannot execute rls_auto_enable()',
    NOT has_function_privilege('anon', 'public.rls_auto_enable()', 'EXECUTE'));
  PERFORM tests.expect('signed-in users cannot execute rls_auto_enable()',
    NOT has_function_privilege('authenticated', 'public.rls_auto_enable()', 'EXECUTE'));
END $$;

-- The event trigger still turns on RLS for a table created by a role that
-- cannot execute the function.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tests_ddl_user') THEN
    CREATE ROLE tests_ddl_user;
  END IF;
END $$;
GRANT CREATE ON SCHEMA public TO tests_ddl_user;
SET ROLE tests_ddl_user;
CREATE TABLE public.tests_rls_probe (id integer);
RESET ROLE;

DO $$
BEGIN
  PERFORM tests.expect('the event trigger still enables RLS on new tables',
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.tests_rls_probe'::regclass));
END $$;

DROP TABLE public.tests_rls_probe;
REVOKE CREATE ON SCHEMA public FROM tests_ddl_user;
DROP ROLE tests_ddl_user;
DROP EVENT TRIGGER tests_ensure_rls;
DROP FUNCTION public.rls_auto_enable();
