-- Owner A, signed in, can do everything the dashboard does with salon A.

BEGIN;

DO $$
BEGIN
  PERFORM tests.sign_in('owner_a');

  -- Salon settings and booking page.
  PERFORM tests.expect_changed('owner A: update salon settings', 1, format(
    $s$UPDATE public.salons SET name = 'Salon A+', opening_time = '08:00', closing_time = '20:00',
         currency = 'EUR', email_footer = 'See you' WHERE id = %L$s$, tests.id('salon_a')));
  PERFORM tests.expect_changed('owner A: update booking page', 1, format(
    $s$UPDATE public.booking_pages SET slug = 'salon-a-plus', description = 'Hi', is_active = false WHERE id = %L$s$,
    tests.id('page_a')));

  -- Staff.
  PERFORM tests.expect_changed('owner A: add a barber', 1, format(
    $s$INSERT INTO public.barbers (id, salon_id, name) VALUES (%L, %L, 'Alex')$s$,
    tests.id('barber_a3'), tests.id('salon_a')));
  PERFORM tests.expect_changed('owner A: rename a barber', 1, format(
    $s$UPDATE public.barbers SET name = 'Alexis', bio = 'Colour', active = false WHERE id = %L$s$,
    tests.id('barber_a3')));
  PERFORM tests.expect_changed('owner A: set availability', 1, format(
    $s$INSERT INTO public.staff_availability (barber_id, day_of_week, time_slots) VALUES (%L, 3, '[{"start": "09:00", "end": "17:00"}]')$s$,
    tests.id('barber_a3')));
  PERFORM tests.expect_changed('owner A: change availability', 1, format(
    $s$UPDATE public.staff_availability SET is_available = false WHERE barber_id = %L$s$,
    tests.id('barber_a3')));

  -- Services and staff assignments.
  PERFORM tests.expect_changed('owner A: add a service', 1, format(
    $s$INSERT INTO public.services (id, salon_id, name, duration_minutes, price) VALUES (%L, %L, 'Beard trim', 20, 8.50)$s$,
    tests.id('service_a2'), tests.id('salon_a')));
  PERFORM tests.expect_changed('owner A: reprice a service', 1, format(
    $s$UPDATE public.services SET price = 9, duration_minutes = 25 WHERE id = %L$s$, tests.id('service_a2')));
  PERFORM tests.expect_changed('owner A: assign staff to a service', 1, format(
    $s$INSERT INTO public.barber_services (salon_id, barber_id, service_id, price_override) VALUES (%L, %L, %L, 12)$s$,
    tests.id('salon_a'), tests.id('barber_a3'), tests.id('service_a2')));
  PERFORM tests.expect_changed('owner A: change an override', 1, format(
    $s$UPDATE public.barber_services SET duration_minutes_override = 30 WHERE barber_id = %L AND service_id = %L$s$,
    tests.id('barber_a3'), tests.id('service_a2')));

  -- Clients and appointments.
  PERFORM tests.expect_changed('owner A: add a client', 1, format(
    $s$INSERT INTO public.clients (id, salon_id, name, phone) VALUES (%L, %L, 'Dora', '+35799000002')$s$,
    tests.id('client_a3'), tests.id('salon_a')));
  PERFORM tests.expect_changed('owner A: edit a client', 1, format(
    $s$UPDATE public.clients SET notes = 'Prefers mornings' WHERE id = %L$s$, tests.id('client_a3')));
  PERFORM tests.expect_changed('owner A: book an appointment', 1, format(
    $s$INSERT INTO public.appointments (id, salon_id, barber_id, client_id, datetime, duration_minutes)
       VALUES (%L, %L, %L, %L, '2030-01-08 09:00+00', 45)$s$,
    tests.id('appointment_a3'), tests.id('salon_a'), tests.id('barber_a1'), tests.id('client_a3')));
  PERFORM tests.expect_changed('owner A: confirm an appointment', 1, format(
    $s$UPDATE public.appointments SET status = 'confirmed', notes = 'Called' WHERE id = %L$s$,
    tests.id('appointment_a3')));
  PERFORM tests.expect_changed('owner A: record a test reminder', 1, format(
    $s$INSERT INTO public.reminders (appointment_id, type, send_at, sent_at, status, token)
       VALUES (%L, 'email_test', now(), now(), 'sent', 'token-test-a3')$s$,
    tests.id('appointment_a3')));
  PERFORM tests.expect_changed('owner A: cancel pending reminders', 0, format(
    $s$UPDATE public.reminders SET status = 'cancelled' WHERE appointment_id = %L AND status = 'pending'$s$,
    tests.id('appointment_a3')));
  PERFORM tests.expect_rows('owner A: reads own reminders', 2, 'SELECT * FROM public.reminders');
  PERFORM tests.expect_changed('owner A: delete an appointment', 1, format(
    $s$DELETE FROM public.appointments WHERE id = %L$s$, tests.id('appointment_a3')));
  PERFORM tests.expect_rows('owner A: reminders go with the appointment', 1, 'SELECT * FROM public.reminders');

  -- Deleting staff or clients keeps their appointments.
  PERFORM tests.expect_changed('owner A: delete barber A1', 1, format(
    $s$DELETE FROM public.barbers WHERE id = %L$s$, tests.id('barber_a1')));
  PERFORM tests.expect_rows('owner A: appointment A1 kept without a barber', 1, format(
    $s$SELECT * FROM public.appointments WHERE id = %L AND barber_id IS NULL AND salon_id = %L$s$,
    tests.id('appointment_a1'), tests.id('salon_a')));
  PERFORM tests.expect_rows('owner A: barber A1 assignments removed', 0, format(
    $s$SELECT * FROM public.barber_services WHERE barber_id = %L$s$, tests.id('barber_a1')));
  PERFORM tests.expect_rows('owner A: barber A1 availability removed', 0, format(
    $s$SELECT * FROM public.staff_availability WHERE barber_id = %L$s$, tests.id('barber_a1')));
  PERFORM tests.expect_changed('owner A: delete client A1', 1, format(
    $s$DELETE FROM public.clients WHERE id = %L$s$, tests.id('client_a1')));
  PERFORM tests.expect_rows('owner A: appointment A1 kept without a client', 1, format(
    $s$SELECT * FROM public.appointments WHERE id = %L AND client_id IS NULL$s$, tests.id('appointment_a1')));

  -- Deleting a service removes its staff assignments.
  PERFORM tests.expect_changed('owner A: delete a service', 1, format(
    $s$DELETE FROM public.services WHERE id = %L$s$, tests.id('service_a2')));
  PERFORM tests.expect_rows('owner A: service assignments removed', 0, format(
    $s$SELECT * FROM public.barber_services WHERE service_id = %L$s$, tests.id('service_a2')));
END $$;

ROLLBACK;
