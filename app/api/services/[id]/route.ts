/**
 * app/api/services/[id]/route.ts
 *
 * PUT    /api/services/[id] — update a service's name, duration, price, or active flag.
 * DELETE /api/services/[id] — remove a service from the authenticated salon.
 *
 * Deleting a service does not affect existing appointments that referenced it
 * by name — service_type is stored as plain text on the appointment row, so
 * removing the service template does not break historical data.
 *
 * Security:
 *  - Authentication checked first on every request.
 *  - Ownership verified via salon_id derived from session — never from client.
 *  - RLS provides a second enforcement layer.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { Service } from '@/types';

// ---------------------------------------------------------------------------
// PUT — update a service
// ---------------------------------------------------------------------------

/**
 * Updates one or more fields on a service record owned by the authenticated salon.
 *
 * Request body (all fields optional — at least one required):
 *  {
 *    name?:             string          — 1–50 chars
 *    duration_minutes?: number | null  — positive integer, or null to clear
 *    price?:            number | null  — non-negative decimal, or null to clear
 *    active?:           boolean        — show/hide on booking page
 *  }
 *
 * @param request - Incoming request.
 * @param params  - Route params containing `id` (service UUID).
 *
 * @returns 200 { service: Service }            — updated
 * @returns 400 { error: string }               — validation failure
 * @returns 401 { error: "Unauthorized" }       — no valid session
 * @returns 404 { error: "Service not found" }  — service doesn't exist or not owned
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
  const { id: serviceId } = await params;
  if (!serviceId) {
    return Response.json({ error: 'Service ID is required' }, { status: 400 });
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
    duration_minutes?: number | null;
    price?: number | null;
    active?: boolean;
  } = {};

  if ('name' in raw) {
    if (typeof raw.name !== 'string') {
      return Response.json({ error: 'name must be a string' }, { status: 400 });
    }
    const name = raw.name.trim();
    if (!name) return Response.json({ error: 'Service name cannot be empty' }, { status: 400 });
    if (name.length > 50) return Response.json({ error: 'Service name must be 50 characters or fewer' }, { status: 400 });
    updates.name = name;
  }

  if ('duration_minutes' in raw) {
    if (raw.duration_minutes === null) {
      updates.duration_minutes = null;
    } else if (typeof raw.duration_minutes !== 'number' || !Number.isInteger(raw.duration_minutes) || raw.duration_minutes <= 0) {
      return Response.json({ error: 'duration_minutes must be a positive integer or null' }, { status: 400 });
    } else {
      updates.duration_minutes = raw.duration_minutes;
    }
  }

  if ('price' in raw) {
    if (raw.price === null) {
      updates.price = null;
    } else if (typeof raw.price !== 'number' || raw.price < 0) {
      return Response.json({ error: 'price must be a non-negative number or null' }, { status: 400 });
    } else {
      updates.price = raw.price;
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
      { error: 'At least one field (name, duration_minutes, price, active) is required' },
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
  const { data: service, error: updateError } = await supabase
    .from('services')
    .update(updates)
    .eq('id', serviceId)
    .eq('salon_id', salon.id) // ownership check — non-negotiable
    .select()
    .single();

  if (updateError) {
    if (updateError.code === 'PGRST116') {
      return Response.json({ error: 'Service not found' }, { status: 404 });
    }
    console.error('[PUT /api/services/[id]] DB error:', updateError.message);
    return Response.json({ error: 'Failed to update service' }, { status: 500 });
  }

  if (!service) {
    return Response.json({ error: 'Service not found' }, { status: 404 });
  }

  return Response.json({ service: service as Service }, { status: 200 });
}

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
