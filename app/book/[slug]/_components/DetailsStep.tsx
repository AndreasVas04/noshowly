/**
 * app/book/[slug]/_components/DetailsStep.tsx
 *
 * Details step of the public booking page:
 *  - a summary card of the booking: service with duration and price, staff,
 *    date and time, the salon-timezone note and the business name;
 *  - the client details form: full name, phone and email (required or
 *    optional per the booking page settings) and notes, plus a honeypot
 *    field (hp_field) that people never see and keyboard navigation skips;
 *  - validation and booking errors, "Book appointment" and Back.
 *
 * The field values, validation and the booking request are in
 * useBookingForm(), so the values survive going back to change the time.
 */

'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MAX_PHONE_INPUT_LENGTH } from '@/lib/contact';
import { formatDateLong, formatTime12h } from './format';
import type { BookingSummary } from './types';
import type { BookingForm } from './useBookingForm';

type DetailsStepProps = {
  /** What the visitor has chosen, for the summary card. */
  summary: BookingSummary;
  /** Says which timezone the times are in. */
  timeZoneNote: string;
  /** Name shown to visitors: the custom title, or the salon name. */
  businessName: string;
  /** Whether clients must supply a phone number. Controlled by booking page settings. */
  requirePhone: boolean;
  /** Whether clients must supply an email address. Controlled by booking page settings. */
  requireEmail: boolean;
  /** Field values and setters, messages and the submit handler. */
  form: BookingForm;
  /** Goes back to the date and time step. */
  onBack: () => void;
};

/**
 * Shows the booking summary and the client details form.
 *
 * @param props - The summary, the booking page settings, the form state and the Back callback.
 */
