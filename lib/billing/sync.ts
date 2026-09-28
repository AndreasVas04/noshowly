/**
 * lib/billing/sync.ts
 *
 * Keeps users.plan in step with Stripe. Used by the Stripe webhook for every
 * billing event (app/api/webhooks/stripe) and by POST /api/stripe/sync right
 * after checkout, so the owner does not wait for the webhook.
 *
 * syncCustomerPlan():
 *  1. Finds the user: by users.stripe_customer_id, then by the user ids the
 *     event carries (checkout client_reference_id, session or subscription
 *     metadata user_id), then by the Stripe customer's metadata user_id. A
 *     user found this way who has no customer yet is linked to this one
 *     (only while stripe_customer_id is still empty). A user already linked
 *     to another customer is left alone and reported as a conflict.
 *  2. Lists every subscription of the customer (any status) and derives the
 *     plan from them (lib/billing/subscriptions.ts). The event's own copy of
 *     the subscription is never used, so the order of events and retries of
 *     old events do not matter.
 *  3. Writes the plan only while users.plan still holds the value read in
 *     step 1 (compare-and-set). If another sync changed it meanwhile, the
 *     steps run again with fresh data, so an older Stripe state never
 *     overwrites a newer one.
 *
 * Database and Stripe errors are thrown: the webhook answers 500 and Stripe
 * retries. Outcomes that a retry cannot change (no matching user, a
 * conflict, an unknown price) are returned for the caller to log.
 *
 * The database and Stripe are reached through BillingSyncDeps
 * (lib/billing/server.ts implements it), so the logic is tested without them.
 * Only types come from 'stripe'.
 */

import type Stripe from 'stripe';
import { parsePlan } from '@/lib/entitlements';
import type { CanonicalPlan } from '@/lib/plans';
import { isUuid } from '@/lib/postgrest';
import {
  derivePlanFromSubscriptions,
  planAfterSync,
  type PlanDerivation,
  type PriceMap,
  type SubscriptionSnapshot,
} from '@/lib/billing/subscriptions';

// ---------------------------------------------------------------------------
// Types and constants
// ---------------------------------------------------------------------------

/** How many times the compare-and-set is tried before giving up (then Stripe retries). */
export const SYNC_ATTEMPTS = 3;

/** Webhook events that trigger a sync. */
export const BILLING_EVENT_TYPES: ReadonlySet<string> = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'invoice.paid',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
]);

/** The users row fields a sync reads. */
export type BillingUser = {
  id: string;
  /** users.plan as stored (may be a legacy name). */
  plan: string;
  stripeCustomerId: string | null;
};

/** Which customer to sync, and user ids that may belong to it. */
export type BillingTarget = {
  customerId: string;
  /** Candidate users.id values from the event, most direct first. */
  userIdHints: string[];
};

/** Database and Stripe operations. Methods throw on errors. */
export interface BillingSyncDeps {
  /** Users whose stripe_customer_id is this customer (at most two are returned). */
  findUsersByCustomer(customerId: string): Promise<BillingUser[]>;
  /** A user by id, or null. */
  findUserById(userId: string): Promise<BillingUser | null>;
  /**
   * Sets stripe_customer_id only while it is still empty, then returns the
   * value stored afterwards (this customer when linked, another one or null
   * when not).
   */
  linkCustomer(userId: string, customerId: string): Promise<string | null>;
  /** Sets users.plan to `next` only while it still equals `expected`; true when updated. */
  updatePlan(userId: string, expected: string, next: CanonicalPlan): Promise<boolean>;
  /** Every subscription of the customer, any status. */
  listSubscriptions(customerId: string): Promise<SubscriptionSnapshot[]>;
  /** The Stripe customer's metadata.user_id, or null (none, or deleted customer). */
  customerUserId(customerId: string): Promise<string | null>;
  /** Stripe price id → plan. */
  priceMap: PriceMap;
}

/** Result of syncCustomerPlan(). */
export type SyncResult =
  | { status: 'updated'; userId: string; from: string; to: CanonicalPlan; derivation: PlanDerivation }
  | { status: 'unchanged'; userId: string; plan: string; derivation: PlanDerivation }
  /** No user could be found for the customer. */
  | { status: 'unmapped'; customerId: string }
  /** The customer points at a user linked to another customer, or at several users. */
  | { status: 'conflict'; customerId: string; detail: string }
  /** A live subscription only has prices the environment does not map; the plan was left alone. */
  | { status: 'unknown_price'; userId: string; priceIds: string[] };

/** Result of resolving the user. */
type Resolution =
  | { status: 'found'; user: BillingUser }
  | Extract<SyncResult, { status: 'unmapped' | 'conflict' }>;

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/**
 * Reads the customer (and candidate user ids) from a webhook event.
 *
 * @param event - A verified Stripe event.
 * @returns The target, or null for events that do not concern a Noshowly
 *          subscription (other types, checkouts that are not subscriptions,
 *          objects without a customer).
 */
export function readBillingEvent(event: Stripe.Event): BillingTarget | null {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      if (session.mode !== 'subscription') return null;
      return toTarget(session.customer, [
        session.client_reference_id,
        session.metadata?.user_id,
        // Sessions created before client_reference_id was set.
        session.metadata?.noshowly_user_id,
      ]);
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed': {
      const subscription = event.data.object;
      return toTarget(subscription.customer, [subscription.metadata?.user_id]);
    }

    case 'invoice.paid':
    case 'invoice.payment_succeeded':
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      return toTarget(invoice.customer, []);
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

