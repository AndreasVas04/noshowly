/**
 * app/auth/callback/route.ts
 *
 * Handles the OAuth / email-confirmation redirect from Supabase.
 *
 * After a user confirms their email, Supabase redirects them to this route
 * with a one-time `code` query parameter. This handler:
 *  1. Exchanges the code for a real session (PKCE flow) and sets the session cookie.
 *  2. Creates the `users` and `salons` DB records using the service-role key.
 *     These records are NOT created during signUp when email confirmation is required
 *     (because there is no session until the user clicks the link).
 *  3. Redirects to /dashboard on success, or /login on failure.
 *
 * The salon name is read from user_metadata (set during signUp via options.data).
 * If metadata is missing for any reason, we fall back to "My Salon" — the owner
 * can rename it in /dashboard/settings.
 *
 * Security: The code is single-use and expires after a short window.
 * We never log it. On failure we redirect rather than exposing error details.
 * The service-role key is only used server-side to insert the initial records.
 */

import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/types';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (!code) {
    // No code in URL — likely a stale or malformed link.
    console.error('[auth/callback] No code in query string');
    return NextResponse.redirect(`${origin}/login`);
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
    return NextResponse.redirect(`${origin}/login`);
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
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    console.error('[auth/callback] Missing SUPABASE_SERVICE_ROLE_KEY — cannot create DB records');
    // Session is valid — redirect to dashboard. It may show "salon not found" but
    // that is better than a broken redirect loop. The owner can contact support.
    return NextResponse.redirect(`${origin}/dashboard`);
  }

  const adminSupabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey,
    {
      cookies: {
        // Admin client authenticates via key, not cookies.
        getAll: () => [],
        setAll: () => {},
      },
    }
  );

  // Read the salon name stored in user metadata during signUp.
  // Falls back to "My Salon" if metadata was not set (e.g. manual auth flows).
  const salonName: string =
    (session.user.user_metadata?.salon_name as string | undefined)?.trim() ||
    'My Salon';

  // Create `users` record (idempotent — skip if it already exists).
  const { data: existingUser, error: userCheckError } = await adminSupabase
    .from('users')
    .select('id')
    .eq('id', session.user.id)
    .maybeSingle();

  if (userCheckError) {
    console.error('[auth/callback] Failed to check users table:', userCheckError.message);
  } else if (!existingUser) {
    const { error: insertUserError } = await adminSupabase.from('users').insert({
      id: session.user.id,
      email: session.user.email!,
      plan: 'trial',
    });
    if (insertUserError) {
      console.error('[auth/callback] Failed to insert users row:', insertUserError.message);
    }
  }

  // Create `salons` record (idempotent — skip if one already exists for this user).
  const { data: existingSalon, error: salonCheckError } = await adminSupabase
    .from('salons')
    .select('id')
    .eq('user_id', session.user.id)
    .maybeSingle();

  if (salonCheckError) {
    console.error('[auth/callback] Failed to check salons table:', salonCheckError.message);
  } else if (!existingSalon) {
    const { error: insertSalonError } = await adminSupabase.from('salons').insert({
      user_id: session.user.id,
      name: salonName,
    });
    if (insertSalonError) {
      console.error('[auth/callback] Failed to insert salons row:', insertSalonError.message);
    }
  }

  // Session is set in cookies — send the user into the app.
  return NextResponse.redirect(`${origin}/dashboard`);
}
