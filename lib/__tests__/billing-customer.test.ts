/**
 * lib/__tests__/billing-customer.test.ts
 *
 * Unit tests for the Stripe customer behind checkout and the billing portal
 * (lib/billing/customer.ts), against an in-memory users table and Stripe
 * account: reusing a working customer, refusing a second subscription,
 * replacing a stored customer that Stripe no longer has (deleted, or from
 * test mode) without ever overwriting one another request linked, retrying
 * a replacement that failed halfway, the idempotency keys, and the portal
 * unlinking such a customer so the owner is not sent back to it.
 */

import { describe, expect, it } from 'vitest';
import Stripe from 'stripe';
import type { SubscriptionSnapshot } from '@/lib/billing/subscriptions';
import {
  customerIdempotencyKey,
  isMissingStripeCustomer,
  isMissingStripeResource,
  openBillingPortal,
  prepareCheckoutCustomer,
  type BillingPortalDeps,
  type CheckoutCustomerDeps,
} from '@/lib/billing/customer';

const USER = '11111111-1111-4111-8111-111111111111';

/** Stripe's answer for a customer it does not have. */
function noSuchCustomer(customerId: string, param = 'customer'): Error {
  return new Stripe.errors.StripeInvalidRequestError({
    type: 'invalid_request_error',
    code: 'resource_missing',
    param,
    message: `No such customer: '${customerId}'`,
  });
}

/** A subscription in the given status. */
function subscription(id: string, status: string): SubscriptionSnapshot {
  return {
    id,
    status,
    priceIds: ['price_basic'],
    cancelAtPeriodEnd: false,
    cancelAt: null,
    currentPeriodEnd: null,
    created: 1_780_000_000,
  };
}

/** In-memory users.stripe_customer_id and Stripe customers. */
class FakeBilling implements CheckoutCustomerDeps, BillingPortalDeps {
  /** users.stripe_customer_id by user id. */
  stored = new Map<string, string | null>([[USER, null]]);
  /** Customers Stripe has; true when deleted. */
  customers = new Map<string, { deleted: boolean }>();
  subscriptions = new Map<string, SubscriptionSnapshot[]>();
  /** Idempotency keys Stripe has seen, and the customer each one created. */
  keys = new Map<string, string>();
  created: string[] = [];
  unlinkCalls: Array<[string, string]> = [];
  /** Runs before linkCustomer(), to simulate another request. */
  beforeLink: (() => void) | null = null;
  fail: Partial<Record<'exists' | 'list' | 'create' | 'link' | 'unlink' | 'portal', Error>> = {};

  async customerExists(customerId: string): Promise<boolean> {
    if (this.fail.exists) throw this.fail.exists;
    const customer = this.customers.get(customerId);
    return Boolean(customer && !customer.deleted);
  }

  async listSubscriptions(customerId: string): Promise<SubscriptionSnapshot[]> {
    if (this.fail.list) throw this.fail.list;
    return this.subscriptions.get(customerId) ?? [];
  }

  async createCustomer(idempotencyKey: string): Promise<string> {
    if (this.fail.create) throw this.fail.create;
    // Like Stripe: a key seen before answers with the customer it created,
    // even when that customer has been deleted since.
    const replayed = this.keys.get(idempotencyKey);
    if (replayed) return replayed;
    const id = `cus_new_${this.created.length + 1}`;
    this.created.push(id);
    this.customers.set(id, { deleted: false });
    this.keys.set(idempotencyKey, id);
    return id;
  }

  async linkCustomer(userId: string, customerId: string, replacing: string | null): Promise<string | null> {
    this.beforeLink?.();
    if (this.fail.link) throw this.fail.link;
    if (!this.stored.has(userId)) return null;
    const current = this.stored.get(userId) ?? null;
    if (current === null || (replacing !== null && current === replacing)) this.stored.set(userId, customerId);
    return this.stored.get(userId) ?? null;
  }

  async unlinkCustomer(userId: string, customerId: string): Promise<boolean> {
    this.unlinkCalls.push([userId, customerId]);
    if (this.fail.unlink) throw this.fail.unlink;
    if (this.stored.get(userId) !== customerId) return false;
    this.stored.set(userId, null);
    return true;
  }

  async createPortalSession(customerId: string): Promise<string> {
    if (this.fail.portal) throw this.fail.portal;
    if (!(await this.customerExists(customerId))) throw noSuchCustomer(customerId);
    return `https://billing.stripe.test/session/${customerId}`;
  }
}

