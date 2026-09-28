/**
 * lib/__tests__/time.test.ts
 *
 * Unit tests for the timezone helpers in lib/time.ts, including the daylight
 * saving transitions of the timezones the product is used in.
 */

import { describe, expect, it } from 'vitest';
import {
  addDaysToDate,
  dayOfWeekForDate,
  dayRangeUtc,
  formatDateOnly,
  formatTimeInZone,
  isValidDateString,
  isValidTimeString,
  isValidTimeZone,
  minutesToTime,
  normaliseTime,
  resolveTimeZone,
  resolveZonedTime,
  startOfWeekDate,
  timeToMinutes,
  todayInZone,
  utcToZonedParts,
  zonedTimeToUtc,
} from '@/lib/time';

/** Shorthand: converts and returns the ISO string (or null). */
function toIso(date: string, time: string, tz: string): string | null {
  return zonedTimeToUtc(date, time, tz)?.toISOString() ?? null;
}

describe('isValidTimeZone', () => {
  it('accepts IANA names and UTC', () => {
    expect(isValidTimeZone('Europe/Nicosia')).toBe(true);
    expect(isValidTimeZone('America/Argentina/Buenos_Aires')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Etc/GMT+2')).toBe(true);
  });

  it('rejects unknown names, offsets and non-strings', () => {
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isValidTimeZone('+02:00')).toBe(false);
    expect(isValidTimeZone(' Europe/Nicosia')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
  });

  it('resolveTimeZone falls back to UTC', () => {
    expect(resolveTimeZone('Asia/Tokyo')).toBe('Asia/Tokyo');
    expect(resolveTimeZone('Nowhere/Special')).toBe('UTC');
    expect(resolveTimeZone(undefined)).toBe('UTC');
  });
});

describe('date and time parsing', () => {
  it('accepts real calendar dates only', () => {
    expect(isValidDateString('2026-02-28')).toBe(true);
    expect(isValidDateString('2028-02-29')).toBe(true);
    expect(isValidDateString('2026-02-29')).toBe(false);
    expect(isValidDateString('2026-02-31')).toBe(false);
    expect(isValidDateString('2026-13-01')).toBe(false);
    expect(isValidDateString('2026-1-01')).toBe(false);
    expect(isValidDateString('26-01-01')).toBe(false);
  });

  it('accepts strict HH:MM between 00:00 and 23:59', () => {
    expect(isValidTimeString('00:00')).toBe(true);
    expect(isValidTimeString('23:59')).toBe(true);
    expect(isValidTimeString('24:00')).toBe(false);
    expect(isValidTimeString('9:00')).toBe(false);
    expect(isValidTimeString('09:00:00')).toBe(false);
    expect(isValidTimeString('12:60')).toBe(false);
  });

  it('normalises loose times to HH:MM', () => {
    expect(normaliseTime('09:00:00')).toBe('09:00');
    expect(normaliseTime('9:00')).toBe('09:00');
    expect(normaliseTime('09:00')).toBe('09:00');
    expect(normaliseTime('17:30:00.000')).toBe('17:30');
    expect(normaliseTime(' 08:15 ')).toBe('08:15');
    expect(normaliseTime('24:00')).toBeNull();
    expect(normaliseTime('9')).toBeNull();
    expect(normaliseTime('ab:cd')).toBeNull();
    expect(normaliseTime(null)).toBeNull();
  });

  it('converts between times and minutes', () => {
    expect(timeToMinutes('00:00')).toBe(0);
    expect(timeToMinutes('09:30')).toBe(570);
    expect(minutesToTime(570)).toBe('09:30');
    expect(minutesToTime(1439)).toBe('23:59');
  });
});

describe('zonedTimeToUtc', () => {
  it('converts ordinary times', () => {
    expect(toIso('2026-06-15', '09:00', 'Europe/Nicosia')).toBe('2026-06-15T06:00:00.000Z');
    expect(toIso('2026-01-15', '09:00', 'Europe/Nicosia')).toBe('2026-01-15T07:00:00.000Z');
    expect(toIso('2026-06-15', '09:00', 'UTC')).toBe('2026-06-15T09:00:00.000Z');
  });

  it('handles Europe/Nicosia daylight saving days', () => {
    // Clocks go 03:00 → 04:00 on 29 March 2026.
    expect(toIso('2026-03-28', '09:00', 'Europe/Nicosia')).toBe('2026-03-28T07:00:00.000Z');
    expect(toIso('2026-03-29', '09:00', 'Europe/Nicosia')).toBe('2026-03-29T06:00:00.000Z');
    expect(toIso('2026-03-29', '02:59', 'Europe/Nicosia')).toBe('2026-03-29T00:59:00.000Z');
    expect(toIso('2026-03-29', '03:30', 'Europe/Nicosia')).toBeNull();
    expect(toIso('2026-03-29', '04:00', 'Europe/Nicosia')).toBe('2026-03-29T01:00:00.000Z');
    // Clocks go 04:00 → 03:00 on 25 October 2026: 03:30 happens twice.
    expect(toIso('2026-10-25', '03:30', 'Europe/Nicosia')).toBe('2026-10-25T00:30:00.000Z');
    expect(toIso('2026-10-25', '09:00', 'Europe/Nicosia')).toBe('2026-10-25T07:00:00.000Z');
  });

  it('handles America/New_York daylight saving days', () => {
    // Clocks go 02:00 → 03:00 on 8 March 2026.
    expect(toIso('2026-03-07', '09:00', 'America/New_York')).toBe('2026-03-07T14:00:00.000Z');
    expect(toIso('2026-03-08', '09:00', 'America/New_York')).toBe('2026-03-08T13:00:00.000Z');
    expect(toIso('2026-03-08', '02:30', 'America/New_York')).toBeNull();
    // Clocks go 02:00 → 01:00 on 1 November 2026: 01:30 happens twice.
    expect(toIso('2026-11-01', '01:30', 'America/New_York')).toBe('2026-11-01T05:30:00.000Z');
    expect(toIso('2026-11-01', '09:00', 'America/New_York')).toBe('2026-11-01T14:00:00.000Z');
  });

  it('handles Australia/Sydney daylight saving days', () => {
    // Clocks go 02:00 → 03:00 on 4 October 2026.
    expect(toIso('2026-10-03', '09:00', 'Australia/Sydney')).toBe('2026-10-02T23:00:00.000Z');
    expect(toIso('2026-10-04', '09:00', 'Australia/Sydney')).toBe('2026-10-03T22:00:00.000Z');
    expect(toIso('2026-10-04', '02:30', 'Australia/Sydney')).toBeNull();
    // Clocks go 03:00 → 02:00 on 5 April 2026: 02:30 happens twice.
    expect(toIso('2026-04-05', '02:30', 'Australia/Sydney')).toBe('2026-04-04T15:30:00.000Z');
    expect(toIso('2026-04-05', '09:00', 'Australia/Sydney')).toBe('2026-04-04T23:00:00.000Z');
  });

  it('handles Pacific/Auckland daylight saving days', () => {
    // Clocks go 02:00 → 03:00 on 27 September 2026.
    expect(toIso('2026-09-26', '09:00', 'Pacific/Auckland')).toBe('2026-09-25T21:00:00.000Z');
    expect(toIso('2026-09-27', '09:00', 'Pacific/Auckland')).toBe('2026-09-26T20:00:00.000Z');
    expect(toIso('2026-09-27', '02:30', 'Pacific/Auckland')).toBeNull();
    // Clocks go 03:00 → 02:00 on 5 April 2026: 02:30 happens twice.
    expect(toIso('2026-04-05', '02:30', 'Pacific/Auckland')).toBe('2026-04-04T13:30:00.000Z');
    expect(toIso('2026-04-05', '09:00', 'Pacific/Auckland')).toBe('2026-04-04T21:00:00.000Z');
  });

  it('rejects invalid input', () => {
    expect(zonedTimeToUtc('2026-02-31', '09:00', 'UTC')).toBeNull();
    expect(zonedTimeToUtc('2026-03-01', '24:00', 'UTC')).toBeNull();
    expect(zonedTimeToUtc('2026-03-01', '09:00', 'Not/AZone')).toBeNull();
  });
});

describe('resolveZonedTime', () => {
  it('reports why a time cannot be converted', () => {
    expect(resolveZonedTime('2026-02-31', '09:00', 'UTC')).toEqual({ ok: false, reason: 'invalid_date' });
    expect(resolveZonedTime('2026-03-01', '9:00', 'UTC')).toEqual({ ok: false, reason: 'invalid_time' });
    expect(resolveZonedTime('2026-03-01', '09:00', 'Bad/Zone')).toEqual({ ok: false, reason: 'invalid_timezone' });
    expect(resolveZonedTime('2026-03-08', '02:30', 'America/New_York')).toEqual({
      ok: false,
      reason: 'nonexistent_time',
    });
  });

  it('shifts skipped times forward by the gap when asked', () => {
    const shifted = resolveZonedTime('2026-03-08', '02:30', 'America/New_York', { nonexistent: 'shift' });
    expect(shifted.ok).toBe(true);
    if (shifted.ok) {
      expect(shifted.date.toISOString()).toBe('2026-03-08T07:30:00.000Z');
      expect(formatTimeInZone(shifted.date, 'America/New_York')).toBe('03:30');
    }
  });
});

describe('utcToZonedParts and formatTimeInZone', () => {
  it('returns local date, time and weekday', () => {
    expect(utcToZonedParts('2026-06-15T21:30:00Z', 'Europe/Nicosia')).toEqual({
      date: '2026-06-16',
      time: '00:30',
      dayOfWeek: 2,
    });
    expect(utcToZonedParts('2026-06-15T21:30:00Z', 'America/New_York')).toEqual({
      date: '2026-06-15',
      time: '17:30',
      dayOfWeek: 1,
    });
  });

  it('formats midnight as 00:00', () => {
    expect(formatTimeInZone('2026-06-15T21:00:00Z', 'Europe/Nicosia')).toBe('00:00');
  });

  it('distinguishes both occurrences of a repeated hour', () => {
    expect(formatTimeInZone('2026-11-01T05:30:00Z', 'America/New_York')).toBe('01:30');
    expect(formatTimeInZone('2026-11-01T06:30:00Z', 'America/New_York')).toBe('01:30');
  });
});

describe('dayRangeUtc', () => {
  it('covers an ordinary day', () => {
    const { start, end } = dayRangeUtc('2026-06-01', 'Europe/Nicosia');
    expect(start.toISOString()).toBe('2026-05-31T21:00:00.000Z');
    expect(end.toISOString()).toBe('2026-06-01T21:00:00.000Z');
  });

  it('is 23 hours long when clocks go forward', () => {
    const { start, end } = dayRangeUtc('2026-03-29', 'Europe/Nicosia');
    expect(start.toISOString()).toBe('2026-03-28T22:00:00.000Z');
    expect(end.toISOString()).toBe('2026-03-29T21:00:00.000Z');
    expect(end.getTime() - start.getTime()).toBe(23 * 3_600_000);
  });

  it('is 25 hours long when clocks go back', () => {
    const { start, end } = dayRangeUtc('2026-11-01', 'America/New_York');
    expect(start.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-02T05:00:00.000Z');
    expect(end.getTime() - start.getTime()).toBe(25 * 3_600_000);
  });

  it('works for timezones east of UTC+12', () => {
    const { start, end } = dayRangeUtc('2026-01-10', 'Pacific/Auckland');
    expect(start.toISOString()).toBe('2026-01-09T11:00:00.000Z');
    expect(end.toISOString()).toBe('2026-01-10T11:00:00.000Z');
  });
});

describe('todayInZone', () => {
  it('uses the salon timezone, not UTC', () => {
    const now = new Date('2026-06-15T22:30:00Z');
    expect(todayInZone('UTC', now)).toBe('2026-06-15');
    expect(todayInZone('Europe/Nicosia', now)).toBe('2026-06-16');
    expect(todayInZone('America/Los_Angeles', now)).toBe('2026-06-15');
    expect(todayInZone('Pacific/Kiritimati', now)).toBe('2026-06-16');
  });
});

describe('calendar-date arithmetic', () => {
  it('adds days across month and year ends', () => {
    expect(addDaysToDate('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDaysToDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToDate('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDaysToDate('2026-03-29', 90)).toBe('2026-06-27');
  });

  it('returns the day of week', () => {
    expect(dayOfWeekForDate('2026-09-28')).toBe(1); // Monday
    expect(dayOfWeekForDate('2026-10-04')).toBe(0); // Sunday
  });

  it('finds the start of the week', () => {
    expect(startOfWeekDate('2026-10-04')).toBe('2026-09-28'); // Sunday → Monday before
    expect(startOfWeekDate('2026-09-28')).toBe('2026-09-28');
    expect(startOfWeekDate('2026-10-01', 0)).toBe('2026-09-27');
  });
});

describe('formatDateOnly', () => {
  it('never shifts the day, whatever the environment timezone', () => {
    expect(formatDateOnly('2026-04-15', { weekday: 'long', month: 'long', day: 'numeric' })).toBe(
      'Wednesday, April 15',
    );
    expect(formatDateOnly('2026-01-01', { month: 'short', day: 'numeric', year: 'numeric' })).toBe(
      'Jan 1, 2026',
    );
  });
});
