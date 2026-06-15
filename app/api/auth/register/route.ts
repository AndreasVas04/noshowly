/**
 * app/api/auth/register/route.ts
 *
 * POST handler — called immediately after a successful Supabase signUp on the
 * client.  Its sole job is to create the `users` and `salons` database records
 * that the rest of the application depends on.
 *
 * Why this route exists instead of doing it client-side:
 *  - All database calls go through API routes.
 *  - The `users` table has no client-accessible INSERT policy; we must use the
 *    service-role key, which must never be exposed to the browser.
 *  - Keeps the sign-up flow atomic from the client's perspective: one fetch()
 *    either succeeds (records exist) or fails (client signs out and shows error).
 *
 * Request body:
 *  { salonName: string }
 *
 * Responses:
 *  201 { success: true }          — records created (or already existed, idempotent)
 *  400 { error: string }          — validation failure
 *  401 { error: "Unauthorized" }  — no valid session cookie
 *  500 { error: string }          — unexpected DB error
 *
 * Security:
 *  - Reads the Supabase session from the request cookies to identify the user.
 *  - Uses the service-role key ONLY for inserting into `users` and `salons`;
 *    the anon client is used first to verify the session via RLS.
 *  - All inputs are validated before any DB operation.
 *  - The service-role client is scoped to this file and never exported.
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/types';

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

/**
 * Creates the `users` and `salons` records for a newly signed-up salon owner.
 *
 * This must be called with a valid Supabase session cookie already set (i.e.
 * after `supabase.auth.signUp()` has returned a session on the client).
 *
 * The operation is idempotent: if records already exist for this user, the
 * existing records are left untouched and the route still returns 201.
 *
 * @param request - The incoming HTTP request containing `{ salonName }` JSON body.
 * @returns A JSON response indicating success or the specific failure reason.
 */
export async function POST(request: Request): Promise<Response> {
  // Unique ID to correlate log lines for this specific request.
  const requestId = crypto.randomUUID().slice(0, 8);

  console.log(`[register:${requestId}] POST received`);

  // -------------------------------------------------------------------------
  // Step 1: Verify the caller has a valid session (auth check — always first)
  // Security: prevents unauthenticated callers from probing or creating records.
  // -------------------------------------------------------------------------
  const cookieStore = await cookies();

  // Use the anon key here — RLS verifies that the session user exists in auth.users.
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

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    // No valid session — reject immediately, no further processing.
    console.warn(`[register:${requestId}] No session found — returning 401`);
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log(`[register:${requestId}] Session verified for user ${session.user.id}`);

  // -------------------------------------------------------------------------
  // Step 2: Parse and validate the request body
  // Security: never trust client input; validate before touching the database.
  // -------------------------------------------------------------------------
  let salonName: string;
  try {
    const body: unknown = await request.json();

    // Narrow the type — body must be a plain object with a string salonName.
    if (
      typeof body !== 'object' ||
      body === null ||
      !('salonName' in body) ||
      typeof (body as Record<string, unknown>).salonName !== 'string'
    ) {
      return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }

    salonName = ((body as Record<string, string>).salonName).trim();
  } catch {
    return Response.json({ error: 'Invalid JSON in request body' }, { status: 400 });
  }

  if (!salonName) {
    return Response.json({ error: 'Salon name is required' }, { status: 400 });
  }
  if (salonName.length > 100) {
    return Response.json(
      { error: 'Salon name must be 100 characters or fewer' },
      { status: 400 }
    );
  }

  // -------------------------------------------------------------------------
  // Step 3: Build the service-role admin client
  // Security: SUPABASE_SERVICE_ROLE_KEY is server-only (no NEXT_PUBLIC_ prefix).
  // This client bypasses RLS intentionally — it is only used below for the
  // initial record creation that the anon key cannot perform.
  // -------------------------------------------------------------------------
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    // Configuration error — never happens in production if env vars are set.
    console.error('[register] Missing SUPABASE_SERVICE_ROLE_KEY');
    return Response.json({ error: 'Server configuration error' }, { status: 500 });
  }

  // Service-role client: no cookies needed since it authenticates via the key itself.
  const adminSupabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey,
    {
      cookies: {
        // No cookie management needed for the admin client — it uses the key.
        getAll: () => [],
        setAll: () => {},
      },
    }
  );

  // -------------------------------------------------------------------------
  // Step 4: Create the `users` record (idempotent)
  // The users table extends auth.users; we only create it if it doesn't exist.
  // -------------------------------------------------------------------------
  const { data: existingUser, error: userCheckError } = await adminSupabase
    .from('users')
    .select('id')
    .eq('id', session.user.id)
    .maybeSingle(); // maybeSingle() returns null (not error) when no row is found

  if (userCheckError) {
    console.error(`[register:${requestId}] Failed to check users table:`, userCheckError.message, userCheckError.code, userCheckError.details);
    return Response.json({ error: 'Failed to verify account' }, { status: 500 });
  }

  if (!existingUser) {
    console.log(`[register:${requestId}] Inserting users row for ${session.user.id}`);
    const { error: insertUserError } = await adminSupabase.from('users').insert({
      id: session.user.id,
      email: session.user.email!, // auth.users guarantees email is present
      plan: 'trial',              // All new accounts start on the 14-day trial
    });

    if (insertUserError) {
      console.error(`[register:${requestId}] Failed to insert users row:`, insertUserError.message, insertUserError.code, insertUserError.details);
      return Response.json({ error: 'Failed to create account' }, { status: 500 });
    }
    console.log(`[register:${requestId}] users row created`);
  } else {
    console.log(`[register:${requestId}] users row already exists — skipping`);
  }

  // -------------------------------------------------------------------------
  // Step 5: Create the `salons` record (idempotent)
  // One salon per user — skip if one already exists.
  // -------------------------------------------------------------------------
  const { data: existingSalon, error: salonCheckError } = await adminSupabase
    .from('salons')
    .select('id')
    .eq('user_id', session.user.id)
    .maybeSingle();

  if (salonCheckError) {
    console.error(`[register:${requestId}] Failed to check salons table:`, salonCheckError.message, salonCheckError.code, salonCheckError.details);
    return Response.json({ error: 'Failed to verify salon' }, { status: 500 });
  }

  if (!existingSalon) {
    console.log(`[register:${requestId}] Inserting salons row for user ${session.user.id}`);
    const { error: insertSalonError } = await adminSupabase.from('salons').insert({
      user_id: session.user.id,
      name: salonName,
      // timezone defaults to 'UTC' — user can change it in /dashboard/settings
    });

    if (insertSalonError) {
      console.error(`[register:${requestId}] Failed to insert salons row:`, insertSalonError.message, insertSalonError.code, insertSalonError.details);
      return Response.json({ error: 'Failed to create salon' }, { status: 500 });
    }
    console.log(`[register:${requestId}] salons row created`);
  } else {
    console.log(`[register:${requestId}] salons row already exists — skipping`);
  }

  console.log(`[register:${requestId}] Registration complete for user ${session.user.id}`);
  return Response.json({ success: true }, { status: 201 });
}
