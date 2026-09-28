/**
 * app/api/clients/route.ts
 *
 * GET  /api/clients?search=term
 *   Searches the authenticated salon's clients by phone number (for phone-like
 *   terms, whatever separators the number was saved with) or by name
 *   (case-insensitive partial match). Returns up to 10 results, ordered
 *   alphabetically. Used by the AddAppointmentModal autocomplete.
 *
 * POST /api/clients
 *   Returns the existing client with the same phone number and name, or creates
 *   a new client record for the authenticated salon. Called by the modal when
 *   the owner books a client who is not selected from the autocomplete.
 *
 * PATCH /api/clients/[id] (in [id]/route.ts) updates a client's details.
 *
 * Security:
 *  - Authentication is verified on every request before anything else.
 *  - salon_id is always derived from the authenticated session — never accepted
 *    from the caller, preventing cross-salon data injection.
 *  - RLS on the clients table provides a second enforcement layer.
 *  - All inputs are validated and trimmed before touching the database.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { fillMissingClientEmail, findReusableClient, parseClientFields } from '@/lib/clients';
import { looksLikePhone, normalisePhone, phoneMatchPattern } from '@/lib/contact';
import type { Client } from '@/types';

// ---------------------------------------------------------------------------
// GET — search clients by phone or name
// ---------------------------------------------------------------------------

/**
 * Returns up to 10 clients for the authenticated salon whose phone number
 * contains the search term (phone-like terms only, separators ignored) or,
 * failing that, whose name contains it (case-insensitive). Used to power the
 * client autocomplete in the appointment booking modal.
 *
 * @param request - Incoming request; expects ?search=term query param.
 * @returns 200 { clients: Client[] }
 * @returns 400 { error: string }             — missing or empty search param
 * @returns 401 { error: "Unauthorized" }     — no valid session
 * @returns 404 { error: "Salon not found" }  — user has no salon record
 * @returns 500 { error: string }             — unexpected DB error
 */
export async function GET(request: Request): Promise<Response> {
  // Step 1: Verify authentication — always first.
  const supabase = await createServerSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Step 2: Parse and validate the search query param.
  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search')?.trim() ?? '';

  if (!search) {
    // Return an empty list rather than an error — an empty input means the
    // owner hasn't typed anything yet; no search needed.
    return Response.json({ clients: [] }, { status: 200 });
  }

  if (search.length > 100) {
    return Response.json(
      { error: 'Search term must be 100 characters or fewer' },
      { status: 400 }
    );
  }

  // Step 3: Resolve the salon for this user.
  // Deriving salon_id from the session ensures cross-salon data is never returned.
  const { data: salon, error: salonError } = await supabase
    .from('salons')
    .select('id')
    .eq('user_id', session.user.id)
    .single();

  if (salonError || !salon) {
    return Response.json({ error: 'Salon not found' }, { status: 404 });
  }

  // Step 4a: Phone-like terms search by phone first. Phone is the primary
  // client identifier, so a phone match takes precedence over a name match.
  // The pattern ignores separators, so '+357 99' finds '+35799123456' and
  // numbers saved as '+357 99 123 456'.
  if (looksLikePhone(search)) {
    const { data: phoneMatches, error: phoneError } = await supabase
      .from('clients')
      .select('*')
      .eq('salon_id', salon.id)
      .regexMatch('phone', phoneMatchPattern(normalisePhone(search), { exact: false }))
      .order('name', { ascending: true })
      .limit(10);

    if (phoneError) {
      console.error('[GET /api/clients] DB error (phone search):', phoneError.message);
      return Response.json({ error: 'Failed to search clients' }, { status: 500 });
    }

    // If any phone matches were found, return them without falling back to name search.
    if (phoneMatches && phoneMatches.length > 0) {
      return Response.json({ clients: phoneMatches as Client[] }, { status: 200 });
    }
  }

  // Step 4b: No phone matches — fall back to a name search.
  const { data: clients, error: dbError } = await supabase
    .from('clients')
    .select('*')
    .eq('salon_id', salon.id)
    .ilike('name', `%${search}%`)
    .order('name', { ascending: true })
    .limit(10);

  if (dbError) {
    console.error('[GET /api/clients] DB error (name search):', dbError.message);
    return Response.json({ error: 'Failed to search clients' }, { status: 500 });
  }

  return Response.json({ clients: clients as Client[] }, { status: 200 });
}

