-- What the owner would do with the rows the report lists, so the next run of
-- the migrations can finish.

BEGIN;

-- Owner C's second salon (after moving anything needed into the first one).
DELETE FROM public.salons WHERE id = tests.id('salon_c2');
UPDATE public.users SET stripe_customer_id = NULL WHERE id = tests.id('owner_d');

UPDATE public.salons SET opening_time = '09:00', closing_time = '18:00' WHERE id = tests.id('salon_d');
UPDATE public.services SET price = 5.00 WHERE id = tests.id('service_c1');
DELETE FROM public.barber_services WHERE id = tests.id('barber_service_cross');
UPDATE public.booking_pages SET slug = 'salon-c' WHERE id = tests.id('page_c1');
UPDATE public.booking_pages SET slug = 'salon-d' WHERE id = tests.id('page_d');

UPDATE public.appointments SET status = 'cancelled' WHERE id = tests.id('appointment_c2');
UPDATE public.appointments SET status = 'scheduled' WHERE id = tests.id('appointment_c3');
UPDATE public.appointments SET duration_minutes = 30 WHERE id = tests.id('appointment_c4');
UPDATE public.appointments SET barber_id = NULL, client_id = NULL, duration_minutes = 480
WHERE id = tests.id('appointment_c5');

UPDATE public.reminders SET status = 'failed' WHERE id = tests.id('reminder_bad_status');
UPDATE public.reminders SET status = 'skipped' WHERE id = tests.id('reminder_d1_second');

COMMIT;
