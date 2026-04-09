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
 * Request body: { name: string }
 *
 * Validation rules:
 *  - name is required, 1–50 characters, trimmed.
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

  // Step 2: Parse and validate the request body.
  let name: string;
  try {
    const body: unknown = await request.json();

    if (
      typeof body !== 'object' ||
      body === null ||
      !('name' in body) ||
      typeof (body as Record<string, unknown>).name !== 'string'
    ) {
      return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }

    name = ((body as Record<string, string>).name).trim();
  } catch {
    return Response.json({ error: 'Invalid JSON in request body' }, { status: 400 });
  }

  if (!name) {
    return Response.json({ error: 'Service name is required' }, { status: 400 });
  }
  if (name.length > 50) {
    return Response.json(
      { error: 'Service name must be 50 characters or fewer' },
      { status: 400 }
    );
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
    .insert({ salon_id: salon.id, name })
    .select()
    .single();

  if (insertError || !service) {
    console.error('[POST /api/services] DB error:', insertError?.message);
    return Response.json({ error: 'Failed to create service' }, { status: 500 });
  }

  return Response.json({ service: service as Service }, { status: 201 });
}
