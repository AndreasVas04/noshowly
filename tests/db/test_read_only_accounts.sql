-- 20260929120000_read_only_accounts.sql: an owner whose trial has ended, or
-- whose plan is cancelled, can read everything in their salon and change the
-- salon's settings, but nothing else. A running trial and a paid plan can
-- write, and the service-role key is not affected.
--
-- Owner B's trial ends in 14 days (seed.sql). The plan and the trial end date
-- are changed as the database owner between the checks.

BEGIN;

-- Salon B has no staff assignment in seed.sql.
INSERT INTO public.barber_services (id, salon_id, barber_id, service_id)
VALUES (tests.id('barber_service_b1'), tests.id('salon_b'), tests.id('barber_b1'), tests.id('service_b'));

-- Owner B, signed in, can create, change and delete rows in every table the
-- dashboard writes. The checks of each table leave its rows as they were.
CREATE FUNCTION pg_temp.expect_owner_b_can_write(p_state text) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  r record;
BEGIN
  PERFORM tests.sign_in('owner_b');
  PERFORM tests.expect(format('%s: owner B has write access', p_state),
    public.owner_has_write_access(tests.id('owner_b')));

  FOR r IN
    SELECT * FROM (VALUES
      ('add a barber', format(
         $s$INSERT INTO public.barbers (id, salon_id, name) VALUES (%L, %L, 'Vasia')$s$,
         tests.id('barber_b2'), tests.id('salon_b'))),
      ('rename the barber', format(
         $s$UPDATE public.barbers SET name = 'Vasiliki' WHERE id = %L$s$, tests.id('barber_b2'))),
      ('delete the barber', format(
         $s$DELETE FROM public.barbers WHERE id = %L$s$, tests.id('barber_b2'))),

      ('add a service', format(
         $s$INSERT INTO public.services (id, salon_id, name, duration_minutes, price) VALUES (%L, %L, 'Beard', 15, 7)$s$,
         tests.id('service_b2'), tests.id('salon_b'))),
      ('reprice the service', format(
         $s$UPDATE public.services SET price = 8 WHERE id = %L$s$, tests.id('service_b2'))),
      ('delete the service', format(
         $s$DELETE FROM public.services WHERE id = %L$s$, tests.id('service_b2'))),

      ('add a client', format(
         $s$INSERT INTO public.clients (id, salon_id, name) VALUES (%L, %L, 'Maria')$s$,
         tests.id('client_b2'), tests.id('salon_b'))),
      ('edit the client', format(
         $s$UPDATE public.clients SET notes = 'Regular' WHERE id = %L$s$, tests.id('client_b2'))),
      ('delete the client', format(
         $s$DELETE FROM public.clients WHERE id = %L$s$, tests.id('client_b2'))),

      ('book an appointment', format(
         $s$INSERT INTO public.appointments (id, salon_id, barber_id, datetime, duration_minutes)
            VALUES (%L, %L, %L, '2030-01-09 10:00+00', 20)$s$,
         tests.id('appointment_b2'), tests.id('salon_b'), tests.id('barber_b1'))),
      ('confirm the appointment', format(
         $s$UPDATE public.appointments SET status = 'confirmed' WHERE id = %L$s$, tests.id('appointment_b2'))),
      ('delete the appointment', format(
         $s$DELETE FROM public.appointments WHERE id = %L$s$, tests.id('appointment_b2'))),

      ('set availability', format(
         $s$INSERT INTO public.staff_availability (id, barber_id, day_of_week) VALUES (%L, %L, 4)$s$,
         tests.id('availability_b2'), tests.id('barber_b1'))),
      ('change the availability with an upsert', format(
         $s$INSERT INTO public.staff_availability (barber_id, day_of_week, is_available) VALUES (%L, 4, false)
            ON CONFLICT (barber_id, day_of_week) DO UPDATE SET is_available = EXCLUDED.is_available$s$,
         tests.id('barber_b1'))),
      ('delete the availability', format(
         $s$DELETE FROM public.staff_availability WHERE id = %L$s$, tests.id('availability_b2'))),

      -- One booking page per salon and one assignment per staff member and
      -- service: change, delete and recreate the existing ones.
      ('edit the booking page', format(
         $s$UPDATE public.booking_pages SET description = 'Welcome' WHERE id = %L$s$, tests.id('page_b'))),
      ('delete the booking page', format(
         $s$DELETE FROM public.booking_pages WHERE id = %L$s$, tests.id('page_b'))),
      ('create the booking page again', format(
         $s$INSERT INTO public.booking_pages (id, salon_id, slug, is_active) VALUES (%L, %L, 'salon-b', true)$s$,
         tests.id('page_b'), tests.id('salon_b'))),

      ('change a staff assignment', format(
         $s$UPDATE public.barber_services SET price_override = 12 WHERE id = %L$s$, tests.id('barber_service_b1'))),
      ('delete the staff assignment', format(
         $s$DELETE FROM public.barber_services WHERE id = %L$s$, tests.id('barber_service_b1'))),
      ('assign the staff member again', format(
         $s$INSERT INTO public.barber_services (id, salon_id, barber_id, service_id) VALUES (%L, %L, %L, %L)$s$,
         tests.id('barber_service_b1'), tests.id('salon_b'), tests.id('barber_b1'), tests.id('service_b'))),

      ('edit salon settings', format(
         $s$UPDATE public.salons SET name = 'Salon B', currency = 'EUR' WHERE id = %L$s$, tests.id('salon_b')))
    ) AS t(what, sql)
  LOOP
    PERFORM tests.expect_changed(format('%s: owner B: %s', p_state, r.what), 1, r.sql);
  END LOOP;

  PERFORM tests.sign_out();
