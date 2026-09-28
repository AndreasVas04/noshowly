/**
 * lib/confirm-page.ts
 *
 * State and HTML of the confirmation page (/api/confirm/[token]) opened by the
 * YES/NO buttons in appointment emails.
 *
 * Opening a link never changes anything, because mail scanners and link
 * previews open links too. The page shows the salon, the service, the date and
 * time in the salon's timezone and the appointment's real status, with Confirm
 * and Cancel buttons that POST to the same URL (app/api/confirm/[token]).
 *
 * Link states (resolveLinkState()):
 *  - 'invalid'    — unknown token, or an email that was never sent;
 *  - 'test'       — a test email's link: a preview that changes nothing;
 *  - 'expired'    — the appointment time has passed;
 *  - 'cancelled'  — the appointment is cancelled;
 *  - 'superseded' — the link was retired when the appointment changed (the
 *                   reminder row is 'cancelled' but the appointment is not);
 *  - 'confirmed'  — the appointment is confirmed (no buttons);
 *  - 'actionable' — the appointment is 'scheduled': Confirm / Cancel buttons.
 *
 * Design: plain, mobile-friendly, inline CSS, no scripts. No Noshowly branding
 * — the client sees only the salon's name. Every interpolated value is escaped.
 *
 * Pure functions — no database calls, no side effects.
 */

import { escapeHtml, formatAppointmentDate, formatAppointmentTime } from '@/lib/reminder-templates';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** What a confirmation link can currently do. */
export type LinkState =
  | 'invalid'
  | 'test'
  | 'expired'
  | 'cancelled'
  | 'superseded'
  | 'confirmed'
  | 'actionable';

/** The client's choice on the page. */
export type LinkAction = 'confirm' | 'cancel';

/** What happened to a POST. */
export type PostOutcome = 'confirmed' | 'cancelled' | 'unchanged';

/** The appointment as shown on the page. */
export type PageAppointment = {
  salonName: string;
  serviceType: string | null;
  /** UTC ISO timestamp. */
  datetime: string;
  /** Salon IANA timezone. */
  timeZone: string;
  status: string;
};

