/**
 * app/api/barber-services/route.ts
 *
 * GET  /api/barber-services
 *   Returns all barber_services assignment rows for the authenticated salon.
 *   Used by the appointment modal to filter the staff dropdown, and by the
 *   booking page to render the service-assignment checkboxes.
 *
 * PUT  /api/barber-services
 *   Replaces all service assignments for a single barber.
 *   Body: { barber_id: string, service_ids: string[] }
 *   Deletes existing assignments for the barber and creates new ones atomically.
 *
 * Security:
 *  - Authentication is verified on every request before anything else.
 *  - salon_id is always derived from the authenticated session — never accepted
 *    from the caller, preventing cross-salon data access.
 *  - barber_id and service_id are verified to belong to the authenticated salon.
 *  - RLS on the barber_services table provides a second enforcement layer.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { BarberService } from '@/types';

// ---------------------------------------------------------------------------
// GET — list all barber/service assignments for the salon
// ---------------------------------------------------------------------------

/**
 * Returns every barber_services row for the authenticated salon.
 *
 * @returns 200 { barberServices: BarberService[] }
 * @returns 401 { error: "Unauthorized" }
 * @returns 404 { error: "Salon not found" }
 * @returns 500 { error: string }
 */
export async function GET(): Promise<Response> {
  // Step 1: Verify authentication.
  const supabase = await createServerSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Step 2: Resolve salon — salon_id always comes from session.
  const { data: salon, error: salonError } = await supabase
    .from('salons')
    .select('id')
    .eq('user_id', session.user.id)
    .single();

  if (salonError || !salon) {
    return Response.json({ error: 'Salon not found' }, { status: 404 });
  }

  // Step 3: Fetch all assignments for this salon.
  const { data, error: dbError } = await supabase
    .from('barber_services')
    .select('*')
    .eq('salon_id', salon.id);

  if (dbError) {
    console.error('[GET /api/barber-services] DB error:', dbError.message);
    return Response.json({ error: 'Failed to load assignments' }, { status: 500 });
  }

  return Response.json({ barberServices: (data ?? []) as BarberService[] }, { status: 200 });
}

// ---------------------------------------------------------------------------
// PUT — replace all service assignments for a single barber
// ---------------------------------------------------------------------------

/**
 * Replaces all service assignments for the specified barber.
 *
 * Request body:
 * {
 *   barber_id:   string,    // UUID of the barber to update
 *   service_ids: string[],  // UUIDs of services to assign (empty = no assignments)
 * }
 *
 * Implementation: deletes all existing rows for barber_id, then inserts the
 * new set. This is simpler and safer than diffing — the list is always small.
 *
 * @returns 200 { success: true }
 * @returns 400 { error: string }       — validation failure
 * @returns 401 { error: "Unauthorized" }
 * @returns 404 { error: "Salon not found" | "Barber not found" }
 * @returns 500 { error: string }
 */
export async function PUT(request: Request): Promise<Response> {
  // Step 1: Verify authentication.
  const supabase = await createServerSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Step 2: Parse request body.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON in request body' }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;

  if (typeof raw.barber_id !== 'string' || !raw.barber_id.trim()) {
    return Response.json({ error: 'barber_id is required' }, { status: 400 });
  }
  if (!Array.isArray(raw.service_ids)) {
    return Response.json({ error: 'service_ids must be an array' }, { status: 400 });
  }

  const barberId = raw.barber_id.trim();
  const serviceIds = raw.service_ids as string[];

  // Validate each service_id is a non-empty string.
  for (const sid of serviceIds) {
    if (typeof sid !== 'string' || !sid.trim()) {
      return Response.json({ error: 'Each service_id must be a non-empty string' }, { status: 400 });
    }
  }

  // Step 3: Resolve salon — salon_id always comes from session.
  const { data: salon, error: salonError } = await supabase
    .from('salons')
    .select('id')
    .eq('user_id', session.user.id)
    .single();

  if (salonError || !salon) {
    return Response.json({ error: 'Salon not found' }, { status: 404 });
  }

  // Step 4: Verify the barber belongs to this salon (prevents cross-salon writes).
  const { data: barber } = await supabase
    .from('barbers')
    .select('id')
    .eq('id', barberId)
    .eq('salon_id', salon.id)
    .single();

  if (!barber) {
    return Response.json({ error: 'Barber not found' }, { status: 404 });
  }

  // Step 5: Verify all service_ids belong to this salon.
  if (serviceIds.length > 0) {
    const { data: validServices, error: svcError } = await supabase
      .from('services')
      .select('id')
      .eq('salon_id', salon.id)
      .in('id', serviceIds);

    if (svcError) {
      console.error('[PUT /api/barber-services] Service validation error:', svcError.message);
      return Response.json({ error: 'Failed to validate services' }, { status: 500 });
    }

    if (!validServices || validServices.length !== serviceIds.length) {
      return Response.json({ error: 'One or more services not found' }, { status: 400 });
    }
  }

  // Step 6: Delete existing assignments for this barber, then insert new ones.
  // Scoped to salon_id to prevent cross-salon mutations even if RLS is bypassed.
  const { error: deleteError } = await supabase
    .from('barber_services')
    .delete()
    .eq('barber_id', barberId)
    .eq('salon_id', salon.id);

  if (deleteError) {
    console.error('[PUT /api/barber-services] Delete error:', deleteError.message);
    return Response.json({ error: 'Failed to update assignments' }, { status: 500 });
  }

  if (serviceIds.length > 0) {
    const { error: insertError } = await supabase
      .from('barber_services')
      .insert(
        serviceIds.map((sid) => ({
          salon_id: salon.id,
          barber_id: barberId,
          service_id: sid,
        }))
      );

    if (insertError) {
      console.error('[PUT /api/barber-services] Insert error:', insertError.message);
      return Response.json({ error: 'Failed to save assignments' }, { status: 500 });
    }
  }

  return Response.json({ success: true }, { status: 200 });
}
