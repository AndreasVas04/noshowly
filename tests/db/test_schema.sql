-- The schema after every migration: dead objects gone, constraints validated,
-- expected indexes and policies, and no privileges left for anonymous visitors.

BEGIN;

DO $$
DECLARE
  v_tables text[] := ARRAY['users', 'salons', 'barbers', 'clients', 'appointments', 'reminders',
                           'services', 'booking_pages', 'staff_availability', 'barber_services'];
  v_name   text;
  v_extra  text;
  r        record;
BEGIN
  -- Unused objects dropped; the counter the cron route still writes is kept.
  PERFORM tests.expect('staff_services is dropped', to_regclass('public.staff_services') IS NULL);
  PERFORM tests.expect_rows('unused columns are dropped', 0, $q$
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (table_name, column_name) IN (('salons', 'sms_sender_name'), ('salons', 'sms_confirmation_enabled'),
                                        ('salons', 'sms_template'), ('booking_pages', 'allow_no_preference_staff'),
                                        ('booking_pages', 'allow_no_preference_service'))$q$);
  PERFORM tests.expect_rows('users.reminders_used_this_month is kept', 1, $q$
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'reminders_used_this_month'$q$);
  PERFORM tests.expect('services.created_at is timestamptz',
    (SELECT data_type FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'created_at')
    = 'timestamp with time zone');

  -- Row Level Security everywhere.
  FOREACH v_name IN ARRAY v_tables LOOP
    PERFORM tests.expect(format('RLS enabled on %s', v_name),
      (SELECT relrowsecurity FROM pg_class WHERE oid = format('public.%I', v_name)::regclass));
  END LOOP;

  -- Constraints: present and validated.
  FOREACH v_name IN ARRAY ARRAY[
    'appointments_status_check', 'appointments_duration_minutes_check',
    'reminders_type_check', 'reminders_status_check',
    'services_duration_minutes_check', 'services_price_check',
    'barber_services_duration_minutes_override_check', 'barber_services_price_override_check',
    'salons_business_hours_check', 'booking_pages_slug_format_check', 'users_plan_check',
    'barbers_id_salon_id_key', 'services_id_salon_id_key', 'clients_id_salon_id_key',
    'appointments_barber_id_salon_id_fkey', 'appointments_client_id_salon_id_fkey',
    'barber_services_barber_id_salon_id_fkey', 'barber_services_service_id_salon_id_fkey',
    'appointments_no_double_booking', 'salons_user_id_key']
  LOOP
    PERFORM tests.expect(format('constraint %s exists and is validated', v_name),
      EXISTS (SELECT 1 FROM pg_constraint
              WHERE connamespace = 'public'::regnamespace AND conname = v_name AND convalidated));
  END LOOP;
  PERFORM tests.expect_rows('no constraint left unvalidated', 0, $q$
    SELECT conname FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND NOT convalidated$q$);

  -- Exactly one foreign key between each pair of tables: with two, PostgREST
  -- cannot resolve embeds such as appointments?select=clients(name)
  -- (PGRST201). The same-salon keys keep the old delete behaviour.
  FOR r IN
    SELECT * FROM (VALUES
      ('appointments',    'clients',  'appointments_client_id_salon_id_fkey',     'n', 'client_id'),
      ('appointments',    'barbers',  'appointments_barber_id_salon_id_fkey',     'n', 'barber_id'),
      ('barber_services', 'barbers',  'barber_services_barber_id_salon_id_fkey',  'c', NULL),
      ('barber_services', 'services', 'barber_services_service_id_salon_id_fkey', 'c', NULL)
    ) AS t(tbl, ref, fkey, on_delete, set_null_column)
  LOOP
    PERFORM tests.expect_rows(format('%s has exactly one foreign key to %s', r.tbl, r.ref), 1, format(
      $q$SELECT conname FROM pg_constraint WHERE contype = 'f' AND conrelid = %L::regclass AND confrelid = %L::regclass$q$,
      'public.' || r.tbl, 'public.' || r.ref));
    PERFORM tests.expect(format('%s is the foreign key from %s to %s', r.fkey, r.tbl, r.ref),
      EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = r.fkey AND contype = 'f'
                AND conrelid = format('public.%I', r.tbl)::regclass
                AND confrelid = format('public.%I', r.ref)::regclass));
    PERFORM tests.expect(
      format('%s: ON DELETE %s', r.fkey,
             CASE r.on_delete WHEN 'n' THEN format('SET NULL (%s)', r.set_null_column) ELSE 'CASCADE' END),
      EXISTS (SELECT 1 FROM pg_constraint con
              WHERE con.conname = r.fkey
                AND con.confdeltype::text = r.on_delete
                AND (r.set_null_column IS NULL
                     OR con.confdelsetcols = ARRAY[(SELECT attnum FROM pg_attribute
                                                    WHERE attrelid = con.conrelid
                                                      AND attname = r.set_null_column)])));
  END LOOP;
  PERFORM tests.expect_rows('no two foreign keys between the same two tables', 0, $q$
    SELECT conrelid, confrelid FROM pg_constraint
    WHERE contype = 'f' AND connamespace = 'public'::regnamespace
    GROUP BY conrelid, confrelid HAVING count(*) > 1$q$);

  -- Indexes.
  FOREACH v_name IN ARRAY ARRAY[
    'idx_appointments_barber_datetime', 'idx_appointments_client_id', 'idx_reminders_appointment_id',
    'idx_services_salon_id', 'idx_barber_services_service_id', 'idx_barber_services_salon_id',
    'booking_pages_slug_lower_key', 'users_stripe_customer_id_key', 'reminders_one_email_per_appointment']
  LOOP
    PERFORM tests.expect(format('index %s exists', v_name), to_regclass(format('public.%I', v_name)) IS NOT NULL);
  END LOOP;
  FOREACH v_name IN ARRAY ARRAY['idx_reminders_token', 'idx_appointments_status', 'idx_salons_user_id'] LOOP
    PERFORM tests.expect(format('index %s is gone', v_name), to_regclass(format('public.%I', v_name)) IS NULL);
  END LOOP;

  -- Policies: exactly the owner policies, for signed-in users only, with
  -- auth.uid() evaluated once per query.
  SELECT string_agg(format('%s: %s', tablename, policyname), ', ') INTO v_extra
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (tablename, policyname) NOT IN (
      ('users', 'users: owner select'), ('salons', 'salons: owner all'),
      ('barbers', 'barbers: owner all'), ('clients', 'clients: owner all'),
      ('appointments', 'appointments: owner all'), ('reminders', 'reminders: owner all'),
      ('services', 'Users own services'), ('booking_pages', 'Users own booking page'),
      ('barber_services', 'Owner can manage barber_services'),
      ('staff_availability', 'Users own staff availability'));
  PERFORM tests.expect(format('only owner policies remain (extra: %s)', v_extra), v_extra IS NULL);
  PERFORM tests.expect_rows('ten owner policies', 10, $q$SELECT 1 FROM pg_policies WHERE schemaname = 'public'$q$);
  PERFORM tests.expect_rows('owner policies apply to authenticated only', 0, $q$
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND roles <> '{authenticated}'::name[]$q$);
  PERFORM tests.expect_rows('auth.uid() is always wrapped in a sub-select', 0, $q$
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND regexp_count(coalesce(qual, '') || coalesce(with_check, ''), 'auth\.uid\(\)')
       <> regexp_count(coalesce(qual, '') || coalesce(with_check, ''), 'SELECT auth\.uid\(\)')$q$);

  -- Anonymous visitors: nothing but salons.id (keep-alive).
  PERFORM tests.expect_rows('anon has no table privileges', 0, $q$
    SELECT 1 FROM information_schema.role_table_grants
    WHERE grantee = 'anon' AND table_schema = 'public'$q$);
  PERFORM tests.expect_rows('anon can select salons.id only', 1, $q$
    SELECT 1 FROM information_schema.column_privileges
    WHERE grantee = 'anon' AND table_schema = 'public'$q$);
  PERFORM tests.expect('anon can select salons.id', has_column_privilege('anon', 'public.salons', 'id', 'SELECT'));

  -- Signed-in owners cannot write billing fields or delete salons.
  PERFORM tests.expect('authenticated cannot update users',
    NOT has_table_privilege('authenticated', 'public.users', 'UPDATE'));
  PERFORM tests.expect('authenticated cannot delete salons',
    NOT has_table_privilege('authenticated', 'public.salons', 'DELETE'));

  -- Functions.
  PERFORM tests.expect('salon_is_bookable() is dropped',
    to_regprocedure('public.salon_is_bookable(uuid)') IS NULL);
  PERFORM tests.expect('appt_period() is immutable',
    (SELECT provolatile FROM pg_proc WHERE oid = to_regprocedure('public.appt_period(timestamptz,integer)')) = 'i');
  PERFORM tests.expect('demo account trigger exists',
    EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'protect_demo_account' AND tgrelid = 'auth.users'::regclass));
END $$;

ROLLBACK;
