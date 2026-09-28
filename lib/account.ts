/**
 * lib/account.ts
 *
 * Deleting an account (deleteAccount).
 *
 * deleteAccount() cancels the owner's Stripe subscriptions first and stops
 * without deleting anything when that fails, so nobody keeps paying for a
 * deleted account. It then removes the owner's staff photos (best effort)
 * and deletes the auth user; foreign keys cascade to users → salons → every
 * salon table, so there is never a login left without a salon.
 *
 * Stripe and Supabase access is passed in, so the logic is tested without them.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types';
import { subscriptionsToCancel, type SubscriptionSnapshot } from '@/lib/billing/subscriptions';

type Db = SupabaseClient<Database>;

// ---------------------------------------------------------------------------
// Types and constants
// ---------------------------------------------------------------------------

/** Supabase Storage bucket of staff photos; files live under `<userId>/`. */
export const STAFF_PHOTO_BUCKET = 'staff-photos';

/** Files listed per request when removing staff photos. */
const PHOTO_PAGE_SIZE = 100;

/** Most listing rounds when removing staff photos (a safety stop). */
const MAX_PHOTO_PAGES = 50;

/** Stripe and Supabase operations for deleteAccount(). Methods throw on errors. */
export interface AccountDeletionDeps {
  /** Every subscription of the customer, any status. */
  listSubscriptions(customerId: string): Promise<SubscriptionSnapshot[]>;
  /** Cancels a subscription immediately. */
  cancelSubscription(subscriptionId: string): Promise<void>;
  /** Removes the owner's staff photos; returns how many files were removed. */
  removeStaffPhotos(userId: string): Promise<number>;
  /** Deletes the auth user (cascades to users → salons → salon data). */
  deleteAuthUser(userId: string): Promise<void>;
}

/** Result of deleteAccount(). */
export type AccountDeletionResult =
  | { ok: true; cancelledSubscriptions: string[]; photosRemoved: number | null }
  /** A subscription could not be cancelled; nothing was deleted. */
  | { ok: false; step: 'billing'; message: string; cancelledSubscriptions: string[] }
  /** Subscriptions were cancelled but the auth user could not be deleted. */
  | { ok: false; step: 'delete'; message: string; cancelledSubscriptions: string[] };

// ---------------------------------------------------------------------------
// Deleting an account
// ---------------------------------------------------------------------------

/**
 * Deletes an account:
 *  1. cancels every subscription of the Stripe customer that has not ended;
 *     if Stripe fails, stops before anything is deleted;
 *  2. removes the owner's staff photos (best effort, logged);
 *  3. deletes the auth user, which cascades to users → salons → all salon
 *     data (appointments, clients, staff, services, reminders, booking page).
 *
 * @param deps    - Stripe and Supabase operations.
 * @param account - The user and their Stripe customer (null when none).
 */
export async function deleteAccount(
  deps: AccountDeletionDeps,
  account: { userId: string; stripeCustomerId: string | null },
): Promise<AccountDeletionResult> {
  const log = `[account] user=${account.userId}`;
  const cancelled: string[] = [];

  // Step 1: Cancel subscriptions before anything is deleted.
  if (account.stripeCustomerId) {
    try {
      const subscriptions = await deps.listSubscriptions(account.stripeCustomerId);
      for (const subscription of subscriptionsToCancel(subscriptions)) {
        await deps.cancelSubscription(subscription.id);
        cancelled.push(subscription.id);
      }
    } catch (err) {
      return { ok: false, step: 'billing', message: errorMessage(err), cancelledSubscriptions: cancelled };
    }
  }

  // Step 2: Staff photos. Storage is not covered by the cascade.
  let photosRemoved: number | null = null;
  try {
    photosRemoved = await deps.removeStaffPhotos(account.userId);
  } catch (err) {
    console.error(`${log} WARN — staff photos were not removed:`, errorMessage(err));
  }

  // Step 3: The auth user; the foreign keys delete everything else.
  try {
    await deps.deleteAuthUser(account.userId);
  } catch (err) {
    return { ok: false, step: 'delete', message: errorMessage(err), cancelledSubscriptions: cancelled };
  }

  return { ok: true, cancelledSubscriptions: cancelled, photosRemoved };
}

/**
 * Removes every file under `<userId>/` in the staff photo bucket
 * (the path /api/upload/staff-photo writes to).
 *
 * @param db     - Service-role client.
 * @param userId - Owner whose photos are removed.
 * @returns How many files were removed.
 * @throws Error when listing or removing fails.
 */
export async function removeStaffPhotos(db: Db, userId: string): Promise<number> {
  const bucket = db.storage.from(STAFF_PHOTO_BUCKET);
  let removed = 0;

  for (let page = 0; page < MAX_PHOTO_PAGES; page++) {
    const { data, error } = await bucket.list(userId, { limit: PHOTO_PAGE_SIZE });
    if (error) throw new Error(`Listing staff photos failed: ${error.message}`);

    const files = (data ?? []).filter((entry) => entry.id !== null);
    if (files.length === 0) return removed;

    const { error: removeError } = await bucket.remove(files.map((file) => `${userId}/${file.name}`));
    if (removeError) throw new Error(`Removing staff photos failed: ${removeError.message}`);

    removed += files.length;
    if ((data ?? []).length < PHOTO_PAGE_SIZE) return removed;
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Message of an unknown error value. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
