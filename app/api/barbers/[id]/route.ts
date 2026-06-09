/**
 * app/api/barbers/[id]/route.ts
 *
 * PUT    /api/barbers/[id] — update a barber's name, bio, or active flag.
 * DELETE /api/barbers/[id] — remove a barber from the authenticated salon.
 *
 * Deletion is safe because the appointments table uses ON DELETE SET NULL for
 * barber_id — existing appointments keep their data but barber_id becomes null.
 * The appointment is never lost; the barber name simply disappears from the card.
 *
 * Security:
 *  - Authentication checked first on every request.
 *  - Ownership verified via salon_id derived from session — never from client.
 *  - RLS provides a second enforcement layer.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { Barber } from '@/types';

// ---------------------------------------------------------------------------
// PUT — update a barber
// ---------------------------------------------------------------------------

/**
 * Updates one or more fields on a barber record owned by the authenticated salon.
 *
 * Request body (all fields optional — at least one required):
 *  {
 *    name?:   string          — 1–50 chars
 *    bio?:    string | null   — short bio shown on booking page, max 300 chars, or null to clear
 *    active?: boolean         — show/hide on booking page and appointment modal
 *  }
 *
 * @param request - Incoming request.
 * @param params  - Route params containing `id` (barber UUID).
 *
 * @returns 200 { barber: Barber }              — updated
 * @returns 400 { error: string }               — validation failure
 * @returns 401 { error: "Unauthorized" }       — no valid session
 * @returns 404 { error: "Barber not found" }   — barber doesn't exist or not owned
 * @returns 500 { error: string }               — unexpected DB error
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  // Step 1: Verify authentication.
  const supabase = await createServerSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Step 2: Await route params.
  const { id: barberId } = await params;
  if (!barberId) {
    return Response.json({ error: 'Barber ID is required' }, { status: 400 });
  }

  // Step 3: Parse and validate request body.
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
  const updates: {
    name?: string;
    bio?: string | null;
    photo_url?: string | null;
    active?: boolean;
  } = {};

  if ('name' in raw) {
    if (typeof raw.name !== 'string') {
      return Response.json({ error: 'name must be a string' }, { status: 400 });
    }
    const name = raw.name.trim();
    if (!name) return Response.json({ error: 'Barber name cannot be empty' }, { status: 400 });
    if (name.length > 50) return Response.json({ error: 'Barber name must be 50 characters or fewer' }, { status: 400 });
    updates.name = name;
  }

  if ('photo_url' in raw) {
    if (raw.photo_url === null) {
      updates.photo_url = null;
    } else if (typeof raw.photo_url !== 'string') {
      return Response.json({ error: 'photo_url must be a string or null' }, { status: 400 });
    } else {
      updates.photo_url = raw.photo_url.trim() || null;
    }
  }

  if ('bio' in raw) {
    if (raw.bio === null) {
      updates.bio = null;
    } else if (typeof raw.bio !== 'string') {
      return Response.json({ error: 'bio must be a string or null' }, { status: 400 });
    } else {
      const bio = raw.bio.trim();
      if (bio.length > 300) return Response.json({ error: 'Bio must be 300 characters or fewer' }, { status: 400 });
      updates.bio = bio || null;
    }
  }

  if ('active' in raw) {
    if (typeof raw.active !== 'boolean') {
      return Response.json({ error: 'active must be a boolean' }, { status: 400 });
    }
    updates.active = raw.active;
  }

  if (Object.keys(updates).length === 0) {
    return Response.json(
      { error: 'At least one field (name, bio, active) is required' },
      { status: 400 }
    );
  }

  // Step 4: Resolve the salon for this user.
  const { data: salon, error: salonError } = await supabase
    .from('salons')
    .select('id')
    .eq('user_id', session.user.id)
    .single();

  if (salonError || !salon) {
    return Response.json({ error: 'Salon not found' }, { status: 404 });
  }

  // Step 5: Update — ownership guard via .eq('salon_id', salon.id).
  const { data: barber, error: updateError } = await supabase
    .from('barbers')
    .update(updates)
    .eq('id', barberId)
    .eq('salon_id', salon.id) // ownership check — non-negotiable
    .select()
    .single();

  if (updateError) {
    if (updateError.code === 'PGRST116') {
      return Response.json({ error: 'Barber not found' }, { status: 404 });
    }
    console.error('[PUT /api/barbers/[id]] DB error:', updateError.message);
    return Response.json({ error: 'Failed to update barber' }, { status: 500 });
  }

  if (!barber) {
    return Response.json({ error: 'Barber not found' }, { status: 404 });
  }

  return Response.json({ barber: barber as Barber }, { status: 200 });
}

// ---------------------------------------------------------------------------
// DELETE — remove a barber
// ---------------------------------------------------------------------------

/**
 * Deletes a barber by ID, only if it belongs to the authenticated user's salon.
 *
 * @param _request - Unused — all needed info comes from the session + route param.
 * @param params   - Route params containing `id` (barber UUID).
 *
 * @returns 200 { success: true }              — deleted
 * @returns 401 { error: "Unauthorized" }      — no valid session
 * @returns 404 { error: "Barber not found" }  — barber doesn't exist or not owned
 * @returns 500 { error: string }              — unexpected DB error
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  // Step 1: Verify authentication.
  const supabase = await createServerSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Step 2: Await the route params (Next.js 15+ params are async).
  const { id: barberId } = await params;

  if (!barberId) {
    return Response.json({ error: 'Barber ID is required' }, { status: 400 });
  }

  // Step 3: Resolve the salon for this user.
  // We use the session-derived salon_id — never trust a client-supplied one.
  const { data: salon, error: salonError } = await supabase
    .from('salons')
    .select('id')
    .eq('user_id', session.user.id)
    .single();

  if (salonError || !salon) {
    return Response.json({ error: 'Salon not found' }, { status: 404 });
  }

  // Step 4: Delete the barber, but only if it belongs to this salon.
  // Security: the `.eq('salon_id', salon.id)` guard prevents a user from
  // deleting a barber that belongs to a different salon — even if they know the UUID.
  const { error: deleteError, count } = await supabase
    .from('barbers')
    .delete({ count: 'exact' })
    .eq('id', barberId)
    .eq('salon_id', salon.id); // ownership check — non-negotiable

  if (deleteError) {
    console.error('[DELETE /api/barbers/[id]] DB error:', deleteError.message);
    return Response.json({ error: 'Failed to delete barber' }, { status: 500 });
  }

  if (count === 0) {
    // No rows deleted — barber either doesn't exist or belongs to another salon.
    // Return 404 in both cases to avoid leaking whether the ID exists.
    return Response.json({ error: 'Barber not found' }, { status: 404 });
  }

  return Response.json({ success: true }, { status: 200 });
}
