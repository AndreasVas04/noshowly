/**
 * lib/reminder-templates.ts
 *
 * Generates the SMS text and HTML email body for appointment reminders.
 *
 * Key requirements (CLAUDE.md §7 + §12):
 *  - Noshowly branding must be COMPLETELY INVISIBLE to the end client.
 *    The client sees only the salon's name — never "Noshowly".
 *  - SMS must stay under 160 characters when possible (single SMS segment).
 *  - Email uses big YES / NO buttons linking to the confirm endpoint.
 *  - All times are displayed in the salon's configured IANA timezone.
 *
 * These templates are pure functions — they receive all data as parameters
 * and return a string. No database calls, no side effects.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Formats a UTC ISO timestamp into a human-readable time string in the given
 * IANA timezone (e.g. "America/New_York", "Europe/Nicosia").
 *
 * Uses the native Intl API — no external dependency needed.
 * Falls back to "UTC" if the timezone string is unrecognised.
 *
 * @param datetime - UTC ISO timestamp, e.g. "2026-04-07T10:00:00Z".
 * @param timezone - IANA timezone identifier, e.g. "America/New_York".
 * @returns         Time string like "10:00 AM" or "14:30".
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
    // Fallback if timezone string is invalid — show UTC time.
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(datetime));
  }
}

/**
 * Formats a UTC ISO timestamp into a readable date + time string in the given
 * IANA timezone, e.g. "Monday, April 7 at 10:00 AM".
 *
 * Used in the email body where more context than just the time is helpful.
 *
 * @param datetime - UTC ISO timestamp.
 * @param timezone - IANA timezone identifier.
 * @returns         Date-time string like "Monday, April 7 at 10:00 AM".
 */
function formatDateTime(datetime: string, timezone: string): string {
  try {
    const date = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }).format(new Date(datetime));

    const time = formatTime(datetime, timezone);
    return `${date} at ${time}`;
  } catch {
    return new Date(datetime).toUTCString();
  }
}

// ---------------------------------------------------------------------------
// SMS template
// ---------------------------------------------------------------------------

/**
 * Builds the SMS reminder text sent to the client 24 hours before their appointment.
 *
 * Format:
 *   "Hi [name], reminder from [salon]: your [service] is tomorrow at [time].
 *    Reply YES to confirm or NO to cancel. See you soon!"
 *
 * Noshowly is never mentioned — the salon's name or sms_sender_name is used.
 * Kept under 160 characters where possible (single SMS segment = lower cost).
 *
 * @param salonName   - The salon display name shown to the client.
 * @param clientName  - The client's first name (or full name).
 * @param serviceType - The appointment service, e.g. "Haircut". Null → "appointment".
 * @param datetime    - UTC ISO timestamp of the appointment.
 * @param timezone    - IANA timezone for the time display.
 * @returns           SMS body string.
 *
 * @example
 * getSMSTemplate('Salon Elena', 'Maria', 'Haircut', '2026-04-07T10:00:00Z', 'Europe/Nicosia')
 * // → "Hi Maria, reminder from Salon Elena: your Haircut is tomorrow at 10:00 AM.
 * //    Reply YES to confirm or NO to cancel. See you soon!"
 */
export function getSMSTemplate(
  salonName: string,
  clientName: string,
  serviceType: string | null,
  datetime: string,
  timezone: string,
): string {
  const service = serviceType?.trim() || 'appointment';
  const time    = formatTime(datetime, timezone);

  return (
    `Hi ${clientName}, reminder from ${salonName}: ` +
    `your ${service} is tomorrow at ${time}. ` +
    `Reply YES to confirm or NO to cancel. See you soon!`
  );
}

// ---------------------------------------------------------------------------
// Email template
// ---------------------------------------------------------------------------

