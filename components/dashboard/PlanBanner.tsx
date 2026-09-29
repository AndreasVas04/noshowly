/**
 * components/dashboard/PlanBanner.tsx
 *
 * Client component: the plan banner at the top of every dashboard page, on
 * mobile and desktop.
 *  - Free trial running: how many days are left, with an "Upgrade" link.
 *  - Trial ended / subscription inactive: the account is read-only, with an
 *    "Upgrade" link to /pricing.
 *  - Paid plans: nothing.
 *
 * It also finishes a checkout: Stripe sends the owner back to
 * /dashboard?checkout=success&session_id=…, and the banner then calls
 * POST /api/stripe/sync with the session id, shows "Confirming your
 * payment…" instead of the trial state, removes the query string and
 * refreshes the server components (the layout reads the new plan). The
 * webhook would update the plan anyway; this only avoids the wait.
 *
 * The state is computed on the server by app/dashboard/layout.tsx from
 * lib/entitlements.ts.
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

/** What the banner shows, decided by the dashboard layout. */
export type PlanBannerState =
  | { kind: 'none' }
  | { kind: 'trial'; daysLeft: number }
  | { kind: 'trial_ended' }
  | { kind: 'inactive' }
  /** The account's rows could not be created (app/dashboard/layout.tsx). */
  | { kind: 'setup_failed' };

/** Progress of the sync after returning from Stripe Checkout. */
type CheckoutState = 'idle' | 'confirming' | 'active' | 'processing' | 'failed';

type PlanBannerProps = {
  state: PlanBannerState;
};

/** Visual style of a banner. */
type Tone = 'info' | 'success' | 'warning';

const TONE_CLASSES: Record<Tone, string> = {
  info:    'bg-[#E8F2EC] border-[#1B4332]/15 text-[#1B4332]',
  success: 'bg-emerald-50 border-emerald-200 text-emerald-900',
  warning: 'bg-amber-50 border-amber-200 text-amber-900',
};

/**
 * Renders the plan banner, or nothing for paid plans.
 *
 * @param props - The banner state from the layout.
 */
export default function PlanBanner({ state }: PlanBannerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  /** The Checkout session the owner has just returned from, if any. */
  const checkoutSessionId =
    searchParams.get('checkout') === 'success' ? searchParams.get('session_id') : null;
  /** Result of the sync, once it has finished. */
  const [syncResult, setSyncResult] = useState<CheckoutState | null>(null);
  const checkout: CheckoutState = syncResult ?? (checkoutSessionId ? 'confirming' : 'idle');

  // After Stripe Checkout: sync the plan now instead of waiting for the webhook.
  useEffect(() => {
    if (!checkoutSessionId) return;
    let cancelled = false;

    async function syncCheckout(id: string): Promise<void> {
      let next: CheckoutState = 'failed';
      try {
        const res = await fetch('/api/stripe/sync', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ session_id: id }),
        });
        const data = (await res.json().catch(() => ({}))) as { isPaid?: boolean };
        next = res.ok ? (data.isPaid ? 'active' : 'processing') : 'failed';
      } catch {
        next = 'failed';
      }
      if (cancelled) return;
      setSyncResult(next);
      // Drop the query string and re-render the server components with the new plan.
      router.replace(window.location.pathname);
      router.refresh();
    }

    void syncCheckout(checkoutSessionId);
    return () => { cancelled = true; };
  }, [router, checkoutSessionId]);

  // Checkout messages take the place of the trial banner.
  if (checkout !== 'idle') {
    const message: Record<Exclude<CheckoutState, 'idle'>, { text: string; tone: Tone }> = {
      confirming: { text: 'Confirming your payment…', tone: 'info' },
      active:     { text: 'Thank you! Your subscription is active.', tone: 'success' },
      processing: { text: 'Thank you! Your payment is being processed. Your plan updates as soon as it is confirmed.', tone: 'info' },
      failed:     { text: 'Thank you! We could not confirm your payment yet. It can take a minute, so please refresh the page shortly.', tone: 'info' },
    };
    return <Banner {...message[checkout]} />;
  }

  switch (state.kind) {
    case 'trial':
      return (
        <Banner
          tone="info"
          text={`Free trial: ${state.daysLeft} ${state.daysLeft === 1 ? 'day' : 'days'} left.`}
          upgrade
        />
      );
    case 'trial_ended':
      return (
        <Banner
          tone="warning"
          text="Your free trial has ended. Your data is safe, but changes, online bookings and email reminders are paused until you upgrade."
          upgrade
        />
      );
    case 'inactive':
      return (
        <Banner
          tone="warning"
          text="Your subscription is inactive. Your data is safe, but changes, online bookings and email reminders are paused until you upgrade."
          upgrade
        />
      );
    case 'setup_failed':
      return (
        <Banner
          tone="warning"
          text="We could not finish setting up your account. Please reload the page, or contact support if this keeps happening."
        />
      );
    default:
      return null;
  }
}

/**
 * One banner row.
 *
 * @param text    - Message.
 * @param tone    - Colour scheme.
 * @param upgrade - Show the "Upgrade" link to /pricing.
 */
function Banner({ text, tone, upgrade = false }: { text: string; tone: Tone; upgrade?: boolean }) {
  return (
    <div
      role="status"
      className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-6 py-3 lg:px-10 ${TONE_CLASSES[tone]}`}
    >
      <p className="text-sm font-body">{text}</p>
      {upgrade && (
        <Link
          href="/pricing"
          className="inline-flex h-8 items-center rounded-lg bg-[#1B4332] px-4 text-sm font-medium text-white hover:bg-[#16392A] transition-colors"
        >
          Upgrade
        </Link>
      )}
    </div>
  );
}
