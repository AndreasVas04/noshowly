/**
 * app/api/staff-services/route.ts
 *
 * GET  /api/staff-services — returns all staff_services rows for every barber
 *      in the authenticated user's salon.
 *
 * POST /api/staff-services — creates a new service for a specific staff member.
 *
 * Security:
 *  - Authentication required on every request.
 *  - Ownership verified: barber must belong to the authenticated user's salon.
 *  - salon_id always derived from session, never from client.
 *  - RLS provides a second enforcement layer.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { StaffService } from '@/types';

// ---------------------------------------------------------------------------
// GET — fetch all staff services for the salon
// ---------------------------------------------------------------------------

/**
 * Returns all staff_services rows for every barber in the authenticated salon.
 * Grouped by barber — callers can filter client-side by barber_id.
 *
 * @returns 200 { staffServices: StaffService[] }
 * @returns 401 { error: "Unauthorized" }
 * @returns 404 { error: "Salon not found" }
 * @returns 500 { error: string }
 */
export async function GET(_request: Request): Promise<Response> {
  const supabase = await createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: salon, error: salonError } = await supabase
    .from('salons')
    .select('id')
    .eq('user_id', session.user.id)
    .single();

  if (salonError || !salon) {
    return Response.json({ error: 'Salon not found' }, { status: 404 });
  }

  // Get all barber IDs for this salon.
  const { data: barbers, error: barbersError } = await supabase
    .from('barbers')
    .select('id')
    .eq('salon_id', salon.id);

  if (barbersError) {
    console.error('[GET /api/staff-services] barbers error:', barbersError.message);
    return Response.json({ error: 'Failed to load staff services' }, { status: 500 });
  }

  if (!barbers || barbers.length === 0) {
    return Response.json({ staffServices: [] }, { status: 200 });
  }

  const barberIds = barbers.map((b) => b.id);

  const { data: staffServices, error: servicesError } = await supabase
    .from('staff_services')
    .select('*')
    .in('barber_id', barberIds)
    .order('barber_id')
    .order('name');

  if (servicesError) {
    console.error('[GET /api/staff-services] services error:', servicesError.message);
    return Response.json({ error: 'Failed to load staff services' }, { status: 500 });
  }

  return Response.json({ staffServices: (staffServices ?? []) as StaffService[] }, { status: 200 });
}

// ---------------------------------------------------------------------------
// POST — create a new staff service
// ---------------------------------------------------------------------------

/**
 * Creates a new service for a specific staff member.
 *
 * Request body:
 *  {
 *    barber_id:        string   — UUID of the barber this service belongs to
 *    name:             string   — service name, 1–50 chars
 *    duration_minutes?: number  — optional duration in minutes
 *    price?:           number   — optional price (non-negative)
 *    active?:          boolean  — defaults to true
 *  }
 *
 * @returns 201 { staffService: StaffService }
 * @returns 400 { error: string }
 * @returns 401 { error: "Unauthorized" }
 * @returns 403 { error: "Forbidden" } — barber not owned by this salon
 * @returns 404 { error: "Salon not found" }
 * @returns 500 { error: string }
 */
export async function POST(request: Request): Promise<Response> {
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

  // Validate barber_id.
  if (typeof raw.barber_id !== 'string' || !raw.barber_id.trim()) {
    return Response.json({ error: 'barber_id is required' }, { status: 400 });
  }

  // Validate name.
  if (typeof raw.name !== 'string' || !raw.name.trim()) {
    return Response.json({ error: 'name is required' }, { status: 400 });
  }
  const name = raw.name.trim();
  if (name.length > 50) {
    return Response.json({ error: 'name must be 50 characters or fewer' }, { status: 400 });
  }

  // Validate duration_minutes (optional).
  let durationMinutes: number | null = null;
  if (raw.duration_minutes !== undefined && raw.duration_minutes !== null) {
    if (typeof raw.duration_minutes !== 'number' || !Number.isInteger(raw.duration_minutes) || raw.duration_minutes <= 0) {
      return Response.json({ error: 'duration_minutes must be a positive integer' }, { status: 400 });
    }
    durationMinutes = raw.duration_minutes;
  }

  // Validate price (optional).
  let price: number | null = null;
  if (raw.price !== undefined && raw.price !== null) {
    if (typeof raw.price !== 'number' || raw.price < 0) {
      return Response.json({ error: 'price must be a non-negative number' }, { status: 400 });
    }
    price = raw.price;
  }

  const active = typeof raw.active === 'boolean' ? raw.active : true;

  // Resolve salon.
  const { data: salon, error: salonError } = await supabase
    .from('salons')
    .select('id')
    .eq('user_id', session.user.id)
    .single();

  if (salonError || !salon) {
    return Response.json({ error: 'Salon not found' }, { status: 404 });
  }

  // Security: confirm barber belongs to this salon before writing.
  const { data: barber, error: barberError } = await supabase
    .from('barbers')
    .select('id')
    .eq('id', raw.barber_id)
    .eq('salon_id', salon.id)
    .single();

  if (barberError || !barber) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: staffService, error: insertError } = await supabase
    .from('staff_services')
    .insert({ barber_id: raw.barber_id as string, name, duration_minutes: durationMinutes, price, active })
    .select()
    .single();

  if (insertError || !staffService) {
    console.error('[POST /api/staff-services] insert error:', insertError?.message);
    return Response.json({ error: 'Failed to create service' }, { status: 500 });
  }

  return Response.json({ staffService: staffService as StaffService }, { status: 201 });
}
