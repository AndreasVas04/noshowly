-- After every migration ran on top of problem_rows.sql: nothing failed, each
-- rule blocked by existing rows was skipped or left unvalidated, every other
-- change applied, no row was lost, and new rows are checked anyway.

BEGIN;

DO $$
DECLARE
  v_name text;
BEGIN
  -- Legacy plan names renamed; the new plan list is validated.
  PERFORM tests.expect_rows('legacy plans renamed', 3, format(
    $q$SELECT 1 FROM public.users WHERE (id, plan) IN ((%L, 'basic'), (%L, 'pro'), (%L, 'basic'))$q$,
    tests.id('owner_c'), tests.id('owner_d'), tests.id('owner_e')));

  -- Constraints that existing rows break: present, enforced, not validated.
  FOREACH v_name IN ARRAY ARRAY[
    'appointments_status_check', 'appointments_duration_minutes_check',
    'appointments_barber_id_salon_id_fkey', 'appointments_client_id_salon_id_fkey',
    'barber_services_barber_id_salon_id_fkey', 'services_price_check',
    'salons_business_hours_check', 'booking_pages_slug_format_check', 'reminders_status_check']
  LOOP
    PERFORM tests.expect(format('%s is added but not validated', v_name),
      EXISTS (SELECT 1 FROM pg_constraint
              WHERE connamespace = 'public'::regnamespace AND conname = v_name AND NOT convalidated));
  END LOOP;

  -- The single-column foreign keys are dropped even though the same-salon
  -- keys replacing them could not be validated, so PostgREST sees one
  -- relationship per pair of tables.
  PERFORM tests.expect_rows('one foreign key from appointments to clients', 1, $q$
    SELECT 1 FROM pg_constraint WHERE contype = 'f'
      AND conrelid = 'public.appointments'::regclass AND confrelid = 'public.clients'::regclass$q$);
  PERFORM tests.expect_rows('one foreign key from appointments to barbers', 1, $q$
    SELECT 1 FROM pg_constraint WHERE contype = 'f'
      AND conrelid = 'public.appointments'::regclass AND confrelid = 'public.barbers'::regclass$q$);
  PERFORM tests.expect_rows('one foreign key from barber_services to barbers', 1, $q$
    SELECT 1 FROM pg_constraint WHERE contype = 'f'
      AND conrelid = 'public.barber_services'::regclass AND confrelid = 'public.barbers'::regclass$q$);
  PERFORM tests.expect_rows('one foreign key from barber_services to services', 1, $q$
    SELECT 1 FROM pg_constraint WHERE contype = 'f'
      AND conrelid = 'public.barber_services'::regclass AND confrelid = 'public.services'::regclass$q$);

  -- Constraints no row breaks: validated.
  FOREACH v_name IN ARRAY ARRAY[
    'users_plan_check', 'reminders_type_check', 'services_duration_minutes_check',
    'barber_services_service_id_salon_id_fkey', 'barber_services_duration_minutes_override_check',
    'barber_services_price_override_check']
  LOOP
    PERFORM tests.expect(format('%s is validated', v_name),
      EXISTS (SELECT 1 FROM pg_constraint
              WHERE connamespace = 'public'::regnamespace AND conname = v_name AND convalidated));
  END LOOP;

  -- Unique rules and the double-booking constraint: skipped.
  PERFORM tests.expect('double-booking constraint skipped (overlapping appointments)',
    NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_no_double_booking'));
  PERFORM tests.expect('one-salon-per-owner skipped (owner C has two)',
    NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'salons_user_id_key'));
  PERFORM tests.expect('salons (user_id) indexed instead', to_regclass('public.idx_salons_user_id') IS NOT NULL);
  PERFORM tests.expect('case-insensitive slug index skipped (Salon-C and salon-c)',
    to_regclass('public.booking_pages_slug_lower_key') IS NULL);
  PERFORM tests.expect('Stripe customer index skipped (cus_shared twice)',
    to_regclass('public.users_stripe_customer_id_key') IS NULL);
  PERFORM tests.expect('one-reminder index skipped (two pending reminders for D1)',
    to_regclass('public.reminders_one_email_per_appointment') IS NULL);

  -- Reminders that can never be sent are skipped; nothing else changes.
  PERFORM tests.expect_rows('unsendable pending reminders marked skipped', 4, format(
    $q$SELECT 1 FROM public.reminders WHERE status = 'skipped' AND id IN (%L, %L, %L, %L)$q$,
    tests.id('reminder_no_token'), tests.id('reminder_c2_booking'),
    tests.id('reminder_e_past'), tests.id('reminder_e_cancelled')));
  PERFORM tests.expect_rows('other reminders unchanged', 4, format(
    $q$SELECT 1 FROM public.reminders WHERE (id, status) IN ((%L, 'sent'), (%L, 'pending'), (%L, 'pending'), (%L, 'whatever'))$q$,
    tests.id('reminder_c2_cron'), tests.id('reminder_d1_first'), tests.id('reminder_d1_second'),
    tests.id('reminder_bad_status')));

  -- Everything else applied.
  PERFORM tests.expect('staff_services dropped', to_regclass('public.staff_services') IS NULL);
  PERFORM tests.expect('services.created_at converted',
    (SELECT data_type FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'created_at')
    = 'timestamp with time zone');
  PERFORM tests.expect('public insert policy on appointments removed',
    NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public can create appointments via booking'));
  PERFORM tests.expect('anon cannot read barbers', NOT has_table_privilege('anon', 'public.barbers', 'SELECT'));
  PERFORM tests.expect('no public read policies left',
    NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'Public%'));

  -- No rows lost (staff_services was dropped on purpose).
  PERFORM tests.expect_rows('users kept', 3, 'SELECT * FROM public.users');
  PERFORM tests.expect_rows('salons kept', 4, 'SELECT * FROM public.salons');
  PERFORM tests.expect_rows('clients kept, duplicates included', 4, 'SELECT * FROM public.clients');
  PERFORM tests.expect_rows('appointments kept', 8, 'SELECT * FROM public.appointments');
  PERFORM tests.expect_rows('reminders kept', 8, 'SELECT * FROM public.reminders');
  PERFORM tests.expect_rows('booking pages kept', 3, 'SELECT * FROM public.booking_pages');
  PERFORM tests.expect_rows('staff assignments kept', 2, 'SELECT * FROM public.barber_services');

  -- Unvalidated constraints still reject new bad rows.
  PERFORM tests.as_service_role();
  PERFORM tests.expect_error('new appointment with an unknown status', '23514', format(
    $s$INSERT INTO public.appointments (salon_id, datetime, status) VALUES (%L, '2030-02-01 10:00+00', 'banana')$s$,
    tests.id('salon_d')));
  PERFORM tests.expect_error('new appointment with another salon''s barber', '23503', format(
    $s$INSERT INTO public.appointments (salon_id, barber_id, datetime) VALUES (%L, %L, '2030-02-01 10:00+00')$s$,
    tests.id('salon_d'), tests.id('barber_c1')));
  PERFORM tests.expect_error('new negative price', '23514', format(
    $s$UPDATE public.services SET price = -1 WHERE id = %L$s$, tests.id('service_d1')));
  PERFORM tests.expect_error('legacy plan name', '23514', format(
    $s$UPDATE public.users SET plan = 'starter' WHERE id = %L$s$, tests.id('owner_e')));
END $$;

ROLLBACK;
