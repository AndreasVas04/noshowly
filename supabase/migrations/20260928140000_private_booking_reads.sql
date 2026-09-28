-- Migration: private booking reads.
--
-- APPLY ONLY AFTER the release in which the public booking page
-- (app/book/[slug] and GET /api/book/[slug]) reads its data on the server with
-- the service-role key is live. Before that release the page reads with the
-- anon key, and it stops working as soon as this file runs.
--
-- Safe to run again. Everything runs in one transaction.
--
-- What it changes:
--   1. Drops the public read policies on salons, barbers, services,
--      staff_availability, booking_pages and barber_services, and any other
--      SELECT policy on those tables that applies to anonymous visitors or to
--      everyone. Signed-in owners keep their own rows through the owner
--      policies.
--   2. Anonymous visitors lose every privilege on the Noshowly tables, except
--      SELECT on salons.id: the keep-alive workflow calls
--      GET /rest/v1/salons?select=id&limit=1 with the anon key, which keeps
--      returning 200 (with an empty list, as no policy lets anon see a row).
--   3. Drops public.salon_is_bookable(), which only those policies used.
--
-- Running 20260928120000_security_hardening.sql again after this file puts the
-- public read policies back; run this file again after it.

BEGIN;

-- 1. Public read policies.
DROP POLICY IF EXISTS "Public can view bookable salons"        ON public.salons;
DROP POLICY IF EXISTS "Public can view salon info for booking" ON public.salons;
DROP POLICY IF EXISTS "Public can view active barbers"         ON public.barbers;
DROP POLICY IF EXISTS "Public can view active services"        ON public.services;
DROP POLICY IF EXISTS "Public can view staff availability"     ON public.staff_availability;
DROP POLICY IF EXISTS "Public can view active booking pages"   ON public.booking_pages;

-- Anything else that still lets anonymous visitors or everyone read these
-- tables, e.g. a policy added from the dashboard.
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('salons', 'barbers', 'services', 'staff_availability',
                        'booking_pages', 'barber_services')
      AND cmd = 'SELECT'
      AND roles && ARRAY['anon', 'public']::name[]
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
    RAISE NOTICE 'Dropped policy "%" on public.%', p.policyname, p.tablename;
  END LOOP;
END $$;

-- 2. Anonymous access. Revoking a table privilege also revokes the column
--    privileges granted by 20260928120000_security_hardening.sql.
REVOKE ALL ON
  public.users,
  public.salons,
  public.barbers,
  public.clients,
  public.appointments,
  public.reminders,
  public.services,
  public.booking_pages,
  public.staff_availability,
  public.barber_services
FROM anon;

GRANT SELECT (id) ON public.salons TO anon;

-- 3. Helper for the dropped policies.
DO $$
BEGIN
  IF to_regprocedure('public.salon_is_bookable(uuid)') IS NOT NULL THEN
    DROP FUNCTION public.salon_is_bookable(uuid);
  END IF;
EXCEPTION
  WHEN dependent_objects_still_exist THEN
    RAISE NOTICE 'public.salon_is_bookable() kept, something still uses it: %', SQLERRM;
END $$;

COMMIT;
