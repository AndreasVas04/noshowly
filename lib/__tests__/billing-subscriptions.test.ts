/**
 * lib/__tests__/billing-subscriptions.test.ts
 *
 * Unit tests for the pure Stripe subscription rules in
 * lib/billing/subscriptions.ts: the price → plan map, deriving the plan from
 * a customer's subscriptions (active, trialing, past_due, canceled, several
 * subscriptions, unknown prices), the plan stored after a sync, the checkout
 * guard, the subscription shown in Settings and the ones account deletion
 * cancels.
 */

import { describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import {
  decideCheckout,
  derivePlanFromSubscriptions,
  pickDisplaySubscription,
  planAfterSync,
  priceMapFromEnv,
  subscriptionsToCancel,
  toBillingSubscription,
  toSubscriptionSnapshot,
  type SubscriptionSnapshot,
} from '@/lib/billing/subscriptions';

const PRICES = priceMapFromEnv({
  STRIPE_BASIC_PRICE_ID:    'price_basic',
  STRIPE_PRO_PRICE_ID:      'price_pro',
  STRIPE_BUSINESS_PRICE_ID: 'price_business',
});

let created = 1_780_000_000;

/** A subscription snapshot; each call is created one second after the previous one. */
function sub(status: string, priceIds: string[] = ['price_basic'], extra: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot {
  created += 1;
  return {
    id: `sub_${created}`,
    status,
    priceIds,
    cancelAtPeriodEnd: false,
    cancelAt: null,
    currentPeriodEnd: created + 30 * 86_400,
    created,
    ...extra,
  };
}

describe('priceMapFromEnv', () => {
  it('maps each configured price to its plan and skips unset variables', () => {
    const map = priceMapFromEnv({
      STRIPE_BASIC_PRICE_ID: ' price_b ',
      STRIPE_PRO_PRICE_ID: '',
      STRIPE_STARTER_PRICE_ID: 'price_old_starter',
      STRIPE_PROFESSIONAL_PRICE_ID: 'price_old_pro',
    });
    expect(map.get('price_b')).toBe('basic');
    expect(map.get('price_old_starter')).toBe('basic');
    expect(map.get('price_old_pro')).toBe('pro');
    expect(map.size).toBe(3);
  });

  it('keeps the first plan when two variables hold the same price', () => {
    const map = priceMapFromEnv({ STRIPE_BASIC_PRICE_ID: 'price_x', STRIPE_BUSINESS_PRICE_ID: 'price_x' });
    expect(map.get('price_x')).toBe('basic');
  });
});

describe('toSubscriptionSnapshot', () => {
  it('reads the fields the rules need, the period end from the items', () => {
    const stripeSubscription = {
      id: 'sub_1',
      status: 'active',
      cancel_at_period_end: true,
      cancel_at: 1_790_000_000,
      created: 1_780_000_000,
      items: {
        data: [
          { price: { id: 'price_basic' }, current_period_end: 1_790_000_000 },
          { price: { id: 'price_addon' }, current_period_end: 1_790_000_500 },
        ],
      },
    } as unknown as Stripe.Subscription;

    expect(toSubscriptionSnapshot(stripeSubscription)).toEqual({
      id: 'sub_1',
      status: 'active',
      priceIds: ['price_basic', 'price_addon'],
      cancelAtPeriodEnd: true,
      cancelAt: 1_790_000_000,
      currentPeriodEnd: 1_790_000_500,
      created: 1_780_000_000,
    });
  });
});

describe('derivePlanFromSubscriptions', () => {
  it('gives the plan of an active or trialing subscription', () => {
    const active = sub('active');
    expect(derivePlanFromSubscriptions([active], PRICES)).toEqual({
      kind: 'plan', plan: 'basic', subscriptionId: active.id, status: 'active',
    });
    expect(derivePlanFromSubscriptions([sub('trialing', ['price_pro'])], PRICES)).toMatchObject({
      kind: 'plan', plan: 'pro', status: 'trialing',
    });
  });

  it('keeps the plan while a subscription is past_due (grace period)', () => {
    expect(derivePlanFromSubscriptions([sub('past_due')], PRICES)).toMatchObject({
      kind: 'plan', plan: 'basic', status: 'past_due',
    });
  });

  it('gives no plan when every subscription has ended or stopped', () => {
    for (const status of ['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused']) {
      expect(derivePlanFromSubscriptions([sub(status)], PRICES)).toEqual({ kind: 'none' });
    }
    expect(derivePlanFromSubscriptions([], PRICES)).toEqual({ kind: 'none' });
  });

  it('looks at every subscription, whatever their order', () => {
    const oldCanceled = sub('canceled', ['price_business']);
    const current = sub('active');
    const expected = { kind: 'plan', plan: 'basic', subscriptionId: current.id, status: 'active' };
    expect(derivePlanFromSubscriptions([oldCanceled, current], PRICES)).toEqual(expected);
    expect(derivePlanFromSubscriptions([current, oldCanceled], PRICES)).toEqual(expected);
  });

  it('prefers a paid-up subscription over a past_due one, and the highest plan among several', () => {
    expect(derivePlanFromSubscriptions([sub('past_due', ['price_business']), sub('active')], PRICES))
      .toMatchObject({ plan: 'basic', status: 'active' });
    expect(derivePlanFromSubscriptions([sub('active'), sub('active', ['price_pro'])], PRICES))
      .toMatchObject({ plan: 'pro' });
  });

  it('reports a live subscription whose prices are not configured instead of guessing', () => {
    const unknown = sub('active', ['price_annual']);
    expect(derivePlanFromSubscriptions([unknown, sub('canceled')], PRICES)).toEqual({
      kind: 'unknown_price', subscriptionIds: [unknown.id], priceIds: ['price_annual'],
    });
  });

  it('uses a known price when another live subscription has an unknown one', () => {
    expect(derivePlanFromSubscriptions([sub('active', ['price_annual']), sub('past_due')], PRICES))
      .toMatchObject({ kind: 'plan', plan: 'basic', status: 'past_due' });
    expect(derivePlanFromSubscriptions([sub('active', ['price_annual', 'price_pro'])], PRICES))
      .toMatchObject({ kind: 'plan', plan: 'pro' });
  });
});

describe('planAfterSync', () => {
  const none = { kind: 'none' } as const;
  const basic = { kind: 'plan', plan: 'basic', subscriptionId: 'sub_1', status: 'active' } as const;

  it('stores the subscription plan', () => {
    for (const current of ['trial', 'cancelled', 'basic', 'business'] as const) {
      expect(planAfterSync(current, basic)).toBe('basic');
    }
  });

  it("cancels a paid plan without a live subscription, but keeps a trial that never had one", () => {
    expect(planAfterSync('basic', none)).toBe('cancelled');
    expect(planAfterSync('pro', none)).toBe('cancelled');
    expect(planAfterSync('cancelled', none)).toBe('cancelled');
    expect(planAfterSync('trial', none)).toBe('trial');
  });

  it('leaves the plan alone for unknown prices', () => {
    expect(planAfterSync('basic', { kind: 'unknown_price', subscriptionIds: ['s'], priceIds: ['p'] })).toBeNull();
  });
});

describe('decideCheckout', () => {
  it('allows a checkout without a live subscription or paid plan', () => {
    expect(decideCheckout({ isPaid: false, subscriptions: [] })).toEqual({ allowed: true });
    expect(decideCheckout({ isPaid: false, subscriptions: [sub('canceled'), sub('incomplete_expired')] }))
      .toEqual({ allowed: true });
  });

  it('refuses a second subscription while one is active, trialing or past_due', () => {
    for (const status of ['active', 'trialing', 'past_due']) {
      const live = sub(status);
      expect(decideCheckout({ isPaid: false, subscriptions: [sub('canceled'), live] })).toEqual({
        allowed: false, reason: 'subscription_exists', subscriptionId: live.id,
      });
    }
  });

  it('refuses a checkout for an account that already has a paid plan', () => {
    expect(decideCheckout({ isPaid: true, subscriptions: [] })).toEqual({ allowed: false, reason: 'already_paid' });
  });
});

describe('pickDisplaySubscription and toBillingSubscription', () => {
  it('shows the newest paid-up subscription first, then past_due, then one that has not ended', () => {
    const oldActive = sub('active');
    const pastDue = sub('past_due');
    const newActive = sub('active');
    expect(pickDisplaySubscription([oldActive, pastDue, newActive])).toBe(newActive);
    expect(pickDisplaySubscription([sub('canceled'), pastDue])).toBe(pastDue);

    const unpaid = sub('unpaid');
    expect(pickDisplaySubscription([sub('canceled'), unpaid])).toBe(unpaid);
    expect(pickDisplaySubscription([sub('canceled'), sub('incomplete_expired')])).toBeNull();
  });

  it('converts timestamps to ISO strings', () => {
    const shown = sub('active', ['price_basic'], { cancelAtPeriodEnd: true, cancelAt: 1_790_000_000, currentPeriodEnd: 1_790_000_000 });
    expect(toBillingSubscription(shown)).toEqual({
      status: 'active',
      cancelAtPeriodEnd: true,
      currentPeriodEnd: new Date(1_790_000_000 * 1000).toISOString(),
      cancelAt: new Date(1_790_000_000 * 1000).toISOString(),
    });
    expect(toBillingSubscription(sub('active', [], { currentPeriodEnd: null })).currentPeriodEnd).toBeNull();
  });
});

describe('subscriptionsToCancel', () => {
  it('cancels every subscription that has not ended', () => {
    const subscriptions = ['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused', 'canceled', 'incomplete_expired']
      .map((status) => sub(status));
    expect(subscriptionsToCancel(subscriptions).map((s) => s.status)).toEqual([
      'active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused',
    ]);
  });
});
