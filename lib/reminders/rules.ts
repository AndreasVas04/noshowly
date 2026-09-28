/**
 * lib/reminders/rules.ts
 *
 * Pure rules for appointment emails: who gets which email when, how the
 * 24-hour reminder is claimed exactly once, and the sending limits. Used by
 * the send gateway (lib/reminders/gateway.ts) and the reminder cron job
 * (app/api/cron/send-reminders).
 *
 * Emails (reminders.type):
 *  - 'email_confirmation' — sent right after a booking: dashboard bookings
 *    made as 'scheduled' get YES/NO buttons, public bookings get a
 *    "you're booked" notice.
 *  - 'email' — the 24-hour reminder with YES/NO buttons. Due while the
 *    appointment is 'scheduled' and starts within the next REMINDER_LEAD_MS
 *    (24 h). There is no lower bound, so runs missed while the job was down
 *    catch up automatically, as long as the appointment has not started.
 *  - 'email_test' — the reminder sent manually from the dashboard as a test.
 *
 * Booked less than a day ahead: the reminder is held back while a booking
 * confirmation was sent (or is being sent) in the last
 * CONFIRMATION_QUIET_PERIOD_MS (12 h). It goes out once 12 h have passed if
 * the appointment is still ahead and still 'scheduled' (not confirmed), so a
 * client never gets the confirmation and the reminder minutes apart:
 *  - booked 3 days ahead: confirmation now, reminder 24 h before;
 *  - booked 30 h ahead:   confirmation now, reminder 18 h before;
 *  - booked 20 h ahead:   confirmation now, reminder 8 h before;
 *  - booked 3 h ahead:    confirmation only.
 * (Bookings made less than 23 h ahead without an explicit status are created
 * 'confirmed' by the booking routes and get no reminder at all.)
 *
 * Claiming the 24-hour reminder: a 'pending' 'email' row with a token is
 * inserted before sending. It blocks other runs until it becomes 'sent' or
 * 'failed'. A 'pending' claim older than STALE_CLAIM_AFTER_MS (30 min) belongs
 * to a run that crashed between claiming and sending: it is marked 'failed'
 * and the reminder is claimed again. 'pending' rows without a token were
 * written by an older booking route and are ignored.
 *
 * Moved or cancelled appointments: when an appointment moves to another time
 * or client, or is cancelled, its 24-hour reminder and booking confirmation
 * rows in RETIRED_ON_CHANGE_STATUSES become 'cancelled' (cancelReminderLinks()
 * in lib/reminders/store.ts). Their links stop working — including a link the
 * client already answered, which confirmed the old time, not the new one —
 * and 'cancelled' rows never count as a sent reminder, so the reminder for
 * the new time can be claimed.
 *
 * Failed sends: a 24-hour reminder whose send failed is tried again by later
 * runs, at most MAX_FAILED_REMINDER_ATTEMPTS (3) times within
 * RETRY_WINDOW_MS (24 h), counting claims left behind by crashed runs. An
 * attempt the email provider rejected as invalid (a 'failed' row whose token
 * was cleared) is final. Failed attempts are retired with the other rows when
 * the appointment moves, so a new time or client gets its own attempts.
 * Account problems (API key, sender domain, quota) do not count as attempts:
 * those rows are 'skipped' and the reminder stays due (see
 * lib/reminders/gateway.ts).
 *
 * No imports from Next.js or Supabase, so this is safe to use anywhere.
 */

import {
  HOURLY_REMINDER_RATE_LIMIT,
  MAX_EMAILS_PER_RECIPIENT_PER_DAY,
  MAX_TEST_EMAILS_PER_DAY,
} from '@/lib/plans';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** One hour in milliseconds. */
export const HOUR_MS = 60 * 60 * 1000;

/** One day in milliseconds. */
export const DAY_MS = 24 * HOUR_MS;

/** The 24-hour reminder is due once the appointment starts within this time. */
export const REMINDER_LEAD_MS = 24 * HOUR_MS;

/** No 24-hour reminder within this time of a booking confirmation. */
export const CONFIRMATION_QUIET_PERIOD_MS = 12 * HOUR_MS;

