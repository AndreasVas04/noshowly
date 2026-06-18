/**
 * lib/appointment-helpers.ts
 *
 * Shared server-side helpers for appointment creation and update routes.
 *
 * Used by:
 *  - app/api/appointments/route.ts        (dashboard POST)
 *  - app/api/appointments/[id]/route.ts   (dashboard PUT)
 *  - app/api/book/[slug]/appointments/route.ts (public booking POST)
 *
 * IMPORTANT: Never import this file in Client Components — it relies on
 * Supabase server clients and is intended for API routes only.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, TimeSlot } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal barber record returned by findEligibleBarbers. */
export type EligibleBarber = { id: string; name: string };

// Internal shape for staff_availability rows selected in findEligibleBarbers.
type AvailRow = {
  barber_id: string;
  is_available: boolean;
  time_slots: unknown;         // JSONB — cast to TimeSlot[] at use site
  start_time_1: string | null;
  end_time_1: string | null;
  start_time_2: string | null;
  end_time_2: string | null;
};

// ---------------------------------------------------------------------------
// Timezone helper
// ---------------------------------------------------------------------------

/**
 * Converts a UTC ISO timestamp to the local day-of-week and HH:MM time
 * in the given IANA timezone.
 *
 * Strategy: use Intl.DateTimeFormat.formatToParts to extract the local
 * year/month/day/hour/minute. Compute day-of-week by treating the extracted
 * date components as a UTC date at noon (avoids DST boundary issues).
 *
 * @param utcISO   - UTC ISO timestamp string.
 * @param timezone - IANA timezone identifier, e.g. "Europe/Nicosia".
 * @returns        { dayOfWeek: 0–6 (0=Sun), localTime: "HH:MM" }
 */
export function getLocalDayAndTime(
  utcISO: string,
  timezone: string,
): { dayOfWeek: number; localTime: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year:     'numeric',
    month:    '2-digit',
    day:      '2-digit',
    hour:     '2-digit',
    minute:   '2-digit',
    hour12:   false,
  }).formatToParts(new Date(utcISO));

  const p: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') p[part.type] = part.value;
  }

  // Some locales emit "24" for midnight — normalise to "00".
  const hour = p.hour === '24' ? '00' : p.hour;

  // getUTCDay() on a UTC date built from the local Y/M/D gives the correct
  // local day-of-week because we're supplying the already-localised date components.
  const dayOfWeek = new Date(
    Date.UTC(
      parseInt(p.year, 10),
      parseInt(p.month, 10) - 1,
      parseInt(p.day, 10),
      12, 0, 0, // noon — avoids any DST edge case that touches midnight
    ),
  ).getUTCDay(); // 0 = Sunday … 6 = Saturday

  return {
    dayOfWeek,
    localTime: `${hour.padStart(2, '0')}:${p.minute.padStart(2, '0')}`,
  };
}

// ---------------------------------------------------------------------------
// Time-slot helper
// ---------------------------------------------------------------------------

/**
 * Returns true if the given HH:MM time falls within at least one slot.
 * Uses lexicographic comparison, which is correct for zero-padded HH:MM strings.
 *
 * @param localTime - "HH:MM" 24-hour string.
 * @param slots     - Array of { start, end } time slots to test against.
 */
function isTimeInSlots(localTime: string, slots: TimeSlot[]): boolean {
  return slots.some((slot) => localTime >= slot.start && localTime < slot.end);
}

// ---------------------------------------------------------------------------
// Overlap helper
// ---------------------------------------------------------------------------

/**
 * Returns true if two appointments overlap based on their start times and durations.
 * Two time ranges [A, A+dA) and [B, B+dB) overlap when: A < B+dB AND B < A+dA.
 *
 * @param startA    - Start time of appointment A in epoch milliseconds.
 * @param durationA - Duration of appointment A in minutes.
 * @param startB    - Start time of appointment B in epoch milliseconds.
 * @param durationB - Duration of appointment B in minutes.
 * @returns True if the two time ranges overlap.
 */
export function appointmentsOverlap(
  startA: number,
  durationA: number,
  startB: number,
  durationB: number,
): boolean {
  const endA = startA + durationA * 60_000;
  const endB = startB + durationB * 60_000;
  return startA < endB && startB < endA;
}

// ---------------------------------------------------------------------------
// Core eligibility check
// ---------------------------------------------------------------------------

