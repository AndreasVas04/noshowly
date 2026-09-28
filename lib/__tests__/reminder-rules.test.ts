/**
 * lib/__tests__/reminder-rules.test.ts
 *
 * Unit tests for the appointment email rules in lib/reminders/rules.ts: when
 * the 24-hour reminder is due (window, catch-up after missed runs, claims,
 * the rule for bookings made less than a day ahead), the claim race
 * tie-break, the per-email appointment checks and the sending limits.
 */

import { describe, expect, it } from 'vitest';
import {
  HOURLY_REMINDER_RATE_LIMIT,
  MAX_EMAILS_PER_RECIPIENT_PER_DAY,
  MAX_TEST_EMAILS_PER_DAY,
} from '@/lib/plans';
import {
  CONFIRMATION_QUIET_PERIOD_MS,
  HOUR_MS,
  MAX_FAILED_REMINDER_ATTEMPTS,
  RETRY_WINDOW_MS,
  STALE_CLAIM_AFTER_MS,
  checkAppointmentForEmail,
  checkReminderRetries,
  classifyReminderClaims,
  decideReminderDue,
  evaluateSendLimits,
  isRetiredOnChange,
  needsConfirmationLinks,
  reminderWindow,
  selectDueReminders,
  wonClaimRace,
  type ReminderRecord,
} from '@/lib/reminders/rules';
import { resolveLinkState } from '@/lib/confirm-page';

const MINUTE_MS = 60_000;
const NOW = new Date('2026-10-05T12:00:00Z');

/** ISO timestamp `ms` after NOW (negative for before). */
function at(ms: number, from: Date = NOW): string {
  return new Date(from.getTime() + ms).toISOString();
}

/** A scheduled appointment starting `hours` after NOW. */
function appointment(id: string, hours: number, status = 'scheduled') {
  return { id, datetime: at(hours * HOUR_MS), status };
}

let rowId = 0;
/** A reminders row for appointment 'a1' with overrides. */
function row(overrides: Partial<ReminderRecord>): ReminderRecord {
  rowId++;
  return {
    id:             `r${rowId}`,
    appointment_id: 'a1',
    type:           'email',
    status:         'sent',
    token:          `token-${rowId}`,
    created_at:     at(-HOUR_MS),
    sent_at:        at(-HOUR_MS),
    ...overrides,
  };
}

/**
 * Runs the due rule every 15 minutes from `bookedAt` until the appointment
 * starts, with a booking confirmation sent at `bookedAt`, and returns how many
 * hours before the appointment the reminder first becomes due (null: never).
 */
function firstDueHoursBefore(hoursAhead: number): number | null {
  const bookedAt = NOW;
  const start = new Date(bookedAt.getTime() + hoursAhead * HOUR_MS);
  const appt = { datetime: start.toISOString(), status: 'scheduled' };
  const confirmation = row({ type: 'email_confirmation', created_at: bookedAt.toISOString(), sent_at: bookedAt.toISOString() });

  for (let t = bookedAt.getTime(); t < start.getTime(); t += 15 * MINUTE_MS) {
    if (decideReminderDue(appt, [confirmation], new Date(t)).due) {
      return (start.getTime() - t) / HOUR_MS;
    }
  }
  return null;
}

describe('reminderWindow', () => {
  it('covers (now, now + 24 h]', () => {
    expect(reminderWindow(NOW)).toEqual({
      after: '2026-10-05T12:00:00.000Z',
      until: '2026-10-06T12:00:00.000Z',
    });
  });
});

describe('decideReminderDue — window', () => {
  it('is due for a scheduled appointment within 24 hours with no reminder yet', () => {
    expect(decideReminderDue(appointment('a1', 23.5), [], NOW)).toEqual({ due: true, staleClaimIds: [] });
  });

  it('includes exactly 24 hours ahead and excludes anything later', () => {
    expect(decideReminderDue(appointment('a1', 24), [], NOW).due).toBe(true);
    expect(decideReminderDue({ datetime: at(24 * HOUR_MS + MINUTE_MS), status: 'scheduled' }, [], NOW))
      .toEqual({ due: false, reason: 'outside_window' });
  });

  it('never reminds about an appointment that has started or passed', () => {
    expect(decideReminderDue({ datetime: NOW.toISOString(), status: 'scheduled' }, [], NOW))
      .toEqual({ due: false, reason: 'outside_window' });
    expect(decideReminderDue(appointment('a1', -1), [], NOW)).toEqual({ due: false, reason: 'outside_window' });
  });

  it('catches up after missed runs: 3 hours ahead with no reminder is still due', () => {
    expect(decideReminderDue(appointment('a1', 3), [], NOW).due).toBe(true);
    expect(decideReminderDue({ datetime: at(5 * MINUTE_MS), status: 'scheduled' }, [], NOW).due).toBe(true);
  });

  it('only reminds scheduled appointments', () => {
    expect(decideReminderDue(appointment('a1', 10, 'confirmed'), [], NOW)).toEqual({ due: false, reason: 'not_scheduled' });
    expect(decideReminderDue(appointment('a1', 10, 'cancelled'), [], NOW)).toEqual({ due: false, reason: 'not_scheduled' });
  });
});

