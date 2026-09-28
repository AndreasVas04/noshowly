-- appointments_no_double_booking: a barber cannot have two overlapping
-- appointments unless one is cancelled. Seed: appointment_a1 is barber A1,
-- 7 January 2030, 10:00-11:00 UTC, scheduled.

BEGIN;

DO $$
DECLARE
  v_insert text := $s$INSERT INTO public.appointments (salon_id, barber_id, datetime, duration_minutes, status)
                      VALUES (%L, %L, %L, %s, %L)$s$;
BEGIN
  PERFORM tests.as_service_role();

  PERFORM tests.expect_error('overlap: starts during another appointment', '23P01', format(v_insert,
    tests.id('salon_a'), tests.id('barber_a1'), '2030-01-07 10:30+00', 30, 'scheduled'));
  PERFORM tests.expect_error('overlap: runs into another appointment', '23P01', format(v_insert,
    tests.id('salon_a'), tests.id('barber_a1'), '2030-01-07 09:30+00', 60, 'scheduled'));
  PERFORM tests.expect_error('overlap: same slot', '23P01', format(v_insert,
    tests.id('salon_a'), tests.id('barber_a1'), '2030-01-07 10:00+00', 60, 'confirmed'));
  PERFORM tests.expect_error('overlap: inside another appointment', '23P01', format(v_insert,
    tests.id('salon_a'), tests.id('barber_a1'), '2030-01-07 10:15+00', 15, 'scheduled'));
  PERFORM tests.expect_error('overlap: covers another appointment', '23P01', format(v_insert,
    tests.id('salon_a'), tests.id('barber_a1'), '2030-01-07 09:00+00', 180, 'scheduled'));

  -- Touching slots are fine: ranges are [start, end).
  PERFORM tests.expect_changed('touching: right after', 1, format(v_insert,
    tests.id('salon_a'), tests.id('barber_a1'), '2030-01-07 11:00+00', 30, 'scheduled'));
  PERFORM tests.expect_changed('touching: right before', 1, format(v_insert,
    tests.id('salon_a'), tests.id('barber_a1'), '2030-01-07 09:30+00', 30, 'confirmed'));

  -- Another barber, or no barber, is not a conflict.
  PERFORM tests.expect_changed('other barber at the same time', 1, format(v_insert,
    tests.id('salon_a'), tests.id('barber_a2'), '2030-01-07 10:30+00', 60, 'scheduled'));
  PERFORM tests.expect_changed('no barber: first', 1, format(
    $s$INSERT INTO public.appointments (salon_id, datetime, duration_minutes) VALUES (%L, '2030-01-07 10:00+00', 60)$s$,
    tests.id('salon_a')));
  PERFORM tests.expect_changed('no barber: second at the same time', 1, format(
    $s$INSERT INTO public.appointments (salon_id, datetime, duration_minutes) VALUES (%L, '2030-01-07 10:00+00', 60)$s$,
    tests.id('salon_a')));

  -- Cancelled appointments never block.
  PERFORM tests.expect_changed('cancelled appointment in a taken slot', 1, format(v_insert,
    tests.id('salon_a'), tests.id('barber_a1'), '2030-01-07 10:00+00', 60, 'cancelled'));
  PERFORM tests.expect_changed('cancel appointment A1', 1, format(
    $s$UPDATE public.appointments SET status = 'cancelled' WHERE id = %L$s$, tests.id('appointment_a1')));
  PERFORM tests.expect_changed('rebook the freed slot', 1, format(
    $s$INSERT INTO public.appointments (id, salon_id, barber_id, datetime, duration_minutes)
       VALUES (%L, %L, %L, '2030-01-07 10:15+00', 30)$s$,
    tests.id('appointment_rebooked'), tests.id('salon_a'), tests.id('barber_a1')));
  PERFORM tests.expect_error('reinstate appointment A1 over the new booking', '23P01', format(
    $s$UPDATE public.appointments SET status = 'scheduled' WHERE id = %L$s$, tests.id('appointment_a1')));

  -- Updates are checked too.
  PERFORM tests.expect_error('move an appointment onto another', '23P01', format(
    $s$UPDATE public.appointments SET datetime = '2030-01-07 11:15+00' WHERE id = %L$s$,
    tests.id('appointment_rebooked')));
  PERFORM tests.expect_error('lengthen an appointment into the next one', '23P01', format(
    $s$UPDATE public.appointments SET duration_minutes = 60 WHERE id = %L$s$,
    tests.id('appointment_rebooked')));
  PERFORM tests.expect_error('give an appointment to a busy barber', '23P01', format(
    $s$UPDATE public.appointments SET barber_id = %L WHERE id = %L$s$,
    tests.id('barber_a2'), tests.id('appointment_rebooked')));

  -- The same rule applies to a signed-in owner.
  PERFORM tests.sign_in('owner_a');
  PERFORM tests.expect_error('owner A: double-book barber A2', '23P01', format(v_insert,
    tests.id('salon_a'), tests.id('barber_a2'), '2030-01-07 10:00+00', 30, 'scheduled'));
END $$;

ROLLBACK;
