-- Migration: platform setup.
--
-- Things the live project got through the Supabase dashboard rather than SQL:
--   1. The public Storage bucket "staff-photos". /api/upload/staff-photo
--      uploads with the service-role key and stores the public URL.
--   2. Realtime for public.appointments. The dashboard day and week views
--      refresh when an appointment changes.
--   3. A pg_cron job that calls POST /api/cron/send-reminders every 15 minutes
--      through pg_net, with the X-Cron-Secret header the route checks. The app
--      URL and the secret are read from Supabase Vault each time the job runs,
--      so the secret is not stored in the job.
--
-- Every step checks first and changes nothing when the object is already
-- there, so on the live project this file does nothing. The cron job is only
-- created when both Vault secrets exist, pg_cron and pg_net are available, and
-- no cron job calls /api/cron/send-reminders yet. To have it created:
--     SELECT vault.create_secret('https://your-app.example.com', 'app_url');
--     SELECT vault.create_secret('<same value as CRON_SECRET>', 'cron_secret');
-- then run this file again.
--
-- The SQL Editor does not show notices, so the last query lists what each step
-- did.

BEGIN;

CREATE TEMP TABLE IF NOT EXISTS platform_setup_report (step text, result text);
TRUNCATE pg_temp.platform_setup_report;

-- 1. Storage bucket for staff photos.
DO $$
DECLARE
  v_result text;
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    v_result := 'skipped: Supabase Storage is not installed';
  ELSE
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('staff-photos', 'staff-photos', true)
    ON CONFLICT (id) DO NOTHING;
    v_result := CASE WHEN FOUND THEN 'created (public)' ELSE 'already exists, unchanged' END;
  END IF;
  RAISE NOTICE 'Storage bucket staff-photos: %', v_result;
  INSERT INTO pg_temp.platform_setup_report VALUES ('Storage bucket staff-photos', v_result);
END $$;

-- 2. Realtime for appointments.
DO $$
DECLARE
  v_result text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    v_result := 'skipped: publication supabase_realtime does not exist';
  ELSIF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'appointments'
  ) THEN
    v_result := 'already enabled';
  ELSE
    ALTER PUBLICATION supabase_realtime ADD TABLE public.appointments;
    v_result := 'enabled';
  END IF;
  RAISE NOTICE 'Realtime for public.appointments: %', v_result;
  INSERT INTO pg_temp.platform_setup_report VALUES ('Realtime for public.appointments', v_result);
END $$;

-- 3. Reminder cron job.
DO $$
DECLARE
  v_job     record;
  v_missing text;
  v_result  text;
BEGIN
  -- A job that already calls the route is left alone, whatever its schedule.
  IF to_regclass('cron.job') IS NOT NULL THEN
    SELECT jobid, jobname, schedule, active INTO v_job
    FROM cron.job
    WHERE command ILIKE '%/api/cron/send-reminders%'
    ORDER BY jobid
    LIMIT 1;
    IF FOUND THEN
      v_result := format(
        'already scheduled (job %s "%s", schedule "%s", active: %s), unchanged. '
        'To replace it with the Vault-based job: SELECT cron.unschedule(%s); '
        'then run this file again',
        v_job.jobid, v_job.jobname, v_job.schedule, v_job.active, v_job.jobid);
    END IF;
  END IF;

  IF v_result IS NULL AND to_regclass('vault.decrypted_secrets') IS NULL THEN
    v_result := 'skipped: Supabase Vault is not available';
  END IF;

  IF v_result IS NULL THEN
    SELECT string_agg(n, ' and ') INTO v_missing
    FROM unnest(ARRAY['app_url', 'cron_secret']) AS n
    WHERE NOT EXISTS (
      SELECT 1 FROM vault.decrypted_secrets s
      WHERE s.name = n AND coalesce(s.decrypted_secret, '') <> ''
    );
    IF v_missing IS NOT NULL THEN
      v_result := format(
        'skipped: Vault secret %s not found. Create them with '
        'SELECT vault.create_secret(''<value>'', ''<name>''); then run this file again',
        v_missing);
    END IF;
  END IF;

  IF v_result IS NULL THEN
    IF to_regprocedure('cron.schedule(text,text,text)') IS NULL
       AND EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
      CREATE EXTENSION IF NOT EXISTS pg_cron;
    END IF;
    IF to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL
       AND EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
      CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
    END IF;
    IF to_regprocedure('cron.schedule(text,text,text)') IS NULL
       OR to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL THEN
      v_result := 'skipped: the pg_cron and pg_net extensions are not available';
    END IF;
  END IF;

  IF v_result IS NULL THEN
    PERFORM cron.schedule(
      'noshowly-send-reminders',
      '*/15 * * * *',
      $job$
      SELECT net.http_post(
        url := rtrim(
          (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'app_url'),
          '/'
        ) || '/api/cron/send-reminders',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'X-Cron-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 30000
      )
      $job$
    );
    v_result := 'scheduled as "noshowly-send-reminders", every 15 minutes';
  END IF;

  RAISE NOTICE 'Reminder cron job: %', v_result;
  INSERT INTO pg_temp.platform_setup_report VALUES ('Reminder cron job', v_result);
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Reminder cron job not created: %', SQLERRM;
    INSERT INTO pg_temp.platform_setup_report
    VALUES ('Reminder cron job', 'skipped: ' || SQLERRM);
END $$;

COMMIT;

SELECT step, result FROM pg_temp.platform_setup_report;