describe('decideReminderDue — claims', () => {
  it('is not due once a reminder was sent (or confirmed through its link)', () => {
    expect(decideReminderDue(appointment('a1', 10), [row({ status: 'sent' })], NOW))
      .toEqual({ due: false, reason: 'already_sent' });
    expect(decideReminderDue(appointment('a1', 10), [row({ status: 'confirmed' })], NOW))
      .toEqual({ due: false, reason: 'already_sent' });
  });

  it('is not due while a fresh claim is being sent', () => {
    const claim = row({ status: 'pending', sent_at: null, created_at: at(-5 * MINUTE_MS) });
    expect(decideReminderDue(appointment('a1', 10), [claim], NOW)).toEqual({ due: false, reason: 'in_progress' });
  });

  it('retries a claim left pending for 30 minutes or more', () => {
    const stale = row({ status: 'pending', sent_at: null, created_at: at(-STALE_CLAIM_AFTER_MS) });
    expect(decideReminderDue(appointment('a1', 10), [stale], NOW)).toEqual({ due: true, staleClaimIds: [stale.id] });
  });

  it('ignores pending rows without a token (written by the old booking route)', () => {
    const orphan = row({ status: 'pending', token: null, sent_at: null, created_at: at(-2 * HOUR_MS) });
    expect(decideReminderDue(appointment('a1', 10), [orphan], NOW)).toEqual({ due: true, staleClaimIds: [] });
  });

  it('ignores failed, retired (cancelled) and skipped reminders', () => {
    const rows = [
      row({ status: 'failed', sent_at: null }),
      row({ status: 'cancelled' }),
      row({ status: 'skipped', sent_at: null }),
    ];
    expect(decideReminderDue(appointment('a1', 10), rows, NOW)).toEqual({ due: true, staleClaimIds: [] });
  });

  it('a sent reminder wins over stale and in-progress claims, in any order', () => {
    const stale = row({ status: 'pending', sent_at: null, created_at: at(-2 * HOUR_MS) });
    const sent = row({ status: 'sent' });
    expect(classifyReminderClaims([stale, sent], NOW)).toEqual({ kind: 'sent' });
    expect(classifyReminderClaims([sent, stale], NOW)).toEqual({ kind: 'sent' });
  });

  it('ignores rows of other types when classifying claims', () => {
    const test = row({ type: 'email_test', status: 'pending', created_at: at(-MINUTE_MS) });
    expect(classifyReminderClaims([test], NOW)).toEqual({ kind: 'none', staleClaimIds: [] });
  });
});

describe('decideReminderDue — booking confirmations', () => {
  it('holds the reminder back for 12 hours after a booking confirmation', () => {
    const recent = row({ type: 'email_confirmation', sent_at: at(-3 * HOUR_MS) });
    expect(decideReminderDue(appointment('a1', 20), [recent], NOW))
      .toEqual({ due: false, reason: 'recent_confirmation' });

    const older = row({ type: 'email_confirmation', sent_at: at(-CONFIRMATION_QUIET_PERIOD_MS - MINUTE_MS) });
    expect(decideReminderDue(appointment('a1', 20), [older], NOW).due).toBe(true);
  });

  it('also holds it back while a confirmation is being sent', () => {
    const sending = row({ type: 'email_confirmation', status: 'pending', sent_at: null, created_at: at(-MINUTE_MS) });
    expect(decideReminderDue(appointment('a1', 20), [sending], NOW))
      .toEqual({ due: false, reason: 'recent_confirmation' });
  });

  it('counts a confirmation the client already answered', () => {
    const answered = row({ type: 'email_confirmation', status: 'confirmed', sent_at: at(-HOUR_MS) });
    expect(decideReminderDue(appointment('a1', 20), [answered], NOW).due).toBe(false);
  });

  it('ignores confirmations retired by a reschedule, and failed ones', () => {
    const retired = row({ type: 'email_confirmation', status: 'cancelled', sent_at: at(-HOUR_MS) });
    const failed = row({ type: 'email_confirmation', status: 'failed', sent_at: null, created_at: at(-MINUTE_MS) });
    expect(decideReminderDue(appointment('a1', 20), [retired, failed], NOW).due).toBe(true);
  });

  it('booked 3 hours ahead: the confirmation only, no reminder minutes later', () => {
    expect(firstDueHoursBefore(3)).toBeNull();
  });

  it('booked 20 hours ahead: the reminder follows 12 hours after the confirmation', () => {
    expect(firstDueHoursBefore(20)).toBe(8);
  });

  it('booked 30 hours ahead: the reminder 18 hours before', () => {
    expect(firstDueHoursBefore(30)).toBe(18);
  });

  it('booked days ahead: the reminder as soon as the 24-hour window opens', () => {
    expect(firstDueHoursBefore(72)).toBe(24);
  });
});

