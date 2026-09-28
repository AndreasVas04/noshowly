/**
 * lib/barber-services.ts
 *
 * Client-side helper for saving a staff member's service assignments
 * (app/dashboard/booking/page.tsx → PUT /api/barber-services).
 *
 * The page saves a staff member's whole assignment list at a time, one
 * request after another. While a request is in flight the owner can keep
 * ticking services and editing prices or durations, so a finished request must
 * not undo those newer changes when its response is applied.
 *
 * No imports from Next.js or Supabase, so this is safe to use anywhere.
 */

import type { BarberService } from '@/types';

/** The parts of an assignment that the owner edits and the API saves. */
export type AssignmentValues = Pick<
  BarberService,
  'service_id' | 'price_override' | 'duration_minutes_override'
>;

/**
 * Returns the assignment values to send for a staff member's rows.
 *
 * @param rows - The staff member's assignment rows.
 */
export function toAssignmentValues(rows: readonly AssignmentValues[]): AssignmentValues[] {
  return rows.map((row) => ({
    service_id: row.service_id,
    price_override: row.price_override,
    duration_minutes_override: row.duration_minutes_override,
  }));
}

/**
 * Merges a staff member's rows as the server holds them into what the owner
 * sees now, once a save request has finished (or failed and been reloaded).
 *
 * The server wins for everything the owner has not touched since the request
 * was sent: which services are assigned, row ids and override values. What the
 * owner changed while the request was in flight (a service ticked or unticked,
 * a price or duration edited) is kept, because a later save sends it.
 *
 * @param current - The staff member's rows as the owner sees them now.
 * @param sent    - The assignment values the finished request sent.
 * @param saved   - The staff member's rows as the server holds them.
 * @returns       The staff member's rows to show.
 */
export function mergeSavedAssignments(
  current: readonly BarberService[],
  sent: readonly AssignmentValues[],
  saved: readonly BarberService[],
): BarberService[] {
  const serviceIds = [
    ...new Set([...current, ...saved].map((row) => row.service_id)),
  ];

  const merged: BarberService[] = [];
  for (const serviceId of serviceIds) {
    const now    = current.find((row) => row.service_id === serviceId);
    const before = sent.find((row) => row.service_id === serviceId);
    const server = saved.find((row) => row.service_id === serviceId);

    // Ticked or unticked since the request was sent: keep the owner's choice.
    if (Boolean(now) !== Boolean(before)) {
      if (now) merged.push(now);
      continue;
    }

    // Otherwise the server decides whether the service is assigned.
    if (!server) continue;
    if (!now || !before) {
      merged.push(server);
      continue;
    }

    // Keep each override the owner edited since the request was sent.
    merged.push({
      ...server,
      price_override:
        now.price_override === before.price_override ? server.price_override : now.price_override,
      duration_minutes_override:
        now.duration_minutes_override === before.duration_minutes_override
          ? server.duration_minutes_override
          : now.duration_minutes_override,
    });
  }
  return merged;
}
