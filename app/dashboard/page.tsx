/**
 * app/dashboard/page.tsx
 *
 * Dashboard home — "Today" view.
 *
 * Shows a row of stat cards (confirmed / pending / cancelled) followed by a
 * chronological list of today's appointments. The salon owner opens this page
 * first thing in the morning to see who is coming in; other days are on the
 * Week page.
 *
 * Authentication is guaranteed by proxy.ts before this page is reached.
 * This is a Server Component — StatsCards and DayView handle all client-side
 * interactivity independently.
 */

import DayView from '@/components/dashboard/DayView';
import StatsCards from '@/components/dashboard/StatsCards';

/**
 * DashboardPage renders today's appointment stats and list.
 *
 * @returns The dashboard home page with stats cards and the today appointment list.
 */
export default function DashboardPage() {
  return (
    <div className="p-6 lg:p-10">
      {/* Stats summary — confirmed / pending / cancelled counts for today. */}
      <StatsCards />

      {/* Chronological appointment list for today */}
      <div className="max-w-3xl">
        <DayView title="Today" />
      </div>
    </div>
  );
}
