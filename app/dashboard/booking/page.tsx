/**
 * app/dashboard/booking/page.tsx
 *
 * Online Booking management page — /dashboard/booking.
 *
 * This is the centralised place for all booking-related configuration:
 *  1. Booking page — address, live status, headline, intro, description and
 *     the client details a booking requires.
 *  2. Services — global service catalogue (add/edit/delete/toggle active).
 *  3. Staff — add/remove staff members, update name/photo/bio,
 *     service assignments (barber_services), weekly availability.
 *  4. Publish — CTA to go live or take offline.
 *
 * Auto-save never disables the field being typed in, runs one save at a time
 * per section (per staff member for profiles, availability and service
 * assignments), and only applies server values to fields the owner has not
 * changed since the request was sent.
 *
 * Structure: this page is the composition root. It loads everything in
 * parallel on mount, shows the loading and error states, and renders the
 * sections from components/dashboard/booking-settings/, each fed by the hook
 * that owns its state and handlers:
 *  - BookingPageSection, PublishSection ← useBookingPageSettings
 *  - ServicesSection                    ← useServicesEditor
 *  - StaffSection, with StaffCard, StaffServices, StaffAvailability and
 *    AddStaffForm                       ← useStaffEditor, useServiceAssignments,
 *                                         useStaffPhotos
 *  - PhotoCropModal                     ← useStaffPhotos
 * The form model and its pure helpers are in form-state.ts, the crop
 * geometry in photo-crop.ts, and the shared switches and card in controls.tsx.
 *
 * Design: brand-dark palette, shadcn Input + Button.
 * Security: all mutations go through API routes.
 */

'use client';

import { useState, useEffect } from 'react';
import BookingPageSection from '@/components/dashboard/booking-settings/BookingPageSection';
import PhotoCropModal from '@/components/dashboard/booking-settings/PhotoCropModal';
import PublishSection from '@/components/dashboard/booking-settings/PublishSection';
import ServicesSection from '@/components/dashboard/booking-settings/ServicesSection';
import StaffSection from '@/components/dashboard/booking-settings/StaffSection';
import { useBookingPageSettings } from '@/components/dashboard/booking-settings/useBookingPageSettings';
import { useServiceAssignments } from '@/components/dashboard/booking-settings/useServiceAssignments';
import { useServicesEditor } from '@/components/dashboard/booking-settings/useServicesEditor';
import { useStaffEditor } from '@/components/dashboard/booking-settings/useStaffEditor';
import { useStaffPhotos } from '@/components/dashboard/booking-settings/useStaffPhotos';
import { getCurrencySymbol } from '@/lib/currency';
import type { Barber, BarberService, BookingPage, Service, StaffAvailability } from '@/types';

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

type LoadState = 'loading' | 'ready' | 'error';

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

/**
 * BookingPage manages the full Online Booking setup: the booking page
 * settings, the services, each staff member's profile, photo, services and
 * availability, and the publish controls.
 *
 * @returns The booking management page JSX.
 */
