/**
 * lib/billing/subscriptions.ts
 *
 * Pure rules for Stripe subscriptions: which plan a customer's subscriptions
 * give, whether a new checkout may start, which subscription the Billing
 * section shows, and which ones account deletion cancels.
 *
 * The plan is always derived from ALL of the customer's subscriptions as
 * Stripe reports them now, never from the snapshot carried by one webhook
 * event, so the order in which events arrive and retries of old events do
 * not matter (derivePlanFromSubscriptions()):
 *  - an active or trialing subscription with a known price → that plan (the
 *    highest one when there are several: business, pro, basic);
 *  - otherwise a past_due one with a known price → that plan, as a grace
 *    period while Stripe retries the payment;
 *  - otherwise, when a live subscription only has prices this app does not
 *    know → 'unknown_price': the plan is left as it is and an error is
 *    logged, so a price missing from the environment never locks out a
 *    paying owner (and never grants a plan by guesswork);
 *  - otherwise (canceled, unpaid, incomplete, paused, or no subscription)
 *    → no plan: 'cancelled', except that an account still on its free trial
 *    keeps the trial (planAfterSync()).
 *
 * Price ids map to plans through the STRIPE_*_PRICE_ID environment variables
 * (priceMapFromEnv()). Basic is the only public plan; the others keep
 * existing or internal subscriptions working.
 *
 * Only types come from 'stripe', so this module has no runtime dependencies.
 */

import type Stripe from 'stripe';
import type { CanonicalPlan, SubscriptionPlan } from '@/lib/plans';
import type { BillingSubscription } from '@/types';

// ---------------------------------------------------------------------------
// Types and constants
// ---------------------------------------------------------------------------

/** The subscription fields the rules read. */
export type SubscriptionSnapshot = {
  id: string;
  /** Stripe status: active, trialing, past_due, canceled, unpaid, incomplete, … */
  status: string;
  /** Price ids of the subscription's items. */
  priceIds: string[];
  /** The subscription ends at the end of the current period. */
  cancelAtPeriodEnd: boolean;
  /** When the subscription is set to end (epoch seconds), or null. */
  cancelAt: number | null;
  /** End of the current billing period (epoch seconds, latest item), or null. */
  currentPeriodEnd: number | null;
  /** Creation time (epoch seconds). */
  created: number;
};

/** Stripe price id → plan. */
export type PriceMap = ReadonlyMap<string, SubscriptionPlan>;

/** Result of derivePlanFromSubscriptions(). */
export type PlanDerivation =
  | { kind: 'plan'; plan: SubscriptionPlan; subscriptionId: string; status: string }
  | { kind: 'unknown_price'; subscriptionIds: string[]; priceIds: string[] }
  | { kind: 'none' };

/** Result of decideCheckout(). */
export type CheckoutDecision =
  | { allowed: true }
  /** The customer already has an active, trialing or past_due subscription. */
  | { allowed: false; reason: 'subscription_exists'; subscriptionId: string }
  /** The account already has a paid plan without a live Stripe subscription (e.g. an internal plan). */
  | { allowed: false; reason: 'already_paid' };

/** Statuses of a subscription that is still running: it gives (or keeps) a paid plan. */
export const LIVE_SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set(['active', 'trialing', 'past_due']);

/** Statuses paid up for the current period. */
const PAID_UP_STATUSES: ReadonlySet<string> = new Set(['active', 'trialing']);

/** Statuses of a subscription that has ended for good and cannot be cancelled. */
const ENDED_STATUSES: ReadonlySet<string> = new Set(['canceled', 'incomplete_expired']);

/** Higher wins when several subscriptions give a plan. */
const PLAN_RANK: Record<SubscriptionPlan, number> = { basic: 1, pro: 2, business: 3 };

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

/**
 * Builds the price → plan map from the environment. Unset variables are
 * skipped; when two variables hold the same price the first one wins.
 *
 *  - STRIPE_BASIC_PRICE_ID        → basic (the public plan, used by checkout)
 *  - STRIPE_PRO_PRICE_ID          → pro (internal)
 *  - STRIPE_BUSINESS_PRICE_ID     → business (internal)
 *  - STRIPE_STARTER_PRICE_ID      → basic (legacy name)
 *  - STRIPE_PROFESSIONAL_PRICE_ID → pro (legacy name)
 *
 * @param env - Usually process.env.
 */
export function priceMapFromEnv(env: Record<string, string | undefined>): PriceMap {
  const entries: Array<[string | undefined, SubscriptionPlan]> = [
    [env.STRIPE_BASIC_PRICE_ID,        'basic'],
    [env.STRIPE_PRO_PRICE_ID,          'pro'],
    [env.STRIPE_BUSINESS_PRICE_ID,     'business'],
    [env.STRIPE_STARTER_PRICE_ID,      'basic'],
    [env.STRIPE_PROFESSIONAL_PRICE_ID, 'pro'],
  ];

  const map = new Map<string, SubscriptionPlan>();
  for (const [value, plan] of entries) {
    const priceId = value?.trim();
    if (priceId && !map.has(priceId)) map.set(priceId, plan);
  }
  return map;
}

/**
 * Converts a Stripe subscription to the fields the rules read.
 *
 * @param subscription - As returned by the Stripe API (items included).
 */
