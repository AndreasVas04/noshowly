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
 * Cancelled appointments render with reduced opacity and strikethrough on
 * the client name. Clicking opens the edit modal in the parent.
 *
 * Premium design: white card, subtle border, brand-dark hover state.
 */

'use client';

import Badge from '@/components/ui/Badge';
import type { AppointmentWithDetails } from '@/types';

/**
 * Returns the hex color for a given appointment status.
 * Used to render the colored status dot beside each appointment.
 *
 * @param status - The appointment status string.
 * @returns A hex color string.
 */
function statusColor(status: string): string {
  if (status === 'confirmed') return '#10B981';
  if (status === 'cancelled') return '#EF4444';
  return '#F59E0B'; // scheduled / pending
}

/**
 * Formats an ISO datetime string as a 24-hour clock time string.
 *
 * @param isoString - ISO 8601 datetime string (UTC).
 * @returns Formatted time string like "09:30".
 */
function formatTime(isoString: string): string {
  const date = new Date(isoString);
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

/** Props accepted by AppointmentCard. */
interface AppointmentCardProps {
  appointment: AppointmentWithDetails;
  onClick: () => void;
}

/**
 * Renders a single appointment row. Clicking opens the edit modal.
 *
 * @param props.appointment - Appointment data with joined display names.
 * @param props.onClick     - Opens the edit modal.
 */
/** Returns up to 2 initials from a client's display name. */
function clientInitials(name: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(' ');
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function AppointmentCard({ appointment, onClick }: AppointmentCardProps) {
  const time = formatTime(appointment.datetime);
  const isCancelled = appointment.status === 'cancelled';

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
        'bg-white rounded-xl border border-[#E5E2DB] border-l-[3px] border-l-[#1B4332]',
        'px-4 py-3.5',
        'flex items-center gap-3',
        'hover:border-[#1B4332]/30 hover:shadow-sm hover:bg-[#F5FAF7] transition-all duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B4332]/20',
        'cursor-pointer',
        isCancelled ? 'opacity-40' : '',
      ].join(' ')}
    >
      {/* Status dot */}
      <div
        className="w-2 h-2 rounded-full shrink-0 ml-0.5"
        style={{ background: statusColor(appointment.status) }}
      />

      {/* Left: time — Playfair Display, fixed width so all times align */}
      <div className="w-12 shrink-0 text-right">
        <span className="font-heading text-sm font-semibold text-[#1A1A1A] tabular-nums">{time}</span>
      </div>

      {/* Divider */}
      <div className="w-px h-8 bg-[#E5E2DB] shrink-0" />

      {/* Client initial avatar — forest green circle */}
      <div className="w-8 h-8 rounded-full bg-[#E8F2EC] flex items-center justify-center shrink-0">
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

      {/* Right: status badge */}
      <div className="shrink-0">
        <Badge status={appointment.status} />
      </div>
    </button>
  );
}