END;
$$;

-- Owner B, signed in, can read everything and change the salon's settings.
-- Inserts and updates fail, deletes change nothing, and every row is kept.
-- Row Level Security is checked before unique constraints, so the inserts
-- that repeat an existing booking page or staff assignment would fail with
-- 23505, not 42501, if a policy let them through.
CREATE FUNCTION pg_temp.expect_owner_b_read_only(p_state text) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  r record;
  t text;
BEGIN
  PERFORM tests.sign_in('owner_b');
  PERFORM tests.expect(format('%s: owner B has no write access', p_state),
    NOT public.owner_has_write_access(tests.id('owner_b')));

  FOREACH t IN ARRAY ARRAY['users', 'salons', 'barbers', 'services', 'clients', 'appointments', 'reminders',
                           'booking_pages', 'staff_availability', 'barber_services']
  LOOP
    PERFORM tests.expect_rows(format('%s: owner B: reads %s', p_state, t), 1,
      format('SELECT * FROM public.%I', t));
  END LOOP;

  PERFORM tests.expect_changed(format('%s: owner B: edit salon settings', p_state), 1, format(
    $s$UPDATE public.salons SET name = %L, opening_time = '09:00', closing_time = '17:00' WHERE id = %L$s$,
    'Salon B (' || p_state || ')', tests.id('salon_b')));

  FOR r IN
    SELECT * FROM (VALUES
      ('add a barber', '42501', format(
         $s$INSERT INTO public.barbers (salon_id, name) VALUES (%L, 'Vasia')$s$, tests.id('salon_b'))),
      ('rename a barber', '42501', format(
         $s$UPDATE public.barbers SET name = 'Renamed' WHERE id = %L$s$, tests.id('barber_b1'))),
      ('delete a barber', NULL, format(
         $s$DELETE FROM public.barbers WHERE id = %L$s$, tests.id('barber_b1'))),

      ('add a service', '42501', format(
         $s$INSERT INTO public.services (salon_id, name) VALUES (%L, 'Beard')$s$, tests.id('salon_b'))),
      ('reprice a service', '42501', format(
         $s$UPDATE public.services SET price = 0 WHERE id = %L$s$, tests.id('service_b'))),
      ('delete a service', NULL, format(
         $s$DELETE FROM public.services WHERE id = %L$s$, tests.id('service_b'))),

      ('add a client', '42501', format(
         $s$INSERT INTO public.clients (salon_id, name) VALUES (%L, 'Maria')$s$, tests.id('salon_b'))),
      ('edit a client', '42501', format(
         $s$UPDATE public.clients SET notes = 'Changed' WHERE id = %L$s$, tests.id('client_b1'))),
      ('delete a client', NULL, format(
         $s$DELETE FROM public.clients WHERE id = %L$s$, tests.id('client_b1'))),

      ('book an appointment', '42501', format(
         $s$INSERT INTO public.appointments (salon_id, datetime) VALUES (%L, '2030-01-09 10:00+00')$s$,
         tests.id('salon_b'))),
      ('cancel an appointment', '42501', format(
         $s$UPDATE public.appointments SET status = 'cancelled' WHERE id = %L$s$, tests.id('appointment_b1'))),
      ('delete an appointment', NULL, format(
         $s$DELETE FROM public.appointments WHERE id = %L$s$, tests.id('appointment_b1'))),

      ('create a booking page', '42501', format(
         $s$INSERT INTO public.booking_pages (salon_id, slug) VALUES (%L, 'salon-b-two')$s$, tests.id('salon_b'))),
      ('edit the booking page', '42501', format(
         $s$UPDATE public.booking_pages SET is_active = false WHERE id = %L$s$, tests.id('page_b'))),
      ('delete the booking page', NULL, format(
         $s$DELETE FROM public.booking_pages WHERE id = %L$s$, tests.id('page_b'))),

      ('set availability', '42501', format(
         $s$INSERT INTO public.staff_availability (barber_id, day_of_week) VALUES (%L, 4)$s$, tests.id('barber_b1'))),
      ('change availability with an upsert', '42501', format(
         $s$INSERT INTO public.staff_availability (barber_id, day_of_week, is_available) VALUES (%L, 2, false)
            ON CONFLICT (barber_id, day_of_week) DO UPDATE SET is_available = EXCLUDED.is_available$s$,
         tests.id('barber_b1'))),
      ('change availability', '42501', format(
         $s$UPDATE public.staff_availability SET is_available = false WHERE id = %L$s$, tests.id('availability_b1'))),
      ('delete availability', NULL, format(
         $s$DELETE FROM public.staff_availability WHERE id = %L$s$, tests.id('availability_b1'))),

      ('assign staff to a service', '42501', format(
         $s$INSERT INTO public.barber_services (salon_id, barber_id, service_id) VALUES (%L, %L, %L)$s$,
         tests.id('salon_b'), tests.id('barber_b1'), tests.id('service_b'))),
      ('change a staff assignment', '42501', format(
         $s$UPDATE public.barber_services SET price_override = 0 WHERE id = %L$s$, tests.id('barber_service_b1'))),
      ('delete a staff assignment', NULL, format(
         $s$DELETE FROM public.barber_services WHERE id = %L$s$, tests.id('barber_service_b1')))
    ) AS v(what, sqlstate, sql)
  LOOP
    IF r.sqlstate IS NULL THEN
      PERFORM tests.expect_changed(format('%s: owner B: %s changes nothing', p_state, r.what), 0, r.sql);
    ELSE
      PERFORM tests.expect_error(format('%s: owner B: %s', p_state, r.what), r.sqlstate, r.sql);
    END IF;
  END LOOP;

  PERFORM tests.sign_out();

  -- Nothing changed, nothing was added.
  PERFORM tests.expect_rows(format('%s: salon B rows unchanged', p_state), 7, format($q$
    SELECT 1 FROM public.barbers WHERE id = %L AND name = 'Babis'
    UNION ALL SELECT 1 FROM public.services WHERE id = %L AND price = 10
    UNION ALL SELECT 1 FROM public.clients WHERE id = %L AND notes IS NULL
    UNION ALL SELECT 1 FROM public.appointments WHERE id = %L AND status = 'scheduled'
    UNION ALL SELECT 1 FROM public.booking_pages WHERE id = %L AND is_active
    UNION ALL SELECT 1 FROM public.staff_availability WHERE id = %L AND is_available
    UNION ALL SELECT 1 FROM public.barber_services WHERE id = %L AND price_override IS NULL$q$,
    tests.id('barber_b1'), tests.id('service_b'), tests.id('client_b1'), tests.id('appointment_b1'),
    tests.id('page_b'), tests.id('availability_b1'), tests.id('barber_service_b1')));
  PERFORM tests.expect_rows(format('%s: salon B has no new rows', p_state), 7, format($q$
    SELECT 1 FROM public.barbers WHERE salon_id = %1$L
    UNION ALL SELECT 1 FROM public.services WHERE salon_id = %1$L
    UNION ALL SELECT 1 FROM public.clients WHERE salon_id = %1$L
    UNION ALL SELECT 1 FROM public.appointments WHERE salon_id = %1$L
    UNION ALL SELECT 1 FROM public.booking_pages WHERE salon_id = %1$L
    UNION ALL SELECT 1 FROM public.staff_availability WHERE barber_id = %2$L
    UNION ALL SELECT 1 FROM public.barber_services WHERE salon_id = %1$L$q$,
    tests.id('salon_b'), tests.id('barber_b1')));
