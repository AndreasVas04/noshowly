/**
 * lib/__tests__/reminder-templates.test.ts
 *
 * Unit tests for the email templates in lib/reminder-templates.ts: HTML
 * escaping of every interpolated value, single-pass placeholder substitution,
 * dates and times in the salon's timezone, subjects, buttons, the test notice
 * and the plain-text alternative.
 */

import { describe, expect, it } from 'vitest';
import {
  applyTemplate,
  cleanSubject,
  formatAppointmentDate,
  formatAppointmentTime,
  renderConfirmationEmail,
  renderReminderEmail,
  type AppointmentEmailDetails,
} from '@/lib/reminder-templates';

/** Tuesday 6 October 2026, 10:00 in Nicosia (UTC+3 until 25 October). */
const DATETIME = '2026-10-06T07:00:00Z';

const LINKS = {
  confirmUrl: 'https://app.example.com/api/confirm/token-1?response=yes',
  cancelUrl:  'https://app.example.com/api/confirm/token-1?response=no',
};

/** Appointment details with overrides. */
function details(overrides: Partial<AppointmentEmailDetails> = {}): AppointmentEmailDetails {
  return {
    salonName:   'Salon Elena',
    clientName:  'Maria',
    serviceType: 'Haircut',
    staffName:   null,
    datetime:    DATETIME,
    timeZone:    'Europe/Nicosia',
    ...overrides,
  };
}

describe('applyTemplate', () => {
  it('replaces known variables and keeps unknown ones', () => {
    expect(applyTemplate('Hi {client_name}, {unknown}!', { client_name: 'Maria' })).toBe('Hi Maria, {unknown}!');
  });

  it('substitutes in a single pass', () => {
    // The value of {a} looks like a placeholder; it must not be expanded again.
    expect(applyTemplate('{a} and {b}', { a: '{b}', b: 'B' })).toBe('{b} and B');
    expect(applyTemplate('{a}', { a: '$& $1 $$' })).toBe('$& $1 $$');
  });
});

describe('formatAppointmentDate / formatAppointmentTime', () => {
  it('formats in the salon timezone', () => {
    expect(formatAppointmentDate(DATETIME, 'Europe/Nicosia')).toBe('Tuesday 6 October');
    expect(formatAppointmentTime(DATETIME, 'Europe/Nicosia')).toBe('10:00');
  });

  it('uses the salon calendar day, which can differ from the UTC day', () => {
    const late = '2026-10-06T22:30:00Z';
    expect(formatAppointmentDate(late, 'Europe/Nicosia')).toBe('Wednesday 7 October');
    expect(formatAppointmentTime(late, 'Europe/Nicosia')).toBe('01:30');
    expect(formatAppointmentDate(late, 'America/New_York')).toBe('Tuesday 6 October');
    expect(formatAppointmentTime(late, 'America/New_York')).toBe('18:30');
    expect(formatAppointmentDate('2026-10-06T12:00:00Z', 'Pacific/Auckland')).toBe('Wednesday 7 October');
  });

  it('falls back to UTC for an invalid timezone', () => {
    expect(formatAppointmentDate(DATETIME, 'Not/AZone')).toBe('Tuesday 6 October');
    expect(formatAppointmentTime(DATETIME, 'Not/AZone')).toBe('07:00');
  });
});

