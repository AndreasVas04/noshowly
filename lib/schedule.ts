/**
 * lib/schedule.ts
 *
 * Weekly staff schedule helpers for the availability editor
 * (components/dashboard/booking-settings/) and POST /api/staff-availability.
 *
 * The editor shows a working day as one working window with any number of
 * breaks. The database stores the time actually worked as a list of intervals
 * in staff_availability.time_slots, e.g. 09:00–17:00 with a 13:00–14:00 break
 * is stored as [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }].
 *
 * No imports from Next.js or Supabase, so this is safe to use anywhere.
 */

import type { TimeSlot } from '@/types';
import { sanitiseIntervals } from '@/lib/availability';
import { normaliseTime } from '@/lib/time';

// ---------------------------------------------------------------------------
// Constants and types
// ---------------------------------------------------------------------------

/** Upper bound on stored intervals per day (a working window with 23 breaks). */
export const MAX_TIME_SLOTS_PER_DAY = 24;

/** Editor model of one working day. Times are 'HH:MM'. */
export type WorkingDay = {
  work_start: string;
  work_end: string;
  breaks: TimeSlot[];
};

/** Result of validateTimeSlots(). */
export type TimeSlotsValidation =
  | { ok: true; slots: TimeSlot[] }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Editor model ↔ stored intervals
// ---------------------------------------------------------------------------

/**
 * Converts stored intervals to the editor model. The working window runs from
 * the first start to the last end, and every gap between consecutive
 * intervals becomes a break, so no break is ever lost.
 *
 * @param slots - Stored time_slots (untrusted JSON).
 * @returns     The working day, or null when there are no valid intervals.
 */
export function timeSlotsToWorkingDay(slots: unknown): WorkingDay | null {
  const intervals = sanitiseIntervals(slots);
  if (intervals.length === 0) return null;

  const breaks: TimeSlot[] = [];
  for (let i = 1; i < intervals.length; i++) {
    breaks.push({ start: intervals[i - 1].end, end: intervals[i].start });
  }
  return {
    work_start: intervals[0].start,
    work_end:   intervals[intervals.length - 1].end,
    breaks,
  };
}

/**
 * Cleans the breaks of a working day: clamps each break to the working
 * window, drops empty, inverted or malformed breaks, sorts them and merges
 * breaks that overlap or touch.
 *
 * Also used by "Apply to all days", so copied breaks respect each day's hours.
 *
 * @param workStart - Working window start ('HH:MM').
 * @param workEnd   - Working window end ('HH:MM').
 * @param breaks    - Breaks as edited.
 * @returns         Clean breaks, or [] when the working window itself is invalid.
 */
export function normaliseBreaks(
  workStart: string,
  workEnd: string,
  breaks: readonly TimeSlot[],
): TimeSlot[] {
  const windowStart = normaliseTime(workStart);
  const windowEnd   = normaliseTime(workEnd);
  if (!windowStart || !windowEnd || windowStart >= windowEnd) return [];

  const clamped: TimeSlot[] = [];
  for (const brk of breaks) {
    const breakStart = normaliseTime(brk.start);
    const breakEnd   = normaliseTime(brk.end);
    if (!breakStart || !breakEnd) continue;
    const start = breakStart < windowStart ? windowStart : breakStart;
    const end   = breakEnd > windowEnd ? windowEnd : breakEnd;
    if (start < end) clamped.push({ start, end });
  }
  clamped.sort((a, b) => a.start.localeCompare(b.start));

  const merged: TimeSlot[] = [];
  for (const brk of clamped) {
    const last = merged[merged.length - 1];
    if (last && brk.start <= last.end) {
      if (brk.end > last.end) last.end = brk.end;
    } else {
      merged.push({ ...brk });
    }
  }
  return merged;
}

/**
 * Converts the editor model to the intervals stored in time_slots: the
 * working window minus the (cleaned) breaks.
 *
 * @param day - Working day as edited.
 * @returns   Sorted, non-overlapping intervals; [] when the working window is invalid.
 */
export function workingDayToTimeSlots(day: WorkingDay): TimeSlot[] {
  const windowStart = normaliseTime(day.work_start);
  const windowEnd   = normaliseTime(day.work_end);
  if (!windowStart || !windowEnd || windowStart >= windowEnd) return [];

  const slots: TimeSlot[] = [];
  let cursor = windowStart;
  for (const brk of normaliseBreaks(windowStart, windowEnd, day.breaks)) {
    if (cursor < brk.start) slots.push({ start: cursor, end: brk.start });
    cursor = brk.end;
  }
  if (cursor < windowEnd) slots.push({ start: cursor, end: windowEnd });
  return slots;
}

// ---------------------------------------------------------------------------
// Server-side validation
// ---------------------------------------------------------------------------

/**
 * Validates and normalises the time_slots of one day from an API request.
 *
 * Accepts 'H:MM', 'HH:MM' and 'HH:MM:SS' and returns zero-padded 'HH:MM'
 * intervals sorted by start. Rejects malformed entries, intervals that do not
 * end after they start, and intervals that overlap (touching is allowed).
 *
 * @param input - Untrusted time_slots value; null/undefined means no intervals.
 * @returns     The normalised intervals, or a user-facing error.
 */
export function validateTimeSlots(input: unknown): TimeSlotsValidation {
  if (input === null || input === undefined) return { ok: true, slots: [] };
  if (!Array.isArray(input)) return { ok: false, error: 'time_slots must be an array' };
  if (input.length > MAX_TIME_SLOTS_PER_DAY) {
    return { ok: false, error: `A day can have at most ${MAX_TIME_SLOTS_PER_DAY} time slots` };
  }

  const slots: TimeSlot[] = [];
  for (const entry of input) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return { ok: false, error: 'Each time slot must be an object with start and end' };
    }
    const start = normaliseTime((entry as Record<string, unknown>).start);
    const end   = normaliseTime((entry as Record<string, unknown>).end);
    if (!start || !end) {
      return { ok: false, error: 'Time slot times must be in HH:MM format' };
    }
    if (start >= end) {
      return { ok: false, error: `Time slot ${start}–${end} must end after it starts` };
    }
    slots.push({ start, end });
  }

  slots.sort((a, b) => a.start.localeCompare(b.start));
  for (let i = 1; i < slots.length; i++) {
    if (slots[i].start < slots[i - 1].end) {
      return {
        ok: false,
        error: `Time slots ${slots[i - 1].start}–${slots[i - 1].end} and ${slots[i].start}–${slots[i].end} overlap`,
      };
    }
  }
  return { ok: true, slots };
}
