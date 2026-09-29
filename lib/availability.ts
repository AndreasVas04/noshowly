/**
 * lib/availability.ts
 *
 * Scheduling rules for bookings, shared by the public booking page
 * (app/book/[slug]/BookingFlow.tsx) and the API routes that validate and
 * auto-assign appointments. Keeping the rules in one module means the times a
 * visitor is offered are exactly the times the server accepts.
 *
 * Rules:
 *  - Eligibility: if a service has any barber_services rows, only those staff
 *    members can perform it; otherwise every active staff member can.
 *  - Duration: the staff member's duration override for the service, else the
 *    service's duration, else DEFAULT_DURATION_MINUTES.
 *  - Working intervals: staff_availability.time_slots for the day of week (or
 *    the legacy start/end_time columns when time_slots is empty). Public
 *    bookings are also clamped to the salon's opening hours when they are set.
 *  - A start time is bookable for a staff member when the whole appointment
 *    (start + that staff member's duration) fits inside one working interval
 *    and does not overlap any of their non-cancelled appointments. Touching
 *    appointments (one ends exactly when the next starts) are fine.
 *  - Booking window: nothing in the past or less than MIN_NOTICE_MINUTES
 *    ahead, and nothing more than MAX_ADVANCE_DAYS ahead (by salon date).
 *
 * Wall-clock times are in the salon's timezone; every comparison is made on
 * UTC instants so daylight saving days are handled exactly.
 *
 * No imports from Next.js or Supabase, so this is safe to use anywhere.
 */

import {
  addDaysToDate,
  dayRangeUtc,
  minutesToTime,
  normaliseTime,
  resolveZonedTime,
  timeToMinutes,
  todayInZone,
} from '@/lib/time';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Spacing of the start times offered on the booking page, from each interval's start. */
const SLOT_STEP_MINUTES = 30;

/** Bookings must start at least this far in the future. */
export const MIN_NOTICE_MINUTES = 30;

/** Bookings can be made at most this many days ahead (salon date). */
export const MAX_ADVANCE_DAYS = 90;

/** Duration used when neither the service nor an override defines one. */
export const DEFAULT_DURATION_MINUTES = 30;

/** Shortest accepted appointment or service duration. */
export const MIN_DURATION_MINUTES = 1;

/** Longest accepted appointment or service duration (8 hours). */
export const MAX_DURATION_MINUTES = 480;

/** Highest price that fits the DECIMAL(10,2) price columns. */
const MAX_PRICE = 99_999_999.99;

/**
 * Hours used for public bookings when a staff member has no hours configured
 * for the day and the salon has no opening hours.
 */
export const DEFAULT_OPENING_HOURS: TimeInterval = { start: '09:00', end: '20:00' };

const MINUTE_MS = 60_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A wall-clock interval, start inclusive and end exclusive, as 'HH:MM'. */
export type TimeInterval = { start: string; end: string };

/** The staff_availability columns the scheduling rules read. */
export type AvailabilityRecord = {
  barber_id: string;
  /** 0 = Sunday … 6 = Saturday. */
  day_of_week: number;
  is_available: boolean;
  /** JSONB [{ start, end }]; validated at read time. */
  time_slots: unknown;
  start_time_1: string | null;
  end_time_1: string | null;
  start_time_2: string | null;
  end_time_2: string | null;
};

/** A non-cancelled appointment that occupies a staff member's time. */
export type BusyInterval = {
  barber_id: string | null;
  /** UTC ISO start. */
  datetime: string;
  duration_minutes: number | null;
};

/** The barber_services columns the scheduling rules read. */
export type ServiceAssignment = {
  barber_id: string;
  service_id: string;
  price_override?: number | null;
  duration_minutes_override?: number | null;
};

/** The services columns the scheduling rules read. */
export type ServiceDefaults = {
  id: string;
  duration_minutes: number | null;
  price?: number | null;
};

/** Salon opening hours as stored (any TIME format, or null when not set). */
export type SalonHours = {
  opening_time: string | null;
  closing_time: string | null;
};

/** A half-open range of epoch milliseconds [start, end). */
export type InstantRange = { start: number; end: number };

/** One staff member considered for a booking on a given date. */
export type SlotCandidate = {
  /** Staff member id, or null for a salon without staff. */
  barberId: string | null;
  /** Wall-clock working intervals on the date (already clamped as needed). */
  intervals: TimeInterval[];
  /** Appointment length for this staff member, in minutes. */
  durationMinutes: number;
};

