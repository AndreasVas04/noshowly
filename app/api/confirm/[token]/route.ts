/**
 * app/api/confirm/[token]/route.ts
 *
 * GET  /api/confirm/:token[?response=yes|no]
 *   Shows the appointment behind an email link: salon, service, date and time
 *   in the salon's timezone and its real, current status, with Confirm and
 *   Cancel buttons. Changes nothing — mail scanners and link previews open
 *   links in emails, sometimes before the client does. `response` only
 *   decides which button the page highlights.
 *
 * POST /api/confirm/:token   (form field action=confirm|cancel)
 *   Confirms or cancels the appointment, only while it is 'scheduled':
 *   confirm → 'confirmed', cancel → 'cancelled', with a conditional update,
 *   then marks the reminder row the same way and shows the resulting status.
 *
 * Public endpoint — no login required. Links come from the YES/NO buttons of
 * 24-hour reminders ('email') and booking confirmations ('email_confirmation').
 * Links of test emails ('email_test') show a preview and never change
 * anything. After the appointment time a link has expired; for a cancelled
 * appointment it only shows that; after a reschedule the old links no longer
 * work (see lib/confirm-page.ts).
 *
 * Security:
 *  - Token is a UUID (128-bit random) — brute-force is infeasible.
 *  - Uses the service-role key because end clients are not authenticated.
 *    Scoped strictly to the token's reminder and its appointment.
 *  - Every interpolated value is HTML-escaped. Responses are never cached or
 *    indexed (Cache-Control: no-store, X-Robots-Tag: noindex).
 *  - Never logs client names, phone numbers, or email addresses.
 *
 * Returns HTML pages — no JSON — because the audience is an end client
 * clicking a button in their email app, not a developer calling an API.
 */

import { createAdminSupabaseClient, type AdminSupabaseClient } from '@/lib/supabase/admin';
import {
  confirmPageStatus,
  parseLinkAction,
  renderConfirmPage,
  resolveLinkState,
  type ConfirmPageView,
  type PageAppointment,
  type PostOutcome,
} from '@/lib/confirm-page';
import type { AppointmentStatus, ReminderStatus } from '@/types';

// ---------------------------------------------------------------------------
// Route params type (Next.js App Router — params is a Promise in v15+)
// ---------------------------------------------------------------------------

interface RouteContext {
  params: Promise<{ token: string }>;
}

/** Tokens are UUIDs; anything else is rejected before reaching the database. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

// ---------------------------------------------------------------------------
// Link lookup
// ---------------------------------------------------------------------------

/** A token's reminder row and appointment, as read now. */
type LinkRecord = {
  reminder: { id: string; type: string; status: string; appointment_id: string };
  appointment: { id: string; status: string; datetime: string; page: PageAppointment } | null;
};

/**
 * Loads the reminder row with this token and its appointment.
 *
 * @param db    - Service-role client.
 * @param token - Token from the URL (already format-checked).
 * @returns     The link, or null for an unknown token.
 * @throws Error on a database error.
 */
async function loadLink(db: AdminSupabaseClient, token: string): Promise<LinkRecord | null> {
  const { data: reminder, error: reminderError } = await db
    .from('reminders')
    .select('id, type, status, appointment_id')
    .eq('token', token)
    .maybeSingle();

  if (reminderError) throw new Error(`Reminder token lookup failed: ${reminderError.message}`);
  if (!reminder) return null;

  const { data: row, error: apptError } = await db
    .from('appointments')
    .select('id, status, datetime, service_type, salons (name, timezone)')
    .eq('id', reminder.appointment_id)
    .maybeSingle();

  if (apptError) throw new Error(`Appointment lookup failed: ${apptError.message}`);
  if (!row) return { reminder, appointment: null };

  // Cast via unknown: the Database generic has no Relationships entries, so
  // the Supabase types cannot resolve the join; the foreign key exists.
  const appt = row as unknown as {
    id: string;
    status: string;
    datetime: string;
    service_type: string | null;
    salons: { name: string | null; timezone: string | null } | null;
  };

  return {
    reminder,
    appointment: {
      id:       appt.id,
      status:   appt.status,
      datetime: appt.datetime,
      page: {
        salonName:   appt.salons?.name ?? '',
        serviceType: appt.service_type,
        datetime:    appt.datetime,
        timeZone:    appt.salons?.timezone ?? 'UTC',
        status:      appt.status,
      },
    },
  };
}

/**
 * Builds the page for a link as it is now.
 *
 * @param link    - The link (null: unknown token).
 * @param token   - The token (for the form action).
 * @param now     - Current instant.
 * @param extra   - Intent from the email button, or the outcome of a POST.
 */
