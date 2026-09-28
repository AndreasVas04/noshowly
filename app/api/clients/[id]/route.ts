/**
 * app/api/clients/[id]/route.ts
 *
 * PATCH /api/clients/:id — update a client's name, phone, email or notes.
 *
 * Used by the appointment modal in edit mode, so correcting a client's details
 * updates the client record instead of being silently dropped.
 *
 * Security:
 *  - The caller is verified with Supabase Auth (requireUser) first.
 *  - Write access is checked next: an ended trial or an inactive
 *    subscription is read-only (lib/access.ts).
 *  - Only the RLS-scoped client is used; the update is also scoped to the
 *    caller's salon, so another salon's client id returns 404.
 *  - All inputs are validated before touching the database.
 */

import { requireUser } from '@/lib/auth';
import { requireWriteAccess } from '@/lib/access';
import { parseClientFields } from '@/lib/clients';
import { isUuid } from '@/lib/postgrest';
import type { Client } from '@/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// ---------------------------------------------------------------------------
// PATCH — update client details
// ---------------------------------------------------------------------------

/**
 * Updates one or more fields of a client belonging to the authenticated salon.
 *
 * Request body (all optional, at least one required):
 * {
 *   name?:  string,          // 1–100 chars
 *   phone?: string | null,   // with country code; stored normalised; null clears
 *   email?: string | null,   // valid address; null clears
 *   notes?: string | null,   // max 500 chars; null clears
 * }
 *
 * @returns 200 { client: Client }
 * @returns 400 { error: string }             — validation failure
 * @returns 401 { error: "Unauthorized" }
 * @returns 403 { error: string, code: string } — read-only account (trial ended / inactive)
 * @returns 404 { error: "Client not found" } — no such client in this salon
 * @returns 500 { error: string }
 */
export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;

  // Step 1: Verify the caller.
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  // Step 1b: Plan check — an ended trial or an inactive subscription is read-only.
  const access = await requireWriteAccess(supabase, user.id);
  if (!access.ok) return access.response;

  // A malformed id is "not found", not a database error.
  if (!isUuid(id)) {
    return Response.json({ error: 'Client not found' }, { status: 404 });
  }

  // Step 2: Parse and validate the request body.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON in request body' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return Response.json({ error: 'Request body must be a JSON object' }, { status: 400 });
  }

  const parsed = parseClientFields(body as Record<string, unknown>, 'update');
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  // Step 3: Resolve the salon for this user.
  const { data: salon, error: salonError } = await supabase
    .from('salons')
    .select('id')
    .eq('user_id', user.id)
    .single();

  if (salonError || !salon) {
    return Response.json({ error: 'Salon not found' }, { status: 404 });
  }

  // Step 4: Update, scoped to this salon so other salons' clients are unreachable.
  const { data: client, error: updateError } = await supabase
    .from('clients')
    .update(parsed.fields)
    .eq('id', id)
    .eq('salon_id', salon.id)
    .select()
    .maybeSingle();

  if (updateError) {
    console.error('[PATCH /api/clients/:id] DB error:', updateError.message);
    return Response.json({ error: 'Failed to update client' }, { status: 500 });
  }

  if (!client) {
    return Response.json({ error: 'Client not found' }, { status: 404 });
  }

  return Response.json({ client: client as Client }, { status: 200 });
}
