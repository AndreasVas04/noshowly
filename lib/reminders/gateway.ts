/**
 * lib/reminders/gateway.ts
 *
 * The one place appointment emails are sent from. Every send path uses it:
 *  - the 24-hour reminder   — app/api/cron/send-reminders            (type 'email')
 *  - booking confirmations  — app/api/appointments (POST) and
 *                             app/api/book/[slug]/appointments       (type 'email_confirmation')
 *  - test sends             — app/api/appointments/[id]/test-reminder (type 'email_test')
 *
 * For each email it:
 *  1. checks the appointment is still upcoming and not cancelled (and
 *     'scheduled' for 24-hour reminders);
 *  2. checks the client has an email address;
 *  3. checks the configuration: an absolute NEXT_PUBLIC_APP_URL when the email
 *     has YES/NO links (never relative links), and RESEND_API_KEY;
 *  4. loads the salon owner's plan and monthly counter, resets the counter
 *     when a new month has started, and refuses when the plan has no email or
 *     the monthly fair-use cap is reached (lib/reminders/quota.ts);
 *  5. applies the sending limits (lib/reminders/rules.ts): per recipient
 *     address, per salon per hour (burst guard, logged as an error) and test
 *     sends per day;
 *  6. records the email as a 'pending' reminders row before sending — for the
 *     24-hour reminder this row is the claim that makes the send happen once
 *     (lib/reminders/claim.ts);
 *  7. sends through Resend with the row id as idempotency key, a plain-text
 *     alternative, the salon's name as sender name and the owner's address as
 *     reply-to;
 *  8. marks the row 'sent' and adds one to the monthly counter — or, when the
 *     send failed, records why (see recordFailure()), so the reminder job
 *     retries temporary failures a few times, never retries an email the
 *     provider rejected, and keeps a reminder due through account problems.
 *
 * The public demo account (lib/demo.ts) never emails clients: anyone can sign
 * in to it, so its emails go to the demo account's own address instead.
 *
 * send() never throws; it returns sent | skipped:<reason> | failed:<reason>.
 * Privacy: client names and email addresses are never logged.
 */

import 'server-only';
import { createAdminSupabaseClient, type AdminSupabaseClient } from '@/lib/supabase/admin';
import { isDemoAccount } from '@/lib/demo';
import { isEmailConfigured, sendEmail, type SendFailure } from '@/lib/resend';
import {
  renderConfirmationEmail,
  renderReminderEmail,
  type ConfirmationLinks,
  type RenderedEmail,
} from '@/lib/reminder-templates';
import { claimDailyReminder } from '@/lib/reminders/claim';
import { buildConfirmationLinks, resolveAppUrl } from '@/lib/reminders/links';
import {
  checkEmailQuota,
  incrementEmailCounter,
  isResetDue,
  refreshMonthlyPeriod,
  type CounterSnapshot,
} from '@/lib/reminders/quota';
import {
  DAY_MS,
  HOUR_MS,
  checkAppointmentForEmail,
  evaluateSendLimits,
  needsConfirmationLinks,
  type EmailKind,
  type FailReason,
  type SkipReason,
} from '@/lib/reminders/rules';
import {
  countEmailsToAddressSince,
  countSalonEmailsSince,
  createClaimStore,
  createCounterStore,
  insertReminderRow,
  loadAppointmentEmailContext,
  loadOwners,
  markReminderRejected,
  markReminderSent,
  markReminderUnsent,
  type AppointmentEmailContext,
  type OwnerRecord,
} from '@/lib/reminders/store';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One email to send. */
export type SendRequest = {
  kind: EmailKind;
  context: AppointmentEmailContext;
  /**
   * Booking confirmations only: include YES/NO buttons (dashboard bookings)
   * or not (public bookings). Ignored for other kinds.
   */
  buttons?: boolean;
  /** 24-hour reminders only: stale claims to retire (from selectDueReminders()). */
  staleClaimIds?: readonly string[];
};

