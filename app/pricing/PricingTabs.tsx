/**
 * app/pricing/PricingTabs.tsx
 *
 * Client component — two-card plan selector for the pricing page.
 *
 * Plans shown publicly:
 *  - Basic  $19/month — unlimited email reminders, no SMS
 *  - Pro    $39/month — 100 SMS/month + unlimited email (most popular)
 *
 * Business is intentionally hidden from the public pricing UI.
 * Email fair-use caps are internal — never shown here.
 *
 * Plan prices and SMS limits are imported from lib/plans — never hardcoded here.
 * Design: Calm Professional palette, Playfair Display headings, shadcn Card.
 */

'use client';

import { Card, CardContent, CardHeader } from '@/components/ui/card';
import CheckoutButton from './CheckoutButton';
import { PLAN_PRICES, SMS_ADDON_PRICE, SMS_ADDON_AMOUNT } from '@/lib/plans';
import type { PaidPlan, UserPlan } from '@/lib/plans';

// ---------------------------------------------------------------------------
// Plan configuration
// ---------------------------------------------------------------------------

/** Ordered plan keys displayed left to right (Basic first, Pro second). */
const PLAN_KEYS: PaidPlan[] = ['basic', 'pro'];

/** Display name for each plan. */
const PLAN_NAMES: Record<PaidPlan, string> = {
  basic: 'Basic',
  pro:   'Pro',
};

/** One-line tagline shown under the plan name. */
const PLAN_TAGLINES: Record<PaidPlan, string> = {
  basic: 'For businesses that want simple online booking and email reminders.',
  pro:   'For businesses that want fewer no-shows with SMS confirmations.',
};

/** Feature list for each plan. Email caps are internal — not listed here. */
const PLAN_FEATURES: Record<PaidPlan, string[]> = {
  basic: [
    'Online booking page',
    'Unlimited email reminders',
    'Email YES/NO confirmation buttons',
    'Client management',
    'Appointment management',
  ],
  pro: [
    'Everything in Basic',
    '100 SMS reminders/month',
    'SMS YES/NO replies',
    'Unlimited email reminders',
    'Email YES/NO confirmation buttons',
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Maps legacy plan names (starter, professional) to the equivalent public plan key.
 * Used to correctly highlight the "Current plan" badge for users on legacy plans.
 *
 * @param plan - The user's current plan from the database.
 * @returns The equivalent public plan key, or the original value if no mapping exists.
 */
function normalizePlan(plan: UserPlan): string {
  if (plan === 'starter')      return 'basic';
  if (plan === 'professional') return 'pro';
  return plan;
}

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
 * Renders a single subscription plan card with price, features, and CTA.
 *
 * - Current plan: shows "Your current plan" label instead of a CTA button.
 * - Pro (unpaid user): dark forest green border + "Most popular" badge.
 * - Pro card shows the SMS add-on note below the CTA.
 *
 * @param props - planKey and currentPlan.
 * @returns A plan card JSX element.
 */
function PlanCard({ planKey, currentPlan }: PlanCardProps) {
  const name     = PLAN_NAMES[planKey];
  const tagline  = PLAN_TAGLINES[planKey];
  const features = PLAN_FEATURES[planKey];
  const price    = PLAN_PRICES[planKey];

  const isCurrent  = normalizePlan(currentPlan) === planKey;
  // Highlight Pro as "Most popular" when the user has not yet paid.
  const highlighted = planKey === 'pro' && !isPaidPlan(currentPlan);

  return (
    <div className="relative">

      {/* Badge — shown for current plan or most popular */}
      {(isCurrent || highlighted) && (
        <div className="absolute -top-3.5 inset-x-0 flex justify-center z-10">
          <span
            className={[
              'rounded-full px-3 py-1 text-xs font-semibold text-white',
              highlighted ? 'bg-[#1B4332]' : 'bg-[#1A1A1A]',
            ].join(' ')}
          >
            {isCurrent ? 'Current plan' : 'Most popular'}
          </span>
        </div>
      )}

      <Card
        className={[
          'flex flex-col h-full rounded-2xl border shadow-none hover:-translate-y-1 hover:shadow-lg transition-all duration-200',
          isCurrent    ? 'border-[#1A1A1A]'      :
          highlighted  ? 'border-[#1B4332]/40'   :
                         'border-[#C8C8C8]/40',
        ].join(' ')}
      >
        <CardHeader className="px-7 pt-7 pb-5">
          <h2 className="font-heading text-2xl font-semibold text-[#1A1A1A]">
            {name}
          </h2>
          <p className="text-sm text-[#8A8680] mt-1">
            {tagline}
          </p>

          {/* Price */}
          <div className="mt-5 flex items-baseline gap-1">
            <span className="font-heading text-4xl font-bold text-[#1A1A1A]">
              ${price}
            </span>
            <span className="text-sm text-[#C8C8C8]">/month</span>
          </div>
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
                  className={`mt-0.5 h-4 w-4 shrink-0 ${highlighted ? 'text-[#1B4332]' : 'text-[#1A1A1A]'}`}
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

          {/* SMS add-on note — shown only on the Pro card */}
          {planKey === 'pro' && (
            <p className="mt-4 text-center text-xs text-[#8A8680]">
              Need more SMS? Add {SMS_ADDON_AMOUNT} SMS for ${SMS_ADDON_PRICE}/month.{' '}
              <a
                href="mailto:noshowly@gmail.com"
                className="underline hover:text-[#1A1A1A] transition-colors"
              >
                Contact us.
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
 * Two-card pricing layout: Basic and Pro.
 * Business is intentionally hidden from public UI.
 *
 * @param props - currentPlan from the server component.
 * @returns The full pricing section JSX.
 */
export default function PricingTabs({ currentPlan }: PricingTabsProps) {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 max-w-2xl mx-auto">
      {PLAN_KEYS.map((key) => (
        <PlanCard key={key} planKey={key} currentPlan={currentPlan} />
      ))}
    </div>
  );
}
