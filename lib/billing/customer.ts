/**
 * lib/billing/customer.ts
 *
 * The Stripe customer behind checkout and the billing portal, including a
 * stored customer that Stripe no longer has.
 *
 * users.stripe_customer_id can point at a customer Stripe answers with
 * "No such customer": one deleted in the Stripe dashboard, or one created in
 * test mode that is still stored when the app switches to live keys. Every
 * checkout and portal session for it would fail. So:
 *  - prepareCheckoutCustomer() checks a stored customer before using it. When
 *    Stripe no longer has it, a new customer is created and replaces it, but
 *    only while the row still holds the old id (or none): a customer another
 *    request linked meanwhile is never overwritten. The old id stays stored
 *    until the replacement exists, so a failure in between is retried with
 *    the same idempotency key on the next attempt.
 *  - openBillingPortal() clears the id, again only while the row still holds
 *    it, when Stripe refuses the customer, so Settings offers a plan instead
 *    of a "Manage billing" button that can never work.
 *
 * Stripe and the database are reached through the Deps interfaces
 * (lib/billing/server.ts implements them), so the logic is tested without
 * them.
 */

import { decideCheckout, type SubscriptionSnapshot } from '@/lib/billing/subscriptions';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Stripe and database operations for prepareCheckoutCustomer(). Methods throw on errors. */
export interface CheckoutCustomerDeps {
  /** False when Stripe has no such customer (deleted, or from the other mode or account). */
  customerExists(customerId: string): Promise<boolean>;
  /** Every subscription of the customer, any status. */
  listSubscriptions(customerId: string): Promise<SubscriptionSnapshot[]>;
  /** Creates a Stripe customer for the user; the same key always gives the same customer. */
  createCustomer(idempotencyKey: string): Promise<string>;
  /**
   * Stores the customer only while none is stored or, when `replacing` is
   * set, while that customer is still the stored one. Returns the id stored
   * afterwards (this one, another one, or null when the row is gone).
   */
  linkCustomer(userId: string, customerId: string, replacing: string | null): Promise<string | null>;
}

/** Result of prepareCheckoutCustomer(). */
export type CheckoutCustomerResult =
  /** The customer to check out with, and the stored one it replaced (which Stripe no longer had). */
  | { ok: true; customerId: string; replacedCustomerId: string | null }
  /** The account must not buy another subscription or plan (answer 409). */
  | { ok: false; reason: 'subscription_exists' | 'already_paid' }
  /** A Stripe or database call failed. */
  | { ok: false; reason: 'stripe' | 'database'; message: string };

/** Stripe and database operations for openBillingPortal(). Methods throw on errors. */
export interface BillingPortalDeps {
  /** Creates a customer portal session; returns its URL. */
  createPortalSession(customerId: string): Promise<string>;
  /** Clears the stored customer only while it is still this one; true when cleared. */
  unlinkCustomer(userId: string, customerId: string): Promise<boolean>;
}

/** Result of openBillingPortal(). */
export type BillingPortalResult =
  | { ok: true; url: string }
  /**
   * Stripe has no such customer. It was unlinked unless unlinkError is set
   * (then the next attempt tries again).
   */
  | { ok: false; reason: 'customer_missing'; unlinkError: string | null }
  | { ok: false; reason: 'stripe'; message: string };

// ---------------------------------------------------------------------------
// Stripe errors
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
 * Returns true when Stripe answered "No such customer" for the request's
 * customer, e.g. a Checkout or portal session for a deleted customer, or for
 * a test-mode customer with a live key. A missing price or other object is
 * not a missing customer.
 *
 * @param err - Any thrown value.
 */
