/**
 * app/pricing/page.tsx
 *
 * Subscription plan selection page — server component.
 *
 * Fetches the authenticated user's plan and trial server-side
 * (lib/entitlements.ts), then passes them to the PricingTabs client component
 * which renders the plan card.
 *
 * Single plan: Basic ($19/month). Every account starts with a 14-day free
 * trial without a card; the banner says how the trial or subscription stands.
 *
 * Auth: redirects to /login if not authenticated (see proxy.ts).
 * Design: brand-dark header, Playfair Display headings, shadcn Cards.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getEntitlements, type Entitlements } from '@/lib/entitlements';
import { isDemoAccount } from '@/lib/demo';
import PricingTabs from './PricingTabs';
import PricingPageHeader from './PricingPageHeader';

/**
 * The banner above the plan card, or null.
 *
 * @param entitlements - The account's entitlements, or null when unknown.
 * @param isDemo       - The public demo account.
 */
function planNotice(
  entitlements: Entitlements | null,
  isDemo: boolean,
): { text: string; tone: 'info' | 'danger' } | null {
  if (isDemo) {
    return { text: 'This is the public demo account, so subscribing is turned off.', tone: 'info' };
  }
  if (!entitlements || entitlements.isPaid) return null;
  if (entitlements.isTrial && !entitlements.trialExpired) {
    const days = entitlements.trialDaysLeft ?? 0;
    return {
      text: `You are on the free trial: ${days} ${days === 1 ? 'day' : 'days'} left. Subscribe any time to keep using Noshowly after it ends.`,
      tone: 'info',
    };
  }
  if (entitlements.isTrial) {
    return {
      text: 'Your free trial has ended. Subscribe below to keep using Noshowly. Your data is kept.',
      tone: 'danger',
    };
  }
  return {
    text: 'Your subscription has ended. Pick a plan below to reactivate your account and keep your data.',
    tone: 'danger',
  };
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
    .select('plan, trial_ends_at, stripe_customer_id')
    .eq('id', session.user.id)
    .maybeSingle();

  const entitlements = user ? getEntitlements(user, new Date()) : null;
  const notice = planNotice(entitlements, isDemoAccount(session.user.email));

  return (
    <div className="min-h-screen bg-[#FAFAF8]">

      <PricingPageHeader />

      <div className="mx-auto max-w-5xl px-6 py-14">

        {/* Trial or subscription notice */}
        {notice && (
          <div
            className={[
              'mb-10 rounded-xl border px-6 py-5',
              notice.tone === 'danger' ? 'border-red-200 bg-red-50' : 'border-[#1B4332]/15 bg-[#E8F2EC]',
            ].join(' ')}
          >
            <p className={`text-sm font-medium ${notice.tone === 'danger' ? 'text-red-800' : 'text-[#1B4332]'}`}>
              {notice.text}
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
        <PricingTabs
          isCurrent={entitlements?.isPaid ?? false}
          hasBillingAccount={Boolean(user?.stripe_customer_id)}
        />

      </div>
    </div>
  );
}
