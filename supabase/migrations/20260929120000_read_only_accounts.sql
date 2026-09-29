-- Migration: read-only accounts, enforced by the database.
--
-- Can be applied any time after the billing release (read-only accounts,
-- lib/entitlements.ts) is live. With the code before that release, moving or
-- cancelling an appointment in the dashboard would leave its old email links
-- working: app/api/appointments/[id] only retires them with the service-role
-- key from that release on, and owners can no longer write reminders rows.
--
-- Safe to run on the live project, and safe to run again. Everything runs in
-- one transaction. The SQL Editor does not show notices, so the last query
-- lists what each step did.
--
-- An owner whose trial has ended, or whose subscription is inactive, is
-- read-only in the dashboard API (lib/access.ts). The owner policies were
-- FOR ALL, so with the public anon key and their own session that owner could
-- still write through the Supabase API. What it changes:
--   1. public.owner_has_write_access(user_id), canWrite of
--      lib/entitlements.ts in SQL: true for basic, pro and business (and the
--      legacy names parsePlan() reads as those), and for a trial whose
--      trial_ends_at is still in the future; false for an ended trial, a trial
--      without an end date, 'cancelled', an unknown plan and a missing users
--      row. It only answers for the signed-in user (for any user when nobody
--      is signed in: SQL Editor, service role).
--   2. barbers, services, clients, appointments, booking_pages,
--      staff_availability and barber_services: the FOR ALL owner policy
--      becomes four policies. "<table>: owner select" keeps its rule;
--      "<table>: owner insert", "owner update" and "owner delete" also need
--      owner_has_write_access(). A read-only owner still reads everything;
--      their inserts and updates fail ("new row violates row-level security
--      policy") and their deletes change nothing.
--   3. salons: owners keep SELECT and UPDATE of their own salon without that
--      check, so settings stay editable (PUT /api/salon). The server creates
--      salons (lib/account.ts) and deletes them (/api/account) with the
--      service-role key, so signed-in users lose INSERT (DELETE was already
--      revoked by 20260928120000_security_hardening.sql).
--   4. reminders: owners keep SELECT. The server writes every reminders row
--      with the service-role key (email gateway, reminder job, confirm links,
--      app/api/appointments/[id]), so signed-in users lose INSERT, UPDATE,
--      DELETE and TRUNCATE.
--   5. Any other policy that lets signed-in users, anonymous visitors or
--      everyone write to these tables (e.g. one added from the dashboard) is
--      dropped: policies are permissive, so one would undo the others.
--
-- The service-role key bypasses Row Level Security, so the Stripe webhook,
-- the reminder job, the public booking page and account deletion work as
-- before. Foreign key actions are not subject to these rules either:
-- deleting an appointment still deletes its reminders.
--
-- Running 20260928130000_data_integrity.sql again after this file puts the
-- FOR ALL owner policies back; run this file again after it.

BEGIN;

-- Fail fast instead of queueing behind a long-running query; nothing is
-- changed if a lock cannot be taken. Run the file again later.
SET LOCAL lock_timeout = '10s';

CREATE TEMP TABLE IF NOT EXISTS read_only_report (seq serial, step text, result text);
TRUNCATE pg_temp.read_only_report RESTART IDENTITY;

CREATE OR REPLACE FUNCTION pg_temp.read_only_note(p_step text, p_result text) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE NOTICE '%: %', p_step, p_result;
  INSERT INTO pg_temp.read_only_report (step, result) VALUES (p_step, p_result);
END;
$$;


-- 1. Who may make changes. The plan is read the way parsePlan() reads it:
--    trimmed, in lower case, legacy names included. A trial runs while
--    now() < trial_ends_at (getEntitlements()).
--    SECURITY DEFINER so the policies do not depend on what signed-in users
--    may read in public.users.
CREATE OR REPLACE FUNCTION public.owner_has_write_access(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = p_user_id
      -- Callable through the API: never answer about another account.
      AND (p_user_id = auth.uid() OR auth.uid() IS NULL)
      AND (
        pg_catalog.lower(pg_catalog.btrim(u.plan)) IN (
          'basic', 'pro', 'business',
          'starter', 'professional',
          'solo-sms', 'team-sms', 'studio-sms',
          'solo-email', 'team-email', 'studio-email',
          'solo-both', 'team-both', 'studio-both')
        OR (pg_catalog.lower(pg_catalog.btrim(u.plan)) = 'trial'
            AND u.trial_ends_at > pg_catalog.now())
      )
  )
$$;
REVOKE ALL ON FUNCTION public.owner_has_write_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_has_write_access(uuid) TO authenticated, service_role;

DO $$
BEGIN
  PERFORM pg_temp.read_only_note('owner_has_write_access()', 'in place');
END $$;


-- 2. The tables a read-only owner can read but not change. p_owner_rule is
--    the rule of the FOR ALL policy it replaces
--    (20260928130000_data_integrity.sql, step 8), unchanged.
CREATE OR REPLACE FUNCTION pg_temp.read_only_owner_policies(
  p_table        text,
  p_old_policies text[],
  p_owner_rule   text
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_write_rule text := format(
    '(%s) AND (SELECT public.owner_has_write_access((SELECT auth.uid())))', p_owner_rule);
  v_replaced   text;
  v_old        text;
BEGIN
  SELECT string_agg(format('"%s"', policyname), ', ') INTO v_replaced
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = p_table AND policyname = ANY (p_old_policies);

  FOREACH v_old IN ARRAY p_old_policies LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_old, p_table);
  END LOOP;

  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p_table || ': owner select', p_table);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (%s)',
                 p_table || ': owner select', p_table, p_owner_rule);

  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p_table || ': owner insert', p_table);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)',
                 p_table || ': owner insert', p_table, v_write_rule);

  -- USING without the write check: a read-only owner's update then fails
  -- with an error instead of silently changing nothing.
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p_table || ': owner update', p_table);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)',
                 p_table || ': owner update', p_table, p_owner_rule, v_write_rule);

  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p_table || ': owner delete', p_table);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (%s)',
                 p_table || ': owner delete', p_table, v_write_rule);

  PERFORM pg_temp.read_only_note(p_table,
    coalesce('replaced ' || v_replaced || ': ', '')
    || 'owner select; owner insert, update and delete need write access');
