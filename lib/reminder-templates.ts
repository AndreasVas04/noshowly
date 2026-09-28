/**
 * lib/reminder-templates.ts
 *
 * Subject, HTML body and plain-text body of every appointment email:
 *  - the 24-hour reminder, with YES/NO buttons, customisable in Settings;
 *  - the booking confirmation: YES/NO buttons for dashboard bookings, a plain
 *    "you're booked" notice for public bookings;
 *  - the test email: the reminder, clearly marked as a test.
 *
 * Key requirements:
 *  - Noshowly branding must be COMPLETELY INVISIBLE to the end client.
 *    The client sees only the salon's name — never "Noshowly".
 *  - Dates and times are shown in the salon's IANA timezone using lib/time.ts,
 *    e.g. "Tuesday 6 October" and "10:00", never as "tomorrow": an email is
 *    not always read, or even sent, the day before.
 *  - Every interpolated value is HTML-escaped in the HTML body.
 *  - Placeholders are substituted in a single pass, so a value that looks like
 *    a placeholder (a client named "{date}") is shown exactly as typed.
 *
 * Custom templates:
 *  - Salon owners can supply custom email_subject, email_greeting, email_body,
 *    email_closing and email_footer values stored on the salons row. All are
 *    optional; null falls back to the defaults exported from this module.
 *  - Supported template variables: {client_name}, {business_name}, {service},
 *    {time}, {date}. The footer supports {business_name} only.
 *  - Custom fields apply to the 24-hour reminder (and its test send). The
 *    booking confirmation uses the custom greeting and footer with fixed copy,
 *    because custom reminder text often says "tomorrow".
 *
 * These templates are pure functions — they receive all data as parameters
 * and return strings. No database calls, no side effects.
 */

import { formatDateOnly, formatTimeInZone, resolveTimeZone, utcToZonedParts } from '@/lib/time';

// ---------------------------------------------------------------------------
// Defaults — exported so the settings UI can show them as placeholders.
// ---------------------------------------------------------------------------

/** Default email footer text used when no custom footer is set. */
export const DEFAULT_EMAIL_FOOTER =
  'If you have questions, contact {business_name} directly.';

/** Default subject of the 24-hour reminder. */
export const DEFAULT_EMAIL_SUBJECT =
  'Reminder: Your appointment at {business_name} on {date} at {time}';

/** Default greeting line of every email. */
export const DEFAULT_EMAIL_GREETING = 'Hi {client_name},';

/** Default body paragraph of the 24-hour reminder. */
export const DEFAULT_EMAIL_BODY = 'This is a reminder for your upcoming appointment.';

/** Default closing of the 24-hour reminder, shown when it has no YES/NO buttons. */
export const DEFAULT_EMAIL_CLOSING = 'We look forward to seeing you.';

// Fixed copy of the booking confirmation (not customisable).
const CONFIRMATION_SUBJECT = 'Please confirm your appointment on {date} at {time}';
const CONFIRMATION_BODY    = 'Your appointment at {business_name} is booked for {date} at {time}.';
const BOOKED_SUBJECT       = 'Appointment booked at {business_name} on {date} at {time}';
const BOOKED_BODY          = 'Your appointment has been booked.';
const BOOKED_CLOSING       = 'See you soon!';

/** Line shown above the YES/NO buttons. */
const CONFIRM_PROMPT = 'Please confirm or cancel your appointment below.';

/** Notice at the top of test emails. */
const TEST_BANNER =
  'This is a test email. Its buttons only open a preview and do not change the appointment.';

/** Longest subject line produced (longer subjects are cut). */
const MAX_SUBJECT_LENGTH = 200;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Salon fields that customise the emails (salons row; null → default). */
export type EmailTemplateFields = {
  email_subject?: string | null;
  email_greeting?: string | null;
  email_body?: string | null;
  email_closing?: string | null;
  email_footer?: string | null;
};

/** The appointment as shown in an email. */
export type AppointmentEmailDetails = {
  /** Salon display name (the only brand the client sees). */
  salonName: string;
  /** Client name; null or blank → "there". */
  clientName: string | null;
  /** Service name; null or blank → "appointment". */
  serviceType: string | null;
  /** Staff member name, shown when present. */
  staffName?: string | null;
  /** UTC ISO timestamp of the appointment start. */
  datetime: string;
  /** Salon IANA timezone; an invalid value falls back to UTC. */
  timeZone: string;
};

