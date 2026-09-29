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
 *  - POST needs write access: an ended trial or an inactive subscription is
 *    read-only (lib/access.ts).
 */

import { requireOwner } from '@/lib/auth';
import { isValidDuration, isValidPrice } from '@/lib/availability';
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
  // Step 1: The signed-in owner and their salon.
  const owner = await requireOwner();
  if (!owner.ok) return owner.response;
  const { supabase, salon } = owner;

  // Step 2: Fetch all services for this salon, ordered alphabetically.
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
 *    duration_minutes?: number | null   — optional, integer minutes from 1 to 480
 *    price?:            number | null   — optional, decimal of 0 or more
 *    active?:           boolean         — optional, defaults to true
 *  }
 *
 * @returns 201 { service: Service }            — created successfully
 * @returns 400 { error: string }               — validation failure
 * @returns 401 { error: "Unauthorized" }       — no valid session
 * @returns 403 { error: string, code: string } — read-only account (trial ended / inactive)
 * @returns 404 { error: "Salon not found" }    — user has no salon record
 * @returns 500 { error: string }               — unexpected DB error
 */
export async function POST(request: Request): Promise<Response> {
  // Step 1: The signed-in owner, with write access, and their salon.
  const owner = await requireOwner({ write: true });
  if (!owner.ok) return owner.response;
  const { supabase, salon } = owner;

  // Step 2: Parse and validate the request body.
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

  // Validate duration_minutes — optional, whole minutes from 1 to 480
  let duration_minutes: number | null = null;
  if ('duration_minutes' in raw && raw.duration_minutes !== null) {
    if (!isValidDuration(raw.duration_minutes)) {
      return Response.json({ error: 'duration_minutes must be an integer between 1 and 480' }, { status: 400 });
    }
    duration_minutes = raw.duration_minutes;
  }

  // Validate price — optional, 0 or more
  let price: number | null = null;
  if ('price' in raw && raw.price !== null) {
    if (!isValidPrice(raw.price)) {
      return Response.json({ error: 'price must be a number of 0 or more' }, { status: 400 });
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

  // Step 3: Insert the new service.
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
