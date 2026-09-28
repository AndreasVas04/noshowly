-- reminders_one_email_per_appointment: at most one 24-hour ('email') reminder
-- per appointment that is pending or sent. Seed: appointment_a1 has a sent
-- one, appointment_b1 a pending one, appointment_a2 none.

BEGIN;

DO $$
DECLARE
  v_insert text := $s$INSERT INTO public.reminders (id, appointment_id, type, send_at, status, token)
                      VALUES (%L, %L, %L, now(), %L, %L)$s$;
BEGIN
  PERFORM tests.as_service_role();

  -- Already sent.
  PERFORM tests.expect_error('second reminder queued after one was sent', '23505', format(v_insert,
    tests.id('r1'), tests.id('appointment_a1'), 'email', 'pending', 'token-r1'));
  PERFORM tests.expect_error('second reminder sent', '23505', format(v_insert,
    tests.id('r2'), tests.id('appointment_a1'), 'email', 'sent', 'token-r2'));

  -- Failed, cancelled and skipped rows, test sends and booking confirmations
  -- do not count.
  PERFORM tests.expect_changed('failed attempt is kept', 1, format(v_insert,
    tests.id('r3'), tests.id('appointment_a1'), 'email', 'failed', 'token-r3'));
  PERFORM tests.expect_changed('cancelled reminder is kept', 1, format(v_insert,
    tests.id('r4'), tests.id('appointment_a1'), 'email', 'cancelled', NULL));
  PERFORM tests.expect_changed('skipped reminder is kept', 1, format(v_insert,
    tests.id('r5'), tests.id('appointment_a1'), 'email', 'skipped', NULL));
  PERFORM tests.expect_changed('test send', 1, format(v_insert,
    tests.id('r6'), tests.id('appointment_a1'), 'email_test', 'sent', 'token-r6'));
  PERFORM tests.expect_changed('another test send', 1, format(v_insert,
    tests.id('r7'), tests.id('appointment_a1'), 'email_test', 'sent', 'token-r7'));
  PERFORM tests.expect_changed('booking confirmation', 1, format(v_insert,
    tests.id('r8'), tests.id('appointment_a1'), 'email_confirmation', 'sent', NULL));

  -- Queued: a second one is rejected until the first one fails.
  PERFORM tests.expect_error('second reminder queued', '23505', format(v_insert,
    tests.id('r9'), tests.id('appointment_b1'), 'email', 'pending', 'token-r9'));
  PERFORM tests.expect_changed('queued reminder sent', 1, format(
    $s$UPDATE public.reminders SET status = 'sent', sent_at = now() WHERE id = %L$s$,
    tests.id('reminder_b1')));
  PERFORM tests.expect_error('reminder queued after it was sent', '23505', format(v_insert,
    tests.id('r10'), tests.id('appointment_b1'), 'email', 'pending', 'token-r10'));

  PERFORM tests.expect_changed('first reminder for appointment A2', 1, format(v_insert,
    tests.id('r11'), tests.id('appointment_a2'), 'email', 'pending', 'token-r11'));
  PERFORM tests.expect_changed('delivery failed', 1, format(
    $s$UPDATE public.reminders SET status = 'failed' WHERE id = %L$s$, tests.id('r11')));
  PERFORM tests.expect_changed('retry after a failure', 1, format(v_insert,
    tests.id('r12'), tests.id('appointment_a2'), 'email', 'pending', 'token-r12'));

  -- The cron dedup query and the confirm route still find rows by token.
  PERFORM tests.expect_rows('token lookup', 1, $q$SELECT id FROM public.reminders WHERE token = 'token-a1'$q$);
  PERFORM tests.expect_error('tokens stay unique', '23505', format(v_insert,
    tests.id('r13'), tests.id('appointment_a2'), 'email_test', 'sent', 'token-a1'));
END $$;

ROLLBACK;