/** Full URLs of the YES and NO buttons. */
export type ConfirmationLinks = { confirmUrl: string; cancelUrl: string };

/** A complete email: subject, HTML body and plain-text alternative. */
export type RenderedEmail = { subject: string; html: string; text: string };

/** Everything the shared layout renders; values are raw (escaped when rendered). */
type EmailLayout = {
  /** Document <title>. */
  title: string;
  salonName: string;
  /** Highlighted notice above the header (test emails), or null. */
  banner: string | null;
  greeting: string;
  body: string;
  details: Array<{ label: string; value: string }>;
  /** YES/NO buttons with the line above them, or null for none. */
  buttons: { prompt: string; links: ConfirmationLinks } | null;
  /** Closing line shown when there are no buttons, or null. */
  closing: string | null;
  footer: string;
};

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Matches a {variable} placeholder. */
const PLACEHOLDER_PATTERN = /\{([a-z_]+)\}/g;

/**
 * Substitutes {variable} placeholders in a single pass. Replacement values are
 * inserted as they are and never scanned again, so a client named "{date}"
 * stays "{date}". Unknown variables are left as-is so callers can see them.
 *
 * @param template - String containing {variable} placeholders.
 * @param vars     - Map of variable name → replacement value (raw, unescaped).
 * @returns        Template with all recognised variables replaced.
 */
export function applyTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(PLACEHOLDER_PATTERN, (match: string, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : match,
  );
}

/**
 * Escapes HTML special characters to prevent injection via user-supplied strings
 * (salon name, client name, service type, custom template text) into emails
 * and pages.
 *
 * @param str - Raw string that may contain HTML special characters.
 * @returns   HTML-safe string.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Makes a subject line safe for an email header: control characters (line
 * breaks included) become spaces, runs of spaces collapse, and the result is
 * trimmed to MAX_SUBJECT_LENGTH characters.
 *
 * @param subject - Subject after placeholder substitution.
 */
export function cleanSubject(subject: string): string {
  return subject
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, MAX_SUBJECT_LENGTH)
    .trim();
}

// ---------------------------------------------------------------------------
// Date and time — always in the salon's timezone
// ---------------------------------------------------------------------------

/**
 * Formats the day of an appointment in the salon's timezone, e.g.
 * "Tuesday 6 October". Built from separately formatted parts so the result
 * does not depend on the ICU version's date pattern.
 *
 * @param datetime - UTC ISO timestamp.
 * @param timeZone - Salon IANA timezone (invalid → UTC).
 */
export function formatAppointmentDate(datetime: string, timeZone: string): string {
  const { date } = utcToZonedParts(datetime, resolveTimeZone(timeZone));
  const weekday = formatDateOnly(date, { weekday: 'long' }, 'en-GB');
  const month   = formatDateOnly(date, { month: 'long' }, 'en-GB');
  return `${weekday} ${Number(date.slice(8, 10))} ${month}`;
}

/**
 * Formats the start time of an appointment in the salon's timezone as a
 * 24-hour time, e.g. "10:00".
 *
 * @param datetime - UTC ISO timestamp.
 * @param timeZone - Salon IANA timezone (invalid → UTC).
 */
export function formatAppointmentTime(datetime: string, timeZone: string): string {
  return formatTimeInZone(datetime, resolveTimeZone(timeZone));
}

/**
 * Template variables for an appointment.
 *
 * @param details - The appointment as shown in the email.
 */
function templateVariables(details: AppointmentEmailDetails): Record<string, string> {
  return {
    client_name:   details.clientName?.trim() || 'there',
    business_name: details.salonName,
    service:       details.serviceType?.trim() || 'appointment',
    time:          formatAppointmentTime(details.datetime, details.timeZone),
    date:          formatAppointmentDate(details.datetime, details.timeZone),
  };
}

/**
 * Rows of the appointment details box: service, staff (when known) and time.
 *
 * @param details - The appointment.
 * @param vars    - Its template variables (for the formatted date and time).
 */
function detailRows(
  details: AppointmentEmailDetails,
  vars: Record<string, string>,
): EmailLayout['details'] {
  const rows = [{ label: 'Service', value: vars.service }];
  const staff = details.staffName?.trim();
  if (staff) rows.push({ label: 'Staff', value: staff });
  rows.push({ label: 'Date & Time', value: `${vars.date} at ${vars.time}` });
  return rows;
}

