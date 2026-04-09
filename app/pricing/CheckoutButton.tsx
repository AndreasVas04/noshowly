/**
 * app/pricing/CheckoutButton.tsx
 *
 * Client component: the "Get started" button on each plan card.
 *
 * On click:
 *  1. Calls POST /api/stripe/checkout with the plan name.
 *  2. On success, redirects the browser to the Stripe-hosted Checkout page.
 *  3. On error, shows an inline error message below the button.
 *
 * Extracted as a separate 'use client' component so the parent PricingPage
 * can remain a Server Component (for server-side plan fetching).
 */

'use client';

import { useState } from 'react';

type CheckoutButtonProps = {
  /** The plan name to pass to the checkout API. */
  plan: 'solo' | 'salon' | 'studio';
  /** When true, renders the button in the primary indigo style. */
  highlighted: boolean;
};

/**
 * A button that initiates Stripe Checkout for the given plan.
 *
 * Displays a loading state while the checkout session is being created,
 * and an inline error message if the request fails.
 *
 * @param props - Plan key and visual highlight flag.
 * @returns A checkout CTA button with loading and error states.
 */
export default function CheckoutButton({ plan, highlighted }: CheckoutButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  /**
   * Calls the checkout API and redirects to Stripe on success.
   * Displays an error message on failure.
   */
  async function handleClick() {
    if (loading) return; // Prevent double-clicks while a request is in flight.
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

      // Redirect to Stripe's hosted Checkout page.
      // Using window.location.href (not router.push) because this is an
      // external Stripe URL, not a Next.js route.
      window.location.href = url;

    } catch {
      setError('Connection error. Please check your network and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full">
      <button
        onClick={handleClick}
        disabled={loading}
        className={`
          w-full rounded-xl px-4 py-3 text-sm font-semibold transition-colors
          disabled:cursor-not-allowed disabled:opacity-60
          ${highlighted
            ? 'bg-indigo-600 text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2'
            : 'border border-gray-300 bg-white text-gray-800 hover:border-indigo-400 hover:text-indigo-700'
          }
        `}
      >
        {loading ? 'Setting up…' : 'Get started'}
      </button>

      {/* Inline error — shown below the button if checkout fails. */}
      {error && (
        <p className="mt-2 text-center text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}
