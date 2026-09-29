-- 20260929130000_demo_reset.sql: the nightly job. This server has no
-- pg_cron, so the migration runs again below against a small stand-in for it.
-- The migration commits, so this file cleans up after itself instead of
-- rolling back.

DO $$
BEGIN
  PERFORM tests.expect('no job without pg_cron', to_regnamespace('cron') IS NULL);
END $$;

-- Stand-in with the same signature as pg_cron's cron.schedule.
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

-- One job; running the file again does not add a second.
\ir ../../supabase/migrations/20260929130000_demo_reset.sql
\ir ../../supabase/migrations/20260929130000_demo_reset.sql

DO $$
DECLARE
  v_job cron.job;
BEGIN
  PERFORM tests.expect_rows('exactly one job', 1, 'SELECT * FROM cron.job');
  SELECT * INTO v_job FROM cron.job;
  PERFORM tests.expect('named noshowly-reset-demo', v_job.jobname = 'noshowly-reset-demo');
  PERFORM tests.expect('runs every night at 01:30 UTC', v_job.schedule = '30 1 * * *');
  PERFORM tests.expect('runs the reset', v_job.command = 'SELECT public.reset_demo_data()');
  EXECUTE v_job.command;
  PERFORM tests.expect('the job keeps the demo on basic',
    (SELECT plan = 'basic' FROM public.users WHERE id = tests.id('demo')));
END $$;

-- A job that already runs the reset (for example from the dashboard) is left alone.
TRUNCATE cron.job;
INSERT INTO cron.job (jobname, schedule, command) VALUES
  ('my-demo-reset', '0 3 * * *', 'select public.reset_demo_data();');
\ir ../../supabase/migrations/20260929130000_demo_reset.sql
DO $$
BEGIN
  PERFORM tests.expect_rows('existing job kept, none added', 1,
    $q$SELECT * FROM cron.job WHERE jobname = 'my-demo-reset' AND schedule = '0 3 * * *'$q$);
  PERFORM tests.expect_rows('only one job', 1, 'SELECT * FROM cron.job');
END $$;

-- Clean up.
DROP SCHEMA cron CASCADE;