/** Outcome of one email. */
export type SendResult =
  | {
      status: 'sent';
      reminderId: string;
      /** Address the email went to. */
      recipient: string;
      /** True when it went to the owner instead of the client (demo account). */
      toOwner: boolean;
    }
  | { status: 'skipped'; reason: SkipReason }
  | { status: 'failed'; reason: FailReason; message: string };

/** A gateway instance. Caches owners and recent-send counts for its lifetime. */
export type EmailGateway = {
  /** Sends one email. Never throws. */
  send(request: SendRequest): Promise<SendResult>;
  /** Loads many salon owners in one query (the reminder job calls this first). */
  preloadOwners(userIds: readonly string[]): Promise<void>;
};

/** Cached owner: plan, address and monthly counter. */
type OwnerState = { id: string; email: string; plan: string; counter: CounterSnapshot };

// ---------------------------------------------------------------------------
// Gateway
// ---------------------------------------------------------------------------

/**
 * Creates a gateway. Create one per request (or per reminder job run): it
 * caches salon owners and recent-send counts, which are kept up to date with
 * its own sends.
 *
 * @param options.db                - Service-role client (default: a new one).
 * @param options.clock             - Current time (injectable for tests).
 * @param options.minSendIntervalMs - Minimum time between two Resend calls made
 *                                    by this gateway (the reminder job paces its
 *                                    batch below Resend's rate limit). Default 0.
 */