/** A start time with the staff members who can take it. */
export type AvailableSlot = {
  /** 'HH:MM' in the salon timezone. */
  time: string;
  /** Staff members free for the whole appointment at this time (null = no staff). */
  barberIds: Array<string | null>;
};

/** Result of checkBookingWindow(). */
export type BookingWindowResult =
  | { ok: true }
  | { ok: false; reason: 'past' | 'too_soon' | 'too_far' };

// ---------------------------------------------------------------------------
// Durations and prices
// ---------------------------------------------------------------------------

/**
 * Returns true for an integer duration between MIN_DURATION_MINUTES and
 * MAX_DURATION_MINUTES.
 */
export function isValidDuration(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_DURATION_MINUTES &&
    value <= MAX_DURATION_MINUTES
  );
}

/**
 * Returns true for a price of 0 or more (and within MAX_PRICE).
 */
export function isValidPrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_PRICE;
}

/**
 * Returns the appointment length for a service performed by a staff member:
 * the staff member's override, else the service duration, else the default.
 *
 * @param service     - The service, or null when no service is selected.
 * @param barberId    - The staff member, or null when not yet known.
 * @param assignments - barber_services rows for the salon.
 * @returns           Duration in minutes.
 */
export function getEffectiveDuration(
  service: Pick<ServiceDefaults, 'id' | 'duration_minutes'> | null | undefined,
  barberId: string | null | undefined,
  assignments: readonly ServiceAssignment[],
): number {
  if (!service) return DEFAULT_DURATION_MINUTES;
  if (barberId) {
    const assignment = assignments.find(
      (a) => a.barber_id === barberId && a.service_id === service.id,
    );
    if (assignment && isValidDuration(assignment.duration_minutes_override)) {
      return assignment.duration_minutes_override;
    }
  }
  return isValidDuration(service.duration_minutes) ? service.duration_minutes : DEFAULT_DURATION_MINUTES;
}

/**
 * Returns the price shown for a service performed by a staff member: the
 * staff member's override, else the service price.
 *
 * @param service     - The service.
 * @param barberId    - The staff member, or null when not yet known.
 * @param assignments - barber_services rows for the salon.
 * @returns           Price, or null when none is set.
 */
