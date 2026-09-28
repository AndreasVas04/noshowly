/**
 * app/api/cron/send-reminders/route.ts
 *
 * GET  /api/cron/send-reminders — Vercel Cron   (Authorization: Bearer <CRON_SECRET>)
 * POST /api/cron/send-reminders — Supabase pg_cron (X-Cron-Secret: <CRON_SECRET>)
 *
 * Reminder dispatch job: sends the 24-hour reminder emails (YES/NO buttons)
 * that are due. Run it every 15 minutes; reminders then go out between 24 h
 * and 23 h 45 min before the appointment.
 *
 * Due (see lib/reminders/rules.ts):
 *  - the appointment is 'scheduled' and starts within the next 24 hours;
 *  - it has no 24-hour reminder sent or being sent;
 *  - no booking confirmation was sent for it in the last 12 hours, so a
 *    client who booked less than a day ahead does not get the confirmation
 *    and the reminder minutes apart.
 * There is no lower bound: after missed runs, the next run catches up
 * (never once an appointment has started).
 *
 * Each run:
 *  1. Authenticates the request (lib/cron-auth.ts). Rejected when CRON_SECRET is unset.
 *  2. Checks the configuration: reminder links need NEXT_PUBLIC_APP_URL and
 *     sending needs RESEND_API_KEY. A missing value fails the run loudly.
 *  3. Loads the candidate appointments and their reminder rows in batches and
 *     picks the due ones.
 *  4. Loads the owners of the salons concerned in one query.
 *  5. Sends through the email gateway (lib/reminders/gateway.ts), one at a
 *     time, soonest appointment first, until the time budget is used. The
 *     gateway checks the client email first, then the plan, monthly cap and
 *     sending limits, and claims each reminder before sending it, so
 *     overlapping runs never send the same reminder twice. Whatever is left
 *     is still due in the next run.
 *
 * Failed sends are retried by later runs, at most 3 times in 24 hours per
 * appointment; an email the provider rejected as invalid is not retried. When
 * the provider refuses the account itself (API key, sender domain, quota), the
 * run stops with a 500 and the reminders stay due for the next run.
 *
 * Responses:
 *  200 { due, sent, skipped, failed } — `due` counts the reminders found due;
 *      the rest of `due` (not sent, skipped or failed) ran out of time and is
 *      picked up by the next run. Per-appointment problems are counted, not fatal.
 *  401 { error: "Unauthorized" }
 *  500 { error } — only when the run cannot work at all (configuration,
 *      database unavailable, or the email provider refusing the account).
 *
 * Security:
 *  - Uses the service-role key so it can query across all salons.
 *  - Never logs client phone numbers, email addresses, or other PII.
 */

import { authorizeCronRequest } from '@/lib/cron-auth';
import { isEmailConfigured } from '@/lib/resend';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createEmailGateway } from '@/lib/reminders/gateway';
import { resolveAppUrl } from '@/lib/reminders/links';
import {
  reminderWindow,
  selectDueReminders,
  type FailReason,
  type SkipReason,
} from '@/lib/reminders/rules';
import {
  loadReminderRecords,
  loadScheduledAppointmentsBetween,
  type AppointmentEmailContext,
} from '@/lib/reminders/store';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Longest this function may run on Vercel, in seconds. */
export const maxDuration = 60;

/**
 * Time a run spends sending before it stops, measured from the start of the
 * request. Leaves a margin within maxDuration and pg_net's 30-second timeout.
 */
const SEND_BUDGET_MS = 25_000;

/** Minimum time between two Resend calls (Resend allows 2 requests per second by default). */
const MIN_SEND_INTERVAL_MS = 500;

/** Candidate appointments read per request (below PostgREST's 1,000-row limit). */
const PAGE_SIZE = 500;

/** Most candidate pages read per run. */
const MAX_PAGES = 20;

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * Runs the reminder job for Vercel Cron.
 *
 * @param request - Must carry `Authorization: Bearer <CRON_SECRET>`.
 */
export async function GET(request: Request): Promise<Response> {
  return runReminderJob(request);
}

/**
 * Runs the reminder job for the Supabase pg_cron job.
 *
 * @param request - Must carry `X-Cron-Secret: <CRON_SECRET>`.
 */
export async function POST(request: Request): Promise<Response> {
  return runReminderJob(request);
}

// ---------------------------------------------------------------------------
// Job
// ---------------------------------------------------------------------------

/** Per-run totals returned to the scheduler. */
type RunCounts = { due: number; sent: number; skipped: number; failed: number };

/**
 * Sends the 24-hour reminders that are due.
 *
 * @param request - Incoming GET or POST request.
 * @returns 200 { due, sent, skipped, failed }, 401 or 500 (see file header).
 */
