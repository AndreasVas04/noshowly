/**
 * components/ui/Badge.tsx
 *
 * Status badge for appointment cards. Maps appointment status values to
 * clean, minimal pill labels using the brand palette.
 *
 * Mapping (lib/appointment-status.ts):
 *  - 'scheduled' → null (no badge shown — reduces visual noise for pending)
 *  - 'confirmed' → "Confirmed" (dark green text)
 *  - 'cancelled' → "Cancelled" (muted red text)
 */

import { STATUS_BADGE_CLASSES, STATUS_LABELS } from '@/lib/appointment-status';
import type { AppointmentStatus } from '@/types';

// ---------------------------------------------------------------------------
// Status-based badge (default export — used by AppointmentCard)
// ---------------------------------------------------------------------------

/** Props accepted by the status Badge. */
interface BadgeProps {
  /** The appointment status value from the database. */
  status: AppointmentStatus;
}

/**
 * Renders a minimal status pill for an appointment.
 * Returns null for 'scheduled' (pending) to avoid visual noise.
 *
 * @param props.status - The appointment status.
 * @returns A status pill, or null if status is 'scheduled'.
 */
export default function Badge({ status }: BadgeProps) {
  const colours = STATUS_BADGE_CLASSES[status];
  if (!colours) return null;

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${colours}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}