END;
$$;

DO $$
BEGIN
  PERFORM pg_temp.read_only_owner_policies('barbers', ARRAY['barbers: owner all'],
    $r$salon_id IN (SELECT id FROM public.salons WHERE user_id = (SELECT auth.uid()))$r$);

  PERFORM pg_temp.read_only_owner_policies('services', ARRAY['Users own services'],
    $r$salon_id IN (SELECT id FROM public.salons WHERE user_id = (SELECT auth.uid()))$r$);

  PERFORM pg_temp.read_only_owner_policies('clients', ARRAY['clients: owner all'],
    $r$salon_id IN (SELECT id FROM public.salons WHERE user_id = (SELECT auth.uid()))$r$);

  PERFORM pg_temp.read_only_owner_policies('appointments', ARRAY['appointments: owner all'],
    $r$salon_id IN (SELECT id FROM public.salons WHERE user_id = (SELECT auth.uid()))$r$);

  PERFORM pg_temp.read_only_owner_policies('booking_pages', ARRAY['Users own booking page'],
    $r$salon_id IN (SELECT id FROM public.salons WHERE user_id = (SELECT auth.uid()))$r$);

  PERFORM pg_temp.read_only_owner_policies('staff_availability', ARRAY['Users own staff availability'],
    $r$barber_id IN (SELECT b.id FROM public.barbers b JOIN public.salons s ON s.id = b.salon_id WHERE s.user_id = (SELECT auth.uid()))$r$);

  PERFORM pg_temp.read_only_owner_policies('barber_services',
    ARRAY['Owner can manage barber_services', 'Owner can read barber_services'],
    $r$salon_id IN (SELECT id FROM public.salons WHERE user_id = (SELECT auth.uid()))$r$);
