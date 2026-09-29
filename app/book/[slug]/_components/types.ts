/**
 * app/book/[slug]/_components/types.ts
 *
 * Types shared by the public booking flow: BookingFlow and the steps,
 * sidebar and hooks in this folder.
 */

import type { PublicService } from '@/types';

/** A step of the booking flow, in the order they come. */
export type Step = 'staff' | 'service' | 'datetime' | 'details' | 'success';

/** Details returned by the booking API once the appointment exists. */
export type ConfirmedBooking = {
  appointmentId: string;
  /** Staff member the appointment was booked with (assigned by the server for "any"). */
  barberName: string | null;
  durationMinutes: number;
};

/**
 * What the visitor has chosen so far, as the booking summaries show it: the
 * desktop sidebar, the details step's summary card and the success screen.
 */
export type BookingSummary = {
  /** The chosen service; null before choosing and for salons without services. */
  selectedService: PublicService | null;
  /** Duration of the chosen service in minutes, e.g. "45" or "30–45"; null when not defined. */
  selectedServiceDuration: string | null;
  /** Price of the chosen service, e.g. "€25.00" or "€20.00–€25.00"; null when not set. */
  selectedServicePrice: string | null;
  /** Who the appointment is with, e.g. "with Elena" or "Any available staff". */
  staffLabel: string | null;
  /** Chosen date, 'YYYY-MM-DD' in the salon timezone. */
  selectedDate: string | null;
  /** Chosen start time, 'HH:MM' in the salon timezone. */
  selectedTime: string | null;
};
