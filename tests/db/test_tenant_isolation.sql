-- Owner A, signed in, against owner B's salon and against A's own billing
-- fields.

BEGIN;

DO $$
DECLARE
  t text;
BEGIN
  PERFORM tests.sign_in('owner_a');

  -- Billing and usage fields are written by the server only.
  PERFORM tests.expect_rows('owner A: reads own users row only', 1,
    'SELECT * FROM public.users');
  PERFORM tests.expect_error('owner A: change own plan', '42501', format(
    $s$UPDATE public.users SET plan = 'business' WHERE id = %L$s$, tests.id('owner_a')));
  PERFORM tests.expect_error('owner A: extend own trial', '42501', format(
    $s$UPDATE public.users SET trial_ends_at = '2099-01-01' WHERE id = %L$s$, tests.id('owner_a')));
  PERFORM tests.expect_error('owner A: reset own usage counter', '42501', format(
    $s$UPDATE public.users SET email_reminders_used_this_month = 0 WHERE id = %L$s$, tests.id('owner_a')));
  PERFORM tests.expect_error('owner A: change own Stripe customer', '42501', format(
    $s$UPDATE public.users SET stripe_customer_id = 'cus_other' WHERE id = %L$s$, tests.id('owner_a')));
  PERFORM tests.expect_error('owner A: delete own users row', '42501', format(
    $s$DELETE FROM public.users WHERE id = %L$s$, tests.id('owner_a')));

  -- Salon B's rows are invisible.
  PERFORM tests.expect_rows('owner A: sees only own salon', 1, 'SELECT * FROM public.salons');
  PERFORM tests.expect_rows('owner A: sees only own barbers', 2, 'SELECT * FROM public.barbers');
  PERFORM tests.expect_rows('owner A: sees only own clients', 2, 'SELECT * FROM public.clients');
  PERFORM tests.expect_rows('owner A: sees only own appointments', 2, 'SELECT * FROM public.appointments');
  PERFORM tests.expect_rows('owner A: sees only own reminders', 1, 'SELECT * FROM public.reminders');
  PERFORM tests.expect_rows('owner A: sees only own services', 1, 'SELECT * FROM public.services');
  PERFORM tests.expect_rows('owner A: sees only own booking page', 1, 'SELECT * FROM public.booking_pages');
  PERFORM tests.expect_rows('owner A: sees only own staff assignments', 1, 'SELECT * FROM public.barber_services');
  PERFORM tests.expect_rows('owner A: sees only own availability', 1, 'SELECT * FROM public.staff_availability');

  -- Salon B's rows cannot be changed or deleted.
  PERFORM tests.expect_changed('owner A: rename salon B', 0, format(
    $s$UPDATE public.salons SET name = 'Hijacked' WHERE id = %L$s$, tests.id('salon_b')));
  PERFORM tests.expect_changed('owner A: rename barber B1', 0, format(
    $s$UPDATE public.barbers SET name = 'Hijacked' WHERE id = %L$s$, tests.id('barber_b1')));
  PERFORM tests.expect_changed('owner A: cancel appointment B1', 0, format(
    $s$UPDATE public.appointments SET status = 'cancelled' WHERE id = %L$s$, tests.id('appointment_b1')));
  -- Owners cannot write reminders at all (the server does).
  PERFORM tests.expect_error('owner A: mark reminder B1 sent', '42501', format(
    $s$UPDATE public.reminders SET status = 'sent' WHERE id = %L$s$, tests.id('reminder_b1')));
  PERFORM tests.expect_changed('owner A: take over booking page B', 0, format(
    $s$UPDATE public.booking_pages SET slug = 'mine' WHERE id = %L$s$, tests.id('page_b')));
  PERFORM tests.expect_changed('owner A: reprice service B', 0, format(
    $s$UPDATE public.services SET price = 0 WHERE id = %L$s$, tests.id('service_b')));
  PERFORM tests.expect_changed('owner A: delete client B1', 0, format(
    $s$DELETE FROM public.clients WHERE id = %L$s$, tests.id('client_b1')));
  PERFORM tests.expect_changed('owner A: delete appointment B1', 0, format(
    $s$DELETE FROM public.appointments WHERE id = %L$s$, tests.id('appointment_b1')));
  PERFORM tests.expect_changed('owner A: delete barber B1', 0, format(
    $s$DELETE FROM public.barbers WHERE id = %L$s$, tests.id('barber_b1')));

  -- Rows cannot be created in salon B.
  PERFORM tests.expect_error('owner A: add a barber to salon B', '42501', format(
    $s$INSERT INTO public.barbers (salon_id, name) VALUES (%L, 'Mallory')$s$, tests.id('salon_b')));
  PERFORM tests.expect_error('owner A: add a client to salon B', '42501', format(
    $s$INSERT INTO public.clients (salon_id, name) VALUES (%L, 'Mallory')$s$, tests.id('salon_b')));
  PERFORM tests.expect_error('owner A: add a service to salon B', '42501', format(
    $s$INSERT INTO public.services (salon_id, name) VALUES (%L, 'Free')$s$, tests.id('salon_b')));
  PERFORM tests.expect_error('owner A: add an appointment to salon B', '42501', format(
    $s$INSERT INTO public.appointments (salon_id, datetime) VALUES (%L, '2030-02-01 10:00+00')$s$,
    tests.id('salon_b')));
  PERFORM tests.expect_error('owner A: add a reminder to appointment B1', '42501', format(
    $s$INSERT INTO public.reminders (appointment_id, type, send_at) VALUES (%L, 'email', now())$s$,
    tests.id('appointment_b1')));
  PERFORM tests.expect_error('owner A: set availability for barber B1', '42501', format(
    $s$INSERT INTO public.staff_availability (barber_id, day_of_week) VALUES (%L, 3)$s$,
    tests.id('barber_b1')));
  PERFORM tests.expect_error('owner A: add a staff assignment to salon B', '42501', format(
    $s$INSERT INTO public.barber_services (salon_id, barber_id, service_id) VALUES (%L, %L, %L)$s$,
    tests.id('salon_b'), tests.id('barber_b1'), tests.id('service_b')));
  PERFORM tests.expect_error('owner A: create a salon for owner B', '42501', format(
    $s$INSERT INTO public.salons (user_id, name) VALUES (%L, 'Mine')$s$, tests.id('owner_b')));

  -- Own rows cannot be moved into salon B.
  PERFORM tests.expect_error('owner A: move barber A2 to salon B', '42501', format(
    $s$UPDATE public.barbers SET salon_id = %L WHERE id = %L$s$,
    tests.id('salon_b'), tests.id('barber_a2')));
  PERFORM tests.expect_error('owner A: move appointment A1 to salon B', '42501', format(
    $s$UPDATE public.appointments SET salon_id = %L WHERE id = %L$s$,
    tests.id('salon_b'), tests.id('appointment_a1')));

  -- Own rows cannot point at salon B's barbers, clients or services.
  PERFORM tests.expect_error('owner A: book barber B1 in salon A', '23503', format(
    $s$INSERT INTO public.appointments (salon_id, barber_id, datetime) VALUES (%L, %L, '2030-02-01 10:00+00')$s$,
    tests.id('salon_a'), tests.id('barber_b1')));
  PERFORM tests.expect_error('owner A: book client B1 in salon A', '23503', format(
    $s$INSERT INTO public.appointments (salon_id, client_id, datetime) VALUES (%L, %L, '2030-02-01 10:00+00')$s$,
    tests.id('salon_a'), tests.id('client_b1')));
  PERFORM tests.expect_error('owner A: reassign appointment A1 to barber B1', '23503', format(
    $s$UPDATE public.appointments SET barber_id = %L, datetime = '2030-03-01 10:00+00' WHERE id = %L$s$,
    tests.id('barber_b1'), tests.id('appointment_a1')));
  PERFORM tests.expect_error('owner A: reassign appointment A1 to client B1', '23503', format(
    $s$UPDATE public.appointments SET client_id = %L WHERE id = %L$s$,
    tests.id('client_b1'), tests.id('appointment_a1')));
  PERFORM tests.expect_error('owner A: assign barber B1 to service A', '23503', format(
    $s$INSERT INTO public.barber_services (salon_id, barber_id, service_id) VALUES (%L, %L, %L)$s$,
    tests.id('salon_a'), tests.id('barber_b1'), tests.id('service_a')));
  PERFORM tests.expect_error('owner A: assign barber A2 to service B', '23503', format(
    $s$INSERT INTO public.barber_services (salon_id, barber_id, service_id) VALUES (%L, %L, %L)$s$,
    tests.id('salon_a'), tests.id('barber_a2'), tests.id('service_b')));

  -- Only the server creates and deletes salons (one per owner, see
  -- test_checks.sql).
  PERFORM tests.expect_error('owner A: create a second salon', '42501', format(
    $s$INSERT INTO public.salons (user_id, name) VALUES (%L, 'Second salon')$s$, tests.id('owner_a')));
  PERFORM tests.expect_error('owner A: delete own salon', '42501', format(
    $s$DELETE FROM public.salons WHERE id = %L$s$, tests.id('salon_a')));

  -- Owner B sees none of salon A either.
  PERFORM tests.sign_in('owner_b');
  FOREACH t IN ARRAY ARRAY['barbers', 'clients', 'appointments', 'services', 'booking_pages', 'barber_services']
  LOOP
    PERFORM tests.expect_rows(format('owner B: no %s of salon A', t), 0, format(
      'SELECT * FROM public.%I WHERE salon_id = %L', t, tests.id('salon_a')));
  END LOOP;
  PERFORM tests.expect_rows('owner B: no reminders of salon A', 0, format(
    'SELECT * FROM public.reminders WHERE appointment_id = %L', tests.id('appointment_a1')));
END $$;

ROLLBACK;
