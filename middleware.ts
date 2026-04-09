/**
 * middleware.ts
 *
 * Next.js Edge Middleware for NoShowly.
 *
 * Responsibilities:
 *  1. Refresh the Supabase session token on every request so it never silently
 *     expires mid-session. This MUST happen in middleware — server components
 *     are read-only and cannot write cookies to refresh tokens.
 *  2. Protect all /dashboard/* routes: redirect unauthenticated visitors to /login.
 *  3. Redirect already-authenticated users away from /login and /register so they
 *     land on /dashboard instead of seeing the auth forms again.
 *
 * Why getUser() instead of getSession():
 *  Supabase's docs recommend `getUser()` in middleware because it re-validates the
 *  token against the auth server on every call, protecting against stolen/forged
 *  JWTs. `getSession()` only reads the local cookie without server validation.
 *
 * Cookie handling pattern:
 *  The middleware builds a `supabaseResponse` via NextResponse.next() and passes
 *  the same request object to both the Supabase client and the response so that
 *  refreshed session cookies are correctly written to the outgoing response.
 *  Do NOT create a separate NextResponse object — this would break cookie writes.
 *
 * Security:
 *  - Only the anon key is used here (never the service-role key).
 *  - RLS on Supabase tables provides a second enforcement layer beyond this check.
 *  - The matcher excludes static assets to avoid unnecessary auth overhead.
 */

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Route classification helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the pathname requires an authenticated session.
 * /dashboard/* and /pricing routes are protected.
 *
 * @param pathname - The URL pathname from the request.
 * @returns true if the route is behind the auth wall.
 */
function isProtectedRoute(pathname: string): boolean {
  return pathname.startsWith('/dashboard') || pathname.startsWith('/pricing');
}

/**
 * Returns true if the pathname is an auth page (login or register).
 * Authenticated users are redirected away from these pages.
 *
 * @param pathname - The URL pathname from the request.
 * @returns true if the route is an auth page.
 */
function isAuthRoute(pathname: string): boolean {
  return pathname.startsWith('/login') || pathname.startsWith('/register');
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Main middleware function — runs on every matched request (see `config` below).
 *
 * Flow:
 *  1. Build a Supabase server client wired to the request/response cookie stores.
 *  2. Call getUser() to refresh the session token if needed and verify authenticity.
 *  3. If accessing a protected route without a user → redirect to /login.
 *  4. If accessing an auth route while already logged in → redirect to /dashboard.
 *  5. Otherwise pass the request through with the (potentially refreshed) cookies.
 *
 * IMPORTANT: Do not add any code between `createServerClient` and `getUser()`.
 * The Supabase client must be allowed to mutate `supabaseResponse` (via setAll)
 * before anything else reads from the response — otherwise refreshed tokens are lost.
 *
 * @param request - The incoming Next.js edge request.
 * @returns A NextResponse — either a redirect or the request passed through.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // Start with a pass-through response. The Supabase client may replace this
  // internally when it writes refreshed session cookies (see setAll below).
  let supabaseResponse = NextResponse.next({ request });

  // -------------------------------------------------------------------------
  // Build the Supabase client wired to the edge request/response cookies.
  // The setAll callback MUST update both the request cookies (so subsequent
  // server-side reads in the same render see the fresh token) and the response
  // cookies (so the browser receives the updated token).
  // -------------------------------------------------------------------------
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        /**
         * Reads all cookies from the incoming request.
         * Supabase uses these to find the current session token.
         */
        getAll() {
          return request.cookies.getAll();
        },

        /**
         * Writes updated cookies to both the cloned request and the response.
         *
         * Two writes are necessary:
         *  - request: so the refreshed token is visible to server components
         *    that run in the same render cycle.
         *  - supabaseResponse: so the updated token is sent back to the browser
         *    and persists across future requests.
         */
        setAll(cookiesToSet) {
          // Write to the outgoing request clone first
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );

          // Rebuild the response so it carries the mutated request cookies,
          // then write the same cookies to the response headers for the browser.
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // -------------------------------------------------------------------------
  // Validate the session.
  // getUser() makes a network call to re-validate the JWT — more secure than
  // getSession() which only reads the local cookie without server verification.
  // -------------------------------------------------------------------------
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // -------------------------------------------------------------------------
  // Route guards
  // -------------------------------------------------------------------------

  if (!user && isProtectedRoute(pathname)) {
    // No authenticated user trying to reach /dashboard/* — send to login.
    // Preserve the original URL as a `next` param so after login the user
    // lands back on the page they were trying to reach.
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (user && isAuthRoute(pathname)) {
    // Already logged-in user hitting /login or /register — send to dashboard.
    // Prevents the awkward experience of being on the login form while signed in.
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = '/dashboard';
    dashboardUrl.searchParams.delete('next'); // clean URL
    return NextResponse.redirect(dashboardUrl);
  }

  // Pass the request through. Return the supabaseResponse (not a fresh
  // NextResponse) so any refreshed session cookies are included in the reply.
  return supabaseResponse;
}

// ---------------------------------------------------------------------------
// Matcher — which requests trigger this middleware
// ---------------------------------------------------------------------------

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     *  - _next/static  — compiled JS/CSS bundles
     *  - _next/image   — Next.js image optimisation endpoint
     *  - favicon.ico   — browser tab icon
     *  - Common static file extensions (images, fonts, etc.)
     *
     * This ensures auth token refresh runs on every page/API request without
     * adding overhead to static asset serving.
     */
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|otf)$).*)',
  ],
};
