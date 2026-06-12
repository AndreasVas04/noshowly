/**
 * app/pricing/PricingTabs.tsx
 *
 * Client component — single plan card for the pricing page.
 *
 * Only Basic ($19/month) is shown publicly for MVP.
 * Pro and Business are hidden from public UI.
 *
 * Design: Calm Professional palette, Playfair Display headings, shadcn Card.
 */

'use client';

import { Card, CardContent, CardHeader } from '@/components/ui/card';
import CheckoutButton from './CheckoutButton';
import { PLAN_PRICES } from '@/lib/plans';
import type { UserPlan } from '@/lib/plans';

// ---------------------------------------------------------------------------
// Plan configuration
// ---------------------------------------------------------------------------

/** Features shown on the Basic plan card. */
const BASIC_FEATURES: string[] = [
  'Online booking page',
  'Unlimited email reminders',
  'Email YES/NO confirmation buttons',
  'Client management',
  'Appointment management',
  'Flat monthly price',
  'No commissions',
  'No per-booking fees',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Maps legacy plan names to the equivalent public plan key.
 * Used to correctly show the "Current plan" badge for users on legacy plans.
 *
 * @param plan - The user's current plan from the database.
 * @returns The equivalent public plan key string.
 */
function normalizePlan(plan: UserPlan): string {
  if (plan === 'starter')      return 'basic';
  if (plan === 'professional') return 'basic'; // professional maps to basic for badge display
  if (plan === 'pro')          return 'basic'; // pro maps to basic for badge display
  return plan;
}

// ---------------------------------------------------------------------------
// BasicPlanCard
// ---------------------------------------------------------------------------

/** Props for the Basic plan card. */
interface BasicPlanCardProps {
  /** The user's current plan — used to highlight the current plan badge. */
  currentPlan: UserPlan;
}

/**
 * Renders the Basic plan card with price, features, and CTA.
 *
 * - Current plan: shows "Your current plan" label instead of a CTA button.
 * - Unpaid user: shows "Most popular" badge with forest green border.
 *
 * @param props - currentPlan.
 * @returns The Basic plan card JSX element.
 */
function BasicPlanCard({ currentPlan }: BasicPlanCardProps) {
  const isCurrent = normalizePlan(currentPlan) === 'basic';

  return (
    <div className="relative max-w-sm w-full mx-auto">

      {/* Badge — only shown when this is the user's current plan */}
      {isCurrent && (
        <div className="absolute -top-3.5 inset-x-0 flex justify-center z-10">
          <span className="rounded-full px-3 py-1 text-xs font-semibold text-white bg-[#1A1A1A]">
            Current plan
          </span>
        </div>
      )}

      <Card
        className={[
          'flex flex-col rounded-2xl border shadow-none hover:-translate-y-1 hover:shadow-lg transition-all duration-200',
          isCurrent ? 'border-[#1A1A1A]' : 'border-[#1B4332]/40',
        ].join(' ')}
      >
        <CardHeader className="px-7 pt-7 pb-5">
          <h2 className="font-heading text-2xl font-semibold text-[#1A1A1A]">
            Basic
          </h2>
          <p className="text-sm text-[#8A8680] mt-1">
            Simple appointment reminders for small service businesses.
          </p>

          {/* Price */}
          <div className="mt-5 flex items-baseline gap-1">
            <span className="font-heading text-4xl font-bold text-[#1A1A1A]">
              ${PLAN_PRICES.basic}
            </span>
            <span className="text-sm text-[#C8C8C8]">/month</span>
          </div>
        </CardHeader>

        <CardContent className="px-7 pb-7 flex-1 flex flex-col">
          {/* Feature list */}
          <ul className="flex-1 space-y-3 mb-8">
            {BASIC_FEATURES.map((feature) => (
              <li
                key={feature}
                className="flex items-start gap-2.5 text-sm text-[#2D2D2D]"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="mt-0.5 h-4 w-4 shrink-0 text-[#1B4332]"
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
            <CheckoutButton plan="basic" highlighted={true} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PricingTabs (main export)
// ---------------------------------------------------------------------------

/** Props passed from the server component pricing page. */
interface PricingTabsProps {
  /** The authenticated user's current plan — used to highlight the current plan. */
  currentPlan: UserPlan;
}

/**
 * Single-plan pricing layout: Basic only.
 * Pro and Business are hidden from public UI.
 *
 * @param props - currentPlan from the server component.
 * @returns The pricing section JSX.
 */
export default function PricingTabs({ currentPlan }: PricingTabsProps) {
  return (
    <div className="flex justify-center">
      <BasicPlanCard currentPlan={currentPlan} />
    </div>
  );
}
