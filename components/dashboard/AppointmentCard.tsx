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
 * Cancelled appointments are rendered with reduced opacity and a strikethrough
 * on the client name so they fade into the background without disappearing.
 *
 * The card is interactive — clicking it opens the edit modal in the parent.
 * The onClick prop is wired up by DayView when it renders the card list.
 *
 * This is a Client Component so it can accept the onClick function prop from
 * the parent DayView (Client Components cannot pass functions to Server Components).
 */

'use client';

import Badge from '@/components/ui/Badge';
import type { AppointmentWithDetails } from '@/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Formats an ISO datetime string as a 24-hour clock time string.
 * e.g. "2026-04-01T09:30:00Z" → "09:30"
 *
 * @param isoString - ISO 8601 datetime string stored in the database (UTC).
 * @returns Formatted time string like "09:30" or "14:00".
 */
function formatTime(isoString: string): string {
  const date = new Date(isoString);
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Props accepted by AppointmentCard. */
interface AppointmentCardProps {
  /** The appointment to render, with client and staff names pre-joined. */
  appointment: AppointmentWithDetails;
  /**
   * Called when the user clicks the card.
   * The parent (DayView) uses this to open the edit modal for this appointment.
   */
  onClick: () => void;
}

/**
 * AppointmentCard renders a single appointment row in the day view.
 * Clicking the card fires the onClick callback so the parent can open
 * the edit modal.
 *
 * Cancelled appointments render at reduced opacity with a strikethrough on the
 * client name — they stay visible but de-emphasised so the owner focuses on
 * active appointments.
 *
 * @param props.appointment - The appointment data including display names.
 * @param props.onClick     - Callback to open the edit modal for this appointment.
 * @returns A styled, clickable card with time, client details, and status badge.
 */
export default function AppointmentCard({ appointment, onClick }: AppointmentCardProps) {
  const time = formatTime(appointment.datetime);
  const isCancelled = appointment.status === 'cancelled';

  // Build the secondary info line: "Haircut · Maria" or just "Haircut" or "Maria".
  // If service_type is null/empty, show nothing — no "Appointment" fallback.
  const parts: string[] = [];
  if (appointment.service_type) parts.push(appointment.service_type);
  if (appointment.barber_name) parts.push(appointment.barber_name);
  const detailLine = parts.join(' · ');

  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        w-full text-left
        bg-white rounded-xl border border-gray-200
        px-4 py-3
        flex items-center justify-between gap-4
        hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400
        cursor-pointer
        ${isCancelled ? 'opacity-40' : ''}
      `}
    >

      {/* Left: time column — fixed width so all times vertically align */}
      <div className="w-12 shrink-0 text-sm font-bold text-gray-700 tabular-nums">
        {time}
      </div>

      {/* Centre: client name + service/staff detail + notes */}
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold text-gray-900 truncate ${isCancelled ? 'line-through' : ''}`}>
          {appointment.client_name ?? 'Unknown client'}
        </p>
        {detailLine && (
          <p className="text-xs text-gray-500 mt-0.5 truncate">
            {detailLine}
          </p>
        )}
        {appointment.notes && (
          <p className="text-xs text-gray-400 italic mt-0.5 truncate">
            {appointment.notes}
          </p>
        )}
      </div>

      {/* Right: status badge */}
      <div className="shrink-0">
        <Badge status={appointment.status} />
      </div>

    </button>
  );
}
