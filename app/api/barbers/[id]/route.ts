/**
 * app/api/barbers/[id]/route.ts
 *
 * DELETE /api/barbers/[id] — remove a barber from the authenticated salon.
 *
 * Deletion is safe because the appointments table uses ON DELETE SET NULL for
 * barber_id — existing appointments keep their data but barber_id becomes null.
 * The appointment is never lost; the barber name simply disappears from the card.
 *
 * Security:
 *  - Authentication checked first.
 *  - Ownership verified: we confirm the barber belongs to the requesting user's
 *    salon before deleting, preventing cross-salon deletes even if someone
 *    guesses another salon's barber UUIDs.
 *  - RLS provides a second enforcement layer.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';

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
