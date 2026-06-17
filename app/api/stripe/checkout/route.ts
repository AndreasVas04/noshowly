/**
 * app/api/stripe/checkout/route.ts
 *
 * POST /api/stripe/checkout
 *
 * Creates a Stripe Checkout session for a NoShowly subscription plan.
 *
 * Flow:
 *  1. Verify authentication — 401 if no session.
 *  2. Validate the requested plan name (solo | salon | studio).
 *  3. Resolve or create a Stripe Customer for this user.
 *     - If the user already has a stripe_customer_id, reuse it.
 *     - Otherwise create a new Stripe Customer and store the ID.
 *  4. Create a Stripe Checkout session in subscription mode with the
 *     correct price ID for the requested plan.
 *  5. Return { url } — the frontend redirects the user to this URL.
 *
 * Security:
 *  - Auth required: users can only create sessions for their own account.
 *  - Plan name is validated against the whitelist — no arbitrary price IDs accepted.
 *  - Stripe customer ID is tied to the authenticated user's DB record — not
 *    accepted from the client.
 *  - STRIPE_SECRET_KEY is server-only; never returned in the response.
 *
 * @param request - POST body: { plan: PaidPlan } ('basic' is the only accepted value for MVP)
 * @returns 200 { url: string }     — Stripe Checkout URL; redirect the user here.
 * @returns 400 { error: string }   — Invalid or missing plan.
 * @returns 401 { error: string }   — Not authenticated.
 * @returns 404 { error: string }   — Salon record not found.
 * @returns 500 { error: string }   — Stripe or DB error.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { stripe } from '@/lib/stripe';
import type { Database } from '@/types';
import type { PaidPlan } from '@/lib/plans';

// ---------------------------------------------------------------------------
// Service-role client — needed to write stripe_customer_id back to the user row.
// The anon client honours RLS and cannot update arbitrary user rows.
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
if (!SERVICE_ROLE_KEY) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');

const adminSupabase = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY);

// ---------------------------------------------------------------------------
// Plan → Stripe price ID mapping
// ---------------------------------------------------------------------------

/**
 * Public paid plan names accepted at the checkout boundary.
 * Aliased from PaidPlan for clarity.
 *
 * Business is intentionally excluded — it is internal/future only and must
 * not be purchasable via the public checkout flow.
 */
type CheckoutPlan = PaidPlan;

/**
 * Exhaustive list of valid checkout plan names — used for input validation.
 * Only 'basic' is accepted publicly for MVP. Pro and Business are internal only.
 * Any other value is rejected with a 400 error.
 */
const VALID_PLANS: CheckoutPlan[] = ['basic'];

/**
 * Maps a Noshowly public plan name to its Stripe price ID from environment variables.
 *
 * Env var convention: plan 'basic' → STRIPE_BASIC_PRICE_ID, 'pro' → STRIPE_PRO_PRICE_ID.
 * Plan name is uppercased to derive the env var key.
 *
 * Required env vars: STRIPE_BASIC_PRICE_ID.
 *
 * @param plan - The validated plan name chosen by the user ('basic').
 * @returns The Stripe price ID for the plan.
 * @throws If the corresponding env var is not configured.
 */