/**
 * Brings the plan of the customer's user in line with Stripe (see the file header).
 *
 * @param deps   - Database and Stripe operations.
 * @param target - Customer and candidate user ids.
 * @throws Error on database or Stripe errors, or when users.plan keeps
 *         changing during SYNC_ATTEMPTS attempts.
 */
export async function syncCustomerPlan(deps: BillingSyncDeps, target: BillingTarget): Promise<SyncResult> {
  const resolution = await resolveUser(deps, target);
  if (resolution.status !== 'found') return resolution;
  let user = resolution.user;

  for (let attempt = 1; attempt <= SYNC_ATTEMPTS; attempt++) {
    const subscriptions = await deps.listSubscriptions(target.customerId);
    const derivation = derivePlanFromSubscriptions(subscriptions, deps.priceMap);

    const next = planAfterSync(parsePlan(user.plan), derivation);
    if (next === null) {
      return {
        status: 'unknown_price',
        userId: user.id,
        priceIds: derivation.kind === 'unknown_price' ? derivation.priceIds : [],
      };
    }
    if (next === user.plan) {
      return { status: 'unchanged', userId: user.id, plan: user.plan, derivation };
    }

    if (await deps.updatePlan(user.id, user.plan, next)) {
      return { status: 'updated', userId: user.id, from: user.plan, to: next, derivation };
    }

    // users.plan changed since it was read (another event or a manual edit):
    // read it again and derive again from Stripe's current state.
    const fresh = await deps.findUserById(user.id);
    if (!fresh) return { status: 'unmapped', customerId: target.customerId };
    if (fresh.stripeCustomerId !== target.customerId) {
      return {
        status: 'conflict',
        customerId: target.customerId,
        detail: `user ${fresh.id} is now linked to ${fresh.stripeCustomerId ?? 'no customer'}`,
      };
    }
    user = fresh;
  }

  throw new Error(
    `users.plan of user ${user.id} kept changing during ${SYNC_ATTEMPTS} sync attempts`,
  );
}

/**
 * Finds the customer's user, linking the customer to a user found through
 * the event or the customer's metadata when that user has none yet.
 */
async function resolveUser(deps: BillingSyncDeps, target: BillingTarget): Promise<Resolution> {
  const { customerId } = target;

  // Step 1: The customer is already linked.
  const linked = await deps.findUsersByCustomer(customerId);
  if (linked.length > 1) {
    return {
      status: 'conflict',
      customerId,
      detail: `customer is linked to several users (${linked.map((u) => u.id).join(', ')})`,
    };
  }
  if (linked.length === 1) return { status: 'found', user: linked[0] };

  // Step 2: User ids from the event, then from the customer's metadata (read
  // only when the event's ids do not lead to a user).
  const tried = new Set<string>();
  for (const userId of target.userIdHints) {
    tried.add(userId);
    const result = await linkCandidate(deps, customerId, userId);
    if (result) return result;
  }
  const fromCustomer = validUserId(await deps.customerUserId(customerId));
  if (fromCustomer && !tried.has(fromCustomer)) {
    const result = await linkCandidate(deps, customerId, fromCustomer);
    if (result) return result;
  }
  return { status: 'unmapped', customerId };
}

/**
 * Checks one candidate user for a customer that is not linked to anyone.
 * A user without a customer is linked to this one; a user linked to another
 * customer is a conflict.
 *
 * @returns The resolution, or null when there is no such user (try the next candidate).
 */
async function linkCandidate(
  deps: BillingSyncDeps,
  customerId: string,
  userId: string,
): Promise<Resolution | null> {
  const user = await deps.findUserById(userId);
  if (!user) return null;
  if (user.stripeCustomerId === customerId) return { status: 'found', user };
  if (user.stripeCustomerId) {
    return {
      status: 'conflict',
      customerId,
      detail: `user ${user.id} is linked to another customer (${user.stripeCustomerId})`,
    };
  }

  const stored = await deps.linkCustomer(user.id, customerId);
  if (stored === customerId) return { status: 'found', user: { ...user, stripeCustomerId: stored } };
  return {
    status: 'conflict',
    customerId,
    detail: `user ${user.id} could not be linked (stored customer: ${stored ?? 'none'})`,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a target from a Stripe customer field and candidate ids; null without a customer. */
function toTarget(
  customer: string | { id: string } | null | undefined,
  hints: ReadonlyArray<string | null | undefined>,
): BillingTarget | null {
  const customerId = typeof customer === 'string' ? customer : customer?.id;
  if (!customerId) return null;

  const userIdHints: string[] = [];
  for (const hint of hints) {
    const userId = validUserId(hint);
    if (userId && !userIdHints.includes(userId)) userIdHints.push(userId);
  }
  return { customerId, userIdHints };
}

/**
 * A trimmed, lower-case UUID, or null for anything else: users.id values are
 * UUIDs, so anything else found in metadata is ignored.
 */
export function validUserId(value: string | null | undefined): string | null {
  const id = value?.trim().toLowerCase();
  return id && isUuid(id) ? id : null;
}
