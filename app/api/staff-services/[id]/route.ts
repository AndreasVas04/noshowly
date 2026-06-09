/**
 * app/api/staff-services/[id]/route.ts
 *
 * PUT    /api/staff-services/[id] — update a staff service.
 * DELETE /api/staff-services/[id] — delete a staff service.
 *
 * Security:
 *  - Authentication required.
 *  - Ownership verified: service's barber must belong to the authenticated salon.
 *  - RLS provides a second enforcement layer.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { StaffService } from '@/types';

// ---------------------------------------------------------------------------
// PUT — update a staff service
// ---------------------------------------------------------------------------

/**
 * Updates an existing staff service.
 *
 * Request body (all fields optional):
 *  {
 *    name?:             string  — 1–50 chars
 *    duration_minutes?: number  — positive integer, or null to clear
 *    price?:            number  — non-negative, or null to clear
 *    active?:           boolean
 *  }
 *
 * @param _request - Incoming request.
 * @param params   - Route params containing `id`.
 *
 * @returns 200 { staffService: StaffService }
 * @returns 400 { error: string }
 * @returns 401 { error: "Unauthorized" }
 * @returns 403 { error: "Forbidden" }
 * @returns 404 { error: string }
 * @returns 500 { error: string }
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

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
  const updates: Partial<Omit<StaffService, 'id' | 'barber_id' | 'created_at'>> = {};

  if ('name' in raw) {
    if (typeof raw.name !== 'string' || !raw.name.trim()) {
      return Response.json({ error: 'name must be a non-empty string' }, { status: 400 });
    }
    const name = raw.name.trim();
    if (name.length > 50) return Response.json({ error: 'name must be 50 characters or fewer' }, { status: 400 });
    updates.name = name;
  }

  if ('duration_minutes' in raw) {
    if (raw.duration_minutes === null) {
      updates.duration_minutes = null;
    } else if (typeof raw.duration_minutes === 'number' && Number.isInteger(raw.duration_minutes) && raw.duration_minutes > 0) {
      updates.duration_minutes = raw.duration_minutes;
    } else {
      return Response.json({ error: 'duration_minutes must be a positive integer or null' }, { status: 400 });
    }
  }

  if ('price' in raw) {
    if (raw.price === null) {
      updates.price = null;
    } else if (typeof raw.price === 'number' && raw.price >= 0) {
      updates.price = raw.price;
    } else {
      return Response.json({ error: 'price must be a non-negative number or null' }, { status: 400 });
    }
  }

  if ('active' in raw) {
    if (typeof raw.active !== 'boolean') return Response.json({ error: 'active must be a boolean' }, { status: 400 });
    updates.active = raw.active;
  }

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: 'No valid fields provided' }, { status: 400 });
  }

  // Resolve salon.
  const { data: salon, error: salonError } = await supabase
    .from('salons')
    .select('id')
    .eq('user_id', session.user.id)
    .single();

  if (salonError || !salon) {
    return Response.json({ error: 'Salon not found' }, { status: 404 });
  }

  // Verify ownership: service → barber → salon.
  const { data: existing, error: existingError } = await supabase
    .from('staff_services')
    .select('id, barber_id')
    .eq('id', id)
    .single();

  if (existingError || !existing) {
    return Response.json({ error: 'Service not found' }, { status: 404 });
  }

  const { data: barber, error: barberError } = await supabase
    .from('barbers')
    .select('id')
    .eq('id', existing.barber_id)
    .eq('salon_id', salon.id)
    .single();

  if (barberError || !barber) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: updated, error: updateError } = await supabase
    .from('staff_services')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (updateError || !updated) {
    console.error('[PUT /api/staff-services/[id]] update error:', updateError?.message);
    return Response.json({ error: 'Failed to update service' }, { status: 500 });
  }

  return Response.json({ staffService: updated as StaffService }, { status: 200 });
}

// ---------------------------------------------------------------------------
// DELETE — remove a staff service
// ---------------------------------------------------------------------------

/**
 * Deletes a staff service.
 *
 * @param _request - Unused.
 * @param params   - Route params containing `id`.
 *
 * @returns 200 { success: true }
 * @returns 401 { error: "Unauthorized" }
 * @returns 403 { error: "Forbidden" }
 * @returns 404 { error: string }
 * @returns 500 { error: string }
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Resolve salon.
  const { data: salon, error: salonError } = await supabase
    .from('salons')
    .select('id')
    .eq('user_id', session.user.id)
    .single();

  if (salonError || !salon) {
    return Response.json({ error: 'Salon not found' }, { status: 404 });
  }

  // Verify ownership: service → barber → salon.
  const { data: existing, error: existingError } = await supabase
    .from('staff_services')
    .select('id, barber_id')
    .eq('id', id)
    .single();

  if (existingError || !existing) {
    return Response.json({ error: 'Service not found' }, { status: 404 });
  }

  const { data: barber, error: barberError } = await supabase
    .from('barbers')
    .select('id')
    .eq('id', existing.barber_id)
    .eq('salon_id', salon.id)
    .single();

  if (barberError || !barber) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { error: deleteError } = await supabase
    .from('staff_services')
    .delete()
    .eq('id', id);

  if (deleteError) {
    console.error('[DELETE /api/staff-services/[id]] delete error:', deleteError.message);
    return Response.json({ error: 'Failed to delete service' }, { status: 500 });
  }

  return Response.json({ success: true }, { status: 200 });
}
