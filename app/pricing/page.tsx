/**
 * app/pricing/page.tsx
 *
 * Subscription plan selection page — server component.
 *
 * Fetches the authenticated user's current plan server-side, then passes it
 * to the PricingTabs client component which renders the plan card.
 *
 * Single plan: Basic ($19/month).
 *
 * Auth: redirects to /login if not authenticated (see middleware.ts).
 * Design: brand-dark header, Playfair Display headings, shadcn Cards.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import type { UserPlan } from '@/lib/plans';
import PricingTabs from './PricingTabs';
import PricingPageHeader from './PricingPageHeader';

/**
 * Pricing page — fetches the authenticated user's plan, renders the tabbed
 * plan selector. Redirects to /login if not authenticated.
 *
 * @returns The pricing page JSX.
 */
export default async function PricingPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) redirect('/login');

  const { data: user } = await supabase
    .from('users')
    .select('plan')
    .eq('id', session.user.id)
    .single();

  const currentPlan: UserPlan = (user?.plan as UserPlan) ?? 'trial';
  const onCancelled = currentPlan === 'cancelled';

  return (
    <div className="min-h-screen bg-[#FAFAF8]">

      <PricingPageHeader />

      <div className="mx-auto max-w-5xl px-6 py-14">

        {/* Cancelled banner */}
        {onCancelled && (
          <div className="mb-10 rounded-xl border border-red-200 bg-red-50 px-6 py-5">
            <p className="text-sm font-medium text-red-800">
              Your subscription has ended. Pick a plan below to reactivate your account and keep your data.
            </p>
          </div>
        )}

        {/* Page heading */}
        <div className="mb-12 text-center">
          <h1 className="font-heading text-4xl font-bold text-[#1A1A1A] tracking-tight">
            Simple, flat pricing
          </h1>
          <p className="mt-3 text-[#8A8680] text-base font-body">
            No commissions. No per-booking fees. One flat monthly price.
          </p>
        </div>

        {/* Plan cards */}
        <PricingTabs currentPlan={currentPlan} />

      </div>
    </div>
  );
}
