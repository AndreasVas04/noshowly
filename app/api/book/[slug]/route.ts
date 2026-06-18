/**
 * app/api/book/[slug]/route.ts
 *
 * GET /api/book/[slug] — public endpoint; no authentication required.
 *
 * Returns all data needed to render the public booking page:
 *  - Booking page metadata (slug, description, custom_title, custom_intro,
 *    allow_no_preference_*, require_phone, require_email)
 *  - Salon info (name, timezone, phone, currency)
 *  - Active barbers (id, name, bio, photo_url)
 *  - Optionally: booked time slots for a specific date (?date=YYYY-MM-DD)
 *    returned as { time: "HH:MM", barberId: string | null }[] in the salon timezone
 *  - Staff availability records
 *
 * Returns 404 if the slug does not exist or the booking page is not active.
 *
 * Security:
 *  - No authentication — this page is intentionally public.
 *  - Only returns data for is_active=true booking pages.
 *  - Only returns the specific fields needed by the booking UI.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { Salon, Barber, BookingPage, Service, StaffAvailability, BarberService } from '@/types';

/**
 * Converts a UTC ISO string to a local HH:MM time string in the given IANA timezone.
 * Used to convert booked appointment datetimes to local slot times for conflict checking.
 *
 * @param utcIso   - UTC ISO 8601 datetime string.
 * @param timezone - IANA timezone, e.g. "Europe/Nicosia".
 * @returns        HH:MM string in the target timezone.
 */
