/**
 * lib/booking-data.ts
 *
 * Server-side reads for the public booking page:
 *  - app/book/[slug]/page.tsx              (initial render)
 *  - app/api/book/[slug]/route.ts          (busy times for a date)
 *  - app/api/book/[slug]/appointments      (validating a booking)
 *
 * Visitors are anonymous, and the anon key cannot read booking data (see
 * supabase/migrations/). Reading with it made every time look free and
 * ignored staff/service assignments. These reads use the service-role client
 * instead, always scoped to one booking page's salon and always with explicit
 * column lists. Client ids, names, contact details and notes are never read.
 *
 * An active booking page only takes bookings while its owner's account can
 * (salonAcceptsBookings()): a paid plan or a trial that has not ended. Pages
 * of an ended trial or an inactive subscription show "not accepting online
 * bookings", exactly like a page the owner switched off.
 */

import 'server-only';
import type { AdminSupabaseClient } from '@/lib/supabase/admin';
import { getEntitlements } from '@/lib/entitlements';
import { MAX_DURATION_MINUTES } from '@/lib/availability';
import { dayRangeUtc, normaliseTime, resolveTimeZone } from '@/lib/time';
import type {
  BookingPage,
  PublicAvailability,
  PublicBarber,
  PublicBusyInterval,
  PublicService,
  PublicServiceAssignment,
  PublicSalon,
} from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A booking page row as read for the public page (active or not). */
export type BookingPageRecord = Pick<
  BookingPage,
  | 'id'
  | 'salon_id'
  | 'slug'
  | 'is_active'
  | 'description'
  | 'custom_title'
  | 'custom_intro'
  | 'require_phone'
  | 'require_email'
>;

/** Everything the public booking page needs besides busy times. */
export type PublicBookingData = {
  salon: PublicSalon;
  /** Active staff, ordered by name. */
  barbers: PublicBarber[];
  /** Active services, ordered by name. */
  services: PublicService[];
  /** All staff/service links of the salon (see eligibleBarberIds()). */
  assignments: PublicServiceAssignment[];
  /** Weekly availability of the active staff. */
  availability: PublicAvailability[];
};

/** Slugs are 3–60 lowercase letters, digits and hyphens (see /api/booking-page). */
const SLUG_PATTERN = /^[a-z0-9-]{1,60}$/;

/** Shown to visitors when the owner's account does not take bookings (never says why). */
export const NOT_ACCEPTING_BOOKINGS_MESSAGE =
  'We are not accepting online bookings right now. Please contact the business directly.';

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

/**
 * Returns true when the salon's owner can take online bookings: a paid plan,
 * or a trial that has not ended (lib/entitlements.ts canWrite). A salon or
 * owner that cannot be found does not take bookings.
 *
 * @param supabase - Service-role client.
 * @param salonId  - Salon of the booking page.
 * @param now      - Current instant.
 * @throws Error   On a database error.
 */
export async function salonAcceptsBookings(
  supabase: AdminSupabaseClient,
  salonId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const { data: salon, error: salonError } = await supabase
    .from('salons')
    .select('user_id')
    .eq('id', salonId)
    .maybeSingle();

  if (salonError) throw new Error(`Failed to load the salon owner: ${salonError.message}`);
  if (!salon) return false;

  const { data: owner, error: ownerError } = await supabase
    .from('users')
    .select('plan, trial_ends_at')
    .eq('id', salon.user_id)
    .maybeSingle();

  if (ownerError) throw new Error(`Failed to load the owner's plan: ${ownerError.message}`);
  if (!owner) return false;

  return getEntitlements(owner, now).canWrite;
}

/**
 * Looks up a booking page by slug, whether it is active or not.
 *
 * @param supabase - Service-role client.
 * @param slug     - Public slug from the URL.
 * @returns        The booking page, or null when no page has this slug.
 * @throws Error   On a database error.
 */
export async function getBookingPageBySlug(
  supabase: AdminSupabaseClient,
  slug: string,
): Promise<BookingPageRecord | null> {
  if (!SLUG_PATTERN.test(slug)) return null;

  const { data, error } = await supabase
    .from('booking_pages')
    .select('id, salon_id, slug, is_active, description, custom_title, custom_intro, require_phone, require_email')
    .eq('slug', slug)
    .maybeSingle();

  if (error) throw new Error(`Failed to load booking page: ${error.message}`);
  if (!data) return null;

  return {
    ...data,
    require_phone: data.require_phone ?? true,
    require_email: data.require_email ?? true,
  };
}

