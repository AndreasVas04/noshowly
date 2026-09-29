/**
 * app/book/[slug]/page.tsx
 *
 * Public booking page — no authentication required.
 *
 * This server component loads the booking page data server-side (salon info,
 * active staff, active services, staff/service links and staff availability)
 * and passes it to the `BookingFlow` client component, which handles the
 * multi-step appointment UI.
 *
 * States:
 *  - Slug not found                         → Next.js 404 page
 *  - Slug found + is_active                 → Renders BookingFlow with data
 *  - Slug found + inactive                  → "Not accepting online bookings" message
 *  - Slug found + owner's trial has ended
 *    or subscription is inactive            → the same message (lib/booking-data.ts
 *                                              salonAcceptsBookings); the reason is
 *                                              never shown to visitors
 *
 * Reads use the service-role client via lib/booking-data.ts: anonymous
 * visitors cannot read staff/service links through RLS, and the page must not
 * depend on anonymous reads at all.
 *
 * Noshowly branding is completely invisible — the client sees only the salon's name.
 */

import { cache } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import BookingFlow from './BookingFlow';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import {
  getBookingPageBySlug,
  getPublicSalon,
  loadPublicBookingData,
  salonAcceptsBookings,
} from '@/lib/booking-data';

// Force dynamic rendering on every request so clients always see the latest
// barber photos, service list, and availability — never a cached snapshot.
export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ slug: string }>;
};

/** Booking page lookup, shared by generateMetadata and the page within one request. */
const loadBookingPage = cache(async (slug: string) =>
  getBookingPageBySlug(createAdminSupabaseClient(), slug)
);

// ---------------------------------------------------------------------------
// Metadata (SEO + browser tab title)
// ---------------------------------------------------------------------------

/**
 * Generates page metadata from the booking page's salon name and description.
 * Falls back to generic text if the slug is not found or inactive.
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const bp = await loadBookingPage(slug);

  if (!bp || !bp.is_active) {
    return { title: 'Book an Appointment' };
  }

  const salon = await getPublicSalon(createAdminSupabaseClient(), bp.salon_id);
  const salonName = salon?.name ?? 'Book an Appointment';
  const pageTitle = bp.custom_title ?? salonName;

  return {
    title: `Book an appointment: ${pageTitle}`,
    description: bp.description ?? `Book your appointment with ${salonName} online.`,
  };
}

// ---------------------------------------------------------------------------
// Not accepting bookings
// ---------------------------------------------------------------------------

/**
 * The page shown when the business does not take online bookings: the owner
 * switched the page off, or their account is read-only.
 *
 * @param title - Page title or salon name.
 * @param phone - Salon phone number, shown as a call link when set.
 */
function NotAcceptingBookings({ title, phone }: { title: string; phone: string | null }) {
  return (
    <div className="min-h-screen bg-[#F4F4F5] flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-2xl p-8 text-center shadow-sm">
        <p className="font-heading text-xl font-semibold text-[#1A1A1A] mb-2">
          {title}
        </p>
        <p className="font-body text-base text-[#1A1A1A] mb-2">
          We are not accepting online bookings right now.
        </p>
        <p className="font-body text-sm text-[#8A8680]">
          Please contact the business directly to schedule an appointment.
        </p>
        {phone && (
          <p className="font-body text-sm font-medium text-[#1A1A1A] mt-3">
            <a href={`tel:${phone}`} className="underline underline-offset-2">
              {phone}
            </a>
          </p>
        )}
      </div>
    </div>
  );
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

  // Step 1: Check if the booking page exists (regardless of is_active).
  const bp = await loadBookingPage(slug);

  if (!bp) {
    // Slug does not exist at all — show Next.js 404.
    notFound();
  }

  const supabase = createAdminSupabaseClient();

  // Step 2: The owner turned the page off, or their account does not take
  // bookings (trial ended or subscription inactive).
  if (!bp.is_active || !(await salonAcceptsBookings(supabase, bp.salon_id))) {
    const salon = await getPublicSalon(supabase, bp.salon_id);
    return (
      <NotAcceptingBookings
        title={bp.custom_title ?? salon?.name ?? 'Online booking'}
        phone={salon?.phone ?? null}
      />
    );
  }

  // Step 3: Salon, active staff, active services, staff/service links, availability.
  const data = await loadPublicBookingData(supabase, bp.salon_id);

  if (!data) {
    // Salon record missing — should not happen in normal operation.
    notFound();
  }

  return (
    <BookingFlow
      slug={bp.slug}
      customTitle={bp.custom_title}
      customIntro={bp.custom_intro}
      requirePhone={bp.require_phone}
      requireEmail={bp.require_email}
      salon={data.salon}
      barbers={data.barbers}
      globalServices={data.services}
      barberServiceAssignments={data.assignments}
      staffAvailability={data.availability}
    />
  );
}
