-- Migration: data integrity.
--
-- Safe to run on the live project, and safe to run again. Everything runs in
-- one transaction. Constraints that existing rows could break are added
-- NOT VALID, which enforces them for new and changed rows straight away, and
-- are then validated separately. Unique indexes and the double-booking
-- constraint are only created when existing rows allow it. When existing rows
-- are in the way, that one step is skipped with a notice that includes the
-- query listing those rows, and the rest of the file still applies. Fix the
-- rows, then run the file again to finish. The SQL Editor does not show
-- notices, so the last query lists every step and what it did, with the steps
-- that need attention first.
--
-- What it changes:
--   1. services.created_at becomes timestamptz like every other created_at.
--   2. Legacy plan names are renamed (starter and the SMS-era names to basic,
--      professional to pro) and users.plan only accepts current plans.
--   3. CHECK constraints on appointment and reminder status, reminder type,
--      durations, prices, business hours and booking page slugs.
--   4. Tenant integrity: appointments and barber_services can only point at a
--      barber, service or client of their own salon.
--   5. No double booking: a barber cannot have two overlapping appointments
--      unless one of them is cancelled.
--   6. One salon per owner; booking page slugs are unique ignoring case; one
--      account per Stripe customer.
--   7. Indexes for foreign keys and frequent lookups. Drops two redundant ones.
--   8. Owner policies call auth.uid() once per query instead of once per row.
--   9. Drops the unused staff_services table and the unused SMS and
--      "no preference" columns. users.reminders_used_this_month stays: the
--      cron route still resets it every month.
--
-- Requires PostgreSQL 15 or later (ON DELETE SET NULL with a column list).

BEGIN;

-- Fail fast instead of queueing behind a long-running query; nothing is
-- changed if a lock cannot be taken. Run the file again later.
SET LOCAL lock_timeout = '10s';

CREATE TEMP TABLE IF NOT EXISTS data_integrity_report (
  seq         serial,
  step        text,
  result      text,
  rows_to_fix text
);
TRUNCATE pg_temp.data_integrity_report RESTART IDENTITY;

CREATE OR REPLACE FUNCTION pg_temp.data_integrity_note(
  p_step        text,
  p_result      text,
  p_rows_to_fix text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_rows_to_fix IS NULL THEN
    RAISE NOTICE '%: %', p_step, p_result;
  ELSE
    RAISE NOTICE '%: %. Rows to fix: %', p_step, p_result, p_rows_to_fix;
  END IF;
  INSERT INTO pg_temp.data_integrity_report (step, result, rows_to_fix)
  VALUES (p_step, p_result, p_rows_to_fix);
END;
$$;


-- 1. services.created_at was TIMESTAMP (without time zone). The values were
--    written by NOW() in UTC, the Supabase default.
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'created_at')
     = 'timestamp without time zone' THEN
    ALTER TABLE public.services
      ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
    PERFORM pg_temp.data_integrity_note('services.created_at', 'converted to timestamptz');
  ELSE
    PERFORM pg_temp.data_integrity_note('services.created_at', 'already timestamptz');
  END IF;
END $$;


-- 2. Plan names. lib/plans.ts and the Stripe webhook only use trial, basic,
--    pro, business and cancelled; the other names are legacy aliases.
DO $$
DECLARE
  v_counts text;
  c        record;
