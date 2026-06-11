/**
 * app/dashboard/page.tsx
 *
 * Dashboard home — "Today" view.
 *
 * Shows a row of stat cards (confirmed / pending / cancelled) followed by a
 * chronological list of today's appointments. The salon owner opens this page
 * first thing in the morning to see who is coming in.
 *
 * Navigation is still available (prev/next day buttons on DayView) so the owner
 * can glance at tomorrow without switching to the Week page — but the view
 * always opens on today.
 *
 * Authentication is guaranteed by middleware.ts before this page is reached.
 * This is a Server Component — StatsCards and DayView handle all client-side
 * interactivity independently.
 *
 * The user's plan is fetched server-side and passed to StatsCards, which renders
 * nothing for trial and basic plans (no SMS replies on those plans).
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import DayView from '@/components/dashboard/DayView';
import StatsCards from '@/components/dashboard/StatsCards';
import type { UserPlan } from '@/types';

/**
 * DashboardPage renders today's appointment stats and list.
 * Fetches the user's plan server-side to gate the stats cards display.
 *
 * @returns The dashboard home page with stats cards and the today appointment list.
 */
export default async function DashboardPage() {
  // Fetch the user's plan so StatsCards can decide whether to render.
  // Middleware guarantees a valid session exists by the time we get here.
  const supabase = await createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();

  let plan: UserPlan = 'trial';
  if (session) {
    const { data: user } = await supabase
      .from('users')
      .select('plan')
      .eq('id', session.user.id)
      .single();
    plan = (user?.plan as UserPlan) ?? 'trial';
  }

  return (
    <div className="p-6 lg:p-10">
      {/* Stats summary — confirmed / pending / cancelled counts for today.
          Only rendered on pro and business plans (SMS-enabled). */}
      <StatsCards plan={plan} />

      {/* Chronological appointment list for the selected day */}
      <div className="max-w-3xl">
        <DayView title="Today" />
      </div>
    </div>
  );
}