async function runReminderJob(request: Request): Promise<Response> {
  const startedAt = Date.now();

  // Step 1: Verify the cron secret — prevents unauthorized triggering.
  const auth = authorizeCronRequest(request.headers);
  if (!auth.ok) {
    if (auth.reason === 'not_configured') {
      console.error('[cron/send-reminders] CRON_SECRET is not set — every request is rejected');
    } else {
      console.warn('[cron/send-reminders] Unauthorized request — bad or missing cron secret');
    }
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Step 2: Configuration. Without these no reminder can be sent, so the run
  // fails loudly instead of recording a failure for every appointment.
  const appUrl = resolveAppUrl(process.env.NEXT_PUBLIC_APP_URL);
  if (!appUrl.ok) {
    console.error(`[cron/send-reminders] CONFIG ERROR — ${appUrl.error}`);
    return Response.json({ error: 'Reminder emails are not configured' }, { status: 500 });
  }
  if (!isEmailConfigured()) {
    console.error('[cron/send-reminders] CONFIG ERROR — RESEND_API_KEY is not set');
    return Response.json({ error: 'Reminder emails are not configured' }, { status: 500 });
  }

  const now = new Date();
  console.log('[cron/send-reminders] Job started at', now.toISOString());

  try {
    const db = createAdminSupabaseClient();

    // Step 3: Candidates and their reminder rows, in batches; pick the due ones.
    const candidates = await loadScheduledAppointmentsBetween(db, reminderWindow(now), {
      pageSize: PAGE_SIZE,
      maxPages: MAX_PAGES,
    });
    if (candidates.length >= PAGE_SIZE * MAX_PAGES) {
      console.warn(
        `[cron/send-reminders] WARN — read the maximum of ${candidates.length} candidates; ` +
        'later appointments are checked in the next runs',
      );
    }

    const records = await loadReminderRecords(db, candidates.map((c) => c.appointment.id));
    const { due, notDue } = selectDueReminders(
      candidates.map((context) => ({
        id:       context.appointment.id,
        datetime: context.appointment.datetime,
        status:   context.appointment.status,
        context,
      })),
      records,
      now,
    );

    // Step 4: Owners of the salons with due reminders to clients who have an
    // email, in one query (the gateway checks the client email first anyway).
    const gateway = createEmailGateway({ db, minSendIntervalMs: MIN_SEND_INTERVAL_MS });
    await gateway.preloadOwners(
      due
        .filter(({ appointment }) => hasClientEmail(appointment.context))
        .map(({ appointment }) => appointment.context.salon.user_id),
    );

    // Step 5: Send one at a time, soonest first, within the time budget.
    const counts: RunCounts = { due: due.length, sent: 0, skipped: 0, failed: 0 };
    const skippedBy: Partial<Record<SkipReason, number>> = {};

    const failedBy: Partial<Record<FailReason, number>> = {};
    let accountProblem: string | null = null;

    for (const { appointment, staleClaimIds } of due) {
      if (Date.now() - startedAt >= SEND_BUDGET_MS) break;

      const result = await gateway.send({ kind: 'email', context: appointment.context, staleClaimIds });
      if (result.status === 'sent') {
        counts.sent++;
      } else if (result.status === 'skipped') {
        counts.skipped++;
        skippedBy[result.reason] = (skippedBy[result.reason] ?? 0) + 1;
      } else {
        counts.failed++;
        failedBy[result.reason] = (failedBy[result.reason] ?? 0) + 1;
        // The email provider refused the account itself (API key, sender
        // domain, quota): every other reminder would fail the same way. Stop;
        // the reminders stay due and go out once the account works.
        if (result.reason === 'config') {
          accountProblem = result.message;
          break;
        }
      }
    }

    const remaining = counts.due - counts.sent - counts.skipped - counts.failed;
    const summary =
      `due: ${counts.due}, sent: ${counts.sent}, ` +
      `skipped: ${counts.skipped} ${JSON.stringify(skippedBy)}, ` +
      `failed: ${counts.failed} ${JSON.stringify(failedBy)}, ` +
      `left for the next run: ${remaining}, not due: ${JSON.stringify(notDue)}`;

    if (accountProblem) {
      console.error(`[cron/send-reminders] Run stopped — ${accountProblem}. ${summary}`);
      return Response.json({ error: 'The email provider refused to send' }, { status: 500 });
    }

    console.log(`[cron/send-reminders] Job complete — ${summary}`);
    return Response.json(counts, { status: 200 });

  } catch (err) {
    // The candidate, reminder or owner lookups failed: nothing could be decided.
    console.error('[cron/send-reminders] Run failed:', err instanceof Error ? err.message : err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** Returns true when the appointment's client has an email address. */
function hasClientEmail(context: AppointmentEmailContext): boolean {
  return Boolean(context.client?.email?.trim());
}
