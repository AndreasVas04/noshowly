/**
 * lib/__tests__/confirm-page.test.ts
 *
 * Unit tests for the confirmation page in lib/confirm-page.ts: what a link
 * can do in each state (test, expired, cancelled, retired, confirmed,
 * actionable), the HTTP status of each page, and the rendered HTML (buttons
 * that POST, salon-time details, escaping).
 */

import { describe, expect, it } from 'vitest';
import {
  confirmPageStatus,
  parseLinkAction,
  renderConfirmPage,
  resolveLinkState,
  type PageAppointment,
} from '@/lib/confirm-page';

const NOW = new Date('2026-10-05T12:00:00Z');
const FUTURE = '2026-10-06T07:00:00Z'; // Tuesday 6 October, 10:00 in Nicosia
const PAST = '2026-10-05T11:00:00Z';

const reminder = (type: string, status: string) => ({ type, status });
const appointment = (status: string, datetime = FUTURE) => ({ status, datetime });

function pageAppointment(overrides: Partial<PageAppointment> = {}): PageAppointment {
  return {
    salonName:   'Salon Elena',
    serviceType: 'Haircut',
    datetime:    FUTURE,
    timeZone:    'Europe/Nicosia',
    status:      'scheduled',
    ...overrides,
  };
}

describe('resolveLinkState', () => {
  it('lets 24-hour reminder and booking confirmation links act on scheduled appointments', () => {
    expect(resolveLinkState(reminder('email', 'sent'), appointment('scheduled'), NOW)).toBe('actionable');
    expect(resolveLinkState(reminder('email_confirmation', 'sent'), appointment('scheduled'), NOW)).toBe('actionable');
    // Sent, but not yet marked as sent.
    expect(resolveLinkState(reminder('email', 'pending'), appointment('scheduled'), NOW)).toBe('actionable');
  });

  it('only previews test email links', () => {
    expect(resolveLinkState(reminder('email_test', 'sent'), appointment('scheduled'), NOW)).toBe('test');
    expect(resolveLinkState(reminder('email_test', 'sent'), appointment('cancelled', PAST), NOW)).toBe('test');
  });

  it('expires links once the appointment time has passed', () => {
    expect(resolveLinkState(reminder('email', 'sent'), appointment('scheduled', PAST), NOW)).toBe('expired');
    expect(resolveLinkState(reminder('email', 'sent'), appointment('scheduled', NOW.toISOString()), NOW)).toBe('expired');
    expect(resolveLinkState(reminder('email', 'cancelled'), appointment('cancelled', PAST), NOW)).toBe('expired');
  });

  it('shows cancelled appointments as cancelled, whoever cancelled them', () => {
    expect(resolveLinkState(reminder('email', 'cancelled'), appointment('cancelled'), NOW)).toBe('cancelled');
    expect(resolveLinkState(reminder('email', 'sent'), appointment('cancelled'), NOW)).toBe('cancelled');
  });

  it('retires links when the appointment changed after the email', () => {
    expect(resolveLinkState(reminder('email', 'cancelled'), appointment('scheduled'), NOW)).toBe('superseded');
    expect(resolveLinkState(reminder('email_confirmation', 'cancelled'), appointment('confirmed'), NOW)).toBe('superseded');
  });

  it('shows confirmed appointments without buttons', () => {
    expect(resolveLinkState(reminder('email', 'confirmed'), appointment('confirmed'), NOW)).toBe('confirmed');
    expect(resolveLinkState(reminder('email', 'sent'), appointment('confirmed'), NOW)).toBe('confirmed');
  });

  it('rejects unknown tokens, emails that never went out and other row types', () => {
    expect(resolveLinkState(null, null, NOW)).toBe('invalid');
    expect(resolveLinkState(reminder('email', 'sent'), null, NOW)).toBe('invalid');
    expect(resolveLinkState(reminder('email', 'failed'), appointment('scheduled'), NOW)).toBe('invalid');
    expect(resolveLinkState(reminder('email', 'skipped'), appointment('scheduled'), NOW)).toBe('invalid');
    expect(resolveLinkState(reminder('sms', 'sent'), appointment('scheduled'), NOW)).toBe('invalid');
    expect(resolveLinkState(reminder('email', 'sent'), appointment('unknown'), NOW)).toBe('invalid');
  });
});

describe('parseLinkAction', () => {
  it('accepts confirm/yes and cancel/no only', () => {
    expect(parseLinkAction('confirm')).toBe('confirm');
    expect(parseLinkAction('yes')).toBe('confirm');
    expect(parseLinkAction('cancel')).toBe('cancel');
    expect(parseLinkAction('no')).toBe('cancel');
    expect(parseLinkAction('YES')).toBeNull();
    expect(parseLinkAction(null)).toBeNull();
    expect(parseLinkAction(undefined)).toBeNull();
  });
});