/** Everything renderConfirmPage() shows. */
export type ConfirmPageView = {
  state: LinkState | 'error' | 'bad_request';
  /** The appointment, when the token matched one. */
  appointment?: PageAppointment | null;
  /** Path the buttons post to (the page's own path). */
  actionPath?: string;
  /** Button the email link pointed at (?response=yes|no). */
  intent?: LinkAction | null;
  /** Result of the POST that produced this page. */
  outcome?: PostOutcome | null;
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * Decides what a confirmation link can do right now.
 *
 * @param reminder    - The reminder row the token belongs to (type, status), or null.
 * @param appointment - Its appointment (status, datetime), or null.
 * @param now         - Current instant.
 */
export function resolveLinkState(
  reminder: { type: string; status: string } | null,
  appointment: { status: string; datetime: string } | null,
  now: Date,
): LinkState {
  if (!reminder || !appointment) return 'invalid';
  if (reminder.type === 'email_test') return 'test';
  if (reminder.type !== 'email' && reminder.type !== 'email_confirmation') return 'invalid';
  // Rows that never went out cannot be in anyone's inbox.
  if (reminder.status === 'failed' || reminder.status === 'skipped') return 'invalid';

  const start = Date.parse(appointment.datetime);
  if (!Number.isFinite(start) || start <= now.getTime()) return 'expired';
  if (appointment.status === 'cancelled') return 'cancelled';
  // Retired when the appointment was moved: the old time is no longer true.
  if (reminder.status === 'cancelled') return 'superseded';
  if (appointment.status === 'confirmed') return 'confirmed';
  if (appointment.status === 'scheduled') return 'actionable';
  return 'invalid';
}

/**
 * Reads the client's choice: 'confirm' / 'yes' or 'cancel' / 'no'.
 *
 * @param value - Form field or query parameter value.
 * @returns     The action, or null when the value is anything else.
 */
export function parseLinkAction(value: unknown): LinkAction | null {
  if (value === 'confirm' || value === 'yes') return 'confirm';
  if (value === 'cancel' || value === 'no') return 'cancel';
  return null;
}

/**
 * HTTP status of a page: 200 when it shows an appointment, 400 for a bad
 * request, 404 for an invalid link, 410 for an expired or retired link, 500
 * for a server error.
 *
 * @param view - The page.
 */
export function confirmPageStatus(view: Pick<ConfirmPageView, 'state'>): number {
  switch (view.state) {
    case 'bad_request': return 400;
    case 'invalid':     return 404;
    case 'expired':
    case 'superseded':  return 410;
    case 'error':       return 500;
    default:            return 200;
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const GREEN = '#16a34a';
const RED   = '#dc2626';
const GREY  = '#71717a';
const DARK  = '#18181b';

/** Label of an appointment status. */
function statusLabel(status: string): string {
  if (status === 'confirmed') return 'Confirmed';
  if (status === 'cancelled') return 'Cancelled';
  return 'Awaiting your reply';
}

/** Heading, message, accent colour and icon of a page. Values are raw text. */
type PageCopy = { title: string; heading: string; message: string; accent: string; icon: string };

/**
 * Chooses the copy of a page.
 *
 * @param view  - The page.
 * @param salon - Salon name, or a neutral fallback.
 * @param when  - "Tuesday 6 October at 10:00", or null.
 */
function pageCopy(view: ConfirmPageView, salon: string, when: string | null): PageCopy {
  switch (view.state) {
    case 'actionable':
      if (view.intent === 'cancel') {
        return {
          title: 'Cancel Appointment', accent: RED, icon: '?',
          heading: 'Cancel your appointment?',
          message: 'Press "No, cancel it" to cancel. If you can make it after all, confirm instead.',
        };
      }
      return {
        title: 'Confirm Appointment', accent: GREEN, icon: '?',
        heading: view.intent === 'confirm' ? 'Confirm your appointment' : 'Can you make it?',
        message: view.outcome === 'unchanged'
          ? 'Your appointment was not changed. Please choose again.'
          : 'Please confirm or cancel your appointment below.',
      };
    case 'confirmed':
      return {
        title: 'Appointment Confirmed', accent: GREEN, icon: '✓',
        heading: 'Appointment confirmed',
        message: view.outcome === 'confirmed'
          ? `Thank you. ${salon} will see you${when ? ` on ${when}` : ''}.`
          : `This appointment is confirmed. To change or cancel it, contact ${salon}.`,
      };
    case 'cancelled':
      return {
        title: 'Appointment Cancelled', accent: RED, icon: '✕',
        heading: 'Appointment cancelled',
        message: view.outcome === 'cancelled'
          ? `Your appointment has been cancelled. Contact ${salon} to book again.`
          : `This appointment has been cancelled. Contact ${salon} to book again.`,
      };
    case 'test':
      return {
        title: 'Test Email', accent: GREY, icon: 'i',
        heading: 'Test email',
        message: `This link comes from a test email sent by ${salon}. It does not change your appointment.`,
      };
    case 'expired':
      return {
        title: 'Link Expired', accent: GREY, icon: '!',
        heading: 'This link has expired',
        message: `The appointment time has passed. If you need anything, contact ${salon}.`,
      };
    case 'superseded':
      return {
        title: 'Link No Longer Valid', accent: GREY, icon: '!',
        heading: 'This link is no longer valid',
        message: `Your appointment changed after this email was sent. Please use the latest email from ${salon}, or contact them directly.`,
      };
    case 'bad_request':
      return {
        title: 'Invalid Request', accent: GREY, icon: '!',
        heading: 'Invalid request',
        message: 'Please use the buttons on the page to confirm or cancel your appointment.',
      };
    case 'error':
      return {
        title: 'Something went wrong', accent: GREY, icon: '!',
        heading: 'Something went wrong',
        message: 'We couldn\'t load or update your appointment. Please try again, or contact the business directly.',
      };
    case 'invalid':
    default:
      return {
        title: 'Invalid Link', accent: GREY, icon: '!',
        heading: 'This link is invalid',
        message: 'This confirmation link is invalid. Please contact the business directly.',
      };
  }
}

/**
 * Formats the appointment time in the salon's timezone, e.g.
 * "Tuesday 6 October at 10:00"; null when the stored time is unreadable.
 */
function describeWhen(appointment: PageAppointment): string | null {
  try {
    const date = formatAppointmentDate(appointment.datetime, appointment.timeZone);
    const time = formatAppointmentTime(appointment.datetime, appointment.timeZone);
    return `${date} at ${time}`;
  } catch {
    return null;
  }
}

/** States that show the appointment's details. */
const STATES_WITH_DETAILS: ReadonlyArray<ConfirmPageView['state']> = ['actionable', 'confirmed', 'cancelled', 'test'];

/**
 * Renders a Confirm or Cancel button as a small form posting to the page.
 *
 * @param actionPath - Path to post to.
 * @param action     - The button's action.
 * @param solid      - Filled (true) or outlined (false).
 */
function actionButton(actionPath: string, action: LinkAction, solid: boolean): string {
  const colour = action === 'confirm' ? GREEN : RED;
  const label  = action === 'confirm' ? 'YES, I&#39;ll be there' : 'NO, cancel it';
  const style  = solid
    ? `background:${colour};color:#ffffff;border:2px solid ${colour};`
    : `background:#ffffff;color:${colour};border:2px solid ${colour};`;
  return `<form method="post" action="${escapeHtml(actionPath)}" style="flex:1 1 160px;margin:0;">
        <input type="hidden" name="action" value="${action}" />
        <button type="submit" style="width:100%;${style}font-size:16px;font-weight:700;padding:14px 12px;
                border-radius:6px;cursor:pointer;font-family:inherit;">${label}</button>
      </form>`;
}

/**
 * Renders the page. No Noshowly brand visible anywhere on the page.
 *
 * @param view - What to show.
 * @returns    Complete HTML document.
 */
export function renderConfirmPage(view: ConfirmPageView): string {
  const appointment = view.appointment ?? null;
  const salon = appointment?.salonName.trim() || 'the business';
  const when = appointment ? describeWhen(appointment) : null;
  const copy = pageCopy(view, salon, when);

  const salonHeader = appointment?.salonName.trim()
    ? `<p style="margin:0 0 20px;font-size:13px;font-weight:700;color:${GREY};text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(appointment.salonName.trim())}</p>`
    : '';

  const details = appointment && when && STATES_WITH_DETAILS.includes(view.state)
    ? `<div style="background:#f4f4f5;border-radius:6px;padding:16px 20px;margin:24px 0 0;text-align:left;">
      <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:${GREY};text-transform:uppercase;letter-spacing:0.5px;">Service</p>
      <p style="margin:0 0 12px;font-size:16px;color:${DARK};font-weight:600;">${escapeHtml(appointment.serviceType?.trim() || 'Appointment')}</p>
      <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:${GREY};text-transform:uppercase;letter-spacing:0.5px;">Date &amp; Time</p>
      <p style="margin:0 0 12px;font-size:16px;color:${DARK};font-weight:600;">${escapeHtml(when)}</p>
      <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:${GREY};text-transform:uppercase;letter-spacing:0.5px;">Status</p>
      <p style="margin:0;font-size:16px;color:${DARK};font-weight:600;">${escapeHtml(statusLabel(appointment.status))}</p>
    </div>`
    : '';

  const buttons = view.state === 'actionable' && view.actionPath
    ? `<div style="display:flex;flex-wrap:wrap;gap:12px;margin:24px 0 0;">
      ${view.intent === 'cancel'
        ? `${actionButton(view.actionPath, 'cancel', true)}
      ${actionButton(view.actionPath, 'confirm', false)}`
        : `${actionButton(view.actionPath, 'confirm', true)}
      ${actionButton(view.actionPath, 'cancel', view.intent !== 'confirm')}`}
    </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow" />
  <title>${escapeHtml(copy.title)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;min-height:100vh;
             display:flex;align-items:center;justify-content:center;">
  <div style="background:#ffffff;border-radius:8px;padding:40px 32px;max-width:480px;width:100%;
              margin:16px;text-align:center;border-top:4px solid ${copy.accent};box-sizing:border-box;">
    ${salonHeader}
    <div style="width:48px;height:48px;border-radius:50%;background:${copy.accent};
                margin:0 auto 20px;display:flex;align-items:center;justify-content:center;">
      <span style="color:#ffffff;font-size:24px;font-weight:700;line-height:1;">${escapeHtml(copy.icon)}</span>
    </div>
    <h1 style="margin:0 0 12px;font-size:22px;color:${DARK};font-weight:700;">${escapeHtml(copy.heading)}</h1>
    <p style="margin:0;font-size:16px;color:#52525b;line-height:1.5;">${escapeHtml(copy.message)}</p>
    ${details}
    ${buttons}
  </div>
</body>
</html>`;
}
