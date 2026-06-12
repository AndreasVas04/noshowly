/**
 * app/api/clients/route.ts
 *
 * GET  /api/clients?search=term
 *   Searches the authenticated salon's clients by name (case-insensitive partial
 *   match). Returns up to 10 results, ordered alphabetically. Used by the
 *   AddAppointmentModal autocomplete to suggest existing clients as the owner types.
 *
 * POST /api/clients
 *   Creates a new client record for the authenticated salon. Called by the modal
 *   when the owner books a first-time client who does not yet exist in the system.
 *
 * Security:
 *  - Authentication is verified on every request before anything else.
 *  - salon_id is always derived from the authenticated session — never accepted
 *    from the caller, preventing cross-salon data injection.
 *  - RLS on the clients table provides a second enforcement layer.
 *  - All inputs are validated and trimmed before touching the database.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { Client } from '@/types';

// ---------------------------------------------------------------------------
// GET — search clients by name
// ---------------------------------------------------------------------------

/**
 * Returns up to 10 clients for the authenticated salon whose name contains
 * the given search term (case-insensitive). Used to power the client name
 * autocomplete in the appointment booking modal.
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

  // Step 4a: Search clients by phone first (partial match, case-insensitive).
  // Phone is the primary client identifier — a phone match takes precedence over
  // a name match so the salon owner finds the right record even with a different
  // spelling of the client's name.
  const { data: phoneMatches, error: phoneError } = await supabase
    .from('clients')
    .select('*')
    .eq('salon_id', salon.id)
    .ilike('phone', `%${search}%`)
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
// POST — create a new client
// ---------------------------------------------------------------------------

/**
 * Creates a new client record for the authenticated salon.
 *
 * Called by the appointment modal when the salon owner books a first-time
 * client. After creating the client, the caller uses the returned client.id
 * to attach the client to the new appointment.
 *
 * Request body:
 * {
 *   name:   string,          // required — client display name
 *   phone:  string | null,   // required — used for client contact
 *   email?: string | null,   // optional — used for email reminders
 *   notes?: string | null,   // optional — free-text notes for the barber
 * }
 *
 * Validation rules:
 *  - name:  1–100 chars, trimmed, required.
 *  - phone: 5–20 chars, trimmed, required. Basic length check only —
 *           the exact format is left to the barber (international numbers vary).
 *  - email: basic @ check, 5–200 chars. Optional.
 *  - notes: max 500 chars. Optional.
 *
 * @returns 201 { client: Client }
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

  // Step 2: Parse the request body.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON in request body' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null) {
    return Response.json({ error: 'Request body must be a JSON object' }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;

  // Validate required: name
  if (typeof raw.name !== 'string' || !raw.name.trim()) {
    return Response.json({ error: 'Client name is required' }, { status: 400 });
  }
  const name = raw.name.trim();
  if (name.length > 100) {
    return Response.json(
      { error: 'Client name must be 100 characters or fewer' },
      { status: 400 }
    );
  }

  // Validate required: phone
  if (typeof raw.phone !== 'string' || !raw.phone.trim()) {
    return Response.json({ error: 'Client phone number is required' }, { status: 400 });
  }
  const phone = raw.phone.trim();
  if (phone.length > 20) {
    return Response.json(
      { error: 'Phone number must be 20 characters or fewer' },
      { status: 400 }
    );
  }
  // Phone must start with + (country code required for international routing).
  if (!phone.startsWith('+')) {
    return Response.json(
      { error: 'Phone must include country code (e.g. +357 99 123 456)' },
      { status: 400 }
    );
  }

  // Validate optional: email
  let email: string | null = null;
  if (raw.email !== undefined && raw.email !== null && raw.email !== '') {
    if (typeof raw.email !== 'string') {
      return Response.json({ error: 'email must be a string' }, { status: 400 });
    }
    const trimmedEmail = raw.email.trim();
    // Basic email validation: must contain @ and be a reasonable length.
    if (!trimmedEmail.includes('@') || trimmedEmail.length < 5 || trimmedEmail.length > 200) {
      return Response.json({ error: 'Invalid email address' }, { status: 400 });
    }
    email = trimmedEmail;
  }

  // Validate optional: notes
  let notes: string | null = null;
  if (raw.notes !== undefined && raw.notes !== null && raw.notes !== '') {
    if (typeof raw.notes !== 'string') {
      return Response.json({ error: 'notes must be a string' }, { status: 400 });
    }
    if (raw.notes.length > 500) {
      return Response.json(
        { error: 'Notes must be 500 characters or fewer' },
        { status: 400 }
      );
    }
    notes = raw.notes.trim();
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

  // Step 4: Deduplication — if a client with the same phone already exists for
  // this salon and the name matches, return the existing record to avoid duplicates.
  // If phone matches but name differs, fall through and create a new client.
  // This prevents the case where two different people share a phone number or a
  // returning client whose number was reassigned would overwrite an existing record.
  const { data: existing, error: lookupError } = await supabase
    .from('clients')
    .select('*')
    .eq('salon_id', salon.id)
    .eq('phone', phone)
    .maybeSingle();

  if (lookupError) {
    console.error('[POST /api/clients] Dedup lookup error:', lookupError.message);
    return Response.json({ error: 'Failed to create client' }, { status: 500 });
  }

  if (existing) {
    // Only reuse the existing client when the name matches (case-insensitive, trimmed).
    // If names differ, fall through to create a new client — the phone may belong to
    // a different person, or the owner is booking under a different name.
    const existingNameNorm = (existing as Client).name.toLowerCase().trim();
    const requestedNameNorm = name.toLowerCase().trim();
    if (existingNameNorm === requestedNameNorm) {
      return Response.json({ client: existing as Client }, { status: 200 });
    }
    // Different name — do not reuse; create a new client below.
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