describe('renderReminderEmail', () => {
  it('uses a subject with the real date and time, never "tomorrow"', () => {
    const email = renderReminderEmail(details(), {}, LINKS);
    expect(email.subject).toBe('Reminder: Your appointment at Salon Elena on Tuesday 6 October at 10:00');
    expect(`${email.subject}${email.html}${email.text}`.toLowerCase()).not.toContain('tomorrow');
    expect(email.html).toContain('Tuesday 6 October at 10:00');
  });

  it('shows YES/NO buttons with the links, and the closing only without them', () => {
    const withLinks = renderReminderEmail(details(), {}, LINKS);
    expect(withLinks.html).toContain('href="https://app.example.com/api/confirm/token-1?response=yes"');
    expect(withLinks.html).toContain('href="https://app.example.com/api/confirm/token-1?response=no"');
    expect(withLinks.html).not.toContain('We look forward to seeing you.');

    const withoutLinks = renderReminderEmail(details(), { email_closing: 'Bye {client_name}' }, null);
    expect(withoutLinks.html).not.toContain('/api/confirm/');
    expect(withoutLinks.html).toContain('Bye Maria');
    expect(withoutLinks.text).toContain('Bye Maria');
  });

  it('applies custom fields with all template variables', () => {
    const email = renderReminderEmail(details({ staffName: 'Anna' }), {
      email_subject:  '{business_name}: {service} on {date}',
      email_greeting: 'Dear {client_name},',
      email_body:     'See you at {time} on {date} for your {service}.',
      email_footer:   'Questions? Call {business_name}. {date}',
    }, LINKS);
    expect(email.subject).toBe('Salon Elena: Haircut on Tuesday 6 October');
    expect(email.html).toContain('Dear Maria,');
    expect(email.html).toContain('See you at 10:00 on Tuesday 6 October for your Haircut.');
    // The footer supports {business_name} only, as in the settings preview.
    expect(email.html).toContain('Questions? Call Salon Elena. {date}');
    expect(email.html).toContain('Anna');
  });

  it('escapes every interpolated value in the HTML', () => {
    const email = renderReminderEmail(
      details({
        salonName:   '<script>alert(1)</script>',
        clientName:  'O\'Brien & <b>Co</b>',
        serviceType: '"Cut" <i>',
        staffName:   '<img src=x onerror=alert(1)>',
      }),
      {
        email_greeting: '<a href="https://evil.example">{client_name}</a>',
        email_body:     '<style>body{display:none}</style>',
        email_footer:   '<iframe src="x"></iframe>',
      },
      { confirmUrl: 'https://app.example.com/c?a=1&b="2"', cancelUrl: 'https://app.example.com/x' },
    );
    for (const raw of ['<script>', '<b>', '<i>', '<img', '<a href="https://evil', '<style>', '<iframe']) {
      expect(email.html).not.toContain(raw);
    }
    expect(email.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(email.html).toContain('O&#39;Brien &amp; &lt;b&gt;Co&lt;/b&gt;');
    expect(email.html).toContain('&quot;Cut&quot; &lt;i&gt;');
    expect(email.html).toContain('href="https://app.example.com/c?a=1&amp;b=&quot;2&quot;"');
  });

  it('does not expand placeholders inside values', () => {
    const email = renderReminderEmail(
      details({ clientName: '{date}', salonName: '{client_name}' }),
      { email_body: 'Welcome to {business_name}, {client_name}!' },
      LINKS,
    );
    expect(email.html).toContain('Hi {date},');
    expect(email.html).toContain('Welcome to {client_name}, {date}!');
    expect(email.subject).toBe('Reminder: Your appointment at {client_name} on Tuesday 6 October at 10:00');
  });

  it('keeps line breaks and control characters out of the subject', () => {
    const email = renderReminderEmail(details({ salonName: 'Salon\r\nBcc: victim@example.com' }), {}, LINKS);
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(cleanSubject('  a\u0000b\tc\n\nd  ')).toBe('a b c d');
    expect(cleanSubject('x'.repeat(300))).toHaveLength(200);
  });

  it('marks test emails in the subject, the HTML and the text', () => {
    const email = renderReminderEmail(details(), {}, LINKS, { test: true });
    expect(email.subject.startsWith('[Test] Reminder:')).toBe(true);
    expect(email.html).toContain('This is a test email.');
    expect(email.text.startsWith('This is a test email.')).toBe(true);
  });

  it('builds a plain-text alternative with the details and both links', () => {
    const email = renderReminderEmail(details({ staffName: 'Anna' }), {}, LINKS);
    expect(email.text).toContain('Hi Maria,');
    expect(email.text).toContain('Service: Haircut');
    expect(email.text).toContain('Staff: Anna');
    expect(email.text).toContain('Date & Time: Tuesday 6 October at 10:00');
    expect(email.text).toContain(`Yes, I'll be there: ${LINKS.confirmUrl}`);
    expect(email.text).toContain(`No, cancel it: ${LINKS.cancelUrl}`);
    expect(email.text).toContain('If you have questions, contact Salon Elena directly.');
    expect(email.text).not.toContain('<');
  });

  it('falls back to "there" and "appointment" for missing names', () => {
    const email = renderReminderEmail(details({ clientName: '  ', serviceType: null }), {}, LINKS);
    expect(email.html).toContain('Hi there,');
    expect(email.text).toContain('Service: appointment');
  });
});

describe('renderConfirmationEmail', () => {
  it('asks for confirmation with the real date when it has links', () => {
    const email = renderConfirmationEmail(details(), {}, LINKS);
    expect(email.subject).toBe('Please confirm your appointment on Tuesday 6 October at 10:00');
    expect(email.html).toContain('Your appointment at Salon Elena is booked for Tuesday 6 October at 10:00.');
    expect(email.html).toContain(LINKS.confirmUrl);
    expect(`${email.subject}${email.html}`.toLowerCase()).not.toContain('tomorrow');
  });

  it('is a plain booking notice without links, never saying "confirmed"', () => {
    const email = renderConfirmationEmail(details({ staffName: 'Anna' }), {}, null);
    expect(email.subject).toBe('Appointment booked at Salon Elena on Tuesday 6 October at 10:00');
    expect(email.html).toContain('Your appointment has been booked.');
    expect(email.html).toContain('See you soon!');
    expect(email.html).toContain('Anna');
    expect(email.html).not.toContain('/api/confirm/');
    expect(`${email.html}${email.text}`.toLowerCase()).not.toContain('confirmed');
  });

  it('uses the custom greeting and footer but not the reminder subject or body', () => {
    const email = renderConfirmationEmail(details(), {
      email_subject:  'See you tomorrow at {business_name}',
      email_body:     'Your appointment is tomorrow!',
      email_greeting: 'Hello {client_name}!',
      email_footer:   'Call {business_name} on 22 000000',
    }, LINKS);
    expect(email.subject).toBe('Please confirm your appointment on Tuesday 6 October at 10:00');
    expect(email.html).not.toContain('tomorrow');
    expect(email.html).toContain('Hello Maria!');
    expect(email.html).toContain('Call Salon Elena on 22 000000');
  });

  it('escapes values', () => {
    const email = renderConfirmationEmail(details({ salonName: '<b>Salon</b>', clientName: '<i>x</i>' }), {}, null);
    expect(email.html).not.toContain('<b>');
    expect(email.html).not.toContain('<i>');
    expect(email.html).toContain('&lt;b&gt;Salon&lt;/b&gt;');
  });
});
