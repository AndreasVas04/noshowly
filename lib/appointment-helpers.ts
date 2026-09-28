/**
 * lib/appointment-helpers.ts
 *
 * Shared server-side helpers for the dashboard appointment routes.
 *
 * Used by:
 *  - app/api/appointments/route.ts        (dashboard POST)
 *  - app/api/appointments/[id]/route.ts   (dashboard PUT)
 *
 * Eligibility, durations and working intervals come from lib/availability.ts,
 * the same rules the public booking page uses (app/api/book/[slug]/appointments).
 *
 * IMPORTANT: Never import this file in Client Components — it relies on
 * Supabase server clients and is intended for API routes only.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types';
import {
  MAX_DURATION_MINUTES,
  eligibleBarberIds,
  fitsSchedule,
  getEffectiveDuration,
  getScheduledIntervals,
  intervalsToRanges,
  type AvailabilityRecord,
} from '@/lib/availability';
import { utcToZonedParts } from '@/lib/time';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A staff member who can take an appointment, with their appointment length. */
export type EligibleBarber = { id: string; name: string; durationMinutes: number };

/** A salon service as used by the appointment routes. */
export type AppointmentService = { id: string; name: string; duration_minutes: number | null };

/** barber_services columns the appointment rules read. */
export type ServiceAssignmentRow = {
  barber_id: string;
  service_id: string;
  duration_minutes_override: number | null;
};

/** Result of findAppointmentService(). */
export type ServiceLookupResult =
  | { ok: true; service: AppointmentService | null; assignments: ServiceAssignmentRow[] }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Services and durations
// ---------------------------------------------------------------------------

/** Escapes LIKE wildcards so a value is matched literally by ilike. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

/**
 * Finds the salon service an appointment is for, with that service's staff
 * assignments (barber_services rows):
 *  - with a service id: it must be a service of this salon, otherwise an error;
 *  - otherwise with a service name: the salon's service with that name
 *    (case-insensitive), or no service when the name is free text;
 *  - otherwise: no service.
 *
 * @param params.supabase    - Authenticated (RLS) Supabase client.
 * @param params.salonId     - The caller's salon.
 * @param params.serviceId   - Service id from the request, or null.
 * @param params.serviceName - Service name from the request, or null.
 */