/**
 * Loads the salon's public fields. The timezone is validated (falling back to
 * 'UTC') and opening hours are normalised to 'HH:MM'.
 *
 * @param supabase - Service-role client.
 * @param salonId  - Salon of the booking page.
 * @returns        The salon, or null when it does not exist.
 * @throws Error   On a database error.
 */
export async function getPublicSalon(
  supabase: AdminSupabaseClient,
  salonId: string,
): Promise<PublicSalon | null> {
  const { data, error } = await supabase
    .from('salons')
    .select('name, timezone, phone, currency, opening_time, closing_time')
    .eq('id', salonId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load salon: ${error.message}`);
  if (!data) return null;

  return {
    name:         data.name,
    timezone:     resolveTimeZone(data.timezone),
    phone:        data.phone,
    currency:     data.currency ?? 'USD',
    opening_time: normaliseTime(data.opening_time),
    closing_time: normaliseTime(data.closing_time),
  };
}

/**
 * Loads the salon, active staff, active services, staff/service links and
 * staff availability for a booking page.
 *
 * @param supabase - Service-role client.
 * @param salonId  - Salon of the booking page.
 * @returns        The data, or null when the salon does not exist.
 * @throws Error   On a database error.
 */
export async function loadPublicBookingData(
  supabase: AdminSupabaseClient,
  salonId: string,
): Promise<PublicBookingData | null> {
  const [salon, barbersResult, servicesResult, assignmentsResult] = await Promise.all([
    getPublicSalon(supabase, salonId),
    supabase
      .from('barbers')
      .select('id, name, photo_url, bio')
      .eq('salon_id', salonId)
      .eq('active', true)
      .order('name', { ascending: true }),
    supabase
      .from('services')
      .select('id, name, duration_minutes, price')
      .eq('salon_id', salonId)
      .eq('active', true)
      .order('name', { ascending: true }),
    supabase
      .from('barber_services')
      .select('barber_id, service_id, price_override, duration_minutes_override')
      .eq('salon_id', salonId),
  ]);

  if (!salon) return null;
  if (barbersResult.error) throw new Error(`Failed to load staff: ${barbersResult.error.message}`);
  if (servicesResult.error) throw new Error(`Failed to load services: ${servicesResult.error.message}`);
  if (assignmentsResult.error) {
    throw new Error(`Failed to load staff services: ${assignmentsResult.error.message}`);
  }

  const barbers: PublicBarber[] = barbersResult.data ?? [];

  let availability: PublicAvailability[] = [];
  if (barbers.length > 0) {
    const { data, error } = await supabase
      .from('staff_availability')
      .select('barber_id, day_of_week, is_available, time_slots, start_time_1, end_time_1, start_time_2, end_time_2')
      .in('barber_id', barbers.map((b) => b.id));
    if (error) throw new Error(`Failed to load availability: ${error.message}`);
    availability = data ?? [];
  }

  return {
    salon,
    barbers,
    services: (servicesResult.data ?? []).map((s) => ({
      ...s,
      price: s.price != null ? Number(s.price) : null,
    })),
    assignments: (assignmentsResult.data ?? []).map((a) => ({
      ...a,
      price_override: a.price_override != null ? Number(a.price_override) : null,
    })),
    availability,
  };
}

/**
 * Loads the time taken by the salon's non-cancelled, staff-assigned
 * appointments that overlap a salon date, including appointments that started
 * the evening before and run past midnight. Only staff id, start and
 * duration are read.
 *
 * @param supabase - Service-role client.
 * @param salonId  - Salon of the booking page.
 * @param date     - 'YYYY-MM-DD' in the salon timezone.
 * @param timeZone - Salon timezone.
 * @returns        Busy intervals, ordered by start.
 * @throws Error   On a database error or an invalid date.
 */
export async function loadBusyIntervals(
  supabase: AdminSupabaseClient,
  salonId: string,
  date: string,
  timeZone: string,
): Promise<PublicBusyInterval[]> {
  const day = dayRangeUtc(date, timeZone);
  const earliestStart = new Date(day.start.getTime() - MAX_DURATION_MINUTES * 60_000);

  const { data, error } = await supabase
    .from('appointments')
    .select('barber_id, datetime, duration_minutes')
    .eq('salon_id', salonId)
    .neq('status', 'cancelled')
    .not('barber_id', 'is', null)
    .gte('datetime', earliestStart.toISOString())
    .lt('datetime', day.end.toISOString())
    .order('datetime', { ascending: true });

  if (error) throw new Error(`Failed to load booked times: ${error.message}`);

  const dayStartMs = day.start.getTime();
  return (data ?? []).filter((a) => {
    const end = new Date(a.datetime).getTime() + (a.duration_minutes ?? 30) * 60_000;
    return end > dayStartMs;
  });
}
