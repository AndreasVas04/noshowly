/**
 * lib/resend.ts
 *
 * Thin wrapper around the Resend API for sending transactional emails.
 * Appointment emails are sent through lib/reminders/gateway.ts, which applies
 * the plan, quota and sending limits first.
 *
 * Design rules:
 *  - Never throws — all errors are caught and returned as { success: false, error }.
 *  - The sender address is RESEND_FROM_ADDRESS (an address on a domain
 *    verified in Resend, e.g. "reminders@noshowly.com"; a "Name <address>"
 *    value also works, only the address is used). The sender name is the
 *    salon's name, e.g. "Salon Elena" <reminders@noshowly.com>. Without
 *    RESEND_FROM_ADDRESS, Resend's shared onboarding@resend.dev sender is
 *    used, which only delivers to the Resend account holder (dev/staging).
 *  - Email content should never mention "Noshowly" — the salon's name is the
 *    only brand the end client sees (see lib/reminder-templates.ts).
 *  - With an idempotency key (the reminders row id), Resend sends a request
 *    at most once, so temporary errors (rate limits, server and network
 *    errors) are retried once. Failures are classified (SendFailure) so the
 *    caller can tell an email Resend rejected from an account problem.
 *
 * Security: RESEND_API_KEY is a server-only env var. This file must never be
 * imported in Client Components.
 */

import { Resend } from 'resend';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Resend's shared test sender, used when RESEND_FROM_ADDRESS is not set. */
const DEFAULT_FROM_ADDRESS = 'onboarding@resend.dev';

/** Longest sender display name kept. */
const MAX_DISPLAY_NAME_LENGTH = 70;

/** Wait before the single retry. */
const RETRY_DELAY_MS = 1000;

/**
 * Resend errors about the account or the sender rather than one email: no
 * email can be sent until the configuration is fixed.
 */
const ACCOUNT_ERRORS = new Set([
  'missing_api_key',
  'invalid_api_key',
  'restricted_api_key',
  'invalid_access',
  'invalid_region',
  'daily_quota_exceeded',
  'monthly_quota_exceeded',
]);

