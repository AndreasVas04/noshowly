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

  it('builds a confirmed event from the start and the duration, in UTC', () => {
    expect(buildICS('Studio Nine', 'Haircut', start, 45).split('\r\n')).toEqual([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Booking//EN',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      'DTSTART:20260415T073000Z',
      'DTEND:20260415T081500Z',
      'SUMMARY:Haircut at Studio Nine',
      'DESCRIPTION:Your appointment at Studio Nine.',
      'STATUS:CONFIRMED',
      'END:VEVENT',
      'END:VCALENDAR',
    ]);
  });

  it('separates lines with CRLF and has no trailing line break', () => {
    const ics = buildICS('Studio Nine', 'Haircut', start, 30);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('\r\nEND:VCALENDAR')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('calls a booking without a service an appointment', () => {
    expect(buildICS('Studio Nine', '', start, 30)).toContain('\r\nSUMMARY:Appointment at Studio Nine\r\n');
  });

  it('ends on the next day when the appointment runs past midnight UTC', () => {
    const late = buildICS('Studio Nine', 'Colour', new Date('2026-04-15T23:30:00Z'), 90);
    expect(late).toContain('\r\nDTEND:20260416T010000Z\r\n');
  });
});
