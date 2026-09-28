/**
 * app/api/stripe/portal/route.ts
 *
 * POST /api/stripe/portal
 *
 * Opens the Stripe customer portal ("Manage billing"), where the owner can
 * update their card, see invoices and cancel their subscription. Cancelling
 * there sends the webhook events that update users.plan.
 *
 * Flow:
 *  1. Verify the user (requireUser). The public demo account has no billing (403).
 *  2. Load the user's Stripe customer; without one there is nothing to manage (404).
 *  3. Create a portal session that returns to /dashboard/settings.
 *  4. Answer { url }; the browser redirects there.
 *
 * The portal must be configured once in the Stripe dashboard
 * (Settings → Billing → Customer portal), in test and in live mode.
 *
 * @returns 200 { url: string }  — Stripe portal URL
 * @returns 401 { error }        — not authenticated
 * @returns 403 { error }        — demo account
 * @returns 404 { error }        — no billing account yet
 * @returns 500 { error }        — configuration or database error
 * @returns 502 { error }        — Stripe error
 */

import { requireUser } from '@/lib/auth';
import { isDemoAccount } from '@/lib/demo';
import { stripe } from '@/lib/stripe';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { resolveAppUrl } from '@/lib/reminders/links';
import { isMissingStripeResource } from '@/lib/billing/server';

/** Shown when the account has never been through checkout. */
const NO_BILLING_ACCOUNT = 'You have no billing account yet. Choose a plan to subscribe.';

/**
 * Creates a Stripe customer portal session for the signed-in owner.
 */
export async function POST(): Promise<Response> {
  // Step 1: Verify the user.
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;

  if (isDemoAccount(auth.user.email)) {
    return Response.json({ error: 'Billing is not available for the demo account.' }, { status: 403 });
  }

  const appUrl = resolveAppUrl(process.env.NEXT_PUBLIC_APP_URL);
  if (!appUrl.ok) {
    console.error(`[stripe/portal] CONFIG ERROR — NEXT_PUBLIC_APP_URL is missing or invalid (${appUrl.error})`);
    return Response.json({ error: 'Billing is not configured' }, { status: 500 });
  }

  // Step 2: The user's Stripe customer.
  const { data: account, error } = await createAdminSupabaseClient()
    .from('users')
    .select('stripe_customer_id')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.error('[stripe/portal] Failed to load user record:', error.message);
    return Response.json({ error: 'Failed to load your account' }, { status: 500 });
  }
  const customerId = account?.stripe_customer_id;
  if (!customerId) {
    return Response.json({ error: NO_BILLING_ACCOUNT }, { status: 404 });
  }

  // Step 3: Portal session, returning to Settings.
  try {
    const portal = await stripe.billingPortal.sessions.create({
      customer:   customerId,
      return_url: `${appUrl.url}/dashboard/settings`,
    });
    return Response.json({ url: portal.url }, { status: 200 });
  } catch (err) {
    if (isMissingStripeResource(err)) {
      console.warn(`[stripe/portal] customer=${customerId} of user=${userId} does not exist in Stripe`);
      return Response.json({ error: NO_BILLING_ACCOUNT }, { status: 404 });
    }
    // Also the error Stripe returns while the portal is not configured.
    console.error('[stripe/portal] Failed to create portal session:', err instanceof Error ? err.message : err);
    return Response.json(
      { error: 'Billing management is not available right now. Please try again later.' },
      { status: 502 }
    );
  }
}
