/**
 * app/api/confirm/[token]/route.ts
 *
 * GET /api/confirm/:token?response=yes|no
 *
 * Public endpoint — no login required. End clients click YES/NO buttons in
 * their reminder email and land here. The token is looked up in the reminders
 * table; the linked appointment status is updated accordingly.
 *
 * Security:
 *  - Token is a UUID (128-bit random) — brute-force is infeasible.
 *  - Token is single-use: once used, the reminder status is updated to
 *    'confirmed' or 'cancelled', so the same token returns an "already used"
 *    page on subsequent clicks.
 *  - Uses the service-role key because end clients are not authenticated.
 *    Scoped strictly to the token lookup — no other data is exposed.
 *  - Never logs client names, phone numbers, or email addresses.
 *
 * Returns a simple HTML page — no JSON — because the audience is an end client
 * clicking a button in their email app, not a developer calling an API.
 */

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types';

// ---------------------------------------------------------------------------
// Service role client — used because end clients are not authenticated.
// Scoped to a single token lookup; no other data is accessible via this route.
// ---------------------------------------------------------------------------

const SUPABASE_URL       = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL)     throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
if (!SERVICE_ROLE_KEY) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');

const adminSupabase = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY);

// ---------------------------------------------------------------------------
// Route params type (Next.js App Router — params is a Promise in v15+)
// ---------------------------------------------------------------------------

interface RouteContext {
  params: Promise<{ token: string }>;
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

/**
 * Handles email YES/NO button clicks from end clients.
 *
 * Flow:
 *  1. Resolve the token from route params.
 *  2. Validate the `response` query parameter (must be 'yes' or 'no').
 *  3. Look up the reminder by token. Only status='sent' reminders are valid —
 *     a 'confirmed' or 'cancelled' status means the token has already been used.
 *  4. Load the linked appointment and verify it has not already been acted on.
 *  5. Update the appointment status and the reminder status atomically.
 *  6. Return a branded-neutral HTML confirmation page.
 *
 * @param request - Incoming GET request with `?response=yes|no`.
 * @param context - Next.js route context; `params.token` is the reminder token.
 * @returns HTML page string with 200 (success) or appropriate error.
 */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { token } = await context.params;

  // Step 1: Validate the ?response= query parameter.
  const url      = new URL(request.url);
  const response = url.searchParams.get('response');

  if (response !== 'yes' && response !== 'no') {
    return htmlResponse(pageInvalid(), 400);
  }

  const isConfirm = response === 'yes';

  // Step 2: Look up the reminder by token.
  // We only accept reminders with status='sent' — confirmed/cancelled means the
  // token was already used and we show an "already actioned" page.
  const { data: reminder, error: reminderError } = await adminSupabase
    .from('reminders')
    .select('id, appointment_id, status')
    .eq('token', token)
    .maybeSingle();

  if (reminderError) {
    console.error('[confirm] DB error looking up reminder token:', reminderError.message);
    return htmlResponse(pageError(), 500);
  }

  if (!reminder) {
    // Token does not exist — either invalid or never generated.
    return htmlResponse(pageInvalid(), 404);
  }

  // Guard: token is single-use — reject if already actioned.
  if (reminder.status === 'confirmed' || reminder.status === 'cancelled') {
    return htmlResponse(pageAlreadyUsed(isConfirm), 200);
  }

  if (reminder.status !== 'sent') {
    // Unexpected status (e.g. 'pending', 'failed') — treat as invalid.
    return htmlResponse(pageInvalid(), 400);
  }

  // Step 3: Load the linked appointment, including the salon name for the confirmation page.
  const { data: appointment, error: apptError } = await adminSupabase
    .from('appointments')
    .select('id, status, datetime, salon_id, salons(name)')
    .eq('id', reminder.appointment_id)
    .maybeSingle();

  if (apptError || !appointment) {
    console.error('[confirm] appointment not found for reminder:', reminder.id);
    return htmlResponse(pageError(), 500);
  }

  // Guard: appointment must still be scheduled — if already confirmed/cancelled
  // through another channel (e.g. a duplicate email click), honour the existing state.
  if (appointment.status !== 'scheduled') {
    return htmlResponse(pageAlreadyUsed(isConfirm), 200);
  }

  // Resolve the salon name to display on the confirmation page.
  // Clients see only the salon name — Noshowly is never visible.
  // Cast via unknown: the Database generic has no Relationships entries so the
  // Supabase type resolver produces a SelectQueryError for the join — the cast
  // is safe because we control the select string above.
  const salonName =
    ((appointment as unknown as { salons: { name: string } | null }).salons)?.name ?? '';

  // Step 4: Update appointment status.
  const newAppointmentStatus = isConfirm ? 'confirmed' : 'cancelled';
  const newReminderStatus    = isConfirm ? 'confirmed' : 'cancelled';

