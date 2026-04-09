/**
 * app/pricing/page.tsx
 *
 * Subscription plan selection page.
 *
 * Shows the three NoShowly plans: Solo, Salon, Studio. The salon owner can
 * select a plan to start or change their subscription. Clicking "Get started"
 * calls POST /api/stripe/checkout and redirects to Stripe's hosted checkout page.
 *
 * Auth-aware:
 *  - If authenticated: fetches the user's current plan and highlights it.
 *    Trial users see a banner at the top prompting them to pick a plan.
 *  - If not authenticated: redirects to /login (see middleware.ts).
 *
 * Pricing and reminder limits come from lib/plans.ts — never hardcoded here.
 *
 * Layout: server component for data fetching; PlanCard buttons are a client
 * component so they can call the checkout API and redirect.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { PLAN_LIMITS } from '@/lib/plans';
import type { UserPlan } from '@/lib/plans';
import CheckoutButton from './CheckoutButton';

// ---------------------------------------------------------------------------
// Plan metadata
// ---------------------------------------------------------------------------

/** Static display config for each plan card — does not include limits (from PLAN_LIMITS). */
type PlanMeta = {
  key: 'solo' | 'salon' | 'studio';
  name: string;
  price: number;
  description: string;
  features: string[];
};

const PLANS: PlanMeta[] = [
  {
    key:         'solo',
    name:        'Solo',
    price:       29.99,
    description: 'Perfect for a one-chair operation.',
    features: [
      `Up to ${PLAN_LIMITS.solo} reminders per month`,
      'SMS + email reminders',
      'Unlimited appointments',
      'Client management',
      'Confirmation tracking',
    ],
  },
  {
    key:         'salon',
    name:        'Salon',
    price:       49.99,
    description: 'Built for a small team of 2–4.',
    features: [
      `Up to ${PLAN_LIMITS.salon} reminders per month`,
      'SMS + email reminders',
      'Unlimited appointments',
      'Team scheduling',
      'Confirmation tracking',
    ],
  },
  {
    key:         'studio',
    name:        'Studio',
    price:       89.99,
    description: 'For busy studios with 5 or more staff.',
    features: [
      `Up to ${PLAN_LIMITS.studio} reminders per month`,
      'SMS + email reminders',
      'Unlimited appointments',
      'Team scheduling',
      'Confirmation tracking',
    ],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the user's current plan is one of the three paid plans.
 *
 * @param plan - The user's current plan from the DB.
 * @returns true if the user is already on a paid subscription.
 */
function isPaidPlan(plan: UserPlan): boolean {
  return plan === 'solo' || plan === 'salon' || plan === 'studio';
}

// ---------------------------------------------------------------------------
// Page (server component)
// ---------------------------------------------------------------------------

/**
 * Pricing page — fetches the authenticated user's plan, then renders plan cards.
 *
 * Redirects to /login if not authenticated (second layer after middleware).
 *
 * @returns The pricing page with plan cards and an optional trial/upgrade banner.
 */
export default async function PricingPage() {
  // Fetch session and current plan server-side so the page renders with the
  // correct highlighted plan — no client-side flash of the wrong state.
  const supabase = await createServerSupabaseClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect('/login');
  }

  const { data: user } = await supabase
    .from('users')
    .select('plan')
    .eq('id', session.user.id)
    .single();

  const currentPlan: UserPlan = (user?.plan as UserPlan) ?? 'trial';
  const onTrial = currentPlan === 'trial';
  const onCancelled = currentPlan === 'cancelled';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="mx-auto max-w-5xl px-6 py-5 flex items-center justify-between">
          <span className="text-lg font-semibold text-gray-900">Noshowly</span>
          <a
            href="/dashboard"
            className="text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            Back to dashboard
          </a>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-12">

        {/* Trial / cancelled banner */}
        {(onTrial || onCancelled) && (
          <div
            className={`
              mb-10 rounded-xl border px-6 py-5
              ${onCancelled
                ? 'border-red-200 bg-red-50'
                : 'border-indigo-200 bg-indigo-50'
              }
            `}
          >
            <p
              className={`text-sm font-medium ${
                onCancelled ? 'text-red-800' : 'text-indigo-800'
              }`}
            >
              {onCancelled
                ? 'Your subscription has ended. Pick a plan below to reactivate your account and keep your data.'
                : 'Pick a plan below to unlock SMS reminders and keep your data after the trial ends.'}
            </p>
          </div>
        )}

        {/* Page heading */}
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-bold text-gray-900">Simple, flat pricing</h1>
          <p className="mt-2 text-gray-500">
            No commissions. No per-booking fees. One flat monthly price.
          </p>
        </div>

        {/* Plan cards */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {PLANS.map((plan) => {
            const isCurrent = currentPlan === plan.key;
            const highlighted = plan.key === 'salon'; // Most popular

            return (
              <div
                key={plan.key}
                className={`
                  relative flex flex-col rounded-2xl border bg-white p-7 shadow-sm
                  transition-shadow hover:shadow-md
                  ${isCurrent
                    ? 'border-indigo-400 ring-2 ring-indigo-400'
                    : highlighted && !isPaidPlan(currentPlan)
                    ? 'border-indigo-300'
                    : 'border-gray-200'
                  }
                `}
              >
                {/* "Most popular" badge — only on Salon when not already on a paid plan */}
                {highlighted && !isPaidPlan(currentPlan) && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-indigo-600 px-3 py-0.5 text-xs font-semibold text-white">
                    Most popular
                  </span>
                )}

                {/* Current plan indicator */}
                {isCurrent && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-indigo-600 px-3 py-0.5 text-xs font-semibold text-white">
                    Current plan
                  </span>
                )}

                {/* Plan name */}
                <h2 className="text-xl font-bold text-gray-900">{plan.name}</h2>
                <p className="mt-1 text-sm text-gray-500">{plan.description}</p>

                {/* Price */}
                <div className="mt-5 flex items-baseline gap-1">
                  <span className="text-4xl font-extrabold text-gray-900">
                    ${plan.price.toFixed(2)}
                  </span>
                  <span className="text-sm text-gray-500">/month</span>
                </div>

                {/* Feature list */}
                <ul className="mt-6 flex-1 space-y-2.5">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5 text-sm text-gray-700">
                      {/* Checkmark */}
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="mt-0.5 h-4 w-4 flex-shrink-0 text-indigo-500"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                      {feature}
                    </li>
                  ))}
                </ul>

                {/* CTA button */}
                <div className="mt-8">
                  {isCurrent ? (
                    <div className="flex w-full items-center justify-center rounded-xl border border-indigo-300 bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-700">
                      Your current plan
                    </div>
                  ) : (
                    <CheckoutButton plan={plan.key} highlighted={highlighted && !isPaidPlan(currentPlan)} />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer note */}
        <p className="mt-10 text-center text-xs text-gray-400">
          Includes up to the plan limit of reminders per month — more than enough for any salon.
          Need more? <a href="mailto:noshowly@gmail.com" className="underline hover:text-gray-600">Contact us.</a>
        </p>
      </div>
    </div>
  );
}
