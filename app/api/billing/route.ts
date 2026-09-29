/**
 * app/api/billing/route.ts
 *
 * GET /api/billing — the signed-in owner's plan and subscription, for the
 * Billing section in Settings (and its email confirmation toggle).
 *
 * Answers with the entitlements from lib/entitlements.ts, without the
 * internal email caps, and, when the owner has a Stripe customer, the
 * subscription as Stripe reports it right now (lib/billing/subscriptions.ts
 * pickDisplaySubscription): status, renewal or end date, and whether it is
 * set to cancel at the end of the period. When Stripe cannot be reached the
 * plan is still returned, with billingUnavailable: true.
 *
 * Security:
 *  - The user is verified with requireUser(); the users row is read through
 *    RLS with the owner's own session.
 *  - The Stripe customer id comes from that row, never from the request.
 *
 * @returns 200 BillingOverview (types/index.ts)
 * @returns 401 { error: "Unauthorized" }
 * @returns 404 { error: string }  — users row missing
 * @returns 500 { error: string }  — database error
 */

import { requireUser } from '@/lib/auth';
import { loadEntitlements } from '@/lib/access';
import { isDemoAccount } from '@/lib/demo';
import { planLabel } from '@/lib/entitlements';
import { listCustomerSubscriptions } from '@/lib/billing/server';
import { pickDisplaySubscription, toBillingSubscription } from '@/lib/billing/subscriptions';
import type { BillingOverview, BillingSubscription } from '@/types';

/**
 * Returns the owner's plan, trial and subscription.
 */
export async function GET(): Promise<Response> {
  // Step 1: Verify the user.
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  // Step 2: Plan, trial end and Stripe customer.
  const loaded = await loadEntitlements(supabase, user.id);
  if (!loaded.ok) {
    if (loaded.reason === 'not_found') {
      return Response.json({ error: 'Account not found' }, { status: 404 });
    }
    console.error(`[GET /api/billing] Failed to load the plan of user=${user.id}:`, loaded.message);
    return Response.json({ error: 'Failed to load billing details' }, { status: 500 });
  }
  const { entitlements, stripeCustomerId } = loaded;

  // Step 3: The subscription as Stripe reports it now.
  let subscription: BillingSubscription | null = null;
  let billingUnavailable = false;
  if (stripeCustomerId) {
    try {
      const shown = pickDisplaySubscription(await listCustomerSubscriptions(stripeCustomerId));
      subscription = shown ? toBillingSubscription(shown) : null;
    } catch (err) {
      billingUnavailable = true;
      console.error(
        `[GET /api/billing] Failed to load subscriptions of customer=${stripeCustomerId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const overview: BillingOverview = {
    plan:              entitlements.plan,
    planLabel:         planLabel(entitlements.plan),
    isPaid:            entitlements.isPaid,
    isTrial:           entitlements.isTrial,
    trialEndsAt:       entitlements.trialEndsAt,
    trialDaysLeft:     entitlements.trialDaysLeft,
    trialExpired:      entitlements.trialExpired,
    canWrite:          entitlements.canWrite,
    canSendEmail:      entitlements.canSendEmail,
    isDemo:            isDemoAccount(user.email),
    hasBillingAccount: Boolean(stripeCustomerId),
    subscription,
    billingUnavailable,
  };

  return Response.json(overview, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}