END;
$$;

-- Sets owner B's plan and trial end date, as the database owner.
CREATE FUNCTION pg_temp.set_owner_b(p_plan text, p_trial_ends_at timestamptz) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM tests.sign_out();
  UPDATE public.users SET plan = p_plan, trial_ends_at = p_trial_ends_at WHERE id = tests.id('owner_b');
END;
$$;

DO $$
DECLARE
  r record;
BEGIN
  -- 1. Who can call the function. Without a signed-in user (SQL Editor,
  --    service role) it answers for any account; a signed-in user only
  --    learns about their own.
  PERFORM tests.expect('basic can write', public.owner_has_write_access(tests.id('owner_a')));
  PERFORM tests.expect('running trial can write', public.owner_has_write_access(tests.id('owner_b')));
  PERFORM tests.expect('no users row: no write access', NOT public.owner_has_write_access(tests.id('nobody')));
  PERFORM tests.expect('no user: no write access', NOT public.owner_has_write_access(NULL));

  PERFORM tests.sign_in('owner_b');
  PERFORM tests.expect('owner B: own account', public.owner_has_write_access(tests.id('owner_b')));
  PERFORM tests.expect('owner B: nothing about owner A', NOT public.owner_has_write_access(tests.id('owner_a')));
  PERFORM tests.as_service_role();
  PERFORM tests.expect('service role: any account', public.owner_has_write_access(tests.id('owner_a')));
  PERFORM tests.as_anon();
  PERFORM tests.expect_error('anon: cannot call owner_has_write_access()', '42501', format(
    'SELECT public.owner_has_write_access(%L)', tests.id('owner_a')));

  -- 2. With any plan, owners never write reminders or create, delete or give
  --    away salons: the server does.
  PERFORM tests.sign_in('owner_b');
  PERFORM tests.expect_error('owner B: record a reminder', '42501', format(
    $s$INSERT INTO public.reminders (appointment_id, type, send_at) VALUES (%L, 'email_test', now())$s$,
    tests.id('appointment_b1')));
  PERFORM tests.expect_error('owner B: mark a reminder sent', '42501', format(
    $s$UPDATE public.reminders SET status = 'sent' WHERE id = %L$s$, tests.id('reminder_b1')));
  PERFORM tests.expect_error('owner B: delete a reminder', '42501', format(
    $s$DELETE FROM public.reminders WHERE id = %L$s$, tests.id('reminder_b1')));
  PERFORM tests.expect_error('owner B: create a salon', '42501', format(
    $s$INSERT INTO public.salons (user_id, name) VALUES (%L, 'Second salon')$s$, tests.id('owner_b')));
  PERFORM tests.expect_error('owner B: delete the salon', '42501', format(
    $s$DELETE FROM public.salons WHERE id = %L$s$, tests.id('salon_b')));
  PERFORM tests.expect_error('owner B: give the salon to owner A', '42501', format(
    $s$UPDATE public.salons SET user_id = %L WHERE id = %L$s$, tests.id('owner_a'), tests.id('salon_b')));
  PERFORM tests.sign_out();

  -- 3. A running trial can write, up to its last moment.
  PERFORM pg_temp.expect_owner_b_can_write('trial running');
  PERFORM pg_temp.set_owner_b('trial', now() + interval '1 second');
  PERFORM pg_temp.expect_owner_b_can_write('trial ending in a second');

  -- 4. From trial_ends_at on, and with a cancelled plan: read-only.
  PERFORM pg_temp.set_owner_b('trial', now());
  PERFORM pg_temp.expect_owner_b_read_only('trial ending now');
  PERFORM pg_temp.set_owner_b('trial', now() - interval '1 day');
  PERFORM pg_temp.expect_owner_b_read_only('trial ended');
  PERFORM pg_temp.set_owner_b('cancelled', now() + interval '1 day');
  PERFORM pg_temp.expect_owner_b_read_only('cancelled');
  PERFORM pg_temp.set_owner_b('cancelled', now() - interval '1 day');

  -- 5. The server is not affected: the public booking page, the email
  --    gateway, the reminder job and the Stripe webhook still write for a
  --    read-only account.
  PERFORM tests.as_service_role();
  PERFORM tests.expect_changed('service role: add a client to salon B', 1, format(
    $s$INSERT INTO public.clients (id, salon_id, name) VALUES (%L, %L, 'Walk-in')$s$,
    tests.id('client_b3'), tests.id('salon_b')));
  PERFORM tests.expect_changed('service role: book an appointment in salon B', 1, format(
    $s$INSERT INTO public.appointments (id, salon_id, barber_id, client_id, datetime, duration_minutes)
       VALUES (%L, %L, %L, %L, '2030-01-10 10:00+00', 20)$s$,
    tests.id('appointment_b3'), tests.id('salon_b'), tests.id('barber_b1'), tests.id('client_b3')));
  PERFORM tests.expect_changed('service role: record a booking confirmation', 1, format(
    $s$INSERT INTO public.reminders (id, appointment_id, type, send_at, status, token)
       VALUES (%L, %L, 'email_confirmation', now(), 'pending', 'token-b3')$s$,
    tests.id('reminder_b3'), tests.id('appointment_b3')));
  PERFORM tests.expect_changed('service role: mark it sent', 1, format(
    $s$UPDATE public.reminders SET status = 'sent', sent_at = now() WHERE id = %L$s$, tests.id('reminder_b3')));
  PERFORM tests.expect_changed('service role: retire its links', 1, format(
    $s$UPDATE public.reminders SET status = 'cancelled' WHERE appointment_id = %L$s$, tests.id('appointment_b3')));
  PERFORM tests.expect_changed('service role: move the appointment', 1, format(
    $s$UPDATE public.appointments SET datetime = '2030-01-10 11:00+00' WHERE id = %L$s$, tests.id('appointment_b3')));
  PERFORM tests.expect_changed('service role: delete the appointment', 1, format(
    $s$DELETE FROM public.appointments WHERE id = %L$s$, tests.id('appointment_b3')));
  PERFORM tests.expect_rows('service role: its reminders went with it', 0, format(
    $s$SELECT * FROM public.reminders WHERE appointment_id = %L$s$, tests.id('appointment_b3')));
  PERFORM tests.expect_changed('Stripe webhook: owner B subscribes', 1, format(
    $s$UPDATE public.users SET plan = 'basic', stripe_customer_id = 'cus_owner_b' WHERE id = %L$s$,
    tests.id('owner_b')));

  -- 6. A paid plan can write straight away; the trial end date no longer matters.
  PERFORM pg_temp.expect_owner_b_can_write('subscribed after the trial ended');
  PERFORM pg_temp.set_owner_b('pro', now() - interval '1 year');
  PERFORM pg_temp.expect_owner_b_can_write('pro');

  -- 7. Every plan value, including the legacy names and odd values
  --    users_plan_check no longer accepts and a missing trial end date,
  --    read the way parsePlan() and getEntitlements() read them. The
  --    constraints come back with the rollback at the end of the file.
  ALTER TABLE public.users DROP CONSTRAINT users_plan_check;
  ALTER TABLE public.users ALTER COLUMN trial_ends_at DROP NOT NULL;
  FOR r IN
    SELECT * FROM (VALUES
      ('basic',        now() - interval '1 day', true),
      ('pro',          now() - interval '1 day', true),
      ('business',     now() - interval '1 day', true),
      ('starter',      now() - interval '1 day', true),
      ('professional', now() - interval '1 day', true),
      ('solo-sms',     now() - interval '1 day', true),
      ('team-email',   now() - interval '1 day', true),
      ('studio-both',  now() - interval '1 day', true),
      (' Basic ',      now() - interval '1 day', true),
      ('trial',        now() + interval '1 day', true),
      ('TRIAL',        now() + interval '1 day', true),
      ('trial',        now(),                    false),
      ('trial',        now() - interval '1 day', false),
      ('trial',        NULL,                     false),
      ('cancelled',    now() + interval '1 day', false),
      ('gold',         now() + interval '1 day', false),
      ('',             now() + interval '1 day', false)
    ) AS t(plan, trial_ends_at, expected)
  LOOP
    PERFORM pg_temp.set_owner_b(r.plan, r.trial_ends_at);
    PERFORM tests.expect(
      format('plan %L, trial ends %s: write access %s', r.plan, coalesce(r.trial_ends_at::text, 'never'), r.expected),
      public.owner_has_write_access(tests.id('owner_b')) = r.expected);
  END LOOP;
END $$;

ROLLBACK;