describe('moving or cancelling an appointment', () => {
  /** Applies cancelReminderLinks() to in-memory rows. */
  const retire = (rows: ReminderRecord[]) =>
    rows.map((r) => (isRetiredOnChange(r) ? { ...r, status: 'cancelled' } : r));

  it('retires pending, sent, answered and failed rows of reminders and confirmations only', () => {
    for (const type of ['email', 'email_confirmation']) {
      for (const status of ['pending', 'sent', 'confirmed', 'failed']) {
        expect(isRetiredOnChange({ type, status })).toBe(true);
      }
      for (const status of ['cancelled', 'skipped']) {
        expect(isRetiredOnChange({ type, status })).toBe(false);
      }
    }
    expect(isRetiredOnChange({ type: 'email_test', status: 'sent' })).toBe(false);
    expect(isRetiredOnChange({ type: 'sms', status: 'sent' })).toBe(false);
  });

  it('after the client answered YES and the appointment moved, the old link dies and a new reminder is due', () => {
    // The client confirmed through the 24-hour reminder; the owner then moved
    // the appointment to tomorrow and set it back to 'scheduled'.
    const answered = row({ type: 'email', status: 'confirmed', sent_at: at(-20 * HOUR_MS), created_at: at(-20 * HOUR_MS) });
    const confirmation = row({ type: 'email_confirmation', status: 'confirmed', sent_at: at(-30 * HOUR_MS), created_at: at(-30 * HOUR_MS) });
    const test = row({ type: 'email_test', status: 'sent' });
    const moved = { datetime: at(20 * HOUR_MS), status: 'scheduled' };

    // Without retiring the answered row, the old reminder counts as sent.
    expect(decideReminderDue(moved, [answered, confirmation, test], NOW)).toEqual({ due: false, reason: 'already_sent' });

    const rows = retire([answered, confirmation, test]);
    expect(rows.map((r) => r.status)).toEqual(['cancelled', 'cancelled', 'sent']);
    expect(decideReminderDue(moved, rows, NOW)).toEqual({ due: true, staleClaimIds: [] });
    expect(resolveLinkState(rows[0], moved, NOW)).toBe('superseded');
    expect(resolveLinkState(rows[1], moved, NOW)).toBe('superseded');
    expect(resolveLinkState(rows[2], moved, NOW)).toBe('test');
  });

  it('gives the new time its own attempts after failures for the old one', () => {
    const failures = [1, 2, 3].map((n) =>
      row({ status: 'failed', sent_at: null, created_at: at(-n * HOUR_MS) }));
    const moved = { datetime: at(10 * HOUR_MS), status: 'scheduled' };
    expect(decideReminderDue(moved, failures, NOW)).toEqual({ due: false, reason: 'retry_limit' });
    expect(decideReminderDue(moved, retire(failures), NOW)).toEqual({ due: true, staleClaimIds: [] });
  });

  it('does not show a moved appointment that stayed confirmed as confirmed through an old link', () => {
    const answered = row({ type: 'email', status: 'confirmed' });
    const moved = { datetime: at(30 * HOUR_MS), status: 'confirmed' };
    expect(resolveLinkState(answered, moved, NOW)).toBe('confirmed');
    expect(resolveLinkState(retire([answered])[0], moved, NOW)).toBe('superseded');
  });
});