/** Runs prepareCheckoutCustomer() for USER with what is stored now. */
function checkout(billing: FakeBilling, isPaid = false) {
  return prepareCheckoutCustomer(billing, {
    userId: USER,
    storedCustomerId: billing.stored.get(USER) ?? null,
    isPaid,
  });
}

describe('Stripe errors', () => {
  it('recognises "No such customer" for the request customer and for a retrieved customer', () => {
    expect(isMissingStripeCustomer(noSuchCustomer('cus_old'))).toBe(true);
    expect(isMissingStripeCustomer(noSuchCustomer('cus_old', 'id'))).toBe(true);
    expect(isMissingStripeCustomer({ code: 'resource_missing', param: 'customer', message: 'gone' })).toBe(true);
  });

  it('does not take another missing object or another error for a missing customer', () => {
    const noSuchPrice = new Stripe.errors.StripeInvalidRequestError({
      type: 'invalid_request_error',
      code: 'resource_missing',
      param: 'line_items[0][price]',
      message: "No such price: 'price_live'",
    });
    expect(isMissingStripeResource(noSuchPrice)).toBe(true);
    expect(isMissingStripeCustomer(noSuchPrice)).toBe(false);
    expect(isMissingStripeCustomer(new Stripe.errors.StripeInvalidRequestError({
      type: 'invalid_request_error',
      message: 'No configuration provided and your test mode default configuration has not been created.',
    }))).toBe(false);
    expect(isMissingStripeCustomer(new Error("No such customer: 'cus_old'"))).toBe(false);
    expect(isMissingStripeCustomer(null)).toBe(false);
    expect(isMissingStripeCustomer('resource_missing')).toBe(false);
  });
});

describe('customerIdempotencyKey', () => {
  it('uses one key per user, and a key of its own for each replaced customer', () => {
    expect(customerIdempotencyKey(USER, null)).toBe(`customer-${USER}`);
    expect(customerIdempotencyKey(USER, 'cus_old')).toBe(`customer-${USER}-replaces-cus_old`);
    expect(customerIdempotencyKey(USER, 'cus_other')).not.toBe(customerIdempotencyKey(USER, 'cus_old'));
  });
});

