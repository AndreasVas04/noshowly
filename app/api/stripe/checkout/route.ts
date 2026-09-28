/**
 * app/api/stripe/checkout/route.ts
 *
 * POST /api/stripe/checkout
 *
 * Creates a Stripe Checkout session for a Noshowly subscription.
 *
 * Flow:
 *  1. Verify the user with Supabase Auth — 401 if not authenticated. The
 *     public demo account cannot buy a plan (403): anyone can sign in to it.
 *  2. Validate the requested plan ('basic' is the only public plan).
 *  3. Check the configuration: the plan's price id and NEXT_PUBLIC_APP_URL.
 *  4. Load the user's plan and Stripe customer.
 *  5. Refuse a second subscription (409): when the customer already has an
 *     active, trialing or past_due subscription, or the account already has
 *     a paid plan. The owner uses Manage billing (the Stripe portal) instead.
 *  6. Create the Stripe customer when there is none, with the idempotency key
 *     `customer-<userId>` so concurrent requests get the same customer, and
 *     store it only while users.stripe_customer_id is empty, then read it
 *     back. The request fails when the link cannot be stored: a customer is
 *     never used without being linked to its user.
 *  7. Create the Checkout session. client_reference_id and metadata carry the
 *     user id, so the webhook can find the user even before the customer is
 *     linked, and success_url brings the session id back to the dashboard,
 *     which syncs the plan straight away (POST /api/stripe/sync).
 *
 * Security:
 *  - Auth required: users can only create sessions for their own account.
 *  - Plan name is validated against the whitelist — no arbitrary price IDs accepted.
 *  - The Stripe customer comes from the authenticated user's row — never from
 *    the client.
 *  - STRIPE_SECRET_KEY is server-only; never returned in the response.
 *
 * @param request - POST body: { plan: PaidPlan } ('basic' is the only accepted value for MVP)
 * @returns 200 { url: string }            — Stripe Checkout URL; redirect the user here.
 * @returns 400 { error: string }          — invalid or missing plan
 * @returns 401 { error: string }          — not authenticated
 * @returns 403 { error: string }          — demo account
 * @returns 404 { error: string }          — users row not found
 * @returns 409 { error: string, code }    — subscription_exists | already_paid
 * @returns 500 { error: string }          — configuration or database error
 * @returns 502 { error: string }          — Stripe error
 */

import { requireUser } from '@/lib/auth';
import { isDemoAccount } from '@/lib/demo';
import { stripe } from '@/lib/stripe';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { getEntitlements } from '@/lib/entitlements';
import { resolveAppUrl } from '@/lib/reminders/links';
import { decideCheckout, type SubscriptionSnapshot } from '@/lib/billing/subscriptions';
import { linkStripeCustomer, listCustomerSubscriptions } from '@/lib/billing/server';
import type { PaidPlan } from '@/lib/plans';

// ---------------------------------------------------------------------------
// Plan → Stripe price ID mapping
// ---------------------------------------------------------------------------

/**
 * Public paid plan names accepted at the checkout boundary.
 * Aliased from PaidPlan for clarity.
 *
 * Pro and Business are intentionally excluded — they are internal/future only
 * and must not be purchasable via the public checkout flow.
 */
type CheckoutPlan = PaidPlan;

/**
 * Exhaustive list of valid checkout plan names — used for input validation.
 * Only 'basic' is accepted publicly for MVP. Any other value is rejected with a 400 error.
 */
const VALID_PLANS: CheckoutPlan[] = ['basic'];

/** 409 answers, shown on the pricing page next to a "Manage billing" button. */
const CONFLICT_MESSAGES = {
  subscription_exists: 'You already have a subscription. Use Manage billing to change or cancel it.',
  already_paid: 'Your account already has an active plan.',
} as const;

/**
 * Maps a Noshowly public plan name to its Stripe price ID from environment variables.
 *
 * Env var convention: plan 'basic' → STRIPE_BASIC_PRICE_ID.
 *
 * @param plan - The validated plan name chosen by the user ('basic').
 * @returns The Stripe price ID, or null when the env var is not set.
 */
