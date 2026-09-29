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
 * Fetches today's appointments from GET /api/appointments?date=YYYY-MM-DD,
 * where "today" is the current date in the salon's timezone (from /api/salon).
 * Response shape: { appointments: AppointmentWithDetails[] }
 *
 * Like the list below it, the counts reload whenever an appointment changes
 * (Supabase Realtime, scoped to the salon by RLS), so confirming or cancelling
 * an appointment here or on another device updates the cards. A response that
 * arrives after a newer request started is ignored.
 */

'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle, Clock, XCircle } from 'lucide-react';
import { STATUS_LABELS } from '@/lib/appointment-status';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { resolveTimeZone, todayInZone } from '@/lib/time';
import type { AppointmentWithDetails, Salon } from '@/types';

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
        <p className="text-[9px] sm:text-[11px] font-medium text-[#6F6B65] uppercase tracking-tight font-body whitespace-nowrap overflow-hidden mb-3 text-center">{label}</p>
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
  /** Salon timezone; null until loaded (or when the salon could not be loaded). */
  const [timezone, setTimezone] = useState<string | null>(null);
  /** Incremented to reload the counts (an appointment changed). */
  const [refreshCount, setRefreshCount] = useState(0);

  // Load the salon's timezone once: "today" is the salon's date, not the browser's.
  useEffect(() => {
    let ignore = false;

    async function loadSalon(): Promise<void> {
      try {
        const salonRes = await fetch('/api/salon', { cache: 'no-store' });
        if (!salonRes.ok) throw new Error(`HTTP ${salonRes.status}`);
        const { salon } = (await salonRes.json()) as { salon: Salon };
        if (!ignore) setTimezone(resolveTimeZone(salon.timezone));
      } catch {
        // Silently fail — stats are non-critical display only.
        if (!ignore) setLoading(false);
      }
    }

    void loadSalon();
    return () => { ignore = true; };
  }, []);

  // Load today's counts, again on every refresh. A response that arrives
  // after a newer request started is ignored.
  useEffect(() => {
    if (!timezone) return;
    let ignore = false;

    async function loadStats(zone: string): Promise<void> {
      try {
        const res = await fetch(`/api/appointments?date=${todayInZone(zone)}`, { cache: 'no-store' });
        if (!res.ok) return;
        // API returns { appointments: AppointmentWithDetails[] } — destructure accordingly.
        const payload = (await res.json()) as { appointments: AppointmentWithDetails[] };
        if (!ignore) setStats(computeStats(payload.appointments));
      } catch {
        // Silently fail — stats are non-critical display only.
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    void loadStats(timezone);
    return () => { ignore = true; };
  }, [timezone, refreshCount]);

  // Reload when any of the salon's appointments is created, changed or deleted.
  useEffect(() => {
    const supabase = createBrowserSupabaseClient();

    const channel = supabase
      .channel('stats-appointments-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'appointments' },
        () => {
          setRefreshCount((count) => count + 1);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const cards: StatConfig[] = [
    {
      label: STATUS_LABELS.confirmed,
      count: stats.confirmed,
      loading,
      icon: <CheckCircle className="w-4 h-4" style={{ color: '#1B4332' }} />,
      accentClass: 'border-l-[#1B4332]',
    },
    {
      label: STATUS_LABELS.scheduled,
      count: stats.pending,
      loading,
      icon: <Clock className="w-4 h-4 text-amber-600" />,
      accentClass: 'border-l-amber-600',
    },
    {
      label: STATUS_LABELS.cancelled,
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
