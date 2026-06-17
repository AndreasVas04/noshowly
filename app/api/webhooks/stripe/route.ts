/**
 * app/api/webhooks/stripe/route.ts
 *
 * POST /api/webhooks/stripe
 *
 * Handles incoming Stripe webhook events for subscription lifecycle management.
 *
 * Events handled:
 *  - customer.subscription.created  — Upgrade trial → paid plan
 *  - customer.subscription.updated  — Plan change (solo ↔ salon ↔ studio)
 *  - customer.subscription.deleted  — Cancellation → set plan = 'cancelled'
 *  - invoice.payment_succeeded       — Successful renewal
 *  - invoice.payment_failed          — Failed renewal (logged; grace period handled separately)
 *
 * Safety:
 *  - Signature verification prevents fake webhook calls.
 *  - In-memory idempotency cache prevents double-processing on Stripe retries.
 *    Note: This cache is per-function instance. On Vercel, functions may spin
 *    up multiple instances, so duplicate processing across instances is possible
 *    in rare cases. For MVP this is acceptable — a database-backed idempotency
 *    log would be the production solution.
 *
 * Security:
 *  - STRIPE_WEBHOOK_SECRET is required — requests without a valid signature
 *    are rejected with 400 immediately.
 *  - Uses the service role key to update user plan — never the anon key.
 *
 * Stripe client is imported from lib/stripe.ts. Signature verification uses
 * stripe.webhooks.constructEvent() — all events are verified before processing.
 */

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types';
import { stripe } from '@/lib/stripe';
import type Stripe from 'stripe';
import type { UserPlan } from '@/lib/plans';

// ---------------------------------------------------------------------------
// Service role client — needed to update users.plan without RLS restriction.
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
if (!SERVICE_ROLE_KEY) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');

const adminSupabase = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY);

// ---------------------------------------------------------------------------
// Idempotency cache (in-memory, per Vercel function instance)
// ---------------------------------------------------------------------------

/**
 * Stores Stripe event IDs that have already been processed in this function
 * instance. Prevents double-processing on Stripe's retry attempts within the
 * same instance lifetime (typically seconds to minutes).
 *
 * Limitation: A new Vercel instance starts with an empty cache. Cross-instance
 * idempotency requires a database-backed log (future improvement).
 */
const processedEventIds = new Map<string, number>();

/** Remove cache entries older than 1 hour to prevent unbounded memory growth. */
const EVENT_CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Checks whether an event ID is already in the processed cache.
 * Evicts stale entries on each call to keep the Map bounded.
 *
 * @param eventId - Stripe event ID (e.g. "evt_1Abc2...").
 * @returns true if this event was already processed.
 */
function isEventProcessed(eventId: string): boolean {
  const now = Date.now();
  // Evict stale entries.
  for (const [id, ts] of processedEventIds) {
    if (now - ts > EVENT_CACHE_TTL_MS) processedEventIds.delete(id);
  }
  return processedEventIds.has(eventId);
}

/**
 * Marks an event ID as processed in the in-memory cache.
 *
 * @param eventId - Stripe event ID to record.
 */
function markEventProcessed(eventId: string): void {
  processedEventIds.set(eventId, Date.now());
}

// ---------------------------------------------------------------------------
// Stripe price → plan mapping
// ---------------------------------------------------------------------------

/**
 * Maps a Stripe price ID to the corresponding Noshowly plan name.
 * Returns null for unrecognized price IDs (e.g. annual billing variants or
 * price IDs not yet configured via env vars).
 *
 * Primary env vars (new plans):
 *  - STRIPE_BASIC_PRICE_ID → 'basic'
 *  - STRIPE_PRO_PRICE_ID   → 'pro'
 *
 * Legacy backward-compatible env vars (maps old plan names to new canonical names):
 *  - STRIPE_STARTER_PRICE_ID      → 'basic'       (starter is now called basic)
 *  - STRIPE_PROFESSIONAL_PRICE_ID → 'pro'          (professional is now called pro)
 *  - STRIPE_BUSINESS_PRICE_ID     → 'business'     (internal only, preserved for existing subscribers)
 *
 * @param priceId - The Stripe price ID from the subscription object.
 * @returns Noshowly plan name that can be written to users.plan, or null if unrecognized.
 */