/** A 'pending' claim older than this belongs to a run that crashed; it may be retried. */
export const STALE_CLAIM_AFTER_MS = 30 * 60 * 1000;

/** Most failed attempts at an appointment's 24-hour reminder within RETRY_WINDOW_MS. */
export const MAX_FAILED_REMINDER_ATTEMPTS = 3;

/** Window in which failed 24-hour reminder attempts are counted. */
export const RETRY_WINDOW_MS = DAY_MS;

/** Email types whose YES/NO links act on the appointment. */
export const LINK_EMAIL_TYPES = ['email', 'email_confirmation'] as const;

/**
 * Statuses of LINK_EMAIL_TYPES rows that are retired (set to 'cancelled') when
 * an appointment moves to another time or client, or is cancelled:
 *  - 'pending' and 'sent' — their links would act on the changed appointment;
 *  - 'confirmed'          — the client confirmed the old time, not the new one.
 *                           A confirmed 24-hour reminder also counts as sent,
 *                           so it would block the reminder for the new time;
 *  - 'failed'             — attempts for the old time or client must not use up
 *                           the retries of the new one.
 */
export const RETIRED_ON_CHANGE_STATUSES = ['pending', 'sent', 'confirmed', 'failed'] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Kinds of email the gateway sends (reminders.type). */
export type EmailKind = 'email' | 'email_confirmation' | 'email_test';

/** Why an email was not sent. None of these is an error. */
export type SkipReason =
  /** The appointment has started or is in the past. */
  | 'appointment_past'
  | 'appointment_cancelled'
  /** 24-hour reminders are only for appointments still awaiting confirmation. */
  | 'not_scheduled'
  /** 24-hour reminders are only sent within 24 h of the appointment. */
  | 'not_due'
  | 'no_email'
  /** The owner's plan does not include email. */
  | 'plan'
  /** The owner's monthly fair-use cap is reached (never shown publicly). */
  | 'monthly_cap'
  | 'recipient_limit'
  | 'salon_hourly_limit'
  | 'test_daily_limit'
  /** Another run already sent, or is sending, this 24-hour reminder. */
  | 'already_claimed';

/**
 * Why an email could not be sent:
 *  - 'config'     — configuration, including the email provider refusing the
 *                   account (API key, sender domain, quota);
 *  - 'rejected'   — the email provider rejected this email as invalid; sending
 *                   it again fails again;
 *  - 'provider'   — a temporary provider or network error;
 *  - 'database' and 'unexpected' — errors on our side.
 */
export type FailReason = 'config' | 'database' | 'provider' | 'rejected' | 'unexpected';

/** Reminder row fields the rules read. */
export type ReminderRecord = {
  id: string;
  appointment_id: string;
  type: string;
  status: string;
  token: string | null;
  created_at: string;
  sent_at: string | null;
};

/** State of an appointment's 24-hour reminder claims. */
export type ClaimState =
  /** A 24-hour reminder was already sent. */
  | { kind: 'sent' }
  /** Another run is sending it right now. */
  | { kind: 'in_progress' }
  /** Nothing blocks a new claim; stale claims must be retired first. */
  | { kind: 'none'; staleClaimIds: string[] };

/** Why an appointment's 24-hour reminder is not due right now. */
export type NotDueReason =
  | 'not_scheduled'
  | 'outside_window'
  | 'already_sent'
  | 'in_progress'
  | 'rejected'
  | 'retry_limit'
  | 'recent_confirmation';

/** Result of checkReminderRetries(). */
export type RetryCheck = 'ok' | 'rejected' | 'retry_limit';

/** Result of decideReminderDue(). */
export type DueDecision =
  | { due: true; staleClaimIds: string[] }
  | { due: false; reason: NotDueReason };

/** Appointment fields the rules read. */
export type AppointmentTiming = { datetime: string; status: string };

// ---------------------------------------------------------------------------
// The 24-hour reminder
// ---------------------------------------------------------------------------

