/**
 * components/dashboard/booking-settings/form-state.ts
 *
 * Form state of the booking settings page (app/dashboard/booking/page.tsx)
 * and the pure helpers that work on it:
 *  - DayState / BarberFormState — a staff member's profile and weekly
 *    availability as edited; each day is one working window with any number
 *    of breaks.
 *  - buildBarberForm — builds that state from the staff_availability rows.
 *  - getWorkingHoursError, isBreakIgnored, sameBreaks — availability checks
 *    for auto-save, the break hint and "Apply to all days".
 *  - applySavedText — applies a saved server value to a text field only when
 *    the owner has not changed it since the save request was sent.
 *
 * No imports from React, Next.js or Supabase, so this is safe to use anywhere.
 */

import { normaliseBreaks, timeSlotsToWorkingDay, workingDayToTimeSlots } from '@/lib/schedule';
import { normaliseTime } from '@/lib/time';
import type { Barber, StaffAvailability } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Auto-save status of the booking page settings or of one staff member. */
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Per-day availability state — multiple breaks model.
 * Internally converted to/from the time_slots JSONB column in the DB
 * (see lib/schedule.ts).
 *
 * Working model: a contiguous work window with zero or more break gaps.
 *   No breaks:   time_slots = [{ start: work_start, end: work_end }]
 *   N breaks:    time_slots interleaved — [work_start→b0.start, b0.end→b1.start, …, bN.end→work_end]
 * Breaks are clamped to the working window on save; empty or inverted ones are dropped.
 */
export type DayState = {
  is_available: boolean;
  /** Working start time, e.g. "09:00". */
  work_start: string;
  /** Working end time, e.g. "18:00". */
  work_end: string;
  /** Ordered list of break windows for this day. */
  breaks: { start: string; end: string }[];
};

/** In-memory form state for a single barber. */
export type BarberFormState = {
  name: string;
  bio: string;
  /** Current photo URL (set after upload or loaded from DB). */
  photo_url: string;
  /** day_of_week (0=Sun … 6=Sat) → day availability state. */
  availability: Record<number, DayState>;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Days displayed in the availability grid, Mon-first order. */
export const WEEK_DAYS = [
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
  { label: 'Sun', value: 0 },
] as const;

/**
 * Default per-day availability when no DB record exists.
 * Mon–Fri available 09:00–17:00 with no break; Sat and Sun unavailable.
 *
 * @param dayOfWeek - 0=Sunday … 6=Saturday.
 * @returns         Default DayState for the given day.
 */
export function makeDefaultDayState(dayOfWeek: number): DayState {
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
  return {
    is_available: isWeekday,
    work_start:   '09:00',
    work_end:     '17:00',
    breaks:       [],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds the initial BarberFormState for a barber, merging in any
 * existing staff_availability records from the database.
 *
 * Converts the stored intervals into the DayState breaks model: the working
 * window runs from the first start to the last end, and every gap between
 * intervals becomes a break — so all breaks are loaded, not just the first
 * (a later auto-save would otherwise delete the rest).
 *
 * Prefers the JSONB `time_slots` column; falls back to the legacy
 * start/end_time columns (Postgres TIME, e.g. "09:00:00").
 *
 * @param barber       - The barber row from the database.
 * @param availability - All staff_availability records (all barbers).
 * @returns            Populated BarberFormState ready for the form.
 */
export function buildBarberForm(barber: Barber, availability: StaffAvailability[]): BarberFormState {
  const barberRecords = availability.filter((a) => a.barber_id === barber.id);
  const days: Record<number, DayState> = {};

  for (let dow = 0; dow <= 6; dow++) {
    const rec = barberRecords.find((a) => a.day_of_week === dow);
    if (!rec) {
      days[dow] = makeDefaultDayState(dow);
      continue;
    }

    const workingDay =
      timeSlotsToWorkingDay(rec.time_slots) ??
      timeSlotsToWorkingDay([
        { start: rec.start_time_1, end: rec.end_time_1 },
        { start: rec.start_time_2, end: rec.end_time_2 },
      ]);

    if (workingDay) {
      days[dow] = { is_available: rec.is_available, ...workingDay };
    } else if (rec.is_available) {
      // Available but no time info — apply sensible defaults.
      days[dow] = { is_available: true, work_start: '09:00', work_end: '17:00', breaks: [] };
    } else {
      // Day off (stored without times): keep it off, with default hours for when it is switched on.
      days[dow] = { ...makeDefaultDayState(dow), is_available: false };
    }
  }

  return {
    name:     barber.name,
    bio:      barber.bio ?? '',
    photo_url: barber.photo_url ?? '',
    availability: days,
  };
}

/**
 * Returns the problem with a working day's hours, or null when they are valid
 * (or the day is off). Used to hold back auto-save until the hours make sense.
 *
 * @param day - The day as edited.
 */
export function getWorkingHoursError(day: DayState): string | null {
  if (!day.is_available) return null;
  const start = normaliseTime(day.work_start);
  const end   = normaliseTime(day.work_end);
  if (!start || !end) return 'Enter a start and end time.';
  if (start >= end) return 'Working hours must end after they start.';
  if (workingDayToTimeSlots(day).length === 0) {
    return 'Breaks cover the whole working day. Mark the day as off instead.';
  }
  return null;
}

/**
 * Returns true when a break has no effect once cleaned: it is empty, ends
 * before it starts, or lies outside the working hours.
 *
 * @param day - The day the break belongs to.
 * @param brk - The break as edited.
 */
export function isBreakIgnored(day: DayState, brk: { start: string; end: string }): boolean {
  return normaliseBreaks(day.work_start, day.work_end, [brk]).length === 0;
}

/** Returns true when two break lists are identical. */
export function sameBreaks(a: { start: string; end: string }[], b: { start: string; end: string }[]): boolean {
  return a.length === b.length && a.every((brk, i) => brk.start === b[i].start && brk.end === b[i].end);
}

/**
 * Keeps what the owner typed unless the field is unchanged since a save
 * request was sent, in which case the saved server value is applied.
 * Differences in surrounding whitespace only (the server trims) are kept as
 * typed so a trailing space is not removed mid-sentence.
 *
 * @param current - Field value now.
 * @param sent    - Field value when the request was sent.
 * @param saved   - Value returned by the server.
 */
export function applySavedText(current: string, sent: string, saved: string): string {
  if (current !== sent) return current;
  if (current.trim() === saved.trim()) return current;
  return saved;
}
