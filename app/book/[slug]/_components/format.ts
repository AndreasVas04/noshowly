/**
 * app/book/[slug]/_components/format.ts
 *
 * Formatting for the public booking page: start times ("2:30 PM"), dates
 * ("Wednesday, April 15"), durations and prices as a single value or a range,
 * and the iCalendar (.ics) file offered once the appointment is booked.
 *
 * No imports from React or Next.js, so this is safe to use anywhere.
 */

import { formatDateOnly } from '@/lib/time';

/** Formats "14:30" → "2:30 PM". */
export function formatTime12h(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const hour12 = h % 12 || 12;
  return `${hour12}:${m.toString().padStart(2, '0')} ${period}`;
}

/**
 * Formats "2026-04-15" → "Wednesday, April 15".
 * Formats in UTC so the day shown is the date itself, in every browser timezone.
 */
export function formatDateLong(dateStr: string): string {
  return formatDateOnly(dateStr, { weekday: 'long', month: 'long', day: 'numeric' });
}

/**
 * Formats a set of numbers as a single value or a range, e.g. "30" or "30–45".
 *
 * @param values - Numbers to summarise.
 * @param format - Formats one number.
 * @returns      The label, or null when there are no values.
 */
export function formatRange(values: number[], format: (n: number) => string): string | null {
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? format(min) : `${format(min)}–${format(max)}`;
}

/**
 * Builds an iCalendar (.ics) file string for the booked appointment.
 *
 * @param salonName       - Name of the salon (shown in the event title).
 * @param service         - Service name.
 * @param start           - Appointment start instant.
 * @param durationMinutes - Appointment length in minutes.
 * @returns               iCalendar text content.
 */
export function buildICS(
  salonName: string,
  service: string,
  start: Date,
  durationMinutes: number,
): string {
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Booking//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${service || 'Appointment'} at ${salonName}`,
    `DESCRIPTION:Your appointment at ${salonName}.`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}