/**
 * Returns the time range the reminder job scans: appointments starting after
 * `now` and at most REMINDER_LEAD_MS later, i.e. (now, now + 24 h].
 *
 * @param now - Current instant.
 */
export function reminderWindow(now: Date): { after: string; until: string } {
  return {
    after: now.toISOString(),
    until: new Date(now.getTime() + REMINDER_LEAD_MS).toISOString(),
  };
}

/** Returns true when a 'pending' claim is old enough to be retried. */
export function isStaleClaim(row: Pick<ReminderRecord, 'created_at'>, now: Date): boolean {
  const created = Date.parse(row.created_at);
  return !Number.isFinite(created) || now.getTime() - created >= STALE_CLAIM_AFTER_MS;
}

/**
 * Returns true for a row that is retired when its appointment moves to another
 * time or client, or is cancelled (see RETIRED_ON_CHANGE_STATUSES).
 *
 * @param row - Reminder row (type and status).
 */
export function isRetiredOnChange(row: Pick<ReminderRecord, 'type' | 'status'>): boolean {
  return (LINK_EMAIL_TYPES as readonly string[]).includes(row.type)
    && (RETIRED_ON_CHANGE_STATUSES as readonly string[]).includes(row.status);
}

/**
 * Classifies an appointment's existing 24-hour reminder ('email') rows.
 *
 *  - 'sent' or 'confirmed' → already sent.
 *  - 'pending' with a token → in progress, or stale after STALE_CLAIM_AFTER_MS.
 *  - 'pending' without a token → ignored (never read, written by an older
 *    booking route).
 *  - 'failed', 'cancelled' (retired when the appointment moved or was
 *    cancelled) and 'skipped' → ignored.
 *
 * @param rows - Reminder rows of one appointment (other types are ignored).
 * @param now  - Current instant.
 */
export function classifyReminderClaims(rows: readonly ReminderRecord[], now: Date): ClaimState {
  let inProgress = false;
  const staleClaimIds: string[] = [];

  for (const row of rows) {
    if (row.type !== 'email') continue;
    if (row.status === 'sent' || row.status === 'confirmed') return { kind: 'sent' };
    if (row.status !== 'pending' || !row.token) continue;
    if (isStaleClaim(row, now)) staleClaimIds.push(row.id);
    else inProgress = true;
  }

  return inProgress ? { kind: 'in_progress' } : { kind: 'none', staleClaimIds };
}

/**
 * Checks whether an appointment's 24-hour reminder may be tried (again),
 * from its attempts in the last RETRY_WINDOW_MS (24 h):
 *  - 'rejected'    — the email provider rejected an attempt as invalid (a
 *                    'failed' row whose token was cleared); sending it again
 *                    fails again;
 *  - 'retry_limit' — MAX_FAILED_REMINDER_ATTEMPTS attempts failed, counting
 *                    stale claims (runs that crashed after claiming);
 *  - 'ok'          — it may be tried.
 *
 * @param rows - Reminder rows of one appointment (other types are ignored).
 * @param now  - Current instant.
 */
export function checkReminderRetries(rows: readonly ReminderRecord[], now: Date): RetryCheck {
  const since = now.getTime() - RETRY_WINDOW_MS;
  let failedAttempts = 0;

  for (const row of rows) {
    if (row.type !== 'email' || !(Date.parse(row.created_at) > since)) continue;
    if (row.status === 'failed') {
      if (row.token === null) return 'rejected';
      failedAttempts++;
    } else if (row.status === 'pending' && row.token && isStaleClaim(row, now)) {
      failedAttempts++;
    }
  }
  return failedAttempts >= MAX_FAILED_REMINDER_ATTEMPTS ? 'retry_limit' : 'ok';
}

/**
 * Returns true when a booking confirmation was sent, or is being sent, within
 * the last CONFIRMATION_QUIET_PERIOD_MS. Confirmations whose links were
 * retired by a reschedule ('cancelled') do not count.
 *
 * @param rows - Reminder rows of one appointment (other types are ignored).
 * @param now  - Current instant.
 */