export function isMissingStripeCustomer(err: unknown): boolean {
  if (!isMissingStripeResource(err)) return false;
  const { param, message } = err as { param?: unknown; message?: unknown };
  return param === 'customer' || (typeof message === 'string' && message.startsWith('No such customer'));
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

/**
 * Idempotency key for creating a user's Stripe customer. Concurrent checkouts
 * (double clicks, two tabs) send the same key and get the same customer. A
 * replacement gets a key of its own: for 24 hours Stripe answers a key it has
 * seen with the customer it created then, which may be the one that is gone.
 *
 * @param userId             - users.id
 * @param replacedCustomerId - The stored customer Stripe no longer has, or null.
 */
export function customerIdempotencyKey(userId: string, replacedCustomerId: string | null): string {
  return replacedCustomerId ? `customer-${userId}-replaces-${replacedCustomerId}` : `customer-${userId}`;
}

/**
 * Chooses the Stripe customer for a checkout:
 *  1. A stored customer that Stripe no longer has is set aside for
 *     replacement (the row keeps it for now).
 *  2. A second subscription is refused: when the customer already has an
 *     active, trialing or past_due subscription, or the account already has a
 *     paid plan (decideCheckout()).
 *  3. Without a usable customer, one is created (customerIdempotencyKey()) and
 *     stored only while no customer, or the one set aside, is stored. When
 *     another request linked a customer meanwhile, that one is used and
 *     checked for a subscription too.
 *
 * @param deps                   - Stripe and database operations.
 * @param input.userId           - The verified user's id.
 * @param input.storedCustomerId - users.stripe_customer_id as read.
 * @param input.isPaid           - Entitlements.isPaid of the account.
 * @returns The customer, a refusal, or the failed call. Never throws for
 *          Stripe or database errors.
 */
export async function prepareCheckoutCustomer(
  deps: CheckoutCustomerDeps,
  input: { userId: string; storedCustomerId: string | null; isPaid: boolean },
): Promise<CheckoutCustomerResult> {
  const { userId, isPaid } = input;
  let customerId = input.storedCustomerId;
  let replacedCustomerId: string | null = null;

  try {
    // Step 1: A stored customer that Stripe no longer has.
    const stored = customerId;
    if (stored && !(await call('stripe', () => deps.customerExists(stored)))) {
      console.warn(`[billing] user=${userId}: customer=${stored} does not exist in Stripe; replacing it`);
      replacedCustomerId = stored;
      customerId = null;
    }

    // Step 2: Never a second subscription.
    const refusal = await refuseSecondSubscription(deps, isPaid, customerId);
    if (refusal) return refusal;
    if (customerId) return { ok: true, customerId, replacedCustomerId };

    // Step 3: A new customer, stored only while none (or the missing one) is.
    const key = customerIdempotencyKey(userId, replacedCustomerId);
    const createdId = await call('stripe', () => deps.createCustomer(key));
    const linkedId = await call('database', () => deps.linkCustomer(userId, createdId, replacedCustomerId));
    if (!linkedId) {
      return { ok: false, reason: 'database', message: `customer ${createdId} could not be stored for user ${userId}` };
    }
    if (linkedId !== createdId) {
      console.warn(`[billing] user=${userId}: already linked to customer=${linkedId}; using it instead of ${createdId}`);
      const linkedRefusal = await refuseSecondSubscription(deps, isPaid, linkedId);
      if (linkedRefusal) return linkedRefusal;
    }
    return { ok: true, customerId: linkedId, replacedCustomerId };
  } catch (err) {
    if (err instanceof DependencyError) return { ok: false, reason: err.reason, message: err.message };
    throw err;
  }
}

/**
 * The refusal when the account must not start another subscription, or null.
 *
 * @param customerId - The customer whose subscriptions count; null for none.
 */
async function refuseSecondSubscription(
  deps: CheckoutCustomerDeps,
  isPaid: boolean,
  customerId: string | null,
): Promise<CheckoutCustomerResult | null> {
  const subscriptions = customerId ? await call('stripe', () => deps.listSubscriptions(customerId)) : [];
  const decision = decideCheckout({ isPaid, subscriptions });
  return decision.allowed ? null : { ok: false, reason: decision.reason };
}

// ---------------------------------------------------------------------------
// Billing portal
// ---------------------------------------------------------------------------

/**
 * Opens the billing portal for the stored customer. When Stripe has no such
 * customer, it is unlinked (only while it is still the stored one), so the
 * owner is offered a plan next time instead of this portal again.
 *
 * @param deps       - Stripe and database operations.
 * @param userId     - The verified user's id.
 * @param customerId - users.stripe_customer_id as read.
 */
export async function openBillingPortal(
  deps: BillingPortalDeps,
  userId: string,
  customerId: string,
): Promise<BillingPortalResult> {
  try {
    return { ok: true, url: await deps.createPortalSession(customerId) };
  } catch (err) {
    if (!isMissingStripeCustomer(err)) return { ok: false, reason: 'stripe', message: errorMessage(err) };
  }

  // Stripe has no such customer.
  try {
    await deps.unlinkCustomer(userId, customerId);
    return { ok: false, reason: 'customer_missing', unlinkError: null };
  } catch (err) {
    return { ok: false, reason: 'customer_missing', unlinkError: errorMessage(err) };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A failed Stripe or database call inside prepareCheckoutCustomer(). */
class DependencyError extends Error {
  constructor(readonly reason: 'stripe' | 'database', cause: unknown) {
    super(errorMessage(cause));
  }
}

/** Runs one Stripe or database call, labelling its failure. */
async function call<T>(reason: 'stripe' | 'database', fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw new DependencyError(reason, err);
  }
}

/** Message of an unknown error value. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
