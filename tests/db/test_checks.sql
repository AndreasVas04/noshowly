-- CHECK constraints and unique rules from 20260928130000_data_integrity.sql.
-- Run as the service role, which bypasses Row Level Security but not these.

BEGIN;

DO $$
DECLARE
  v_appointment text := $s$INSERT INTO public.appointments (salon_id, datetime, duration_minutes, status)
                           VALUES (%L, '2030-03-01 10:00+00', %s, %L)$s$;
  v_reminder    text := $s$INSERT INTO public.reminders (appointment_id, type, send_at, status)
                           VALUES (%L, %L, now(), %L)$s$;
BEGIN
  PERFORM tests.as_service_role();

  -- Appointments.
  PERFORM tests.expect_error('appointment status banana', '23514',
    format(v_appointment, tests.id('salon_a'), 30, 'banana'));
  PERFORM tests.expect_error('appointment status completed', '23514',
    format(v_appointment, tests.id('salon_a'), 30, 'completed'));
  PERFORM tests.expect_error('appointment of 0 minutes', '23514',
    format(v_appointment, tests.id('salon_a'), 0, 'scheduled'));
  PERFORM tests.expect_error('appointment of 481 minutes', '23514',
    format(v_appointment, tests.id('salon_a'), 481, 'scheduled'));
  PERFORM tests.expect_error('appointment of -30 minutes', '23514',
    format(v_appointment, tests.id('salon_a'), -30, 'scheduled'));
  PERFORM tests.expect_changed('appointment of 1 minute', 1,
    format(v_appointment, tests.id('salon_a'), 1, 'scheduled'));
  PERFORM tests.expect_changed('appointment of 480 minutes', 1,
    format(v_appointment, tests.id('salon_a'), 480, 'confirmed'));
  PERFORM tests.expect_error('change appointment A1 to an unknown status', '23514', format(
    $s$UPDATE public.appointments SET status = 'no_show' WHERE id = %L$s$, tests.id('appointment_a1')));

  -- Reminders.
  PERFORM tests.expect_error('reminder type carrier-pigeon', '23514',
    format(v_reminder, tests.id('appointment_a2'), 'carrier-pigeon', 'pending'));
  PERFORM tests.expect_error('reminder status whatever', '23514',
    format(v_reminder, tests.id('appointment_a2'), 'email', 'whatever'));
  PERFORM tests.expect_changed('reminder type email_confirmation', 1,
    format(v_reminder, tests.id('appointment_a2'), 'email_confirmation', 'sent'));
  PERFORM tests.expect_changed('reminder type email_test', 1,
    format(v_reminder, tests.id('appointment_a2'), 'email_test', 'failed'));
  PERFORM tests.expect_changed('legacy reminder type sms', 1,
    format(v_reminder, tests.id('appointment_a2'), 'sms', 'cancelled'));
  PERFORM tests.expect_changed('reminder status skipped', 1,
    format(v_reminder, tests.id('appointment_a2'), 'email', 'skipped'));

  -- Services and per-staff overrides. NULL means "not set" and is allowed.
  PERFORM tests.expect_error('service of 0 minutes', '23514', format(
    $s$INSERT INTO public.services (salon_id, name, duration_minutes) VALUES (%L, 'Nothing', 0)$s$,
    tests.id('salon_a')));
  PERFORM tests.expect_error('service of 481 minutes', '23514', format(
    $s$UPDATE public.services SET duration_minutes = 481 WHERE id = %L$s$, tests.id('service_a')));
  PERFORM tests.expect_error('service with a negative price', '23514', format(
    $s$UPDATE public.services SET price = -0.01 WHERE id = %L$s$, tests.id('service_a')));
  PERFORM tests.expect_changed('service without duration or price', 1, format(
    $s$INSERT INTO public.services (salon_id, name) VALUES (%L, 'Consultation')$s$, tests.id('salon_a')));
  PERFORM tests.expect_changed('free service', 1, format(
    $s$UPDATE public.services SET price = 0 WHERE id = %L$s$, tests.id('service_a')));
  PERFORM tests.expect_error('override of 0 minutes', '23514', format(
    $s$UPDATE public.barber_services SET duration_minutes_override = 0 WHERE id = %L$s$,
    tests.id('barber_service_a1')));
  PERFORM tests.expect_error('override with a negative price', '23514', format(
    $s$UPDATE public.barber_services SET price_override = -1 WHERE id = %L$s$,
    tests.id('barber_service_a1')));
  PERFORM tests.expect_changed('overrides cleared', 1, format(
    $s$UPDATE public.barber_services SET duration_minutes_override = NULL, price_override = NULL WHERE id = %L$s$,
    tests.id('barber_service_a1')));

  -- Business hours.
  PERFORM tests.expect_error('closing before opening', '23514', format(
    $s$UPDATE public.salons SET opening_time = '19:00', closing_time = '09:00' WHERE id = %L$s$,
    tests.id('salon_a')));
  PERFORM tests.expect_error('closing at opening time', '23514', format(
    $s$UPDATE public.salons SET opening_time = '09:00', closing_time = '09:00' WHERE id = %L$s$,
    tests.id('salon_a')));
  PERFORM tests.expect_changed('only an opening time', 1, format(
    $s$UPDATE public.salons SET opening_time = '10:00', closing_time = NULL WHERE id = %L$s$,
    tests.id('salon_a')));

  -- Booking page slugs: same rule as /api/booking-page.
  PERFORM tests.expect_error('slug with capitals', '23514', format(
    $s$UPDATE public.booking_pages SET slug = 'Salon-A' WHERE id = %L$s$, tests.id('page_a')));
  PERFORM tests.expect_error('slug with a space', '23514', format(
    $s$UPDATE public.booking_pages SET slug = 'salon a' WHERE id = %L$s$, tests.id('page_a')));
  PERFORM tests.expect_error('slug with an underscore', '23514', format(
    $s$UPDATE public.booking_pages SET slug = 'salon_a' WHERE id = %L$s$, tests.id('page_a')));
  PERFORM tests.expect_error('slug taken by another salon', '23505', format(
    $s$UPDATE public.booking_pages SET slug = 'salon-b' WHERE id = %L$s$, tests.id('page_a')));
  PERFORM tests.expect_changed('valid slug', 1, format(
    $s$UPDATE public.booking_pages SET slug = 'salon-a-2' WHERE id = %L$s$, tests.id('page_a')));

  -- Plans.
  PERFORM tests.expect_error('legacy plan starter', '23514', format(
    $s$UPDATE public.users SET plan = 'starter' WHERE id = %L$s$, tests.id('owner_b')));
  PERFORM tests.expect_error('legacy plan solo-sms', '23514', format(
    $s$UPDATE public.users SET plan = 'solo-sms' WHERE id = %L$s$, tests.id('owner_b')));
  PERFORM tests.expect_changed('plan business', 1, format(
    $s$UPDATE public.users SET plan = 'business' WHERE id = %L$s$, tests.id('owner_b')));
  PERFORM tests.expect_changed('plan cancelled', 1, format(
    $s$UPDATE public.users SET plan = 'cancelled' WHERE id = %L$s$, tests.id('owner_b')));

  -- One account per Stripe customer, one salon per owner.
  PERFORM tests.expect_error('Stripe customer shared by two accounts', '23505', format(
    $s$UPDATE public.users SET stripe_customer_id = 'cus_owner_a' WHERE id = %L$s$, tests.id('owner_b')));
  PERFORM tests.expect_changed('several accounts without a Stripe customer', 2, format(
    $s$UPDATE public.users SET stripe_customer_id = NULL WHERE id IN (%L, %L)$s$,
    tests.id('owner_b'), tests.id('demo')));
  PERFORM tests.expect_error('second salon for owner A', '23505', format(
    $s$INSERT INTO public.salons (user_id, name) VALUES (%L, 'Second salon')$s$, tests.id('owner_a')));
END $$;

ROLLBACK;