export function hasRecentConfirmation(rows: readonly ReminderRecord[], now: Date): boolean {
  const since = now.getTime() - CONFIRMATION_QUIET_PERIOD_MS;
  return rows.some((row) => {
    if (row.type !== 'email_confirmation') return false;
    if (row.status === 'sent' || row.status === 'confirmed') {
      return row.sent_at !== null && Date.parse(row.sent_at) > since;
    }
    if (row.status === 'pending') return Date.parse(row.created_at) > since;
    return false;
  });
}

/**
 * Decides whether an appointment's 24-hour reminder is due now.
 *
 * Due when the appointment is 'scheduled', starts within (now, now + 24 h],
 * has no 24-hour reminder sent or in progress, has attempts left (see
 * checkReminderRetries()), and had no booking confirmation in the last 12 h.
 *
 * @param appointment - The appointment.
 * @param rows        - Its reminder rows ('email' and 'email_confirmation').
 * @param now         - Current instant.
 */
export function decideReminderDue(
  appointment: AppointmentTiming,
  rows: readonly ReminderRecord[],
  now: Date,
): DueDecision {
  if (appointment.status !== 'scheduled') return { due: false, reason: 'not_scheduled' };

  const start = Date.parse(appointment.datetime);
  const nowMs = now.getTime();
  if (!Number.isFinite(start) || start <= nowMs || start > nowMs + REMINDER_LEAD_MS) {
    return { due: false, reason: 'outside_window' };
  }

  const claims = classifyReminderClaims(rows, now);
  if (claims.kind === 'sent') return { due: false, reason: 'already_sent' };
  if (claims.kind === 'in_progress') return { due: false, reason: 'in_progress' };
  const retries = checkReminderRetries(rows, now);
  if (retries !== 'ok') return { due: false, reason: retries };
  if (hasRecentConfirmation(rows, now)) return { due: false, reason: 'recent_confirmation' };

  return { due: true, staleClaimIds: claims.staleClaimIds };
}

/**
 * Picks the appointments whose 24-hour reminder is due, keeping their order.
 *
 * @param appointments - Candidate appointments.
 * @param rows         - Reminder rows of those appointments (any order).
 * @param now          - Current instant.
 * @returns            Due appointments with the stale claims to retire, and
 *                     how many candidates are not due, by reason.
 */
export function selectDueReminders<T extends AppointmentTiming & { id: string }>(
  appointments: readonly T[],
  rows: readonly ReminderRecord[],
  now: Date,
): {
  due: Array<{ appointment: T; staleClaimIds: string[] }>;
  notDue: Record<NotDueReason, number>;
} {
  const rowsByAppointment = new Map<string, ReminderRecord[]>();
  for (const row of rows) {
    const list = rowsByAppointment.get(row.appointment_id);
    if (list) list.push(row);
    else rowsByAppointment.set(row.appointment_id, [row]);
  }

  const due: Array<{ appointment: T; staleClaimIds: string[] }> = [];
  const notDue: Record<NotDueReason, number> = {
    not_scheduled: 0,
    outside_window: 0,
    already_sent: 0,
    in_progress: 0,
    rejected: 0,
    retry_limit: 0,
    recent_confirmation: 0,
  };

  for (const appointment of appointments) {
    const decision = decideReminderDue(appointment, rowsByAppointment.get(appointment.id) ?? [], now);
    if (decision.due) due.push({ appointment, staleClaimIds: decision.staleClaimIds });
    else notDue[decision.reason]++;
  }
  return { due, notDue };
}

/**
 * Orders two claims by age: created_at, then id. Both racing runs apply the
 * same order to the same rows, so they agree on the winner.
 */
