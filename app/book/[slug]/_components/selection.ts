/**
 * app/book/[slug]/_components/selection.ts
 *
 * What a visitor can pick on the public booking page, given their staff
 * choice (a specific person, "Any available staff", or none for salons
 * without staff):
 *  - the staff members who can be booked at all;
 *  - the services they can pick;
 *  - the slot candidates of a date: who could take the appointment, with
 *    their bookable intervals and their own duration;
 *  - each service's duration and price label, a range when staff overrides
 *    differ.
 *
 * The scheduling rules themselves are in lib/availability.ts.
 *
 * No imports from React or Next.js, so this is safe to use anywhere.
 */

import {
  DEFAULT_OPENING_HOURS,
  eligibleBarberIds,
  getBookableIntervals,
  getEffectiveDuration,
  getEffectivePrice,
  getSalonHoursInterval,
  isBarberEligibleForService,
  type SalonHours,
  type SlotCandidate,
} from '@/lib/availability';
import { dayOfWeekForDate } from '@/lib/time';
import type {
  PublicAvailability,
  PublicBarber,
  PublicService,
  PublicServiceAssignment,
} from '@/types';
import { formatRange } from './format';

/**
 * The salon's staff data and the visitor's staff choice: who a booking can
 * be made with, and what their durations, prices and hours are.
 */
export type StaffScope = {
  /** Salons with active staff always book a specific staff member. */
  salonHasStaff: boolean;
  /** Ids of the staff members who can be booked (see getBookableBarbers()). */
  bookableBarberIds: string[];
  /** The chosen staff member; null for "Any available staff", before choosing and without staff. */
  specificBarber: PublicBarber | null;
  /** All staff/service links of the salon (from barber_services), with overrides. */
  barberServiceAssignments: PublicServiceAssignment[];
  /** Weekly availability of the active staff. */
  staffAvailability: PublicAvailability[];
  /** Salon opening hours ('HH:MM' or null). */
  salonHours: SalonHours;
};

/**
 * Staff members who can be booked: with services configured, only those who
 * can perform at least one active service.
 *
 * @param barbers                  - Active staff, ordered by name.
 * @param globalServices           - Active services of the salon.
 * @param barberServiceAssignments - All staff/service links of the salon.
 * @returns                        The bookable staff, in the order of `barbers`.
 */
export function getBookableBarbers(
  barbers: PublicBarber[],
  globalServices: PublicService[],
  barberServiceAssignments: PublicServiceAssignment[],
): PublicBarber[] {
  return globalServices.length === 0
    ? barbers
    : barbers.filter((b) =>
        globalServices.some((s) => isBarberEligibleForService(s.id, b.id, barberServiceAssignments))
      );
}

/**
 * Services the visitor can pick:
 *  - specific staff member: the services they are eligible for;
 *  - "any" (or not chosen yet): services at least one bookable staff member can perform;
 *  - salon without staff: every active service.
 *
 * @param scope          - Staff data and the staff choice.
 * @param globalServices - Active services of the salon, ordered by name.
 */
export function getAvailableServices(scope: StaffScope, globalServices: PublicService[]): PublicService[] {
  const { salonHasStaff, bookableBarberIds, specificBarber, barberServiceAssignments } = scope;
  return !salonHasStaff
    ? globalServices
    : specificBarber
      ? globalServices.filter((s) => isBarberEligibleForService(s.id, specificBarber.id, barberServiceAssignments))
      : globalServices.filter((s) => eligibleBarberIds(s.id, bookableBarberIds, barberServiceAssignments).length > 0);
}

/**
 * Staff ids a service could be booked with for the current staff choice.
 *
 * @param scope     - Staff data and the staff choice.
 * @param serviceId - Service, or null when none is selected.
 */
function staffIdsFor(scope: StaffScope, serviceId: string | null): string[] {
  const { salonHasStaff, bookableBarberIds, specificBarber, barberServiceAssignments } = scope;
  if (!salonHasStaff) return [];
  if (specificBarber) return [specificBarber.id];
  return eligibleBarberIds(serviceId, bookableBarberIds, barberServiceAssignments);
}

/**
 * Builds the slot candidates for a date: one per eligible staff member with
 * their bookable intervals and own duration, or a single staff-less
 * candidate working the salon hours for salons without staff.
 *
 * @param scope           - Staff data and the staff choice.
 * @param date            - 'YYYY-MM-DD' in the salon timezone.
 * @param selectedService - The chosen service, or null.
 */
export function buildCandidates(
  scope: StaffScope,
  date: string,
  selectedService: PublicService | null,
): SlotCandidate[] {
  const { salonHasStaff, barberServiceAssignments, staffAvailability, salonHours } = scope;
  const dayOfWeek = dayOfWeekForDate(date);
  if (!salonHasStaff) {
    return [{
      barberId: null,
      intervals: [getSalonHoursInterval(salonHours) ?? DEFAULT_OPENING_HOURS],
      durationMinutes: getEffectiveDuration(selectedService, null, barberServiceAssignments),
    }];
  }
  return staffIdsFor(scope, selectedService?.id ?? null).map((barberId) => ({
    barberId,
    intervals: getBookableIntervals(barberId, dayOfWeek, staffAvailability, salonHours),
    durationMinutes: getEffectiveDuration(selectedService, barberId, barberServiceAssignments),
  }));
}

/**
 * Returns the duration label for a service with the current staff choice,
 * e.g. "45" or "30–45" when staff overrides differ. Null when neither the
 * service nor any override defines a duration.
 *
 * @param scope   - Staff data and the staff choice.
 * @param service - The service.
 */
export function serviceDurationLabel(scope: StaffScope, service: PublicService): string | null {
  const { salonHasStaff, barberServiceAssignments } = scope;
  const ids: Array<string | null> = salonHasStaff ? staffIdsFor(scope, service.id) : [null];
  const defined =
    service.duration_minutes != null ||
    barberServiceAssignments.some(
      (a) => a.service_id === service.id && a.duration_minutes_override != null && ids.includes(a.barber_id)
    );
  if (!defined) return null;
  return formatRange(
    (ids.length > 0 ? ids : [null]).map((id) => getEffectiveDuration(service, id, barberServiceAssignments)),
    (n) => `${n}`,
  );
}

/**
 * Returns the price label for a service with the current staff choice,
 * e.g. "€25.00" or "€20.00–€25.00". Null when no price is set.
 *
 * @param scope          - Staff data and the staff choice.
 * @param service        - The service.
 * @param currencySymbol - Symbol of the salon's currency, e.g. "€".
 */
export function servicePriceLabel(
  scope: StaffScope,
  service: PublicService,
  currencySymbol: string,
): string | null {
  const { salonHasStaff, barberServiceAssignments } = scope;
  const ids: Array<string | null> = salonHasStaff ? staffIdsFor(scope, service.id) : [null];
  const prices = (ids.length > 0 ? ids : [null])
    .map((id) => getEffectivePrice(service, id, barberServiceAssignments))
    .filter((p): p is number => p !== null);
  return formatRange(prices, (n) => `${currencySymbol}${n.toFixed(2)}`);
}
