/**
 * lib/time.ts
 *
 * Timezone-aware date and time helpers shared by API routes and Client Components.
 *
 * Every salon has an IANA timezone (salons.timezone). Appointment times are
 * stored as UTC instants (TIMESTAMPTZ) and must be entered, shown, grouped and
 * validated in the salon's timezone, never in the server's timezone (UTC on
 * Vercel) or the visitor's browser timezone.
 *
 * Conventions used throughout:
 *  - A "date" is a calendar date string 'YYYY-MM-DD' with no timezone.
 *  - A "time" is a zero-padded 24-hour wall-clock string 'HH:MM'.
 *  - An instant is a Date (or an ISO 8601 string) in UTC.
 *
 * Conversions use only the built-in Intl API and are exact across daylight
 * saving changes:
 *  - A wall-clock time that does not exist (skipped when clocks go forward) is
 *    reported instead of being silently shifted.
 *  - A wall-clock time that happens twice (when clocks go back) resolves to
 *    the first occurrence.
 *
 * Date-only values ('YYYY-MM-DD') are formatted with timeZone 'UTC' so the
 * displayed day never depends on the browser's timezone.
 *
 * No imports from Next.js or Supabase, so this is safe to use anywhere.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;
/** Accepts 'H:MM', 'HH:MM', 'HH:MM:SS' and 'HH:MM:SS.fff' (Postgres TIME output). */
const LOOSE_TIME_PATTERN = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
/** IANA-style names only (e.g. 'Europe/Nicosia', 'UTC', 'Etc/GMT+2'); rejects raw offsets like '+02:00'. */
const TIME_ZONE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Numeric parts of a 'YYYY-MM-DD' date. `month` is 1–12. */
export type DateParts = { year: number; month: number; day: number };

/** Numeric parts of an 'HH:MM' time. */
export type TimeParts = { hour: number; minute: number };

/** An instant expressed as wall-clock values in a timezone. */
export type ZonedParts = {
  /** 'YYYY-MM-DD' in the timezone. */
  date: string;
  /** 'HH:MM' (24-hour) in the timezone. */
  time: string;
  /** 0 = Sunday … 6 = Saturday, matching staff_availability.day_of_week. */
  dayOfWeek: number;
};

/** Why a wall-clock time could not be converted to an instant. */
export type ZonedTimeError =
  | 'invalid_date'
  | 'invalid_time'
  | 'invalid_timezone'
  | 'nonexistent_time';

/** Result of resolveZonedTime(). */
export type ZonedTimeResult =
  | { ok: true; date: Date }
  | { ok: false; reason: ZonedTimeError };

/**
 * How resolveZonedTime() treats a wall-clock time skipped by a forward clock change.
 *  - 'reject': report it as 'nonexistent_time' (use for times a person picked).
 *  - 'shift':  move it forward by the length of the gap, e.g. 02:30 → 03:30 when
 *              clocks jump from 02:00 to 03:00 (use for boundaries such as the
 *              start of a working interval or of a day).
 */
export type NonexistentTimeHandling = 'reject' | 'shift';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Pads a non-negative integer to two digits. */
function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

