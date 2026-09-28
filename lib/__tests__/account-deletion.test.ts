/**
 * lib/__tests__/account-deletion.test.ts
 *
 * Unit tests for deleting an account (lib/account.ts deleteAccount and
 * removeStaffPhotos) with fake Stripe and Supabase operations: subscriptions
 * are cancelled before anything is deleted, a Stripe failure deletes
 * nothing, staff photos are removed on a best-effort basis and the auth user
 * is deleted last.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { deleteAccount, removeStaffPhotos, STAFF_PHOTO_BUCKET, type AccountDeletionDeps } from '@/lib/account';
import type { SubscriptionSnapshot } from '@/lib/billing/subscriptions';

const USER_ID = '11111111-1111-4111-8111-111111111111';

/** A subscription snapshot with the given status. */
function sub(id: string, status: string): SubscriptionSnapshot {
  return { id, status, priceIds: ['price_basic'], cancelAtPeriodEnd: false, cancelAt: null, currentPeriodEnd: null, created: 1 };
}

/** Fake deletion dependencies that record every call in order. */
function fakeDeps(
  subscriptions: SubscriptionSnapshot[],
  failures: Partial<Record<'list' | 'cancel' | 'photos' | 'auth', string>> & { cancelId?: string } = {},
) {
  const calls: string[] = [];
  const deps: AccountDeletionDeps = {
    async listSubscriptions(customerId) {
      calls.push(`list:${customerId}`);
      if (failures.list) throw new Error(failures.list);
      return subscriptions;
    },
    async cancelSubscription(id) {
      calls.push(`cancel:${id}`);
      if (failures.cancel && (!failures.cancelId || failures.cancelId === id)) throw new Error(failures.cancel);
    },
    async removeStaffPhotos(userId) {
      calls.push(`photos:${userId}`);
      if (failures.photos) throw new Error(failures.photos);
      return 2;
    },
    async deleteAuthUser(userId) {
      calls.push(`auth:${userId}`);
      if (failures.auth) throw new Error(failures.auth);
    },
  };
  return { deps, calls };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('deleteAccount', () => {
  it('cancels live subscriptions, removes photos, then deletes the auth user', async () => {
    const { deps, calls } = fakeDeps([
      sub('sub_old', 'canceled'),
      sub('sub_live', 'active'),
      sub('sub_expired', 'incomplete_expired'),
      sub('sub_unpaid', 'unpaid'),
    ]);

    const result = await deleteAccount(deps, { userId: USER_ID, stripeCustomerId: 'cus_1' });
    expect(result).toEqual({ ok: true, cancelledSubscriptions: ['sub_live', 'sub_unpaid'], photosRemoved: 2 });
    expect(calls).toEqual([
      'list:cus_1',
      'cancel:sub_live',
      'cancel:sub_unpaid',
      `photos:${USER_ID}`,
      `auth:${USER_ID}`,
    ]);
  });

  it('skips Stripe for an account that never had a customer', async () => {
    const { deps, calls } = fakeDeps([]);
    expect(await deleteAccount(deps, { userId: USER_ID, stripeCustomerId: null }))
      .toEqual({ ok: true, cancelledSubscriptions: [], photosRemoved: 2 });
    expect(calls).toEqual([`photos:${USER_ID}`, `auth:${USER_ID}`]);
  });

  it('deletes nothing when the subscriptions cannot be listed', async () => {
    const { deps, calls } = fakeDeps([sub('sub_live', 'active')], { list: 'Stripe is down' });
    expect(await deleteAccount(deps, { userId: USER_ID, stripeCustomerId: 'cus_1' }))
      .toEqual({ ok: false, step: 'billing', message: 'Stripe is down', cancelledSubscriptions: [] });
    expect(calls).toEqual(['list:cus_1']);
  });

  it('deletes nothing when a cancellation fails, and reports what was already cancelled', async () => {
    const { deps, calls } = fakeDeps(
      [sub('sub_a', 'active'), sub('sub_b', 'past_due')],
      { cancel: 'card_declined', cancelId: 'sub_b' },
    );
    expect(await deleteAccount(deps, { userId: USER_ID, stripeCustomerId: 'cus_1' }))
      .toEqual({ ok: false, step: 'billing', message: 'card_declined', cancelledSubscriptions: ['sub_a'] });
    expect(calls).not.toContain(`auth:${USER_ID}`);
    expect(calls).not.toContain(`photos:${USER_ID}`);
  });

  it('still deletes the account when the photos cannot be removed', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { deps, calls } = fakeDeps([], { photos: 'storage unavailable' });
    expect(await deleteAccount(deps, { userId: USER_ID, stripeCustomerId: null }))
      .toEqual({ ok: true, cancelledSubscriptions: [], photosRemoved: null });
    expect(calls).toContain(`auth:${USER_ID}`);
    expect(error).toHaveBeenCalled();
  });

  it('reports a failed auth deletion after the subscriptions were cancelled', async () => {
    const { deps } = fakeDeps([sub('sub_live', 'active')], { auth: 'User not allowed' });
    expect(await deleteAccount(deps, { userId: USER_ID, stripeCustomerId: 'cus_1' }))
      .toEqual({ ok: false, step: 'delete', message: 'User not allowed', cancelledSubscriptions: ['sub_live'] });
  });
});

