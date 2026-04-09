/**
 * components/ui/Badge.tsx
 *
 * Renders a small pill-shaped status badge for an appointment.
 *
 * Each AppointmentStatus value maps to a distinct background/text colour so
 * the salon owner can scan the day at a glance and immediately understand
 * which appointments are confirmed, pending, or cancelled.
 *
 * Usage:
 * ```tsx
 * <Badge status="confirmed" />   // green pill
 * <Badge status="scheduled" />   // yellow pill
 * <Badge status="cancelled" />   // red pill
 * ```
 */

import React from 'react';
import type { AppointmentStatus } from '@/types';

// ---------------------------------------------------------------------------
// Style maps
// ---------------------------------------------------------------------------

/**
 * Tailwind class pairs (background + text) for each appointment status.
 * Colours follow standard semantic conventions: green = good, yellow = pending,
 * red = cancelled.
 */
const STATUS_STYLES: Record<AppointmentStatus, string> = {
  confirmed: 'bg-green-100 text-green-800',
  scheduled: 'bg-yellow-100 text-yellow-800',
  cancelled: 'bg-red-100 text-red-800',
};

/**
 * Human-readable label shown inside the badge for each status.
 * "Pending" is used instead of "Scheduled" because salon owners think in terms
 * of "has the client confirmed?" rather than the technical status name.
 */
const STATUS_LABELS: Record<AppointmentStatus, string> = {
  confirmed: 'Confirmed',
  scheduled: 'Pending',
  cancelled: 'Cancelled',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Props accepted by Badge. */
interface BadgeProps {
  /** The appointment status to display. */
  status: AppointmentStatus;
}

/**
 * Badge renders a pill-shaped status indicator for an appointment.
 * Returns null for 'scheduled' — the absence of a badge communicates
 * "pending confirmation" without cluttering every unconfirmed card.
 *
 * @param props.status - The appointment status to visualise.
 * @returns A styled <span> element, or null for 'scheduled' status.
 */
export default function Badge({ status }: BadgeProps): React.ReactElement | null {
  // 'scheduled' is the default state — no badge needed.
  if (status === 'scheduled') return null;

  return (
    <span
      className={`
        inline-flex items-center
        px-2.5 py-0.5 rounded-full
        text-xs font-medium
        ${STATUS_STYLES[status]}
      `}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
