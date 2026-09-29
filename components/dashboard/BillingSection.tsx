/**
 * components/dashboard/BillingSection.tsx
 *
 * The Billing section of the Settings page: the current plan, when the free
 * trial ends (or ended) or when the subscription renews or ends, and the
 * actions that fit: "Upgrade" (→ /pricing) without a paid plan, "Manage
 * billing" (Stripe customer portal) once the owner has a billing account.
 *
 * Data comes from GET /api/billing (BillingOverview), loaded by the Settings
 * page. The internal email caps are never shown.
 */

'use client';

import Link from 'next/link';
import ManageBillingButton from '@/components/billing/ManageBillingButton';
import type { BillingOverview } from '@/types';

type Tone = 'neutral' | 'warning' | 'danger';

type BillingSectionProps = {
  /** From GET /api/billing, or null when it could not be loaded. */
  billing: BillingOverview | null;
};

/**
 * Formats an ISO timestamp as a date in the browser's locale, e.g. "7 October 2026".
 *
 * @param iso - ISO timestamp.
 */
function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Describes the plan's state in one or two sentences.
 *
 * @param billing - The owner's billing overview.
 */
function describeBilling(billing: BillingOverview): { text: string; tone: Tone } | null {
  const subscription = billing.subscription;

  if (billing.isTrial) {
    const ends = formatDate(billing.trialEndsAt);
    if (billing.trialExpired) {
      return {
        text: `Your free trial ended${ends ? ` on ${ends}` : ''}. Your data is kept, but your account is read-only until you upgrade.`,
        tone: 'danger',
      };
    }
    const days = billing.trialDaysLeft ?? 0;
    return {
      text: `Your free trial ends${ends ? ` on ${ends}` : ' soon'} (${days} ${days === 1 ? 'day' : 'days'} left). Upgrade any time to keep using Noshowly after that.`,
      tone: 'neutral',
    };
  }

  if (!billing.isPaid) {
    if (subscription && subscription.status === 'unpaid') {
      return {
        text: 'Your subscription is inactive because a payment failed. Update your payment method in Manage billing, or upgrade again.',
        tone: 'danger',
      };
    }
    return {
      text: 'Your subscription is inactive. Your data is kept, but your account is read-only until you upgrade.',
      tone: 'danger',
    };
  }

  if (billing.billingUnavailable) {
    return { text: 'Subscription details are not available right now. Please try again later.', tone: 'neutral' };
  }
  if (!subscription) return null;

  if (subscription.status === 'past_due') {
    return {
      text: 'Your last payment failed. Update your payment method in Manage billing to keep your plan.',
      tone: 'warning',
    };
  }

  const ends = formatDate(subscription.cancelAt ?? (subscription.cancelAtPeriodEnd ? subscription.currentPeriodEnd : null));
  if (subscription.cancelAtPeriodEnd || subscription.cancelAt) {
    return {
      text: `Your subscription is cancelled and ends${ends ? ` on ${ends}` : ' at the end of the billing period'}. You can renew it in Manage billing.`,
      tone: 'warning',
    };
  }

  const renews = formatDate(subscription.currentPeriodEnd);
  return renews ? { text: `Renews on ${renews}.`, tone: 'neutral' } : null;
}

/** Text colour for each tone. */
const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'text-[#8A8680]',
  warning: 'text-amber-700',
  danger:  'text-red-700',
};

/**
 * Renders the Billing section.
 *
 * @param props - The owner's billing overview.
 * @returns The section JSX.
 */
export default function BillingSection({ billing }: BillingSectionProps) {
  const description = billing ? describeBilling(billing) : null;

  return (
    <section id="billing">
      <h2 className="font-heading text-base font-semibold text-[#1A1A1A] mb-1">Billing</h2>
      <p className="text-sm text-[#8A8680] mb-4 font-body">
        Your plan, trial and subscription.
      </p>

      <div className="bg-white rounded-2xl border border-[#E5E2DB] p-6">
        {!billing ? (
          <p role="alert" className="text-sm text-red-700">
            Billing details could not be loaded. Please refresh the page.
          </p>
        ) : (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-medium text-[#8A8680] uppercase tracking-widest font-body">
                Current plan
              </p>
              <p className="mt-1 text-lg font-semibold text-[#1A1A1A]">{billing.planLabel}</p>
              {billing.isDemo ? (
                <p className="mt-1 text-sm text-[#8A8680] font-body">
                  Billing is not available for the demo account.
                </p>
              ) : description && (
                <p className={`mt-1 text-sm font-body ${TONE_CLASSES[description.tone]}`}>
                  {description.text}
                </p>
              )}
            </div>

            {!billing.isDemo && (
              <div className="flex flex-wrap items-start gap-3 shrink-0">
                {!billing.isPaid && (
                  <Link
                    href="/pricing"
                    className="inline-flex h-8 items-center rounded-lg bg-[#1B4332] px-4 text-sm font-medium text-white hover:bg-[#16392A] transition-colors"
                  >
                    Upgrade
                  </Link>
                )}
                {billing.hasBillingAccount && <ManageBillingButton />}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
