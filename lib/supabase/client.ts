/**
 * lib/supabase/client.ts
 *
 * Supabase browser client for use in Client Components ('use client').
 *
 * This file intentionally has NO import from 'next/headers' so it is safe
 * to import in any Client Component. The server-side client lives in
 * lib/supabase/server.ts.
 *
 * Security note: Only the anon key is used here. RLS policies enforce
 * data isolation at the database level for all browser-side queries.
 */

import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types';

// ---------------------------------------------------------------------------
// Environment variable assertions
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
 * import { createBrowserSupabaseClient } from '@/lib/supabase/client';
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
