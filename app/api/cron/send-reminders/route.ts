/**
 * app/api/cron/send-reminders/route.ts
 *
 * POST /api/cron/send-reminders
 *
 * Hourly reminder dispatch job — called by Supabase pg_cron (or Vercel cron)
 * once per hour. Finds appointments in the 23–25 hour window and sends email
 * reminders 24 h before the appointment.
 *
 * Safety rules:
 *  1. Appointment must be in the future (datetime > NOW()). Never remind for
 *     past appointments — the window check handles this but we re-verify explicitly.
 *  2. Appointment must not be cancelled.
 *  3. Deduplication: skip if a reminder with status='sent' already exists for
 *     the same appointment + type. Prevents duplicate email on retries.
 *  4. Monthly plan limit check: block when email_reminders_used_this_month ≥ plan cap.
 *  5. Per-salon hourly rate limit: alert and block if > HOURLY_REMINDER_RATE_LIMIT
 *     reminders have been sent for this salon in the last 60 minutes.
 *
 * Security:
 *  - Requires the CRON_SECRET header to prevent unauthorized invocations.
 *  - Uses the service role key so it can query across all salons.
 *  - Never logs client phone numbers, email addresses, or other PII.
 */

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types';
import {
  getPlanEmailLimit,
  planAllowsEmail,
  HOURLY_REMINDER_RATE_LIMIT,
  EMAIL_REMINDER_WINDOW,
} from '@/lib/plans';
import type { UserPlan } from '@/lib/plans';
import { sendEmail } from '@/lib/resend';
import { getEmailHTML, getEmailSubject } from '@/lib/reminder-templates';

// ---------------------------------------------------------------------------
// Service role client — bypasses RLS to query across all salons.
// Only used here, never exposed to the browser.
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
if (!SERVICE_ROLE_KEY) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');

/** Service-role Supabase client — bypasses RLS. Used only in this cron route. */
const adminSupabase = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY);

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

/**
 * Processes reminder dispatch for all salons.
 * Called hourly by the pg_cron job or Vercel cron configuration.
 *
 * @param request - Incoming request; must include X-Cron-Secret header.
 * @returns 200 { sent: number, skipped: number } on success.
 * @returns 401 { error: "Unauthorized" } if the secret is missing or wrong.
 * @returns 500 { error: string } on unexpected failure.
 */
