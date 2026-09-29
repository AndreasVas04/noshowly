/**
 * lib/account.ts
 *
 * Account lifecycle: creating the users and salons rows of a new account
 * (ensureAccount) and deleting an account (deleteAccount).
 *
 * ensureAccount() is idempotent and can run at any time. Sign-up
 * (/api/auth/register), the email confirmation link (app/auth/callback) and
 * the dashboard layout all call it, so an account whose sign-up stopped
 * halfway (a login without a users row, or without a salon) is completed on
 * its next visit. The schema has no function that could create both rows in
 * one transaction, so each row is checked and inserted on its own, and
 * concurrent calls are harmless: a unique violation means another call
 * created the row first (users.id, and salons.user_id where the
 * data_integrity migration added salons_user_id_key). Without that
 * constraint, two racing calls could both insert a salon; the one that did
 * not create the oldest salon removes its own (still empty) row.
 *
 * deleteAccount() cancels the owner's Stripe subscriptions first and stops
 * without deleting anything when that fails, so nobody keeps paying for a
 * deleted account. It then removes the owner's staff photos (best effort)
 * and deletes the auth user; foreign keys cascade to users → salons → every
 * salon table, so there is never a login left without a salon.
 *
 * Database and Stripe access is passed in, so the logic is tested without them.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types';
import { isValidTimeZone } from '@/lib/time';
import { subscriptionsToCancel, type SubscriptionSnapshot } from '@/lib/billing/subscriptions';

type Db = SupabaseClient<Database>;

// ---------------------------------------------------------------------------
// Types and constants
// ---------------------------------------------------------------------------

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = '23505';

/** Salon name used when sign-up did not record one. */
export const DEFAULT_SALON_NAME = 'My Salon';

/** Longest salon name (same limit as /api/auth/register and PUT /api/salon). */
const MAX_SALON_NAME_LENGTH = 100;

/** Supabase Storage bucket of staff photos; files live under `<userId>/`. */
export const STAFF_PHOTO_BUCKET = 'staff-photos';

/** Files listed per request when removing staff photos. */
const PHOTO_PAGE_SIZE = 100;

/** Most listing rounds when removing staff photos (a safety stop). */
const MAX_PHOTO_PAGES = 50;

/** The auth user fields ensureAccount() needs. */
export type AccountUser = {
  id: string;
  email?: string | null;
};

/** Initial salon settings. */
export type AccountSetup = {
  salonName: string;
  /** Valid IANA time zone. */
  timezone: string;
};

/** Result of ensureAccount(). */
export type EnsureAccountResult =
  | { ok: true; createdUser: boolean; createdSalon: boolean }
  | { ok: false; step: 'users' | 'salons'; message: string };

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
// Creating an account
// ---------------------------------------------------------------------------

/**
 * Reads the salon name and time zone recorded at sign-up (user_metadata,
 * written by the register page) for a user whose rows are created later.
 * Metadata is supplied by the client, so both values are validated: the name
 * falls back to DEFAULT_SALON_NAME and the time zone to 'UTC'.
 *
 * @param user - Supabase auth user.
 */
export function accountSetupFromMetadata(user: { user_metadata?: Record<string, unknown> | null }): AccountSetup {
  const rawName = user.user_metadata?.salon_name;
  const salonName = typeof rawName === 'string' ? rawName.trim().slice(0, MAX_SALON_NAME_LENGTH) : '';
  const timezone = user.user_metadata?.timezone;
  return {
    salonName: salonName || DEFAULT_SALON_NAME,
    timezone:  isValidTimeZone(timezone) ? timezone : 'UTC',
  };
}

/**
 * Creates whichever of the account's users and salons rows is missing.
 * Existing rows are never changed, so this is safe to call again at any time.
 * A new users row starts on the free trial (plan 'trial'; trial_ends_at
 * defaults to 14 days from now).
 *
 * @param db    - Service-role client (owners cannot insert into public.users).
 * @param user  - The verified auth user.
 * @param setup - Name and time zone for a new salon.
 * @returns Which rows were created, or the step that failed. Never throws
 *          for database errors.
 */
export async function ensureAccount(
  db: Db,
  user: AccountUser,
  setup: AccountSetup,
): Promise<EnsureAccountResult> {
  // Step 1: The users row (plan, trial, billing and usage fields).
  const { data: existingUser, error: userLookupError } = await db
    .from('users')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();

  if (userLookupError) return { ok: false, step: 'users', message: userLookupError.message };

  let createdUser = false;
  if (!existingUser) {
    const email = user.email?.trim();
    if (!email) return { ok: false, step: 'users', message: 'The auth user has no email address' };

    const { error } = await db.from('users').insert({ id: user.id, email, plan: 'trial' });
    // A unique violation: another request created the row first.
    if (error && error.code !== UNIQUE_VIOLATION) return { ok: false, step: 'users', message: error.message };
    createdUser = !error;
  }

  // Step 2: The salon. limit(1) instead of maybeSingle(): on databases without
  // salons_user_id_key an owner could already have two.
  const { data: existingSalons, error: salonLookupError } = await db
    .from('salons')
    .select('id')
    .eq('user_id', user.id)
    .limit(1);

  if (salonLookupError) return { ok: false, step: 'salons', message: salonLookupError.message };
  if ((existingSalons ?? []).length > 0) return { ok: true, createdUser, createdSalon: false };

  const { data: inserted, error: insertError } = await db
    .from('salons')
    .insert({ user_id: user.id, name: setup.salonName, timezone: setup.timezone })
    .select('id')
    .single();

  if (insertError || !inserted) {
    // salons_user_id_key: another request created the salon first.
    if (insertError?.code === UNIQUE_VIOLATION) return { ok: true, createdUser, createdSalon: false };
    return { ok: false, step: 'salons', message: insertError?.message ?? 'Salon insert returned no row' };
  }

  // Step 3: Without salons_user_id_key a racing request may have inserted a
  // salon too. Both requests keep the oldest one; the other removes its own.
  const { data: oldest, error: oldestError } = await db
    .from('salons')
    .select('id')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(1);

  if (oldestError) {
    console.error(`[account] user=${user.id} WARN — could not check for a duplicate salon:`, oldestError.message);
    return { ok: true, createdUser, createdSalon: true };
  }

  const keptId = (oldest ?? [])[0]?.id;
  if (keptId && keptId !== inserted.id) {
    const { error: removeError } = await db.from('salons').delete().eq('id', inserted.id);
    if (removeError) {
      console.error(`[account] user=${user.id} ERROR — duplicate salon ${inserted.id} not removed:`, removeError.message);
    }
    return { ok: true, createdUser, createdSalon: false };
  }

  return { ok: true, createdUser, createdSalon: true };
}

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
