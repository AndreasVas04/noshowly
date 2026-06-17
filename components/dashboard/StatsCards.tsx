/**
 * components/dashboard/StatsCards.tsx
 *
 * Three summary stat cards at the top of the Today dashboard:
 *  - Confirmed appointments
 *  - Pending appointments (status='scheduled' in the DB — client has not replied yet)
 *  - Cancelled appointments
 *
 * Visible for all plans including trial. Plan enforcement is handled at the
 * API level on write operations — stats are purely informational.
 *
 * Premium design: white shadcn Cards with colored left border and subtle tinted
 * background, brand-dark typography, Framer Motion fade-in on load.
 *
 * Fetches today's appointments from GET /api/appointments?date=YYYY-MM-DD.
 * Response shape: { appointments: AppointmentWithDetails[] }
 */

'use client';

import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle, Clock, XCircle } from 'lucide-react';
import type { AppointmentWithDetails } from '@/types';

/** Aggregated counts for today's appointments, split by status. */
type DayStats = {
  confirmed: number;
  /** Appointments with status='scheduled' — shown as "Pending" in UI. */
  pending: number;
  cancelled: number;
};

/**
 * Counts today's UPCOMING appointments by status.
 *
 * Only appointments whose datetime is in the future are counted.
 * Past appointments (datetime < now) are excluded from all stat cards
 * regardless of status — they are no longer actionable. They remain
 * visible in the appointment list below with the grey "Past" pill.
 *
 * @param appointments - List returned by the API.
 * @returns Counts split by confirmed, pending (upcoming scheduled), and cancelled.
 */
function computeStats(appointments: AppointmentWithDetails[]): DayStats {
  const now = new Date();
  return appointments.reduce<DayStats>(
    (acc, appt) => {
      // Only count future appointments — past ones are not actionable.
      if (new Date(appt.datetime) <= now) return acc;

      if (appt.status === 'confirmed') {
        acc.confirmed++;
      } else if (appt.status === 'scheduled') {
        acc.pending++;
      } else if (appt.status === 'cancelled') {
        acc.cancelled++;
      }
      return acc;
    },
    { confirmed: 0, pending: 0, cancelled: 0 }
  );
}

/** Config for a single stat card. */
type StatConfig = {
  label: string;
  count: number;
  icon: React.ReactNode;
  loading: boolean;
  /** Tailwind border-left color class for the accent line. */
  accentClass: string;
};

/**
 * Renders a single stat card with a colored left border accent, clean white
 * background, Playfair Display count, and a subtle icon in the corner.
 *
 * @param props - Card data and loading state.
 */
function StatCard({ label, count, icon, loading, accentClass }: StatConfig) {
  return (
    <Card className={`bg-white border-[#E5E2DB] shadow-none border-l-[3px] overflow-hidden relative ${accentClass}`}>
      <CardContent className="px-5 py-4">
        <p className="text-[9px] sm:text-[11px] font-medium text-[#8A8680] uppercase tracking-tight font-body whitespace-nowrap overflow-hidden mb-3 text-center">{label}</p>
        {loading ? (
          <div className="h-10 w-10 animate-pulse rounded bg-[#E5E2DB]/60 mx-auto" />
        ) : (
          <p className="font-heading text-4xl font-bold text-[#1A1A1A] tabular-nums leading-none text-center">{count}</p>
        )}
        <div className="absolute bottom-2 right-2 opacity-40">{icon}</div>
      </CardContent>
    </Card>
  );
}

/**
 * StatsCards displays a row of three summary cards for today's appointment counts.
 * Visible for all plans including trial. Plan enforcement on write operations
 * (API-level) ensures data integrity.
 *
 * @returns A grid of three stat cards.
 */
export default function StatsCards() {
  const [stats, setStats] = useState<DayStats>({ confirmed: 0, pending: 0, cancelled: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const today = format(new Date(), 'yyyy-MM-dd');

    fetch(`/api/appointments?date=${today}`)
      .then(async (res) => {
        if (!res.ok) return;
        // API returns { appointments: AppointmentWithDetails[] } — destructure accordingly.
        const payload = (await res.json()) as { appointments: AppointmentWithDetails[] };
        setStats(computeStats(payload.appointments));
      })
      .catch(() => {
        // Silently fail — stats are non-critical display only.
      })
      .finally(() => setLoading(false));
  }, []);

  const cards: StatConfig[] = [
    {
      label: 'Confirmed',
      count: stats.confirmed,
      loading,
      icon: <CheckCircle className="w-4 h-4" style={{ color: '#1B4332' }} />,
      accentClass: 'border-l-[#1B4332]',
    },
    {
      label: 'Pending',
      count: stats.pending,
      loading,
      icon: <Clock className="w-4 h-4 text-amber-600" />,
      accentClass: 'border-l-amber-600',
    },
    {
      label: 'Cancelled',
      count: stats.cancelled,
      loading,
      icon: <XCircle className="w-4 h-4 text-rose-500" />,
      accentClass: 'border-l-rose-500',
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-4 mb-8">
      {cards.map((card, i) => (
        <motion.div
          key={card.label}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: i * 0.06, ease: 'easeOut' }}
        >
          <StatCard {...card} />
        </motion.div>
      ))}
    </div>
  );
}
