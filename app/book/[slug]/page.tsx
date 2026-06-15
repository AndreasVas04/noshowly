/**
 * app/book/[slug]/page.tsx
 *
 * Public booking page — no authentication required.
 *
 * This server component fetches all static data for the booking page (salon info,
 * active barbers with their staff services, staff availability) and passes it to
 * the `BookingFlow` client component which handles the multi-step appointment UI.
 *
 * States:
 *  - Slug not found          → Next.js 404 page
 *  - Slug found + is_active  → Renders BookingFlow with data
 *  - Slug found + inactive   → "Booking is currently unavailable" message
 *
 * Noshowly branding is completely invisible — the client sees only the salon's name.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import BookingFlow from './BookingFlow';
import type { Barber, BarberService, Service, StaffAvailability } from '@/types';

// Force dynamic rendering on every request so clients always see the latest
// barber photos, service list, and availability — never a cached snapshot.
export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ slug: string }>;
};

/** Shape for a barber as passed to BookingFlow. */
type PublicBarber = Pick<Barber, 'id' | 'name' | 'bio' | 'photo_url'>;

/** Global service available on the booking page. */
type PublicService = Pick<Service, 'id' | 'name' | 'duration_minutes' | 'price'>;

/**
 * Links a barber to a service they can perform.
 * Includes optional price/duration overrides so the booking flow can display
 * the effective price/duration when a specific barber is selected.
 */
type BarberServiceLink = Pick<
  BarberService,
  'barber_id' | 'service_id' | 'price_override' | 'duration_minutes_override'
>;

// ---------------------------------------------------------------------------
// Metadata (SEO + browser tab title)
// ---------------------------------------------------------------------------

/**
 * Generates page metadata from the booking page's salon name and description.
 * Falls back to generic text if the slug is not found or inactive.
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: bp } = await supabase
    .from('booking_pages')
    .select('description, custom_title, salon_id')
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle();

  if (!bp) {
    return { title: 'Book an Appointment' };
  }

  const { data: salon } = await supabase
    .from('salons')
    .select('name')
    .eq('id', bp.salon_id)
    .single();

  const salonName = salon?.name ?? 'Book an Appointment';
  const pageTitle = (bp.custom_title as string | null) ?? salonName;

  return {
    title: `Book an appointment: ${pageTitle}`,
    description: (bp.description as string | null) ?? `Book your appointment with ${salonName} online.`,
  };
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

/**
 * Public booking page. Fetches static data server-side and delegates the
 * interactive multi-step flow to the BookingFlow client component.
 *
 * @param params - Route params containing the booking page slug.
 */
export default async function BookPage({ params }: PageProps) {
  const { slug } = await params;
  const supabase = await createServerSupabaseClient();

  // Step 1: Check if the booking page exists (regardless of is_active).
  const { data: bp } = await supabase
    .from('booking_pages')
    .select(
      'id, slug, is_active, description, salon_id, custom_title, custom_intro, require_phone, require_email'
    )
    .eq('slug', slug)
    .maybeSingle();

  if (!bp) {
    // Slug does not exist at all — show Next.js 404.
    notFound();
  }

  if (!bp.is_active) {
    // Booking page exists but owner has disabled it.
    const customTitle = bp.custom_title as string | null;
    return (
      <div className="min-h-screen bg-[#F4F4F5] flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white rounded-2xl p-8 text-center shadow-sm">
          <p className="font-heading text-xl font-semibold text-[#1A1A1A] mb-2">
            {customTitle ?? 'Online booking is currently unavailable'}
          </p>
          <p className="text-sm text-[#C8C8C8]">
            Please contact the business directly to schedule an appointment.
          </p>
        </div>
      </div>
    );
  }

  // Step 2: Fetch salon info and active barbers in parallel.
  const [salonResult, barbersResult] = await Promise.all([
    supabase
      .from('salons')
      .select('name, timezone, phone, opening_time, closing_time, currency')
      .eq('id', bp.salon_id)
      .single(),
    supabase
      .from('barbers')
      .select('id, name, bio, photo_url')
      .eq('salon_id', bp.salon_id)
      .eq('active', true)
      .order('name', { ascending: true }),
  ]);

  if (!salonResult.data) {
    // Salon record missing — should not happen in normal operation.
    notFound();
  }

  const barbers = barbersResult.data ?? [];

  // Step 3: Fetch staff availability, global services, and barber_services assignments in parallel.
  let staffAvailability: Array<Pick<StaffAvailability, 'barber_id' | 'day_of_week' | 'is_available' | 'time_slots' | 'start_time_1' | 'end_time_1' | 'start_time_2' | 'end_time_2'>> = [];
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
        .eq('salon_id', bp.salon_id)
        .eq('active', true)
        .order('name', { ascending: true }),
      supabase
        .from('barber_services')
        .select('barber_id, service_id, price_override, duration_minutes_override')
        .in('barber_id', barberIds),
    ]);

    if (availResult.data) {
      staffAvailability = availResult.data as typeof staffAvailability;
    }
    if (servicesResult.data) {
      globalServices = servicesResult.data as PublicService[];
    }
    if (assignmentsResult.data) {
      barberServiceAssignments = assignmentsResult.data as BarberServiceLink[];
    }
  } else {
    // No barbers — still fetch global services.
    const { data: svcData } = await supabase
      .from('services')
      .select('id, name, duration_minutes, price')
      .eq('salon_id', bp.salon_id)
      .eq('active', true)
      .order('name', { ascending: true });
    if (svcData) globalServices = svcData as PublicService[];
  }

  const publicBarbers: PublicBarber[] = barbers.map((b) => ({
    id: b.id,
    name: b.name,
    bio: b.bio,
    photo_url: b.photo_url,
  }));

  return (
    <BookingFlow
      slug={slug}
      customTitle={(bp.custom_title as string | null) ?? null}
      customIntro={(bp.custom_intro as string | null) ?? null}
      requirePhone={(bp.require_phone as boolean | null) ?? true}
      requireEmail={(bp.require_email as boolean | null) ?? true}
      salon={{
        name:          salonResult.data.name,
        timezone:      salonResult.data.timezone,
        phone:         salonResult.data.phone,
        opening_time:  salonResult.data.opening_time,
        closing_time:  salonResult.data.closing_time,
        currency:      (salonResult.data.currency as string | null) ?? 'USD',
      }}
      barbers={publicBarbers}
      globalServices={globalServices}
      barberServiceAssignments={barberServiceAssignments}
      staffAvailability={staffAvailability}
    />
  );
}