describe('prepareCheckoutCustomer', () => {
  it('creates and links a customer for an account without one', async () => {
    const billing = new FakeBilling();
    expect(await checkout(billing)).toEqual({ ok: true, customerId: 'cus_new_1', replacedCustomerId: null });
    expect(billing.stored.get(USER)).toBe('cus_new_1');
    expect([...billing.keys.keys()]).toEqual([`customer-${USER}`]);
  });

  it('reuses a stored customer that Stripe has, when it has no running subscription', async () => {
    const billing = new FakeBilling();
    billing.stored.set(USER, 'cus_1');
    billing.customers.set('cus_1', { deleted: false });
    billing.subscriptions.set('cus_1', [subscription('sub_old', 'canceled')]);

    expect(await checkout(billing)).toEqual({ ok: true, customerId: 'cus_1', replacedCustomerId: null });
    expect(billing.created).toEqual([]);
  });

  it('refuses a second subscription and a second plan', async () => {
    const billing = new FakeBilling();
    billing.stored.set(USER, 'cus_1');
    billing.customers.set('cus_1', { deleted: false });
    billing.subscriptions.set('cus_1', [subscription('sub_1', 'past_due')]);
    expect(await checkout(billing)).toEqual({ ok: false, reason: 'subscription_exists' });

    const paid = new FakeBilling();
    expect(await checkout(paid, true)).toEqual({ ok: false, reason: 'already_paid' });
    expect(paid.created).toEqual([]);
    expect(paid.stored.get(USER)).toBeNull();
  });

  it('replaces a stored customer from test mode that the live account does not know', async () => {
    const billing = new FakeBilling();
    billing.stored.set(USER, 'cus_test_old');

    expect(await checkout(billing)).toEqual({ ok: true, customerId: 'cus_new_1', replacedCustomerId: 'cus_test_old' });
    expect(billing.stored.get(USER)).toBe('cus_new_1');
    expect([...billing.keys.keys()]).toEqual([`customer-${USER}-replaces-cus_test_old`]);
  });

  it('replaces a customer deleted in Stripe, even one created with the plain key the same day', async () => {
    const billing = new FakeBilling();
    await checkout(billing);                        // cus_new_1, key customer-<user>
    billing.customers.set('cus_new_1', { deleted: true });

    const result = await checkout(billing);
    expect(result).toEqual({ ok: true, customerId: 'cus_new_2', replacedCustomerId: 'cus_new_1' });
    expect(billing.stored.get(USER)).toBe('cus_new_2');

    // The next checkout reuses the replacement.
    expect(await checkout(billing)).toEqual({ ok: true, customerId: 'cus_new_2', replacedCustomerId: null });
    expect(billing.created).toEqual(['cus_new_1', 'cus_new_2']);
  });

  it('keeps the missing customer stored until its replacement exists, and retries with the same key', async () => {
    const billing = new FakeBilling();
    billing.stored.set(USER, 'cus_gone');
    billing.fail.create = new Error('api down');
    expect(await checkout(billing)).toEqual({ ok: false, reason: 'stripe', message: 'api down' });
    expect(billing.stored.get(USER)).toBe('cus_gone');

    delete billing.fail.create;
    expect(await checkout(billing)).toEqual({ ok: true, customerId: 'cus_new_1', replacedCustomerId: 'cus_gone' });

    // Linking failed after Stripe created the replacement: the retry gets the same customer.
    const linkFails = new FakeBilling();
    linkFails.stored.set(USER, 'cus_gone');
    linkFails.fail.link = new Error('timeout');
    expect(await checkout(linkFails)).toEqual({ ok: false, reason: 'database', message: 'timeout' });
    delete linkFails.fail.link;
    expect(await checkout(linkFails)).toEqual({ ok: true, customerId: 'cus_new_1', replacedCustomerId: 'cus_gone' });
    expect(linkFails.created).toEqual(['cus_new_1']);
  });

  it('never overwrites a customer another request linked in place of the missing one', async () => {
    const billing = new FakeBilling();
    billing.stored.set(USER, 'cus_gone');

    // Both requests read cus_gone; the first replaces it before the second runs.
    const first = await checkout(billing);
    const second = await prepareCheckoutCustomer(billing, { userId: USER, storedCustomerId: 'cus_gone', isPaid: false });

    expect(first).toEqual({ ok: true, customerId: 'cus_new_1', replacedCustomerId: 'cus_gone' });
    expect(second).toEqual({ ok: true, customerId: 'cus_new_1', replacedCustomerId: 'cus_gone' });
    expect(billing.stored.get(USER)).toBe('cus_new_1');
    expect(billing.created).toEqual(['cus_new_1']);

    // Whatever else was linked meanwhile is kept, and checked for a subscription.
    const other = new FakeBilling();
    other.stored.set(USER, 'cus_gone');
    other.customers.set('cus_other', { deleted: false });
    other.subscriptions.set('cus_other', [subscription('sub_1', 'active')]);
    other.beforeLink = () => other.stored.set(USER, 'cus_other');
    expect(await checkout(other)).toEqual({ ok: false, reason: 'subscription_exists' });
    expect(other.stored.get(USER)).toBe('cus_other');
  });

  it('links the replacement when the missing customer was unlinked meanwhile', async () => {
    const billing = new FakeBilling();
    billing.stored.set(USER, 'cus_gone');
    billing.beforeLink = () => billing.stored.set(USER, null);   // e.g. by the billing portal
    expect(await checkout(billing)).toEqual({ ok: true, customerId: 'cus_new_1', replacedCustomerId: 'cus_gone' });
    expect(billing.stored.get(USER)).toBe('cus_new_1');
  });

  it('recovers on the next attempt when the plain key replays a customer deleted since', async () => {
    const billing = new FakeBilling();
    await checkout(billing);                        // cus_new_1, key customer-<user>
    billing.customers.set('cus_new_1', { deleted: true });
    billing.stored.set(USER, null);                 // unlinked by the billing portal

    // Stripe answers the plain key with the deleted customer; its Checkout
    // session fails, and the next attempt finds it missing and replaces it.
    expect(await checkout(billing)).toEqual({ ok: true, customerId: 'cus_new_1', replacedCustomerId: null });
    expect(await checkout(billing)).toEqual({ ok: true, customerId: 'cus_new_2', replacedCustomerId: 'cus_new_1' });
  });

  it('uses and checks a customer another request linked while this one created its own', async () => {
    const billing = new FakeBilling();
    billing.customers.set('cus_other', { deleted: false });
    billing.beforeLink = () => billing.stored.set(USER, 'cus_other');
    expect(await checkout(billing)).toEqual({ ok: true, customerId: 'cus_other', replacedCustomerId: null });

    const subscribed = new FakeBilling();
    subscribed.customers.set('cus_other', { deleted: false });
    subscribed.subscriptions.set('cus_other', [subscription('sub_1', 'active')]);
    subscribed.beforeLink = () => subscribed.stored.set(USER, 'cus_other');
    expect(await checkout(subscribed)).toEqual({ ok: false, reason: 'subscription_exists' });
  });

  it('refuses a paid account with a missing customer without creating a new one', async () => {
    const billing = new FakeBilling();
    billing.stored.set(USER, 'cus_gone');
    expect(await checkout(billing, true)).toEqual({ ok: false, reason: 'already_paid' });
    expect(billing.created).toEqual([]);
  });

  it('reports Stripe and database failures without creating or changing anything it should not', async () => {
    const stripeDown = new FakeBilling();
    stripeDown.stored.set(USER, 'cus_1');
    stripeDown.fail.exists = new Error('connection reset');
    expect(await checkout(stripeDown)).toEqual({ ok: false, reason: 'stripe', message: 'connection reset' });
    expect(stripeDown.created).toEqual([]);
    expect(stripeDown.stored.get(USER)).toBe('cus_1');

    const listFails = new FakeBilling();
    listFails.stored.set(USER, 'cus_1');
    listFails.customers.set('cus_1', { deleted: false });
    listFails.fail.list = new Error('rate limited');
    expect(await checkout(listFails)).toEqual({ ok: false, reason: 'stripe', message: 'rate limited' });

    const createFails = new FakeBilling();
    createFails.fail.create = new Error('api down');
    expect(await checkout(createFails)).toEqual({ ok: false, reason: 'stripe', message: 'api down' });

    const linkFails = new FakeBilling();
    linkFails.fail.link = new Error('permission denied');
    expect(await checkout(linkFails)).toEqual({ ok: false, reason: 'database', message: 'permission denied' });

    const rowGone = new FakeBilling();
    rowGone.stored.delete(USER);
    const result = await prepareCheckoutCustomer(rowGone, { userId: USER, storedCustomerId: null, isPaid: false });
    expect(result).toMatchObject({ ok: false, reason: 'database' });
  });
});