describe('decideReminderDue — failed attempts', () => {
  const failed = (hoursAgo: number, token: string | null = 'kept') =>
    row({ status: 'failed', sent_at: null, token, created_at: at(-hoursAgo * HOUR_MS) });

  it(`retries a failed reminder until ${MAX_FAILED_REMINDER_ATTEMPTS} attempts failed within 24 hours`, () => {
    expect(decideReminderDue(appointment('a1', 10), [failed(1), failed(2)], NOW).due).toBe(true);
    expect(decideReminderDue(appointment('a1', 10), [failed(1), failed(2), failed(3)], NOW))
      .toEqual({ due: false, reason: 'retry_limit' });
  });

  it('only counts attempts within the retry window', () => {
    const old = row({ status: 'failed', sent_at: null, created_at: at(-RETRY_WINDOW_MS - HOUR_MS) });
    expect(decideReminderDue(appointment('a1', 10), [failed(1), failed(2), old], NOW).due).toBe(true);
  });

  it('never retries an email the provider rejected', () => {
    expect(decideReminderDue(appointment('a1', 10), [failed(1, null)], NOW))
      .toEqual({ due: false, reason: 'rejected' });
  });

  it('counts claims left by crashed runs as attempts', () => {
    const crashed = row({ status: 'pending', sent_at: null, created_at: at(-STALE_CLAIM_AFTER_MS) });
    expect(checkReminderRetries([failed(2), crashed], NOW)).toBe('ok');
    expect(checkReminderRetries([failed(2), failed(3), crashed], NOW)).toBe('retry_limit');
    // A fresh claim is not an attempt yet.
    const fresh = row({ status: 'pending', sent_at: null, created_at: at(-MINUTE_MS) });
    expect(checkReminderRetries([failed(2), failed(3), fresh], NOW)).toBe('ok');
  });

  it('ignores failed emails of other types', () => {
    const others = [
      row({ type: 'email_confirmation', status: 'failed', sent_at: null, token: null }),
      row({ type: 'email_test', status: 'failed', sent_at: null }),
      row({ type: 'email_test', status: 'failed', sent_at: null }),
      row({ type: 'email_test', status: 'failed', sent_at: null }),
    ];
    expect(checkReminderRetries(others, NOW)).toBe('ok');
  });

  /**
   * Runs the reminder job every 15 minutes for the 24 hours before an
   * appointment; every send fails the given way. Returns the number of sends.
   */
  function attemptsWhenEverySendFails(rejected: boolean): number {
    const start = NOW.getTime() + 24 * HOUR_MS;
    const appt = { datetime: new Date(start).toISOString(), status: 'scheduled' };
    const rows: ReminderRecord[] = [];
    for (let t = NOW.getTime(); t < start; t += 15 * MINUTE_MS) {
      if (decideReminderDue(appt, rows, new Date(t)).due) {
        rows.push(row({ status: 'failed', sent_at: null, token: rejected ? null : 'kept', created_at: new Date(t).toISOString() }));
      }
    }
    return rows.length;
  }

  it('stops after 3 attempts instead of trying every run', () => {
    expect(attemptsWhenEverySendFails(false)).toBe(MAX_FAILED_REMINDER_ATTEMPTS);
    expect(attemptsWhenEverySendFails(true)).toBe(1);
  });
});

describe('selectDueReminders', () => {
  it('groups rows by appointment, keeps order and counts what is not due', () => {
    const appts = [
      appointment('a1', 2),
      appointment('a2', 5),
      appointment('a3', 8),
      appointment('a4', 30),
      appointment('a5', 9, 'confirmed'),
    ];
    const rows = [
      row({ appointment_id: 'a2', status: 'sent' }),
      row({ appointment_id: 'a3', status: 'pending', sent_at: null, created_at: at(-HOUR_MS) }),
    ];
    const result = selectDueReminders(appts, rows, NOW);
    expect(result.due.map((d) => d.appointment.id)).toEqual(['a1', 'a3']);
    expect(result.due[1].staleClaimIds).toEqual([rows[1].id]);
    expect(result.notDue).toEqual({
      not_scheduled: 1,
      outside_window: 1,
      already_sent: 1,
      in_progress: 0,
      rejected: 0,
      retry_limit: 0,
      recent_confirmation: 0,
    });
  });
});