/**
 * Returns all active barbers in a salon who are eligible for an appointment
 * at the specified datetime.
 *
 * Eligibility is determined by three layered filters applied in sequence:
 *
 *  1. Candidate set — either all active barbers (default) or a pre-filtered
 *     list (e.g. already filtered by staff_services for public booking).
 *
 *  2. Service assignment — if serviceTypeName is provided and the service
 *     exists in the services table with barber_services assignments, only
 *     barbers in that assignment set are considered. If no assignments exist
 *     for the service, the filter is skipped (backwards compatible).
 *
 *  3. Availability — barber must be marked available on the local day, and the
 *     local time must fall within a configured time slot (if slots exist).
 *     A barber with NO availability records at all is treated as always available.
 *     A barber with records for other days but NOT today is unavailable today.
 *
 *  4. Conflicts — barber must have no non-cancelled appointment whose time
 *     range overlaps with the new appointment's time range.
 *
 * Results are returned in alphabetical order by name so that auto-assignment
 * (picking eligible[0]) is deterministic across identical inputs.
 *
 * @param supabase              - Authenticated or service-role Supabase client.
 * @param salonId               - Salon to search within.
 * @param datetimeUTC           - UTC ISO timestamp of the desired appointment slot.
 * @param timezone              - IANA timezone of the salon (for availability checks).
 * @param serviceTypeName       - Service name for barber_services filter, or null.
 * @param candidateBarberIds    - If provided, start with only these barbers
 *                                (skips active-barbers query and service filter).
 *                                Pass null/undefined to use all active barbers.
 * @param excludeAppointmentId  - Exclude this appointment from conflict detection (PUT).
 * @param newDurationMinutes    - Duration of the new appointment in minutes. Default 30.
 * @returns                     Eligible barbers sorted alphabetically, or [] if none.
 */
