/**
 * app/api/account/route.ts
 *
 * DELETE /api/account
 *
 * Permanently deletes the authenticated user's entire account
 * (lib/account.ts deleteAccount):
 *  1. Cancels every Stripe subscription of the owner that has not ended, so
 *     nobody keeps paying for a deleted account. If Stripe fails, nothing is
 *     deleted (502) and the owner can try again.
 *  2. Removes the owner's staff photos from Storage (best effort, logged).
 *  3. Deletes the auth.users record with the admin API. Foreign keys cascade
 *     from auth.users to public.users, to salons, and from there to every
 *     salon table (appointments, clients, staff, services, availability,
 *     reminders, booking page). There are no separate partial deletes, so an
 *     account can never be left as a login without a salon.
 *
 * This operation is irreversible. Stripe keeps its own records of past
 * invoices; the Stripe customer itself is not deleted.
 *
 * Security:
 *  - The user is verified with Supabase Auth (requireUser → getUser), because
 *    the user ID is then used with the service-role key, which bypasses RLS.
 *  - The user ID comes from the verified user, never from the request body,
 *    so a user can only delete their own account.
 *  - The public demo account cannot be deleted.
 *  - Service role key is server-side only — never exposed to the browser.
 */

import { requireUser } from '@/lib/auth';
import { isDemoAccount } from '@/lib/demo';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { deleteAccount, removeStaffPhotos } from '@/lib/account';
import { cancelSubscription, listCustomerSubscriptions } from '@/lib/billing/server';

// ---------------------------------------------------------------------------
// DELETE handler
// ---------------------------------------------------------------------------

/**
 * Permanently deletes the authenticated user's account and all associated data.
 *
 * @returns 200 { success: true }               — account deleted
 * @returns 401 { error: "Unauthorized" }        — no valid session
 * @returns 403 { error: string }                — demo account
 * @returns 500 { error: string }                — database error; see the message
 * @returns 502 { error: string }                — Stripe error; nothing was deleted
 */
export async function DELETE(): Promise<Response> {
  // Step 1: Verify the user with Supabase Auth.
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  if (isDemoAccount(auth.user.email)) {
    return Response.json(
      { error: 'The demo account cannot be deleted.' },
      { status: 403 }
    );
  }

  const userId = auth.user.id;
  const db = createAdminSupabaseClient();
  console.log(`[DELETE /api/account] Deleting account for user=${userId}`);

  // Step 2: The owner's Stripe customer (a half-created account may have no users row).
  const { data: account, error: accountError } = await db
    .from('users')
    .select('stripe_customer_id')
    .eq('id', userId)
    .maybeSingle();

  if (accountError) {
    console.error('[DELETE /api/account] Failed to load the users row:', accountError.message);
    return Response.json({ error: 'Failed to delete account. Nothing was deleted.' }, { status: 500 });
  }

  // Step 3: Cancel subscriptions, remove photos, delete the auth user (cascades).
  const result = await deleteAccount(
    {
      listSubscriptions:  listCustomerSubscriptions,
      cancelSubscription,
      removeStaffPhotos:  (id) => removeStaffPhotos(db, id),
      async deleteAuthUser(id) {
        const { error } = await db.auth.admin.deleteUser(id);
        if (error) throw new Error(error.message);
      },
    },
    { userId, stripeCustomerId: account?.stripe_customer_id ?? null },
  );

  if (!result.ok) {
    if (result.step === 'billing') {
      console.error(
        `[DELETE /api/account] Subscription cancellation failed for user=${userId}, nothing deleted:`,
        result.message,
      );
      return Response.json(
        { error: 'We could not cancel your subscription, so nothing was deleted. Please try again.' },
        { status: 502 }
      );
    }
    console.error(`[DELETE /api/account] Failed to delete auth user=${userId}:`, result.message);
    return Response.json(
      {
        error: result.cancelledSubscriptions.length > 0
          ? 'Your subscription was cancelled, but the account could not be deleted. Please try again.'
          : 'Failed to delete account. Please try again.',
      },
      { status: 500 }
    );
  }

  console.log(
    `[DELETE /api/account] Account deleted for user=${userId} ` +
    `(subscriptions cancelled: ${result.cancelledSubscriptions.length}, photos removed: ${result.photosRemoved ?? 'unknown'})`
  );
  return Response.json({ success: true }, { status: 200 });
}
