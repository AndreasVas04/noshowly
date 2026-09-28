/**
 * app/api/stripe/sync/route.ts
 *
 * POST /api/stripe/sync
 *
 * Called by the dashboard when Stripe Checkout sends the owner back
 * (success_url: /dashboard?checkout=success&session_id=…). Brings the plan up
 * to date straight away, so the owner does not keep seeing the trial state
 * until the webhook arrives. The webhook runs the same sync
 * (lib/billing/sync.ts) and stays the source of truth; running both is
 * harmless because each derives the plan from Stripe's current state.
 *
 * Flow:
 *  1. Verify the user (requireUser).
 *  2. Validate the Checkout session id.
 *  3. Retrieve the session from Stripe and check that it is a completed
 *     subscription checkout of this user (client_reference_id or metadata
 *     user_id). Anything else answers 404, whatever the reason.
 *  4. Sync the customer's plan, linking the customer to the user if the
 *     checkout route could not.
 *  5. Answer with the user's plan as stored now.
 *
 * Request body: { session_id: string }
 *
 * @returns 200 { plan, isPaid }  — plan after the sync
 * @returns 400 { error }         — invalid body or session id
 * @returns 401 { error }         — not authenticated
 * @returns 404 { error }         — no completed checkout with this id for this user
 * @returns 500 { error }         — the plan could not be read afterwards
 * @returns 502 { error }         — Stripe (or the database) failed during the sync; the webhook
 *                                  still updates the plan
 */

import { requireUser } from '@/lib/auth';
import { loadEntitlements } from '@/lib/access';
import { stripe } from '@/lib/stripe';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createBillingSyncDeps, isMissingStripeResource } from '@/lib/billing/server';
import { syncCustomerPlan, validUserId } from '@/lib/billing/sync';

/** Stripe Checkout session ids: cs_test_… or cs_live_…. */
const SESSION_ID_PATTERN = /^cs_(test|live)_[A-Za-z0-9]{1,250}$/;

/**
 * Syncs the plan after a completed checkout.
 *
 * @param request - POST with JSON body { session_id }.
 */
export async function POST(request: Request): Promise<Response> {
  // Step 1: Verify the user.
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;

  // Step 2: Validate the session id.
  let body: { session_id?: unknown };
  try {
    body = (await request.json()) as { session_id?: unknown };
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const sessionId = body?.session_id;
  if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
    return Response.json({ error: 'Invalid session_id' }, { status: 400 });
  }

  // Step 3: The session must be this user's completed subscription checkout.
  let customerId: string | null;
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const owner =
      validUserId(session.client_reference_id) ??
      validUserId(session.metadata?.user_id) ??
      validUserId(session.metadata?.noshowly_user_id);
    customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null;

    if (owner !== userId || session.mode !== 'subscription' || session.status !== 'complete' || !customerId) {
      return Response.json({ error: 'Checkout not found' }, { status: 404 });
    }
  } catch (err) {
    if (isMissingStripeResource(err)) {
      return Response.json({ error: 'Checkout not found' }, { status: 404 });
    }
    console.error('[stripe/sync] Failed to retrieve the checkout session:', errorMessage(err));
    return Response.json({ error: 'Could not reach the billing provider. Please try again.' }, { status: 502 });
  }

  // Step 4: Sync the plan from Stripe (links the customer if needed).
  const db = createAdminSupabaseClient();
  try {
    const result = await syncCustomerPlan(createBillingSyncDeps(db), { customerId, userIdHints: [userId] });
    if (result.status === 'conflict' || result.status === 'unmapped' || result.status === 'unknown_price') {
      console.warn(`[stripe/sync] user=${userId} customer=${customerId} not applied: ${JSON.stringify(result)}`);
    }
  } catch (err) {
    console.error(`[stripe/sync] Sync failed for user=${userId}:`, errorMessage(err));
    return Response.json({ error: 'Could not update your plan yet. Please refresh in a minute.' }, { status: 502 });
  }

  // Step 5: The plan as stored now.
  const loaded = await loadEntitlements(db, userId);
  if (!loaded.ok) {
    console.error(`[stripe/sync] Failed to read the plan of user=${userId}:`, loaded.reason);
    return Response.json({ error: 'Failed to load your plan' }, { status: 500 });
  }
  return Response.json(
    { plan: loaded.entitlements.plan, isPaid: loaded.entitlements.isPaid },
    { status: 200 },
  );
}

/** Message of an unknown error value. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
