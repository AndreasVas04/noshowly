/**
 * components/dashboard/AppointmentCard.tsx
 *
 * Renders a single appointment as a horizontal card in the day view list.
 *
 * Displays:
 *  - Appointment time (left column, fixed width so all times align)
 *  - Client name + service type and staff name (centre)
 *  - Status badge (right, colour-coded)
 *
 * Visual states:
 *  - Upcoming scheduled (status='scheduled', datetime >= now): amber dot, no badge
 *  - Confirmed (status='confirmed'): green dot, "Confirmed" badge
 *  - Past unanswered (status='scheduled', datetime < now): grey dot, grey left border,
 *    reduced opacity, "Past" label — the time passed without a YES/NO reply
 *  - Cancelled: amber dot + full row opacity-40 + strikethrough on client name
 *
 * Clicking opens the edit modal in the parent.
 *
 * Premium design: white card, subtle border, brand-dark hover state.
 */

'use client';

import Badge from '@/components/ui/Badge';
import type { AppointmentWithDetails } from '@/types';

/**
 * Returns the hex color for the status dot beside each appointment.
 * Past unanswered (scheduled + past time) uses grey to avoid looking "active".
 *
 * @param status        - The appointment status string.
 * @param isPastScheduled - True when status is 'scheduled' and datetime has passed.
 * @returns A hex color string.
 */
function statusColor(status: string, isPastScheduled: boolean): string {
  if (isPastScheduled) return '#C8C8C8';    // grey — past, unanswered
  if (status === 'confirmed') return '#10B981';
  if (status === 'cancelled') return '#EF4444';
  return '#F59E0B'; // upcoming scheduled / pending
}

/**
 * Formats an ISO datetime string as a 24-hour clock time string.
 * Uses the salon's IANA timezone when provided so appointments display correctly
 * regardless of the browser's local timezone. Falls back to browser timezone
 * when no timezone is specified (backwards compatible).
 *
 * @param isoString - ISO 8601 datetime string (UTC).
 * @param timezone  - Optional IANA timezone, e.g. "Europe/Nicosia".
 * @returns Formatted time string like "09:30".
 */
function formatTime(isoString: string, timezone?: string): string {
  if (timezone) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour:   '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(isoString));
    const h = parts.find((p) => p.type === 'hour')?.value   ?? '00';
    const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
    return `${h === '24' ? '00' : h}:${m}`;
  }
  const date = new Date(isoString);
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

/** Returns up to 2 initials from a client's display name. */
function clientInitials(name: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(' ');
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Props accepted by AppointmentCard. */
interface AppointmentCardProps {
  appointment: AppointmentWithDetails;
  onClick: () => void;
  /** IANA timezone for displaying appointment times, e.g. "Europe/Nicosia". */
  timezone?: string;
}

/**
 * Renders a single appointment row. Clicking opens the edit modal.
 * Past unanswered appointments receive grey/muted styling.
 *
 * @param props.appointment - Appointment data with joined display names.
 * @param props.onClick     - Opens the edit modal.
 */
export default function AppointmentCard({ appointment, onClick, timezone }: AppointmentCardProps) {
  const time         = formatTime(appointment.datetime, timezone);
  const isCancelled  = appointment.status === 'cancelled';

  // Past: any non-cancelled appointment whose datetime has already elapsed.
  // Covers both 'scheduled' (unanswered) and 'confirmed' (already happened).
  const isPastScheduled =
    appointment.status !== 'cancelled' && new Date(appointment.datetime) < new Date();

  const parts: string[] = [];
  if (appointment.service_type) parts.push(appointment.service_type);
  if (appointment.barber_name) parts.push(appointment.barber_name);
  const detailLine = parts.join(' · ');

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'w-full text-left',
        'bg-white rounded-xl border border-[#E5E2DB]',
        // Left border: grey for past unanswered, green for all others
        isPastScheduled ? 'border-l-[3px] border-l-[#C8C8C8]' : 'border-l-[3px] border-l-[#1B4332]',
        'px-4 py-3.5',
        'flex items-center gap-3',
        'hover:border-[#1B4332]/30 hover:shadow-sm hover:bg-[#F5FAF7] transition-all duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B4332]/20',
        'cursor-pointer',
        isCancelled    ? 'opacity-40' : '',
        isPastScheduled ? 'opacity-60' : '',
      ].join(' ')}
    >
      {/* Status dot */}
      <div
        className="w-2 h-2 rounded-full shrink-0 ml-0.5"
        style={{ background: statusColor(appointment.status, isPastScheduled) }}
      />

      {/* Left: time — Playfair Display, fixed width so all times align */}
      <div className="w-12 shrink-0 text-right">
        <span className="font-heading text-sm font-semibold text-[#1A1A1A] tabular-nums">{time}</span>
      </div>

      {/* Divider — hidden on very small screens to give badge room */}
      <div className="hidden sm:block w-px h-8 bg-[#E5E2DB] shrink-0" />

      {/* Client initial avatar — hidden on very small screens to give badge room */}
      <div className="hidden sm:flex w-8 h-8 rounded-full bg-[#E8F2EC] items-center justify-center shrink-0">
        <span className="text-[10px] font-semibold text-[#1B4332]">
          {clientInitials(appointment.client_name)}
        </span>
      </div>

      {/* Centre: client details */}
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold text-[#1A1A1A] truncate font-body ${isCancelled ? 'line-through' : ''}`}>
          {appointment.client_name ?? 'Unknown client'}
        </p>
        {detailLine && (
          <p className="text-xs text-[#8A8680] mt-0.5 truncate font-body">{detailLine}</p>
        )}
      </div>

      {/* Right: status badge — "Past" label for past unanswered, badge for others */}
      <div className="shrink-0">
        {isPastScheduled ? (
          <span className="text-xs font-medium text-[#8A8680] bg-[#F0EFED] px-2 py-0.5 rounded-full font-body">
            Past
          </span>
        ) : (
          <Badge status={appointment.status} />
        )}
      </div>
    </button>
  );
}