/** Builds a 'YYYY-MM-DD' string from numeric parts. */
function formatDateParts(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

/**
 * Converts an ISO string, Date or epoch milliseconds to epoch milliseconds.
 *
 * @throws RangeError when the value is not a valid instant.
 */
function toEpochMs(value: string | Date | number): number {
  const ms =
    typeof value === 'number' ? value
    : value instanceof Date   ? value.getTime()
    : new Date(value).getTime();
  if (!Number.isFinite(ms)) {
    throw new RangeError(`Invalid instant: ${String(value)}`);
  }
  return ms;
}

// ---------------------------------------------------------------------------
// Parsing and validation
// ---------------------------------------------------------------------------

/**
 * Parses a strict 'YYYY-MM-DD' calendar date. Rejects dates that do not exist
 * on the calendar (e.g. '2026-02-31', '2026-13-01').
 *
 * @param value - Candidate date string.
 * @returns     Numeric parts, or null when invalid.
 */
export function parseDateOnly(value: unknown): DateParts | null {
  if (typeof value !== 'string') return null;
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;

  const year  = Number(match[1]);
  const month = Number(match[2]);
  const day   = Number(match[3]);
  if (year < 1000 || month < 1 || month > 12 || day < 1) return null;

  // Day 0 of the following month is the last day of this month.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;

  return { year, month, day };
}

/** Returns true for a real calendar date in strict 'YYYY-MM-DD' form. */
export function isValidDateString(value: unknown): value is string {
  return parseDateOnly(value) !== null;
}

/**
 * Parses a strict, zero-padded 24-hour 'HH:MM' time from 00:00 to 23:59.
 * '24:00', '9:00' and '09:00:00' are rejected; use normaliseTime() for loose input.
 *
 * @param value - Candidate time string.
 * @returns     Numeric parts, or null when invalid.
 */
export function parseTime(value: unknown): TimeParts | null {
  if (typeof value !== 'string') return null;
  const match = TIME_PATTERN.exec(value);
  if (!match) return null;

  const hour   = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;

  return { hour, minute };
}

/** Returns true for a strict, zero-padded 'HH:MM' time from 00:00 to 23:59. */
export function isValidTimeString(value: unknown): value is string {
  return parseTime(value) !== null;
}

/**
 * Normalises a loosely formatted time to zero-padded 'HH:MM'.
 * Accepts '9:00', '09:00' and Postgres TIME output such as '09:00:00'.
 * Seconds are dropped.
 *
 * @param value - Candidate time.
 * @returns     'HH:MM', or null when the value is not a valid time of day.
 *
 * @example normaliseTime('09:00:00') // '09:00'
 * @example normaliseTime('9:00')     // '09:00'
 * @example normaliseTime('24:00')    // null
 */
export function normaliseTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = LOOSE_TIME_PATTERN.exec(value.trim());
  if (!match) return null;

  const hour   = Number(match[1]);
  const minute = Number(match[2]);
  const second = match[3] ? Number(match[3]) : 0;
  if (hour > 23 || minute > 59 || second > 59) return null;

  return `${pad2(hour)}:${pad2(minute)}`;
}

/**
 * Converts an 'HH:MM' time to minutes since midnight.
 *
 * @param time - Valid 'HH:MM' string (see normaliseTime()).
 * @returns    Minutes since 00:00, e.g. '09:30' → 570.
 */
