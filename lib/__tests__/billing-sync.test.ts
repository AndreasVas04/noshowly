/**
 * lib/__tests__/billing-sync.test.ts
 *
 * Unit tests for keeping users.plan in step with Stripe (lib/billing/sync.ts)
 * against in-memory users and Stripe data: reading webhook events, finding
 * the user (linked customer, event user ids, customer metadata), conflicts,
 * the plan written for each subscription state, retries and repeated events,
 * concurrent plan changes and errors that must make Stripe retry.
 */

import { describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import { priceMapFromEnv, type SubscriptionSnapshot } from '@/lib/billing/subscriptions';
import {
  SYNC_ATTEMPTS,
  readBillingEvent,
  syncCustomerPlan,
  type BillingSyncDeps,
  type BillingUser,
} from '@/lib/billing/sync';
import type { CanonicalPlan } from '@/lib/plans';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB   = '22222222-2222-4222-8222-222222222222';

/** In-memory users table and Stripe account. */
class FakeBilling implements BillingSyncDeps {
  users = new Map<string, { plan: string; stripeCustomerId: string | null }>();
  subscriptions = new Map<string, SubscriptionSnapshot[]>();
  customerMetadata = new Map<string, string>();
  priceMap = priceMapFromEnv({ STRIPE_BASIC_PRICE_ID: 'price_basic', STRIPE_PRO_PRICE_ID: 'price_pro' });
  updateCalls = 0;
  linkCalls = 0;
  /** Runs before every compare-and-set, to simulate another request's write. */
  beforeUpdate: (() => void) | null = null;
  failListing = false;

  addUser(id: string, plan: string, stripeCustomerId: string | null = null): void {
    this.users.set(id, { plan, stripeCustomerId });
  }

  setSubscriptions(customerId: string, ...statuses: Array<[string, string?]>): void {
    this.subscriptions.set(customerId, statuses.map(([status, price = 'price_basic'], i) => ({
      id: `sub_${customerId}_${i}`,
      status,
      priceIds: [price],
      cancelAtPeriodEnd: false,
      cancelAt: null,
      currentPeriodEnd: null,
      created: 1_780_000_000 + i,
    })));
  }

  plan(id: string): string | undefined {
    return this.users.get(id)?.plan;
  }

  async findUsersByCustomer(customerId: string): Promise<BillingUser[]> {
    return [...this.users]
      .filter(([, user]) => user.stripeCustomerId === customerId)
      .slice(0, 2)
      .map(([id, user]) => ({ id, ...user }));
  }

  async findUserById(userId: string): Promise<BillingUser | null> {
    const user = this.users.get(userId);
    return user ? { id: userId, ...user } : null;
  }

  async linkCustomer(userId: string, customerId: string): Promise<string | null> {
    this.linkCalls++;
    const user = this.users.get(userId);
    if (!user) return null;
    if (user.stripeCustomerId === null) user.stripeCustomerId = customerId;
    return user.stripeCustomerId;
  }

  async updatePlan(userId: string, expected: string, next: CanonicalPlan): Promise<boolean> {
    this.beforeUpdate?.();
    this.updateCalls++;
    const user = this.users.get(userId);
    if (!user || user.plan !== expected) return false;
    user.plan = next;
    return true;
  }

  async listSubscriptions(customerId: string): Promise<SubscriptionSnapshot[]> {
    if (this.failListing) throw new Error('Stripe is unavailable');
    return this.subscriptions.get(customerId) ?? [];
  }

  async customerUserId(customerId: string): Promise<string | null> {
    return this.customerMetadata.get(customerId) ?? null;
  }
}

/** A minimal verified event. */
function event(type: string, object: Record<string, unknown>): Stripe.Event {
  return { id: 'evt_1', type, data: { object } } as unknown as Stripe.Event;
}

// ---------------------------------------------------------------------------
// readBillingEvent
// ---------------------------------------------------------------------------

describe('readBillingEvent', () => {
  it('reads the customer and user ids of a completed subscription checkout', () => {
    expect(readBillingEvent(event('checkout.session.completed', {
      mode: 'subscription',
      customer: 'cus_1',
      client_reference_id: ALICE,
      metadata: { user_id: ALICE.toUpperCase() },
    }))).toEqual({ customerId: 'cus_1', userIdHints: [ALICE] });
  });

  it('accepts the user id of sessions created before client_reference_id was set', () => {
    expect(readBillingEvent(event('checkout.session.completed', {
      mode: 'subscription', customer: { id: 'cus_1' }, client_reference_id: null,
      metadata: { noshowly_user_id: BOB },
    }))).toEqual({ customerId: 'cus_1', userIdHints: [BOB] });
  });

  it('ignores checkouts that are not subscriptions or have no customer', () => {
    expect(readBillingEvent(event('checkout.session.completed', { mode: 'payment', customer: 'cus_1' }))).toBeNull();
    expect(readBillingEvent(event('checkout.session.completed', { mode: 'subscription', customer: null }))).toBeNull();
  });

  it('reads subscription and invoice events, dropping user ids that are not UUIDs', () => {
    for (const type of ['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted']) {
      expect(readBillingEvent(event(type, { customer: 'cus_2', metadata: { user_id: 'not-a-user' } })))
        .toEqual({ customerId: 'cus_2', userIdHints: [] });
    }
    for (const type of ['invoice.paid', 'invoice.payment_succeeded', 'invoice.payment_failed']) {
      expect(readBillingEvent(event(type, { customer: { id: 'cus_3', deleted: true } })))
        .toEqual({ customerId: 'cus_3', userIdHints: [] });
    }
  });

  it('ignores other event types', () => {
    expect(readBillingEvent(event('customer.created', { id: 'cus_1' }))).toBeNull();
    expect(readBillingEvent(event('invoice.finalized', { customer: 'cus_1' }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// syncCustomerPlan
// ---------------------------------------------------------------------------

describe('syncCustomerPlan — plans', () => {
  it('upgrades a trial when the subscription is active', async () => {
    const stripe = new FakeBilling();
    stripe.addUser(ALICE, 'trial', 'cus_a');
    stripe.setSubscriptions('cus_a', ['active']);

    const result = await syncCustomerPlan(stripe, { customerId: 'cus_a', userIdHints: [] });
    expect(result).toMatchObject({ status: 'updated', userId: ALICE, from: 'trial', to: 'basic' });
    expect(stripe.plan(ALICE)).toBe('basic');
  });

  it('keeps the paid plan while the subscription is past_due', async () => {
    const stripe = new FakeBilling();
    stripe.addUser(ALICE, 'basic', 'cus_a');
    stripe.setSubscriptions('cus_a', ['past_due']);

    expect(await syncCustomerPlan(stripe, { customerId: 'cus_a', userIdHints: [] }))
      .toMatchObject({ status: 'unchanged', plan: 'basic' });
    expect(stripe.updateCalls).toBe(0);
  });

  it("cancels the plan once no subscription is live, and stays 'cancelled' on repeats", async () => {
    const stripe = new FakeBilling();
    stripe.addUser(ALICE, 'basic', 'cus_a');
    stripe.setSubscriptions('cus_a', ['canceled']);

    expect(await syncCustomerPlan(stripe, { customerId: 'cus_a', userIdHints: [] }))
      .toMatchObject({ status: 'updated', to: 'cancelled' });
    // A retry or a late event for the same customer changes nothing.
    expect(await syncCustomerPlan(stripe, { customerId: 'cus_a', userIdHints: [] }))
      .toMatchObject({ status: 'unchanged', plan: 'cancelled' });
  });

  it('applies the current state, not the order events arrive in', async () => {
    const stripe = new FakeBilling();
    stripe.addUser(ALICE, 'trial', 'cus_a');
    // The subscription was created and then cancelled; the 'created' event
    // arrives last. Every event syncs Stripe's current state.
    stripe.setSubscriptions('cus_a', ['canceled']);
    await syncCustomerPlan(stripe, { customerId: 'cus_a', userIdHints: [] }); // deleted
    await syncCustomerPlan(stripe, { customerId: 'cus_a', userIdHints: [] }); // created, late
    expect(stripe.plan(ALICE)).toBe('trial');

    stripe.addUser(BOB, 'basic', 'cus_b');
    stripe.setSubscriptions('cus_b', ['canceled'], ['active']);
    await syncCustomerPlan(stripe, { customerId: 'cus_b', userIdHints: [] }); // old subscription deleted, late
    expect(stripe.plan(BOB)).toBe('basic');
  });

  it('keeps a trial that never had a live subscription (e.g. a payment still pending)', async () => {
    const stripe = new FakeBilling();
    stripe.addUser(ALICE, 'trial', 'cus_a');
    stripe.setSubscriptions('cus_a', ['incomplete']);
    expect(await syncCustomerPlan(stripe, { customerId: 'cus_a', userIdHints: [] }))
      .toMatchObject({ status: 'unchanged', plan: 'trial' });
  });

  it('leaves the plan alone when the live subscription has a price no variable maps', async () => {
    const stripe = new FakeBilling();
    stripe.addUser(ALICE, 'trial', 'cus_a');
    stripe.setSubscriptions('cus_a', ['active', 'price_annual']);
    expect(await syncCustomerPlan(stripe, { customerId: 'cus_a', userIdHints: [] }))
      .toEqual({ status: 'unknown_price', userId: ALICE, priceIds: ['price_annual'] });
    expect(stripe.plan(ALICE)).toBe('trial');
    expect(stripe.updateCalls).toBe(0);
  });

  it('renames a legacy plan to its current name', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stripe = new FakeBilling();
    stripe.addUser(ALICE, 'starter', 'cus_a');
    stripe.setSubscriptions('cus_a', ['active']);
    expect(await syncCustomerPlan(stripe, { customerId: 'cus_a', userIdHints: [] }))
      .toMatchObject({ status: 'updated', from: 'starter', to: 'basic' });
    vi.restoreAllMocks();
  });
});

describe('syncCustomerPlan — finding the user', () => {
  it('links the customer through the user id in the event', async () => {
    const stripe = new FakeBilling();
    stripe.addUser(ALICE, 'trial');
    stripe.setSubscriptions('cus_a', ['active']);

    const result = await syncCustomerPlan(stripe, { customerId: 'cus_a', userIdHints: [ALICE] });
    expect(result).toMatchObject({ status: 'updated', userId: ALICE, to: 'basic' });
    expect(stripe.users.get(ALICE)?.stripeCustomerId).toBe('cus_a');
  });

  it("falls back to the Stripe customer's metadata user_id", async () => {
    const stripe = new FakeBilling();
    stripe.addUser(ALICE, 'trial');
    stripe.customerMetadata.set('cus_a', ALICE);
    stripe.setSubscriptions('cus_a', ['trialing']);

    expect(await syncCustomerPlan(stripe, { customerId: 'cus_a', userIdHints: [BOB] }))
      .toMatchObject({ status: 'updated', userId: ALICE, to: 'basic' });
    expect(stripe.users.get(ALICE)?.stripeCustomerId).toBe('cus_a');
  });

  it('reports a customer that no user can be found for', async () => {
    const stripe = new FakeBilling();
    stripe.customerMetadata.set('cus_x', 'not-a-uuid');
    expect(await syncCustomerPlan(stripe, { customerId: 'cus_x', userIdHints: [BOB] }))
      .toEqual({ status: 'unmapped', customerId: 'cus_x' });
  });

  it('never moves a user linked to another customer', async () => {
    const stripe = new FakeBilling();
    stripe.addUser(ALICE, 'basic', 'cus_original');
    stripe.setSubscriptions('cus_stray', ['canceled']);

    const result = await syncCustomerPlan(stripe, { customerId: 'cus_stray', userIdHints: [ALICE] });
    expect(result.status).toBe('conflict');
    expect(stripe.users.get(ALICE)).toEqual({ plan: 'basic', stripeCustomerId: 'cus_original' });
    expect(stripe.updateCalls).toBe(0);
  });

  it('reports a customer linked to several users instead of picking one', async () => {
    const stripe = new FakeBilling();
    stripe.addUser(ALICE, 'basic', 'cus_shared');
    stripe.addUser(BOB, 'basic', 'cus_shared');
    stripe.setSubscriptions('cus_shared', ['canceled']);
    expect((await syncCustomerPlan(stripe, { customerId: 'cus_shared', userIdHints: [] })).status).toBe('conflict');
    expect(stripe.plan(ALICE)).toBe('basic');
  });
});

describe('syncCustomerPlan — concurrency and errors', () => {
  it('derives again when users.plan changed after it was read', async () => {
    const stripe = new FakeBilling();
    stripe.addUser(ALICE, 'trial', 'cus_a');
    stripe.setSubscriptions('cus_a', ['active']);

    // Another event sets the plan and the subscription is cancelled just
    // before this sync writes.
    let interrupted = false;
    stripe.beforeUpdate = () => {
      if (interrupted) return;
      interrupted = true;
      stripe.users.get(ALICE)!.plan = 'basic';
      stripe.setSubscriptions('cus_a', ['canceled']);
    };

    const result = await syncCustomerPlan(stripe, { customerId: 'cus_a', userIdHints: [] });
    expect(result).toMatchObject({ status: 'updated', from: 'basic', to: 'cancelled' });
    expect(stripe.plan(ALICE)).toBe('cancelled');
  });

  it('gives up (so Stripe retries) when the plan keeps changing', async () => {
    const stripe = new FakeBilling();
    stripe.addUser(ALICE, 'trial', 'cus_a');
    stripe.setSubscriptions('cus_a', ['active']);
    let flip = 0;
    stripe.beforeUpdate = () => {
      stripe.users.get(ALICE)!.plan = flip++ % 2 === 0 ? 'cancelled' : 'trial';
    };

    await expect(syncCustomerPlan(stripe, { customerId: 'cus_a', userIdHints: [] })).rejects.toThrow(/kept changing/);
    expect(stripe.updateCalls).toBe(SYNC_ATTEMPTS);
  });

  it('throws when Stripe cannot be reached, so the webhook answers 500', async () => {
    const stripe = new FakeBilling();
    stripe.addUser(ALICE, 'basic', 'cus_a');
    stripe.failListing = true;
    await expect(syncCustomerPlan(stripe, { customerId: 'cus_a', userIdHints: [] })).rejects.toThrow('Stripe is unavailable');
    expect(stripe.plan(ALICE)).toBe('basic');
  });
});
