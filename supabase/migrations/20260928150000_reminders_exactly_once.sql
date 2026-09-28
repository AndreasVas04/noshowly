-- Migration: at most one 24-hour reminder per appointment.
--
-- APPLY ONLY AFTER the reminders release is live: the one in which the cron
-- sends the queued 'email' reminder instead of inserting a second row, and
-- manual test sends are stored as 'email_test'. With the code before that
-- release this index blocks reminders: /api/book/[slug]/appointments stores a
-- pending 'email' row that the cron never reads, so the cron's own row for the
-- same appointment would be rejected, and a test send would fail for any
-- appointment that already has a reminder.
--
-- Safe to run on the live project, and safe to run again. Everything runs in
-- one transaction.
--
-- What it changes:
--   1. Marks as 'skipped' the pending 'email' reminders that can never be
--      sent: rows without a token (written by an older public booking route
--      and never read), rows whose appointment already has a sent 'email'
--      reminder, and rows whose appointment is cancelled or has already
--      started.
--   2. A unique index so each appointment has at most one 'email' reminder
--      that is pending or sent. If duplicates remain, the index is skipped with
--      a notice that includes the query listing them; fix them and run the
--      file again. The SQL Editor does not show notices, so the last query
--      lists what each step did.

BEGIN;

SET LOCAL lock_timeout = '10s';

CREATE TEMP TABLE IF NOT EXISTS reminders_report (step text, result text, rows_to_fix text);
TRUNCATE pg_temp.reminders_report;

-- 1. Pending reminders that can never be sent.
DO $$
DECLARE
  v_no_token   bigint;
  v_superseded bigint;
  v_stale      bigint;
  v_result     text;
BEGIN
  UPDATE public.reminders
  SET status = 'skipped'
  WHERE type = 'email' AND status = 'pending' AND token IS NULL;
  GET DIAGNOSTICS v_no_token = ROW_COUNT;

  UPDATE public.reminders r
  SET status = 'skipped'
  WHERE r.type = 'email' AND r.status = 'pending'
    AND EXISTS (
      SELECT 1 FROM public.reminders s
      WHERE s.appointment_id = r.appointment_id
        AND s.type = 'email'
        AND s.status = 'sent'
    );
  GET DIAGNOSTICS v_superseded = ROW_COUNT;

  UPDATE public.reminders r
  SET status = 'skipped'
  FROM public.appointments a
  WHERE a.id = r.appointment_id
    AND r.type = 'email' AND r.status = 'pending'
    AND (a.status = 'cancelled' OR a.datetime <= now());
  GET DIAGNOSTICS v_stale = ROW_COUNT;

  v_result := format(
    'marked %s as skipped: %s without a token, %s whose appointment already had one sent, '
    '%s for a cancelled or past appointment',
    v_no_token + v_superseded + v_stale, v_no_token, v_superseded, v_stale);
  RAISE NOTICE 'Pending email reminders: %', v_result;
  INSERT INTO pg_temp.reminders_report VALUES ('Pending email reminders', v_result, NULL);
END $$;

-- 2. At most one pending or sent 'email' reminder per appointment.
DO $$
DECLARE
  v_find  text := $q$SELECT appointment_id, array_agg(id ORDER BY created_at) AS reminder_ids, array_agg(status ORDER BY created_at) AS statuses FROM public.reminders WHERE type = 'email' AND status IN ('pending', 'sent') GROUP BY appointment_id HAVING count(*) > 1$q$;
  v_count bigint;
  v_result text;
BEGIN
  IF to_regclass('public.reminders_one_email_per_appointment') IS NOT NULL THEN
    v_result := 'in place';
  ELSE
    EXECUTE format('SELECT count(*) FROM (%s) dupes', v_find) INTO v_count;
    IF v_count > 0 THEN
      v_result := format(
        'skipped: %s appointment(s) have more than one pending or sent email reminder. '
        'Set the extra rows to skipped', v_count);
    ELSE
      CREATE UNIQUE INDEX reminders_one_email_per_appointment
        ON public.reminders (appointment_id)
        WHERE type = 'email' AND status IN ('pending', 'sent');
      v_result := 'added';
    END IF;
  END IF;

  IF v_result LIKE 'skipped%' THEN
    RAISE NOTICE 'reminders_one_email_per_appointment: %. Rows to fix: %', v_result, v_find;
    INSERT INTO pg_temp.reminders_report
    VALUES ('reminders_one_email_per_appointment', v_result, v_find);
  ELSE
    RAISE NOTICE 'reminders_one_email_per_appointment: %', v_result;
    INSERT INTO pg_temp.reminders_report
    VALUES ('reminders_one_email_per_appointment', v_result, NULL);
  END IF;
EXCEPTION
  WHEN unique_violation THEN
    RAISE NOTICE 'reminders_one_email_per_appointment: skipped, duplicates. Rows to fix: %', v_find;
    INSERT INTO pg_temp.reminders_report
    VALUES ('reminders_one_email_per_appointment', 'skipped: duplicate reminders', v_find);
END $$;

COMMIT;

SELECT step, result, rows_to_fix FROM pg_temp.reminders_report;
