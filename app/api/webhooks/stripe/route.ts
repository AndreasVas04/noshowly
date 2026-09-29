/**
 * app/api/webhooks/stripe/route.ts
 *
 * POST /api/webhooks/stripe
 *
 * Keeps users.plan in step with Stripe subscriptions.
 *
 * Events handled (readBillingEvent() in lib/billing/sync.ts):
 *  - checkout.session.completed      — links the Stripe customer to the user
 *                                      (client_reference_id / metadata user_id)
 *                                      if it is not linked yet
 *  - customer.subscription.created / updated / deleted / paused / resumed
 *  - invoice.paid, invoice.payment_succeeded, invoice.payment_failed
 *
 * Every handled event runs the same sync (lib/billing/sync.ts): find the
 * user (stripe_customer_id, then the user ids the event carries, then the
 * customer's metadata user_id), list ALL of the customer's subscriptions
 * from Stripe and derive the plan from them (lib/billing/subscriptions.ts):
 * an active or trialing subscription with a known price gives its plan, a
 * past_due one keeps it while Stripe retries the payment, anything else is
 * 'cancelled' (an account still on its free trial keeps the trial). Because
 * the plan never comes from the event's own snapshot, the order in which
 * events arrive and retries of old events do not matter, and processing an
 * event twice is harmless — there is no idempotency cache.
 *
 * Responses:
 *  - 200 when the event was synced, needed nothing, is not a billing event,
 *    or cannot be applied however often it is retried (no user for the
 *    customer, a customer conflict, a price the environment does not map);
 *    those are logged as warnings or errors.
 *  - 500 on database or Stripe errors, so Stripe retries the event.
 *  - 400 without a valid signature.
 *
 * Security:
 *  - STRIPE_WEBHOOK_SECRET is required; the signature is verified on the raw
 *    body before anything is read from it.
 *  - Uses the service-role key to update users.plan — never the anon key.
 */

import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createBillingSyncDeps } from '@/lib/billing/server';
import { readBillingEvent, syncCustomerPlan, type SyncResult } from '@/lib/billing/sync';

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

/**
 * Receives and processes Stripe webhook events.
 *
 * The body is read as text and passed unparsed to
 * stripe.webhooks.constructEvent(), which checks the HMAC signature Stripe
 * signs every webhook request with.
 *
 * @param request - Incoming webhook POST from Stripe.
 * @returns 200 { received: true }   — event handled (or nothing to do)
 * @returns 400 { error: string }    — missing or invalid signature
 * @returns 500 { error: string }    — configuration, database or Stripe error (Stripe retries)
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

  // Step 1: Read the raw body — required for signature verification.
  const rawBody = await request.text();

  // Step 2: Verify the signature. Any request that fails this check is
  // rejected immediately — unverified events are never processed.
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, stripeSignature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[webhooks/stripe] Signature verification failed: ${message}`);
    return Response.json({ error: 'Invalid webhook signature' }, { status: 400 });
  }

  const log = `[webhooks/stripe] type=${event.type} id=${event.id}`;

  // Step 3: Only billing events with a customer are synced.
  const target = readBillingEvent(event);
  if (!target) {
    console.log(`${log} acknowledged without action`);
    return Response.json({ received: true }, { status: 200 });
  }

  // Step 4: Sync the customer's plan from Stripe's current state.
  try {
    const result = await syncCustomerPlan(createBillingSyncDeps(createAdminSupabaseClient()), target);
    logSyncResult(log, result);
    return Response.json({ received: true }, { status: 200 });
  } catch (err) {
    // Database or Stripe unavailable: answer 500 so Stripe retries the event.
    console.error(`${log} sync failed, Stripe will retry:`, err instanceof Error ? err.message : err);
    return Response.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Logs the outcome of a sync. Outcomes a retry cannot change are warnings or
 * errors, answered with 200 so Stripe does not retry them for days.
 *
 * @param log    - Log prefix with the event type and id.
 * @param result - Result of syncCustomerPlan().
 */
function logSyncResult(log: string, result: SyncResult): void {
  switch (result.status) {
    case 'updated':
      console.log(`${log} user=${result.userId} plan ${result.from} → ${result.to}`);
      break;
    case 'unchanged':
      console.log(`${log} user=${result.userId} plan unchanged (${result.plan})`);
      break;
    case 'unmapped':
      console.warn(
        `${log} WARN — no user for customer=${result.customerId} ` +
        '(no stripe_customer_id match, no user id in the event or the customer metadata)',
      );
      break;
    case 'conflict':
      console.warn(`${log} WARN — customer=${result.customerId} not applied: ${result.detail}`);
      break;
    case 'unknown_price':
      console.error(
        `${log} ERROR — user=${result.userId} has a live subscription with prices ` +
        `${result.priceIds.join(', ') || '(none)'} that no STRIPE_*_PRICE_ID maps to; plan left unchanged`,
      );
      break;
  }
}
