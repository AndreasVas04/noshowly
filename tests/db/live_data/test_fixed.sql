-- After fix_rows.sql and a second run of every migration: every rule is in
-- place and validated.

BEGIN;

DO $$
DECLARE
  v_name text;
BEGIN
  PERFORM tests.expect_rows('no constraint left unvalidated', 0, $q$
    SELECT conname FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND NOT convalidated$q$);

  FOREACH v_name IN ARRAY ARRAY['appointments_no_double_booking', 'salons_user_id_key'] LOOP
    PERFORM tests.expect(format('%s added', v_name),
      EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conname = v_name));
  END LOOP;

  FOREACH v_name IN ARRAY ARRAY['booking_pages_slug_lower_key', 'users_stripe_customer_id_key',
                                'reminders_one_email_per_appointment'] LOOP
    PERFORM tests.expect(format('%s added', v_name), to_regclass(format('public.%I', v_name)) IS NOT NULL);
  END LOOP;

  PERFORM tests.expect('fallback index on salons (user_id) removed',
    to_regclass('public.idx_salons_user_id') IS NULL);

  PERFORM tests.as_service_role();
  PERFORM tests.expect_error('double booking now rejected', '23P01', format(
    $s$UPDATE public.appointments SET status = 'confirmed' WHERE id = %L$s$, tests.id('appointment_c2')));
END $$;

ROLLBACK;