function getPriceId(plan: CheckoutPlan): string {
  // 'basic' → 'STRIPE_BASIC_PRICE_ID', 'pro' → 'STRIPE_PRO_PRICE_ID'
  const envKey = `STRIPE_${plan.toUpperCase()}_PRICE_ID`;
  const priceId = process.env[envKey];
  if (!priceId) {
    throw new Error(`Missing Stripe price ID env var: ${envKey}`);
  }
  return priceId;
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
  // Step 1: Verify authentication.
  const supabase = await createServerSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;

  // Step 2: Parse and validate the plan name.
  let body: { plan?: unknown };
  try {
    body = (await request.json()) as { plan?: unknown };
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const plan = body.plan;

  // Validate that the plan is one of the accepted values — never use arbitrary input.
  if (typeof plan !== 'string' || !VALID_PLANS.includes(plan as CheckoutPlan)) {
    return Response.json(
      { error: `Invalid plan. Must be one of: ${VALID_PLANS.join(', ')}` },
      { status: 400 }
    );
  }

  const validPlan = plan as CheckoutPlan;

  // Step 3: Load the user record to get/set stripe_customer_id.
  const { data: user, error: userError } = await adminSupabase
    .from('users')
    .select('stripe_customer_id, plan')
    .eq('id', userId)
    .single();

  if (userError || !user) {
    console.error('[stripe/checkout] Failed to load user record:', userError?.message);
    return Response.json({ error: 'User record not found' }, { status: 404 });
  }

  // Step 3b: Block duplicate subscriptions — user already has an active paid plan.
  const ACTIVE_PAID_PLANS = ['basic', 'pro', 'business', 'starter', 'professional'];
  if (user.plan && ACTIVE_PAID_PLANS.includes(user.plan as string)) {
    return Response.json(
      { error: 'You already have an active subscription. Manage it from Settings.' },
      { status: 400 }
    );
  }

  // Step 4: Resolve the Stripe Customer ID.
  // Reuse an existing customer so subscription history is preserved on upgrades.
  let stripeCustomerId = user.stripe_customer_id;

  if (!stripeCustomerId) {
    // Create a new Stripe Customer and store the ID in the DB.
    try {
      const customer = await stripe.customers.create({
        email: session.user.email,
        metadata: {
          // Store the Noshowly user ID so webhook handlers can look up the user
          // even if the stripe_customer_id column is not yet populated.
          user_id: userId,
        },
      });

      stripeCustomerId = customer.id;

      // Persist the customer ID so future checkouts and webhook events can
      // match back to this user without creating duplicate Stripe customers.
      const { error: updateError } = await adminSupabase
        .from('users')
        .update({ stripe_customer_id: stripeCustomerId })
        .eq('id', userId);

      if (updateError) {
        // Non-fatal: the session will still work. The customer ID will be
        // re-created on the next checkout if this write is lost, resulting
        // in a duplicate customer (recoverable via Stripe dashboard).
        console.error(
          '[stripe/checkout] Failed to persist stripe_customer_id:',
          updateError.message
        );
      }
    } catch (err) {
      console.error('[stripe/checkout] Failed to create Stripe customer:', err);
      return Response.json({ error: 'Failed to set up billing account' }, { status: 500 });
    }
  }

  // Step 5: Resolve the price ID for the requested plan.
  let priceId: string;
  try {
    priceId = getPriceId(validPlan);
  } catch (err) {
    console.error('[stripe/checkout] Price ID not configured:', err);
    return Response.json({ error: 'Plan billing not configured' }, { status: 500 });
  }

  // Step 6: Create the Stripe Checkout session.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  try {
    const checkoutSession = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode:     'subscription',
      line_items: [
        {
          price:    priceId,
          quantity: 1,
        },
      ],
      // On success: return to dashboard with a query param to trigger a success toast.
      success_url: `${appUrl}/dashboard?checkout=success`,
      // On cancel: return to pricing page so the user can pick again.
      cancel_url:  `${appUrl}/pricing`,
      // Prevent the user from changing the email on the Stripe-hosted page —
      // the account is tied to the email used at registration.
      customer_update: {
        address: 'auto',
      },
      // Allow Stripe's smart payment UI to offer the best options for the customer.
      allow_promotion_codes: true,
      metadata: {
        // Echo the plan and user ID so the checkout.session.completed webhook
        // has full context if needed (belt-and-suspenders alongside the subscription webhook).
        noshowly_plan:    validPlan,
        noshowly_user_id: userId,
      },
    });

    if (!checkoutSession.url) {
      console.error('[stripe/checkout] Stripe returned a session with no URL');
      return Response.json({ error: 'Checkout session creation failed' }, { status: 500 });
    }

    console.log(
      `[stripe/checkout] Created session for user=${userId} plan=${validPlan} ` +
      `customer=${stripeCustomerId}`
    );

    return Response.json({ url: checkoutSession.url }, { status: 200 });

  } catch (err) {
    console.error('[stripe/checkout] Stripe session creation failed:', err);
    return Response.json({ error: 'Failed to create checkout session' }, { status: 500 });
  }
}
