/**
 * lib/twilio.ts
 *
 * Thin wrapper around the Twilio REST API for sending outbound SMS messages.
 *
 * Design rules:
 *  - Never throws — all errors are caught and returned as { success: false, error }.
 *  - Logs only the last 4 digits of the destination phone number (GDPR/privacy).
 *  - Initialises a fresh Twilio client per call to avoid stale credentials in
 *    long-running Vercel function instances.
 *
 * Security: TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are server-only env vars.
 * This file must never be imported in Client Components.
 */

import twilio from 'twilio';

// ---------------------------------------------------------------------------
// Credential assertions — fail fast at module load time on the server so a
// misconfigured deployment is caught immediately, not on the first send.
// These are intentionally NOT thrown here (module-level throw breaks Next.js
// build-time analysis). Instead, sendSMS() checks them at call time.
// ---------------------------------------------------------------------------

const ACCOUNT_SID   = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN    = process.env.TWILIO_AUTH_TOKEN;
const FROM_NUMBER   = process.env.TWILIO_PHONE_NUMBER;

// ---------------------------------------------------------------------------
// sendSMS
// ---------------------------------------------------------------------------

/**
 * Result type returned by sendSMS.
 * On success, `sid` contains the Twilio MessageSid for tracing.
 * On failure, `error` contains a human-readable message safe for server logs.
 */
export type SMSResult =
  | { success: true;  sid: string }
  | { success: false; error: string };

/**
 * Sends an outbound SMS via Twilio.
 *
 * Failures are caught and returned — this function never throws.
 * Only the last 4 digits of the destination number are logged to protect PII.
 *
 * @param to   - E.164 formatted phone number (e.g. "+13015550100").
 *               Must start with '+' and include a country code.
 * @param body - SMS body text. Keep under 160 characters for a single segment.
 *               Longer messages are split by carriers and may cost more.
 * @returns    SMSResult — { success: true, sid } or { success: false, error }.
 *
 * @example
 * const result = await sendSMS('+13015550100', 'Hi, your appointment is tomorrow at 10:00 AM.');
 * if (!result.success) console.error('SMS failed:', result.error);
 */
export async function sendSMS(to: string, body: string): Promise<SMSResult> {
  // Guard: check credentials are configured before attempting any API call.
  // Returning an error here prevents a confusing Twilio SDK crash downstream.
  if (!ACCOUNT_SID || !AUTH_TOKEN || !FROM_NUMBER) {
    const msg =
      'Twilio credentials not configured. Set TWILIO_ACCOUNT_SID, ' +
      'TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in environment variables.';
    console.error('[twilio/sendSMS]', msg);
    return { success: false, error: msg };
  }

  // Mask the destination for logging — log only last 4 digits to protect PII.
  const maskedTo = `****${to.slice(-4)}`;

  try {
    const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

    const message = await client.messages.create({
      from: FROM_NUMBER,
      to,
      body,
    });

    console.log(`[twilio/sendSMS] sent to=${maskedTo} sid=${message.sid}`);
    return { success: true, sid: message.sid };

  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : 'Unknown Twilio error';
    console.error(`[twilio/sendSMS] failed to=${maskedTo}:`, errorMessage);
    return { success: false, error: errorMessage };
  }
}
