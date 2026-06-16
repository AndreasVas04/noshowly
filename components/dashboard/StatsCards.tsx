/**
 * components/dashboard/StatsCards.tsx
 *
 * Three summary stat cards at the top of the Today dashboard:
 *  - Confirmed appointments
 *  - Pending appointments (status='scheduled' in the DB — client has not replied yet)
 *  - Cancelled appointments
 *
 * Shown for all active paid plans (basic, pro, professional, business, starter).
 * Hidden for trial and cancelled — no reminders are sent during trial so the
 * counts are meaningless.
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
import type { AppointmentWithDetails, UserPlan } from '@/types';

/** Aggregated counts for today's appointments, split by status. */
type DayStats = {
  confirmed: number;
  /** Appointments with status='scheduled' — shown as "Pending" in UI. */
  pending: number;
  cancelled: number;
};

/**
 * Counts today's appointments by derived display status.
 *
 * "Pending" = status 'scheduled' AND datetime is in the future.
 * Past unanswered (status 'scheduled' AND datetime < now) are intentionally
 * excluded from all stat counts — they are not actionable and would inflate
 * the Pending number with appointments that already passed without a reply.
 * They remain visible in the appointment list with the grey "Past" pill.
 *
 * @param appointments - List returned by the API.
 * @returns Counts split by confirmed, pending (upcoming scheduled), and cancelled.
 */
function computeStats(appointments: AppointmentWithDetails[]): DayStats {
  const now = new Date();
  return appointments.reduce<DayStats>(
    (acc, appt) => {
      if (appt.status === 'confirmed') {
        acc.confirmed++;
      } else if (appt.status === 'scheduled' && new Date(appt.datetime) > now) {
        // Only upcoming scheduled appointments count as Pending.
        acc.pending++;
      } else if (appt.status === 'cancelled') {
        acc.cancelled++;
      }
      // Past unanswered (scheduled + past datetime) are excluded from all counts.
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
        <p className="text-[9px] sm:text-[11px] font-medium text-[#8A8680] uppercase tracking-tight font-body whitespace-nowrap overflow-hidden mb-3">{label}</p>
        {loading ? (
          <div className="h-10 w-10 animate-pulse rounded bg-[#E5E2DB]/60" />
        ) : (
          <p className="font-heading text-4xl font-bold text-[#1A1A1A] tabular-nums leading-none text-left">{count}</p>
        )}
        <div className="absolute bottom-2 right-2 opacity-40">{icon}</div>
      </CardContent>
    </Card>
  );
}

/** Props for StatsCards. */
interface StatsCardsProps {
  /**
   * The authenticated user's current plan.
   * Cards are hidden only for trial and cancelled — both have no active reminders
   * and therefore no meaningful confirmed/pending/cancelled counts.
   * All paid plans (basic, starter, pro, professional, business) show stats because
   * email YES/NO confirmation is available on every paid plan.
   */
  plan: UserPlan;
}

/**
 * StatsCards displays a row of three summary cards for today's appointment counts.
 * Visible for all active paid plans; hidden for trial and cancelled accounts.
 *
 * @param props - plan from the server component parent.
 * @returns A grid of three stat cards, or null for trial/cancelled plans.
 */
export default function StatsCards({ plan }: StatsCardsProps) {
  // Hide for trial and cancelled — reminders not sent, counts are meaningless.
  if (plan === 'trial' || plan === 'cancelled') return null;

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