export default function BookingPage() {
  // -------------------------------------------------------------------------
  // Global load state
  // -------------------------------------------------------------------------
  const [loadState, setLoadState] = useState<LoadState>('loading');

  // -------------------------------------------------------------------------
  // Section state and handlers
  // -------------------------------------------------------------------------
  // Effects run in hook call order: the staff editor sizes the bio textareas
  // before the booking page settings size theirs.
  const staffEditor = useStaffEditor();
  const bookingSettings = useBookingPageSettings();
  const serviceAssignments = useServiceAssignments();
  const servicesEditor = useServicesEditor(serviceAssignments.updateBarberServiceAssignments);
  const staffPhotos = useStaffPhotos(staffEditor.updateBarberField);

  /** Salon currency code — fetched once on mount for price display. */
  const [salonCurrency, setSalonCurrency] = useState('USD');
  const currencySymbol = getCurrencySymbol(salonCurrency);

  // -------------------------------------------------------------------------
  // Initial data load
  // -------------------------------------------------------------------------

  const { initBookingPage } = bookingSettings;
  const { initServices } = servicesEditor;
  const { initAssignments } = serviceAssignments;
  const { initStaff } = staffEditor;

  /**
   * Fetches booking page, barbers, staff services, and availability in parallel
   * on mount. Initialises form state from loaded data. The init functions
   * never change, so this runs once.
   */
  useEffect(() => {
    async function loadData() {
      try {
        const [bookingRes, barbersRes, availabilityRes, salonServicesRes, barberServicesRes, salonRes] = await Promise.all([
          fetch('/api/booking-page'),
          fetch('/api/barbers'),
          fetch('/api/staff-availability'),
          fetch('/api/services'),
          fetch('/api/barber-services'),
          fetch('/api/salon'),
        ]);

        const [bookingData, barbersData, availData, salonServicesData, barberServicesData] = await Promise.all([
          bookingRes.ok
            ? (bookingRes.json() as Promise<{ bookingPage: BookingPage | null }>)
            : Promise.resolve({ bookingPage: null }),
          barbersRes.ok
            ? (barbersRes.json() as Promise<{ barbers: Barber[] }>)
            : Promise.resolve({ barbers: [] }),
          availabilityRes.ok
            ? (availabilityRes.json() as Promise<{ availability: StaffAvailability[] }>)
            : Promise.resolve({ availability: [] }),
          salonServicesRes.ok
            ? (salonServicesRes.json() as Promise<{ services: Service[] }>)
            : Promise.resolve({ services: [] }),
          barberServicesRes.ok
            ? (barberServicesRes.json() as Promise<{ barberServices: BarberService[] }>)
            : Promise.resolve({ barberServices: [] }),
        ]);

        // Fetch salon currency for price display.
        if (salonRes.ok) {
          const salonData = (await salonRes.json()) as { salon: { currency?: string } };
          if (salonData.salon?.currency) setSalonCurrency(salonData.salon.currency);
        }

        const bp = bookingData.bookingPage;
        initBookingPage(bp);

        const loadedBarbers = barbersData.barbers ?? [];
        const loadedAvailability = availData.availability ?? [];
        // Load all services (active and inactive) so the admin can manage them.
        const loadedSalonServices = salonServicesData.services ?? [];
        const loadedBarberServices = barberServicesData.barberServices ?? [];

        initServices(loadedSalonServices);
        initAssignments(loadedBarberServices);
        initStaff(loadedBarbers, loadedAvailability);

        setLoadState('ready');
      } catch {
        setLoadState('error');
      }
    }

    void loadData();
  }, [initBookingPage, initServices, initAssignments, initStaff]);

  // -------------------------------------------------------------------------
  // Loading / error states
  // -------------------------------------------------------------------------

  if (loadState === 'loading') {
    return (
      <div className="p-8 lg:p-12 flex items-center justify-center min-h-64">
        <p className="text-sm text-[#6F6B65]">Loading booking settings…</p>
      </div>
    );
  }

  if (loadState === 'error') {
    return (
      <div className="p-8 lg:p-12">
        <div className="max-w-3xl bg-red-50 border border-red-100 rounded-2xl p-6">
          <p className="text-sm text-red-700 font-medium">Failed to load booking settings.</p>
          <p className="text-sm text-red-600 mt-1">
            Please refresh the page. If the problem persists, contact support.
          </p>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Derived values
  // -------------------------------------------------------------------------

  const { bookingPage } = bookingSettings;
  const { salonServices } = servicesEditor;

  const bookingUrl = typeof window !== 'undefined' && bookingPage
    ? `${window.location.origin}/book/${bookingPage.slug}`
    : bookingPage ? `https://noshowly.vercel.app/book/${bookingPage.slug}` : null;

  /** Whether at least one active global service exists. */
  const hasAnyService = salonServices.some((s) => s.active);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <>
      <div className="p-8 lg:p-12">
        <div className="max-w-3xl space-y-12">

          {/* Page heading */}
          <div>
            <h1 className="font-heading text-3xl font-semibold text-[#1A1A1A]">Online Booking</h1>
            <p className="text-sm text-[#6F6B65] mt-1.5">
              Set up your public booking page, staff, and availability.
            </p>
          </div>

          {/* ==================================================================
              SECTION 1: Booking page settings
          ================================================================== */}
          <BookingPageSection settings={bookingSettings} bookingUrl={bookingUrl} />

          {/* ==================================================================
              SECTION 2: Global Services
          ================================================================== */}
          <ServicesSection services={servicesEditor} currencySymbol={currencySymbol} />

          {/* ==================================================================
              SECTION 3: Staff
          ================================================================== */}
          <StaffSection
            staff={staffEditor}
            photos={staffPhotos}
            assignments={serviceAssignments}
            salonServices={salonServices}
            currencySymbol={currencySymbol}
          />

          {/* ==================================================================
              SECTION 4: Publish
          ================================================================== */}
          <PublishSection settings={bookingSettings} bookingUrl={bookingUrl} hasAnyService={hasAnyService} />

        </div>
      </div>

      <PhotoCropModal photos={staffPhotos} />
    </>
  );
}
