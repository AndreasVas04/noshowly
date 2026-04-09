/**
 * app/api/services/[id]/route.ts
 *
 * DELETE /api/services/[id] — remove a service from the authenticated salon.
 *
 * Deleting a service does not affect existing appointments that referenced it
 * by name — service_type is stored as plain text on the appointment row, so
 * removing the service template does not break historical data.
 *
 * Security:
 *  - Authentication checked first.
 *  - Ownership verified: the service must belong to the requesting user's
 *    salon before deletion, preventing cross-salon deletes.
 *  - RLS provides a second enforcement layer.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';

// ---------------------------------------------------------------------------
// DELETE — remove a service
// ---------------------------------------------------------------------------

/**
 * Deletes a service by ID, only if it belongs to the authenticated user's salon.
 *
 * @param _request - Unused — all needed info comes from the session + route param.
 * @param params   - Route params containing `id` (service UUID).
 *
 * @returns 200 { success: true }               — deleted
 * @returns 401 { error: "Unauthorized" }       — no valid session
 * @returns 404 { error: "Service not found" }  — service doesn't exist or not owned
 * @returns 500 { error: string }               — unexpected DB error
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
  const { id: serviceId } = await params;

  if (!serviceId) {
    return Response.json({ error: 'Service ID is required' }, { status: 400 });
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

  // Step 4: Delete the service, but only if it belongs to this salon.
  // Security: the `.eq('salon_id', salon.id)` guard prevents a user from
  // deleting a service that belongs to a different salon.
  const { error: deleteError, count } = await supabase
    .from('services')
    .delete({ count: 'exact' })
    .eq('id', serviceId)
    .eq('salon_id', salon.id); // ownership check — non-negotiable

  if (deleteError) {
    console.error('[DELETE /api/services/[id]] DB error:', deleteError.message);
    return Response.json({ error: 'Failed to delete service' }, { status: 500 });
  }

  if (count === 0) {
    // No rows deleted — service doesn't exist or belongs to another salon.
    return Response.json({ error: 'Service not found' }, { status: 404 });
  }

  return Response.json({ success: true }, { status: 200 });
}
