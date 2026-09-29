/**
 * components/dashboard/booking-settings/BookingPageSection.tsx
 *
 * Section 1 of the booking settings page: the public booking page.
 *  - No booking page yet: choose the booking URL (slug) and create the page.
 *  - Booking page exists: live/offline status with the live toggle, plus
 *    "Copy link" and "Open ↗" while live; the permanent URL; headline,
 *    description and link preview description with a live preview of the
 *    page hero; and the required client contact fields. Every change is
 *    auto-saved.
 *
 * State and handlers come from useBookingPageSettings.
 */

'use client';

import { SectionCard, Toggle } from '@/components/dashboard/booking-settings/controls';
import type { BookingPageSettings } from '@/components/dashboard/booking-settings/useBookingPageSettings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Props accepted by BookingPageSection. */
interface BookingPageSectionProps {
  /** Booking page settings state and handlers (useBookingPageSettings). */
  settings: BookingPageSettings;
  /** Public URL of the booking page; null when there is no booking page yet. */
  bookingUrl: string | null;
}

/**
 * BookingPageSection renders the "Booking page" section: the create form
 * before the booking page exists, the auto-saved settings after.
 *
 * @param props.settings   - Booking page settings state and handlers.
 * @param props.bookingUrl - Public URL of the booking page.
 */
