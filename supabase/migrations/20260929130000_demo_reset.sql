-- Migration: nightly reset of the public demo account.
--
-- The demo account (demo@noshowly.com) is shared: anyone can sign in and
-- change its staff, services, clients and appointments, or leave it in a
-- state the next visitor should not see. This keeps it presentable:
--
--   1. private.demo_snapshot holds a copy of the demo salon: its settings,
--      booking page, staff, services, staff services, weekly availability,
--      clients and appointments. public.take_demo_snapshot() takes it; run it
--      whenever the demo looks the way it should:
--          SELECT public.take_demo_snapshot();
--   2. public.reset_demo_data() puts the demo salon back to that copy. It
--      removes what visitors added, restores what they changed or deleted,
--      and moves every appointment by the whole days since the snapshot, in
--      the salon's timezone, so the calendar is always around today with the
--      same wall-clock times. It also keeps the demo account on the Basic
--      plan with its email counter at zero, so the demo is never read-only.
--      Without a snapshot it only does the latter.
--   3. A pg_cron job, "noshowly-reset-demo", runs the reset every night at
--      01:30 UTC. It is created when pg_cron is available and no job runs the
--      reset yet.
--
-- Rows are restored with their original ids and every column the app uses. A
-- column added to one of these tables later gets its default until
-- reset_demo_data() restores it too; take a new snapshot after such a change.
--
-- private is not an API schema: anonymous and signed-in users cannot read the
-- snapshot or run either function. Only the service role and the database
-- owner (SQL Editor, pg_cron) can.
--
-- Safe to run on the live project, and safe to run again. Everything runs in
-- one transaction, and the file itself neither takes a snapshot nor resets
-- anything. The SQL Editor does not show notices, so the last query lists
-- what each step did.

BEGIN;

CREATE TEMP TABLE IF NOT EXISTS demo_reset_report (seq serial, step text, result text);
TRUNCATE pg_temp.demo_reset_report RESTART IDENTITY;

CREATE OR REPLACE FUNCTION pg_temp.demo_reset_note(p_step text, p_result text) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE NOTICE '%: %', p_step, p_result;
  INSERT INTO pg_temp.demo_reset_report (step, result) VALUES (p_step, p_result);
END;
$$;


-- 1. The snapshot, in a schema the API does not expose.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON SCHEMA private FROM anon, authenticated;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS private.demo_snapshot (
  -- One row at most.
  id                 boolean PRIMARY KEY DEFAULT true CHECK (id),
  taken_at           timestamptz NOT NULL DEFAULT now(),
  salon              jsonb NOT NULL,
  booking_page       jsonb,
  barbers            jsonb NOT NULL DEFAULT '[]',
  services           jsonb NOT NULL DEFAULT '[]',
  barber_services    jsonb NOT NULL DEFAULT '[]',
  staff_availability jsonb NOT NULL DEFAULT '[]',
  clients            jsonb NOT NULL DEFAULT '[]',
  appointments       jsonb NOT NULL DEFAULT '[]'
);
REVOKE ALL ON TABLE private.demo_snapshot FROM PUBLIC;

DO $$
BEGIN
  PERFORM pg_temp.demo_reset_note('private.demo_snapshot',
    CASE WHEN EXISTS (SELECT 1 FROM private.demo_snapshot)
         THEN 'in place, holds a snapshot'
         ELSE 'in place, empty: run SELECT public.take_demo_snapshot(); when the demo looks right' END);
END $$;


-- 2. The demo salon: the salon of the demo@noshowly.com account.
CREATE OR REPLACE FUNCTION private.demo_salon_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT s.id
  FROM public.salons s
  JOIN auth.users u ON u.id = s.user_id
  WHERE pg_catalog.lower(u.email) = 'demo@noshowly.com'
  ORDER BY s.created_at
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION private.demo_salon_id() FROM PUBLIC;


-- 3. Take the snapshot (replaces the previous one).
CREATE OR REPLACE FUNCTION public.take_demo_snapshot()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_salon uuid := private.demo_salon_id();
  v_snap  private.demo_snapshot%ROWTYPE;