function priceIdToPlan(priceId: string): Exclude<UserPlan, 'cancelled' | 'trial'> | null {
  type PlanValue = Exclude<UserPlan, 'cancelled' | 'trial'>;
  // Build a lookup table from env vars to plan names at call time.
  // Any env var not set is undefined — those entries are skipped.
  const lookup: Array<[string | undefined, PlanValue]> = [
    // New primary price IDs
    [process.env.STRIPE_BASIC_PRICE_ID, 'basic'],
    [process.env.STRIPE_PRO_PRICE_ID,   'pro'],
    // Legacy backward-compatible price IDs — mapped to new canonical plan names
    [process.env.STRIPE_STARTER_PRICE_ID,      'basic'],       // starter → basic
    [process.env.STRIPE_PROFESSIONAL_PRICE_ID, 'pro'],         // professional → pro
    [process.env.STRIPE_BUSINESS_PRICE_ID,     'business'],    // internal only
  ];

  for (const [envPriceId, plan] of lookup) {
    if (envPriceId && envPriceId === priceId) return plan;
  }
  return null;
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

/**
 * Receives and processes Stripe webhook events.
 *
 * IMPORTANT: This route must export a raw body config so Next.js does not
 * parse the body before we pass it to Stripe for signature verification.
 * With App Router, the Request body is a ReadableStream — we read it as text
 * and pass it directly to Stripe.constructEvent().
 *
 * @param request - Incoming webhook POST from Stripe.
 * @returns 200 { received: true }   — event accepted (or already processed)
 * @returns 400 { error: string }    — invalid signature or bad payload
 * @returns 500 { error: string }    — unexpected processing error
 */
export async function POST(request: Request): Promise<Response> {
  const stripeSignature = request.headers.get('stripe-signature');

  if (!stripeSignature) {
    console.warn('[webhooks/stripe] Missing stripe-signature header');
    return Response.json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('[webhooks/stripe] STRIPE_WEBHOOK_SECRET is not set');
    return Response.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  // Read raw body — required for Stripe signature verification.
  const rawBody = await request.text();

  // ---------------------------------------------------------------------------
  // Signature verification — prevents fake webhook calls.
  // stripe.webhooks.constructEvent() validates the HMAC-SHA256 signature that
  // Stripe signs every webhook request with. Any request that fails this check
  // is rejected immediately — we never process unverified events.
  // ---------------------------------------------------------------------------

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, stripeSignature, webhookSecret);
  } catch (err) {
    // Invalid signature — could be a replay attack, a misconfigured secret, or
    // a request from a non-Stripe source. Reject immediately.
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[webhooks/stripe] Signature verification failed: ${message}`);
    return Response.json({ error: 'Invalid webhook signature' }, { status: 400 });
  }

  // Log all received events before any processing.
  console.log(
    `[webhooks/stripe] Received event type="${event.type}" id="${event.id}"`
  );

  // ---------------------------------------------------------------------------
  // Idempotency check — skip events already handled in this instance.
  // ---------------------------------------------------------------------------

  if (isEventProcessed(event.id)) {
    console.log(`[webhooks/stripe] Skipping already-processed event id="${event.id}"`);
    return Response.json({ received: true }, { status: 200 });
  }

  // ---------------------------------------------------------------------------
  // Event dispatch
  // ---------------------------------------------------------------------------

  try {
    await handleStripeEvent(event);
    markEventProcessed(event.id);
    return Response.json({ received: true }, { status: 200 });
  } catch (err) {
    console.error(`[webhooks/stripe] Error processing event type="${event.type}":`, err);
    return Response.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

/**
 * Dispatches a verified Stripe event to the appropriate handler function.
 *
 * @param event - The fully verified and typed Stripe event object.
 */
async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await handleSubscriptionUpsert(event.data.object as Stripe.Subscription);
      break;

    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
      break;

    case 'invoice.payment_succeeded': {
      // Renewal confirmed — no plan change needed, just log.
      const inv = event.data.object as Stripe.Invoice;
      console.log(
        `[webhooks/stripe] Payment succeeded for customer=${String(inv.customer ?? '')}`
      );
      break;
    }

    case 'invoice.payment_failed': {
      const inv = event.data.object as Stripe.Invoice;
      console.warn(
        `[webhooks/stripe] Payment FAILED for customer=${String(inv.customer ?? '')} ` +
        `invoice=${String(inv.id ?? '')} billing_reason=${String(inv.billing_reason ?? '')}`
      );
      // Only cancel on renewal failures — not on the first payment attempt.
      // subscription_cycle = renewal; subscription_create = first payment.
      if (inv.billing_reason === 'subscription_cycle') {
        await handlePaymentFailure(inv);
      }
      break;
    }

    default:
      // Unhandled event type — not an error, just log and acknowledge.
      console.log(
        `[webhooks/stripe] Unhandled event type="${event.type}" — acknowledged without action`
      );
  }
}

/**
 * Handles subscription.created and subscription.updated events.
 * Maps the Stripe price ID to a Noshowly PaidPlan and updates the user record.
 *
 * @param sub - Typed Stripe Subscription object from the verified webhook payload.
 */
async function handleSubscriptionUpsert(sub: Stripe.Subscription): Promise<void> {
  const customerId = String(sub.customer);
  const status     = sub.status;

  // Extract the price ID from the first subscription item.
  const priceId = sub.items.data[0]?.price?.id ?? '';

  const plan = priceIdToPlan(priceId);

  console.log(
    `[webhooks/stripe] subscription upsert — customer=${customerId} status=${status} ` +
    `priceId=${priceId} resolvedPlan=${plan ?? 'unknown'}`
  );

  if (plan === null) {
    console.warn(`[webhooks/stripe] Unrecognized price ID "${priceId}" — plan not updated`);
    return;
  }

  // Only upgrade to a paid plan when the subscription is active.
  if (status !== 'active' && status !== 'trialing') {
    console.log(`[webhooks/stripe] Subscription status="${status}" — not updating plan`);
    return;
  }

  // stripe_customer_id is populated by app/api/stripe/checkout/route.ts when the
  // user initiates checkout. This update matches by that ID to apply the plan change.
  const { error, count } = await adminSupabase
    .from('users')
    .update({ plan }, { count: 'exact' })
    .eq('stripe_customer_id', customerId);

  if (error) {
    console.error('[webhooks/stripe] Failed to update plan:', error.message);
    throw error;
  }

  // Warn when no rows were matched — means stripe_customer_id is not yet mapped.
  // This is expected before the Stripe checkout flow is wired up, but in
  // production it indicates a missing customer ID population step.
  if ((count ?? 0) === 0) {
    console.warn(
      `[webhooks/stripe] Plan update matched 0 rows for customer=${customerId}. ` +
      `stripe_customer_id may not be populated for this user. ` +
      `Intended plan: "${plan}"`
    );
    return; // Don't throw — the event is valid, the mapping just isn't ready yet.
  }

  console.log(`[webhooks/stripe] Plan updated to "${plan}" for customer=${customerId}`);
}

/**
 * Handles invoice.payment_failed for subscription renewals.
 * Sets the user's plan to 'cancelled' so they lose access until payment is fixed.
 *
 * Only called for billing_reason === 'subscription_cycle' (renewals),
 * NOT for 'subscription_create' (first payment attempts).
 *
 * @param inv - Typed Stripe Invoice object from the verified webhook payload.
 */
async function handlePaymentFailure(inv: Stripe.Invoice): Promise<void> {
  const customerId = String(inv.customer ?? '');

  if (!customerId) {
    console.warn('[webhooks/stripe] payment_failed: no customer ID on invoice');
    return;
  }

  const { error } = await adminSupabase
    .from('users')
    .update({ plan: 'cancelled' })
    .eq('stripe_customer_id', customerId);

  if (error) {
    console.error('[webhooks/stripe] Failed to cancel plan on renewal failure:', error.message);
    throw error;
  }

  console.log(`[webhooks/stripe] Plan set to 'cancelled' (renewal failure) for customer=${customerId}`);
}

/**
 * Handles subscription.deleted events.
 * Sets the user's plan to 'cancelled' — they lose access to paid features.
 *
 * @param sub - Typed Stripe Subscription object from the verified webhook payload.
 */
async function handleSubscriptionDeleted(sub: Stripe.Subscription): Promise<void> {
  const customerId = String(sub.customer);

  console.log(`[webhooks/stripe] subscription deleted — customer=${customerId}`);

  const { error } = await adminSupabase
    .from('users')
    .update({ plan: 'cancelled' })
    .eq('stripe_customer_id', customerId);

  if (error) {
    console.error('[webhooks/stripe] Failed to set plan=cancelled:', error.message);
    throw error;
  }

  console.log(`[webhooks/stripe] Plan set to 'cancelled' for customer=${customerId}`);
}