describe('confirmPageStatus', () => {
  it('maps states to HTTP statuses', () => {
    expect(confirmPageStatus({ state: 'actionable' })).toBe(200);
    expect(confirmPageStatus({ state: 'confirmed' })).toBe(200);
    expect(confirmPageStatus({ state: 'cancelled' })).toBe(200);
    expect(confirmPageStatus({ state: 'test' })).toBe(200);
    expect(confirmPageStatus({ state: 'bad_request' })).toBe(400);
    expect(confirmPageStatus({ state: 'invalid' })).toBe(404);
    expect(confirmPageStatus({ state: 'expired' })).toBe(410);
    expect(confirmPageStatus({ state: 'superseded' })).toBe(410);
    expect(confirmPageStatus({ state: 'error' })).toBe(500);
  });
});

describe('renderConfirmPage', () => {
  const actionPath = '/api/confirm/0b6f9a52-8c55-4b6e-9d38-3f1f5e2a7c11';

  it('shows the details in salon time and two buttons that POST to the page', () => {
    const html = renderConfirmPage({ state: 'actionable', appointment: pageAppointment(), actionPath });
    expect(html).toContain('Salon Elena');
    expect(html).toContain('Haircut');
    expect(html).toContain('Tuesday 6 October at 10:00');
    expect(html).toContain('Awaiting your reply');
    expect(html.match(/<form method="post"/g)).toHaveLength(2);
    expect(html).toContain(`action="${actionPath}"`);
    expect(html).toContain('name="action" value="confirm"');
    expect(html).toContain('name="action" value="cancel"');
    expect(html).toContain('<meta name="robots" content="noindex, nofollow" />');
    // No links that act on GET.
    expect(html).not.toContain('href=');
  });

  it('puts the button the email pointed at first', () => {
    const cancelFirst = renderConfirmPage({ state: 'actionable', appointment: pageAppointment(), actionPath, intent: 'cancel' });
    expect(cancelFirst.indexOf('value="cancel"')).toBeLessThan(cancelFirst.indexOf('value="confirm"'));
    expect(cancelFirst).toContain('Cancel your appointment?');

    const confirmFirst = renderConfirmPage({ state: 'actionable', appointment: pageAppointment(), actionPath, intent: 'confirm' });
    expect(confirmFirst.indexOf('value="confirm"')).toBeLessThan(confirmFirst.indexOf('value="cancel"'));
  });

  it('shows the real status after an answer, without buttons', () => {
    const confirmed = renderConfirmPage({
      state: 'confirmed',
      appointment: pageAppointment({ status: 'confirmed' }),
      actionPath,
      outcome: 'confirmed',
    });
    expect(confirmed).toContain('Appointment confirmed');
    expect(confirmed).toContain('Salon Elena will see you on Tuesday 6 October at 10:00.');
    expect(confirmed).not.toContain('<form');

    const alreadyCancelled = renderConfirmPage({
      state: 'cancelled',
      appointment: pageAppointment({ status: 'cancelled' }),
      actionPath,
      outcome: 'unchanged',
    });
    expect(alreadyCancelled).toContain('This appointment has been cancelled.');
    expect(alreadyCancelled).not.toContain('<form');
  });

  it('shows test links as a harmless preview', () => {
    const html = renderConfirmPage({ state: 'test', appointment: pageAppointment(), actionPath });
    expect(html).toContain('test email');
    expect(html).toContain('It does not change your appointment.');
    expect(html).not.toContain('<form');
  });

  it('does not show details for expired, retired or invalid links', () => {
    const expired = renderConfirmPage({ state: 'expired', appointment: pageAppointment({ datetime: PAST }), actionPath });
    expect(expired).toContain('This link has expired');
    expect(expired).not.toContain('<form');

    const retired = renderConfirmPage({ state: 'superseded', appointment: pageAppointment(), actionPath });
    expect(retired).toContain('This link is no longer valid');
    expect(retired).not.toContain('Haircut');
    expect(retired).not.toContain('10:00');

    const invalid = renderConfirmPage({ state: 'invalid' });
    expect(invalid).toContain('This link is invalid');
    expect(invalid).not.toContain('Salon Elena');
  });

  it('escapes every interpolated value', () => {
    const html = renderConfirmPage({
      state: 'actionable',
      appointment: pageAppointment({ salonName: '<script>alert(1)</script>', serviceType: '"><img src=x onerror=alert(1)>' }),
      actionPath: '/api/confirm/"><script>x</script>',
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('action="/api/confirm/&quot;&gt;&lt;script&gt;x&lt;/script&gt;"');
  });

  it('survives an unreadable appointment time', () => {
    const html = renderConfirmPage({ state: 'expired', appointment: pageAppointment({ datetime: 'garbage' }) });
    expect(html).toContain('This link has expired');
  });
});