export async function findAppointmentService(params: {
  supabase: SupabaseClient<Database>;
  salonId: string;
  serviceId?: string | null;
  serviceName?: string | null;
}): Promise<ServiceLookupResult> {
  const { supabase, salonId, serviceId, serviceName } = params;

  let service: AppointmentService | null = null;
  if (serviceId) {
    const { data, error } = await supabase
      .from('services')
      .select('id, name, duration_minutes')
      .eq('id', serviceId)
      .eq('salon_id', salonId)
      .maybeSingle();
    if (error || !data) return { ok: false, error: 'Service not found' };
    service = data;
  } else if (serviceName?.trim()) {
    const { data } = await supabase
      .from('services')
      .select('id, name, duration_minutes')
      .eq('salon_id', salonId)
      .ilike('name', escapeLike(serviceName.trim()))
      .order('active', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(1);
    service = data?.[0] ?? null;
  }

  if (!service) return { ok: true, service: null, assignments: [] };

  const { data: assignments, error: assignmentsError } = await supabase
    .from('barber_services')
    .select('barber_id, service_id, duration_minutes_override')
    .eq('service_id', service.id);
  if (assignmentsError) {
    console.error('[appointment-helpers] barber_services lookup error:', assignmentsError.message);
    return { ok: false, error: 'Failed to load staff for this service' };
  }

  return { ok: true, service, assignments: assignments ?? [] };
}

/**
 * Returns the length of an appointment: the explicit duration when one was
 * given, otherwise the service duration with the staff member's override,
 * otherwise 30 minutes.
 *
 * @param explicit    - Valid duration_minutes from the request, or undefined.
 * @param service     - The appointment's service, or null.
 * @param barberId    - The appointment's staff member, or null.
 * @param assignments - The service's barber_services rows.
 */
export function resolveAppointmentDuration(
  explicit: number | undefined,
  service: AppointmentService | null,
  barberId: string | null,
  assignments: readonly ServiceAssignmentRow[],
): number {
  if (explicit !== undefined) return explicit;
  return getEffectiveDuration(service, barberId, assignments);
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
 * Returns the active staff members of a salon who can take an appointment
 * at the specified datetime, each with the appointment length they would get.
 *
 * Filters, in order:
 *
 *  1. Service — the one eligibility rule from lib/availability.ts: if the
 *     service has any barber_services rows, only those staff members;
 *     otherwise every active staff member.
 *
 *  2. Availability — the whole appointment (with the staff member's own
 *     duration) must fit inside one of their working intervals for that day
 *     in the salon timezone. A staff member with NO availability records at
 *     all, or a working day without times, is treated as always available.
 *     A staff member with records for other days but not this one is not.
 *
 *  3. Conflicts — no non-cancelled appointment of theirs may overlap.
 *
 * Results are returned in alphabetical order by name so that auto-assignment
 * is deterministic across identical inputs.
 *
 * @param params.supabase                - Authenticated or service-role Supabase client.
 * @param params.salonId                 - Salon to search within.
 * @param params.datetimeUTC             - UTC ISO timestamp of the appointment start.
 * @param params.timezone                - IANA timezone of the salon.
 * @param params.service                 - The appointment's service, or null.
 * @param params.assignments             - The service's barber_services rows.
 * @param params.excludeAppointmentId    - Exclude this appointment from conflict detection (PUT).
 * @param params.explicitDurationMinutes - Length to use for everyone instead of the
 *                                         service duration and overrides.
 * @returns Eligible staff sorted alphabetically, or [] if none.
 */
export async function findEligibleBarbers(params: {
  supabase: SupabaseClient<Database>;
  salonId: string;
  datetimeUTC: string;
  timezone: string;
  service: AppointmentService | null;
  assignments: readonly ServiceAssignmentRow[];
  excludeAppointmentId?: string;
  explicitDurationMinutes?: number;
}): Promise<EligibleBarber[]> {
  const {
    supabase,
    salonId,
    datetimeUTC,
    timezone,
    service,
    assignments,
    excludeAppointmentId,
    explicitDurationMinutes,
  } = params;

  // ---- Step 1: Active staff eligible for the service ---------------------
  const { data: activeRows, error: activeError } = await supabase
    .from('barbers')
    .select('id, name')
    .eq('salon_id', salonId)
    .eq('active', true)
    .order('name');

  if (activeError || !activeRows || activeRows.length === 0) return [];

  const eligibleIds = new Set(
    eligibleBarberIds(service?.id ?? null, activeRows.map((b) => b.id), assignments),
  );
  let candidates: EligibleBarber[] = activeRows
    .filter((b) => eligibleIds.has(b.id))
    .map((b) => ({
      id: b.id,
      name: b.name,
      durationMinutes: resolveAppointmentDuration(explicitDurationMinutes, service, b.id, assignments),
    }));
  if (candidates.length === 0) return [];

  // ---- Step 2: Availability (whole appointment inside a working interval) -
  const startMs = new Date(datetimeUTC).getTime();
  const local = utcToZonedParts(startMs, timezone);

  const { data: availabilityRows } = await supabase
    .from('staff_availability')
    .select('barber_id, day_of_week, is_available, time_slots, start_time_1, end_time_1, start_time_2, end_time_2')
    .in('barber_id', candidates.map((c) => c.id));
  const availability = (availabilityRows ?? []) as AvailabilityRecord[];

  candidates = candidates.filter((candidate) => {
    const intervals = getScheduledIntervals(candidate.id, local.dayOfWeek, availability);
    if (intervals === null) return true; // no hours configured → always available
    const working = intervalsToRanges(local.date, intervals, timezone);
    const range = { start: startMs, end: startMs + candidate.durationMinutes * 60_000 };
    return fitsSchedule(range, working, []);
  });
  if (candidates.length === 0) return [];

  // ---- Step 3: Conflict filter (duration-aware overlap) -------------------
  // Query a generous window: appointments that started up to the maximum
  // duration before our start (they could still be running) through
  // appointments that start before the longest candidate's end.
  const longest = Math.max(...candidates.map((c) => c.durationMinutes));
  const queryStart = new Date(startMs - MAX_DURATION_MINUTES * 60_000).toISOString();
  const queryEnd   = new Date(startMs + longest * 60_000).toISOString();

  // Use a ternary to avoid TypeScript issues with conditional chaining on
  // the Supabase query builder's generic return type.
  const { data: conflictRows } = excludeAppointmentId
    ? await supabase
        .from('appointments')
        .select('barber_id, datetime, duration_minutes')
        .eq('salon_id', salonId)
        .in('barber_id', candidates.map((c) => c.id))
        .neq('status', 'cancelled')
        .neq('id', excludeAppointmentId)
        .gte('datetime', queryStart)
        .lt('datetime', queryEnd)
    : await supabase
        .from('appointments')
        .select('barber_id, datetime, duration_minutes')
        .eq('salon_id', salonId)
        .in('barber_id', candidates.map((c) => c.id))
        .neq('status', 'cancelled')
        .gte('datetime', queryStart)
        .lt('datetime', queryEnd);

  const conflicted = new Set<string>();
  for (const row of conflictRows ?? []) {
    const candidate = candidates.find((c) => c.id === row.barber_id);
    if (!candidate) continue;
    const existStartMs  = new Date(row.datetime).getTime();
    const existDuration = row.duration_minutes ?? 30;
    if (appointmentsOverlap(startMs, candidate.durationMinutes, existStartMs, existDuration)) {
      conflicted.add(candidate.id);
    }
  }

  // Alphabetical order from Step 1 is preserved.
  return candidates.filter((c) => !conflicted.has(c.id));
}