export async function findEligibleBarbers(params: {
  supabase: SupabaseClient<Database>;
  salonId: string;
  datetimeUTC: string;
  timezone: string;
  serviceTypeName?: string | null;
  candidateBarberIds?: string[] | null;
  excludeAppointmentId?: string;
  newDurationMinutes?: number;
}): Promise<EligibleBarber[]> {
  const {
    supabase,
    salonId,
    datetimeUTC,
    timezone,
    serviceTypeName,
    candidateBarberIds,
    excludeAppointmentId,
    newDurationMinutes = 30,
  } = params;

  // ---- Step 1: Build the initial candidate set ----------------------------

  let allCandidates: EligibleBarber[];

  if (candidateBarberIds && candidateBarberIds.length > 0) {
    // Caller pre-filtered (e.g. by staff_services for public booking).
    // Fetch name + active status so we can filter and sort.
    const { data: rows, error } = await supabase
      .from('barbers')
      .select('id, name')
      .eq('salon_id', salonId)
      .eq('active', true)
      .in('id', candidateBarberIds)
      .order('name');

    if (error || !rows || rows.length === 0) return [];
    allCandidates = rows as EligibleBarber[];
  } else if (candidateBarberIds === null || candidateBarberIds === undefined) {
    // Default: all active barbers for this salon.
    const { data: rows, error } = await supabase
      .from('barbers')
      .select('id, name')
      .eq('salon_id', salonId)
      .eq('active', true)
      .order('name');

    if (error || !rows || rows.length === 0) return [];
    allCandidates = rows as EligibleBarber[];
  } else {
    // candidateBarberIds is an empty array — caller explicitly says no candidates.
    return [];
  }

  let candidateIds = new Set(allCandidates.map((b) => b.id));

  // ---- Step 2: Service assignment filter (barber_services) ----------------
  // Skip when candidateBarberIds was provided — caller handled service filtering.
  if (!candidateBarberIds && serviceTypeName) {
    const { data: serviceRecord } = await supabase
      .from('services')
      .select('id')
      .eq('salon_id', salonId)
      .ilike('name', serviceTypeName)
      .maybeSingle();

    if (serviceRecord) {
      const { count: total } = await supabase
        .from('barber_services')
        .select('id', { count: 'exact', head: true })
        .eq('service_id', serviceRecord.id);

      if (total && total > 0) {
        // At least one assignment exists — enforce the restriction.
        const { data: assignments } = await supabase
          .from('barber_services')
          .select('barber_id')
          .eq('service_id', serviceRecord.id);

        const assignedSet = new Set((assignments ?? []).map((a) => a.barber_id));
        candidateIds = new Set([...candidateIds].filter((id) => assignedSet.has(id)));
      }
      // total === 0 → no assignments yet → skip filter (backwards compatible).
    }
    // Service not in services table (free-text) → skip filter.
  }

  if (candidateIds.size === 0) return [];

  // ---- Step 3: Availability filter ----------------------------------------
  const { dayOfWeek, localTime } = getLocalDayAndTime(datetimeUTC, timezone);

  // Fetch the day's availability record for all candidates in one query.
  const { data: dayRecords } = await supabase
    .from('staff_availability')
    .select('barber_id, is_available, time_slots, start_time_1, end_time_1, start_time_2, end_time_2')
    .in('barber_id', [...candidateIds])
    .eq('day_of_week', dayOfWeek);

  const dayMap = new Map<string, AvailRow>();
  for (const row of (dayRecords ?? []) as unknown as AvailRow[]) {
    dayMap.set(row.barber_id, row);
  }

  // Candidates with no record for today — check whether they have records for
  // other days. If they do, today is genuinely unavailable; if they have no
  // records at all, treat them as always available (no schedule configured).
  const withoutDayRecord = [...candidateIds].filter((id) => !dayMap.has(id));
  let barbersWithAnyRecord = new Set<string>();

  if (withoutDayRecord.length > 0) {
    const { data: anyRows } = await supabase
      .from('staff_availability')
      .select('barber_id')
      .in('barber_id', withoutDayRecord)
      .limit(withoutDayRecord.length);

    barbersWithAnyRecord = new Set((anyRows ?? []).map((r) => r.barber_id));
  }

  const unavailable = new Set<string>();

  for (const barberId of candidateIds) {
    const dayRow = dayMap.get(barberId);

    if (dayRow === undefined) {
      // No record for today.
      if (barbersWithAnyRecord.has(barberId)) {
        // Has records for other days → unavailable today.
        unavailable.add(barberId);
      }
      // No records at all → always available.
      continue;
    }

    if (!dayRow.is_available) {
      unavailable.add(barberId);
      continue;
    }

    // Available today — check time slots if configured.
    const slots = dayRow.time_slots as TimeSlot[] | null | undefined;

    if (slots && slots.length > 0) {
      if (!isTimeInSlots(localTime, slots)) {
        unavailable.add(barberId);
      }
    } else {
      // Fallback: legacy start/end_time columns.
      const legacySlots: TimeSlot[] = [];
      if (dayRow.start_time_1 && dayRow.end_time_1)
        legacySlots.push({ start: dayRow.start_time_1, end: dayRow.end_time_1 });
      if (dayRow.start_time_2 && dayRow.end_time_2)
        legacySlots.push({ start: dayRow.start_time_2, end: dayRow.end_time_2 });

      if (legacySlots.length > 0 && !isTimeInSlots(localTime, legacySlots)) {
        unavailable.add(barberId);
      }
      // is_available = true but no slots at all → available all day.
    }
  }

  for (const id of unavailable) candidateIds.delete(id);
  if (candidateIds.size === 0) return [];

  // ---- Step 4: Conflict filter (duration-aware overlap) -------------------
  // An existing appointment overlaps the new one when:
  //   existingStart < newEnd AND newStart < existingEnd
  // Query a generous window to catch all possible overlaps: existing
  // appointments that started up to MAX_DURATION before our start (they
  // could still be running) through appointments that start before our end.
  const newStartMs  = new Date(datetimeUTC).getTime();
  const newEndMs    = newStartMs + newDurationMinutes * 60_000;
  const MAX_DURATION_MS = 480 * 60_000; // 8 h — matches validation max
  const queryStart  = new Date(newStartMs - MAX_DURATION_MS).toISOString();
  const queryEnd    = new Date(newEndMs).toISOString();

  // Use a ternary to avoid TypeScript issues with conditional chaining on
  // the Supabase query builder's generic return type.
  const { data: conflictRows } = excludeAppointmentId
    ? await supabase
        .from('appointments')
        .select('barber_id, datetime, duration_minutes')
        .eq('salon_id', salonId)
        .in('barber_id', [...candidateIds])
        .neq('status', 'cancelled')
        .neq('id', excludeAppointmentId)
        .gte('datetime', queryStart)
        .lte('datetime', queryEnd)
    : await supabase
        .from('appointments')
        .select('barber_id, datetime, duration_minutes')
        .eq('salon_id', salonId)
        .in('barber_id', [...candidateIds])
        .neq('status', 'cancelled')
        .gte('datetime', queryStart)
        .lte('datetime', queryEnd);

  const conflicted = new Set<string>();
  for (const row of (conflictRows ?? [])) {
    const bid = row.barber_id as string | null;
    if (!bid) continue;
    const existStartMs   = new Date(row.datetime as string).getTime();
    const existDuration  = (row.duration_minutes as number | null) ?? 30;
    if (appointmentsOverlap(newStartMs, newDurationMinutes, existStartMs, existDuration)) {
      conflicted.add(bid);
    }
  }
  for (const id of conflicted) candidateIds.delete(id);

  // Return eligible barbers in original alphabetical order (from Step 1 sort).
  return allCandidates.filter((b) => candidateIds.has(b.id));
}