// ---------------------------------------------------------------------------
// POST — find or create a client
// ---------------------------------------------------------------------------

/**
 * Returns the salon's existing client with the same phone number and name, or
 * creates a new client record for the authenticated salon.
 *
 * Called by the appointment modal when the salon owner books a client who was
 * not picked from the autocomplete. The caller uses the returned client.id to
 * attach the client to the new appointment.
 *
 * Request body:
 * {
 *   name:   string,          // required — client display name
 *   phone:  string,          // required — with country code, e.g. "+357 99 123 456"
 *   email?: string | null,   // optional — used for email reminders
 *   notes?: string | null,   // optional — free-text notes for the barber
 * }
 *
 * Validation rules:
 *  - name:  1–100 chars, trimmed, required.
 *  - phone: required, at most 30 chars as typed; stored normalised
 *           ("+35799123456": country code and digits only).
 *  - email: valid address, at most 254 chars. Optional.
 *  - notes: max 500 chars. Optional.
 *
 * De-duplication: a client with the same phone number (however it was saved)
 * and the same name (case-insensitive) is reused, and a missing email is
 * filled in. A matching number with a different name creates a new client,
 * because family members often share a number.
 *
 * @returns 200 { client: Client }             — existing client reused
 * @returns 201 { client: Client }             — new client created
 * @returns 400 { error: string }             — validation failure
 * @returns 401 { error: "Unauthorized" }     — no valid session
 * @returns 404 { error: "Salon not found" }  — user has no salon record
 * @returns 500 { error: string }             — unexpected DB error
 */
export async function POST(request: Request): Promise<Response> {
  // Step 1: Verify authentication.
  const supabase = await createServerSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Step 2: Parse and validate the request body.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON in request body' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null) {
    return Response.json({ error: 'Request body must be a JSON object' }, { status: 400 });
  }

  const parsed = parseClientFields(body as Record<string, unknown>, 'create');
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }
  const { name, phone, email = null, notes = null } = parsed.fields;
  if (!name || !phone) {
    // parseClientFields guarantees both in 'create' mode; kept for the type checker.
    return Response.json({ error: 'Client name and phone number are required' }, { status: 400 });
  }

  // Step 3: Resolve the salon for this user.
  const { data: salon, error: salonError } = await supabase
    .from('salons')
    .select('id')
    .eq('user_id', session.user.id)
    .single();

  if (salonError || !salon) {
    return Response.json({ error: 'Salon not found' }, { status: 404 });
  }

  // Step 4: De-duplication — reuse the client with the same phone number and
  // the same name. Several clients may share a number, so this looks at an
  // ordered list of candidates rather than expecting a single row.
  const lookup = await findReusableClient(supabase, salon.id, { name, phone, email });
  if (!lookup.ok) {
    console.error('[POST /api/clients] Dedup lookup error:', lookup.error);
    return Response.json({ error: 'Failed to create client' }, { status: 500 });
  }

  if (lookup.client) {
    const client = await fillMissingClientEmail(supabase, lookup.client, email);
    return Response.json({ client }, { status: 200 });
  }

  // Step 5: Insert the new client.
  // salon_id is derived from the session — never accepted from the request body.
  const { data: client, error: insertError } = await supabase
    .from('clients')
    .insert({ salon_id: salon.id, name, phone, email, notes })
    .select()
    .single();

  if (insertError || !client) {
    console.error('[POST /api/clients] DB error:', insertError?.message);
    return Response.json({ error: 'Failed to create client' }, { status: 500 });
  }

  return Response.json({ client: client as Client }, { status: 201 });
}
