-- 20260609000100_platform_setup.sql: storage bucket, realtime, and the
-- reminder cron job. This server has no pg_cron or pg_net, so the job part
-- runs again below against small stand-ins for both extensions. The migration
-- commits, so this file cleans up after itself instead of rolling back.

DO $$
BEGIN
  PERFORM tests.expect('bucket staff-photos exists and is public',
    EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'staff-photos' AND public));
  PERFORM tests.expect('appointments are published to realtime',
    EXISTS (SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'appointments'));
  PERFORM tests.expect('no cron job without pg_cron', to_regnamespace('cron') IS NULL);
END $$;

-- Stand-ins with the same signatures as pg_cron and pg_net. http_post records
-- the request instead of sending it.
CREATE SCHEMA cron;
CREATE TABLE cron.job (
  jobid    bigserial PRIMARY KEY,
  schedule text NOT NULL,
  command  text NOT NULL,
  active   boolean NOT NULL DEFAULT true,
  jobname  text UNIQUE
);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint
LANGUAGE sql
AS $$
  INSERT INTO cron.job (jobname, schedule, command)
  VALUES (schedule.job_name, schedule.schedule, schedule.command)
  ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command
  RETURNING jobid
$$;

CREATE SCHEMA net;
CREATE TABLE net.requests (
  id      bigserial PRIMARY KEY,
  method  text,
  url     text,
  headers jsonb,
  body    jsonb,
  timeout integer
);
CREATE FUNCTION net.http_post(
  url                  text,
  body                 jsonb   DEFAULT '{}'::jsonb,
  params               jsonb   DEFAULT '{}'::jsonb,
  headers              jsonb   DEFAULT '{"Content-Type": "application/json"}'::jsonb,
  timeout_milliseconds integer DEFAULT 2000
) RETURNS bigint
LANGUAGE sql
AS $$
  INSERT INTO net.requests (method, url, headers, body, timeout)
  VALUES ('POST', http_post.url, http_post.headers, http_post.body, http_post.timeout_milliseconds)
  RETURNING id
$$;

-- Without the Vault secrets, no job.
\ir ../../supabase/migrations/20260609000100_platform_setup.sql
DO $$
BEGIN
  PERFORM tests.expect_rows('no job without the Vault secrets', 0, 'SELECT * FROM cron.job');
END $$;

-- With them, one job; running the file again does not add a second.
SELECT vault.create_secret('https://app.example.test/', 'app_url');
SELECT vault.create_secret('test-cron-secret', 'cron_secret');
\ir ../../supabase/migrations/20260609000100_platform_setup.sql
\ir ../../supabase/migrations/20260609000100_platform_setup.sql

DO $$
DECLARE
  v_job     cron.job;
  v_request net.requests;
BEGIN
  PERFORM tests.expect_rows('exactly one reminder job', 1, 'SELECT * FROM cron.job');
  SELECT * INTO v_job FROM cron.job;
  PERFORM tests.expect('job runs every 15 minutes', v_job.schedule = '*/15 * * * *');
  PERFORM tests.expect('the secret is not stored in the job', position('test-cron-secret' IN v_job.command) = 0);

  EXECUTE v_job.command;
  SELECT * INTO v_request FROM net.requests ORDER BY id DESC LIMIT 1;
  PERFORM tests.expect(format('job POSTs to the cron route (got %s %s)', v_request.method, v_request.url),
    v_request.method = 'POST' AND v_request.url = 'https://app.example.test/api/cron/send-reminders');
  PERFORM tests.expect('job sends the X-Cron-Secret header',
    v_request.headers ->> 'X-Cron-Secret' = 'test-cron-secret');
END $$;

-- A job created earlier (for example from the dashboard) is left alone.
TRUNCATE cron.job;
INSERT INTO cron.job (jobname, schedule, command) VALUES
  ('send-reminders-hourly', '0 * * * *',
   $$SELECT net.http_post(url := 'https://app.example.test/api/cron/send-reminders', headers := '{"X-Cron-Secret": "x"}'::jsonb)$$);
\ir ../../supabase/migrations/20260609000100_platform_setup.sql
DO $$
BEGIN
  PERFORM tests.expect_rows('existing job kept, none added', 1,
    $q$SELECT * FROM cron.job WHERE jobname = 'send-reminders-hourly' AND schedule = '0 * * * *'$q$);
  PERFORM tests.expect_rows('only one job', 1, 'SELECT * FROM cron.job');
END $$;

-- Clean up.
DROP SCHEMA cron CASCADE;
DROP SCHEMA net CASCADE;
DELETE FROM vault.secrets WHERE name IN ('app_url', 'cron_secret');
