/**
 * app/api/auth/callback/route.ts
 *
 * Server-side PKCE code exchange for the password reset flow.
 *
 * Why server-side instead of client-side:
 *   PKCE stores the code verifier in browser cookies (via @supabase/ssr).
 *   When exchangeCodeForSession() runs in a Route Handler, Next.js automatically
 *   sends those cookies with the request, so the server can find and validate
 *   the verifier. Client-side code running after a redirect cannot reliably
 *   access the same cookies — especially when the email is opened in a different
 *   browser or a private tab — which causes "PKCE code verifier not found".
 *
 * Flow:
 *   1. User clicks reset link in email.
 *   2. Supabase verifies the OTP and redirects to this route with ?code=xxx&next=...
 *   3. This handler exchanges the code for a session using the server client
 *      (which reads the PKCE verifier from cookies).
 *   4. On success, redirects to the `next` URL (/auth/reset-password) with the
 *      session already established in cookies.
 *   5. The reset-password page just checks for an active session and shows the form.
 *
 * Note: this route is separate from app/auth/callback/route.ts, which handles
 * email confirmation for new registrations and must not be modified.
 *
 * Security:
 *   - The code is single-use and expires after a short window.
 *   - We never log or expose the code value.
 *   - On failure we redirect to the reset page with an error flag so the
 *     user sees a clear message instead of a broken page.
 */

import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import type { Database } from '@/types';

/**
 * Exchanges the Supabase PKCE authorization code for a session, then
 * redirects the user to the `next` URL.
 *
 * @param request - The incoming GET request from Supabase's redirect.
 * @returns A redirect response — either to `next` on success, or to the
 *          reset-password page with ?error=1 on failure.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';

  if (!code) {
    console.error('[api/auth/callback] No code in query string');
    return NextResponse.redirect(`${origin}/auth/reset-password?error=1`);
  }

  const cookieStore = await cookies();

  // Use createServerClient directly (same pattern as app/auth/callback/route.ts)
  // so we can read and write cookies in this Route Handler context.
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

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error('[api/auth/callback] exchangeCodeForSession failed:', error.message);
    return NextResponse.redirect(`${origin}/auth/reset-password?error=1`);
  }

  // Session is now in cookies. Redirect the user to the reset-password form.
  return NextResponse.redirect(`${origin}${next}`);
}