function utcToLocalTime(utcIso: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour:   '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(utcIso));

  const h = parts.find((p) => p.type === 'hour')?.value   ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h === '24' ? '00' : h}:${m}`;
}

/** Shape returned for an active staff member on the public booking page. */
type PublicBarber = Pick<Barber, 'id' | 'name' | 'bio' | 'photo_url'>;

/** A booked appointment slot: local time + which barber is booked + duration. */
type BookedSlot = {
  /** HH:MM local time in the salon's timezone. */
  time: string;
  /** UUID of the barber assigned to this appointment, or null if unassigned. */
  barberId: string | null;
  /** Appointment duration in minutes. Defaults to 30 when not set. */
  duration: number;
};

/** Global service available on the booking page. */
type PublicService = Pick<Service, 'id' | 'name' | 'duration_minutes' | 'price'>;

/**
 * Links a barber to a service they can perform.
 * Includes optional price/duration overrides so the booking page can display
 * the effective price/duration for a specific barber selection.
 */
type BarberServiceLink = Pick<
  BarberService,
  'barber_id' | 'service_id' | 'price_override' | 'duration_minutes_override'
>;

/**
 * Full response shape for GET /api/book/[slug].
 */
type BookingPageResponse = {
  bookingPage: Pick<
    BookingPage,
    | 'slug'
    | 'description'
    | 'custom_title'
    | 'custom_intro'
    | 'require_phone'
    | 'require_email'
  >;
  salon: Pick<Salon, 'name' | 'timezone' | 'phone' | 'currency'>;
  barbers: PublicBarber[];
  /** Active global services for this salon. */
  globalServices: PublicService[];
  /** Links barbers to the services they can perform. */
  barberServiceAssignments: BarberServiceLink[];
  /** Booked slots for the requested date (?date=YYYY-MM-DD), in salon local time. */
  bookedSlots: BookedSlot[];
  /** Staff availability records for all active barbers. */
  staffAvailability: Pick<
    StaffAvailability,
    'barber_id' | 'day_of_week' | 'is_available' | 'time_slots' | 'start_time_1' | 'end_time_1' | 'start_time_2' | 'end_time_2'
  >[];
};

// ---------------------------------------------------------------------------
// GET — public booking page data
// ---------------------------------------------------------------------------

/**
 * Returns all data needed to render the public-facing booking page for the given slug.
 *
 * Query params:
 *  ?date=YYYY-MM-DD  — optional; when provided, bookedSlots is populated with
 *                       the local-time HH:MM + barber_id of scheduled/confirmed
 *                       appointments on that date in the salon's timezone.
 *
 * @param _request - Incoming request (query params read via URL).
 * @param params   - Route params containing `slug`.
 *
 * @returns 200 BookingPageResponse
 * @returns 404 { error: "Booking page not found" }
 * @returns 500 { error: string }
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const { slug } = await params;

  if (!slug) {
    return Response.json({ error: 'Booking page not found' }, { status: 404 });
  }

  // Use the server Supabase client (anon key); public RLS policies allow reads.
  const supabase = await createServerSupabaseClient();

  // Step 1: Look up the booking page (must be active).
  const { data: bookingPage, error: bpError } = await supabase
    .from('booking_pages')
    .select(
      'id, salon_id, slug, description, custom_title, custom_intro, require_phone, require_email'
    )
    .eq('slug', slug)
    .eq('is_active', true)
    .single();

  if (bpError || !bookingPage) {
    return Response.json({ error: 'Booking page not found' }, { status: 404 });
  }

  const salonId = bookingPage.salon_id;

  // Step 2: Fetch salon info and active barbers in parallel.
  const [salonResult, barbersResult] = await Promise.all([
    supabase
      .from('salons')
      .select('name, timezone, phone, currency')
      .eq('id', salonId)
      .single(),
    supabase
      .from('barbers')
      .select('id, name, bio, photo_url')
      .eq('salon_id', salonId)
      .eq('active', true)
      .order('name', { ascending: true }),
  ]);

  if (salonResult.error || !salonResult.data) {
    console.error('[GET /api/book/[slug]] salon fetch error:', salonResult.error?.message);
    return Response.json({ error: 'Failed to load booking page' }, { status: 500 });
  }

  const barbers = barbersResult.data ?? [];

  // Step 3: Fetch staff availability, global services, and barber_services assignments in parallel.
  let staffAvailability: BookingPageResponse['staffAvailability'] = [];
  let globalServices: PublicService[] = [];
  let barberServiceAssignments: BarberServiceLink[] = [];

  if (barbers.length > 0) {
    const barberIds = barbers.map((b) => b.id);

    const [availResult, servicesResult, assignmentsResult] = await Promise.all([
      supabase
        .from('staff_availability')
        .select('barber_id, day_of_week, is_available, time_slots, start_time_1, end_time_1, start_time_2, end_time_2')
        .in('barber_id', barberIds),
      supabase
        .from('services')
        .select('id, name, duration_minutes, price')
        .eq('salon_id', salonId)
        .eq('active', true)
        .order('name', { ascending: true }),
      supabase
        .from('barber_services')
        .select('barber_id, service_id, price_override, duration_minutes_override')
        .in('barber_id', barberIds),
    ]);

    if (availResult.data) staffAvailability = availResult.data as BookingPageResponse['staffAvailability'];
    if (servicesResult.data) globalServices = servicesResult.data as PublicService[];
    if (assignmentsResult.data) barberServiceAssignments = assignmentsResult.data as BarberServiceLink[];
  } else {
    // No barbers — still fetch global services so the page can display them.
    const { data: svcData } = await supabase
      .from('services')
      .select('id, name, duration_minutes, price')
      .eq('salon_id', salonId)
      .eq('active', true)
      .order('name', { ascending: true });
    if (svcData) globalServices = svcData as PublicService[];
  }

  // Build public barbers list (no embedded services — those are now global).
  const publicBarbers: PublicBarber[] = barbers.map((b) => ({
    id: b.id,
    name: b.name,
    bio: b.bio,
    photo_url: b.photo_url,
  }));

  // Step 4: Optionally fetch booked slots for a specific date.
  // Returns local HH:MM + barber_id so the client can perform per-barber conflict checks.
  let bookedSlots: BookedSlot[] = [];

  const url = new URL(_request.url);
  const dateParam = url.searchParams.get('date');

  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    const salon = salonResult.data;
    // Query a wider UTC window (±1 day) to safely catch any timezone offset.
    const dayStart = new Date(`${dateParam}T00:00:00Z`);
    dayStart.setDate(dayStart.getDate() - 1);
    const dayEnd = new Date(`${dateParam}T00:00:00Z`);
    dayEnd.setDate(dayEnd.getDate() + 2);

    const { data: appointments } = await supabase
      .from('appointments')
      .select('datetime, barber_id, duration_minutes')
      .eq('salon_id', salonId)
      .in('status', ['scheduled', 'confirmed'])
      .gte('datetime', dayStart.toISOString())
      .lt('datetime', dayEnd.toISOString());

    if (appointments) {
      bookedSlots = appointments
        .filter((a) => {
          // Keep only appointments that fall on the requested local date.
          try {
            const localDate = new Intl.DateTimeFormat('en-CA', {
              timeZone: salon.timezone,
              year: 'numeric',
              month: '2-digit',
              day:   '2-digit',
            }).format(new Date(a.datetime as string));
            return localDate === dateParam;
          } catch {
            return false;
          }
        })
        .map((a) => ({
          time:     utcToLocalTime(a.datetime as string, salon.timezone),
          barberId: a.barber_id as string | null,
          duration: (a.duration_minutes as number | null) ?? 30,
        }));
    }
  }

  const response: BookingPageResponse = {
    bookingPage: {
      slug:                      bookingPage.slug,
      description:               bookingPage.description,
      custom_title:              bookingPage.custom_title ?? null,
      custom_intro:              bookingPage.custom_intro ?? null,
      require_phone:             bookingPage.require_phone ?? true,
      require_email:             bookingPage.require_email ?? true,
    },
    salon: {
      name:     salonResult.data.name,
      timezone: salonResult.data.timezone,
      phone:    salonResult.data.phone,
      currency: salonResult.data.currency ?? 'USD',
    },
    barbers: publicBarbers,
    globalServices,
    barberServiceAssignments,
    bookedSlots,
    staffAvailability,
  };

  return Response.json(response, { status: 200 });
}
