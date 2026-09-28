/**
 * lib/billing/server.ts
 *
 * Stripe and Supabase operations for billing, shared by the checkout, portal,
 * sync, billing and account routes and the Stripe webhook:
 *  - listCustomerSubscriptions() / cancelSubscription() / customerUserId():
 *    Stripe calls, returning the plain shapes of lib/billing/subscriptions.ts;
 *  - linkStripeCustomer(): stores a user's Stripe customer id only while none
 *    is stored, so two requests can never leave two customers behind;
 *  - createBillingSyncDeps(): BillingSyncDeps (lib/billing/sync.ts) backed by
 *    Stripe and the service-role client.
 *
 * Server-only: it uses the Stripe secret key and the service-role key.
 */

import 'server-only';
import { stripe } from '@/lib/stripe';
import type { AdminSupabaseClient } from '@/lib/supabase/admin';
import type { UserPlan } from '@/lib/plans';
import {
  priceMapFromEnv,
  toSubscriptionSnapshot,
  type SubscriptionSnapshot,
} from '@/lib/billing/subscriptions';
import type { BillingSyncDeps, BillingUser } from '@/lib/billing/sync';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Most subscriptions read for one customer (canceled ones included). */
const MAX_SUBSCRIPTIONS_PER_CUSTOMER = 1000;

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = '23505';

// ---------------------------------------------------------------------------
// Stripe
// ---------------------------------------------------------------------------

/**
 * Returns true for Stripe's "No such …" error (resource_missing), e.g. a
 * customer that was deleted in the Stripe dashboard.
 *
 * @param err - Any thrown value.
 */
export function isMissingStripeResource(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'resource_missing';
}

/**
 * Lists every subscription of a customer, any status.
 *
 * @param customerId - Stripe customer id.
 * @returns The subscriptions ([] when the customer does not exist in Stripe).
 * @throws The Stripe error for anything else.
 */
export async function listCustomerSubscriptions(customerId: string): Promise<SubscriptionSnapshot[]> {
  try {
    const subscriptions = await stripe.subscriptions
      .list({ customer: customerId, status: 'all', limit: 100 })
      .autoPagingToArray({ limit: MAX_SUBSCRIPTIONS_PER_CUSTOMER });
    return subscriptions.map(toSubscriptionSnapshot);
  } catch (err) {
    if (isMissingStripeResource(err)) return [];
    throw err;
  }
}

/**
 * Cancels a subscription immediately. A subscription Stripe no longer knows
 * counts as cancelled.
 *
 * @param subscriptionId - Stripe subscription id.
 * @throws The Stripe error for anything else.
 */
export async function cancelSubscription(subscriptionId: string): Promise<void> {
  try {
    await stripe.subscriptions.cancel(subscriptionId);
  } catch (err) {
    if (isMissingStripeResource(err)) return;
    throw err;
  }
}

/**
 * Returns the Noshowly user id stored on a Stripe customer (metadata.user_id).
 *
 * @param customerId - Stripe customer id.
 * @returns The id, or null when none is stored or the customer was deleted.
 */
export async function customerUserId(customerId: string): Promise<string | null> {
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if ('deleted' in customer && customer.deleted) return null;
    return customer.metadata?.user_id ?? null;
  } catch (err) {
    if (isMissingStripeResource(err)) return null;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

/**
 * Stores a user's Stripe customer id only while none is stored, then reads
 * back what is stored. Two checkouts or webhook events racing each other can
 * therefore never replace a customer that is already linked.
 *
 * @param db         - Service-role client (owners cannot write public.users).
 * @param userId     - users.id
 * @param customerId - Stripe customer id.
 * @returns The customer id stored afterwards: `customerId` when linked, the
 *          other id when one was already stored, null when the row is gone or
 *          the customer belongs to another account (users_stripe_customer_id_key).
 * @throws Error on any other database error.
 */
export async function linkStripeCustomer(
  db: AdminSupabaseClient,
  userId: string,
  customerId: string,
): Promise<string | null> {
  const { error: updateError } = await db
    .from('users')
    .update({ stripe_customer_id: customerId })
    .eq('id', userId)
    .is('stripe_customer_id', null);

  if (updateError && updateError.code !== UNIQUE_VIOLATION) {
    throw new Error(`Failed to link the Stripe customer: ${updateError.message}`);
  }

  const { data, error } = await db
    .from('users')
    .select('stripe_customer_id')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw new Error(`Failed to read the Stripe customer back: ${error.message}`);
  return data?.stripe_customer_id ?? null;
}

/** Columns of BillingUser. */
const BILLING_USER_COLUMNS = 'id, plan, stripe_customer_id';

/** Converts a users row to a BillingUser. */
function toBillingUser(row: { id: string; plan: string; stripe_customer_id: string | null }): BillingUser {
  return { id: row.id, plan: row.plan, stripeCustomerId: row.stripe_customer_id };
}

/**
 * BillingSyncDeps backed by Stripe and the service-role client.
 *
 * @param db - Service-role client.
 */
export function createBillingSyncDeps(db: AdminSupabaseClient): BillingSyncDeps {
  return {
    async findUsersByCustomer(customerId) {
      const { data, error } = await db
        .from('users')
        .select(BILLING_USER_COLUMNS)
        .eq('stripe_customer_id', customerId)
        .limit(2);
      if (error) throw new Error(`User lookup by customer failed: ${error.message}`);
      return (data ?? []).map(toBillingUser);
    },

    async findUserById(userId) {
      const { data, error } = await db
        .from('users')
        .select(BILLING_USER_COLUMNS)
        .eq('id', userId)
        .maybeSingle();
      if (error) throw new Error(`User lookup failed: ${error.message}`);
      return data ? toBillingUser(data) : null;
    },

    linkCustomer(userId, customerId) {
      return linkStripeCustomer(db, userId, customerId);
    },

    async updatePlan(userId, expected, next) {
      const { data, error } = await db
        .from('users')
        .update({ plan: next })
        .eq('id', userId)
        .eq('plan', expected as UserPlan)
        .select('id');
      if (error) throw new Error(`Plan update failed: ${error.message}`);
      return (data ?? []).length === 1;
    },

    listSubscriptions: listCustomerSubscriptions,
    customerUserId,
    priceMap: priceMapFromEnv(process.env),
  };
}
