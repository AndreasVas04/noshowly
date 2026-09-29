/**
 * app/auth/callback/route.ts
 *
 * Handles the OAuth / email-confirmation redirect from Supabase.
 *
 * After a user confirms their email, Supabase redirects them to this route
 * with a one-time `code` query parameter. This handler:
 *  1. Exchanges the code for a real session (PKCE flow) and sets the session cookie.
 *  2. Creates the `users` and `salons` DB records if they do not exist yet
 *     (lib/account.ts ensureAccount, the same helper /api/auth/register uses).
 *  3. Redirects to /dashboard on success. On failure it redirects to /login
 *     with an error the login page explains, instead of landing on a broken
 *     dashboard:
 *      - ?error=link_invalid  — no code, or the code could not be exchanged;
 *      - ?error=setup_failed  — the records could not be created. The user is
 *        signed out first (middleware would otherwise send a signed-in user
 *        from /login back to /dashboard); signing in again retries, because
 *        the dashboard layout completes a half-created account.
 *
 * The salon name and timezone are read from user_metadata (set during signUp
 * via options.data). If the name is missing we fall back to "My Salon", and an
 * unknown or missing timezone falls back to "UTC" — the owner can change both
 * in /dashboard/settings.
 *
 * Security: The code is single-use and expires after a short window.
 * We never log it. On failure we redirect rather than exposing error details.
 * The service-role key is only used server-side to insert the initial records.
 */

import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { accountSetupFromMetadata, ensureAccount } from '@/lib/account';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import type { Database } from '@/types';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (!code) {
    // No code in URL — likely a stale or malformed link.
    console.error('[auth/callback] No code in query string');
    return NextResponse.redirect(`${origin}/login?error=link_invalid`);
  }

  // ---------------------------------------------------------------------------
  // Step 1: Exchange the confirmation code for a session
  // ---------------------------------------------------------------------------
  const cookieStore = await cookies();

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { session }, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError || !session) {
    // Log server-side only — never expose details to the client.
    console.error('[auth/callback] Code exchange failed:', exchangeError?.message ?? 'no session returned');
    return NextResponse.redirect(`${origin}/login?error=link_invalid`);
  }

  // ---------------------------------------------------------------------------
  // Step 2: Create the `users` and `salons` DB records if they don't exist yet.
  //
  // Why here instead of in /api/auth/register:
  //   When email confirmation is enabled in Supabase, signUp() returns no session
  //   until the user clicks the confirmation link. The register page shows
  //   "check your email" and exits early — the API route is never called.
  //   This callback is the first place we have a real session after confirmation.
  //
  // Security: service-role key bypasses RLS intentionally for this one-time
  //   initial insert. It is only used server-side and never exposed to the client.
  // ---------------------------------------------------------------------------
  let setupError: string | null = null;
  try {
    const result = await ensureAccount(
      createAdminSupabaseClient(),
      session.user,
      accountSetupFromMetadata(session.user),
    );
    if (!result.ok) setupError = `${result.step}: ${result.message}`;
  } catch (err) {
    // e.g. SUPABASE_SERVICE_ROLE_KEY missing.
    setupError = err instanceof Error ? err.message : String(err);
  }

  if (setupError) {
    console.error(`[auth/callback] Account setup failed for user=${session.user.id}:`, setupError);
    // Sign out so /login shows the error instead of redirecting to /dashboard.
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=setup_failed`);
  }

  // Session is set in cookies — send the user into the app.
  return NextResponse.redirect(`${origin}/dashboard`);
}
