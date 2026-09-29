/**
 * lib/access.ts
 *
 * Plan checks for the dashboard API routes, built on lib/entitlements.ts.
 *
 * requireWriteAccess() loads the caller's users row (plan, trial_ends_at) and
 * answers 403 when the account is read-only: an ended trial or an inactive
 * subscription. Every route that creates, changes or deletes staff, services,
 * availability, staff/service assignments, appointments, clients, photos or
 * the booking page calls it right after authenticating, and so does the test
 * email route. PUT /api/salon does not, so owners can always fix their
 * business settings, and DELETE /api/account does not.
 *
 * The database applies the same rule to writes made with the owner's own
 * session, e.g. straight through the Supabase API:
 * public.owner_has_write_access() in
 * supabase/migrations/20260929120000_read_only_accounts.sql.
 *
 * Works with the signed-in user's client (RLS lets owners read their own
 * users row) and with the service-role client.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types';
import { accessDenial, getEntitlements, type Entitlements } from '@/lib/entitlements';

type Db = SupabaseClient<Database>;

/** Result of loadEntitlements(). */
export type LoadEntitlementsResult =
  | { ok: true; entitlements: Entitlements; stripeCustomerId: string | null }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'database'; message: string };

/** Result of requireWriteAccess(). */
export type WriteAccessResult =
  | { ok: true; entitlements: Entitlements }
  | { ok: false; response: Response };

/** Shown when the users row is missing (the dashboard layout repairs it on the next load). */
export const ACCOUNT_INCOMPLETE_MESSAGE =
  'Your account is not fully set up yet. Reload the page and try again.';

/**
 * Loads a user's entitlements from their users row.
 *
 * @param db     - The signed-in user's client or the service-role client.
 * @param userId - users.id (from a verified session or a trusted row).
 * @param now    - Current instant.
 */
export async function loadEntitlements(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<LoadEntitlementsResult> {
  const { data, error } = await db
    .from('users')
    .select('plan, trial_ends_at, stripe_customer_id')
    .eq('id', userId)
    .maybeSingle();

  if (error) return { ok: false, reason: 'database', message: error.message };
  if (!data) return { ok: false, reason: 'not_found' };

  return {
    ok: true,
    entitlements: getEntitlements(data, now),
    stripeCustomerId: data.stripe_customer_id ?? null,
  };
}

/**
 * Checks that the user may create, change or delete data.
 *
 * @param db     - The signed-in user's client or the service-role client.
 * @param userId - The authenticated user's id.
 * @param now    - Current instant.
 * @returns `{ ok: true, entitlements }`, or `{ ok: false, response }` to
 *          return as is: 403 { error, code } for a read-only or incomplete
 *          account, 500 when the plan cannot be read.
 *
 * @example
 * ```ts
 * const access = await requireWriteAccess(supabase, session.user.id);
 * if (!access.ok) return access.response;
 * ```
 */
export async function requireWriteAccess(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<WriteAccessResult> {
  const loaded = await loadEntitlements(db, userId, now);

  if (!loaded.ok) {
    if (loaded.reason === 'not_found') {
      return {
        ok: false,
        response: Response.json(
          { error: ACCOUNT_INCOMPLETE_MESSAGE, code: 'account_incomplete' },
          { status: 403 },
        ),
      };
    }
    console.error(`[access] Failed to load the plan of user=${userId}:`, loaded.message);
    return {
      ok: false,
      response: Response.json({ error: 'Failed to check your plan. Please try again.' }, { status: 500 }),
    };
  }

  const denial = accessDenial(loaded.entitlements);
  if (denial) {
    return {
      ok: false,
      response: Response.json({ error: denial.message, code: denial.code }, { status: 403 }),
    };
  }

  return { ok: true, entitlements: loaded.entitlements };
}
