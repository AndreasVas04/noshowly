/**
 * components/billing/ManageBillingButton.tsx
 *
 * Client component: the "Manage billing" button. Opens the Stripe customer
 * portal (POST /api/stripe/portal), where the owner updates their card, sees
 * invoices and cancels their subscription. Used by the Billing section in
 * Settings and by the pricing page when a subscription already exists.
 *
 * Shows a loading state while the portal session is created and the error
 * message inline when it cannot be opened.
 */

'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

type ManageBillingButtonProps = {
  /** Button text. */
  label?: string;
  /** Extra classes for the button. */
  className?: string;
};

/**
 * Opens the Stripe customer portal in the current tab.
 *
 * @param props - Optional label and classes.
 * @returns The button with its inline error message.
 */
export default function ManageBillingButton({ label = 'Manage billing', className = '' }: ManageBillingButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Creates a portal session and redirects to it. */
  async function handleClick(): Promise<void> {
    if (loading) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };

      if (!res.ok || !data.url) {
        setError(data.error ?? 'Billing management is not available right now. Please try again.');
        setLoading(false);
        return;
      }

      // Keep the loading state until the browser leaves the page.
      window.location.href = data.url;
    } catch {
      setError('Connection error. Please check your network and try again.');
      setLoading(false);
    }
  }

  return (
    <div>
      <Button
        type="button"
        variant="outline"
        onClick={() => { void handleClick(); }}
        disabled={loading}
        className={`border-[#C8C8C8] text-[#1A1A1A] hover:border-[#1A1A1A] text-sm ${className}`}
      >
        {loading ? 'Opening…' : label}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}