/**
 * Resolves the footer: custom or default, with {business_name} substituted.
 *
 * @param fields    - Salon template fields.
 * @param salonName - Salon display name.
 */
function footerText(fields: EmailTemplateFields, salonName: string): string {
  return applyTemplate(fields.email_footer?.trim() || DEFAULT_EMAIL_FOOTER, { business_name: salonName });
}

// ---------------------------------------------------------------------------
// Email renderers
// ---------------------------------------------------------------------------

/**
 * Renders the 24-hour reminder, or its test version.
 *
 * Custom email fields (all optional, null → application default):
 *  - email_subject:  Subject line. Supports all template variables.
 *  - email_greeting: Greeting line. Supports all template variables.
 *  - email_body:     Body paragraph. Supports all template variables.
 *  - email_closing:  Closing shown when there are no buttons. Supports all template variables.
 *  - email_footer:   Footer text. Supports {business_name}.
 *
 * @param details      - The appointment.
 * @param fields       - The salon's custom template fields.
 * @param links        - YES/NO links, or null when the salon turned confirmation off.
 * @param options.test - Marks the email as a test (subject prefix and a notice).
 * @returns            Subject, HTML body and plain-text body.
 */
export function renderReminderEmail(
  details: AppointmentEmailDetails,
  fields: EmailTemplateFields,
  links: ConfirmationLinks | null,
  options: { test?: boolean } = {},
): RenderedEmail {
  const vars    = templateVariables(details);
  const subject = cleanSubject(applyTemplate(fields.email_subject?.trim() || DEFAULT_EMAIL_SUBJECT, vars));

  return renderEmail(options.test ? `[Test] ${subject}` : subject, {
    title:     `Appointment Reminder — ${details.salonName}`,
    salonName: details.salonName,
    banner:    options.test ? TEST_BANNER : null,
    greeting:  applyTemplate(fields.email_greeting?.trim() || DEFAULT_EMAIL_GREETING, vars),
    body:      applyTemplate(fields.email_body?.trim() || DEFAULT_EMAIL_BODY, vars),
    details:   detailRows(details, vars),
    buttons:   links ? { prompt: CONFIRM_PROMPT, links } : null,
    closing:   links ? null : applyTemplate(fields.email_closing?.trim() || DEFAULT_EMAIL_CLOSING, vars),
    footer:    footerText(fields, details.salonName),
  });
}

/**
 * Renders the booking confirmation sent right after a booking.
 *
 *  - With links (dashboard bookings): asks the client to confirm, e.g.
 *    "Please confirm your appointment on Tuesday 6 October at 10:00".
 *  - Without links (public bookings, or salons that turned confirmation off):
 *    a "your appointment has been booked" notice. It never says "confirmed",
 *    because the appointment may still be awaiting confirmation.
 *
 * @param details - The appointment.
 * @param fields  - The salon's custom template fields (greeting and footer are used).
 * @param links   - YES/NO links, or null for the plain notice.
 * @returns       Subject, HTML body and plain-text body.
 */
export function renderConfirmationEmail(
  details: AppointmentEmailDetails,
  fields: EmailTemplateFields,
  links: ConfirmationLinks | null,
): RenderedEmail {
  const vars     = templateVariables(details);
  const greeting = applyTemplate(fields.email_greeting?.trim() || DEFAULT_EMAIL_GREETING, vars);
  const footer   = footerText(fields, details.salonName);

  if (links) {
    return renderEmail(cleanSubject(applyTemplate(CONFIRMATION_SUBJECT, vars)), {
      title:     `Please Confirm Your Appointment — ${details.salonName}`,
      salonName: details.salonName,
      banner:    null,
      greeting,
      body:      applyTemplate(CONFIRMATION_BODY, vars),
      details:   detailRows(details, vars),
      buttons:   { prompt: CONFIRM_PROMPT, links },
      closing:   null,
      footer,
    });
  }

  return renderEmail(cleanSubject(applyTemplate(BOOKED_SUBJECT, vars)), {
    title:     `Appointment Booked — ${details.salonName}`,
    salonName: details.salonName,
    banner:    null,
    greeting,
    body:      BOOKED_BODY,
    details:   detailRows(details, vars),
    buttons:   null,
    closing:   BOOKED_CLOSING,
    footer,
  });
}

