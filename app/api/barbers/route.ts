/**
 * app/api/barbers/route.ts
 *
 * GET  /api/barbers — list all barbers for the authenticated salon.
 * POST /api/barbers — add a new barber to the authenticated salon.
 *
 * Barbers are display labels (dropdown items) only. They do NOT have login
 * accounts and do NOT receive emails. One barber name = one entry in the
 * dropdown when the salon owner books an appointment.
 *
 * Security:
 *  - Authentication is checked first on every request.
 *  - The salon_id is always derived from the authenticated session — the client
 *    never supplies it, preventing cross-salon data access.
 *  - RLS on the barbers table provides a second enforcement layer.
 *  - All inputs are validated before touching the database.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { Barber } from '@/types';

// ---------------------------------------------------------------------------
// GET — list barbers
// ---------------------------------------------------------------------------

/**
 * Returns all barbers for the authenticated user's salon, ordered by name.
 *
 * @returns 200 { barbers: Barber[] }
 * @returns 401 { error: "Unauthorized" }       — no valid session
 * @returns 404 { error: "Salon not found" }    — user has no salon record
 * @returns 500 { error: string }               — unexpected DB error
 */
export async function GET(): Promise<Response> {
  // Step 1: Verify authentication — always first.
  const supabase = await createServerSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Step 2: Resolve the salon for this user.
  // We derive salon_id from the session — the client never supplies it.
  const { data: salon, error: salonError } = await supabase
    .from('salons')
    .select('id')
    .eq('user_id', session.user.id)
    .single();

  if (salonError || !salon) {
    return Response.json({ error: 'Salon not found' }, { status: 404 });
  }

  // Step 3: Fetch all barbers for this salon, ordered alphabetically.
  const { data: barbers, error: barbersError } = await supabase
    .from('barbers')
    .select('*')
    .eq('salon_id', salon.id)
    .order('name', { ascending: true });

  if (barbersError) {
    console.error('[GET /api/barbers] DB error:', barbersError.message);
    return Response.json({ error: 'Failed to load barbers' }, { status: 500 });
  }

  return Response.json({ barbers: barbers as Barber[] }, { status: 200 });
}

// ---------------------------------------------------------------------------
// POST — create barber
// ---------------------------------------------------------------------------

/**
 * Creates a new barber for the authenticated user's salon.
 *
 * Request body: { name: string }
 *
 * Validation rules:
 *  - name is required, 1–50 characters, trimmed.
 *  - Duplicate names within the same salon are allowed (two barbers can share
 *    a name — the owner distinguishes them by their position in the list).
 *
 * @returns 201 { barber: Barber }              — created successfully
 * @returns 400 { error: string }               — validation failure
 * @returns 401 { error: "Unauthorized" }       — no valid session
 * @returns 404 { error: "Salon not found" }    — user has no salon record
 * @returns 500 { error: string }               — unexpected DB error
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

  // Step 2: Plan check — trial and cancelled users cannot add staff.
  const { data: userData } = await supabase.from('users').select('plan').eq('id', session.user.id).single();
  if (!userData || userData.plan === 'trial' || userData.plan === 'cancelled') {
    return Response.json({ error: 'Please upgrade to a paid plan to use this feature.' }, { status: 403 });
  }

  // Step 3: Parse and validate the request body.
  // Security: validate all inputs before touching the database.
  let name: string;
  try {
    const body: unknown = await request.json();

    if (
      typeof body !== 'object' ||
      body === null ||
      !('name' in body) ||
      typeof (body as Record<string, unknown>).name !== 'string'
    ) {
      return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }

    name = ((body as Record<string, string>).name).trim();
  } catch {
    return Response.json({ error: 'Invalid JSON in request body' }, { status: 400 });
  }

  if (!name) {
    return Response.json({ error: 'Barber name is required' }, { status: 400 });
  }
  if (name.length > 50) {
    return Response.json(
      { error: 'Barber name must be 50 characters or fewer' },
      { status: 400 }
    );
  }

  // Step 3: Resolve salon for this user.
  const { data: salon, error: salonError } = await supabase
    .from('salons')
    .select('id')
    .eq('user_id', session.user.id)
    .single();

  if (salonError || !salon) {
    return Response.json({ error: 'Salon not found' }, { status: 404 });
  }

  // Step 4: Insert the new barber.
  const { data: barber, error: insertError } = await supabase
    .from('barbers')
    .insert({ salon_id: salon.id, name })
    .select()
    .single();

  if (insertError || !barber) {
    console.error('[POST /api/barbers] DB error:', insertError?.message);
    return Response.json({ error: 'Failed to create barber' }, { status: 500 });
  }

  return Response.json({ barber: barber as Barber }, { status: 201 });
}