export default function BookingPageSection({ settings, bookingUrl }: BookingPageSectionProps) {
  const {
    bookingPage,
    bookingSlug,
    setBookingSlug,
    bookingDescription,
    setBookingDescription,
    customPageTitle,
    setCustomPageTitle,
    customIntro,
    setCustomIntro,
    requirePhone,
    setRequirePhone,
    requireEmail,
    setRequireEmail,
    requireFieldsError,
    setRequireFieldsError,
    bookingSaveStatus,
    bookingError,
    setBookingError,
    copied,
    customIntroRef,
    bookingDescRef,
    handleBookingSave,
    handleBookingToggle,
    handleCopyLink,
    scheduleBookingSave,
  } = settings;

  return (
    <section>
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-heading text-base font-semibold text-[#1A1A1A]">Booking page</h2>
        {bookingPage && (
          <span className={`text-xs font-medium transition-colors ${
            bookingSaveStatus === 'saving' ? 'text-[#8A8680]' :
            bookingSaveStatus === 'saved'  ? 'text-emerald-600' : 'invisible'
          }`}>
            {bookingSaveStatus === 'saving' ? 'Saving…' : 'Saved'}
          </span>
        )}
      </div>
      <p className="text-sm text-[#8A8680] mb-4">
        Clients book directly at your unique link. You control when it goes live.
      </p>

      <SectionCard>
        <div className="p-6 space-y-5">

          {/* Live/Offline badge + toggle */}
          {bookingPage && (
            <div className="flex items-start gap-3 justify-between py-1">
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${bookingPage.is_active ? 'bg-emerald-500' : 'bg-[#E5E2DB]'}`} />
                  <span className="text-sm font-medium text-[#1A1A1A]">
                    {bookingPage.is_active ? 'Live' : 'Offline'}
                  </span>
                </div>
                {bookingUrl && (
                  <p className="text-xs text-[#8A8680] font-mono truncate">{bookingUrl}</p>
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0 mt-0.5">
                {bookingPage.is_active && bookingUrl && (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleCopyLink()}
                      className="text-xs text-[#8A8680] hover:text-[#1A1A1A] transition-colors"
                    >
                      {copied ? 'Copied!' : 'Copy link'}
                    </button>
                    <a
                      href={bookingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-[#8A8680] hover:text-[#1A1A1A] transition-colors"
                    >
                      Open ↗
                    </a>
                  </>
                )}
                <Toggle
                  checked={bookingPage.is_active}
                  onChange={(v) => void handleBookingToggle(v)}
                  label={bookingPage.is_active ? 'Take booking page offline' : 'Go live'}
                />
              </div>
            </div>
          )}

          {/* ---- CREATE FLOW: no booking page yet ---- */}
          {!bookingPage && (
            <form onSubmit={(e) => void handleBookingSave(e)} noValidate className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="booking-slug" className="text-sm font-medium text-[#1A1A1A]">
                  Choose your booking URL
                </Label>
                <div className="flex items-center rounded-lg border border-[#E5E2DB] overflow-hidden focus-within:border-[#1B4332] transition-colors">
                  <span className="px-3 text-sm text-[#8A8680] bg-[#F5F3EF] border-r border-[#E5E2DB] h-10 flex items-center shrink-0">
                    /book/
                  </span>
                  <input
                    id="booking-slug"
                    type="text"
                    value={bookingSlug}
                    onChange={(e) => { setBookingSlug(e.target.value); if (bookingError) setBookingError(''); }}
                    placeholder="your-business-name"
                    maxLength={50}
                    disabled={bookingSaveStatus === 'saving'}
                    className="flex-1 h-10 px-3 text-sm text-[#1A1A1A] outline-none bg-white placeholder:text-[#8A8680] disabled:opacity-50"
                  />
                </div>
                <p className="text-xs text-[#8A8680]">Lowercase letters, digits, and hyphens only. 3–50 characters. This cannot be changed later.</p>
              </div>

              {bookingError && (
                <div role="alert" className="rounded-lg bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700">
                  {bookingError}
                </div>
              )}

              <Button
                type="submit"
                disabled={bookingSaveStatus === 'saving'}
                className="bg-[#1B4332] hover:bg-[#16392A] text-white text-sm font-medium px-5 py-2.5 h-auto"
              >
                {bookingSaveStatus === 'saving' ? 'Creating…' : 'Create booking page'}
              </Button>
            </form>
          )}

          {/* ---- EDIT FLOW: booking page exists — auto-saved on every change ---- */}
          {bookingPage && (
            <div className="space-y-4">

              {/* Read-only URL display */}
              <div className="space-y-1.5">
                <Label htmlFor="booking-slug" className="text-sm font-medium text-[#1A1A1A]">
                  Booking page URL
                </Label>
                <div className="flex items-center rounded-lg border border-[#E5E2DB]/50 bg-[#F5F3EF] overflow-hidden">
                  <span className="px-3 text-sm text-[#8A8680] bg-[#F5F3EF] border-r border-[#E5E2DB] h-10 flex items-center shrink-0">
                    /book/
                  </span>
                  <input
                    id="booking-slug"
                    type="text"
                    value={bookingSlug}
                    readOnly
                    disabled
                    className="flex-1 h-10 px-3 text-sm text-[#1A1A1A] outline-none bg-transparent disabled:opacity-60 disabled:cursor-default"
                  />
                </div>
                <p className="text-xs text-[#8A8680]">Your booking URL is permanent and cannot be changed.</p>
              </div>

              {/* Headline + Description with live preview */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

                {/* Left: form fields */}
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="booking-page-title" className="text-sm font-medium text-[#1A1A1A]">
                      Headline
                    </Label>
                    <Input
                      id="booking-page-title"
                      type="text"
                      value={customPageTitle}
                      onChange={(e) => { setCustomPageTitle(e.target.value); scheduleBookingSave(); }}
                      placeholder="e.g. Book your appointment at Elena's Studio"
                      maxLength={100}
                      className="border-[#E5E2DB] focus-visible:border-[#1B4332] focus-visible:ring-0 text-[#1A1A1A] placeholder:text-[#8A8680]"
                    />
                    <p className="text-xs text-[#8A8680]">The first thing clients see. Leave blank to use your business name.</p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="booking-custom-intro" className="text-sm font-medium text-[#1A1A1A]">
                      Description
                    </Label>
                    <textarea
                      id="booking-custom-intro"
                      ref={customIntroRef}
                      value={customIntro}
                      onChange={(e) => { setCustomIntro(e.target.value); scheduleBookingSave(); }}
                      onInput={(e: React.FormEvent<HTMLTextAreaElement>) => {
                        const el = e.currentTarget;
                        el.style.height = 'auto';
                        el.style.height = `${el.scrollHeight}px`;
                      }}
                      placeholder="e.g. We offer haircuts, coloring and more. Book your slot online in seconds."
                      maxLength={800}
                      rows={3}
                      className="w-full rounded-lg border border-[#E5E2DB] px-3 py-2.5 text-sm text-[#1A1A1A] placeholder:text-[#8A8680] outline-none focus:border-[#1B4332] disabled:opacity-50 resize-none overflow-hidden transition-colors"
                    />
                    <p className="text-xs text-[#8A8680]">A short description shown below the headline. Leave blank to skip.</p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="booking-description" className="text-sm font-medium text-[#1A1A1A]">
                      Link preview description (optional)
                    </Label>
                    <textarea
                      id="booking-description"
                      ref={bookingDescRef}
                      value={bookingDescription}
                      onChange={(e) => { setBookingDescription(e.target.value); scheduleBookingSave(); }}
                      onInput={(e: React.FormEvent<HTMLTextAreaElement>) => {
                        const el = e.currentTarget;
                        el.style.height = 'auto';
                        el.style.height = `${el.scrollHeight}px`;
                      }}
                      placeholder="e.g. Book your appointment online. We confirm within 24 hours."
                      maxLength={500}
                      rows={2}
                      className="w-full rounded-lg border border-[#E5E2DB] px-3 py-2.5 text-sm text-[#1A1A1A] placeholder:text-[#8A8680] outline-none focus:border-[#1B4332] disabled:opacity-50 resize-none overflow-hidden transition-colors"
                    />
                    <p className="text-xs text-[#8A8680]">Shown when you share your booking link on WhatsApp, Instagram or other apps.</p>
                  </div>
                </div>

                {/* Right: live preview — matches the real public booking page hero */}
                <div className="space-y-2">
                  <p className="text-xs font-medium text-[#8A8680] uppercase tracking-widest">Preview</p>
                  <div
                    className="rounded-2xl px-6 py-8 flex flex-col justify-start min-h-[180px] space-y-2"
                    style={{ background: 'linear-gradient(180deg, #1B4332 0%, #122B20 100%)' }}
                  >
                    <h3 className="font-heading text-2xl font-bold text-white leading-snug">
                      {customPageTitle.trim() || (
                        <span className="text-white/30 italic">Your headline</span>
                      )}
                    </h3>
                    {customIntro.trim() ? (
                      <p className="font-body text-sm text-white/60 leading-relaxed">{customIntro.trim()}</p>
                    ) : (
                      <p className="font-body text-sm text-white/20 italic">Description will appear here</p>
                    )}
                  </div>
                </div>

              </div>

              {/* Required client information */}
              <div className="space-y-3">
                <div className="pt-4 border-t border-[#E5E2DB]/30">
                  <h2 className="font-heading text-base font-semibold text-[#1A1A1A]">Required client information</h2>
                  <p className="text-xs text-[#8A8680] mt-0.5">Turn off fields you do not need. At least one must be required.</p>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-[#1A1A1A]">Require phone number</p>
                    <p className="text-xs text-[#8A8680] mt-0.5">Used for client contact.</p>
                  </div>
                  <Toggle
                    checked={requirePhone}
                    onChange={(v) => { setRequirePhone(v); setRequireFieldsError(''); scheduleBookingSave(); }}
                    label="Require phone number"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-[#1A1A1A]">Require email address</p>
                    <p className="text-xs text-[#8A8680] mt-0.5">Needed for email reminders.</p>
                  </div>
                  <Toggle
                    checked={requireEmail}
                    onChange={(v) => { setRequireEmail(v); setRequireFieldsError(''); scheduleBookingSave(); }}
                    label="Require email address"
                  />
                </div>
                {requireFieldsError && (
                  <p className="text-xs text-red-600">{requireFieldsError}</p>
                )}
              </div>

              {bookingError && (
                <div role="alert" className="rounded-lg bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700">
                  {bookingError}
                </div>
              )}
            </div>
          )}

        </div>
      </SectionCard>
    </section>
  );
}
