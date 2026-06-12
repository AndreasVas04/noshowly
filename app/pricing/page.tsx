/**
 * app/pricing/page.tsx
 *
 * Subscription plan selection page — server component.
 *
 * Fetches the authenticated user's current plan server-side, then passes it
 * to the PricingTabs client component which renders the three plan cards.
 *
 * Three plans: Starter ($19), Professional ($39), Business ($79).
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
 * Returns true if the user is already on a paid subscription.
 *
 * @param plan - The user's current plan.
 * @returns true if on a paid plan.
 */
function isPaidPlan(plan: UserPlan): boolean {
  return plan !== 'trial' && plan !== 'cancelled';
}

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
  const onTrial     = currentPlan === 'trial';
  const onCancelled = currentPlan === 'cancelled';

  return (
    <div className="min-h-screen bg-[#FAFAF8]">

      <PricingPageHeader />

      <div className="mx-auto max-w-5xl px-6 py-14">

        {/* Trial or cancelled banner */}
        {(onTrial || onCancelled) && (
          <div
            className={`mb-10 rounded-xl border px-6 py-5 ${
              onCancelled
                ? 'border-red-200 bg-red-50'
                : 'border-[#C8C8C8]/40 bg-white'
            }`}
          >
            <p className={`text-sm font-medium ${onCancelled ? 'text-red-800' : 'text-[#1A1A1A]'}`}>
              {onCancelled
                ? 'Your subscription has ended. Pick a plan below to reactivate your account and keep your data.'
                : 'Activate your account with one simple plan.'}
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
