-- Rows with the problems the live database can have, written straight into
-- the baseline schema (before any later migration), the way the old app
-- versions and hand edits could have written them:
--   - an owner with two salons, and a Stripe customer shared by two accounts
--   - legacy plan names (solo-sms, professional, starter)
--   - overlapping appointments for one barber
--   - an unknown appointment status, durations of 0 and 600 minutes
--   - an appointment and a staff assignment pointing at another salon's
--     barber or client
--   - a negative price, closing time before opening time
--   - booking page slugs with capitals or underscores, and two slugs that
--     differ only in case
--   - two clients with the same phone number (allowed, no rule against it)
--   - pending reminders that can never be sent, an unknown reminder status,
--     and two pending reminders for one appointment
--   - rows in the unused staff_services table
-- Rows are named with tests.id('...') from ../helpers.sql.

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  (tests.id('owner_c'), 'owner-c@example.test'),
  (tests.id('owner_d'), 'owner-d@example.test'),
  (tests.id('owner_e'), 'owner-e@example.test');

INSERT INTO public.users (id, email, plan, stripe_customer_id) VALUES
  (tests.id('owner_c'), 'owner-c@example.test', 'solo-sms',     'cus_shared'),
  (tests.id('owner_d'), 'owner-d@example.test', 'professional', 'cus_shared'),
  (tests.id('owner_e'), 'owner-e@example.test', 'starter',      NULL);

INSERT INTO public.salons (id, user_id, name, opening_time, closing_time) VALUES
  (tests.id('salon_c1'), tests.id('owner_c'), 'Salon C',        '09:00', '18:00'),
  (tests.id('salon_c2'), tests.id('owner_c'), 'Salon C (copy)', NULL,    NULL),
  (tests.id('salon_d'),  tests.id('owner_d'), 'Salon D',        '18:00', '09:00'),
  (tests.id('salon_e'),  tests.id('owner_e'), 'Salon E',        NULL,    NULL);

INSERT INTO public.barbers (id, salon_id, name) VALUES
  (tests.id('barber_c1'), tests.id('salon_c1'), 'Costas'),
  (tests.id('barber_d1'), tests.id('salon_d'),  'Dimitra'),
  (tests.id('barber_e1'), tests.id('salon_e'),  'Eleni');

INSERT INTO public.clients (id, salon_id, name, phone) VALUES
  (tests.id('client_c1'),     tests.id('salon_c1'), 'Maria', '+35799111111'),
  (tests.id('client_c1_dup'), tests.id('salon_c1'), 'Maria', '+35799111111'),
  (tests.id('client_d1'),     tests.id('salon_d'),  'Nikos', '+35799222222'),
  (tests.id('client_e1'),     tests.id('salon_e'),  'Olga',  '+35799333333');

INSERT INTO public.services (id, salon_id, name, duration_minutes, price) VALUES
  (tests.id('service_c1'), tests.id('salon_c1'), 'Colour', 90, -5.00),
  (tests.id('service_d1'), tests.id('salon_d'),  'Cut',    30, 12.00);

INSERT INTO public.barber_services (id, salon_id, barber_id, service_id) VALUES
  (tests.id('barber_service_c1'), tests.id('salon_c1'), tests.id('barber_c1'), tests.id('service_c1')),
  (tests.id('barber_service_cross'), tests.id('salon_c1'), tests.id('barber_d1'), tests.id('service_c1'));

INSERT INTO public.booking_pages (id, salon_id, slug, is_active) VALUES
  (tests.id('page_c1'), tests.id('salon_c1'), 'Salon-C', true),
  (tests.id('page_c2'), tests.id('salon_c2'), 'salon-c', false),
  (tests.id('page_d'),  tests.id('salon_d'),  'salon_d', true);

INSERT INTO public.appointments
  (id, salon_id, barber_id, client_id, datetime, duration_minutes, status) VALUES
  -- c1 and c2 overlap (barber C1, 10:00-11:00 and 10:30-11:30).
  (tests.id('appointment_c1'), tests.id('salon_c1'), tests.id('barber_c1'), tests.id('client_c1'),
   '2030-01-07 10:00+00', 60, 'scheduled'),
  (tests.id('appointment_c2'), tests.id('salon_c1'), tests.id('barber_c1'), tests.id('client_c1_dup'),
   '2030-01-07 10:30+00', 60, 'confirmed'),
  (tests.id('appointment_c3'), tests.id('salon_c1'), tests.id('barber_c1'), NULL,
   '2030-01-07 12:00+00', 30, 'banana'),
  (tests.id('appointment_c4'), tests.id('salon_c1'), NULL, NULL,
   '2030-01-07 12:00+00', 0, 'scheduled'),
  -- Salon C's appointment with salon D's barber and client, 10 hours long.
  (tests.id('appointment_c5'), tests.id('salon_c1'), tests.id('barber_d1'), tests.id('client_d1'),
   '2030-01-08 10:00+00', 600, 'scheduled'),
  (tests.id('appointment_d1'), tests.id('salon_d'), tests.id('barber_d1'), tests.id('client_d1'),
   '2030-01-09 10:00+00', 30, 'scheduled'),
  (tests.id('appointment_e_past'), tests.id('salon_e'), tests.id('barber_e1'), tests.id('client_e1'),
   '2020-01-06 10:00+00', 30, 'scheduled'),
  (tests.id('appointment_e_cancelled'), tests.id('salon_e'), tests.id('barber_e1'), tests.id('client_e1'),
   '2030-01-10 10:00+00', 30, 'cancelled');

INSERT INTO public.reminders (id, appointment_id, type, send_at, sent_at, status, token) VALUES
  -- Pending without a token: written by an older public booking route.
  (tests.id('reminder_no_token'), tests.id('appointment_c1'), 'email',
   '2030-01-06 10:00+00', NULL, 'pending', NULL),
  -- The booking route's pending row, superseded by the one the cron sent.
  (tests.id('reminder_c2_booking'), tests.id('appointment_c2'), 'email',
   '2030-01-06 10:30+00', NULL, 'pending', 'token-c2-booking'),
  (tests.id('reminder_c2_cron'), tests.id('appointment_c2'), 'email',
   '2030-01-06 10:30+00', '2030-01-06 10:31+00', 'sent', 'token-c2-cron'),
  -- Two pending rows for one upcoming appointment: nothing decides which one
  -- to keep, so the unique index waits.
  (tests.id('reminder_d1_first'), tests.id('appointment_d1'), 'email',
   '2030-01-08 10:00+00', NULL, 'pending', 'token-d1-first'),
  (tests.id('reminder_d1_second'), tests.id('appointment_d1'), 'email',
   '2030-01-08 10:00+00', NULL, 'pending', 'token-d1-second'),
  -- Pending for an appointment in the past and for a cancelled one.
  (tests.id('reminder_e_past'), tests.id('appointment_e_past'), 'email',
   '2020-01-05 10:00+00', NULL, 'pending', 'token-e-past'),
  (tests.id('reminder_e_cancelled'), tests.id('appointment_e_cancelled'), 'email',
   '2030-01-09 10:00+00', NULL, 'pending', 'token-e-cancelled'),
  (tests.id('reminder_bad_status'), tests.id('appointment_c3'), 'email',
   '2030-01-06 12:00+00', NULL, 'whatever', 'token-bad-status');

INSERT INTO public.staff_services (barber_id, name, duration_minutes, price) VALUES
  (tests.id('barber_c1'), 'Old list entry', 30, 10.00);

COMMIT;