export function createEmailGateway(
  options: { db?: AdminSupabaseClient; clock?: () => Date; minSendIntervalMs?: number } = {},
): EmailGateway {
  const db                = options.db ?? createAdminSupabaseClient();
  const clock             = options.clock ?? (() => new Date());
  const minSendIntervalMs = options.minSendIntervalMs ?? 0;
  const counterStore      = createCounterStore(db);
  const claimStore        = createClaimStore(db);
  /** When this gateway last called Resend (epoch ms). */
  let lastSendAt = 0;

  const owners             = new Map<string, OwnerState | null>();
  const salonHourCounts    = new Map<string, number>();
  const recipientDayCounts = new Map<string, number>();

  /** Caches loaded owner rows (null for ids that were not found). */
  function rememberOwners(ids: readonly string[], loaded: Map<string, OwnerRecord>): void {
    for (const id of ids) {
      const row = loaded.get(id);
      owners.set(id, row ? {
        id:      row.id,
        email:   row.email,
        plan:    row.plan,
        counter: { used: row.email_reminders_used_this_month ?? 0, resetAt: row.reminders_reset_at },
      } : null);
    }
  }

  async function preloadOwners(userIds: readonly string[]): Promise<void> {
    const missing = [...new Set(userIds)].filter((id) => !owners.has(id));
    if (missing.length > 0) rememberOwners(missing, await loadOwners(db, missing));
  }

  /**
   * Returns the owner with the current month's counter (resetting it lazily
   * when a new month has started). A failed reset is logged and the stored
   * counter is used, as before.
   */
  async function currentOwner(userId: string, now: Date): Promise<OwnerState | null> {
    await preloadOwners([userId]);
    const owner = owners.get(userId) ?? null;
    if (owner && isResetDue(owner.counter.resetAt, now)) {
      try {
        owner.counter = await refreshMonthlyPeriod(counterStore, owner.id, owner.counter, now);
      } catch (err) {
        console.error(`[email-gateway] owner=${owner.id} WARN — monthly counter reset failed:`, errorMessage(err));
      }
    }
    return owner;
  }

  /** Emails of any kind the salon sent in the last hour. */
  async function salonLastHour(salonId: string, now: Date): Promise<number> {
    let count = salonHourCounts.get(salonId);
    if (count === undefined) {
      count = await countSalonEmailsSince(db, salonId, new Date(now.getTime() - HOUR_MS));
      salonHourCounts.set(salonId, count);
    }
    return count;
  }

  /** Cache key of a recipient within a salon. */
  function recipientKey(salonId: string, recipient: string, toOwner: boolean): string {
    return toOwner ? `${salonId}|owner` : `${salonId}|${recipient.toLowerCase()}`;
  }

  /**
   * Emails the salon sent to the recipient in the last 24 hours. When emails
   * go to the owner (demo account), every email of the salon went there.
   */
  async function recipientLastDay(salonId: string, recipient: string, toOwner: boolean, now: Date): Promise<number> {
    const key = recipientKey(salonId, recipient, toOwner);
    let count = recipientDayCounts.get(key);
    if (count === undefined) {
      const since = new Date(now.getTime() - DAY_MS);
      count = toOwner
        ? await countSalonEmailsSince(db, salonId, since)
        : await countEmailsToAddressSince(db, salonId, recipient, since);
      recipientDayCounts.set(key, count);
    }
    return count;
  }

  /** Updates the cached counts after a send. */
  function countSend(salonId: string, recipient: string, toOwner: boolean): void {
    const hour = salonHourCounts.get(salonId);
    if (hour !== undefined) salonHourCounts.set(salonId, hour + 1);
    const key = recipientKey(salonId, recipient, toOwner);
    const day = recipientDayCounts.get(key);
    if (day !== undefined) recipientDayCounts.set(key, day + 1);
  }

  async function send(request: SendRequest): Promise<SendResult> {
    const now = clock();
    const { kind, context } = request;
    const log = `[email-gateway] type=${kind} appt=${context.appointment.id} salon=${context.salon.id}`;
    let reminderId: string | null = null;
    /** Set once Resend accepted the email: from then on the result is 'sent'. */
    let delivered: Extract<SendResult, { status: 'sent' }> | null = null;

    try {
      // Step 1: The appointment must still be upcoming (and 'scheduled' for
      // 24-hour reminders). Never email about past or cancelled appointments.
      const appointmentProblem = checkAppointmentForEmail(kind, context.appointment, now);
      if (appointmentProblem) return skipped(log, appointmentProblem);

      // Step 2: The client must have an email address — checked before
      // anything else is loaded.
      const clientEmail = context.client?.email?.trim() || null;
      if (!clientEmail) return skipped(log, 'no_email');

      // Step 3: Configuration. Links in emails must be absolute, so a missing
      // NEXT_PUBLIC_APP_URL fails loudly instead of building relative links.
      const token = crypto.randomUUID();
      let links: ConfirmationLinks | null = null;
      if (needsConfirmationLinks(kind, context.salon.email_confirmation_enabled, request.buttons === true)) {
        const appUrl = resolveAppUrl(process.env.NEXT_PUBLIC_APP_URL);
        if (!appUrl.ok) return failed(log, 'config', appUrl.error);
        links = buildConfirmationLinks(appUrl.url, token);
      }
      if (!isEmailConfigured()) return failed(log, 'config', 'RESEND_API_KEY is not set');

      // Step 4: The owner's plan must include email and the monthly fair-use
      // cap must not be reached (internal limit — never shown publicly).
      // Like the limits in Step 6, the cap is checked before the email is
      // recorded and counted, so sends at the same moment can end slightly
      // over it; acceptable for fair-use caps.
      const owner = await currentOwner(context.salon.user_id, now);
      if (!owner) return failed(log, 'database', 'salon owner not found');
      const quota = checkEmailQuota(owner.plan, owner.counter.used);
      if (quota !== 'ok') return skipped(log, quota);

      // Step 5: Recipient. The public demo account only emails its own address.
      const toOwner   = isDemoAccount(owner.email);
      const recipient = toOwner ? owner.email : clientEmail;

      // Step 6: Sending limits. The counts are read before this email's row
      // is inserted, so emails sent at the same moment can all pass and go
      // slightly over a limit (acceptable: these are fair-use and anti-abuse caps).
      const limit = evaluateSendLimits(kind, {
        salonLastHour:    await salonLastHour(context.salon.id, now),
        recipientLastDay: await recipientLastDay(context.salon.id, recipient, toOwner, now),
        testsLastDay:     kind === 'email_test'
          ? await countSalonEmailsSince(db, context.salon.id, new Date(now.getTime() - DAY_MS), ['email_test'])
          : 0,
      });
      if (limit === 'salon_hourly_limit') {
        console.error(
          `${log} BLOCKED — salon sent too many emails in the last hour ` +
          `(burst guard). Investigate immediately: salon=${context.salon.id}`,
        );
      }
      if (limit) return skipped(log, limit);

      // Step 7: Render before writing anything, so a rendering error leaves no row.
      const email = renderEmail(kind, context, links);

      // Step 8: Record the email before sending it.
      if (kind === 'email') {
        const claim = await claimDailyReminder(claimStore, {
          appointmentId: context.appointment.id,
          token,
          staleClaimIds: request.staleClaimIds ?? [],
          now,
        });
        if (!claim.ok) {
          return claim.reason === 'already_claimed'
            ? skipped(log, 'already_claimed')
            : failed(log, 'database', claim.message);
        }
        reminderId = claim.claimId;
      } else {
        const inserted = await insertReminderRow(db, {
          appointmentId: context.appointment.id,
          type:          kind,
          token,
          sendAt:        now.toISOString(),
        });
        if (!inserted.ok) return failed(log, 'database', inserted.message);
        reminderId = inserted.row.id;
      }

      // Step 9: Send. The row id is the idempotency key.
      const wait = lastSendAt + minSendIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      lastSendAt = Date.now();
      const result = await sendEmail({
        to:             recipient,
        subject:        email.subject,
        html:           email.html,
        text:           email.text,
        fromName:       context.salon.name,
        replyTo:        owner.email,
        idempotencyKey: reminderId,
      });

      if (!result.success) {
        return await recordFailure(reminderId, result.failure, result.error, log);
      }
      delivered = { status: 'sent', reminderId, recipient, toOwner };

      // Step 10: Mark the row as sent and count the email. The email is out,
      // so failures here are logged but do not change the result.
      await recordSent(reminderId, log);
      await countEmail(owner, log);
      countSend(context.salon.id, recipient, toOwner);

      console.log(`${log} SENT reminder=${reminderId}${toOwner ? ' (to the demo account owner)' : ''}`);
      return delivered;

    } catch (err) {
      // Catch any unexpected error so one email's failure never aborts a batch.
      if (delivered) {
        console.error(`${log} ERROR after sending reminder=${delivered.reminderId}:`, errorMessage(err));
        return delivered;
      }
      if (reminderId) await settleUnsent(reminderId, 'failed', log);
      return failed(log, 'unexpected', errorMessage(err));
    }
  }

  /** Marks the row 'sent', trying twice; the email is already delivered. */
  async function recordSent(reminderId: string, log: string): Promise<void> {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await markReminderSent(db, reminderId, clock().toISOString());
        return;
      } catch (err) {
        if (attempt === 2) {
          console.error(`${log} ERROR — reminder=${reminderId} was sent but not marked as sent:`, errorMessage(err));
        }
      }
    }
  }

  /** Adds one to the owner's monthly counter; drift is corrected at the next reset. */
  async function countEmail(owner: OwnerState, log: string): Promise<void> {
    try {
      const result = await incrementEmailCounter(counterStore, owner.id, owner.counter);
      owner.counter = result.counter;
      if (!result.ok) console.error(`${log} WARN — monthly email counter not incremented (concurrent updates)`);
    } catch (err) {
      console.error(`${log} WARN — failed to increment the monthly email counter:`, errorMessage(err));
    }
  }

  /**
   * Records a send the email provider did not accept and returns its result:
   *  - 'rejected'  — the email is invalid for the provider (e.g. the recipient
   *                  address): the row becomes 'failed' with its token
   *                  cleared, and the reminder job never retries it;
   *  - 'account'   — the account or sender cannot send (API key, sender
   *                  domain, quota): the row becomes 'skipped', because this
   *                  was not really an attempt at this email; the reminder
   *                  stays due and goes out once the account works. The
   *                  reminder job stops its run on this result;
   *  - 'temporary' — the row becomes 'failed'; the reminder job tries again,
   *                  up to MAX_FAILED_REMINDER_ATTEMPTS times in 24 hours.
   */
  async function recordFailure(
    reminderId: string,
    failure: SendFailure,
    message: string,
    log: string,
  ): Promise<SendResult> {
    if (failure === 'rejected') {
      try {
        await markReminderRejected(db, reminderId);
      } catch (err) {
        console.error(`${log} ERROR — failed to mark reminder=${reminderId} as rejected:`, errorMessage(err));
      }
      return failed(log, 'rejected', message);
    }
    if (failure === 'account') {
      await settleUnsent(reminderId, 'skipped', log);
      return failed(log, 'config', `the email provider refused the account: ${message}`);
    }
    await settleUnsent(reminderId, 'failed', log);
    return failed(log, 'provider', message);
  }

  /** Marks an unsent row as failed or skipped; errors are logged only. */
  async function settleUnsent(reminderId: string, status: 'failed' | 'skipped', log: string): Promise<void> {
    try {
      await markReminderUnsent(db, reminderId, status);
    } catch (err) {
      console.error(`${log} ERROR — failed to mark reminder=${reminderId} as ${status}:`, errorMessage(err));
    }
  }

  return { send, preloadOwners };
}

