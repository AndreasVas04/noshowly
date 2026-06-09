/**
 * components/ui/Badge.tsx
 *
 * Status badge for appointment cards. Maps appointment status values to
 * clean, minimal pill labels using the brand palette.
 *
 * Mapping:
 *  - 'scheduled' → null (no badge shown — reduces visual noise for pending)
 *  - 'confirmed' → "Confirmed" (dark green text)
 *  - 'cancelled' → "Cancelled" (muted red text)
 *
 * Also re-exports the shadcn Badge primitives (badgeVariants) for use
 * in other parts of the UI that need generic badge styles.
 */

import { cn } from '@/lib/utils';
import type { AppointmentStatus } from '@/types';

// ---------------------------------------------------------------------------
// Shadcn Badge variants (for generic use elsewhere)
// ---------------------------------------------------------------------------

import { cva, type VariantProps } from 'class-variance-authority';

export const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-[#1A1A1A] text-white',
        secondary: 'border-transparent bg-[#C8C8C8]/30 text-[#1A1A1A]',
        outline: 'border-[#C8C8C8] text-[#1A1A1A]',
        destructive: 'border-transparent bg-red-100 text-red-700',
      },
    },
    defaultVariants: { variant: 'default' },
  }
);

/** Generic shadcn-style Badge component for programmatic use. */
export function ShadcnBadge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

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
  if (status === 'scheduled') {
    // No badge for pending — reduces clutter in the appointment list.
    return null;
  }

  if (status === 'confirmed') {
    return (
      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
        Confirmed
      </span>
    );
  }

  if (status === 'cancelled') {
    return (
      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-red-50 text-red-600 border border-red-100">
        Cancelled
      </span>
    );
  }

  return null;
}