/**
 * Builds the HTML and plain-text bodies of a layout.
 *
 * @param subject - Final subject line.
 * @param layout  - Raw (unescaped) content.
 */
function renderEmail(subject: string, layout: EmailLayout): RenderedEmail {
  return { subject, html: renderHtml(layout), text: renderText(layout) };
}

/**
 * Renders the HTML body. Every value from the layout is escaped here.
 *
 * Design principles:
 *  - Salon name displayed prominently — Noshowly completely invisible.
 *  - Two large call-to-action buttons: YES (green) and NO (red), when present.
 *  - Inline CSS only — no external stylesheets (broad email client support).
 *  - Responsive-friendly: single-column layout, large tap targets.
 */
function renderHtml(layout: EmailLayout): string {
  const safeSalonName = escapeHtml(layout.salonName);

  const bannerRow = layout.banner
    ? `<!-- Test notice -->
          <tr>
            <td style="background:#fef3c7;padding:14px 32px;">
              <p style="margin:0;font-size:14px;font-weight:700;color:#92400e;">${escapeHtml(layout.banner)}</p>
            </td>
          </tr>
`
    : '';

  const detailsHtml = layout.details
    .map((row, index) => {
      const last = index === layout.details.length - 1;
      return `<p style="margin:0 0 6px;font-size:13px;font-weight:600;color:#71717a;
                               text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(row.label)}</p>
                    <p style="margin:0${last ? '' : ' 0 16px'};font-size:16px;color:#18181b;font-weight:600;">
                      ${escapeHtml(row.value)}
                    </p>`;
    })
    .join('\n                    ');

  const ctaSection = layout.buttons
    ? `<p style="margin:0 0 20px;font-size:16px;color:#3f3f46;">
                ${escapeHtml(layout.buttons.prompt)}
              </p>

              <!-- YES / NO confirmation buttons -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="48%" align="center">
                    <a href="${escapeHtml(layout.buttons.links.confirmUrl)}"
                       style="display:block;background:#16a34a;color:#ffffff;text-decoration:none;
                              font-size:17px;font-weight:700;padding:16px;border-radius:6px;
                              text-align:center;">
                      YES, I&#39;ll be there
                    </a>
                  </td>
                  <td width="4%"></td>
                  <td width="48%" align="center">
                    <a href="${escapeHtml(layout.buttons.links.cancelUrl)}"
                       style="display:block;background:#dc2626;color:#ffffff;text-decoration:none;
                              font-size:17px;font-weight:700;padding:16px;border-radius:6px;
                              text-align:center;">
                      NO, cancel it
                    </a>
                  </td>
                </tr>
              </table>`
    : `<p style="margin:0;font-size:16px;color:#3f3f46;">${escapeHtml(layout.closing ?? '')}</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(layout.title)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden;">

          ${bannerRow}<!-- Header -->
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
              <p style="margin:0 0 8px;font-size:16px;color:#3f3f46;">${escapeHtml(layout.greeting)}</p>
              <p style="margin:0 0 24px;font-size:16px;color:#3f3f46;line-height:1.5;">
                ${escapeHtml(layout.body)}
              </p>

              <!-- Appointment details box -->
              <table width="100%" cellpadding="0" cellspacing="0"
                style="background:#f4f4f5;border-radius:6px;margin-bottom:28px;">
                <tr>
                  <td style="padding:20px 24px;">
                    ${detailsHtml}
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
                ${escapeHtml(layout.footer)}
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

/**
 * Renders the plain-text alternative (no escaping: it is not HTML).
 */
function renderText(layout: EmailLayout): string {
  const blocks: string[] = [];
  if (layout.banner) blocks.push(layout.banner);
  blocks.push(layout.greeting, layout.body);
  blocks.push(layout.details.map((row) => `${row.label}: ${row.value}`).join('\n'));
  if (layout.buttons) {
    blocks.push(
      [
        layout.buttons.prompt,
        `Yes, I'll be there: ${layout.buttons.links.confirmUrl}`,
        `No, cancel it: ${layout.buttons.links.cancelUrl}`,
      ].join('\n'),
    );
  } else if (layout.closing) {
    blocks.push(layout.closing);
  }
  blocks.push(layout.footer);
  return `${blocks.join('\n\n')}\n`;
}
