/**
 * app/book/[slug]/_components/__tests__/format.test.ts
 *
 * Unit tests for the booking page's formatting in
 * app/book/[slug]/_components/format.ts: 12-hour times, long dates, value
 * ranges and the .ics file.
 */

import { describe, expect, it } from 'vitest';
import {
  buildICS,
  formatDateLong,
  formatRange,
  formatTime12h,
} from '@/app/book/[slug]/_components/format';

describe('formatTime12h', () => {
  it('formats morning and afternoon times', () => {
    expect(formatTime12h('09:00')).toBe('9:00 AM');
    expect(formatTime12h('11:59')).toBe('11:59 AM');
    expect(formatTime12h('14:30')).toBe('2:30 PM');
    expect(formatTime12h('23:45')).toBe('11:45 PM');
  });

  it('shows midnight and noon as 12', () => {
    expect(formatTime12h('00:00')).toBe('12:00 AM');
    expect(formatTime12h('00:05')).toBe('12:05 AM');
    expect(formatTime12h('12:00')).toBe('12:00 PM');
  });
});

describe('formatDateLong', () => {
  it('formats the date itself, with its weekday', () => {
    expect(formatDateLong('2026-04-15')).toBe('Wednesday, April 15');
    expect(formatDateLong('2026-01-01')).toBe('Thursday, January 1');
    // Daylight saving starts in Europe on this day; the date must not shift.
    expect(formatDateLong('2026-03-29')).toBe('Sunday, March 29');
  });
});

describe('formatRange', () => {
  const minutes = (n: number) => `${n}`;
  const euros = (n: number) => `€${n.toFixed(2)}`;

  it('returns null without values', () => {
    expect(formatRange([], minutes)).toBeNull();
  });

  it('shows equal values once', () => {
    expect(formatRange([30], minutes)).toBe('30');
    expect(formatRange([30, 30], minutes)).toBe('30');
  });

  it('shows the lowest and highest value with an en dash', () => {
    expect(formatRange([45, 30, 60, 30], minutes)).toBe('30–60');
    expect(formatRange([25, 20], euros)).toBe('€20.00–€25.00');
  });
});

describe('buildICS', () => {
  const start = new Date('2026-04-15T07:30:00Z');
  const stamp = new Date('2026-04-01T12:00:05Z');
  const event = (overrides: Partial<Parameters<typeof buildICS>[0]> = {}) =>
    buildICS({ uid: 'appt-1', salonName: 'Studio Nine', service: 'Haircut', start, durationMinutes: 45, stamp, ...overrides });

  it('builds a confirmed event from the start and the duration, in UTC', () => {
    expect(event().split('\r\n')).toEqual([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Noshowly//Booking//EN',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      'UID:appt-1@noshowly',
      'DTSTAMP:20260401T120005Z',
      'DTSTART:20260415T073000Z',
      'DTEND:20260415T081500Z',
      'SUMMARY:Haircut at Studio Nine',
      'DESCRIPTION:Your appointment at Studio Nine.',
      'STATUS:CONFIRMED',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ]);
  });

  it('ends every line with CRLF and has no other line breaks', () => {
    const ics = event({ durationMinutes: 30 });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('\r\nEND:VCALENDAR\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('calls a booking without a service an appointment', () => {
    expect(event({ service: '' })).toContain('\r\nSUMMARY:Appointment at Studio Nine\r\n');
  });

  it('ends on the next day when the appointment runs past midnight UTC', () => {
    const late = event({ service: 'Colour', start: new Date('2026-04-15T23:30:00Z'), durationMinutes: 90 });
    expect(late).toContain('\r\nDTEND:20260416T010000Z\r\n');
  });

  it('escapes commas, semicolons, backslashes and line breaks in text', () => {
    const ics = event({ salonName: 'Cuts, Colour; Co\\Style\nNicosia', service: 'Cut, wash' });
    expect(ics).toContain('\r\nSUMMARY:Cut\\, wash at Cuts\\, Colour\\; Co\\\\Style\\nNicosia\r\n');
    expect(ics).toContain('\r\nDESCRIPTION:Your appointment at Cuts\\, Colour\\; Co\\\\Style\\nNicosia.\r\n');
  });

  it('folds lines longer than 75 octets without splitting characters', () => {
    const salonName = 'Κομμωτήριο '.repeat(8).trim();
    const ics = event({ salonName });
    const lines = ics.split('\r\n');
    for (const line of lines) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
      expect(line).not.toMatch(/\uFFFD/);
    }
    // Unfolding gives the original line back.
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain(`\r\nSUMMARY:Haircut at ${salonName}\r\n`);
    expect(lines.some((line) => line.startsWith(' '))).toBe(true);
  });
});
