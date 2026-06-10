/**
 * app/pricing/CheckoutButton.tsx
 *
 * Client component: the "Get started" CTA on each plan card.
 *
 * On click:
 *  1. Calls POST /api/stripe/checkout with the plan name.
 *  2. On success, redirects to Stripe Checkout.
 *  3. On error, shows an inline error message below the button.
 *
 * Premium design: brand-dark primary button, clean hover states.
 */

'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { PaidPlan } from '@/lib/plans';

type CheckoutButtonProps = {
  /** The plan name to pass to the checkout API. One of the 9 paid plan keys. */
  plan: PaidPlan;
  /** When true, renders the button in the primary brand-dark style. */
  highlighted: boolean;
};

/**
 * Initiates Stripe Checkout for the given plan.
 * Displays loading and error states inline.
 *
 * @param props - Plan key and visual highlight flag.
 * @returns A checkout CTA button with loading and error states.
 */
export default function CheckoutButton({ plan, highlighted }: CheckoutButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Calls the checkout API and redirects to Stripe on success.
   */
  async function handleClick() {
    if (loading) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/stripe/checkout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ plan }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? 'Something went wrong. Please try again.');
        return;
      }

      const { url } = (await res.json()) as { url: string };
      window.location.href = url;
    } catch {
      setError('Connection error. Please check your network and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full">
      <Button
        onClick={handleClick}
        disabled={loading}
        className={`
          w-full rounded-xl px-4 py-3 text-sm font-semibold h-auto transition-colors
          ${highlighted
            ? 'bg-[#1B4332] hover:bg-[#16392A] text-white'
            : 'bg-transparent border border-[#C8C8C8] text-[#1A1A1A] hover:border-[#1A1A1A] hover:bg-[#1A1A1A]/5'
          }
        `}
      >
        {loading ? 'Setting up…' : 'Get started'}
      </Button>

      {error && (
        <p className="mt-2 text-center text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}