// ---------------------------------------------------------------------------
// Single sends
// ---------------------------------------------------------------------------

/**
 * Loads an appointment and sends one email about it through a new gateway.
 * Used by the booking and test routes. Never throws.
 *
 * @param input.kind          - Email kind.
 * @param input.appointmentId - Appointment id (the caller has checked access).
 * @param input.buttons       - Booking confirmations: include YES/NO buttons.
 */
export async function sendAppointmentEmail(input: {
  kind: EmailKind;
  appointmentId: string;
  buttons?: boolean;
}): Promise<SendResult> {
  const log = `[email-gateway] type=${input.kind} appt=${input.appointmentId}`;
  try {
    const db = createAdminSupabaseClient();
    const context = await loadAppointmentEmailContext(db, input.appointmentId);
    if (!context) return failed(log, 'database', 'appointment not found');
    return await createEmailGateway({ db }).send({
      kind:    input.kind,
      context,
      buttons: input.buttons,
    });
  } catch (err) {
    return failed(log, 'unexpected', errorMessage(err));
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Renders the email for its kind.
 *
 * @param kind    - Email kind.
 * @param context - Appointment, client, staff and salon.
 * @param links   - YES/NO links, or null for none.
 */
function renderEmail(
  kind: EmailKind,
  context: AppointmentEmailContext,
  links: ConfirmationLinks | null,
): RenderedEmail {
  const details = {
    salonName:   context.salon.name,
    clientName:  context.client?.name ?? null,
    serviceType: context.appointment.service_type,
    staffName:   context.staffName,
    datetime:    context.appointment.datetime,
    timeZone:    context.salon.timezone,
  };
  if (kind === 'email_confirmation') return renderConfirmationEmail(details, context.salon, links);
  return renderReminderEmail(details, context.salon, links, { test: kind === 'email_test' });
}

/** Logs and returns a skipped result. */
function skipped(log: string, reason: SkipReason): SendResult {
  console.log(`${log} SKIP — ${reason}`);
  return { status: 'skipped', reason };
}

/** Logs and returns a failed result. */
function failed(log: string, reason: FailReason, message: string): SendResult {
  console.error(`${log} FAILED — ${reason}: ${message}`);
  return { status: 'failed', reason, message };
}

/** Message of an unknown error value. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Resolves after `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