function getPriceId(plan: CheckoutPlan): string | null {
  return process.env[`STRIPE_${plan.toUpperCase()}_PRICE_ID`]?.trim() || null;
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

/**
 * Handles a subscription checkout request.
 *
 * @param request - Incoming POST with JSON body { plan: string }.
 * @returns JSON response with a Stripe Checkout URL or an error.
 */
export async function POST(request: Request): Promise<Response> {
  // Step 1: Verify the user with Supabase Auth. The user ID is used with the
  // service-role client below, so it must come from a verified token.
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const authUser = auth.user;
  const userId = authUser.id;

  if (isDemoAccount(authUser.email)) {
    return Response.json({ error: 'Billing is not available for the demo account.' }, { status: 403 });
  }

  // Step 2: Parse and validate the plan name.
  let body: { plan?: unknown };
  try {
    body = (await request.json()) as { plan?: unknown };
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const plan = body?.plan;
  if (typeof plan !== 'string' || !VALID_PLANS.includes(plan as CheckoutPlan)) {
    return Response.json(
      { error: `Invalid plan. Must be one of: ${VALID_PLANS.join(', ')}` },
      { status: 400 }
    );
  }
  const validPlan = plan as CheckoutPlan;

  // Step 3: Configuration — checked before anything is created in Stripe.
  const priceId = getPriceId(validPlan);
  if (!priceId) {
    console.error(`[stripe/checkout] CONFIG ERROR — STRIPE_${validPlan.toUpperCase()}_PRICE_ID is not set`);
    return Response.json({ error: 'Plan billing not configured' }, { status: 500 });
  }
  const appUrl = resolveAppUrl(process.env.NEXT_PUBLIC_APP_URL);
  if (!appUrl.ok) {
    console.error(`[stripe/checkout] CONFIG ERROR — NEXT_PUBLIC_APP_URL is missing or invalid (${appUrl.error})`);
    return Response.json({ error: 'Billing is not configured' }, { status: 500 });
  }

  // Step 4: Load the user's plan and Stripe customer.
  const db = createAdminSupabaseClient();
  const { data: account, error: accountError } = await db
    .from('users')
    .select('plan, trial_ends_at, stripe_customer_id')
    .eq('id', userId)
    .maybeSingle();

  if (accountError) {
    console.error('[stripe/checkout] Failed to load user record:', accountError.message);
    return Response.json({ error: 'Failed to load your account' }, { status: 500 });
  }
  if (!account) {
    return Response.json({ error: 'User record not found' }, { status: 404 });
  }
  const entitlements = getEntitlements(account, new Date());

  // Step 5: Never create a second subscription.
  let customerId = account.stripe_customer_id;
  let subscriptions: SubscriptionSnapshot[] = [];
  if (customerId) {
    try {
      subscriptions = await listCustomerSubscriptions(customerId);
    } catch (err) {
      console.error(`[stripe/checkout] Failed to list subscriptions of customer=${customerId}:`, errorMessage(err));
      return Response.json({ error: 'Could not reach the billing provider. Please try again.' }, { status: 502 });
    }
  }
  const decision = decideCheckout({ isPaid: entitlements.isPaid, subscriptions });
  if (!decision.allowed) {
    return Response.json({ error: CONFLICT_MESSAGES[decision.reason], code: decision.reason }, { status: 409 });
  }

  // Step 6: Create and link the Stripe customer when there is none.
  if (!customerId) {
    let createdId: string;
    try {
      const customer = await stripe.customers.create(
        {
          email: authUser.email ?? undefined,
          // Lets the webhook find the user even if the link below is lost.
          metadata: { user_id: userId },
        },
        // Concurrent requests (double clicks, two tabs) get the same customer.
        { idempotencyKey: `customer-${userId}` },
      );
      createdId = customer.id;
    } catch (err) {
      console.error('[stripe/checkout] Failed to create Stripe customer:', errorMessage(err));
      return Response.json({ error: 'Failed to set up billing account' }, { status: 502 });
    }

    try {
      customerId = await linkStripeCustomer(db, userId, createdId);
    } catch (err) {
      console.error('[stripe/checkout] Failed to store stripe_customer_id:', errorMessage(err));
      return Response.json({ error: 'Failed to set up billing account' }, { status: 500 });
    }
    if (!customerId) {
      console.error(`[stripe/checkout] stripe_customer_id could not be stored for user=${userId} (customer=${createdId})`);
      return Response.json({ error: 'Failed to set up billing account' }, { status: 500 });
    }

    // Another customer was linked meanwhile: check that one for a subscription too.
    if (customerId !== createdId) {
      console.warn(`[stripe/checkout] user=${userId} already linked to customer=${customerId}; using it instead of ${createdId}`);
      try {
        const linkedDecision = decideCheckout({
          isPaid: entitlements.isPaid,
          subscriptions: await listCustomerSubscriptions(customerId),
        });
        if (!linkedDecision.allowed) {
          return Response.json(
            { error: CONFLICT_MESSAGES[linkedDecision.reason], code: linkedDecision.reason },
            { status: 409 },
          );
        }
      } catch (err) {
        console.error(`[stripe/checkout] Failed to list subscriptions of customer=${customerId}:`, errorMessage(err));
        return Response.json({ error: 'Could not reach the billing provider. Please try again.' }, { status: 502 });
      }
    }
  }

  // Step 7: Create the Stripe Checkout session.
  try {
    const checkoutSession = await stripe.checkout.sessions.create({
      customer:            customerId,
      mode:                'subscription',
      line_items:          [{ price: priceId, quantity: 1 }],
      // Maps the checkout back to the user (checkout.session.completed and POST /api/stripe/sync).
      client_reference_id: userId,
      metadata:            { user_id: userId, plan: validPlan },
      // Maps every subscription event back to the user, whatever else is lost.
      subscription_data:   { metadata: { user_id: userId } },
      // The dashboard syncs the plan with this session id straight away.
      success_url:         `${appUrl.url}/dashboard?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      // On cancel: return to pricing page so the user can pick again.
      cancel_url:          `${appUrl.url}/pricing`,
      customer_update:     { address: 'auto' },
      allow_promotion_codes: true,
    });

    if (!checkoutSession.url) {
      console.error('[stripe/checkout] Stripe returned a session with no URL');
      return Response.json({ error: 'Checkout session creation failed' }, { status: 502 });
    }

    console.log(
      `[stripe/checkout] Created session for user=${userId} plan=${validPlan} customer=${customerId}`
    );
    return Response.json({ url: checkoutSession.url }, { status: 200 });

  } catch (err) {
    console.error('[stripe/checkout] Stripe session creation failed:', errorMessage(err));
    return Response.json({ error: 'Failed to create checkout session' }, { status: 502 });
  }
}

/** Message of an unknown error value. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