export default function DetailsStep({
  summary,
  timeZoneNote,
  businessName,
  requirePhone,
  requireEmail,
  form,
  onBack,
}: DetailsStepProps) {
  const {
    selectedService,
    selectedServiceDuration,
    selectedServicePrice,
    staffLabel,
    selectedDate,
    selectedTime,
  } = summary;
  const {
    clientName,   setClientName,
    clientPhone,  setClientPhone,
    clientEmail,  setClientEmail,
    clientNotes,  setClientNotes,
    honeypot,     setHoneypot,
    detailsError, setDetailsError,
    submitError,  setSubmitError,
    submitting,
    handleSubmit,
  } = form;

  return (
    <div className="space-y-4">
      {/* Booking summary card */}
      <div className="bg-white rounded-2xl border border-[#E5E2DB] border-l-[3px] border-l-[#1B4332] p-5 shadow-sm">
        <p className="font-body text-[10px] font-semibold text-[#8A8680] uppercase tracking-widest mb-3">
          Your booking
        </p>
        <div className="space-y-1.5">
          {selectedService && (
            <div className="flex items-start justify-between gap-3">
              <p className="font-body text-sm font-semibold text-[#1A1A1A]">
                {selectedService.name}
                {selectedServiceDuration && (
                  <span className="text-[#8A8680] font-normal"> &middot; {selectedServiceDuration} min</span>
                )}
              </p>
              {selectedServicePrice && (
                <span className="font-body text-sm font-semibold text-[#1B4332] shrink-0">
                  {selectedServicePrice}
                </span>
              )}
            </div>
          )}
          {staffLabel && (
            <p className="font-body text-sm text-[#8A8680]">{staffLabel}</p>
          )}
          {selectedDate && selectedTime && (
            <p className="font-body text-sm text-[#1A1A1A] font-medium">
              {formatDateLong(selectedDate)} at {formatTime12h(selectedTime)}
            </p>
          )}
          <p className="font-body text-xs text-[#8A8680]">{timeZoneNote}</p>
          <p className="font-body text-xs text-[#8A8680]">{businessName}</p>
        </div>
      </div>

      {/* Details form */}
      <form
        onSubmit={(e) => void handleSubmit(e)}
        noValidate
        className="relative bg-white rounded-2xl border border-[#E5E2DB] p-6 space-y-5 shadow-sm"
      >
        <div>
          <h2 className="font-heading text-2xl font-bold text-[#1A1A1A]">Your details</h2>
          <p className="font-body text-sm text-[#8A8680] mt-1">We&apos;ll use this to confirm your booking</p>
        </div>
        <hr className="border-[#E5E2DB]" />

        {/* Full name */}
        <div className="space-y-1.5">
          <Label htmlFor="client-name" className="font-body text-sm font-medium text-[#1A1A1A]">
            Full name <span className="text-red-500">*</span>
          </Label>
          <Input
            id="client-name"
            type="text"
            value={clientName}
            onChange={(e) => { setClientName(e.target.value); setDetailsError(''); }}
            placeholder="Jane Smith"
            maxLength={100}
            required
            autoComplete="name"
            className="font-body border-[#E5E2DB] focus-visible:border-[#1B4332] focus-visible:ring-0 text-[#1A1A1A] placeholder:text-[#8A8680]"
          />
        </div>

        {/* Phone */}
        <div className="space-y-1.5">
          <Label htmlFor="client-phone" className="font-body text-sm font-medium text-[#1A1A1A]">
            Phone number{' '}
            {requirePhone
              ? <span className="text-red-500">*</span>
              : <span className="font-body text-[#8A8680] font-normal">(optional)</span>}
          </Label>
          <Input
            id="client-phone"
            type="tel"
            value={clientPhone}
            onChange={(e) => { setClientPhone(e.target.value); setDetailsError(''); }}
            placeholder="+357 99 123 456"
            maxLength={MAX_PHONE_INPUT_LENGTH}
            autoComplete="tel"
            className="font-body border-[#E5E2DB] focus-visible:border-[#1B4332] focus-visible:ring-0 text-[#1A1A1A] placeholder:text-[#8A8680]"
          />
          <p className="font-body text-xs text-[#8A8680]">
            Include your country code (e.g. +1, +357).
          </p>
        </div>

        {/* Email */}
        <div className="space-y-1.5">
          <Label htmlFor="client-email" className="font-body text-sm font-medium text-[#1A1A1A]">
            Email{' '}
            {requireEmail
              ? <span className="text-red-500">*</span>
              : <span className="font-body text-[#8A8680] font-normal">(optional)</span>}
          </Label>
          <Input
            id="client-email"
            type="email"
            value={clientEmail}
            onChange={(e) => { setClientEmail(e.target.value); setDetailsError(''); }}
            placeholder="jane@example.com"
            maxLength={254}
            autoComplete="email"
            className="font-body border-[#E5E2DB] focus-visible:border-[#1B4332] focus-visible:ring-0 text-[#1A1A1A] placeholder:text-[#8A8680]"
          />
          {requireEmail && (
            <p className="font-body text-xs text-[#8A8680]">Required for email reminders.</p>
          )}
        </div>

        {/* Notes */}
        <div className="space-y-1.5">
          <Label htmlFor="client-notes" className="font-body text-sm font-medium text-[#1A1A1A]">
            Notes <span className="font-body text-[#8A8680] font-normal">(optional)</span>
          </Label>
          <textarea
            id="client-notes"
            value={clientNotes}
            onChange={(e) => setClientNotes(e.target.value)}
            placeholder="Any special requests or information..."
            rows={2}
            maxLength={500}
            className="font-body w-full rounded-lg border border-[#E5E2DB] px-3 py-2.5 text-sm text-[#1A1A1A] placeholder:text-[#8A8680] outline-none focus:border-[#1B4332] resize-none transition-colors"
          />
        </div>

        {/* Honeypot — invisible to people and skipped by keyboard navigation. */}
        <div
          aria-hidden="true"
          className="absolute left-[-10000px] top-auto w-px h-px overflow-hidden"
        >
          <label htmlFor="hp_field">Leave this field empty</label>
          <input
            id="hp_field"
            name="hp_field"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
          />
        </div>

        {detailsError && (
          <div role="alert" className="rounded-lg bg-red-50 border border-red-100 px-4 py-3 font-body text-sm text-red-700">
            {detailsError}
          </div>
        )}

        {submitError && (
          <div role="alert" className="rounded-lg bg-red-50 border border-red-100 px-4 py-3 font-body text-sm text-red-700">
            {submitError}
          </div>
        )}

        <div className="space-y-3 pt-2">
          <Button
            type="submit"
            disabled={submitting}
            className="w-full h-12 bg-[#1B4332] hover:bg-[#16392A] text-white font-body text-sm font-semibold rounded-xl"
          >
            {submitting ? 'Booking...' : 'Book appointment'}
          </Button>
          <div className="text-center">
            <button
              type="button"
              onClick={() => { setSubmitError(''); onBack(); }}
              className="font-body text-sm text-[#8A8680] hover:text-[#1B4332] transition-colors"
            >
              &#8592; Back
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