BEGIN
  IF v_salon IS NULL THEN
    RETURN 'skipped: there is no salon for demo@noshowly.com';
  END IF;

  INSERT INTO private.demo_snapshot AS d (
    id, taken_at, salon, booking_page, barbers, services, barber_services,
    staff_availability, clients, appointments)
  SELECT
    true,
    pg_catalog.now(),
    (SELECT pg_catalog.to_jsonb(s) FROM public.salons s WHERE s.id = v_salon),
    (SELECT pg_catalog.to_jsonb(p) FROM public.booking_pages p
      WHERE p.salon_id = v_salon ORDER BY p.created_at LIMIT 1),
    COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(b) ORDER BY b.created_at, b.id)
              FROM public.barbers b WHERE b.salon_id = v_salon), '[]'),
    COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(v) ORDER BY v.created_at, v.id)
              FROM public.services v WHERE v.salon_id = v_salon), '[]'),
    COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(bs) ORDER BY bs.created_at, bs.id)
              FROM public.barber_services bs WHERE bs.salon_id = v_salon), '[]'),
    COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) ORDER BY a.barber_id, a.day_of_week)
              FROM public.staff_availability a
              JOIN public.barbers b ON b.id = a.barber_id
              WHERE b.salon_id = v_salon), '[]'),
    COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(c) ORDER BY c.created_at, c.id)
              FROM public.clients c WHERE c.salon_id = v_salon), '[]'),
    COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(ap) ORDER BY ap.datetime, ap.id)
              FROM public.appointments ap WHERE ap.salon_id = v_salon), '[]')
  ON CONFLICT (id) DO UPDATE SET
    taken_at           = excluded.taken_at,
    salon              = excluded.salon,
    booking_page       = excluded.booking_page,
    barbers            = excluded.barbers,
    services           = excluded.services,
    barber_services    = excluded.barber_services,
    staff_availability = excluded.staff_availability,
    clients            = excluded.clients,
    appointments       = excluded.appointments
  RETURNING * INTO v_snap;

  RETURN pg_catalog.format(
    'snapshot taken: %s staff, %s services, %s clients, %s appointments',
    pg_catalog.jsonb_array_length(v_snap.barbers),
    pg_catalog.jsonb_array_length(v_snap.services),
    pg_catalog.jsonb_array_length(v_snap.clients),
    pg_catalog.jsonb_array_length(v_snap.appointments));
END;
$$;


-- 4. Put the demo salon back to the snapshot.
CREATE OR REPLACE FUNCTION public.reset_demo_data()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_salon uuid := private.demo_salon_id();
  v_user  uuid;
  v_snap  private.demo_snapshot%ROWTYPE;
  v_tz    text;
  v_days  integer;
  v_page  public.booking_pages%ROWTYPE;
