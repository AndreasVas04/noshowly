/**
 * app/book/[slug]/_components/SuccessScreen.tsx
 *
 * Last step of the public booking page, once the appointment exists: an
 * animated checkmark, "You're booked!", a summary of the appointment with
 * the salon-timezone note, an "Add to calendar (.ics)" download and the
 * booking reference.
 */

'use client';

import { resolveZonedTime } from '@/lib/time';
import { buildICS, formatDateLong, formatTime12h } from './format';
import type { BookingSummary, ConfirmedBooking } from './types';

function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

type SuccessScreenProps = {
  /** What was booked, for the summary. */
  summary: BookingSummary;
  /** Says which timezone the times are in. */
  timeZoneNote: string;
  /** Name shown to visitors: the custom title, or the salon name. */
  businessName: string;
  /** Salon name, for the calendar event. */
  salonName: string;
  /** Salon timezone (IANA), to turn the date and time into an instant. */
  timeZone: string;
  /** Details returned by the booking API. */
  confirmed: ConfirmedBooking | null;
};

/**
 * Confirms the booking and offers the .ics download.
 *
 * @param props - The summary, the salon's names and timezone, and the confirmed booking.
 */
export default function SuccessScreen({
  summary,
  timeZoneNote,
  businessName,
  salonName,
  timeZone,
  confirmed,
}: SuccessScreenProps) {
  const { selectedService, selectedServicePrice, staffLabel, selectedDate, selectedTime } = summary;

  // -------------------------------------------------------------------------
  // .ics download
  // -------------------------------------------------------------------------

  function handleDownloadICS(): void {
    if (!selectedDate || !selectedTime || !confirmed) return;
    const start = resolveZonedTime(selectedDate, selectedTime, timeZone);
    if (!start.ok) return;
    const service = selectedService?.name ?? 'Appointment';
    const ics = buildICS({
      uid:             confirmed.appointmentId,
      salonName,
      service,
      start:           start.date,
      durationMinutes: confirmed.durationMinutes,
      stamp:           new Date(),
    });
    downloadFile(ics, 'appointment.ics', 'text/calendar');
  }

  return (
    <div className="bg-white rounded-2xl border border-[#E5E2DB] p-8 text-center space-y-6">
      {/* Animated checkmark */}
      <div className="w-20 h-20 rounded-full bg-[#E8F2EC] flex items-center justify-center mx-auto">
        <svg
          viewBox="0 0 48 48"
          fill="none"
          stroke="#1B4332"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-10 h-10"
        >
          {/* The indentation inside this template literal is part of the rendered CSS text. */}
          <style>{`
                    @keyframes noshowly-check {
                      from { stroke-dashoffset: 60; opacity: 0; }
                      to   { stroke-dashoffset: 0;  opacity: 1; }
                    }
                  `}</style>
          <polyline
            points="10 25 20 35 38 14"
            style={{
              strokeDasharray: 60,
              strokeDashoffset: 0,
              animation: 'noshowly-check 0.5s ease-out forwards',
            }}
          />
        </svg>
      </div>

      <div>
        <h2 className="font-heading text-3xl font-bold text-[#1A1A1A]">
          {"You're booked!"}
        </h2>
        <p className="font-body text-sm text-[#6F6B65] mt-2">
          {businessName} will be in touch if anything changes.
        </p>
      </div>

      {/* Booking summary */}
      <div className="bg-[#F0F7F4] rounded-xl p-5 text-left space-y-2">
        {selectedService && (
          <div className="flex items-center justify-between">
            <p className="font-body text-sm font-semibold text-[#1A1A1A]">{selectedService.name}</p>
            {selectedServicePrice && (
              <p className="font-body text-sm text-[#1A1A1A]">
                {selectedServicePrice}
              </p>
            )}
          </div>
        )}
        {staffLabel && (
          <p className="font-body text-sm text-[#6F6B65]">{staffLabel}</p>
        )}
        {selectedDate && selectedTime && (
          <p className="font-body text-sm font-medium text-[#1A1A1A]">
            {formatDateLong(selectedDate)} at {formatTime12h(selectedTime)}
          </p>
        )}
        <p className="font-body text-xs text-[#6F6B65]">{timeZoneNote}</p>
        <p className="font-body text-sm text-[#6F6B65]">{businessName}</p>
      </div>

      <p className="font-body text-xs text-[#6F6B65]">
        {"You'll receive a reminder before your appointment."}
      </p>

      {selectedDate && selectedTime && (
        <button
          type="button"
          onClick={handleDownloadICS}
          className="font-body inline-flex items-center gap-2 text-sm font-medium text-[#1B4332] border border-[#E5E2DB] hover:border-[#1B4332]/40 hover:bg-[#E8F2EC]/40 px-5 py-2.5 rounded-lg transition-colors"
        >
          Add to calendar (.ics)
        </button>
      )}

      {confirmed && (
        <p className="font-body text-xs text-[#6F6B65]">
          Ref: {confirmed.appointmentId.slice(0, 8).toUpperCase()}
        </p>
      )}
    </div>
  );
}
