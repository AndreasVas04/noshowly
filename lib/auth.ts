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
 * bypasses RLS) is not checked by anything. So every route authenticates with
 * requireUser(), or with requireOwner() when it works on the owner's salon
 * (the dashboard API).
 */

import type { User } from '@supabase/supabase-js';
import { requireWriteAccess } from '@/lib/access';
import { createServerSupabaseClient } from '@/lib/supabase/server';

type ServerSupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

export type RequireUserResult =
  | { ok: true; user: User; supabase: ServerSupabaseClient }
  | { ok: false; response: Response };

/** The signed-in owner's salon, as the owner routes use it. */
type OwnerSalon = { id: string; timezone: string };

export type RequireOwnerResult =
  | { ok: true; user: User; supabase: ServerSupabaseClient; salon: OwnerSalon }
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

/**
 * Authenticates a salon owner for a dashboard API route:
 *  1. verifies the session with Supabase Auth (requireUser) — 401 otherwise;
 *  2. with `write: true`, refuses a read-only account: an ended trial or an
 *     inactive subscription (requireWriteAccess, lib/access.ts) — 403;
 *  3. loads the owner's salon — 404 when there is none.
 * The route then works through `supabase`, the owner's own client, so Row
 * Level Security still applies to everything it does, and scopes its queries
 * to `salon.id`.
 *
 * @param options.write - True for a route that creates, changes or deletes data.
 * @returns `{ ok: true, user, supabase, salon }`, or `{ ok: false, response }`
 *          with the response to return as is.
 *
 * @example
 * ```ts
 * const owner = await requireOwner({ write: true });
 * if (!owner.ok) return owner.response;
 * const { supabase, salon } = owner;
 * ```
 */
export async function requireOwner(options: { write?: boolean } = {}): Promise<RequireOwnerResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const { user, supabase } = auth;

  if (options.write) {
    const access = await requireWriteAccess(supabase, user.id);
    if (!access.ok) return access;
  }

  const { data: salon, error } = await supabase
    .from('salons')
    .select('id, timezone')
    .eq('user_id', user.id)
    .single();

  if (error || !salon) {
    return { ok: false, response: Response.json({ error: 'Salon not found' }, { status: 404 }) };
  }

  return { ok: true, user, supabase, salon };
}