BEGIN
  IF v_salon IS NULL THEN
    RETURN 'skipped: there is no salon for demo@noshowly.com';
  END IF;
  SELECT s.user_id INTO v_user FROM public.salons s WHERE s.id = v_salon;

  -- The demo account can be used by anyone at any time: keep it on a paid
  -- plan, never linked to a Stripe customer, with its email counter at zero.
  UPDATE public.users
  SET plan = 'basic', stripe_customer_id = NULL, email_reminders_used_this_month = 0
  WHERE id = v_user;

  SELECT * INTO v_snap FROM private.demo_snapshot WHERE id;
  IF NOT FOUND THEN
    RETURN 'demo account kept on the Basic plan; no snapshot to restore '
           '(SELECT public.take_demo_snapshot(); takes one)';
  END IF;

  -- Whole days since the snapshot, in the salon's timezone.
  v_tz := COALESCE(v_snap.salon->>'timezone', 'UTC');
  v_days := (pg_catalog.now() AT TIME ZONE v_tz)::date - (v_snap.taken_at AT TIME ZONE v_tz)::date;

  -- Remove everything visitors added or changed. Deleting appointments
  -- deletes their reminders; deleting staff deletes their services and
  -- availability.
  DELETE FROM public.appointments WHERE salon_id = v_salon;
  DELETE FROM public.barbers WHERE salon_id = v_salon;
  DELETE FROM public.services WHERE salon_id = v_salon;
  DELETE FROM public.clients WHERE salon_id = v_salon;

  -- Salon settings.
  UPDATE public.salons s SET
    name                       = r.name,
    phone                      = r.phone,
    timezone                   = r.timezone,
    opening_time               = r.opening_time,
    closing_time               = r.closing_time,
    email_confirmation_enabled = r.email_confirmation_enabled,
    currency                   = r.currency,
    email_subject              = r.email_subject,
    email_greeting             = r.email_greeting,
    email_body                 = r.email_body,
    email_closing              = r.email_closing,
    email_footer               = r.email_footer
  FROM pg_catalog.jsonb_populate_record(NULL::public.salons, v_snap.salon) r
  WHERE s.id = v_salon;

  -- Booking page. Its address is only restored while no other page has it.
  IF v_snap.booking_page IS NOT NULL THEN
    SELECT * INTO v_page FROM pg_catalog.jsonb_populate_record(NULL::public.booking_pages, v_snap.booking_page);
    IF EXISTS (SELECT 1 FROM public.booking_pages p WHERE p.id = v_page.id) THEN
      UPDATE public.booking_pages p SET
        slug          = CASE WHEN EXISTS (
                          SELECT 1 FROM public.booking_pages o
                          WHERE pg_catalog.lower(o.slug) = pg_catalog.lower(v_page.slug) AND o.id <> v_page.id)
                        THEN p.slug ELSE v_page.slug END,
        is_active     = v_page.is_active,
        description   = v_page.description,
        custom_title  = v_page.custom_title,
        custom_intro  = v_page.custom_intro,
        require_phone = v_page.require_phone,
        require_email = v_page.require_email
      WHERE p.id = v_page.id;
    ELSIF NOT EXISTS (SELECT 1 FROM public.booking_pages p WHERE p.salon_id = v_salon)
          AND NOT EXISTS (SELECT 1 FROM public.booking_pages o
                          WHERE pg_catalog.lower(o.slug) = pg_catalog.lower(v_page.slug)) THEN
      INSERT INTO public.booking_pages
        (id, salon_id, slug, is_active, description, created_at, custom_title, custom_intro,
         require_phone, require_email)
      VALUES
        (v_page.id, v_salon, v_page.slug, v_page.is_active, v_page.description, v_page.created_at,
         v_page.custom_title, v_page.custom_intro, v_page.require_phone, v_page.require_email);
    END IF;
  END IF;

  -- Staff, services, who does what, weekly availability and clients.
  INSERT INTO public.barbers (id, salon_id, name, created_at, photo_url, bio, active)
  SELECT id, v_salon, name, created_at, photo_url, bio, active
  FROM pg_catalog.jsonb_populate_recordset(NULL::public.barbers, v_snap.barbers);

  INSERT INTO public.services (id, salon_id, name, created_at, duration_minutes, price, active)
  SELECT id, v_salon, name, created_at, duration_minutes, price, active
  FROM pg_catalog.jsonb_populate_recordset(NULL::public.services, v_snap.services);

  INSERT INTO public.barber_services
    (id, salon_id, barber_id, service_id, created_at, price_override, duration_minutes_override)
  SELECT id, v_salon, barber_id, service_id, created_at, price_override, duration_minutes_override
  FROM pg_catalog.jsonb_populate_recordset(NULL::public.barber_services, v_snap.barber_services);

  INSERT INTO public.staff_availability
    (id, barber_id, day_of_week, is_available, start_time_1, end_time_1, start_time_2, end_time_2,
     time_slots)
  SELECT id, barber_id, day_of_week, is_available, start_time_1, end_time_1, start_time_2, end_time_2,
         time_slots
  FROM pg_catalog.jsonb_populate_recordset(NULL::public.staff_availability, v_snap.staff_availability);

  INSERT INTO public.clients (id, salon_id, name, phone, email, notes, created_at)
  SELECT id, v_salon, name, phone, email, notes, created_at
  FROM pg_catalog.jsonb_populate_recordset(NULL::public.clients, v_snap.clients);

  -- Appointments, moved by whole days with the same wall-clock time (also
  -- across a daylight saving change).
  INSERT INTO public.appointments
    (id, salon_id, client_id, barber_id, datetime, service_type, duration_minutes, notes, status,
     created_at)
  SELECT id, v_salon, client_id, barber_id,
         ((datetime AT TIME ZONE v_tz) + pg_catalog.make_interval(days => v_days)) AT TIME ZONE v_tz,
         service_type, duration_minutes, notes, status, created_at
  FROM pg_catalog.jsonb_populate_recordset(NULL::public.appointments, v_snap.appointments);

  RETURN pg_catalog.format(
    'restored the snapshot of %s (appointments moved %s day(s)): %s staff, %s services, %s clients, %s appointments',
    (v_snap.taken_at AT TIME ZONE v_tz)::date, v_days,
    pg_catalog.jsonb_array_length(v_snap.barbers),
    pg_catalog.jsonb_array_length(v_snap.services),
    pg_catalog.jsonb_array_length(v_snap.clients),
    pg_catalog.jsonb_array_length(v_snap.appointments));
END;
$$;

-- Only the service role and the database owner run these.
REVOKE ALL ON FUNCTION public.take_demo_snapshot() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_demo_data() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.take_demo_snapshot() FROM anon, authenticated;
    REVOKE ALL ON FUNCTION public.reset_demo_data() FROM anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.take_demo_snapshot() TO service_role;
    GRANT EXECUTE ON FUNCTION public.reset_demo_data() TO service_role;
  END IF;
  PERFORM pg_temp.demo_reset_note('take_demo_snapshot(), reset_demo_data()',
    'in place, callable by the service role and the database owner only');
END $$;


-- 5. The nightly job.
DO $$
DECLARE
  v_result text;
BEGIN
  IF to_regprocedure('cron.schedule(text,text,text)') IS NULL
     AND EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  END IF;

  IF to_regprocedure('cron.schedule(text,text,text)') IS NULL THEN
    v_result := 'skipped: the pg_cron extension is not available';
  ELSIF EXISTS (SELECT 1 FROM cron.job WHERE command ILIKE '%reset_demo_data%') THEN
    v_result := 'already scheduled, unchanged';
  ELSE
    PERFORM cron.schedule('noshowly-reset-demo', '30 1 * * *', 'SELECT public.reset_demo_data()');
    v_result := 'scheduled as "noshowly-reset-demo", every night at 01:30 UTC';
  END IF;

  PERFORM pg_temp.demo_reset_note('Nightly reset job', v_result);
EXCEPTION
  WHEN OTHERS THEN
    PERFORM pg_temp.demo_reset_note('Nightly reset job', 'skipped: ' || SQLERRM);
END $$;

COMMIT;

SELECT step, result FROM pg_temp.demo_reset_report ORDER BY seq;
