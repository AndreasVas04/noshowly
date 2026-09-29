-- Migration: Supabase's automatic RLS function is not callable through the API.
--
-- A project with "Enable automatic RLS" turned on has public.rls_auto_enable(),
-- the function of Supabase's ensure_rls event trigger, which turns on Row Level
-- Security for every new table in public. It is SECURITY DEFINER and, like
-- every new function, executable by PUBLIC, so the API exposes it to anonymous
-- and signed-in users (POST /rest/v1/rpc/rls_auto_enable) and the Security
-- Advisor reports it (lints 0028 and 0029). Called that way it only fails, but
-- it has no reason to be in the API. PostgreSQL does not check EXECUTE when an
-- event trigger calls its function, so the trigger keeps working.
--
-- Safe to run again. Does nothing on a project without the function.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.rls_auto_enable()') IS NULL THEN
    RAISE NOTICE 'public.rls_auto_enable() not found, nothing to do';
    RETURN;
  END IF;

  REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon, authenticated;
  END IF;
  RAISE NOTICE 'public.rls_auto_enable(): EXECUTE revoked from PUBLIC, anon and authenticated';
END $$;

COMMIT;