export function getEffectivePrice(
  service: Pick<ServiceDefaults, 'id' | 'price'>,
  barberId: string | null | undefined,
  assignments: readonly ServiceAssignment[],
): number | null {
  if (barberId) {
    const assignment = assignments.find(
      (a) => a.barber_id === barberId && a.service_id === service.id,
    );
    if (assignment && assignment.price_override != null) return Number(assignment.price_override);
  }
  return service.price != null ? Number(service.price) : null;
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

/**
 * Returns the staff members who can perform a service.
 *
 * If the service has any barber_services rows, only those staff members are
 * eligible; otherwise every active staff member is. With no service selected,
 * every active staff member is eligible.
 *
 * @param serviceId       - The service, or null/undefined when none is selected.
 * @param activeBarberIds - Active staff members of the salon, in display order.
 * @param assignments     - barber_services rows for the salon (all staff).
 * @returns               Eligible staff ids, in the order of `activeBarberIds`.
 */
export function eligibleBarberIds(
  serviceId: string | null | undefined,
  activeBarberIds: readonly string[],
  assignments: readonly Pick<ServiceAssignment, 'barber_id' | 'service_id'>[],
): string[] {
  if (!serviceId) return [...activeBarberIds];
  const assigned = new Set(
    assignments.filter((a) => a.service_id === serviceId).map((a) => a.barber_id),
  );
  if (assigned.size === 0) return [...activeBarberIds];
  return activeBarberIds.filter((id) => assigned.has(id));
}

/**
 * Returns true when a staff member can perform a service (see eligibleBarberIds()).
 *
 * @param serviceId   - The service, or null when none is selected.
 * @param barberId    - The staff member.
 * @param assignments - barber_services rows for the salon (all staff).
 */
export function isBarberEligibleForService(
  serviceId: string | null | undefined,
  barberId: string,
  assignments: readonly Pick<ServiceAssignment, 'barber_id' | 'service_id'>[],
): boolean {
  if (!serviceId) return true;
  const rows = assignments.filter((a) => a.service_id === serviceId);
  return rows.length === 0 || rows.some((a) => a.barber_id === barberId);
}

// ---------------------------------------------------------------------------
// Working intervals
// ---------------------------------------------------------------------------

/**
 * Cleans a list of wall-clock intervals: normalises times to 'HH:MM', drops
 * empty, inverted or malformed entries, sorts them and merges intervals that
 * overlap or touch.
 *
 * @param raw - Untrusted interval data (e.g. the time_slots JSONB value).
 * @returns   Sorted, non-overlapping intervals.
 */
export function sanitiseIntervals(raw: unknown): TimeInterval[] {
  if (!Array.isArray(raw)) return [];

  const intervals: TimeInterval[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const start = normaliseTime((entry as Record<string, unknown>).start);
    const end   = normaliseTime((entry as Record<string, unknown>).end);
    if (start && end && start < end) intervals.push({ start, end });
  }
  intervals.sort((a, b) => a.start.localeCompare(b.start));

  const merged: TimeInterval[] = [];
  for (const interval of intervals) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) {
      if (interval.end > last.end) last.end = interval.end;
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

/**
 * Returns the working intervals configured for a staff member on a day of the week.
 *
 * Mirrors how the schedule has always been read:
 *  - No staff_availability rows at all → null (no schedule configured).
 *  - Rows exist but none for this day, or is_available is false → [] (not working).
 *  - Working day → time_slots, or the legacy start/end_time columns when
 *    time_slots is empty, or null when no times are set at all.
 *
 * @param barberId     - The staff member.
 * @param dayOfWeek    - 0 = Sunday … 6 = Saturday.
 * @param availability - staff_availability rows (may include other staff).
 * @returns            Intervals, [] when not working, or null when no hours
 *                     are configured (callers decide what that means).
 */
export function getScheduledIntervals(
  barberId: string,
  dayOfWeek: number,
  availability: readonly AvailabilityRecord[],
): TimeInterval[] | null {
  const rows = availability.filter((a) => a.barber_id === barberId);
  if (rows.length === 0) return null;

  const row = rows.find((a) => a.day_of_week === dayOfWeek);
  if (!row || !row.is_available) return [];

  const fromSlots = sanitiseIntervals(row.time_slots);
  if (fromSlots.length > 0) return fromSlots;

  const legacy = sanitiseIntervals([
    { start: row.start_time_1, end: row.end_time_1 },
    { start: row.start_time_2, end: row.end_time_2 },
  ]);
  return legacy.length > 0 ? legacy : null;
}

/**
 * Returns the salon's opening hours as an interval, or null when they are not
 * set (or not a valid range).
 *
 * @param hours - Stored opening_time / closing_time.
 */
export function getSalonHoursInterval(hours: SalonHours | null | undefined): TimeInterval | null {
  const start = normaliseTime(hours?.opening_time);
  const end   = normaliseTime(hours?.closing_time);
  return start && end && start < end ? { start, end } : null;
}

/**
 * Returns the intervals a staff member can be booked in online on a day of the
 * week: their scheduled intervals (or the salon hours / DEFAULT_OPENING_HOURS
 * when none are configured), clamped to the salon's opening hours when set.
 *
 * @param barberId     - The staff member.
 * @param dayOfWeek    - 0 = Sunday … 6 = Saturday.
 * @param availability - staff_availability rows (may include other staff).
 * @param salonHours   - Salon opening hours.
 * @returns            Sorted, non-overlapping intervals ([] when not bookable).
 */
export function getBookableIntervals(
  barberId: string,
  dayOfWeek: number,
  availability: readonly AvailabilityRecord[],
  salonHours: SalonHours | null | undefined,
): TimeInterval[] {
  const open = getSalonHoursInterval(salonHours);
  const scheduled = getScheduledIntervals(barberId, dayOfWeek, availability);
  const intervals = scheduled ?? [open ?? DEFAULT_OPENING_HOURS];
  return open ? clampIntervals(intervals, open) : intervals;
}

/**
 * Clamps intervals to a window and drops the ones left empty.
 *
 * @param intervals - Sorted intervals.
 * @param window    - Window to clamp to.
 */
function clampIntervals(intervals: readonly TimeInterval[], window: TimeInterval): TimeInterval[] {
  const clamped: TimeInterval[] = [];
  for (const interval of intervals) {
    const start = interval.start > window.start ? interval.start : window.start;
    const end   = interval.end < window.end ? interval.end : window.end;
    if (start < end) clamped.push({ start, end });
  }
  return clamped;
}

// ---------------------------------------------------------------------------
// Instants
// ---------------------------------------------------------------------------

/**
 * Converts wall-clock intervals on a date to UTC instant ranges. Interval
 * boundaries skipped by a forward clock change are moved forward by the gap.
 *
 * @param date      - 'YYYY-MM-DD' in the salon timezone.
 * @param intervals - Wall-clock intervals.
 * @param timeZone  - Salon timezone.
 */
export function intervalsToRanges(
  date: string,
  intervals: readonly TimeInterval[],
  timeZone: string,
): InstantRange[] {
  const ranges: InstantRange[] = [];
  for (const interval of intervals) {
    const start = resolveZonedTime(date, interval.start, timeZone, { nonexistent: 'shift' });
    const end   = resolveZonedTime(date, interval.end, timeZone, { nonexistent: 'shift' });
    if (start.ok && end.ok && start.date < end.date) {
      ranges.push({ start: start.date.getTime(), end: end.date.getTime() });
    }
  }
  return ranges;
}

/**
 * Converts appointments to instant ranges, optionally keeping only one staff member's.
 *
 * @param busy     - Non-cancelled appointments.
 * @param barberId - Keep only this staff member's appointments; pass undefined to keep all.
 */
export function busyToRanges(busy: readonly BusyInterval[], barberId?: string | null): InstantRange[] {
  const ranges: InstantRange[] = [];
  for (const appointment of busy) {
    if (barberId !== undefined && appointment.barber_id !== barberId) continue;
    const start = new Date(appointment.datetime).getTime();
    if (!Number.isFinite(start)) continue;
    const duration = isValidDuration(appointment.duration_minutes)
      ? appointment.duration_minutes
      : DEFAULT_DURATION_MINUTES;
    ranges.push({ start, end: start + duration * MINUTE_MS });
  }
  return ranges;
}

/**
 * Returns true when two half-open ranges overlap. Ranges that only touch
 * (one ends exactly when the other starts) do not overlap.
 */
export function rangesOverlap(a: InstantRange, b: InstantRange): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Returns true when an appointment occupying `range` fits inside one working
 * range and overlaps none of the busy ranges.
 *
 * @param range   - The appointment.
 * @param working - Working ranges for the day.
 * @param busy    - Existing appointments of the same staff member.
 */
export function fitsSchedule(
  range: InstantRange,
  working: readonly InstantRange[],
  busy: readonly InstantRange[],
): boolean {
  const insideWorking = working.some((w) => range.start >= w.start && range.end <= w.end);
  return insideWorking && !busy.some((b) => rangesOverlap(range, b));
}

// ---------------------------------------------------------------------------
// Booking window
// ---------------------------------------------------------------------------

/**
 * Returns the last date that can be booked online (salon date).
 *
 * @param timeZone - Salon timezone.
 * @param now      - Current instant.
 */
export function lastBookableDate(timeZone: string, now: Date): string {
  return addDaysToDate(todayInZone(timeZone, now), MAX_ADVANCE_DAYS);
}

/**
 * Checks the minimum-notice and advance-booking limits for an online booking.
 *
 * @param start    - Appointment start instant.
 * @param date     - Appointment date in the salon timezone ('YYYY-MM-DD').
 * @param timeZone - Salon timezone.
 * @param now      - Current instant.
 */
export function checkBookingWindow(
  start: Date,
  date: string,
  timeZone: string,
  now: Date,
): BookingWindowResult {
  if (start.getTime() <= now.getTime()) return { ok: false, reason: 'past' };
  if (start.getTime() < now.getTime() + MIN_NOTICE_MINUTES * MINUTE_MS) {
    return { ok: false, reason: 'too_soon' };
  }
  if (date > lastBookableDate(timeZone, now)) return { ok: false, reason: 'too_far' };
  return { ok: true };
}

/**
 * Returns true when a salon date can be picked on the booking calendar:
 * not before today and not after lastBookableDate().
 *
 * @param date     - 'YYYY-MM-DD'.
 * @param timeZone - Salon timezone.
 * @param now      - Current instant.
 */
export function isDateWithinBookingWindow(date: string, timeZone: string, now: Date): boolean {
  return date >= todayInZone(timeZone, now) && date <= lastBookableDate(timeZone, now);
}

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

/**
 * Returns the start times that can be booked online on a date, with the staff
 * members free at each. A time is included when at least one candidate can
 * take the whole appointment (see the rules at the top of this file) and it
 * respects the booking window.
 *
 * Start times step by `stepMinutes` from the start of each working interval.
 *
 * @param params.date        - 'YYYY-MM-DD' in the salon timezone.
 * @param params.timeZone    - Salon timezone.
 * @param params.candidates  - Staff members to consider, with their intervals and durations.
 * @param params.busy        - Non-cancelled appointments around the date.
 * @param params.now         - Current instant.
 * @param params.stepMinutes - Spacing of start times (default SLOT_STEP_MINUTES).
 * @returns                  Slots sorted by time.
 */
export function getAvailableSlots(params: {
  date: string;
  timeZone: string;
  candidates: readonly SlotCandidate[];
  busy: readonly BusyInterval[];
  now: Date;
  stepMinutes?: number;
}): AvailableSlot[] {
  const { date, timeZone, candidates, busy, now } = params;
  const step = params.stepMinutes ?? SLOT_STEP_MINUTES;
  if (!isDateWithinBookingWindow(date, timeZone, now)) return [];

  // Same limit as checkBookingWindow(); the date itself was checked above.
  const earliestStart = now.getTime() + MIN_NOTICE_MINUTES * MINUTE_MS;
  const slots = new Map<string, Array<string | null>>();

  for (const candidate of candidates) {
    // A salon without staff has no per-person calendar to check.
    const busyRanges = candidate.barberId === null ? [] : busyToRanges(busy, candidate.barberId);

    for (const interval of candidate.intervals) {
      const [working] = intervalsToRanges(date, [interval], timeZone);
      if (!working) continue;

      for (let minute = timeToMinutes(interval.start); minute < timeToMinutes(interval.end); minute += step) {
        const time = minutesToTime(minute);
        const start = resolveZonedTime(date, time, timeZone);
        if (!start.ok) continue; // skipped by a clock change

        const range: InstantRange = {
          start: start.date.getTime(),
          end: start.date.getTime() + candidate.durationMinutes * MINUTE_MS,
        };
        if (range.start < earliestStart) continue;
        if (!fitsSchedule(range, [working], busyRanges)) continue;

        const free = slots.get(time) ?? [];
        if (!free.includes(candidate.barberId)) free.push(candidate.barberId);
        slots.set(time, free);
      }
    }
  }

  return [...slots.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, barberIds]) => ({ time, barberIds }));
}

