-- Anonymous visitors (the anon key without a session) after
-- 20260928140000_private_booking_reads.sql: no access to any Noshowly table,
-- apart from salons.id for the keep-alive workflow, which sees no rows.

BEGIN;

DO $$
DECLARE
  t text;
BEGIN
  PERFORM tests.as_anon();

  -- .github/workflows/keep-alive.yml: GET /rest/v1/salons?select=id&limit=1
  PERFORM tests.expect_rows('anon: keep-alive query succeeds and returns no rows', 0,
    'SELECT id FROM public.salons LIMIT 1');

  PERFORM tests.expect_error('anon: read salon names', '42501',
    'SELECT name FROM public.salons');

  FOREACH t IN ARRAY ARRAY['users', 'barbers', 'clients', 'appointments', 'reminders',
                           'services', 'booking_pages', 'staff_availability', 'barber_services']
  LOOP
    PERFORM tests.expect_error(format('anon: read %s', t), '42501',
      format('SELECT * FROM public.%I', t));
  END LOOP;

  PERFORM tests.expect_error('anon: create an appointment', '42501', format(
    $s$INSERT INTO public.appointments (salon_id, datetime) VALUES (%L, '2030-02-01 10:00+00')$s$,
    tests.id('salon_a')));

  PERFORM tests.expect_error('anon: create a client', '42501', format(
    $s$INSERT INTO public.clients (salon_id, name) VALUES (%L, 'Mallory')$s$,
    tests.id('salon_a')));

  PERFORM tests.expect_error('anon: create a reminder', '42501', format(
    $s$INSERT INTO public.reminders (appointment_id, type, send_at) VALUES (%L, 'email', now())$s$,
    tests.id('appointment_a1')));

  PERFORM tests.expect_error('anon: cancel an appointment', '42501', format(
    $s$UPDATE public.appointments SET status = 'cancelled' WHERE id = %L$s$,
    tests.id('appointment_a1')));

  PERFORM tests.expect_error('anon: delete a salon', '42501', format(
    $s$DELETE FROM public.salons WHERE id = %L$s$,
    tests.id('salon_a')));

  PERFORM tests.expect_error('anon: salon_is_bookable() no longer exists', '42883', format(
    $s$SELECT public.salon_is_bookable(%L)$s$,
    tests.id('salon_a')));
END $$;

ROLLBACK;