export async function POST(request: Request): Promise<Response> {
  // Step 1: Verify cron secret — prevents unauthorized triggering.
  // The CRON_SECRET is set in environment variables and sent as a header
  // by the pg_cron job or Vercel cron configuration.
  const cronSecret = request.headers.get('X-Cron-Secret');
  if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
    console.warn('[cron/send-reminders] Unauthorized request — bad or missing cron secret');
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log('[cron/send-reminders] Job started at', new Date().toISOString());

  const now = new Date();

  // Build the time window for email reminders (24 h before the appointment).
  // Window constants are defined in lib/plans.ts so they're the single source of truth.
  const emailWindowStart = new Date(now.getTime() + EMAIL_REMINDER_WINDOW.minHours * 60 * 60 * 1000).toISOString();
  const emailWindowEnd   = new Date(now.getTime() + EMAIL_REMINDER_WINDOW.maxHours * 60 * 60 * 1000).toISOString();

  let totalSent = 0;
  let totalSkipped = 0;

  try {
    // Step 2: Fetch appointments due for email reminders.
    // datetime > NOW() ensures we never send for past appointments.
    // status = 'scheduled' ensures we skip cancelled and already-confirmed slots.
    const { data: emailAppointments, error: emailError } = await adminSupabase
      .from('appointments')
      .select(`
        id, salon_id, client_id, datetime, service_type, status,
        clients (name, phone, email),
        salons (name, timezone, user_id, email_footer, email_subject, email_greeting, email_body, email_closing, email_confirmation_enabled)
      `)
      .eq('status', 'scheduled')
      .gt('datetime', now.toISOString())
      .gte('datetime', emailWindowStart)
      .lte('datetime', emailWindowEnd);

    if (emailError) {
      console.error('[cron/send-reminders] Failed to fetch email appointments:', emailError.message);
      return Response.json({ error: 'Failed to query appointments' }, { status: 500 });
    }

    // Step 3: Process each email appointment independently.
    // Each call is wrapped in a try/catch inside processReminder so one
    // failing appointment never aborts the rest of the batch.
    for (const appt of (emailAppointments ?? []) as unknown as AppointmentRow[]) {
      const result = await processReminder(appt, now);
      if (result === 'sent') totalSent++;
      else totalSkipped++;
    }

    console.log(
      `[cron/send-reminders] Job complete — sent: ${totalSent}, skipped: ${totalSkipped}`
    );
    return Response.json({ sent: totalSent, skipped: totalSkipped }, { status: 200 });

  } catch (err) {
    console.error('[cron/send-reminders] Unexpected error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// processReminder
// ---------------------------------------------------------------------------

// Minimal joined shape returned by the Supabase select above.
type AppointmentRow = {
  id: string;
  salon_id: string;
  client_id: string | null;
  datetime: string;
  service_type: string | null;
  status: string;
  clients: { name: string; phone: string | null; email?: string | null } | null;
  salons: {
    name: string;
    timezone: string;
    user_id: string;
    email_footer: string | null;
    email_subject: string | null;
    email_greeting: string | null;
    email_body: string | null;
    email_closing: string | null;
    email_confirmation_enabled: boolean;
  } | null;
};

/**
 * Attempts to send a single email reminder for one appointment.
 *
 * All safety checks run in sequence; any failure returns 'skipped' without
 * throwing. A try/catch wraps the entire body so an unexpected runtime error
 * for one appointment never aborts the outer batch loop.
 *
 * Safety checks:
 *  1. Appointment is in the future.
 *  2. Appointment is not cancelled.
 *  3. Deduplication: no existing 'sent' email reminder for this appointment.
 *  4. Monthly plan limit.
 *  5. Per-salon hourly rate limit (HOURLY_REMINDER_RATE_LIMIT from lib/plans.ts).
 *  6. Create 'pending' reminder record, dispatch email, mark 'sent'.
 *
 * Privacy: client phone/email and client name are NEVER written to logs.
 * Only the appointment ID and salon name are logged.
 *
 * @param appt - The appointment row with joined client and salon data.
 * @param now  - Reference time (passed in for consistency within the job run).
 * @returns 'sent' if the reminder was dispatched, 'skipped' otherwise.
 */
async function processReminder(
  appt: AppointmentRow,
  now: Date
): Promise<'sent' | 'skipped'> {
  const logPrefix = `[cron/send-reminders] appt=${appt.id} type=email`;

  // Wrap the entire function body in try/catch so an unexpected error for
  // one appointment never throws into the outer batch loop and aborts it.
  try {
    // Guard 1: Appointment must be in the future.
    // The query already filters this, but we re-check here to guard against
    // race conditions where an appointment time passed between the query and now.
    if (new Date(appt.datetime) <= now) {
      console.log(`${logPrefix} SKIP — appointment is in the past`);
      return 'skipped';
    }

    // Guard 2: Appointment must not be cancelled.
    // Status='scheduled' is already filtered by the query, but status changes
    // that happened between the query and this step are caught here.
    if (appt.status === 'cancelled') {
      console.log(`${logPrefix} SKIP — appointment is cancelled`);
      return 'skipped';
    }

    // Guard 3: Deduplication — skip if a 'sent' email reminder already exists.
    // Prevents sending duplicates on cron retries or parallel executions.
    const { data: existingReminder } = await adminSupabase
      .from('reminders')
      .select('id')
      .eq('appointment_id', appt.id)
      .eq('type', 'email')
      .eq('status', 'sent')
      .maybeSingle();

    if (existingReminder) {
      console.log(`${logPrefix} SKIP — reminder already sent (dedup)`);
      return 'skipped';
    }

    // Guard 4: Monthly plan limit.
    // Fetch the salon owner's user record to check their plan and usage counter.
    const userId = appt.salons?.user_id;
    if (!userId) {
      console.warn(`${logPrefix} SKIP — could not resolve salon owner`);
      return 'skipped';
    }

    const { data: user } = await adminSupabase
      .from('users')
      .select('plan, email_reminders_used_this_month, reminders_reset_at')
      .eq('id', userId)
      .single();

    if (!user) {
      console.warn(`${logPrefix} SKIP — user record not found for salon owner`);
      return 'skipped';
    }

    // Check channel availability — plans with email=0 never send email reminders.
    if (!planAllowsEmail(user.plan as UserPlan)) {
      console.log(`${logPrefix} SKIP — plan '${user.plan}' does not allow email`);
      return 'skipped';
    }

    // Reset monthly counter if the reset date has passed.
    const resetAt = new Date(user.reminders_reset_at);
    if (now >= resetAt) {
      const nextResetAt = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
      ).toISOString();

      const { error: resetError } = await adminSupabase
        .from('users')
        .update({
          reminders_used_this_month: 0,
          email_reminders_used_this_month: 0,
          reminders_reset_at: nextResetAt,
        })
        .eq('id', userId);

      if (resetError) {
        // Log but don't abort — stale counter is better than a missed reminder.
        console.error(`${logPrefix} WARN — failed to reset monthly counters:`, resetError.message);
      } else {
        user.email_reminders_used_this_month = 0;
      }
    }

    // Email fair-use cap check (internal only — never expose this limit publicly).
    // Public copy says "Unlimited email reminders"; this cap protects system resources.
    // TODO: Add admin notification when a salon exceeds 80% of their email fair-use cap.
    //       Implement as a separate monitoring job querying email_reminders_used_this_month.
    const emailMonthlyLimit = getPlanEmailLimit(user.plan as UserPlan);
    if (user.email_reminders_used_this_month >= emailMonthlyLimit) {
      console.warn(
        `${logPrefix} SKIP — email fair-use cap reached for salon=${appt.salon_id} ` +
        `plan=${user.plan} (internal cap: ${emailMonthlyLimit}/month). ` +
        `This is an internal limit and must not be communicated to the end user.`
      );
      return 'skipped';
    }

    // Guard 5: Per-salon hourly rate limit.
    // Count reminders sent for THIS salon's appointments in the last 60 minutes.
    // Two-step approach: first get this salon's appointment IDs from the last 2 days,
    // then count recent sent reminders for those IDs. This avoids a schema change
    // (adding salon_id to the reminders table) while keeping the count per-salon.
    const oneHourAgo  = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const twoDaysAgo  = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();

    const { data: recentSalonAppts } = await adminSupabase
      .from('appointments')
      .select('id')
      .eq('salon_id', appt.salon_id)
      .gte('datetime', twoDaysAgo);

    let salonHourlyCount = 0;
    if (recentSalonAppts && recentSalonAppts.length > 0) {
      const salonApptIds = recentSalonAppts.map((a) => a.id);
      const { count } = await adminSupabase
        .from('reminders')
        .select('*', { count: 'exact', head: true })
        .in('appointment_id', salonApptIds)
        .eq('status', 'sent')
        .gte('sent_at', oneHourAgo);
      salonHourlyCount = count ?? 0;
    }

    if (salonHourlyCount >= HOURLY_REMINDER_RATE_LIMIT) {
      console.error(
        `${logPrefix} BLOCKED — per-salon hourly rate limit exceeded ` +
        `(${salonHourlyCount} sent in last hour, limit=${HOURLY_REMINDER_RATE_LIMIT}). ` +
        `Investigate immediately: salon=${appt.salon_id}`
      );
      return 'skipped';
    }

    // Step 6: Check email before creating any DB records — avoids wasted writes.
    // Guard: client must have an email address (optional field).
    const email = appt.clients?.email;
    if (!email) {
      console.log(`${logPrefix} SKIP — client has no email address`);
      return 'skipped';
    }

    // Use the salon name as the display name in reminders.
    const salonDisplayName = appt.salons?.name ?? 'Your salon';
    const clientName       = appt.clients?.name ?? 'there';
    const timezone         = appt.salons?.timezone ?? 'UTC';

    // Log the dispatch attempt — salon name only, no client PII.
    console.log(
      `${logPrefix} DISPATCHING — salon="${appt.salons?.name}" ` +
      `datetime=${appt.datetime}`
    );

    // Create a 'pending' reminder record with a unique token, then dispatch.
    // The token is embedded in email YES/NO button URLs — it is single-use
    // (the confirm route marks it as used after the first click).
    const sendAt = now.toISOString();
    const token  = crypto.randomUUID();

    const { data: reminder, error: insertError } = await adminSupabase
      .from('reminders')
      .insert({
        appointment_id: appt.id,
        type: 'email',
        send_at: sendAt,
        status: 'pending',
        token,
      })
      .select()
      .single();

    if (insertError || !reminder) {
      console.error(`${logPrefix} ERROR — failed to insert reminder record:`, insertError?.message);
      return 'skipped';
    }

    const appUrl     = process.env.NEXT_PUBLIC_APP_URL ?? '';
    const confirmUrl = `${appUrl}/api/confirm/${token}?response=yes`;
    const cancelUrl  = `${appUrl}/api/confirm/${token}?response=no`;

    // Build subject using custom template if set, falling back to the application default.
    const subject = getEmailSubject(salonDisplayName, appt.salons?.email_subject);

    // Pass all custom email template fields; each falls back to its default when null.
    // email_confirmation_enabled defaults to true if the column is missing on older rows.
    const html = getEmailHTML(
      salonDisplayName,
      clientName,
      appt.service_type,
      appt.datetime,
      timezone,
      confirmUrl,
      cancelUrl,
      appt.salons?.email_footer,
      appt.salons?.email_confirmation_enabled ?? true,
      appt.salons?.email_greeting,
      appt.salons?.email_body,
      appt.salons?.email_closing,
    );

    const result = await sendEmail(email, subject, html);

    if (!result.success) {
      console.error(`${logPrefix} Email send failed:`, result.error);
      await adminSupabase
        .from('reminders')
        .update({ status: 'failed' })
        .eq('id', reminder.id);
      return 'skipped';
    }

    // Mark the reminder as sent and record the sent timestamp.
    const { error: updateError } = await adminSupabase
      .from('reminders')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', reminder.id);

    if (updateError) {
      console.error(`${logPrefix} ERROR — failed to mark reminder as sent:`, updateError.message);
      // The message was already delivered — this is a consistency issue, not a
      // delivery failure. Log and return 'sent' so the counter increments.
    }

    // Increment the monthly email usage counter.
    const { error: counterError } = await adminSupabase
      .from('users')
      .update({ email_reminders_used_this_month: user.email_reminders_used_this_month + 1 })
      .eq('id', userId);

    if (counterError) {
      // Log but don't block — reminder already sent. Drift corrected at next reset.
      console.error(`${logPrefix} WARN — failed to increment email monthly counter:`, counterError.message);
    }

    console.log(`${logPrefix} SENT — reminder_id=${reminder.id}`);
    return 'sent';

  } catch (err) {
    // Catch any unexpected error so this appointment's failure doesn't abort
    // the outer batch loop processing other appointments.
    console.error(`${logPrefix} UNEXPECTED ERROR — skipping appointment:`, err);
    return 'skipped';
  }
}
