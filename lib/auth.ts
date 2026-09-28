/**
 * lib/auth.ts
 *
 * Server-side authentication for Route Handlers.
 *
 * Why getUser() and not getSession():
 * On the server, `supabase.auth.getSession()` returns the session stored in the
 * request cookies without re-validating the access token. `getUser()` sends the
 * token to Supabase Auth, which verifies it and returns the real user.
 *
 * Queries made through the anon-key client are still checked by RLS, but a
 * user id taken from getSession() and passed to a service-role client (which
 * bypasses RLS) is not checked by anything. Every route that uses the
 * service-role key on behalf of a user must authenticate with requireUser().
 */

import type { User } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/supabase/server';

type ServerSupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

export type RequireUserResult =
  | { ok: true; user: User; supabase: ServerSupabaseClient }
  | { ok: false; response: Response };

/**
 * Verifies the caller's session with Supabase Auth.
 *
 * @returns `{ ok: true, user, supabase }` for a verified user, or
 *          `{ ok: false, response }` with a 401 response to return as is.
 *
 * @example
 * ```ts
 * const auth = await requireUser();
 * if (!auth.ok) return auth.response;
 * const { user, supabase } = auth;
 * ```
 */
export async function requireUser(): Promise<RequireUserResult> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      ok: false,
      response: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  return { ok: true, user, supabase };
}
