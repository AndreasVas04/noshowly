-- Test data: two salon owners (A and B) and the public demo account.
-- Loaded after the migrations and helpers.sql, as the database owner (so Row
-- Level Security does not apply). Rows are named with tests.id('...').
--
-- Appointments are in 2030 so that nothing counts as past.

BEGIN;

INSERT INTO auth.users (id, email, encrypted_password) VALUES
  (tests.id('owner_a'), 'owner-a@example.test', 'hash-a'),
  (tests.id('owner_b'), 'owner-b@example.test', 'hash-b'),
  (tests.id('demo'),    'demo@noshowly.com',    'hash-demo');

INSERT INTO public.users (id, email, plan, stripe_customer_id) VALUES
  (tests.id('owner_a'), 'owner-a@example.test', 'basic', 'cus_owner_a'),
  (tests.id('owner_b'), 'owner-b@example.test', 'trial', NULL),
  (tests.id('demo'),    'demo@noshowly.com',    'basic', NULL);

INSERT INTO public.salons (id, user_id, name, timezone, opening_time, closing_time) VALUES
  (tests.id('salon_a'),    tests.id('owner_a'), 'Salon A',    'Europe/Nicosia', '09:00', '19:00'),
  (tests.id('salon_b'),    tests.id('owner_b'), 'Salon B',    'Europe/Athens',  NULL,    NULL),
  (tests.id('salon_demo'), tests.id('demo'),    'Demo Salon', 'Europe/Nicosia', '09:00', '18:00');

INSERT INTO public.barbers (id, salon_id, name) VALUES
  (tests.id('barber_a1'),   tests.id('salon_a'),    'Anna'),
  (tests.id('barber_a2'),   tests.id('salon_a'),    'Andreas'),
  (tests.id('barber_b1'),   tests.id('salon_b'),    'Babis'),
  (tests.id('barber_demo'), tests.id('salon_demo'), 'Demo Staff');

-- client_a2 shares client_a1's phone number (family member): allowed.
INSERT INTO public.clients (id, salon_id, name, phone, email) VALUES
  (tests.id('client_a1'), tests.id('salon_a'), 'Chris',  '+35799000001', 'chris@example.test'),
  (tests.id('client_a2'), tests.id('salon_a'), 'Christa', '+35799000001', NULL),
  (tests.id('client_b1'), tests.id('salon_b'), 'Bella',  '+30690000001', 'bella@example.test');

INSERT INTO public.services (id, salon_id, name, duration_minutes, price) VALUES
  (tests.id('service_a'), tests.id('salon_a'), 'Haircut', 30, 15.00),
  (tests.id('service_b'), tests.id('salon_b'), 'Shave',   20, 10.00);

INSERT INTO public.barber_services
  (id, salon_id, barber_id, service_id, duration_minutes_override, price_override) VALUES
  (tests.id('barber_service_a1'), tests.id('salon_a'), tests.id('barber_a1'), tests.id('service_a'), 45, 20.00);

INSERT INTO public.booking_pages (id, salon_id, slug, is_active) VALUES
  (tests.id('page_a'),    tests.id('salon_a'),    'salon-a', true),
  (tests.id('page_b'),    tests.id('salon_b'),    'salon-b', true),
  (tests.id('page_demo'), tests.id('salon_demo'), 'demo',    true);

INSERT INTO public.staff_availability (id, barber_id, day_of_week, is_available, time_slots) VALUES
  (tests.id('availability_a1'), tests.id('barber_a1'), 1, true,
   '[{"start": "09:00", "end": "13:00"}, {"start": "14:00", "end": "19:00"}]'),
  (tests.id('availability_b1'), tests.id('barber_b1'), 2, true,
   '[{"start": "10:00", "end": "18:00"}]');

-- appointment_a1: Anna, Monday 7 January 2030, 10:00-11:00 UTC.
INSERT INTO public.appointments
  (id, salon_id, barber_id, client_id, datetime, duration_minutes, status, service_type) VALUES
  (tests.id('appointment_a1'), tests.id('salon_a'), tests.id('barber_a1'), tests.id('client_a1'),
   '2030-01-07 10:00:00+00', 60, 'scheduled', 'Haircut'),
  (tests.id('appointment_a2'), tests.id('salon_a'), tests.id('barber_a2'), tests.id('client_a2'),
   '2030-01-07 10:00:00+00', 30, 'confirmed', 'Haircut'),
  (tests.id('appointment_b1'), tests.id('salon_b'), tests.id('barber_b1'), tests.id('client_b1'),
   '2030-01-07 10:00:00+00', 20, 'scheduled', 'Shave');

INSERT INTO public.reminders (id, appointment_id, type, send_at, sent_at, status, token) VALUES
  (tests.id('reminder_a1'), tests.id('appointment_a1'), 'email',
   '2030-01-06 10:00:00+00', '2030-01-06 10:00:00+00', 'sent', 'token-a1'),
  (tests.id('reminder_b1'), tests.id('appointment_b1'), 'email',
   '2030-01-06 10:00:00+00', NULL, 'pending', 'token-b1');

COMMIT;
