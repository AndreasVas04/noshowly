/**
 * lib/resend.ts
 *
 * Thin wrapper around the Resend API for sending transactional emails.
 *
 * Design rules:
 *  - Never throws — all errors are caught and returned as { success: false, error }.
 *  - Currently using Resend's shared onboarding@resend.dev sender (dev/staging).
 *    When noshowly.com is purchased, switch FROM_ADDRESS to reminders@noshowly.com
 *    and add Resend DNS records to the domain.
 *  - Email content should never mention "Noshowly" — the salon's name is the
 *    only brand the end client sees (see lib/reminder-templates.ts).
 *
 * Security: RESEND_API_KEY is a server-only env var. This file must never be
 * imported in Client Components.
 */

import { Resend } from 'resend';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The verified sending address used for all transactional emails.
 * Must match a domain verified in the Resend dashboard.
 *
 * Set RESEND_FROM_ADDRESS in environment variables to use your verified domain
 * (e.g. "reminders@noshowly.com"). Falls back to Resend's shared test sender
 * which can ONLY deliver to the Resend account holder's email — all other
 * recipients are silently rejected by the API.
 *
 * The display name is intentionally blank — salons want their own name shown,
 * which is handled via the email subject and body content.
 */
const FROM_ADDRESS = process.env.RESEND_FROM_ADDRESS || 'onboarding@resend.dev';

// Warn once at startup if using the shared test sender — makes it obvious in
// Vercel logs why emails don't arrive for non-account-holder recipients.
if (!process.env.RESEND_FROM_ADDRESS) {
  console.warn(
    '[resend] WARNING: RESEND_FROM_ADDRESS is not set. Using shared test sender ' +
    '"onboarding@resend.dev" which ONLY delivers to the Resend account holder\'s email. ' +
    'Set RESEND_FROM_ADDRESS to a verified domain (e.g. "Noshowly <reminders@noshowly.com>") ' +
    'in your environment variables for production email delivery.'
  );
}

const RESEND_API_KEY = process.env.RESEND_API_KEY;

// ---------------------------------------------------------------------------
// sendEmail
// ---------------------------------------------------------------------------

/**
 * Result type returned by sendEmail.
 * On success, `id` contains the Resend email ID for tracing.
 * On failure, `error` contains a human-readable message safe for server logs.
 */
export type EmailResult =
  | { success: true;  id: string }
  | { success: false; error: string };

/**
 * Sends a transactional email via Resend.
 *
 * Failures are caught and returned — this function never throws.
 *
 * @param to      - Recipient email address (e.g. "client@example.com").
 * @param subject - Email subject line. Should reference the salon name, not Noshowly.
 * @param html    - Full HTML body of the email.
 * @returns       EmailResult — { success: true, id } or { success: false, error }.
 *
 * @example
 * const result = await sendEmail(
 *   'client@example.com',
 *   'Reminder: Your appointment at Salon Elena',
 *   '<p>Hi Maria, your haircut is tomorrow at 10:00 AM.</p>'
 * );
 * if (!result.success) console.error('Email failed:', result.error);
 */
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
): Promise<EmailResult> {
  // Guard: check credential is configured before attempting any API call.
  if (!RESEND_API_KEY) {
    const msg =
      'Resend API key not configured. Set RESEND_API_KEY in environment variables.';
    console.error('[resend/sendEmail]', msg);
    return { success: false, error: msg };
  }

  try {
    const resend = new Resend(RESEND_API_KEY);

    const { data, error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to,
      subject,
      html,
    });

    if (error) {
      // Resend returned a structured API error (e.g. invalid address, rate limit).
      const errorMessage = (error as { message?: string }).message ?? 'Resend API error';
      console.error('[resend/sendEmail] API error:', errorMessage);
      return { success: false, error: errorMessage };
    }

    const emailId = data?.id ?? 'unknown';
    console.log(`[resend/sendEmail] sent id=${emailId} from=${FROM_ADDRESS}`);
    return { success: true, id: emailId };

  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : 'Unknown Resend error';
    console.error('[resend/sendEmail] unexpected error:', errorMessage);
    return { success: false, error: errorMessage };
  }
}