export function timeToMinutes(time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

/**
 * Converts minutes since midnight (0–1439) to 'HH:MM'.
 *
 * @param minutes - Minutes since 00:00.
 * @returns       'HH:MM', e.g. 570 → '09:30'.
 */
export function minutesToTime(minutes: number): string {
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

/**
 * Returns true when the value is an IANA timezone name the Intl API accepts,
 * e.g. 'Europe/Nicosia' or 'UTC'. Raw offsets such as '+02:00' are rejected.
 *
 * @param value - Candidate timezone.
 */
export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return false;
  if (!TIME_ZONE_NAME_PATTERN.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the timezone when it is valid, otherwise 'UTC'. Use when reading a
 * stored salon timezone so a bad value can never crash date formatting.
 *
 * @param value - Stored timezone.
 */
export function resolveTimeZone(value: unknown): string {
  return isValidTimeZone(value) ? value : 'UTC';
}

/**
 * Returns the browser's timezone, or 'UTC' when it is not a valid IANA name.
 * The dashboard only uses it when the salon's timezone cannot be loaded.
 */
export function browserTimeZone(): string {
  try {
    return resolveTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return 'UTC';
  }
}

/**
 * Formats a timezone name for display.
 *
 * @param timeZone - IANA timezone.
 * @returns        The name with spaces, e.g. 'America/New_York' → 'America/New York'.
 */
export function formatTimeZoneLabel(timeZone: string): string {
  return timeZone.replace(/_/g, ' ');
}

// ---------------------------------------------------------------------------
// Intl plumbing
// ---------------------------------------------------------------------------

/** One formatter per timezone; constructing Intl formatters is relatively slow. */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

/**
 * Returns a cached formatter that reports full wall-clock fields for a timezone.
 *
 * @param timeZone - Valid IANA timezone.
 */
function getWallClockFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year:   'numeric',
      month:  '2-digit',
      day:    '2-digit',
      hour:   '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/** Wall-clock fields of an instant in a timezone. */
type WallClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/**
 * Reads the wall-clock fields of an instant in a timezone.
 *
 * @param ms       - Epoch milliseconds.
 * @param timeZone - Valid IANA timezone.
 */
function getWallClock(ms: number, timeZone: string): WallClock {
  const fields: Record<string, string> = {};
  for (const part of getWallClockFormatter(timeZone).formatToParts(new Date(ms))) {
    if (part.type !== 'literal') fields[part.type] = part.value;
  }
  const hour = Number(fields.hour);
  return {
    year:   Number(fields.year),
    month:  Number(fields.month),
    day:    Number(fields.day),
    // Some engines report midnight as "24" even with hourCycle h23.
    hour:   hour === 24 ? 0 : hour,
    minute: Number(fields.minute),
    second: Number(fields.second),
  };
}

/**
 * Returns the wall-clock reading of an instant, encoded as if it were UTC
 * (so two readings can be compared or subtracted as plain numbers).
 */
function wallClockAsUtcMs(ms: number, timeZone: string): number {
  const w = getWallClock(ms, timeZone);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
}

/**
 * Returns the timezone's UTC offset at an instant, in milliseconds
 * (positive east of UTC, e.g. +3 h for Europe/Nicosia in summer).
 */
function getOffsetMs(ms: number, timeZone: string): number {
  return wallClockAsUtcMs(ms, timeZone) - Math.floor(ms / 1000) * 1000;
}

// ---------------------------------------------------------------------------
// Wall clock → instant
// ---------------------------------------------------------------------------

/**
 * Converts a wall-clock date and time in a timezone to the exact UTC instant.
 *
 * Handles daylight saving changes exactly:
 *  - Skipped times (e.g. 02:30 on the night clocks go 02:00 → 03:00) return
 *    { ok: false, reason: 'nonexistent_time' }, or are moved forward by the
 *    gap when `nonexistent: 'shift'` is passed.
 *  - Repeated times (e.g. 01:30 on the night clocks go 02:00 → 01:00) resolve
 *    to the first occurrence.
 *
 * @param date     - 'YYYY-MM-DD' wall-clock date.
 * @param time     - Strict 'HH:MM' wall-clock time.
 * @param timeZone - IANA timezone of the wall clock.
 * @param options  - `nonexistent`: 'reject' (default) or 'shift'.
 * @returns        The instant, or the reason the input cannot be converted.
 */
export function resolveZonedTime(
  date: string,
  time: string,
  timeZone: string,
  options: { nonexistent?: NonexistentTimeHandling } = {},
): ZonedTimeResult {
  const dateParts = parseDateOnly(date);
  if (!dateParts) return { ok: false, reason: 'invalid_date' };
  const timeParts = parseTime(time);
  if (!timeParts) return { ok: false, reason: 'invalid_time' };
  if (!isValidTimeZone(timeZone)) return { ok: false, reason: 'invalid_timezone' };

  // The wall-clock reading we are looking for, encoded as if it were UTC.
  const target = Date.UTC(
    dateParts.year, dateParts.month - 1, dateParts.day, timeParts.hour, timeParts.minute,
  );

  // Any instant showing `target` equals target minus the offset in force at that
  // instant. Offsets change at most once around a given day, so the offsets a
  // day before, at, and a day after cover every candidate.
  const candidates = new Set<number>();
  for (const probe of [target - DAY_MS, target, target + DAY_MS]) {
    candidates.add(target - getOffsetMs(probe, timeZone));
  }

  const matches = [...candidates]
    .filter((ms) => wallClockAsUtcMs(ms, timeZone) === target)
    .sort((a, b) => a - b);

  if (matches.length > 0) {
    // One match normally; two when clocks go back — the first occurrence wins.
    return { ok: true, date: new Date(matches[0]) };
  }

  // No instant shows this wall-clock time: it falls in a forward-change gap.
  if (options.nonexistent === 'shift') {
    // Using the offset in force before the change lands as far past the jump
    // as the time was past its start (02:30 → 03:30 for a 02:00 → 03:00 jump).
    return { ok: true, date: new Date(target - getOffsetMs(target - DAY_MS, timeZone)) };
  }
  return { ok: false, reason: 'nonexistent_time' };
}

/**
 * Converts a wall-clock date and time in a timezone to the exact UTC instant.
 * Convenience wrapper around resolveZonedTime() for callers that only need
 * the instant.
 *
 * @param date     - 'YYYY-MM-DD' wall-clock date.
 * @param time     - Strict 'HH:MM' wall-clock time.
 * @param timeZone - IANA timezone.
 * @returns        The instant, or null when the input is invalid or the time
 *                 does not exist on that date (skipped by a clock change).
 *
 * @example zonedTimeToUtc('2026-10-04', '09:00', 'Australia/Sydney') // 2026-10-03T22:00:00.000Z
 */
export function zonedTimeToUtc(date: string, time: string, timeZone: string): Date | null {
  const result = resolveZonedTime(date, time, timeZone);
  return result.ok ? result.date : null;
}

// ---------------------------------------------------------------------------
// Instant → wall clock
// ---------------------------------------------------------------------------

/**
 * Returns the wall-clock date, time and day of week of an instant in a timezone.
 *
 * @param value    - ISO string, Date or epoch milliseconds.
 * @param timeZone - Valid IANA timezone.
 * @throws RangeError when the instant or timezone is invalid.
 */
export function utcToZonedParts(value: string | Date | number, timeZone: string): ZonedParts {
  const w = getWallClock(toEpochMs(value), timeZone);
  return {
    date:      formatDateParts(w.year, w.month, w.day),
    time:      `${pad2(w.hour)}:${pad2(w.minute)}`,
    dayOfWeek: new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay(),
  };
}

/**
 * Formats an instant as a 24-hour 'HH:MM' time in a timezone.
 *
 * @param value    - ISO string, Date or epoch milliseconds.
 * @param timeZone - Valid IANA timezone.
 * @returns        'HH:MM', e.g. '09:30'.
 */
export function formatTimeInZone(value: string | Date | number, timeZone: string): string {
  return utcToZonedParts(value, timeZone).time;
}

/**
 * Returns today's date in a timezone.
 *
 * @param timeZone - Valid IANA timezone.
 * @param now      - Current instant (injectable for tests).
 * @returns        'YYYY-MM-DD'.
 */
export function todayInZone(timeZone: string, now: Date = new Date()): string {
  return utcToZonedParts(now, timeZone).date;
}

/**
 * Returns the UTC instants that bound a calendar day in a timezone, as a
 * half-open range [start, end). The range is 23 or 25 hours long on days when
 * the clocks change.
 *
 * @param date     - 'YYYY-MM-DD'.
 * @param timeZone - Valid IANA timezone.
 * @throws RangeError when the date or timezone is invalid.
 *
 * @example dayRangeUtc('2026-06-01', 'Europe/Nicosia')
 *          // { start: 2026-05-31T21:00:00Z, end: 2026-06-01T21:00:00Z }
 */
export function dayRangeUtc(date: string, timeZone: string): { start: Date; end: Date } {
  const start = resolveZonedTime(date, '00:00', timeZone, { nonexistent: 'shift' });
  if (!start.ok) throw new RangeError(`Cannot resolve ${date} in ${timeZone}: ${start.reason}`);
  const end = resolveZonedTime(addDaysToDate(date, 1), '00:00', timeZone, { nonexistent: 'shift' });
  if (!end.ok) throw new RangeError(`Cannot resolve the day after ${date} in ${timeZone}: ${end.reason}`);
  return { start: start.date, end: end.date };
}

// ---------------------------------------------------------------------------
// Calendar-date arithmetic (no timezone involved)
// ---------------------------------------------------------------------------

/**
 * Adds a number of calendar days to a date.
 *
 * @param date - 'YYYY-MM-DD'.
 * @param days - Days to add (negative to subtract).
 * @returns    'YYYY-MM-DD'.
 * @throws RangeError when the date is invalid.
 */
export function addDaysToDate(date: string, days: number): string {
  const parts = parseDateOnly(date);
  if (!parts) throw new RangeError(`Invalid date: ${date}`);
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return formatDateParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/**
 * Returns the day of week of a calendar date.
 *
 * @param date - 'YYYY-MM-DD'.
 * @returns    0 = Sunday … 6 = Saturday.
 * @throws RangeError when the date is invalid.
 */
export function dayOfWeekForDate(date: string): number {
  const parts = parseDateOnly(date);
  if (!parts) throw new RangeError(`Invalid date: ${date}`);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

/**
 * Returns the first day of the week containing a date.
 *
 * @param date         - 'YYYY-MM-DD'.
 * @param weekStartsOn - 0 = Sunday, 1 = Monday (default).
 * @returns            'YYYY-MM-DD'.
 */
export function startOfWeekDate(date: string, weekStartsOn = 1): string {
  const offset = (dayOfWeekForDate(date) - weekStartsOn + 7) % 7;
  return addDaysToDate(date, -offset);
}

/**
 * Formats a calendar date for display without ever shifting the day.
 *
 * `new Date('2026-04-15')` is midnight UTC, which a browser east or west of
 * UTC may show as the 14th or 16th. Formatting with timeZone 'UTC' shows the
 * date exactly as written, wherever the browser is.
 *
 * @param date    - 'YYYY-MM-DD'.
 * @param options - Intl date options (weekday, month, day, year …).
 * @param locale  - Display locale. Defaults to 'en-US'.
 * @returns       Formatted date, e.g. 'Wednesday, April 15'.
 * @throws RangeError when the date is invalid.
 */
export function formatDateOnly(
  date: string,
  options: Intl.DateTimeFormatOptions,
  locale = 'en-US',
): string {
  const parts = parseDateOnly(date);
  if (!parts) throw new RangeError(`Invalid date: ${date}`);
  const noonUtc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12));
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(noonUtc);
}
