/**
 * app/api/services/route.ts
 *
 * GET  /api/services — list all services for the authenticated salon.
 * POST /api/services — add a new service to the authenticated salon.
 *
 * Services are custom names (e.g. "Haircut", "Beard trim") defined per salon.
 * They populate the service dropdown when the owner books an appointment.
 *
 * Security:
 *  - Authentication is checked first on every request.
 *  - salon_id is always derived from the authenticated session — the client
 *    never supplies it, preventing cross-salon data access.
 *  - RLS on the services table provides a second enforcement layer.
 *  - All inputs are validated before touching the database.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { Service } from '@/types';

// ---------------------------------------------------------------------------
// GET — list services
// ---------------------------------------------------------------------------

/**
 * Returns all services for the authenticated user's salon, ordered by name.
 *
 * @returns 200 { services: Service[] }
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
  const { data: salon, error: salonError } = await supabase
    .from('salons')
    .select('id')
    .eq('user_id', session.user.id)
    .single();

  if (salonError || !salon) {
    return Response.json({ error: 'Salon not found' }, { status: 404 });
  }

  // Step 3: Fetch all services for this salon, ordered alphabetically.
  const { data: services, error: servicesError } = await supabase
    .from('services')
    .select('*')
    .eq('salon_id', salon.id)
    .order('name', { ascending: true });

  if (servicesError) {
    console.error('[GET /api/services] DB error:', servicesError.message);
    return Response.json({ error: 'Failed to load services' }, { status: 500 });
  }

  return Response.json({ services: services as Service[] }, { status: 200 });
}

// ---------------------------------------------------------------------------
// POST — create service
// ---------------------------------------------------------------------------

/**
 * Creates a new service for the authenticated user's salon.
 *
 * Request body:
 *  {
 *    name:              string           — required, 1–50 chars
 *    duration_minutes?: number | null   — optional, positive integer in minutes
 *    price?:            number | null   — optional, non-negative decimal
 *    active?:           boolean         — optional, defaults to true
 *  }
 *
 * @returns 201 { service: Service }            — created successfully
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

  // Step 2: Plan check — trial and cancelled users cannot add services.
  const { data: userData } = await supabase.from('users').select('plan').eq('id', session.user.id).single();
  if (!userData || userData.plan === 'trial' || userData.plan === 'cancelled') {
    return Response.json({ error: 'Please upgrade to a paid plan to use this feature.' }, { status: 403 });
  }

  // Step 3: Parse and validate the request body.
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

  // Validate name — required
  if (!('name' in raw) || typeof raw.name !== 'string') {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const name = raw.name.trim();
  if (!name) {
    return Response.json({ error: 'Service name is required' }, { status: 400 });
  }
  if (name.length > 50) {
    return Response.json(
      { error: 'Service name must be 50 characters or fewer' },
      { status: 400 }
    );
  }

  // Validate duration_minutes — optional
  let duration_minutes: number | null = null;
  if ('duration_minutes' in raw && raw.duration_minutes !== null) {
    if (typeof raw.duration_minutes !== 'number' || !Number.isInteger(raw.duration_minutes) || raw.duration_minutes <= 0) {
      return Response.json({ error: 'duration_minutes must be a positive integer' }, { status: 400 });
    }
    duration_minutes = raw.duration_minutes;
  }

  // Validate price — optional
  let price: number | null = null;
  if ('price' in raw && raw.price !== null) {
    if (typeof raw.price !== 'number' || raw.price < 0) {
      return Response.json({ error: 'price must be a non-negative number' }, { status: 400 });
    }
    price = raw.price;
  }

  // Validate active — optional boolean, defaults to true
  let active = true;
  if ('active' in raw) {
    if (typeof raw.active !== 'boolean') {
      return Response.json({ error: 'active must be a boolean' }, { status: 400 });
    }
    active = raw.active;
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

  // Step 4: Insert the new service.
  const { data: service, error: insertError } = await supabase
    .from('services')
    .insert({ salon_id: salon.id, name, duration_minutes, price, active })
    .select()
    .single();

  if (insertError || !service) {
    console.error('[POST /api/services] DB error:', insertError?.message);
    return Response.json({ error: 'Failed to create service' }, { status: 500 });
  }

  return Response.json({ service: service as Service }, { status: 201 });
}