BEGIN
  SELECT string_agg(format('%s x%s', plan, n), ', ' ORDER BY plan) INTO v_counts
  FROM (
    SELECT plan, count(*) AS n FROM public.users
    WHERE plan IN ('starter', 'professional',
                   'solo-sms', 'team-sms', 'studio-sms',
                   'solo-email', 'team-email', 'studio-email',
                   'solo-both', 'team-both', 'studio-both')
    GROUP BY plan
  ) legacy;

  UPDATE public.users SET plan = 'basic'
  WHERE plan IN ('starter',
                 'solo-sms', 'team-sms', 'studio-sms',
                 'solo-email', 'team-email', 'studio-email',
                 'solo-both', 'team-both', 'studio-both');
  UPDATE public.users SET plan = 'pro' WHERE plan = 'professional';

  PERFORM pg_temp.data_integrity_note(
    'Legacy plan names',
    coalesce('renamed ' || v_counts || ' (professional to pro, the others to basic)', 'none found'));

  -- Drop the old plan CHECK (and any other CHECK on users.plan that still
  -- lists legacy names). CHECK constraints are looked up in pg_constraint
  -- (contype = 'c'): information_schema.check_constraints also lists NOT NULL.
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid AND att.attname = 'plan'
    WHERE con.conrelid = 'public.users'::regclass
      AND con.contype = 'c'
      AND con.conkey = ARRAY[att.attnum]
      AND (con.conname <> 'users_plan_check'
           OR pg_get_constraintdef(con.oid) ~ '''(starter|professional|solo-|team-|studio-)')
  LOOP
    EXECUTE format('ALTER TABLE public.users DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;


-- 3 and 4. CHECK constraints and same-salon foreign keys.
--    The composite foreign keys need a unique key on (id, salon_id). id is
--    already the primary key, so these can never fail.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT * FROM (VALUES
      ('barbers',  'barbers_id_salon_id_key'),
      ('services', 'services_id_salon_id_key'),
      ('clients',  'clients_id_salon_id_key')
    ) AS t(tbl, name)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = format('public.%I', c.tbl)::regclass AND conname = c.name
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (id, salon_id)', c.tbl, c.name);
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  c       record;
  v_added boolean;
BEGIN
  FOR c IN
    SELECT * FROM (VALUES
      ('appointments', 'appointments_status_check',
       $d$CHECK (status IN ('scheduled', 'confirmed', 'cancelled'))$d$,
       $q$SELECT id, salon_id, status FROM public.appointments WHERE status NOT IN ('scheduled', 'confirmed', 'cancelled')$q$),

      ('appointments', 'appointments_duration_minutes_check',
       $d$CHECK (duration_minutes BETWEEN 1 AND 480)$d$,
       $q$SELECT id, salon_id, duration_minutes FROM public.appointments WHERE duration_minutes NOT BETWEEN 1 AND 480$q$),

      -- 'email' = 24-hour reminder, 'email_confirmation' = booking
      -- confirmation, 'email_test' = manual test send, 'sms' = legacy rows.
      ('reminders', 'reminders_type_check',
       $d$CHECK (type IN ('email', 'email_confirmation', 'email_test', 'sms'))$d$,
       $q$SELECT id, appointment_id, type FROM public.reminders WHERE type NOT IN ('email', 'email_confirmation', 'email_test', 'sms')$q$),

      ('reminders', 'reminders_status_check',
       $d$CHECK (status IN ('pending', 'sent', 'failed', 'confirmed', 'cancelled', 'skipped'))$d$,
       $q$SELECT id, appointment_id, status FROM public.reminders WHERE status NOT IN ('pending', 'sent', 'failed', 'confirmed', 'cancelled', 'skipped')$q$),

      ('services', 'services_duration_minutes_check',
       $d$CHECK (duration_minutes BETWEEN 1 AND 480)$d$,
       $q$SELECT id, salon_id, duration_minutes FROM public.services WHERE duration_minutes NOT BETWEEN 1 AND 480$q$),

      ('services', 'services_price_check',
       $d$CHECK (price >= 0)$d$,
       $q$SELECT id, salon_id, price FROM public.services WHERE price < 0$q$),

      -- NULL overrides mean "use the service default" and always pass.
      ('barber_services', 'barber_services_duration_minutes_override_check',
       $d$CHECK (duration_minutes_override BETWEEN 1 AND 480)$d$,
       $q$SELECT id, salon_id, duration_minutes_override FROM public.barber_services WHERE duration_minutes_override NOT BETWEEN 1 AND 480$q$),

      ('barber_services', 'barber_services_price_override_check',
       $d$CHECK (price_override >= 0)$d$,
       $q$SELECT id, salon_id, price_override FROM public.barber_services WHERE price_override < 0$q$),

      -- Passes while either time is NULL (business hours not configured).
      ('salons', 'salons_business_hours_check',
       $d$CHECK (opening_time < closing_time)$d$,
       $q$SELECT id, opening_time, closing_time FROM public.salons WHERE opening_time >= closing_time$q$),

      -- Same rule as /api/booking-page.
      ('booking_pages', 'booking_pages_slug_format_check',
       $d$CHECK (slug ~ '^[a-z0-9-]+$')$d$,
       $q$SELECT id, salon_id, slug FROM public.booking_pages WHERE slug !~ '^[a-z0-9-]+$'$q$),

      ('users', 'users_plan_check',
       $d$CHECK (plan IN ('trial', 'basic', 'pro', 'business', 'cancelled'))$d$,
       $q$SELECT id, plan FROM public.users WHERE plan NOT IN ('trial', 'basic', 'pro', 'business', 'cancelled')$q$),

      -- Deleting a barber or client keeps the appointment and clears the link,
      -- as the existing single-column foreign keys do.
      ('appointments', 'appointments_barber_id_salon_id_fkey',
       $d$FOREIGN KEY (barber_id, salon_id) REFERENCES public.barbers (id, salon_id) ON DELETE SET NULL (barber_id)$d$,
       $q$SELECT a.id, a.salon_id, a.barber_id FROM public.appointments a WHERE a.barber_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.barbers b WHERE b.id = a.barber_id AND b.salon_id = a.salon_id)$q$),

      ('appointments', 'appointments_client_id_salon_id_fkey',
       $d$FOREIGN KEY (client_id, salon_id) REFERENCES public.clients (id, salon_id) ON DELETE SET NULL (client_id)$d$,
       $q$SELECT a.id, a.salon_id, a.client_id FROM public.appointments a WHERE a.client_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = a.client_id AND c.salon_id = a.salon_id)$q$),

      ('barber_services', 'barber_services_barber_id_salon_id_fkey',
       $d$FOREIGN KEY (barber_id, salon_id) REFERENCES public.barbers (id, salon_id) ON DELETE CASCADE$d$,
       $q$SELECT bs.id, bs.salon_id, bs.barber_id FROM public.barber_services bs WHERE NOT EXISTS (SELECT 1 FROM public.barbers b WHERE b.id = bs.barber_id AND b.salon_id = bs.salon_id)$q$),

      ('barber_services', 'barber_services_service_id_salon_id_fkey',
       $d$FOREIGN KEY (service_id, salon_id) REFERENCES public.services (id, salon_id) ON DELETE CASCADE$d$,
       $q$SELECT bs.id, bs.salon_id, bs.service_id FROM public.barber_services bs WHERE NOT EXISTS (SELECT 1 FROM public.services s WHERE s.id = bs.service_id AND s.salon_id = bs.salon_id)$q$)
    ) AS t(tbl, name, def, rows_to_fix)
  LOOP
    v_added := NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = format('public.%I', c.tbl)::regclass AND conname = c.name
    );
    IF v_added THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I %s NOT VALID', c.tbl, c.name, c.def);
    END IF;

    IF (SELECT convalidated FROM pg_constraint
        WHERE conrelid = format('public.%I', c.tbl)::regclass AND conname = c.name) THEN
      PERFORM pg_temp.data_integrity_note(c.name, 'in place');
      CONTINUE;
    END IF;

    BEGIN
      EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', c.tbl, c.name);
      PERFORM pg_temp.data_integrity_note(c.name,
        CASE WHEN v_added THEN 'added and validated' ELSE 'validated' END);
    EXCEPTION
      WHEN check_violation OR foreign_key_violation THEN
        PERFORM pg_temp.data_integrity_note(
          c.name,
          'enforced for new and changed rows, but existing rows break it, so it is not validated yet',
          c.rows_to_fix);
    END;
  END LOOP;
END $$;


-- 5. Double booking. appt_period() is the time an appointment occupies,
--    [start, start + duration). A minutes-only interval does not depend on the
--    session time zone, so the function is IMMUTABLE and can be used in an
--    index. Durations below zero (existing bad rows) count as an empty range.
CREATE OR REPLACE FUNCTION public.appt_period(p_start timestamptz, p_minutes integer)
RETURNS tstzrange
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT pg_catalog.tstzrange(
    p_start,
    p_start + pg_catalog.make_interval(mins => GREATEST(p_minutes, 0)),
    '[)'
  )
$$;

DO $$
DECLARE
  v_find   text := $q$SELECT a.barber_id, a.id AS appointment_id, a.datetime, a.duration_minutes, b.id AS overlapping_id, b.datetime AS overlapping_datetime, b.duration_minutes AS overlapping_duration_minutes FROM public.appointments a JOIN public.appointments b ON b.barber_id = a.barber_id AND a.id < b.id AND public.appt_period(a.datetime, a.duration_minutes) && public.appt_period(b.datetime, b.duration_minutes) WHERE a.status <> 'cancelled' AND b.status <> 'cancelled' ORDER BY a.barber_id, a.datetime$q$;
  v_pairs  bigint;
  v_schema text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.appointments'::regclass AND conname = 'appointments_no_double_booking'
  ) THEN
    PERFORM pg_temp.data_integrity_note('appointments_no_double_booking', 'in place');
    RETURN;
  END IF;

  -- btree_gist lets a GiST index compare barber_id (a uuid) with =.
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'btree_gist') THEN
      PERFORM pg_temp.data_integrity_note('appointments_no_double_booking',
        'skipped: the btree_gist extension is not available on this server');
      RETURN;
    END IF;
    IF to_regnamespace('extensions') IS NOT NULL THEN
      CREATE EXTENSION btree_gist WITH SCHEMA extensions;
    ELSE
      CREATE EXTENSION btree_gist;
    END IF;
  END IF;

  EXECUTE format('SELECT count(*) FROM (%s) overlapping_pairs', v_find) INTO v_pairs;
  IF v_pairs > 0 THEN
    PERFORM pg_temp.data_integrity_note('appointments_no_double_booking',
      format('skipped: %s pair(s) of appointments already overlap. Cancel, move or reassign one of each pair', v_pairs),
      v_find);
    RETURN;
  END IF;

  SELECT n.nspname INTO v_schema
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'btree_gist';

  EXECUTE format(
    'ALTER TABLE public.appointments ADD CONSTRAINT appointments_no_double_booking '
    'EXCLUDE USING gist (barber_id %I.gist_uuid_ops WITH =, '
    'public.appt_period(datetime, duration_minutes) WITH &&) '
    'WHERE (barber_id IS NOT NULL AND status <> ''cancelled'')',
    v_schema);
  PERFORM pg_temp.data_integrity_note('appointments_no_double_booking', 'added');
EXCEPTION
  WHEN exclusion_violation THEN
    PERFORM pg_temp.data_integrity_note('appointments_no_double_booking',
      'skipped: appointments already overlap', v_find);
END $$;


-- 6. Unique rules that existing rows could break.

-- One salon per owner: every route loads the salon with .eq('user_id', ...)
-- .maybeSingle(), which fails when an owner has two. While duplicates exist,
-- a plain index on user_id is created instead.
DO $$
DECLARE
  v_find  text := $q$SELECT user_id, count(*) AS salons, array_agg(id ORDER BY created_at) AS salon_ids FROM public.salons GROUP BY user_id HAVING count(*) > 1$q$;
  v_count bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.salons'::regclass AND conname = 'salons_user_id_key'
  ) THEN
    EXECUTE format('SELECT count(*) FROM (%s) dupes', v_find) INTO v_count;
    IF v_count > 0 THEN
      CREATE INDEX IF NOT EXISTS idx_salons_user_id ON public.salons (user_id);
      PERFORM pg_temp.data_integrity_note('salons_user_id_key',
        format('skipped: %s owner(s) have more than one salon; indexed salons (user_id) instead', v_count),
        v_find);
      RETURN;
    END IF;
    ALTER TABLE public.salons ADD CONSTRAINT salons_user_id_key UNIQUE (user_id);
    PERFORM pg_temp.data_integrity_note('salons_user_id_key', 'added');
  ELSE
    PERFORM pg_temp.data_integrity_note('salons_user_id_key', 'in place');
  END IF;
  -- The unique constraint's index replaces the fallback index.
  IF to_regclass('public.idx_salons_user_id') IS NOT NULL THEN
    DROP INDEX public.idx_salons_user_id;
  END IF;
EXCEPTION
  WHEN unique_violation THEN
    CREATE INDEX IF NOT EXISTS idx_salons_user_id ON public.salons (user_id);
    PERFORM pg_temp.data_integrity_note('salons_user_id_key',
      'skipped: owners with more than one salon; indexed salons (user_id) instead', v_find);
END $$;

-- Booking page slugs unique ignoring case, and one account per Stripe customer
-- (the Stripe webhook updates users by stripe_customer_id).
DO $$
DECLARE
  c       record;
  v_count bigint;
BEGIN
  FOR c IN
    SELECT * FROM (VALUES
      ('booking_pages_slug_lower_key',
       $i$CREATE UNIQUE INDEX booking_pages_slug_lower_key ON public.booking_pages (lower(slug))$i$,
       $q$SELECT lower(slug) AS slug, array_agg(id) AS booking_page_ids FROM public.booking_pages GROUP BY lower(slug) HAVING count(*) > 1$q$),
      ('users_stripe_customer_id_key',
       $i$CREATE UNIQUE INDEX users_stripe_customer_id_key ON public.users (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL$i$,
       $q$SELECT stripe_customer_id, array_agg(id) AS user_ids FROM public.users WHERE stripe_customer_id IS NOT NULL GROUP BY stripe_customer_id HAVING count(*) > 1$q$)
    ) AS t(name, ddl, rows_to_fix)
  LOOP
    IF to_regclass(format('public.%I', c.name)) IS NOT NULL THEN
      PERFORM pg_temp.data_integrity_note(c.name, 'in place');
      CONTINUE;
    END IF;
    EXECUTE format('SELECT count(*) FROM (%s) dupes', c.rows_to_fix) INTO v_count;
    IF v_count > 0 THEN
      PERFORM pg_temp.data_integrity_note(c.name,
        format('skipped: %s duplicate value(s)', v_count), c.rows_to_fix);
      CONTINUE;
    END IF;
    BEGIN
      EXECUTE c.ddl;
      PERFORM pg_temp.data_integrity_note(c.name, 'added');
    EXCEPTION
      WHEN unique_violation THEN
        PERFORM pg_temp.data_integrity_note(c.name, 'skipped: duplicate values', c.rows_to_fix);
    END;
  END LOOP;
END $$;


-- 7. Indexes. Foreign keys that had none, and the lookups the app runs most:
--    appointments by barber and time (conflict checks), reminders by
--    appointment (cron dedup, cascades). barber_services (barber_id) is
--    already covered by barber_services_barber_id_service_id_key.
CREATE INDEX IF NOT EXISTS idx_appointments_barber_datetime
  ON public.appointments (barber_id, datetime);

CREATE INDEX IF NOT EXISTS idx_appointments_client_id
  ON public.appointments (client_id);

CREATE INDEX IF NOT EXISTS idx_reminders_appointment_id
  ON public.reminders (appointment_id);

CREATE INDEX IF NOT EXISTS idx_services_salon_id
  ON public.services (salon_id);

CREATE INDEX IF NOT EXISTS idx_barber_services_service_id
  ON public.barber_services (service_id);

CREATE INDEX IF NOT EXISTS idx_barber_services_salon_id
  ON public.barber_services (salon_id);

-- Duplicate of the reminders_token_key unique constraint.
DROP INDEX IF EXISTS public.idx_reminders_token;

-- Three possible values; no query filters on status alone.
DROP INDEX IF EXISTS public.idx_appointments_status;


-- 8. Owner policies: same rules, TO authenticated as in
--    20260928120000_security_hardening.sql, with auth.uid() wrapped in a
--    sub-select so Postgres evaluates it once per query.
DROP POLICY IF EXISTS "users: owner select" ON public.users;
CREATE POLICY "users: owner select"
  ON public.users FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "salons: owner all" ON public.salons;
CREATE POLICY "salons: owner all"
  ON public.salons FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "barbers: owner all" ON public.barbers;
CREATE POLICY "barbers: owner all"
  ON public.barbers FOR ALL TO authenticated
  USING (
    salon_id IN (
      SELECT id FROM public.salons WHERE user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "clients: owner all" ON public.clients;
CREATE POLICY "clients: owner all"
  ON public.clients FOR ALL TO authenticated
  USING (
    salon_id IN (
      SELECT id FROM public.salons WHERE user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "appointments: owner all" ON public.appointments;
CREATE POLICY "appointments: owner all"
  ON public.appointments FOR ALL TO authenticated
  USING (
    salon_id IN (
      SELECT id FROM public.salons WHERE user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "reminders: owner all" ON public.reminders;
CREATE POLICY "reminders: owner all"
  ON public.reminders FOR ALL TO authenticated
  USING (
    appointment_id IN (
      SELECT id FROM public.appointments
      WHERE salon_id IN (
        SELECT id FROM public.salons WHERE user_id = (SELECT auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "Users own services" ON public.services;
CREATE POLICY "Users own services"
  ON public.services FOR ALL TO authenticated
  USING (
    salon_id IN (SELECT id FROM public.salons WHERE user_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS "Users own booking page" ON public.booking_pages;
CREATE POLICY "Users own booking page"
  ON public.booking_pages FOR ALL TO authenticated
  USING (
    salon_id IN (
      SELECT id FROM public.salons WHERE user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Owner can manage barber_services" ON public.barber_services;
CREATE POLICY "Owner can manage barber_services"
  ON public.barber_services FOR ALL TO authenticated
  USING (
    salon_id IN (SELECT id FROM public.salons WHERE user_id = (SELECT auth.uid()))
  )
  WITH CHECK (
    salon_id IN (SELECT id FROM public.salons WHERE user_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS "Users own staff availability" ON public.staff_availability;
CREATE POLICY "Users own staff availability"
  ON public.staff_availability FOR ALL TO authenticated
  USING (
    barber_id IN (
      SELECT b.id
      FROM   public.barbers b
      JOIN   public.salons  s ON s.id = b.salon_id
      WHERE  s.user_id = (SELECT auth.uid())
    )
  );


-- 9. Unused objects. Nothing in app/, lib/ or components/ reads them.
--    Skipped with a notice if something else in the database depends on them.
DO $$
DECLARE
  c record;
BEGIN
  IF to_regclass('public.staff_services') IS NOT NULL THEN
    BEGIN
      DROP TABLE public.staff_services;
      PERFORM pg_temp.data_integrity_note('staff_services', 'table dropped');
    EXCEPTION
      WHEN dependent_objects_still_exist THEN
        PERFORM pg_temp.data_integrity_note('staff_services', 'not dropped: ' || SQLERRM);
    END;
  END IF;

  FOR c IN
    SELECT * FROM (VALUES
      ('salons',        'sms_sender_name'),
      ('salons',        'sms_confirmation_enabled'),
      ('salons',        'sms_template'),
      ('booking_pages', 'allow_no_preference_staff'),
      ('booking_pages', 'allow_no_preference_service')
    ) AS t(tbl, col)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = c.tbl AND column_name = c.col
    ) THEN
      BEGIN
        EXECUTE format('ALTER TABLE public.%I DROP COLUMN %I', c.tbl, c.col);
        PERFORM pg_temp.data_integrity_note(format('%s.%s', c.tbl, c.col), 'column dropped');
      EXCEPTION
        WHEN dependent_objects_still_exist THEN
          PERFORM pg_temp.data_integrity_note(format('%s.%s', c.tbl, c.col), 'not dropped: ' || SQLERRM);
      END;
    END IF;
  END LOOP;
END $$;

COMMIT;

SELECT step, result, rows_to_fix
FROM pg_temp.data_integrity_report
ORDER BY rows_to_fix IS NULL, seq;
