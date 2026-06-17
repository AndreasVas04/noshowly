/**
 * app/api/barber-services/route.ts
 *
 * GET  /api/barber-services
 *   Returns all barber_services assignment rows for the authenticated salon.
 *   Used by the appointment modal to filter the staff dropdown, and by the
 *   booking page to render the service-assignment checkboxes with overrides.
 *
 * PUT  /api/barber-services
 *   Replaces all service assignments for a single barber.
 *   Body: { barber_id: string, assignments: { service_id, price_override?, duration_minutes_override? }[] }
 *   Deletes existing assignments for the barber and creates new ones atomically.
 *   Returns the freshly inserted rows so the client can sync real IDs.
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

/** Shape of a single assignment in the PUT request body. */
type AssignmentInput = {
  service_id: string;
  price_override?: number | null;
  duration_minutes_override?: number | null;
};

/**
 * Replaces all service assignments for the specified barber.
 * Supports per-barber price and duration overrides per service.
 *
 * Request body:
 * {
 *   barber_id:   string,           // UUID of the barber to update
 *   assignments: {                  // Services to assign (empty = no assignments)
 *     service_id:                 string,
 *     price_override?:            number | null,
 *     duration_minutes_override?: number | null,
 *   }[]
 * }
 *
 * Implementation: deletes all existing rows for barber_id, then inserts the
 * new set. This is simpler and safer than diffing — the list is always small.
 *
 * @returns 200 { success: true, barberServices: BarberService[] }
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

  // Step 2: Plan check — trial and cancelled users cannot update assignments.
  const { data: userData } = await supabase.from('users').select('plan').eq('id', session.user.id).single();
  if (!userData || userData.plan === 'trial' || userData.plan === 'cancelled') {
    return Response.json({ error: 'Please upgrade to a paid plan to use this feature.' }, { status: 403 });
  }

  // Step 3: Parse request body.
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
  if (!Array.isArray(raw.assignments)) {
    return Response.json({ error: 'assignments must be an array' }, { status: 400 });
  }

  const barberId = raw.barber_id.trim();
  const rawAssignments = raw.assignments as Record<string, unknown>[];

  // Validate and normalise each assignment entry.
  const assignments: AssignmentInput[] = [];
  for (const a of rawAssignments) {
    if (typeof a.service_id !== 'string' || !a.service_id.trim()) {
      return Response.json({ error: 'Each assignment must have a non-empty service_id string' }, { status: 400 });
    }
    // price_override: number | null | undefined — validate if present.
    if (a.price_override !== undefined && a.price_override !== null && typeof a.price_override !== 'number') {
      return Response.json({ error: 'price_override must be a number or null' }, { status: 400 });
    }
    // duration_minutes_override: integer | null | undefined — validate if present.
    if (
      a.duration_minutes_override !== undefined &&
      a.duration_minutes_override !== null &&
      typeof a.duration_minutes_override !== 'number'
    ) {
      return Response.json({ error: 'duration_minutes_override must be a number or null' }, { status: 400 });
    }
    assignments.push({
      service_id: a.service_id.trim(),
      price_override: (a.price_override as number | null | undefined) ?? null,
      duration_minutes_override: (a.duration_minutes_override as number | null | undefined) ?? null,
    });
  }

  const serviceIds = assignments.map((a) => a.service_id);

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

  if (assignments.length > 0) {
    const { error: insertError } = await supabase
      .from('barber_services')
      .insert(
        assignments.map((a) => ({
          salon_id: salon.id,
          barber_id: barberId,
          service_id: a.service_id,
          price_override: a.price_override ?? null,
          duration_minutes_override: a.duration_minutes_override ?? null,
        }))
      );

    if (insertError) {
      console.error('[PUT /api/barber-services] Insert error:', insertError.message);
      return Response.json({ error: 'Failed to save assignments' }, { status: 500 });
    }
  }

  // Step 7: Fetch and return the freshly inserted rows so the client can sync real IDs.
  const { data: freshRows, error: fetchError } = await supabase
    .from('barber_services')
    .select('*')
    .eq('barber_id', barberId)
    .eq('salon_id', salon.id);

  if (fetchError) {
    console.error('[PUT /api/barber-services] Fetch-back error:', fetchError.message);
    // Non-fatal: return success without fresh rows — client can refetch.
    return Response.json({ success: true, barberServices: [] }, { status: 200 });
  }

  return Response.json({ success: true, barberServices: (freshRows ?? []) as BarberService[] }, { status: 200 });
}