function compareClaimAge(
  a: Pick<ReminderRecord, 'id' | 'created_at'>,
  b: Pick<ReminderRecord, 'id' | 'created_at'>,
): number {
  const diff = Date.parse(a.created_at) - Date.parse(b.created_at);
  if (Number.isFinite(diff) && diff !== 0) return diff;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Decides, right after inserting a claim, whether it is the one that sends.
 *
 * Until the unique index on reminders (one pending or sent 'email' row per
 * appointment) exists, two overlapping runs can both insert a claim. Each
 * then reads the appointment's live claims (pending or sent, with a token);
 * only the oldest claim proceeds, and a sent reminder beats every claim.
 *
 * @param claimId    - Id of the row just inserted.
 * @param liveClaims - The appointment's live 'email' rows, including ours.
 */
export function wonClaimRace(
  claimId: string,
  liveClaims: ReadonlyArray<Pick<ReminderRecord, 'id' | 'status' | 'created_at'>>,
): boolean {
  const ours = liveClaims.find((row) => row.id === claimId);
  if (!ours || ours.status !== 'pending') return false;
  return !liveClaims.some(
    (row) => row.id !== claimId && (row.status === 'sent' || compareClaimAge(row, ours) < 0),
  );
}

// ---------------------------------------------------------------------------
// Checks applied to every email
// ---------------------------------------------------------------------------

/**
 * Checks that an appointment can still get an email of this kind.
 *
 *  - Never for an appointment that has started, or one that is cancelled.
 *  - 24-hour reminders: only 'scheduled' appointments within 24 h.
 *  - Booking confirmations and test sends: 'scheduled' or 'confirmed'.
 *
 * @param kind        - Email kind.
 * @param appointment - The appointment (current values).
 * @param now         - Current instant.
 * @returns           Why not, or null when the email may be sent.
 */
export function checkAppointmentForEmail(
  kind: EmailKind,
  appointment: AppointmentTiming,
  now: Date,
): SkipReason | null {
  const start = Date.parse(appointment.datetime);
  if (!Number.isFinite(start) || start <= now.getTime()) return 'appointment_past';
  if (appointment.status === 'cancelled') return 'appointment_cancelled';
  if (kind === 'email') {
    if (appointment.status !== 'scheduled') return 'not_scheduled';
    if (start > now.getTime() + REMINDER_LEAD_MS) return 'not_due';
  }
  return null;
}

/**
 * Returns true when an email gets YES/NO links (and so needs the app URL).
 *
 *  - Never when the salon turned confirmation buttons off.
 *  - 24-hour reminders and test sends: always otherwise.
 *  - Booking confirmations: only when the caller asks for buttons
 *    (dashboard bookings, not public bookings).
 *
 * @param kind                - Email kind.
 * @param confirmationEnabled - salons.email_confirmation_enabled.
 * @param buttons             - The caller's choice for booking confirmations.
 */
export function needsConfirmationLinks(
  kind: EmailKind,
  confirmationEnabled: boolean | null | undefined,
  buttons: boolean,
): boolean {
  if (confirmationEnabled === false) return false;
  if (kind === 'email_confirmation') return buttons;
  return true;
}

/** Recent sends that the sending limits compare against. */
export type RecentSendCounts = {
  /** Emails of any kind the salon sent in the last hour. */
  salonLastHour: number;
  /** Emails the salon sent to this recipient address in the last 24 hours. */
  recipientLastDay: number;
  /** Test emails the salon sent in the last 24 hours. */
  testsLastDay: number;
};

/**
 * Applies the sending limits from lib/plans.ts:
 *  - HOURLY_REMINDER_RATE_LIMIT emails per salon per hour (burst guard);
 *  - MAX_TEST_EMAILS_PER_DAY test sends per salon per 24 hours;
 *  - MAX_EMAILS_PER_RECIPIENT_PER_DAY emails per recipient address per salon per 24 hours.
 *
 * @param kind   - Email kind.
 * @param counts - Recent sends.
 * @returns      The limit that was reached, or null.
 */
export function evaluateSendLimits(kind: EmailKind, counts: RecentSendCounts): SkipReason | null {
  if (counts.salonLastHour >= HOURLY_REMINDER_RATE_LIMIT) return 'salon_hourly_limit';
  if (kind === 'email_test' && counts.testsLastDay >= MAX_TEST_EMAILS_PER_DAY) return 'test_daily_limit';
  if (counts.recipientLastDay >= MAX_EMAILS_PER_RECIPIENT_PER_DAY) return 'recipient_limit';
  return null;
}
