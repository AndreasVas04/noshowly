/**
 * components/dashboard/StatsCards.tsx
 *
 * Three summary stat cards at the top of the Today dashboard:
 *  - Confirmed appointments
 *  - Pending appointments (status='scheduled' in the DB)
 *  - Cancelled appointments
 *
 * Premium design: white shadcn Cards with colored left border and subtle tinted
 * background, brand-dark typography, Framer Motion fade-in on load.
 *
 * Fetches today's appointments from GET /api/appointments?date=YYYY-MM-DD.
 */

'use client';

import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle, Clock, XCircle } from 'lucide-react';
import type { AppointmentWithDetails, UserPlan } from '@/types';

/** Aggregated counts for today's appointments, split by status. */
type DayStats = {
  confirmed: number;
  /** Appointments with status='scheduled' — shown as "Pending" in UI. */
  pending: number;
  cancelled: number;
};

/**
 * Counts today's appointments by status.
 *
 * @param appointments - List returned by the API.
 * @returns Counts split by confirmed, pending, and cancelled.
 */
function computeStats(appointments: AppointmentWithDetails[]): DayStats {
  return appointments.reduce<DayStats>(
    (acc, appt) => {
      if (appt.status === 'confirmed') acc.confirmed++;
      else if (appt.status === 'scheduled') acc.pending++;
      else if (appt.status === 'cancelled') acc.cancelled++;
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
  /** Tailwind background tint class matching the accent color. */
  bgClass: string;
};

/**
 * Renders a single stat card with a colored left border accent, tinted
 * background, large count, and a subtle icon in the corner.
 *
 * @param props - Card data and loading state.
 */
function StatCard({ label, count, icon, loading, accentClass, bgClass }: StatConfig) {
  return (
    <Card className={`border-[#C8C8C8]/40 shadow-none border-l-[3px] ${accentClass} ${bgClass}`}>
      <CardContent className="px-5 py-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-medium text-[#C8C8C8] uppercase tracking-wider">{label}</p>
          <div className="text-[#C8C8C8]">{icon}</div>
        </div>
        {loading ? (
          <div className="h-8 w-10 animate-pulse rounded bg-[#C8C8C8]/20" />
        ) : (
          <p className="text-3xl font-semibold text-[#1A1A1A] tabular-nums leading-none">{count}</p>
        )}
      </CardContent>
    </Card>
  );
}

/** Props for StatsCards. */
interface StatsCardsProps {
  /**
   * The authenticated user's current plan.
   * Stats are only shown for plans that include SMS (professional / business),
   * since confirmed/pending/cancelled counts are only meaningful when clients
   * can reply YES or NO. For starter and trial plans there are no SMS responses,
   * so the cards are hidden.
   */
  plan: UserPlan;
}

/**
 * StatsCards displays a row of three summary cards for today's appointment counts.
 * Only rendered for professional and business plan users.
 *
 * @param props - plan from the server component parent.
 * @returns A grid of three stat cards, or null when the plan does not include SMS.
 */
export default function StatsCards({ plan }: StatsCardsProps) {
  // Only show stats for plans with SMS confirmation support.
  // On starter and trial, clients never reply YES/NO, so the counts are meaningless.
  if (plan !== 'professional' && plan !== 'business') return null;
  const [stats, setStats] = useState<DayStats>({ confirmed: 0, pending: 0, cancelled: 0 });
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
        // Silently fail — stats are non-critical
      })
      .finally(() => setLoading(false));
  }, []);

  const cards: StatConfig[] = [
    {
      label: 'Confirmed',
      count: stats.confirmed,
      loading,
      icon: <CheckCircle className="w-4 h-4 text-emerald-500" />,
      accentClass: 'border-l-emerald-500',
      bgClass: 'bg-emerald-50/50',
    },
    {
      label: 'Pending',
      count: stats.pending,
      loading,
      icon: <Clock className="w-4 h-4 text-amber-400" />,
      accentClass: 'border-l-amber-400',
      bgClass: 'bg-amber-50/50',
    },
    {
      label: 'Cancelled',
      count: stats.cancelled,
      loading,
      icon: <XCircle className="w-4 h-4 text-red-400" />,
      accentClass: 'border-l-red-400',
      bgClass: 'bg-red-50/50',
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