function viewFor(
  link: LinkRecord | null,
  token: string,
  now: Date,
  extra: Pick<ConfirmPageView, 'intent' | 'outcome'> = {},
): ConfirmPageView {
  const state = resolveLinkState(link?.reminder ?? null, link?.appointment ?? null, now);
  return {
    state,
    appointment: state === 'invalid' ? null : link?.appointment?.page ?? null,
    actionPath:  `/api/confirm/${encodeURIComponent(token)}`,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// GET — show the appointment (never changes anything)
// ---------------------------------------------------------------------------

/**
 * Shows the appointment behind a confirmation link.
 *
 * Flow:
 *  1. Validate the token format.
 *  2. Look up the reminder by token, and its appointment.
 *  3. Render the page for the link's current state.
 *
 * @param request - Incoming GET request, optionally with `?response=yes|no`.
 * @param context - Next.js route context; `params.token` is the reminder token.
 * @returns HTML page: 200, 404 (invalid), 410 (expired or retired) or 500.
 */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { token } = await context.params;

  // Step 1: Reject malformed tokens without a database call.
  if (!TOKEN_PATTERN.test(token)) return page({ state: 'invalid' });

  const intent = parseLinkAction(new URL(request.url).searchParams.get('response'));

  // Step 2: Look up the link.
  let link: LinkRecord | null;
  try {
    link = await loadLink(createAdminSupabaseClient(), token);
  } catch (err) {
    console.error('[confirm] GET lookup failed:', err instanceof Error ? err.message : err);
    return page({ state: 'error' });
  }

  // Step 3: Show it as it is now.
  return page(viewFor(link, token, new Date(), { intent }));
}

// ---------------------------------------------------------------------------
// POST — confirm or cancel
// ---------------------------------------------------------------------------

/**
 * Confirms or cancels the appointment behind a confirmation link.
 *
 * Flow:
 *  1. Validate the token format and the submitted action.
 *  2. Look up the link; anything but a 'scheduled', upcoming appointment is
 *     shown as it is, unchanged.
 *  3. Update the appointment only while it is still 'scheduled', still at the
 *     time that was read, and has not started (conditional update).
 *  4. Mark the reminder row 'confirmed' or 'cancelled'.
 *  5. Show the appointment's resulting real status.
 *
 * @param request - Form POST with `action=confirm|cancel`.
 * @param context - Next.js route context; `params.token` is the reminder token.
 * @returns HTML page: 200, 400 (bad request), 404, 410 or 500.
 */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { token } = await context.params;

  // Step 1: Validate the token and the action.
  if (!TOKEN_PATTERN.test(token)) return page({ state: 'invalid' });

  let action: ReturnType<typeof parseLinkAction> = null;
  try {
    const form = await request.formData();
    action = parseLinkAction(form.get('action') ?? form.get('response'));
  } catch {
    action = null;
  }
  if (!action) return page({ state: 'bad_request' });

  try {
    const db  = createAdminSupabaseClient();
    const now = new Date();

    // Step 2: Look up the link. Only a 'scheduled', upcoming appointment can change.
    const link = await loadLink(db, token);
    const view = viewFor(link, token, now);
    if (view.state !== 'actionable' || !link?.appointment) {
      return page({ ...view, outcome: 'unchanged' });
    }

    // Step 3: Conditional update — only from 'scheduled', and only if the
    // appointment was not moved since it was read.
    const newStatus: Extract<AppointmentStatus, 'confirmed' | 'cancelled'> =
      action === 'confirm' ? 'confirmed' : 'cancelled';
    const { data: updated, error: updateError } = await db
      .from('appointments')
      .update({ status: newStatus })
      .eq('id', link.appointment.id)
      .eq('status', 'scheduled')
      .eq('datetime', link.appointment.datetime)
      .gt('datetime', now.toISOString())
      .select('id');

    if (updateError) throw new Error(`Appointment update failed: ${updateError.message}`);
    const changed = (updated ?? []).length > 0;

    // Step 4: Mark the reminder row as used for this answer.
    if (changed) {
      const reminderStatus: ReminderStatus = newStatus;
      const { error: reminderUpdateError } = await db
        .from('reminders')
        .update({ status: reminderStatus })
        .eq('id', link.reminder.id)
        .in('status', ['pending', 'sent', 'confirmed']);

      if (reminderUpdateError) {
        // Non-fatal: the appointment was already updated. Log the inconsistency.
        console.error('[confirm] failed to update reminder status:', reminderUpdateError.message);
      }
      console.log(
        `[confirm] appointment=${link.appointment.id} → ${newStatus} ` +
        `via email link (reminder=${link.reminder.id})`,
      );
    }

    // Step 5: Show the real status now (re-read, whatever happened).
    const current = await loadLink(db, token);
    const outcome: PostOutcome = changed ? newStatus : 'unchanged';
    return page(viewFor(current, token, new Date(), { outcome }));

  } catch (err) {
    console.error('[confirm] POST failed:', err instanceof Error ? err.message : err);
    return page({ state: 'error' });
  }
}

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

/**
 * Renders a page as an HTML response that is never cached or indexed and
 * cannot be framed.
 *
 * @param view - What to show.
 */
function page(view: ConfirmPageView): Response {
  return new Response(renderConfirmPage(view), {
    status: confirmPageStatus(view),
    headers: {
      'Content-Type':            'text/html; charset=utf-8',
      'Cache-Control':           'no-store',
      'X-Robots-Tag':            'noindex, nofollow',
      'Referrer-Policy':         'no-referrer',
      'X-Frame-Options':         'DENY',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    },
  });
}
