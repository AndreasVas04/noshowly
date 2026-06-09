/**
 * app/pricing/PricingTabs.tsx
 *
 * Client component — three-card plan selector for the pricing page.
 *
 * Plans:
 *  - Starter      $19/month — unlimited email, no SMS
 *  - Professional $39/month — 300 SMS + unlimited email (most popular)
 *  - Business     $79/month — 1,000 SMS + unlimited email
 *
 * Plan prices and limits are imported from lib/plans — never hardcoded here.
 * Design: brand-dark palette, Playfair Display headings, shadcn Card.
 */

'use client';

import { Card, CardContent, CardHeader } from '@/components/ui/card';
import CheckoutButton from './CheckoutButton';
import { PLAN_LIMITS, PLAN_PRICES } from '@/lib/plans';
import type { PaidPlan, UserPlan } from '@/lib/plans';

// ---------------------------------------------------------------------------
// Plan configuration
// ---------------------------------------------------------------------------

/** Ordered plan keys displayed left to right. */
const PLAN_KEYS: PaidPlan[] = ['starter', 'professional', 'business'];

/** Display name for each plan. */
const PLAN_NAMES: Record<PaidPlan, string> = {
  starter:      'Starter',
  professional: 'Professional',
  business:     'Business',
};

/** One-line tagline shown under the plan name. */
const PLAN_TAGLINES: Record<PaidPlan, string> = {
  starter:      'Start taking online bookings today.',
  professional: 'Reduce no-shows with SMS and email.',
  business:     'For busy businesses with larger teams.',
};

/** Feature list for each plan. */
const PLAN_FEATURES: Record<PaidPlan, string[]> = {
  starter: [
    'Custom booking page',
    'Unlimited appointments',
    'Email reminders',
    'YES / NO confirmation via email',
    'Real-time dashboard',
    'Staff management',
    'Custom email templates',
  ],
  professional: [
    'Everything in Starter',
    'SMS reminders (300/month)',
    'YES / NO confirmation via SMS and email',
    'Custom SMS templates',
  ],
  business: [
    'Everything in Professional',
    'SMS reminders (1,000/month)',
    'Priority support',
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the user is already on a paid subscription.
 *
 * @param plan - The user's current plan.
 * @returns true if on a paid plan.
 */
function isPaidPlan(plan: UserPlan): boolean {
  return plan !== 'trial' && plan !== 'cancelled';
}

// ---------------------------------------------------------------------------
// PlanCard
// ---------------------------------------------------------------------------

/** Props for a single plan card. */
interface PlanCardProps {
  /** The plan to display. */
  planKey: PaidPlan;
  /** The user's current plan — used to highlight the current plan. */
  currentPlan: UserPlan;
}

/**
 * Renders a single subscription plan card with price, limits, features, and CTA.
 *
 * - Current plan: shows "Your current plan" label instead of a CTA button.
 * - Professional (unpaid user): dark border + "Most popular" badge.
 * - Other plans: light border + standard CTA.
 *
 * @param props - planKey and currentPlan.
 * @returns A plan card JSX element.
 */
function PlanCard({ planKey, currentPlan }: PlanCardProps) {
  const name     = PLAN_NAMES[planKey];
  const tagline  = PLAN_TAGLINES[planKey];
  const features = PLAN_FEATURES[planKey];
  const price    = PLAN_PRICES[planKey];
  const limits   = PLAN_LIMITS[planKey];

  const isCurrent  = currentPlan === planKey;
  // Highlight Professional as "Most popular" when the user has not paid yet.
  const highlighted = planKey === 'professional' && !isPaidPlan(currentPlan);

  // Build the subtitle from PLAN_LIMITS — never hardcoded here.
  const subtitle = limits.sms > 0
    ? `${limits.sms.toLocaleString()} SMS reminders + unlimited email reminders`
    : 'Unlimited email reminders';

  return (
    <div className="relative">

      {/* Badge — shown for current plan or most popular */}
      {(isCurrent || highlighted) && (
        <div className="absolute -top-3.5 inset-x-0 flex justify-center z-10">
          <span className="rounded-full bg-[#1A1A1A] px-3 py-1 text-xs font-semibold text-white">
            {isCurrent ? 'Current plan' : 'Most popular'}
          </span>
        </div>
      )}

      <Card
        className={`
          flex flex-col h-full rounded-2xl border shadow-none transition-shadow hover:shadow-md
          ${isCurrent    ? 'border-[#1A1A1A]'      :
            highlighted  ? 'border-[#1A1A1A]/30'   :
                           'border-[#C8C8C8]/40'   }
        `}
      >
        <CardHeader className="px-7 pt-7 pb-5">
          <h2 className="font-heading text-2xl font-semibold text-[#1A1A1A]">
            {name}
          </h2>
          <p className="text-sm text-[#C8C8C8] mt-1">
            {tagline}
          </p>

          {/* Price */}
          <div className="mt-5 flex items-baseline gap-1">
            <span className="font-heading text-4xl font-bold text-[#1A1A1A]">
              ${price}
            </span>
            <span className="text-sm text-[#C8C8C8]">/month</span>
          </div>

          {/* Reminder limits subtitle */}
          <p className="mt-2 text-sm font-medium text-[#2D2D2D]">
            {subtitle}
          </p>
        </CardHeader>

        <CardContent className="px-7 pb-7 flex-1 flex flex-col">
          {/* Feature list */}
          <ul className="flex-1 space-y-3 mb-8">
            {features.map((feature) => (
              <li
                key={feature}
                className="flex items-start gap-2.5 text-sm text-[#2D2D2D]"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="mt-0.5 h-4 w-4 shrink-0 text-[#1A1A1A]"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
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

          {/* CTA */}
          {isCurrent ? (
            <div className="flex w-full items-center justify-center rounded-xl border border-[#C8C8C8]/40 bg-[#F9F9F9] px-4 py-3 text-sm font-medium text-[#C8C8C8]">
              Your current plan
            </div>
          ) : (
            <CheckoutButton plan={planKey} highlighted={highlighted} />
          )}

          {/* Add-on note — shown only for plans that include SMS */}
          {(planKey === 'professional' || planKey === 'business') && (
            <p className="mt-4 text-center text-xs text-[#C8C8C8]">
              Need more SMS? Add 100 SMS reminders for $8/month.{' '}
              <a
                href="mailto:noshowly@gmail.com"
                className="underline hover:text-[#1A1A1A] transition-colors"
              >
                Contact us to add on.
              </a>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PricingCards
// ---------------------------------------------------------------------------

/** Props passed from the server component pricing page. */
interface PricingTabsProps {
  /** The authenticated user's current plan — used to highlight the current plan. */
  currentPlan: UserPlan;
}

/**
 * Three-card pricing layout: Starter, Professional, Business.
 * No tabs — all plans visible at once.
 *
 * @param props - currentPlan from the server component.
 * @returns The full pricing section JSX.
 */
export default function PricingTabs({ currentPlan }: PricingTabsProps) {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
      {PLAN_KEYS.map((key) => (
        <PlanCard key={key} planKey={key} currentPlan={currentPlan} />
      ))}
    </div>
  );
}