export function toSubscriptionSnapshot(subscription: Stripe.Subscription): SubscriptionSnapshot {
  const items = subscription.items?.data ?? [];
  const periodEnds = items
    .map((item) => item.current_period_end)
    .filter((value): value is number => typeof value === 'number');

  return {
    id:                subscription.id,
    status:            subscription.status,
    priceIds:          items
      .map((item) => item.price?.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
    cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
    cancelAt:          subscription.cancel_at ?? null,
    currentPeriodEnd:  periodEnds.length > 0 ? Math.max(...periodEnds) : null,
    created:           subscription.created,
  };
}

// ---------------------------------------------------------------------------
// Plan derivation
// ---------------------------------------------------------------------------

/**
 * Derives the plan a customer's subscriptions give (see the file header).
 *
 * @param subscriptions - Every subscription of the customer, any status, any order.
 * @param priceMap      - From priceMapFromEnv().
 */
export function derivePlanFromSubscriptions(
  subscriptions: readonly SubscriptionSnapshot[],
  priceMap: PriceMap,
): PlanDerivation {
  const paidUp = bestKnownPlan(subscriptions.filter((s) => PAID_UP_STATUSES.has(s.status)), priceMap);
  if (paidUp) return paidUp;

  const grace = bestKnownPlan(subscriptions.filter((s) => s.status === 'past_due'), priceMap);
  if (grace) return grace;

  const live = subscriptions.filter((s) => LIVE_SUBSCRIPTION_STATUSES.has(s.status));
  if (live.length > 0) {
    return {
      kind: 'unknown_price',
      subscriptionIds: live.map((s) => s.id),
      priceIds: [...new Set(live.flatMap((s) => s.priceIds))],
    };
  }

  return { kind: 'none' };
}

/**
 * The plan to store after a sync.
 *
 *  - A subscription plan → that plan.
 *  - No plan → 'cancelled', but an account still on its free trial keeps the
 *    trial: it never had a paid plan to lose (e.g. a checkout whose payment
 *    is still pending), and the trial ends on its own date anyway.
 *  - Unknown prices → null: leave the stored plan as it is.
 *
 * @param current    - The stored plan (parsed).
 * @param derivation - From derivePlanFromSubscriptions().
 */
export function planAfterSync(current: CanonicalPlan, derivation: PlanDerivation): CanonicalPlan | null {
  switch (derivation.kind) {
    case 'plan':          return derivation.plan;
    case 'unknown_price': return null;
    default:              return current === 'trial' ? 'trial' : 'cancelled';
  }
}

// ---------------------------------------------------------------------------
// Checkout, Billing section, account deletion
// ---------------------------------------------------------------------------

/**
 * Decides whether a new checkout may start. A second subscription is never
 * created while one is running (the owner changes or cancels it in the
 * billing portal instead), and an account with a paid plan does not buy one.
 *
 * @param input.isPaid        - Entitlements.isPaid of the account.
 * @param input.subscriptions - The customer's subscriptions ([] without a customer).
 */
export function decideCheckout(input: {
  isPaid: boolean;
  subscriptions: readonly SubscriptionSnapshot[];
}): CheckoutDecision {
  const live = input.subscriptions.find((s) => LIVE_SUBSCRIPTION_STATUSES.has(s.status));
  if (live) return { allowed: false, reason: 'subscription_exists', subscriptionId: live.id };
  if (input.isPaid) return { allowed: false, reason: 'already_paid' };
  return { allowed: true };
}

/**
 * Picks the subscription the Billing section describes: the newest active or
 * trialing one, else the newest past_due one, else the newest one that has
 * not ended (unpaid, incomplete, paused), else none.
 *
 * @param subscriptions - The customer's subscriptions.
 */
export function pickDisplaySubscription(
  subscriptions: readonly SubscriptionSnapshot[],
): SubscriptionSnapshot | null {
  const newestFirst = [...subscriptions].sort((a, b) => b.created - a.created);
  return (
    newestFirst.find((s) => PAID_UP_STATUSES.has(s.status)) ??
    newestFirst.find((s) => s.status === 'past_due') ??
    newestFirst.find((s) => !ENDED_STATUSES.has(s.status)) ??
    null
  );
}

/**
 * Converts a subscription for GET /api/billing (timestamps as ISO strings).
 *
 * @param subscription - From pickDisplaySubscription().
 */
export function toBillingSubscription(subscription: SubscriptionSnapshot): BillingSubscription {
  return {
    status:            subscription.status,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    currentPeriodEnd:  epochToIso(subscription.currentPeriodEnd),
    cancelAt:          epochToIso(subscription.cancelAt),
  };
}

/**
 * The subscriptions account deletion must cancel: every one that has not
 * ended (canceled and incomplete_expired are final).
 *
 * @param subscriptions - The customer's subscriptions.
 */
export function subscriptionsToCancel(
  subscriptions: readonly SubscriptionSnapshot[],
): SubscriptionSnapshot[] {
  return subscriptions.filter((s) => !ENDED_STATUSES.has(s.status));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The highest plan among the subscriptions' known prices, from the newest
 * subscription on ties; null when no price is known.
 */
function bestKnownPlan(
  subscriptions: readonly SubscriptionSnapshot[],
  priceMap: PriceMap,
): Extract<PlanDerivation, { kind: 'plan' }> | null {
  let best: Extract<PlanDerivation, { kind: 'plan' }> | null = null;
  let bestCreated = -Infinity;

  for (const subscription of subscriptions) {
    for (const priceId of subscription.priceIds) {
      const plan = priceMap.get(priceId);
      if (!plan) continue;
      const better =
        !best ||
        PLAN_RANK[plan] > PLAN_RANK[best.plan] ||
        (PLAN_RANK[plan] === PLAN_RANK[best.plan] && subscription.created > bestCreated);
      if (better) {
        best = { kind: 'plan', plan, subscriptionId: subscription.id, status: subscription.status };
        bestCreated = subscription.created;
      }
    }
  }
  return best;
}

/** Epoch seconds as an ISO timestamp, or null. */
function epochToIso(seconds: number | null): string | null {
  return seconds === null || !Number.isFinite(seconds) ? null : new Date(seconds * 1000).toISOString();
}
