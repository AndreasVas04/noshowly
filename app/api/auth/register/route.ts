/**
 * app/api/auth/register/route.ts
 *
 * POST handler — called immediately after a successful Supabase signUp on the
 * client.  Its sole job is to create the `users` and `salons` database records
 * that the rest of the application depends on (lib/account.ts ensureAccount).
 *
 * Why this route exists instead of doing it client-side:
 *  - All database calls go through API routes.
 *  - The `users` table has no client-accessible INSERT policy; we must use the
 *    service-role key, which must never be exposed to the browser.
 *  - Keeps the sign-up flow atomic from the client's perspective: one fetch()
 *    either succeeds (records exist) or fails (client signs out and shows error).
 *
 * If this route fails halfway (e.g. the users row was created but not the
 * salon), nothing is left broken for good: ensureAccount() is idempotent, and
 * the dashboard layout calls it again on the owner's next visit.
 *
 * Request body:
 *  { salonName: string, timezone?: string }
 *
 *  timezone is the browser's IANA timezone; it becomes the salon's timezone
 *  when valid, otherwise the salon starts on 'UTC'.
 *
 * Responses:
 *  201 { success: true }          — records created (or already existed, idempotent)
 *  400 { error: string }          — validation failure
 *  401 { error: "Unauthorized" }  — no valid session cookie
 *  500 { error: string }          — unexpected DB error
 *
 * Security:
 *  - Verifies the user with Supabase Auth (requireUser → getUser) before the
 *    user ID is used with the service-role key.
 *  - Uses the service-role key ONLY for inserting into `users` and `salons`.
 *  - All inputs are validated before any DB operation.
 */

import { requireUser } from '@/lib/auth';
import { ensureAccount, type EnsureAccountResult } from '@/lib/account';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { isValidTimeZone } from '@/lib/time';

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
  // Step 1: Verify the caller with Supabase Auth (auth check — always first)
  // Security: prevents unauthenticated callers from probing or creating records.
  // -------------------------------------------------------------------------
  const auth = await requireUser();
  if (!auth.ok) {
    console.warn(`[register:${requestId}] No verified user — returning 401`);
    return auth.response;
  }
  const { user } = auth;

  console.log(`[register:${requestId}] User verified: ${user.id}`);

  // -------------------------------------------------------------------------
  // Step 2: Parse and validate the request body
  // Security: never trust client input; validate before touching the database.
  // -------------------------------------------------------------------------
  let salonName: string;
  let timezone = 'UTC';
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

    // Optional browser timezone — an unknown or missing value falls back to UTC.
    const requestedTimezone = (body as Record<string, unknown>).timezone;
    if (isValidTimeZone(requestedTimezone)) {
      timezone = requestedTimezone;
    }
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
  // Step 3: Create whichever of the `users` and `salons` records is missing.
  // Security: SUPABASE_SERVICE_ROLE_KEY is server-only (no NEXT_PUBLIC_ prefix).
  // The new users row starts on the 14-day free trial.
  // -------------------------------------------------------------------------
  let result: EnsureAccountResult;
  try {
    result = await ensureAccount(createAdminSupabaseClient(), user, { salonName, timezone });
  } catch (err) {
    // Configuration error — never happens in production if env vars are set.
    console.error(`[register:${requestId}] Cannot create account records:`, err instanceof Error ? err.message : err);
    return Response.json({ error: 'Server configuration error' }, { status: 500 });
  }

  if (!result.ok) {
    console.error(`[register:${requestId}] Failed at ${result.step}:`, result.message);
    return Response.json(
      { error: result.step === 'users' ? 'Failed to create account' : 'Failed to create salon' },
      { status: 500 }
    );
  }

  console.log(
    `[register:${requestId}] Registration complete for user ${user.id} ` +
    `(users row created: ${result.createdUser}, salon created: ${result.createdSalon})`
  );
  return Response.json({ success: true }, { status: 201 });
}