/**
 * Builds the HTML email body sent to the client 48 hours before their appointment.
 *
 * Design principles:
 *  - Salon name displayed prominently — Noshowly completely invisible.
 *  - Two large call-to-action buttons: YES (green) and NO (red).
 *  - Inline CSS only — no external stylesheets (broad email client support).
 *  - Responsive-friendly: single-column layout, large tap targets.
 *  - The confirm/cancel URLs must be single-use tokens (enforced server-side).
 *
 * @param salonName   - The salon display name shown in the email header.
 * @param clientName  - The client's first name (or full name).
 * @param serviceType - The appointment service. Null → "appointment".
 * @param datetime    - UTC ISO timestamp of the appointment.
 * @param timezone    - IANA timezone for date/time display.
 * @param confirmUrl  - Full URL for the YES button (includes token + response=yes).
 * @param cancelUrl   - Full URL for the NO button (includes token + response=no).
 * @returns           Complete HTML document string.
 *
 * @example
 * getEmailHTML(
 *   'Salon Elena', 'Maria', 'Haircut',
 *   '2026-04-07T10:00:00Z', 'Europe/Nicosia',
 *   'https://noshowly.com/api/confirm/abc123?response=yes',
 *   'https://noshowly.com/api/confirm/abc123?response=no'
 * )
 */
export function getEmailHTML(
  salonName: string,
  clientName: string,
  serviceType: string | null,
  datetime: string,
  timezone: string,
  confirmUrl: string,
  cancelUrl: string,
): string {
  const service      = serviceType?.trim() || 'appointment';
  const formattedDT  = formatDateTime(datetime, timezone);

  // Escape HTML special characters to prevent any injection via user-supplied data.
  const safeSalonName  = escapeHtml(salonName);
  const safeClientName = escapeHtml(clientName);
  const safeService    = escapeHtml(service);
  const safeDateTime   = escapeHtml(formattedDT);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Appointment Reminder — ${safeSalonName}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="background:#18181b;padding:28px 32px;">
              <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">
                ${safeSalonName}
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 8px;font-size:16px;color:#3f3f46;">Hi ${safeClientName},</p>
              <p style="margin:0 0 24px;font-size:16px;color:#3f3f46;line-height:1.5;">
                This is a reminder for your upcoming appointment.
              </p>

              <!-- Appointment details box -->
              <table width="100%" cellpadding="0" cellspacing="0"
                style="background:#f4f4f5;border-radius:6px;margin-bottom:28px;">
                <tr>
                  <td style="padding:20px 24px;">
                    <p style="margin:0 0 6px;font-size:13px;font-weight:600;color:#71717a;
                               text-transform:uppercase;letter-spacing:0.5px;">Service</p>
                    <p style="margin:0 0 16px;font-size:16px;color:#18181b;font-weight:600;">
                      ${safeService}
                    </p>
                    <p style="margin:0 0 6px;font-size:13px;font-weight:600;color:#71717a;
                               text-transform:uppercase;letter-spacing:0.5px;">Date &amp; Time</p>
                    <p style="margin:0;font-size:16px;color:#18181b;font-weight:600;">
                      ${safeDateTime}
                    </p>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 20px;font-size:16px;color:#3f3f46;">
                Please confirm or cancel your appointment below.
              </p>

              <!-- CTA buttons -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="48%" align="center">
                    <a href="${confirmUrl}"
                       style="display:block;background:#16a34a;color:#ffffff;text-decoration:none;
                              font-size:17px;font-weight:700;padding:16px;border-radius:6px;
                              text-align:center;">
                      YES, I&apos;ll be there
                    </a>
                  </td>
                  <td width="4%"></td>
                  <td width="48%" align="center">
                    <a href="${cancelUrl}"
                       style="display:block;background:#dc2626;color:#ffffff;text-decoration:none;
                              font-size:17px;font-weight:700;padding:16px;border-radius:6px;
                              text-align:center;">
                      NO, cancel it
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #f4f4f5;">
              <p style="margin:0;font-size:13px;color:#a1a1aa;text-align:center;">
                If you have questions, contact ${safeSalonName} directly.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Internal utility
// ---------------------------------------------------------------------------

/**
 * Escapes HTML special characters to prevent injection via user-supplied strings
 * (salon name, client name, service type) into the email template.
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
