/**
 * lib/appointment-status.ts
 *
 * How the dashboard shows an appointment's status (appointments.status):
 *  - 'scheduled' — "Pending": waiting for the client's YES/NO;
 *  - 'confirmed' — "Confirmed";
 *  - 'cancelled' — "Cancelled".
 * A non-cancelled appointment whose start time has passed is shown as past,
 * whatever its status.
 *
 * Used by the day list (AppointmentCard, Badge), the week grid (WeekView),
 * the stat cards and the appointment modal, so a status looks the same
 * everywhere. The client's confirmation page has its own wording
 * (lib/confirm-page.ts).
 *
 * No imports from Next.js or Supabase, so this is safe to use anywhere.
 */

import type { AppointmentStatus } from '@/types';

/** Label of each status. */
export const STATUS_LABELS: Readonly<Record<AppointmentStatus, string>> = {
  scheduled: 'Pending',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
};

/** Colours of the status badge. Pending appointments get no badge. */
export const STATUS_BADGE_CLASSES: Readonly<Partial<Record<AppointmentStatus, string>>> = {
  confirmed: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  cancelled: 'bg-red-50 text-red-600 border border-red-100',
};

/**
 * Returns true for a non-cancelled appointment whose start time has passed.
 *
 * @param appointment - Status and start (UTC ISO timestamp).
 * @param now         - Current instant.
 */
export function isPastAppointment(
  appointment: { status: AppointmentStatus; datetime: string },
  now: Date = new Date(),
): boolean {
  return appointment.status !== 'cancelled' && new Date(appointment.datetime) < now;
}

/**
 * Colour of the status dot in the day list.
 *
 * @param status - Appointment status.
 * @param isPast - From isPastAppointment().
 * @returns      Hex colour: grey once past, else green, red or amber (pending).
 */
export function statusDotColor(status: AppointmentStatus, isPast: boolean): string {
  if (isPast) return '#C8C8C8';
  if (status === 'confirmed') return '#10B981';
  if (status === 'cancelled') return '#EF4444';
  return '#F59E0B';
}

/**
 * Border and background classes of a card in the week grid. Cancelled cards
 * also get a dashed border from the card itself.
 *
 * @param status - Appointment status.
 * @param isPast - From isPastAppointment().
 */
export function weekCardClasses(status: AppointmentStatus, isPast: boolean): string {
  if (isPast) return 'border-[#C8C8C8]/60 bg-[#F0EFED] opacity-60';
  if (status === 'confirmed') return 'border-[#1B4332]/30 bg-[#E8F2EC]';
  if (status === 'cancelled') return 'border-red-200/60 bg-red-50/50 opacity-50';
  return 'border-amber-200 bg-amber-50';
}