describe('wonClaimRace', () => {
  const claim = (id: string, createdMs: number, status = 'pending') => ({ id, status, created_at: at(createdMs) });

  it('wins when its claim is the only one or the oldest', () => {
    expect(wonClaimRace('x', [claim('x', 0)])).toBe(true);
    expect(wonClaimRace('x', [claim('x', 0), claim('y', 5)])).toBe(true);
  });

  it('loses to an older claim or to a sent reminder', () => {
    expect(wonClaimRace('x', [claim('y', -5), claim('x', 0)])).toBe(false);
    expect(wonClaimRace('x', [claim('x', 0), claim('y', 5, 'sent')])).toBe(false);
  });

  it('breaks ties on created_at by id, so both runs agree', () => {
    const rows = [claim('a', 0), claim('b', 0)];
    expect(wonClaimRace('a', rows)).toBe(true);
    expect(wonClaimRace('b', rows)).toBe(false);
  });

  it('loses when its own claim is missing or no longer pending', () => {
    expect(wonClaimRace('x', [claim('y', 0)])).toBe(false);
    expect(wonClaimRace('x', [claim('x', 0, 'sent')])).toBe(false);
  });
});

describe('checkAppointmentForEmail', () => {
  it('never emails about past or cancelled appointments', () => {
    for (const kind of ['email', 'email_confirmation', 'email_test'] as const) {
      expect(checkAppointmentForEmail(kind, appointment('a1', -0.1), NOW)).toBe('appointment_past');
      expect(checkAppointmentForEmail(kind, { datetime: NOW.toISOString(), status: 'scheduled' }, NOW)).toBe('appointment_past');
      expect(checkAppointmentForEmail(kind, appointment('a1', 5, 'cancelled'), NOW)).toBe('appointment_cancelled');
    }
  });

  it('sends 24-hour reminders only for scheduled appointments within 24 hours', () => {
    expect(checkAppointmentForEmail('email', appointment('a1', 5), NOW)).toBeNull();
    expect(checkAppointmentForEmail('email', appointment('a1', 5, 'confirmed'), NOW)).toBe('not_scheduled');
    expect(checkAppointmentForEmail('email', appointment('a1', 30), NOW)).toBe('not_due');
  });

  it('allows confirmations and test sends for confirmed appointments, any time ahead', () => {
    expect(checkAppointmentForEmail('email_confirmation', appointment('a1', 2, 'confirmed'), NOW)).toBeNull();
    expect(checkAppointmentForEmail('email_test', appointment('a1', 200, 'confirmed'), NOW)).toBeNull();
  });
});

describe('needsConfirmationLinks', () => {
  it('follows the salon setting and the caller\'s choice for confirmations', () => {
    expect(needsConfirmationLinks('email', true, false)).toBe(true);
    expect(needsConfirmationLinks('email', null, false)).toBe(true);
    expect(needsConfirmationLinks('email', false, true)).toBe(false);
    expect(needsConfirmationLinks('email_test', undefined, false)).toBe(true);
    expect(needsConfirmationLinks('email_confirmation', true, true)).toBe(true);
    expect(needsConfirmationLinks('email_confirmation', true, false)).toBe(false);
    expect(needsConfirmationLinks('email_confirmation', false, true)).toBe(false);
  });
});

describe('evaluateSendLimits', () => {
  const quiet = { salonLastHour: 0, recipientLastDay: 0, testsLastDay: 0 };

  it('allows sends under every limit', () => {
    expect(evaluateSendLimits('email', quiet)).toBeNull();
    expect(evaluateSendLimits('email', {
      salonLastHour: HOURLY_REMINDER_RATE_LIMIT - 1,
      recipientLastDay: MAX_EMAILS_PER_RECIPIENT_PER_DAY - 1,
      testsLastDay: MAX_TEST_EMAILS_PER_DAY,
    })).toBeNull();
  });

  it('stops a salon at the hourly burst guard', () => {
    expect(evaluateSendLimits('email_confirmation', { ...quiet, salonLastHour: HOURLY_REMINDER_RATE_LIMIT }))
      .toBe('salon_hourly_limit');
  });

  it('limits emails per recipient address', () => {
    expect(evaluateSendLimits('email', { ...quiet, recipientLastDay: MAX_EMAILS_PER_RECIPIENT_PER_DAY }))
      .toBe('recipient_limit');
  });

  it('limits test sends per day, reported before the recipient limit', () => {
    expect(evaluateSendLimits('email_test', { ...quiet, testsLastDay: MAX_TEST_EMAILS_PER_DAY }))
      .toBe('test_daily_limit');
    expect(evaluateSendLimits('email_test', {
      ...quiet,
      testsLastDay: MAX_TEST_EMAILS_PER_DAY,
      recipientLastDay: MAX_EMAILS_PER_RECIPIENT_PER_DAY,
    })).toBe('test_daily_limit');
  });
});
