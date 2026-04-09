/**
 * app/api/webhooks/twilio/route.ts
 *
 * POST /api/webhooks/twilio
 *
 * Receives incoming SMS replies (YES / NO) from end clients via Twilio.
 * Validates the Twilio signature, parses the reply, finds the most recent
 * upcoming scheduled appointment for the client's phone number, and updates
 * the appointment status accordingly.
 *
 * Configure in Twilio console:
 *   Phone Number → Messaging → "A message comes in" →
 *   Webhook: POST https://noshowly.com/api/webhooks/twilio
 *
 * Security (CLAUDE.md §10):
 *  - Validates the X-Twilio-Signature header using HMAC-SHA1 to reject
 *    any request not originating from Twilio. Prevents fake webhook calls.
 *  - Uses the service-role key to find appointments across all salons
 *    (public endpoint — end clients are not authenticated).
 *  - Never logs client phone numbers, email addresses, or message content.
 *
 * Response: TwiML XML (Twilio's required format for auto-reply SMS).
 */

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import type { Database } from '@/types';

// ---------------------------------------------------------------------------
// Service role client — end clients are not authenticated.
// Used only for phone-number-scoped appointment lookups.
// ---------------------------------------------------------------------------

const SUPABASE_URL     = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;

if (!SUPABASE_URL)     throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
if (!SERVICE_ROLE_KEY) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');

const adminSupabase = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY);

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

/**
 * Handles an inbound SMS from a client replying YES or NO to their reminder.
 *
 * Flow:
 *  1. Validate Twilio signature — reject if invalid.
 *  2. Parse the From (client phone) and Body (reply text) from the form body.
 *  3. Normalise the reply: YES/Y/1 → 'confirmed', NO/N/2 → 'cancelled'.
 *     Unknown replies get a polite help response.
 *  4. Find the most recent upcoming scheduled appointment for that phone
 *     number within the next 48 hours.
 *  5. Update the appointment status.
 *  6. Reply with a TwiML <Message> so the client receives a confirmation SMS.
 *
 * @param request - Incoming POST from Twilio (application/x-www-form-urlencoded).
 * @returns TwiML XML response with Content-Type: text/xml.
 */
