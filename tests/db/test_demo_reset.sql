-- Nightly reset of the demo account (20260929130000_demo_reset.sql):
-- take_demo_snapshot() copies the demo salon, reset_demo_data() puts it back,
-- with appointments moved by whole days at the same wall-clock time, and
-- keeps the demo account on the Basic plan. Other salons are not touched,
-- and only the service role and the database owner can run either function.

BEGIN;

DO $$
DECLARE
  v_result   text;
  v_a_before text;
  v_a_after  text;
BEGIN
  -- Without a snapshot the reset only keeps the account on the Basic plan.
  UPDATE public.users SET plan = 'cancelled', email_reminders_used_this_month = 7
  WHERE id = tests.id('demo');
  v_result := public.reset_demo_data();
  PERFORM tests.expect('no snapshot: says so', v_result LIKE 'demo account kept on the Basic plan%');
  PERFORM tests.expect('no snapshot: demo back on basic, counter zero',
    (SELECT plan = 'basic' AND email_reminders_used_this_month = 0 FROM public.users WHERE id = tests.id('demo')));

  -- The demo salon as it should look: a service, staff service, availability,
  -- a client and two appointments, one of them before the end of summer time
  -- in Cyprus (Sunday 25 October 2026).
  INSERT INTO public.services (id, salon_id, name, duration_minutes, price) VALUES
    (tests.id('service_demo'), tests.id('salon_demo'), 'Demo Cut', 30, 12.00);
  INSERT INTO public.barber_services (id, salon_id, barber_id, service_id, duration_minutes_override) VALUES
    (tests.id('barber_service_demo'), tests.id('salon_demo'), tests.id('barber_demo'), tests.id('service_demo'), 40);
  INSERT INTO public.staff_availability (id, barber_id, day_of_week, is_available, time_slots) VALUES
    (tests.id('availability_demo'), tests.id('barber_demo'), 1, true, '[{"start": "09:00", "end": "17:00"}]');
  INSERT INTO public.clients (id, salon_id, name, phone, email) VALUES
    (tests.id('client_demo'), tests.id('salon_demo'), 'Demo Client', '+35799000009', 'demo-client@example.test');
  INSERT INTO public.appointments
    (id, salon_id, barber_id, client_id, datetime, duration_minutes, status, service_type) VALUES
    (tests.id('appointment_demo1'), tests.id('salon_demo'), tests.id('barber_demo'), tests.id('client_demo'),
     '2026-10-05 10:00:00+03', 40, 'confirmed', 'Demo Cut'),
    (tests.id('appointment_demo2'), tests.id('salon_demo'), tests.id('barber_demo'), tests.id('client_demo'),
     '2026-10-23 16:30:00+03', 40, 'scheduled', 'Demo Cut');
  UPDATE public.booking_pages SET custom_title = 'Book with the demo salon' WHERE id = tests.id('page_demo');

  v_result := public.take_demo_snapshot();
  PERFORM tests.expect('snapshot taken: ' || v_result,
    v_result = 'snapshot taken: 1 staff, 1 services, 1 clients, 2 appointments');

  -- Visitors change everything.
  SELECT string_agg(concat_ws('|', id, datetime, status, barber_id, client_id), ',' ORDER BY id)
  INTO v_a_before FROM public.appointments WHERE salon_id = tests.id('salon_a');
  UPDATE public.salons SET name = 'Visitor was here', currency = 'GBP' WHERE id = tests.id('salon_demo');
  UPDATE public.booking_pages SET is_active = false, custom_title = 'Closed', slug = 'demo-renamed'
  WHERE id = tests.id('page_demo');
  UPDATE public.appointments SET status = 'cancelled', notes = 'visitor' WHERE id = tests.id('appointment_demo1');
  DELETE FROM public.appointments WHERE id = tests.id('appointment_demo2');
  DELETE FROM public.barbers WHERE id = tests.id('barber_demo');
  INSERT INTO public.barbers (salon_id, name) VALUES (tests.id('salon_demo'), 'Visitor staff');
  INSERT INTO public.services (salon_id, name, duration_minutes) VALUES (tests.id('salon_demo'), 'Visitor service', 15);
  INSERT INTO public.clients (salon_id, name, phone) VALUES (tests.id('salon_demo'), 'Visitor client', '+35799999999');
  UPDATE public.users SET plan = 'cancelled', stripe_customer_id = 'cus_demo_stale' WHERE id = tests.id('demo');

  -- The snapshot was taken three days ago.
  UPDATE private.demo_snapshot SET taken_at = taken_at - interval '3 days';

  v_result := public.reset_demo_data();
  PERFORM tests.expect('reset: ' || v_result,
    v_result LIKE 'restored the snapshot of % (appointments moved 3 day(s)): 1 staff, 1 services, 1 clients, 2 appointments');

  PERFORM tests.expect('salon settings restored',
    (SELECT name = 'Demo Salon' AND currency = 'USD' FROM public.salons WHERE id = tests.id('salon_demo')));
  PERFORM tests.expect('booking page restored',
    (SELECT is_active AND custom_title = 'Book with the demo salon' AND slug = 'demo'
     FROM public.booking_pages WHERE id = tests.id('page_demo')));
  PERFORM tests.expect('staff restored, visitor staff removed',
    (SELECT array_agg(name ORDER BY name) = ARRAY['Demo Staff'] FROM public.barbers WHERE salon_id = tests.id('salon_demo')));
  PERFORM tests.expect('services restored, visitor service removed',
    (SELECT array_agg(name ORDER BY name) = ARRAY['Demo Cut'] FROM public.services WHERE salon_id = tests.id('salon_demo')));
  PERFORM tests.expect('staff service and availability restored',
    EXISTS (SELECT 1 FROM public.barber_services WHERE id = tests.id('barber_service_demo') AND duration_minutes_override = 40)
    AND EXISTS (SELECT 1 FROM public.staff_availability WHERE id = tests.id('availability_demo')));
  PERFORM tests.expect('clients restored, visitor client removed',
    (SELECT array_agg(name ORDER BY name) = ARRAY['Demo Client'] FROM public.clients WHERE salon_id = tests.id('salon_demo')));
  PERFORM tests.expect('appointment 1 restored, three days later at 10:00 Nicosia',
    (SELECT datetime = '2026-10-08 10:00:00+03' AND status = 'confirmed' AND notes IS NULL
            AND barber_id = tests.id('barber_demo') AND client_id = tests.id('client_demo')
     FROM public.appointments WHERE id = tests.id('appointment_demo1')));
  PERFORM tests.expect('appointment 2 restored, moved across the end of summer time at 16:30 Nicosia',
    (SELECT datetime = '2026-10-26 16:30:00+02' FROM public.appointments WHERE id = tests.id('appointment_demo2')));
  PERFORM tests.expect('demo on basic, no Stripe customer',
    (SELECT plan = 'basic' AND stripe_customer_id IS NULL FROM public.users WHERE id = tests.id('demo')));

  SELECT string_agg(concat_ws('|', id, datetime, status, barber_id, client_id), ',' ORDER BY id)
  INTO v_a_after FROM public.appointments WHERE salon_id = tests.id('salon_a');
  PERFORM tests.expect('other salons untouched', v_a_before = v_a_after);
  PERFORM tests.expect('owner A still linked to Stripe',
    (SELECT stripe_customer_id = 'cus_owner_a' FROM public.users WHERE id = tests.id('owner_a')));

  -- Running it again changes nothing that matters.
  v_result := public.reset_demo_data();
  PERFORM tests.expect('second reset: same appointments',
    (SELECT count(*) = 2 FROM public.appointments WHERE salon_id = tests.id('salon_demo')));

  -- Who can run it.
  PERFORM tests.as_anon();
  PERFORM tests.expect_error('anon: reset', '42501', 'SELECT public.reset_demo_data()');
  PERFORM tests.expect_error('anon: snapshot', '42501', 'SELECT public.take_demo_snapshot()');
  PERFORM tests.expect_error('anon: read snapshot', '42501', 'SELECT * FROM private.demo_snapshot');
  PERFORM tests.sign_in('demo');
  PERFORM tests.expect_error('demo owner: reset', '42501', 'SELECT public.reset_demo_data()');
  PERFORM tests.expect_error('demo owner: snapshot', '42501', 'SELECT public.take_demo_snapshot()');
  PERFORM tests.expect_error('demo owner: read snapshot', '42501', 'SELECT * FROM private.demo_snapshot');
  PERFORM tests.sign_in('owner_a');
  PERFORM tests.expect_error('owner A: reset', '42501', 'SELECT public.reset_demo_data()');
  PERFORM tests.as_service_role();
  PERFORM tests.expect_ok('service role: reset', 'SELECT public.reset_demo_data()');
  PERFORM tests.sign_out();
END $$;

ROLLBACK;
