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

/** An appointment to put in an iCalendar file. */
type CalendarEvent = {
  /** Appointment id; makes the event's UID, so importing it twice updates one event. */
  uid: string;
  /** Name of the salon (shown in the event title). */
  salonName: string;
  /** Service name; empty for "Appointment". */
  service: string;
  /** Appointment start instant. */
  start: Date;
  /** Appointment length in minutes. */
  durationMinutes: number;
  /** When the file is created (DTSTAMP). */
  stamp: Date;
};

/** Formats an instant as an iCalendar UTC date-time, e.g. "20260415T073000Z". */
function icsDateTime(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

/**
 * Escapes a TEXT value (RFC 5545 §3.3.11): backslashes, semicolons, commas
 * and line breaks.
 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Folds a content line so no line is longer than 75 octets (RFC 5545 §3.1).
 * Continuation lines start with a space; characters are never split.
 */
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const lines: string[] = [];
  let current = '';
  let octets = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    // A continuation line's leading space counts towards its 75 octets.
    const limit = lines.length === 0 ? 75 : 74;
    if (octets + size > limit) {
      lines.push(current);
      current = char;
      octets = size;
    } else {
      current += char;
      octets += size;
    }
  }
  lines.push(current);
  return lines.join('\r\n ');
}

/**
 * Builds an iCalendar (.ics) file string for the booked appointment
 * (RFC 5545: UID and DTSTAMP, escaped text, folded lines, CRLF line ends).
 *
 * @param event - The appointment, its salon and service, and the creation time.
 * @returns     iCalendar text content.
 */
export function buildICS({ uid, salonName, service, start, durationMinutes, stamp }: CalendarEvent): string {
  const end = new Date(start.getTime() + durationMinutes * 60_000);

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Noshowly//Booking//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}@noshowly`,
    `DTSTAMP:${icsDateTime(stamp)}`,
    `DTSTART:${icsDateTime(start)}`,
    `DTEND:${icsDateTime(end)}`,
    `SUMMARY:${escapeText(`${service || 'Appointment'} at ${salonName}`)}`,
    `DESCRIPTION:${escapeText(`Your appointment at ${salonName}.`)}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].map(foldLine).join('\r\n') + '\r\n';
}