/**
 * Returns true when one candidate can take an appointment starting at a
 * wall-clock time (whole duration inside a working interval, no overlap with
 * their appointments). Does not check the booking window.
 *
 * @param params.date      - 'YYYY-MM-DD' in the salon timezone.
 * @param params.time      - 'HH:MM' in the salon timezone.
 * @param params.timeZone  - Salon timezone.
 * @param params.candidate - The staff member to check.
 * @param params.busy      - Non-cancelled appointments around the date.
 */
export function isCandidateAvailable(params: {
  date: string;
  time: string;
  timeZone: string;
  candidate: SlotCandidate;
  busy: readonly BusyInterval[];
}): boolean {
  const { date, time, timeZone, candidate, busy } = params;
  const start = resolveZonedTime(date, time, timeZone);
  if (!start.ok) return false;

  const range: InstantRange = {
    start: start.date.getTime(),
    end: start.date.getTime() + candidate.durationMinutes * MINUTE_MS,
  };
  const working = intervalsToRanges(date, candidate.intervals, timeZone);
  const busyRanges = candidate.barberId === null ? [] : busyToRanges(busy, candidate.barberId);
  return fitsSchedule(range, working, busyRanges);
}

/**
 * Picks the staff member for an "Any available staff" booking: among the
 * candidates free for the whole appointment, the one with the fewest
 * appointments starting that day; ties go to name order, then id.
 *
 * @param params.date       - 'YYYY-MM-DD' in the salon timezone.
 * @param params.time       - 'HH:MM' in the salon timezone.
 * @param params.timeZone   - Salon timezone.
 * @param params.candidates - Eligible staff members with their names.
 * @param params.busy       - Non-cancelled appointments around the date.
 * @returns                 The chosen staff id, or null when nobody is free.
 */
export function pickAnyAvailableBarber(params: {
  date: string;
  time: string;
  timeZone: string;
  candidates: ReadonlyArray<SlotCandidate & { barberId: string; name: string }>;
  busy: readonly BusyInterval[];
}): string | null {
  const { date, time, timeZone, candidates, busy } = params;
  const day = dayRangeUtc(date, timeZone);
  const dayStart = day.start.getTime();
  const dayEnd = day.end.getTime();

  const free = candidates
    .filter((candidate) => isCandidateAvailable({ date, time, timeZone, candidate, busy }))
    .map((candidate) => ({
      candidate,
      appointmentsThatDay: busyToRanges(busy, candidate.barberId).filter(
        (r) => r.start >= dayStart && r.start < dayEnd,
      ).length,
    }));

  free.sort(
    (a, b) =>
      a.appointmentsThatDay - b.appointmentsThatDay ||
      a.candidate.name.localeCompare(b.candidate.name, 'en') ||
      a.candidate.barberId.localeCompare(b.candidate.barberId),
  );

  return free[0]?.candidate.barberId ?? null;
}
