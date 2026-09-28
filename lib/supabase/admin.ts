/**
 * lib/supabase/admin.ts
 *
 * Service-role Supabase client for server code that must read or write data
 * the caller cannot access through Row Level Security, such as the public
 * booking page, whose visitors are anonymous.
 *
 * The service-role key bypasses RLS, so:
 *  - this module is server-only: importing it from a Client Component fails
 *    the build instead of leaking the key;
 *  - every query made with it must scope itself (slug, salon_id …) and select
 *    explicit columns, never '*';
 *  - routes that act for a signed-in user must verify the user with
 *    requireUser() (lib/auth.ts) before using it.
 */

import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types';

/**
 * Creates a Supabase client authenticated with the service-role key.
 * Create one per request; the client keeps no session.
 *
 * @throws Error when NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.
 */
export function createAdminSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error('Missing environment variable: NEXT_PUBLIC_SUPABASE_URL');
  }
  if (!serviceRoleKey) {
    throw new Error('Missing environment variable: SUPABASE_SERVICE_ROLE_KEY');
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/** Type of the client returned by createAdminSupabaseClient(). */
export type AdminSupabaseClient = ReturnType<typeof createAdminSupabaseClient>;