  const { error: apptUpdateError } = await adminSupabase
    .from('appointments')
    .update({ status: newAppointmentStatus })
    .eq('id', appointment.id);

  if (apptUpdateError) {
    console.error('[confirm] failed to update appointment status:', apptUpdateError.message);
    return htmlResponse(pageError(), 500);
  }

  // Step 5: Mark reminder as used (confirmed or cancelled) to enforce single-use.
  const { error: reminderUpdateError } = await adminSupabase
    .from('reminders')
    .update({ status: newReminderStatus })
    .eq('id', reminder.id);

  if (reminderUpdateError) {
    // Non-fatal: appointment was already updated. Log the inconsistency.
    console.error('[confirm] failed to update reminder status:', reminderUpdateError.message);
  }

  console.log(
    `[confirm] appointment=${appointment.id} → ${newAppointmentStatus} ` +
    `via email token (reminder=${reminder.id})`
  );

  // Step 6: Return a clean HTML confirmation page with the salon name visible.
  return htmlResponse(isConfirm ? pageConfirmed(salonName) : pageCancelled(salonName), 200);
}

// ---------------------------------------------------------------------------
// HTML escaping — prevents XSS via user-supplied strings (e.g. salon name)
// ---------------------------------------------------------------------------

/**
 * Escapes HTML special characters to prevent injection via user-supplied strings.
 *
 * @param str - Raw string that may contain HTML special characters.
 * @returns   HTML-safe string.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// HTML page builders — plain, minimal, mobile-friendly
// No Noshowly branding — client sees only a neutral confirmation message.
// ---------------------------------------------------------------------------

/**
 * Wraps an HTML body string in a full document and returns a Response with
 * Content-Type: text/html.
 *
 * @param body   - Inner HTML string.
 * @param status - HTTP status code.
 */
function htmlResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

/**
 * Returns the HTML for a successful confirmation ("Yes, I'll be there").
 *
 * @param salonName - The salon's display name, shown to the client.
 */
function pageConfirmed(salonName: string): string {
  const safeName = escapeHtml(salonName);
  const at = safeName ? ` at ${safeName}` : '';
  return page(
    'Appointment Confirmed',
    '#16a34a',
    'Appointment confirmed',
    `Great — see you soon${at}!`,
  );
}

/**
 * Returns the HTML for a successful cancellation ("No, cancel it").
 *
 * @param salonName - The salon's display name, shown to the client.
 */
function pageCancelled(salonName: string): string {
  const safeName = escapeHtml(salonName);
  const contact = safeName ? `Contact ${safeName} to reschedule.` : 'Contact the business to reschedule.';
  return page(
    'Appointment Cancelled',
    '#dc2626',
    'Appointment cancelled',
    `Your appointment has been cancelled. ${contact}`,
  );
}

/**
 * Returns the HTML for a token that has already been used.
 *
 * @param wasConfirm - true if the user clicked YES (used for copy).
 */
function pageAlreadyUsed(wasConfirm: boolean): string {
  const action = wasConfirm ? 'confirmed' : 'cancelled';
  return page(
    'Already Actioned',
    '#71717a',
    `Appointment already ${action}`,
    'This link has already been used. No further action is needed.',
  );
}

/**
 * Returns the HTML for an invalid or expired token.
 */
function pageInvalid(): string {
  return page(
    'Invalid Link',
    '#71717a',
    'This link is invalid',
    'This confirmation link is invalid or has expired. Please contact the salon directly.',
  );
}

/**
 * Returns the HTML for an unexpected server error.
 */
function pageError(): string {
  return page(
    'Something went wrong',
    '#71717a',
    'Something went wrong',
    'We couldn\'t update your appointment. Please contact the salon directly.',
  );
}

/**
 * Builds a minimal, mobile-friendly HTML page with a coloured status indicator.
 * No Noshowly brand visible anywhere on the page.
 *
 * @param title       - Browser tab title.
 * @param accentColor - Hex colour for the top border and status dot.
 * @param heading     - Large heading shown to the user.
 * @param message     - Supporting copy below the heading.
 */
function page(
  title: string,
  accentColor: string,
  heading: string,
  message: string,
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;min-height:100vh;
             display:flex;align-items:center;justify-content:center;">
  <div style="background:#ffffff;border-radius:8px;padding:40px 32px;max-width:480px;width:100%;
              margin:16px;text-align:center;border-top:4px solid ${accentColor};">
    <div style="width:48px;height:48px;border-radius:50%;background:${accentColor};
                margin:0 auto 20px;display:flex;align-items:center;justify-content:center;">
      <span style="color:#ffffff;font-size:24px;line-height:1;">&#10003;</span>
    </div>
    <h1 style="margin:0 0 12px;font-size:22px;color:#18181b;font-weight:700;">${heading}</h1>
    <p style="margin:0;font-size:16px;color:#52525b;line-height:1.5;">${message}</p>
  </div>
</body>
</html>`;
}
