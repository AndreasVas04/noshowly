/**
 * app/api/book/[slug]/route.ts
 *
 * GET /api/book/[slug] — public endpoint; no authentication required.
 *
 * Returns the data needed to render the public booking page:
 *  - Booking page settings (slug, description, custom_title, custom_intro,
 *    require_phone, require_email)
 *  - Salon info (name, timezone, phone, currency, opening/closing time)
 *  - Active staff (id, name, photo_url, bio)
 *  - Active services and the staff/service links with per-staff overrides
 *  - Weekly availability of the active staff
 *  - With ?date=YYYY-MM-DD: the busy intervals of non-cancelled appointments
 *    on that salon date, as { barber_id, datetime, duration_minutes }
 *
 * The booking page computes the bookable times from this data with the shared
 * rules in lib/availability.ts; the booking POST re-checks them.
 *
 * Returns 404 if the slug does not exist or the booking page is not active,
 * and 403 "not accepting online bookings" when the owner's trial has ended or
 * their subscription is inactive (lib/booking-data.ts salonAcceptsBookings).
 *
 * Security:
 *  - No authentication — this page is intentionally public.
 *  - Reads use the service-role client (lib/booking-data.ts) because anonymous
 *    visitors cannot read appointments or staff/service links through RLS.
 *  - Only returns data for active booking pages, with explicit column lists;
 *    busy intervals carry no client, service or note information.
 */

import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import {
  NOT_ACCEPTING_BOOKINGS_MESSAGE,
  getBookingPageBySlug,
  loadBusyIntervals,
  loadPublicBookingData,
  salonAcceptsBookings,
} from '@/lib/booking-data';
import { isValidDateString } from '@/lib/time';
import type {
  PublicAvailability,
  PublicBarber,
  PublicBookingPage,
  PublicBusyInterval,
  PublicSalon,
  PublicService,
  PublicServiceAssignment,
} from '@/types';

/**
 * Full response shape for GET /api/book/[slug].
 */
type BookingPageResponse = {
  bookingPage: PublicBookingPage;
  salon: PublicSalon;
  barbers: PublicBarber[];
  /** Active services for this salon. */
  globalServices: PublicService[];
  /** Links staff to the services they can perform (all links of the salon). */
  barberServiceAssignments: PublicServiceAssignment[];
  /** Weekly availability of the active staff. */
  staffAvailability: PublicAvailability[];
  /** Busy intervals on the requested date (?date=YYYY-MM-DD); empty without a date. */
  busy: PublicBusyInterval[];
};

// ---------------------------------------------------------------------------
// GET — public booking page data
// ---------------------------------------------------------------------------

/**
 * Returns all data needed to render the public-facing booking page for the given slug.
 *
 * Query params:
 *  ?date=YYYY-MM-DD  — optional; when provided, `busy` lists the non-cancelled,
 *                       staff-assigned appointments overlapping that salon date.
 *
 * @param request - Incoming request (query params read via URL).
 * @param params  - Route params containing `slug`.
 *
 * @returns 200 BookingPageResponse
 * @returns 400 { error: string }                     — invalid date
 * @returns 403 { error: string }                     — the business is not taking bookings
 * @returns 404 { error: "Booking page not found" }
 * @returns 500 { error: string }
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const { slug } = await params;

  const dateParam = new URL(request.url).searchParams.get('date');
  if (dateParam !== null && !isValidDateString(dateParam)) {
    return Response.json({ error: 'date must be a valid YYYY-MM-DD date' }, { status: 400 });
  }

  try {
    const supabase = createAdminSupabaseClient();

    // Step 1: Look up the booking page (must be active).
    const bookingPage = await getBookingPageBySlug(supabase, slug);
    if (!bookingPage || !bookingPage.is_active) {
      return Response.json({ error: 'Booking page not found' }, { status: 404 });
    }

    // Step 1b: The owner's account must take bookings (paid plan or running trial).
    if (!(await salonAcceptsBookings(supabase, bookingPage.salon_id))) {
      return Response.json(
        { error: NOT_ACCEPTING_BOOKINGS_MESSAGE },
        { status: 403, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    // Step 2: Salon, active staff, active services, staff/service links, availability.
    const data = await loadPublicBookingData(supabase, bookingPage.salon_id);
    if (!data) {
      console.error('[GET /api/book/[slug]] salon missing for booking page:', bookingPage.id);
      return Response.json({ error: 'Failed to load booking page' }, { status: 500 });
    }

    // Step 3: Busy intervals for the requested salon date.
    const busy = dateParam
      ? await loadBusyIntervals(supabase, bookingPage.salon_id, dateParam, data.salon.timezone)
      : [];

    const response: BookingPageResponse = {
      bookingPage: {
        slug:          bookingPage.slug,
        description:   bookingPage.description,
        custom_title:  bookingPage.custom_title,
        custom_intro:  bookingPage.custom_intro,
        require_phone: bookingPage.require_phone,
        require_email: bookingPage.require_email,
      },
      salon:                    data.salon,
      barbers:                  data.barbers,
      globalServices:           data.services,
      barberServiceAssignments: data.assignments,
      staffAvailability:        data.availability,
      busy,
    };

    return Response.json(response, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    console.error('[GET /api/book/[slug]] error:', err);
    return Response.json({ error: 'Failed to load booking page' }, { status: 500 });
  }
}
