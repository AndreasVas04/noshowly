/**
 * lib/reminder-templates.ts
 *
 * Generates the HTML email body for appointment reminders.
 *
 * Key requirements:
 *  - Noshowly branding must be COMPLETELY INVISIBLE to the end client.
 *    The client sees only the salon's name — never "Noshowly".
 *  - Email uses big YES / NO buttons linking to the confirm endpoint.
 *  - All times are displayed in the salon's configured IANA timezone.
 *
 * Custom templates:
 *  - Salon owners can supply custom email_footer and other email field values stored
 *    on the salons row. All are optional; null falls back to the defaults
 *    exported from this module.
 *  - Supported template variables: {client_name}, {business_name}, {service},
 *    {time}, {date}.
 *  - Supported email footer variable: {business_name}.
 *
 * These templates are pure functions — they receive all data as parameters
 * and return a string. No database calls, no side effects.
 */

// ---------------------------------------------------------------------------
// Defaults — exported so the settings UI can show them as placeholders.
// ---------------------------------------------------------------------------

/**
 * Default email footer text used when no custom footer is set.
 */
export const DEFAULT_EMAIL_FOOTER =
  'If you have questions, contact {business_name} directly.';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Substitutes {variable} placeholders in a template string.
 * Unknown variables are left as-is so callers can see unrecognised ones.
 *
 * @param template - String containing {variable} placeholders.
 * @param vars     - Map of variable name → replacement value (raw, unescaped).
 * @returns         Template with all recognised variables replaced.
 */
function applyTemplate(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (t, [k, v]) => t.split(`{${k}}`).join(v),
    template
  );
}

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
 * Formats a UTC ISO timestamp into a readable date string in the given IANA
 * timezone, e.g. "Monday, April 7".
 *
 * Used to populate the {date} variable in custom SMS templates.
 *
 * @param datetime - UTC ISO timestamp.
 * @param timezone - IANA timezone identifier.
 * @returns         Date string like "Monday, April 7".
 */
function formatDate(datetime: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }).format(new Date(datetime));
  } catch {
    return new Date(datetime).toDateString();
  }
}

// ---------------------------------------------------------------------------
// Email subject helper
// ---------------------------------------------------------------------------

/**
 * Builds the email subject line for a reminder.
 *
 * If `customSubject` is provided it is used after {business_name} substitution.
 * If null/undefined the default subject is used.
 *
 * @param salonName     - The salon display name substituted into {business_name}.
 * @param customSubject - Optional custom subject template. Null → default.
 * @returns             Email subject string.
 */
export function getEmailSubject(
  salonName: string,
  customSubject?: string | null,
): string {
  const template = customSubject?.trim() ||
    'Reminder: Your appointment at {business_name} tomorrow';
  return applyTemplate(template, { business_name: salonName });
}

// ---------------------------------------------------------------------------
// Email template
// ---------------------------------------------------------------------------

/**
 * Builds the HTML email body sent to the client 48 hours before their
 * appointment.
 *
 * Design principles:
 *  - Salon name displayed prominently — Noshowly completely invisible.
 *  - Two large call-to-action buttons: YES (green) and NO (red), shown only when
 *    emailConfirmationEnabled is true (the default).
 *  - Inline CSS only — no external stylesheets (broad email client support).
 *  - Responsive-friendly: single-column layout, large tap targets.
 *  - The confirm/cancel URLs must be single-use tokens (enforced server-side).
 *
 * Custom email fields (all optional, null → application default):
 *  - emailFooter:   Footer text. Supports {business_name}.
 *  - emailGreeting: Greeting line. Supports all template variables.
 *  - emailBody:     Body paragraph. Supports all template variables.
 *  - emailClosing:  Closing shown when confirmation is disabled. Supports all template variables.
 *
 * Supported template variables: {client_name}, {business_name}, {service}, {time}, {date}.
 *
 * @param salonName                 - The salon display name shown in the email header.
 * @param clientName                - The client's first name (or full name).
 * @param serviceType               - The appointment service. Null → "appointment".
 * @param datetime                  - UTC ISO timestamp of the appointment.
 * @param timezone                  - IANA timezone for date/time display.
 * @param confirmUrl                - Full URL for the YES button (includes token + response=yes).
 * @param cancelUrl                 - Full URL for the NO button (includes token + response=no).
 * @param emailFooter               - Optional custom footer template. Null → DEFAULT_EMAIL_FOOTER.
 * @param emailConfirmationEnabled  - When false, YES/NO buttons are replaced with the closing line.
 * @param emailGreeting             - Optional custom greeting. Null → "Hi {client_name},".
 * @param emailBody                 - Optional custom body paragraph. Null → app default.
 * @param emailClosing              - Optional custom closing (no-confirmation mode). Null → app default.
 * @returns                         Complete HTML document string.
 */
