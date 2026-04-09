/**
 * lib/supabase.ts
 *
 * Supabase client factory functions for NoShowly.
 *
 * Two clients are exported:
 *  - createBrowserSupabaseClient  — for use in Client Components (browser)
 *  - createServerSupabaseClient   — for use in Server Components, API Route Handlers,
 *                                   and middleware (server-side only)
 *
 * We use @supabase/ssr (NOT the deprecated @supabase/auth-helpers-nextjs).
 * This package handles cookie-based session management correctly for the
 * Next.js App Router, where cookies are managed differently per render context.
 *
 * Security note: SUPABASE_SERVICE_ROLE_KEY is intentionally NOT used here.
 * Service role bypasses Row Level Security and must only ever be used in
 * trusted server-side contexts (e.g. pg_cron callbacks). All regular API
 * routes use the anon key so that RLS policies are enforced automatically.
 */

import { createBrowserClient, createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/types';

// ---------------------------------------------------------------------------
// Environment variable assertions
// These blow up at startup rather than silently failing at runtime.
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL) {
  throw new Error('Missing environment variable: NEXT_PUBLIC_SUPABASE_URL');
}
if (!SUPABASE_ANON_KEY) {
  throw new Error('Missing environment variable: NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

// ---------------------------------------------------------------------------
// Browser client
// ---------------------------------------------------------------------------

/**
 * Creates a Supabase client for use inside Client Components (browser context).
 *
 * Call this once per component that needs Supabase access on the client side.
 * The client reads/writes auth session data via browser cookies automatically.
 *
 * @returns A typed Supabase client bound to the browser cookie store.
 *
 * @example
 * ```tsx
 * 'use client';
 * import { createBrowserSupabaseClient } from '@/lib/supabase';
 *
 * export default function MyComponent() {
 *   const supabase = createBrowserSupabaseClient();
 *   // ... use supabase
 * }
 * ```
 */
export function createBrowserSupabaseClient() {
  return createBrowserClient<Database>(
    SUPABASE_URL as string,
    SUPABASE_ANON_KEY as string
  );
}

// ---------------------------------------------------------------------------
// Server client
// ---------------------------------------------------------------------------

/**
 * Creates a Supabase client for use in Server Components, Route Handlers,
 * and middleware — anywhere that runs on the server in Next.js App Router.
 *
 * This client reads and writes auth session cookies via the Next.js `cookies()`
 * API. Because `cookies()` is async in Next.js 15+, this function is async too.
 *
 * IMPORTANT: Each API route / Server Component should call this once and reuse
 * the returned client for that request. Do NOT share a single instance across
 * requests — cookies are request-scoped.
 *
 * @returns A Promise resolving to a typed Supabase client bound to the
 *          current request's cookie store.
 *
 * @example
 * ```ts
 * // In an API Route Handler:
 * import { createServerSupabaseClient } from '@/lib/supabase';
 *
 * export async function GET(request: Request) {
 *   const supabase = await createServerSupabaseClient();
 *   const { data: { session } } = await supabase.auth.getSession();
 *   if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });
 *   // ...
 * }
 * ```
 */
export async function createServerSupabaseClient() {
  // cookies() must be awaited in Next.js 15+ (it returns a Promise<ReadonlyRequestCookies>)
  const cookieStore = await cookies();

  return createServerClient<Database>(
    SUPABASE_URL as string,
    SUPABASE_ANON_KEY as string,
    {
      cookies: {
        /**
         * Reads all cookies from the incoming request.
         * Used by Supabase to retrieve the current auth session token.
         */
        getAll() {
          return cookieStore.getAll();
        },

        /**
         * Writes updated cookies back to the response.
         * Used by Supabase to persist refreshed session tokens.
         *
         * Note: In Route Handlers, `cookieStore.set()` writes directly to the
         * response. In Server Components (read-only render), this is a no-op
         * and session refresh must happen in middleware instead.
         */
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    }
  );
}