export async function POST(request: Request): Promise<Response> {
  // Step 1: Validate the Twilio signature.
  // This prevents anyone from faking a Twilio webhook call to our endpoint.
  // Reject before reading the body to avoid processing forged requests.
  if (!TWILIO_AUTH_TOKEN) {
    console.error('[webhooks/twilio] TWILIO_AUTH_TOKEN not set — cannot validate signature');
    return twiml('<Message>Service unavailable.</Message>', 503);
  }

  const signature = request.headers.get('X-Twilio-Signature') ?? '';

  // We need the raw body text to validate the signature, then parse it.
  const rawBody = await request.text();
  const params  = Object.fromEntries(new URLSearchParams(rawBody).entries());

  // Twilio signs the full URL. Use NEXT_PUBLIC_APP_URL to reconstruct it.
  const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/api/webhooks/twilio`;

  if (!isValidTwilioSignature(TWILIO_AUTH_TOKEN, signature, webhookUrl, params)) {
    // Security: log the rejection but do not reveal why to the caller.
    console.warn('[webhooks/twilio] invalid Twilio signature — request rejected');
    return new Response('Forbidden', { status: 403 });
  }

  // Step 2: Extract From (client phone) and Body (reply text).
  const fromPhone = params['From'];
  const replyText = params['Body'];

  if (!fromPhone || !replyText) {
    console.warn('[webhooks/twilio] missing From or Body — ignoring');
    return twiml('<Message>Sorry, we could not process your reply.</Message>', 200);
  }

  // Step 3: Normalise the reply.
  // YES/Y/1 → confirmed; NO/N/2 → cancelled; anything else → unknown.
  const normalised = normaliseReply(replyText);

  if (normalised === 'unknown') {
    return twiml(
      '<Message>Reply YES to confirm your appointment or NO to cancel it.</Message>',
      200,
    );
  }

  // Step 4: Find the most recent upcoming scheduled appointment for this phone.
  // Strategy: look up the client records with this phone number, then find
  // the earliest upcoming scheduled appointment in the next 48 hours.
  // 48 h covers both the SMS window (24 h before) and a comfortable buffer.
  const now      = new Date();
  const plus48h  = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();
  const nowISO   = now.toISOString();

  // Find client records that have this phone number (may span multiple salons).
  const { data: clients, error: clientsError } = await adminSupabase
    .from('clients')
    .select('id')
    .eq('phone', fromPhone);

  if (clientsError) {
    console.error('[webhooks/twilio] DB error fetching clients:', clientsError.message);
    return twiml('<Message>Sorry, we could not process your reply. Please contact the salon.</Message>', 200);
  }

  if (!clients || clients.length === 0) {
    // Phone number not on file — could be a wrong number or unregistered client.
    console.log('[webhooks/twilio] no client found for received phone (last 4 hidden)');
    return twiml(
      '<Message>We could not find an appointment for your number. Please contact the salon directly.</Message>',
      200,
    );
  }

  const clientIds = clients.map((c) => c.id);

  // Find the earliest upcoming scheduled appointment for any of these clients.
  const { data: appointments, error: apptsError } = await adminSupabase
    .from('appointments')
    .select('id, datetime, salon_id, salons(name, sms_sender_name, timezone, user_id)')
    .in('client_id', clientIds)
    .eq('status', 'scheduled')
    .gt('datetime', nowISO)
    .lte('datetime', plus48h)
    .order('datetime', { ascending: true })
    .limit(1);

  if (apptsError) {
    console.error('[webhooks/twilio] DB error fetching appointments:', apptsError.message);
    return twiml('<Message>Sorry, we could not process your reply. Please contact the salon.</Message>', 200);
  }

  if (!appointments || appointments.length === 0) {
    return twiml(
      '<Message>We could not find an upcoming appointment for your number. Please contact the salon directly.</Message>',
      200,
    );
  }

  const appointment = appointments[0] as typeof appointments[0] & {
    salons: { name: string; sms_sender_name: string | null; timezone: string; user_id: string } | null;
  };

  // Step 5: Update the appointment status.
  const newStatus = normalised === 'yes' ? 'confirmed' : 'cancelled';

  const { error: updateError } = await adminSupabase
    .from('appointments')
    .update({ status: newStatus })
    .eq('id', appointment.id);

  if (updateError) {
    console.error('[webhooks/twilio] failed to update appointment:', updateError.message);
    return twiml('<Message>Sorry, we could not update your appointment. Please contact the salon.</Message>', 200);
  }

  // Log — appointment ID and salon name only, never the client's phone number.
  const salonName = (appointment.salons as { name: string } | null)?.name ?? 'unknown';
  console.log(
    `[webhooks/twilio] appointment=${appointment.id} → ${newStatus} ` +
    `via SMS reply (salon="${salonName}")`
  );

  // Increment the salon owner's monthly reminder usage counter.
  // The auto-reply SMS counts as an outbound message against the plan cap.
  // Non-fatal: counter drift is corrected at the next monthly reset.
  const userId = (appointment.salons as { user_id: string } | null)?.user_id;
  if (userId) {
    const { data: userRecord } = await adminSupabase
      .from('users')
      .select('reminders_used_this_month')
      .eq('id', userId)
      .single();

    if (userRecord) {
      const { error: counterError } = await adminSupabase
        .from('users')
        .update({ reminders_used_this_month: userRecord.reminders_used_this_month + 1 })
        .eq('id', userId);

      if (counterError) {
        console.error('[webhooks/twilio] WARN — failed to increment monthly counter:', counterError.message);
      }
    }
  }

  // Step 6: Reply with a TwiML auto-response.
  // Prefer the SMS-specific sender name; fall back to the salon's display name.
  const salonDisplayName =
    (appointment.salons as { sms_sender_name: string | null } | null)?.sms_sender_name ?? salonName;

  const timezone = (appointment.salons as { timezone: string } | null)?.timezone ?? 'UTC';
  const timeStr  = formatTime(appointment.datetime, timezone);

  const replyMessage = normalised === 'yes'
    ? `Great, see you at ${timeStr}! — ${salonDisplayName}`
    : `No problem, your appointment has been cancelled. Call us to reschedule. — ${salonDisplayName}`;

  return twiml(`<Message>${escapeXml(replyMessage)}</Message>`, 200);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Validates a Twilio webhook request using HMAC-SHA1.
 *
 * Algorithm (per Twilio docs):
 *  1. Take the full URL of the webhook endpoint.
 *  2. Sort POST params alphabetically and concatenate key + value.
 *  3. Append the concatenated params to the URL.
 *  4. Compute HMAC-SHA1 of the resulting string using the auth token as key.
 *  5. Base64-encode the result and compare with the X-Twilio-Signature header.
 *
 * Uses timing-safe comparison to prevent timing attacks.
 *
 * @param authToken  - Twilio account auth token.
 * @param signature  - Value of the X-Twilio-Signature request header.
 * @param url        - The full URL Twilio sent the request to.
 * @param params     - Parsed POST body parameters as a key-value object.
 * @returns          true if the signature is valid.
 *
 * @see https://www.twilio.com/docs/usage/security#validating-signatures-from-twilio
 */
function isValidTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>,
): boolean {
  if (!signature) return false;

  // Sort params alphabetically and concatenate key+value (no delimiters).
  const sortedKeys  = Object.keys(params).sort();
  const paramString = sortedKeys.map((k) => k + params[k]).join('');
  const toSign      = url + paramString;

  const expected = crypto
    .createHmac('sha1', authToken)
    .update(toSign, 'utf8')
    .digest('base64');

  // Timing-safe comparison — prevents timing-based signature forgery.
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected),
    );
  } catch {
    // Buffer lengths differ — signature is definitely wrong.
    return false;
  }
}

/**
 * Normalises the client's SMS reply text into a canonical action.
 *
 * Accepted inputs (case-insensitive, extra whitespace stripped):
 *  YES / Y / 1 → 'yes'
 *  NO  / N / 2 → 'no'
 *  Anything else → 'unknown'
 *
 * @param text - Raw SMS body from the client.
 * @returns    'yes' | 'no' | 'unknown'
 */
function normaliseReply(text: string): 'yes' | 'no' | 'unknown' {
  const cleaned = text.trim().toLowerCase();
  if (cleaned === 'yes' || cleaned === 'y' || cleaned === '1') return 'yes';
  if (cleaned === 'no'  || cleaned === 'n' || cleaned === '2') return 'no';
  return 'unknown';
}

/**
 * Formats a UTC ISO timestamp into a short time string in the given IANA timezone.
 *
 * @param datetime - UTC ISO timestamp.
 * @param timezone - IANA timezone identifier.
 * @returns        Time string like "10:00 AM".
 */
function formatTime(datetime: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(datetime));
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(datetime));
  }
}

/**
 * Escapes XML special characters in a string before embedding in TwiML.
 * Prevents injection if salon name or time string contains < > & ' "
 *
 * @param str - Raw string.
 * @returns   XML-safe string.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Builds a TwiML XML Response containing one <Message> element and returns it
 * as a Response with Content-Type: text/xml.
 *
 * Twilio requires this exact content type to process the auto-reply.
 *
 * @param messageElement - A full <Message>...</Message> element string.
 * @param status         - HTTP status code (200 for all Twilio webhook replies).
 * @returns              Response with text/xml content type.
 */
function twiml(messageElement: string, status: number): Response {
  const body = `<?xml version="1.0" encoding="UTF-8"?><Response>${messageElement}</Response>`;
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  });
}
