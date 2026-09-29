/**
 * components/dashboard/booking-settings/PublishSection.tsx
 *
 * Section 4 of the booking settings page: publish. While the booking page is
 * live it shows the link to share and "Take offline"; otherwise "Publish
 * booking page", which needs a saved booking page and at least one active
 * service.
 *
 * State and handlers come from useBookingPageSettings.
 */

'use client';

import { SectionCard } from '@/components/dashboard/booking-settings/controls';
import type { BookingPageSettings } from '@/components/dashboard/booking-settings/useBookingPageSettings';
import { Button } from '@/components/ui/button';

/** Props accepted by PublishSection. */
interface PublishSectionProps {
  /** Booking page settings state and handlers (useBookingPageSettings). */
  settings: BookingPageSettings;
  /** Public URL of the booking page; null when there is no booking page yet. */
  bookingUrl: string | null;
  /** Whether at least one active service exists. */
  hasAnyService: boolean;
}

/**
 * PublishSection renders the "Publish" section.
 *
 * @param props.settings      - Booking page settings state and handlers.
 * @param props.bookingUrl    - Public URL of the booking page.
 * @param props.hasAnyService - Whether at least one active service exists.
 */
export default function PublishSection({ settings, bookingUrl, hasAnyService }: PublishSectionProps) {
  const { bookingPage, togglingLive, toggleError, handleBookingToggle } = settings;

  return (
    <section>
      <h2 className="font-heading text-base font-semibold text-[#1A1A1A] mb-1">Publish</h2>
      <p className="text-sm text-[#6F6B65] mb-4">
        Make your booking page live so clients can start booking online.
      </p>

      <SectionCard>
        <div className="p-6 space-y-4">

          {bookingPage?.is_active ? (
            <>
              <div className="flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />
                <p className="text-sm font-medium text-[#1A1A1A]">
                  Your booking page is live
                </p>
              </div>
              {bookingUrl && (
                <p className="text-sm text-[#6F6B65]">
                  Share this link with your clients:{' '}
                  <a
                    href={bookingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-[#1A1A1A] hover:underline"
                  >
                    {bookingUrl}
                  </a>
                </p>
              )}
              <Button
                type="button"
                onClick={() => void handleBookingToggle(false, 'publish')}
                disabled={togglingLive}
                variant="outline"
                className="border-[#E5E2DB] text-[#1A1A1A] hover:border-[#1A1A1A]/40 text-sm"
              >
                {togglingLive ? 'Taking offline…' : 'Take offline'}
              </Button>
            </>
          ) : (
            <>
              {!bookingPage && (
                <p className="text-sm text-amber-700">
                  You need to save a booking page URL before you can go live.
                </p>
              )}
              {!hasAnyService && (
                <p className="text-sm text-amber-700">
                  Add at least one active service before going live.
                </p>
              )}

              <Button
                type="button"
                disabled={!bookingPage || !hasAnyService || togglingLive}
                onClick={() => void handleBookingToggle(true, 'publish')}
                className="bg-[#1B4332] hover:bg-[#16392A] text-white text-sm font-medium px-8 py-3 h-auto disabled:opacity-40"
              >
                {togglingLive ? 'Publishing…' : 'Publish booking page'}
              </Button>

              {bookingPage && hasAnyService && (
                <p className="text-xs text-[#6F6B65]">
                  Your page will be visible at{' '}
                  <span className="font-mono">/book/{bookingPage.slug}</span>.
                  You can take it offline at any time.
                </p>
              )}
            </>
          )}

          {toggleError?.source === 'publish' && (
            <p role="alert" className="text-sm text-red-600">{toggleError.message}</p>
          )}

        </div>
      </SectionCard>
    </section>
  );
}
