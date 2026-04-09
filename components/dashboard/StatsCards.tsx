/**
 * components/dashboard/StatsCards.tsx
 *
 * Shows three summary stat cards at the top of the Today dashboard:
 *  - Confirmed appointments (green)
 *  - Pending appointments (yellow) — status='scheduled' in the DB
 *  - Cancelled appointments (red)
 *
 * Data scope: today only. The component fetches today's appointments
 * independently from GET /api/appointments?date=YYYY-MM-DD.
 *
 * This is a Client Component because it performs data fetching on mount.
 */

'use client';

import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import type { AppointmentWithDetails } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Aggregated counts for today's appointments, split by status. */
type DayStats = {
  confirmed: number;
  /** Appointments with status='scheduled' — shown as "Pending" in the UI. */
  pending: number;
  cancelled: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Counts today's appointments by status.
 *
 * @param appointments - The list of appointments returned by the API.
 * @returns An object with confirmed, pending, and cancelled counts.
 */
function computeStats(appointments: AppointmentWithDetails[]): DayStats {
  return appointments.reduce<DayStats>(
    (acc, appt) => {
      if (appt.status === 'confirmed')  acc.confirmed++;
      else if (appt.status === 'scheduled') acc.pending++;
      else if (appt.status === 'cancelled') acc.cancelled++;
      return acc;
    },
    { confirmed: 0, pending: 0, cancelled: 0 }
  );
}

// ---------------------------------------------------------------------------
// Sub-component: individual stat card
// ---------------------------------------------------------------------------

type StatCardProps = {
  label: string;
  count: number;
  /** Tailwind colour classes for the card's accent and icon background. */
  colorClasses: {
    border: string;
    iconBg: string;
    iconText: string;
    countText: string;
  };
  icon: React.ReactNode;
  loading: boolean;
};

/**
 * Renders a single stat card with an icon, a large number, and a label.
 *
 * @param props - Visual configuration and data for the card.
 */
function StatCard({ label, count, colorClasses, icon, loading }: StatCardProps) {
  return (
    <div
      className={`
        flex items-center gap-4 rounded-xl border bg-white px-5 py-4
        shadow-sm ${colorClasses.border}
      `}
    >
      {/* Icon badge */}
      <div
        className={`
          flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg
          ${colorClasses.iconBg} ${colorClasses.iconText}
        `}
      >
        {icon}
      </div>

      {/* Count + label */}
      <div>
        {loading ? (
          <div className="h-7 w-8 animate-pulse rounded bg-gray-200" />
        ) : (
          <p className={`text-2xl font-bold leading-none ${colorClasses.countText}`}>
            {count}
          </p>
        )}
        <p className="mt-0.5 text-sm text-gray-500">{label}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons (inline SVG, no external dependency)
// ---------------------------------------------------------------------------

/** Checkmark circle icon — used for Confirmed. */
const CheckIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
    <path
      fillRule="evenodd"
      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
      clipRule="evenodd"
    />
  </svg>
);

/** Clock icon — used for Pending. */
const ClockIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
    <path
      fillRule="evenodd"
      d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
      clipRule="evenodd"
    />
  </svg>
);

/** X circle icon — used for Cancelled. */
const XIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
    <path
      fillRule="evenodd"
      d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
      clipRule="evenodd"
    />
  </svg>
);

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * StatsCards displays a row of three summary cards showing today's appointment
 * counts by status: Confirmed (green), Pending (yellow), Cancelled (red).
 *
 * Data is fetched from GET /api/appointments?date=YYYY-MM-DD on mount.
 *
 * @returns A flex row of three stat cards.
 */
export default function StatsCards() {
  const [stats, setStats]   = useState<DayStats>({ confirmed: 0, pending: 0, cancelled: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const today = format(new Date(), 'yyyy-MM-dd');

    fetch(`/api/appointments?date=${today}`)
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as AppointmentWithDetails[];
        setStats(computeStats(data));
      })
      .catch(() => {
        // Silently fail — stats are non-critical; the appointment list still shows
      })
      .finally(() => setLoading(false));
  }, []);

  const cards: StatCardProps[] = [
    {
      label:  'Confirmed',
      count:  stats.confirmed,
      loading,
      icon:   <CheckIcon />,
      colorClasses: {
        border:    'border-green-200',
        iconBg:    'bg-green-100',
        iconText:  'text-green-600',
        countText: 'text-green-700',
      },
    },
    {
      label:  'Pending',
      count:  stats.pending,
      loading,
      icon:   <ClockIcon />,
      colorClasses: {
        border:    'border-yellow-200',
        iconBg:    'bg-yellow-100',
        iconText:  'text-yellow-600',
        countText: 'text-yellow-700',
      },
    },
    {
      label:  'Cancelled',
      count:  stats.cancelled,
      loading,
      icon:   <XIcon />,
      colorClasses: {
        border:    'border-red-200',
        iconBg:    'bg-red-100',
        iconText:  'text-red-600',
        countText: 'text-red-700',
      },
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-4 mb-8">
      {cards.map((card) => (
        <StatCard key={card.label} {...card} />
      ))}
    </div>
  );
}
