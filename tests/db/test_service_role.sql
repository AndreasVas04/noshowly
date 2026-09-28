-- The server's service-role key bypasses Row Level Security, but the
-- constraints still apply to it.

BEGIN;

DO $$
BEGIN
  PERFORM tests.as_service_role();

  PERFORM tests.expect_rows('service role: reads every salon', 3, 'SELECT * FROM public.salons');
  PERFORM tests.expect_rows('service role: reads every user', 3, 'SELECT * FROM public.users');
  PERFORM tests.expect_rows('service role: reads every appointment', 3, 'SELECT * FROM public.appointments');
  PERFORM tests.expect_rows('service role: reads every reminder', 2, 'SELECT * FROM public.reminders');

  -- Stripe webhook, cron counters, sign-up.
  PERFORM tests.expect_changed('service role: change a plan', 1, format(
    $s$UPDATE public.users SET plan = 'pro', stripe_customer_id = 'cus_owner_b' WHERE id = %L$s$,
    tests.id('owner_b')));
  PERFORM tests.expect_changed('service role: reset usage counters', 1, format(
    $s$UPDATE public.users SET reminders_used_this_month = 0, email_reminders_used_this_month = 0,
         reminders_reset_at = '2030-02-01' WHERE id = %L$s$, tests.id('owner_a')));

  -- Public booking route: client, appointment and reminders in any salon.
  PERFORM tests.expect_changed('service role: create a client', 1, format(
    $s$INSERT INTO public.clients (id, salon_id, name, phone) VALUES (%L, %L, 'Walk-in', '+30690000002')$s$,
    tests.id('client_b2'), tests.id('salon_b')));
  PERFORM tests.expect_changed('service role: create an appointment', 1, format(
    $s$INSERT INTO public.appointments (id, salon_id, barber_id, client_id, datetime, duration_minutes)
       VALUES (%L, %L, %L, %L, '2030-01-08 10:00+00', 20)$s$,
    tests.id('appointment_b2'), tests.id('salon_b'), tests.id('barber_b1'), tests.id('client_b2')));
  PERFORM tests.expect_changed('service role: record a booking confirmation', 1, format(
    $s$INSERT INTO public.reminders (appointment_id, type, send_at, sent_at, status)
       VALUES (%L, 'email_confirmation', now(), now(), 'sent')$s$,
    tests.id('appointment_b2')));

  -- Constraints are not bypassed.
  PERFORM tests.expect_error('service role: book barber B1 in salon A', '23503', format(
    $s$INSERT INTO public.appointments (salon_id, barber_id, datetime) VALUES (%L, %L, '2030-02-01 10:00+00')$s$,
    tests.id('salon_a'), tests.id('barber_b1')));
  PERFORM tests.expect_error('service role: set an unknown plan', '23514', format(
    $s$UPDATE public.users SET plan = 'starter' WHERE id = %L$s$, tests.id('owner_b')));

  -- Account deletion (/api/account) removes the salon and everything in it.
  PERFORM tests.expect_changed('service role: delete salon B', 1, format(
    $s$DELETE FROM public.salons WHERE id = %L$s$, tests.id('salon_b')));
  PERFORM tests.expect_rows('service role: salon B data removed', 0, format(
    $s$SELECT id FROM public.barbers WHERE salon_id = %1$L
       UNION ALL SELECT id FROM public.clients WHERE salon_id = %1$L
       UNION ALL SELECT id FROM public.appointments WHERE salon_id = %1$L
       UNION ALL SELECT id FROM public.services WHERE salon_id = %1$L
       UNION ALL SELECT id FROM public.booking_pages WHERE salon_id = %1$L$s$,
    tests.id('salon_b')));
  PERFORM tests.expect_rows('service role: salon B reminders removed', 0, format(
    $s$SELECT * FROM public.reminders WHERE appointment_id IN (%L, %L)$s$,
    tests.id('appointment_b1'), tests.id('appointment_b2')));
  PERFORM tests.expect_rows('service role: salon A untouched', 2, format(
    $s$SELECT * FROM public.appointments WHERE salon_id = %L$s$, tests.id('salon_a')));
END $$;

ROLLBACK;
