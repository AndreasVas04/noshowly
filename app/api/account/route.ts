/**
 * app/api/account/route.ts
 *
 * DELETE /api/account
 *
 * Permanently deletes the authenticated user's entire account:
 *  - All salon data (appointments, clients, barbers, services, reminders)
 *    is removed via CASCADE deletes triggered by deleting the salon row.
 *  - The users row is removed via CASCADE from auth.users.
 *  - The auth.users record itself is deleted using the service role admin API.
 *
 * This operation is irreversible. The endpoint requires the service role key
 * to delete from auth.users, which is not accessible via RLS-constrained clients.
 *
 * Security:
 *  - Session must be valid — no anonymous deletions.
 *  - The user ID is taken from the session, never from the request body,
 *    so a user can only delete their own account.
 *  - Service role key is server-side only — never exposed to the browser.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types';

// ---------------------------------------------------------------------------
// Service role client — needed to call auth.admin.deleteUser()
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
if (!SERVICE_ROLE_KEY) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');

/** Admin client — bypasses RLS and can delete auth users. Server-side only. */
const adminSupabase = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY);

// ---------------------------------------------------------------------------
// DELETE handler
// ---------------------------------------------------------------------------

/**
 * Permanently deletes the authenticated user's account and all associated data.
 *
 * Deletion order:
 *  1. Verify session — return 401 if not authenticated.
 *  2. Delete the salon row — CASCADE deletes appointments, clients, barbers,
 *     services, and reminders automatically (FK ON DELETE CASCADE in schema).
 *  3. Delete the public.users row — CASCADE from auth.users handles this
 *     when we delete the auth user, but we do it explicitly first to be safe.
 *  4. Delete the auth.users record via the admin API.
 *
 * @returns 200 { success: true }               — account deleted
 * @returns 401 { error: "Unauthorized" }        — no valid session
 * @returns 500 { error: string }                — unexpected failure
 */
export async function DELETE(): Promise<Response> {
  // Step 1: Verify the session — the user must be authenticated.
  const supabase = await createServerSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;
  console.log(`[DELETE /api/account] Deleting account for user=${userId}`);

  try {
    // Step 2: Delete the salon row.
    // ON DELETE CASCADE in the schema means this also removes:
    // barbers, clients, appointments, reminders, services for this salon.
    const { error: salonError } = await adminSupabase
      .from('salons')
      .delete()
      .eq('user_id', userId);

    if (salonError) {
      console.error('[DELETE /api/account] Failed to delete salon:', salonError.message);
      return Response.json({ error: 'Failed to delete account data' }, { status: 500 });
    }

    // Step 3: Delete the public.users row.
    // This would also be triggered by deleting the auth user via CASCADE,
    // but we delete it explicitly first to avoid timing issues.
    const { error: usersError } = await adminSupabase
      .from('users')
      .delete()
      .eq('id', userId);

    if (usersError) {
      console.error('[DELETE /api/account] Failed to delete users row:', usersError.message);
      return Response.json({ error: 'Failed to delete account data' }, { status: 500 });
    }

    // Step 4: Delete the auth.users record.
    // This requires the service role admin API — not possible with anon key.
    const { error: authError } = await adminSupabase.auth.admin.deleteUser(userId);

    if (authError) {
      console.error('[DELETE /api/account] Failed to delete auth user:', authError.message);
      return Response.json({ error: 'Failed to delete account' }, { status: 500 });
    }

    console.log(`[DELETE /api/account] Account deleted successfully for user=${userId}`);
    return Response.json({ success: true }, { status: 200 });

  } catch (err) {
    console.error('[DELETE /api/account] Unexpected error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