// ---------------------------------------------------------------------------
// removeStaffPhotos
// ---------------------------------------------------------------------------

type Entry = { name: string; id: string | null };

/** Fake Supabase Storage bucket holding the owner's folder. */
function fakeStorage(names: string[], failures: { list?: string; remove?: string } = {}) {
  const files: Entry[] = names.map((name, i) => ({ name, id: `file-${i}` }));
  const removed: string[][] = [];
  const client = {
    storage: {
      from(bucket: string) {
        expect(bucket).toBe(STAFF_PHOTO_BUCKET);
        return {
          async list(prefix: string, options: { limit: number }) {
            expect(prefix).toBe(USER_ID);
            if (failures.list) return { data: null, error: { message: failures.list } };
            // A folder entry (id null) is listed first, like a nested folder would be.
            const page: Entry[] = [{ name: 'nested', id: null }, ...files].slice(0, options.limit);
            return { data: page, error: null };
          },
          async remove(paths: string[]) {
            if (failures.remove) return { data: null, error: { message: failures.remove } };
            removed.push(paths);
            for (const path of paths) {
              const index = files.findIndex((f) => `${USER_ID}/${f.name}` === path);
              if (index !== -1) files.splice(index, 1);
            }
            return { data: [], error: null };
          },
        };
      },
    },
  };
  return { client: client as unknown as Parameters<typeof removeStaffPhotos>[0], removed, files };
}

describe('removeStaffPhotos', () => {
  it("removes every file in the owner's folder, page by page", async () => {
    const names = Array.from({ length: 150 }, (_, i) => `photo-${i}.jpg`);
    const storage = fakeStorage(names);
    expect(await removeStaffPhotos(storage.client, USER_ID)).toBe(150);
    expect(storage.files).toHaveLength(0);
    expect(storage.removed[0][0]).toBe(`${USER_ID}/photo-0.jpg`);
    expect(storage.removed.flat()).not.toContain(`${USER_ID}/nested`);
  });

  it('does nothing for an owner without photos', async () => {
    const storage = fakeStorage([]);
    expect(await removeStaffPhotos(storage.client, USER_ID)).toBe(0);
    expect(storage.removed).toEqual([]);
  });

  it('throws when listing or removing fails', async () => {
    await expect(removeStaffPhotos(fakeStorage(['a.jpg'], { list: 'denied' }).client, USER_ID)).rejects.toThrow('denied');
    await expect(removeStaffPhotos(fakeStorage(['a.jpg'], { remove: 'denied' }).client, USER_ID)).rejects.toThrow('denied');
  });
});
