/**
 * lib/__tests__/billing-server.test.ts
 *
 * Unit tests for the Stripe and database calls in lib/billing/server.ts that
 * replace a customer Stripe no longer has: stripeCustomerExists() (deleted
 * customers and customers from the other mode) and unlinkStripeCustomer(),
 * which may only clear users.stripe_customer_id while it still holds that
 * customer. Stripe and Supabase are replaced by recording fakes.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import type { AdminSupabaseClient } from '@/lib/supabase/admin';

const fakeStripe = vi.hoisted(() => ({ customers: { retrieve: vi.fn() } }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/stripe', () => ({ stripe: fakeStripe }));

import { linkStripeCustomer, stripeCustomerExists, unlinkStripeCustomer } from '@/lib/billing/server';

const USER = '11111111-1111-4111-8111-111111111111';

type Call = { method: string; args: unknown[] };

/**
 * A stand-in for the Supabase query builder: every method records its call
 * and returns the builder; awaiting it resolves to `result`.
 */
function recordingClient(result: { data?: unknown; error?: { message: string } | null }) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['from', 'select', 'update', 'eq', 'is', 'maybeSingle']) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.then = (resolve: (value: unknown) => unknown) =>
    resolve({ data: result.data ?? null, error: result.error ?? null });
  return { client: builder as unknown as AdminSupabaseClient, calls };
}

describe('linkStripeCustomer', () => {
  it('links a customer only to a user without one', async () => {
    const { client, calls } = recordingClient({ data: { stripe_customer_id: 'cus_new' } });
    expect(await linkStripeCustomer(client, USER, 'cus_new')).toBe('cus_new');

    expect(calls).toContainEqual({ method: 'update', args: [{ stripe_customer_id: 'cus_new' }] });
    expect(calls).toContainEqual({ method: 'is', args: ['stripe_customer_id', null] });
    expect(calls.filter((c) => c.method === 'eq' && c.args[0] === 'stripe_customer_id')).toEqual([]);
  });

  it('replaces a missing customer only while it is still the stored one, or the row is empty', async () => {
    const { client, calls } = recordingClient({ data: { stripe_customer_id: 'cus_new' } });
    expect(await linkStripeCustomer(client, USER, 'cus_new', 'cus_gone')).toBe('cus_new');

    const updates = calls.filter((c) => c.method === 'update');
    expect(updates).toEqual([
      { method: 'update', args: [{ stripe_customer_id: 'cus_new' }] },
      { method: 'update', args: [{ stripe_customer_id: 'cus_new' }] },
    ]);
    expect(calls).toContainEqual({ method: 'eq', args: ['stripe_customer_id', 'cus_gone'] });
    expect(calls).toContainEqual({ method: 'is', args: ['stripe_customer_id', null] });
    // Never an unconditional write: every update is scoped to the user and a stored value.
    expect(calls.filter((c) => c.method === 'eq' && c.args[0] === 'id')).toHaveLength(3);
  });
});

describe('unlinkStripeCustomer', () => {
  it('clears the customer only on the user row that still holds it', async () => {
    const { client, calls } = recordingClient({ data: [{ id: USER }] });
    expect(await unlinkStripeCustomer(client, USER, 'cus_old')).toBe(true);

    expect(calls[0]).toEqual({ method: 'from', args: ['users'] });
    expect(calls).toContainEqual({ method: 'update', args: [{ stripe_customer_id: null }] });
    expect(calls).toContainEqual({ method: 'eq', args: ['id', USER] });
    expect(calls).toContainEqual({ method: 'eq', args: ['stripe_customer_id', 'cus_old'] });
  });

  it('reports false when the row holds another customer by now', async () => {
    const { client } = recordingClient({ data: [] });
    expect(await unlinkStripeCustomer(client, USER, 'cus_old')).toBe(false);
  });

  it('throws on a database error', async () => {
    const { client } = recordingClient({ error: { message: 'permission denied' } });
    await expect(unlinkStripeCustomer(client, USER, 'cus_old')).rejects.toThrow('permission denied');
  });
});

describe('stripeCustomerExists', () => {
  beforeEach(() => {
    fakeStripe.customers.retrieve.mockReset();
  });

  it('is true for a customer Stripe has', async () => {
    fakeStripe.customers.retrieve.mockResolvedValue({ id: 'cus_1', object: 'customer', metadata: {} });
    expect(await stripeCustomerExists('cus_1')).toBe(true);
    expect(fakeStripe.customers.retrieve).toHaveBeenCalledWith('cus_1');
  });

  it('is false for a deleted customer and for one this account and mode do not know', async () => {
    fakeStripe.customers.retrieve.mockResolvedValueOnce({ id: 'cus_1', object: 'customer', deleted: true });
    expect(await stripeCustomerExists('cus_1')).toBe(false);

    fakeStripe.customers.retrieve.mockRejectedValueOnce(new Stripe.errors.StripeInvalidRequestError({
      type: 'invalid_request_error',
      code: 'resource_missing',
      param: 'id',
      message: "No such customer: 'cus_test'; a similar object exists in test mode, but a live mode key was used to make this request.",
    }));
    expect(await stripeCustomerExists('cus_test')).toBe(false);
  });

  it('throws any other Stripe error, so checkout answers 502 instead of replacing the customer', async () => {
    fakeStripe.customers.retrieve.mockRejectedValueOnce(new Stripe.errors.StripeConnectionError({
      type: 'api_error',
      message: 'An error occurred with our connection to Stripe.',
    }));
    await expect(stripeCustomerExists('cus_1')).rejects.toThrow('connection to Stripe');
  });
});