/** Resend errors that a later attempt (with the same idempotency key) can fix. */
const TEMPORARY_ERRORS = new Set([
  'rate_limit_exceeded',
  'concurrent_idempotent_requests',
  'internal_server_error',
  'application_error',
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One email to send. */
export type SendEmailInput = {
  /** Recipient address. */
  to: string;
  subject: string;
  html: string;
  /** Plain-text alternative. */
  text?: string;
  /** Sender display name (the salon's name); sanitised here. */
  fromName?: string | null;
  /** Reply-To address (the salon owner's email). */
  replyTo?: string | null;
  /** Resend Idempotency-Key — the reminders row id. */
  idempotencyKey?: string;
};

/**
 * Why an email was not sent:
 *  - 'rejected'  — Resend refused this email as invalid (a 4xx validation
 *                  error, e.g. a recipient address it will not send to):
 *                  sending the same email again fails again;
 *  - 'account'   — the account or sender cannot send at all (missing or
 *                  invalid API key, unverified sender domain, account quota;
 *                  HTTP 401 or 403): every email fails until it is fixed;
 *  - 'temporary' — rate limits, server errors and network errors: a later
 *                  attempt may work.
 */
export type SendFailure = 'rejected' | 'account' | 'temporary';

/**
 * Result type returned by sendEmail.
 * On success, `id` contains the Resend email ID for tracing.
 * On failure, `error` contains a human-readable message safe for server logs,
 * and `failure` says whether trying again can help.
 */
export type EmailResult =
  | { success: true;  id: string }
  | { success: false; error: string; failure: SendFailure };

// ---------------------------------------------------------------------------
// Sender header
// ---------------------------------------------------------------------------

/** Returns true when RESEND_API_KEY is set. */
export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/**
 * Returns the bare address of a sender setting: "Name <a@b.com>" → "a@b.com".
 *
 * @param value - RESEND_FROM_ADDRESS value.
 */
export function extractEmailAddress(value: string): string {
  const match = /<([^<>\s]+@[^<>\s]+)>\s*$/.exec(value);
  return (match ? match[1] : value).trim();
}

/**
 * Makes a salon name safe as a quoted sender display name: removes control
 * characters (line breaks included) and invisible direction marks, removes the
 * characters that would end the quoted name or make it look like an address
 * (" \ < > @), collapses spaces and limits the length.
 *
 * @param name - Salon name.
 * @returns    Clean name; '' when nothing usable is left.
 */
export function sanitiseDisplayName(name: string | null | undefined): string {
  return (name ?? '')
    .replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/["\\<>@]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_DISPLAY_NAME_LENGTH)
    .trim();
}

/**
 * Builds the From header: '"Salon Elena" <reminders@noshowly.com>', or the
 * bare address when the name is empty after sanitising.
 *
 * @param displayName - Salon name.
 * @param fromSetting - RESEND_FROM_ADDRESS value (undefined → Resend's test sender).
 */
export function buildFromHeader(displayName: string | null | undefined, fromSetting: string | undefined): string {
  const address = extractEmailAddress(fromSetting?.trim() || DEFAULT_FROM_ADDRESS);
  const name = sanitiseDisplayName(displayName);
  return name ? `"${name}" <${address}>` : address;
}

/**
 * Classifies a Resend error (see SendFailure).
 *
 * @param error - Error name and HTTP status from the Resend SDK; statusCode is
 *                null when no response was received (network error).
 */
export function classifyResendError(error: { name?: string | null; statusCode?: number | null }): SendFailure {
  const status = typeof error.statusCode === 'number' ? error.statusCode : null;
  if ((error.name && ACCOUNT_ERRORS.has(error.name)) || status === 401 || status === 403) {
    return 'account';
  }
  if ((error.name && TEMPORARY_ERRORS.has(error.name)) || status === null || status === 429 || status >= 500) {
    return 'temporary';
  }
  return status >= 400 ? 'rejected' : 'temporary';
}

/** Resolves after `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// sendEmail
// ---------------------------------------------------------------------------

/** Set once the missing-sender warning has been logged. */
let warnedAboutTestSender = false;

/**
 * Sends a transactional email via Resend.
 *
 * Failures are caught and returned — this function never throws.
 *
 * @param input - Recipient, content, sender name, reply-to and idempotency key.
 * @returns     EmailResult — { success: true, id } or { success: false, error, failure }.
 *
 * @example
 * const result = await sendEmail({
 *   to: 'client@example.com',
 *   subject: 'Reminder: Your appointment at Salon Elena on Tuesday 6 October at 10:00',
 *   html: '<p>…</p>',
 *   text: '…',
 *   fromName: 'Salon Elena',
 *   replyTo: 'owner@salon-elena.com',
 *   idempotencyKey: reminderId,
 * });
 * if (!result.success) console.error('Email failed:', result.error);
 */
export async function sendEmail(input: SendEmailInput): Promise<EmailResult> {
  // Guard: check credential is configured before attempting any API call.
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    const msg =
      'Resend API key not configured. Set RESEND_API_KEY in environment variables.';
    console.error('[resend/sendEmail]', msg);
    return { success: false, error: msg, failure: 'account' };
  }

  const fromSetting = process.env.RESEND_FROM_ADDRESS;
  if (!fromSetting && !warnedAboutTestSender) {
    // Makes it obvious in Vercel logs why emails don't arrive for other recipients.
    warnedAboutTestSender = true;
    console.warn(
      '[resend] WARNING: RESEND_FROM_ADDRESS is not set. Using shared test sender ' +
      '"onboarding@resend.dev" which ONLY delivers to the Resend account holder\'s email. ' +
      'Set RESEND_FROM_ADDRESS to an address on a verified domain (e.g. "reminders@noshowly.com") ' +
      'in your environment variables for production email delivery.'
    );
  }

  const resend = new Resend(apiKey);
  const from = buildFromHeader(input.fromName, fromSetting);
  const payload = {
    from,
    to: input.to,
    subject: input.subject,
    html: input.html,
    ...(input.text ? { text: input.text } : {}),
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
  };
  const options = input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined;

  // A retry is only safe when Resend can recognise it as the same request.
  const attempts = input.idempotencyKey ? 2 : 1;
  let lastError = 'Unknown Resend error';
  let failure: SendFailure = 'temporary';

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const { data, error } = await resend.emails.send(payload, options);

      if (!error) {
        const emailId = data?.id ?? 'unknown';
        console.log(`[resend/sendEmail] sent id=${emailId}`);
        return { success: true, id: emailId };
      }

      // Resend returned a structured API error (e.g. invalid address, rate limit).
      lastError = error.message || 'Resend API error';
      failure = classifyResendError(error);
      console.error(`[resend/sendEmail] API error (${error.name}, ${error.statusCode ?? 'no status'}, ${failure}):`, lastError);
      if (failure !== 'temporary') break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Unknown Resend error';
      failure = 'temporary';
      console.error('[resend/sendEmail] unexpected error:', lastError);
    }
    if (attempt < attempts) await sleep(RETRY_DELAY_MS);
  }

  return { success: false, error: lastError, failure };
}