END $$;


-- 3. salons: the owner reads and edits their own salon, read-only or not.
DO $$
DECLARE
  v_replaced boolean := EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'salons' AND policyname = 'salons: owner all');
BEGIN
  DROP POLICY IF EXISTS "salons: owner all" ON public.salons;

  DROP POLICY IF EXISTS "salons: owner select" ON public.salons;
  CREATE POLICY "salons: owner select"
    ON public.salons FOR SELECT TO authenticated
    USING (user_id = (SELECT auth.uid()));

  DROP POLICY IF EXISTS "salons: owner update" ON public.salons;
  CREATE POLICY "salons: owner update"
    ON public.salons FOR UPDATE TO authenticated
    USING (user_id = (SELECT auth.uid()))
    WITH CHECK (user_id = (SELECT auth.uid()));

  REVOKE INSERT, DELETE, TRUNCATE ON public.salons FROM authenticated;

  PERFORM pg_temp.read_only_note('salons',
    CASE WHEN v_replaced THEN 'replaced "salons: owner all": ' ELSE '' END
    || 'owner select and update; created and deleted by the server only');
END $$;


-- 4. reminders: the owner reads the reminders of their own appointments.
DO $$
DECLARE
  v_replaced boolean := EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reminders' AND policyname = 'reminders: owner all');
BEGIN
  DROP POLICY IF EXISTS "reminders: owner all" ON public.reminders;

  DROP POLICY IF EXISTS "reminders: owner select" ON public.reminders;
  CREATE POLICY "reminders: owner select"
    ON public.reminders FOR SELECT TO authenticated
    USING (
      appointment_id IN (
        SELECT id FROM public.appointments
        WHERE salon_id IN (
          SELECT id FROM public.salons WHERE user_id = (SELECT auth.uid())
        )
      )
    );

  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.reminders FROM authenticated;

  PERFORM pg_temp.read_only_note('reminders',
    CASE WHEN v_replaced THEN 'replaced "reminders: owner all": ' ELSE '' END
    || 'owner select; written by the server only');
END $$;


-- 5. Any other policy that lets signed-in users, anonymous visitors or
--    everyone write to these tables.
DO $$
DECLARE
  p         record;
  v_dropped text[] := '{}';
BEGIN
  FOR p IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('salons', 'barbers', 'services', 'clients', 'appointments', 'reminders',
                        'booking_pages', 'staff_availability', 'barber_services')
      AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
      AND roles && ARRAY['anon', 'authenticated', 'public']::name[]
      AND (tablename, policyname) NOT IN (
        SELECT t::name, (t || ': owner ' || c)::name
        FROM unnest(ARRAY['barbers', 'services', 'clients', 'appointments', 'booking_pages',
                          'staff_availability', 'barber_services']) AS t,
             unnest(ARRAY['insert', 'update', 'delete']) AS c
        UNION ALL
        SELECT 'salons', 'salons: owner update')
    ORDER BY tablename, policyname
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
    v_dropped := v_dropped || format('"%s" on %s', p.policyname, p.tablename);
  END LOOP;

  PERFORM pg_temp.read_only_note('Other write policies',
    CASE WHEN cardinality(v_dropped) = 0 THEN 'none found'
         ELSE 'dropped ' || array_to_string(v_dropped, ', ') END);
END $$;


-- 6. What this means for the accounts there are now.
DO $$
DECLARE
  v_write bigint;
  v_read  bigint;
BEGIN
  SELECT count(*) FILTER (WHERE public.owner_has_write_access(id)),
         count(*) FILTER (WHERE NOT public.owner_has_write_access(id))
  INTO v_write, v_read
  FROM public.users;

  PERFORM pg_temp.read_only_note('Accounts',
    format('%s can make changes, %s are read-only (trial ended or no active subscription)',
           v_write, v_read));
END $$;

COMMIT;

SELECT step, result FROM pg_temp.read_only_report ORDER BY seq;