export function getEmailHTML(
  salonName: string,
  clientName: string,
  serviceType: string | null,
  datetime: string,
  timezone: string,
  confirmUrl: string,
  cancelUrl: string,
  emailFooter?: string | null,
  emailConfirmationEnabled?: boolean,
  emailGreeting?: string | null,
  emailBody?: string | null,
  emailClosing?: string | null,
): string {
  const service = serviceType?.trim() || 'appointment';
  const time    = formatTime(datetime, timezone);
  const date    = formatDate(datetime, timezone);
  // Combined datetime string used in the appointment details box.
  const formattedDT = `${date} at ${time}`;

  // Template variables available in all customisable email fields.
  const templateVars: Record<string, string> = {
    client_name:   clientName,
    business_name: salonName,
    service,
    time,
    date,
  };

  // Resolve custom templates with variable substitution, then HTML-escape the results.
  const greetingTemplate = emailGreeting?.trim() || 'Hi {client_name},';
  const bodyTemplate     = emailBody?.trim()     || 'This is a reminder for your upcoming appointment.';
  const closingTemplate  = emailClosing?.trim()  || 'We look forward to seeing you.';
  const footerTemplate   = emailFooter?.trim()   || DEFAULT_EMAIL_FOOTER;

  const safeGreeting   = escapeHtml(applyTemplate(greetingTemplate, templateVars));
  const safeBody       = escapeHtml(applyTemplate(bodyTemplate, templateVars));
  const safeClosing    = escapeHtml(applyTemplate(closingTemplate, templateVars));
  const footerRaw      = applyTemplate(footerTemplate, { business_name: salonName });

  // Escape remaining user-supplied values that appear directly in the HTML.
  const safeSalonName = escapeHtml(salonName);
  const safeService   = escapeHtml(service);
  const safeDateTime  = escapeHtml(formattedDT);
  const safeFooter    = escapeHtml(footerRaw);

  // When confirmation is disabled, replace the YES/NO call-to-action with the
  // custom closing line so the client still receives a complete reminder.
  const showConfirmationButtons = emailConfirmationEnabled !== false;

  const ctaSection = showConfirmationButtons
    ? `<p style="margin:0 0 20px;font-size:16px;color:#3f3f46;">
                Please confirm or cancel your appointment below.
              </p>

              <!-- YES / NO confirmation buttons -->
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
              </table>`
    : `<p style="margin:0;font-size:16px;color:#3f3f46;">${safeClosing}</p>`;

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
              <p style="margin:0 0 8px;font-size:16px;color:#3f3f46;">${safeGreeting}</p>
              <p style="margin:0 0 24px;font-size:16px;color:#3f3f46;line-height:1.5;">
                ${safeBody}
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

              ${ctaSection}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #f4f4f5;">
              <p style="margin:0;font-size:13px;color:#a1a1aa;text-align:center;">
                ${safeFooter}
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
 * (salon name, client name, service type, footer text) into the email template.
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
