-- Migration: security hardening for Row Level Security.
--
-- Applied in order with the other files in supabase/migrations (see
-- supabase/README.md). It is safe to run again.
-- Everything runs in one transaction. The self-check at the end reads the
-- tables the public booking page uses as an anonymous visitor; if any of those
-- reads fails, the whole migration is rolled back and nothing changes.
-- Once 20260928140000_private_booking_reads.sql has removed anonymous access,
-- the self-check is skipped. Running this file again after that file puts the
-- public read policies of step 3 back, so run that file again afterwards.
--
-- What it changes:
--   1. Salon owners can no longer write to public.users directly (plan,
--      trial_ends_at, usage counters, stripe_customer_id). Every write to that
--      table already goes through the service-role key on the server.
--   2. Removes the public INSERT policy on appointments. Public bookings are
--      written by /api/book/[slug]/appointments with the service-role key.
--   3. Anonymous visitors can only read salons that have an active booking
--      page, and only the salon columns the booking page needs. Staff,
--      services and availability are public only for those salons.
--      Signed-in users can no longer delete a salon row directly.
--   4. Owner policies apply to the `authenticated` role only, so anonymous
--      requests never evaluate them.
--   5. The public demo account (demo@noshowly.com) cannot have its password
--      or email changed, because anyone can sign in to it.

BEGIN;

-- 4. Owner policies: authenticated role only.
--    Runs before step 3, which removes anonymous access to salons.user_id.
DO $$
DECLARE
  p RECORD;
BEGIN
  FOR p IN
    SELECT * FROM (VALUES
      ('users',              'users: owner select'),
      ('salons',             'salons: owner all'),
      ('barbers',            'barbers: owner all'),
      ('clients',            'clients: owner all'),
      ('appointments',       'appointments: owner all'),
      ('reminders',          'reminders: owner all'),
      ('booking_pages',      'Users own booking page'),
      ('services',           'Users own services'),
      ('staff_availability', 'Users own staff availability'),
      ('barber_services',    'Owner can manage barber_services'),
      ('staff_services',     'Users own staff services')
    ) AS t(tbl, pol)
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = p.tbl AND policyname = p.pol
    ) THEN
      EXECUTE format('ALTER POLICY %I ON public.%I TO authenticated', p.pol, p.tbl);
    ELSE
      RAISE NOTICE 'Policy "%" on public.% not found, skipped', p.pol, p.tbl;
    END IF;
  END LOOP;
END $$;

-- Covered by "Owner can manage barber_services" (FOR ALL).
DROP POLICY IF EXISTS "Owner can read barber_services" ON public.barber_services;

-- 1. Billing and usage fields.
DROP POLICY IF EXISTS "users: owner update" ON public.users;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.users FROM anon, authenticated;

-- 2. Public appointment inserts.
DROP POLICY IF EXISTS "Public can create appointments via booking" ON public.appointments;

-- 3. Public reads.
-- SECURITY DEFINER avoids policy recursion between salons and booking_pages.
CREATE OR REPLACE FUNCTION public.salon_is_bookable(p_salon_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.booking_pages bp
    WHERE bp.salon_id = p_salon_id AND bp.is_active
  )
$$;
REVOKE ALL ON FUNCTION public.salon_is_bookable(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.salon_is_bookable(uuid) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "Public can view salon info for booking" ON public.salons;
DROP POLICY IF EXISTS "Public can view bookable salons" ON public.salons;
CREATE POLICY "Public can view bookable salons" ON public.salons
  FOR SELECT TO anon, authenticated
  USING (public.salon_is_bookable(id));

-- Anonymous visitors only need these columns (see app/book/[slug] and app/api/book/[slug]).
REVOKE ALL ON public.salons FROM anon;
GRANT SELECT (id, name, timezone, phone, currency, opening_time, closing_time)
  ON public.salons TO anon;

-- Deleting a salon cascades to all of its data. Only /api/account deletes
-- salons, with the service-role key, so signed-in users cannot do it directly.
REVOKE DELETE, TRUNCATE ON public.salons FROM authenticated;

DROP POLICY IF EXISTS "Public can view active barbers" ON public.barbers;
CREATE POLICY "Public can view active barbers" ON public.barbers
  FOR SELECT TO anon, authenticated
  USING (active AND public.salon_is_bookable(salon_id));

DROP POLICY IF EXISTS "Public can view active services" ON public.services;
CREATE POLICY "Public can view active services" ON public.services
  FOR SELECT TO anon, authenticated
  USING (active AND public.salon_is_bookable(salon_id));

DROP POLICY IF EXISTS "Public can view staff availability" ON public.staff_availability;
CREATE POLICY "Public can view staff availability" ON public.staff_availability
  FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.barbers b
    WHERE b.id = staff_availability.barber_id
      AND b.active
      AND public.salon_is_bookable(b.salon_id)
  ));

-- staff_services is not used by the app. Remove its public read.
DO $$
BEGIN
  IF to_regclass('public.staff_services') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Public can view active staff services" ON public.staff_services;
  END IF;
END $$;

-- 5. Demo account. To change its password or email yourself, first switch
--    the guard off:
--      CREATE OR REPLACE FUNCTION public.protect_demo_account() RETURNS trigger
--      LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END; $f$;
--    make the change, then run the CREATE OR REPLACE FUNCTION statement below
--    again to switch it back on.
CREATE OR REPLACE FUNCTION public.protect_demo_account()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'The demo account password and email cannot be changed'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- The trigger is created once; later runs only refresh the function above.
-- (auth.users belongs to Supabase Auth, so the trigger cannot be dropped and
-- recreated from here.) In its own block so that, if the auth schema cannot
-- be changed, only this step is skipped and the fixes above still apply.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'protect_demo_account'
      AND tgrelid = 'auth.users'::regclass
  ) THEN
    RAISE NOTICE 'Demo account trigger already in place';
  ELSE
    EXECUTE $trg$
      CREATE TRIGGER protect_demo_account
        BEFORE UPDATE ON auth.users
        FOR EACH ROW
        WHEN (
          lower(OLD.email) = 'demo@noshowly.com'
          AND (
            NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password
            OR NEW.email IS DISTINCT FROM OLD.email
          )
        )
        EXECUTE FUNCTION public.protect_demo_account()
    $trg$;
    RAISE NOTICE 'Demo account trigger added';
  END IF;
EXCEPTION
  WHEN insufficient_privilege OR undefined_column OR undefined_table THEN
    RAISE NOTICE 'Demo account trigger not added: %', SQLERRM;
END $$;

-- Self-check: the booking page's reads, as an anonymous visitor.
DO $$
BEGIN
  IF NOT has_table_privilege('anon', 'public.booking_pages', 'SELECT') THEN
    RAISE NOTICE 'Self-check skipped: anonymous visitors can no longer read the booking tables';
  ELSIF pg_has_role(current_user, 'anon', 'MEMBER') THEN
    SET LOCAL ROLE anon;
    PERFORM id, name, timezone, phone, currency, opening_time, closing_time
      FROM public.salons LIMIT 1;
    PERFORM * FROM public.booking_pages LIMIT 1;
    PERFORM * FROM public.barbers LIMIT 1;
    PERFORM * FROM public.services LIMIT 1;
    PERFORM * FROM public.staff_availability LIMIT 1;
    PERFORM * FROM public.barber_services LIMIT 1;
    PERFORM * FROM public.appointments LIMIT 1;
    RESET ROLE;
    RAISE NOTICE 'Self-check passed';
  ELSE
    RAISE NOTICE 'Self-check skipped: % cannot switch to the anon role', current_user;
  END IF;
END $$;

COMMIT;