describe('openBillingPortal', () => {
  it('opens the portal for a customer Stripe has', async () => {
    const billing = new FakeBilling();
    billing.stored.set(USER, 'cus_1');
    billing.customers.set('cus_1', { deleted: false });

    expect(await openBillingPortal(billing, USER, 'cus_1'))
      .toEqual({ ok: true, url: 'https://billing.stripe.test/session/cus_1' });
    expect(billing.unlinkCalls).toEqual([]);
  });

  it('unlinks a customer Stripe no longer has, so the owner is offered a plan next time', async () => {
    const billing = new FakeBilling();
    billing.stored.set(USER, 'cus_test_old');

    expect(await openBillingPortal(billing, USER, 'cus_test_old'))
      .toEqual({ ok: false, reason: 'customer_missing', unlinkError: null });
    expect(billing.stored.get(USER)).toBeNull();

    // With nothing stored, checkout creates a new customer instead of failing.
    expect(await checkout(billing)).toEqual({ ok: true, customerId: 'cus_new_1', replacedCustomerId: null });
  });

  it('keeps a customer that was linked meanwhile', async () => {
    const billing = new FakeBilling();
    billing.stored.set(USER, 'cus_new');
    expect(await openBillingPortal(billing, USER, 'cus_gone'))
      .toEqual({ ok: false, reason: 'customer_missing', unlinkError: null });
    expect(billing.stored.get(USER)).toBe('cus_new');
  });

  it('reports an unlink failure, and leaves other Stripe errors alone', async () => {
    const unlinkFails = new FakeBilling();
    unlinkFails.stored.set(USER, 'cus_gone');
    unlinkFails.fail.unlink = new Error('timeout');
    expect(await openBillingPortal(unlinkFails, USER, 'cus_gone'))
      .toEqual({ ok: false, reason: 'customer_missing', unlinkError: 'timeout' });

    const notConfigured = new FakeBilling();
    notConfigured.stored.set(USER, 'cus_1');
    notConfigured.customers.set('cus_1', { deleted: false });
    notConfigured.fail.portal = new Stripe.errors.StripeInvalidRequestError({
      type: 'invalid_request_error',
      message: 'No configuration provided and your live mode default configuration has not been created.',
    });
    expect(await openBillingPortal(notConfigured, USER, 'cus_1')).toEqual({
      ok: false,
      reason: 'stripe',
      message: 'No configuration provided and your live mode default configuration has not been created.',
    });
    expect(notConfigured.unlinkCalls).toEqual([]);
    expect(notConfigured.stored.get(USER)).toBe('cus_1');
  });
});
