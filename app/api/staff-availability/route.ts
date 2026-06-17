/**
 * app/api/staff-availability/route.ts
 *
 * GET  /api/staff-availability — returns all availability records for the
 *      authenticated salon's staff members.
 *
 * POST /api/staff-availability — upserts availability for all 7 days for a
 *      single barber. Accepts the barber's full weekly schedule in one call.
 *
 * Security:
 *  - Authentication required on every request.
 *  - Ownership verified via salon_id derived from session — never from client.
 *  - Barber must belong to the authenticated user's salon.
 *  - RLS provides a second enforcement layer.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { StaffAvailability, TimeSlot } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One day's availability record for a staff member. */
type DayInput = {
  day_of_week: number;
  is_available: boolean;
  /** Primary: array of time slots (unlimited). */
  time_slots: TimeSlot[];
  /** Legacy fields retained for backwards compatibility. */
  start_time_1?: string | null;
  end_time_1?: string | null;
  start_time_2?: string | null;
  end_time_2?: string | null;
};

// ---------------------------------------------------------------------------
// GET — fetch all availability for the salon's staff
// ---------------------------------------------------------------------------

/**
 * Returns all staff_availability rows for every barber that belongs to the
 * authenticated user's salon.
 *
 * @param _request - Unused.
 *
 * @returns 200 { availability: StaffAvailability[] }
 * @returns 401 { error: "Unauthorized" }
 * @returns 404 { error: "Salon not found" }
 * @returns 500 { error: string }
 */
export async function GET(_request: Request): Promise<Response> {
  // Step 1: Verify authentication.
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

  // Step 3: Fetch all barber IDs for this salon.
  const { data: barbers, error: barbersError } = await supabase
    .from('barbers')
    .select('id')
    .eq('salon_id', salon.id);

  if (barbersError) {
    console.error('[GET /api/staff-availability] barbers fetch error:', barbersError.message);
    return Response.json({ error: 'Failed to load availability' }, { status: 500 });
  }

  if (!barbers || barbers.length === 0) {
    return Response.json({ availability: [] }, { status: 200 });
  }

  // Step 4: Fetch all availability records for those barbers.
  const barberIds = barbers.map((b) => b.id);

  const { data: availability, error: availError } = await supabase
    .from('staff_availability')
    .select('*')
    .in('barber_id', barberIds)
    .order('barber_id')
    .order('day_of_week');

  if (availError) {
    console.error('[GET /api/staff-availability] availability fetch error:', availError.message);
    return Response.json({ error: 'Failed to load availability' }, { status: 500 });
  }

  return Response.json({ availability: availability as StaffAvailability[] }, { status: 200 });
}

// ---------------------------------------------------------------------------
// POST — upsert all 7 days for a single barber
// ---------------------------------------------------------------------------

/**
 * Upserts the weekly availability schedule for a single barber.
 *
 * Request body:
 *  {
 *    barber_id: string    — UUID of the barber to update.
 *    days: DayInput[]     — Array of 7 day records (one per day_of_week 0–6).
 *  }
 *
 * Uses Supabase upsert on the (barber_id, day_of_week) unique constraint.
 * The barber must belong to the authenticated user's salon.
 *
 * @param request - Incoming request.
 *
 * @returns 200 { availability: StaffAvailability[] } — the upserted records
 * @returns 400 { error: string }                     — validation failure
 * @returns 401 { error: "Unauthorized" }             — no valid session
 * @returns 403 { error: "Forbidden" }                — barber not owned
 * @returns 404 { error: "Salon not found" }
 * @returns 500 { error: string }                     — unexpected DB error
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

  // Step 2: Plan check — trial and cancelled users cannot update availability.
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

  if (typeof body !== 'object' || body === null) {
    return Response.json({ error: 'Request body must be a JSON object' }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;

  if (typeof raw.barber_id !== 'string' || !raw.barber_id) {
    return Response.json({ error: 'barber_id is required' }, { status: 400 });
  }

  if (!Array.isArray(raw.days)) {
    return Response.json({ error: 'days must be an array' }, { status: 400 });
  }

  const barberId = raw.barber_id;
  const days = raw.days as unknown[];

  // Validate each day entry.
  for (const d of days) {
    if (typeof d !== 'object' || d === null) {
      return Response.json({ error: 'Each day entry must be an object' }, { status: 400 });
    }
    const dayObj = d as Record<string, unknown>;
    if (typeof dayObj.day_of_week !== 'number' || dayObj.day_of_week < 0 || dayObj.day_of_week > 6) {
      return Response.json({ error: 'day_of_week must be an integer 0–6' }, { status: 400 });
    }
    if (typeof dayObj.is_available !== 'boolean') {
      return Response.json({ error: 'is_available must be a boolean' }, { status: 400 });
    }
  }

  // Step 3: Resolve salon and verify barber ownership.
  const { data: salon, error: salonError } = await supabase
    .from('salons')
    .select('id')
    .eq('user_id', session.user.id)
    .single();

  if (salonError || !salon) {
    return Response.json({ error: 'Salon not found' }, { status: 404 });
  }

  // Security: confirm the barber belongs to this salon before writing.
  const { data: barber, error: barberError } = await supabase
    .from('barbers')
    .select('id')
    .eq('id', barberId)
    .eq('salon_id', salon.id)
    .single();

  if (barberError || !barber) {
    // Either barber doesn't exist or belongs to another salon — return 403.
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Step 4: Build upsert rows.
  // Populate time_slots (primary) and legacy start/end_time columns (backwards compat).
  // Legacy columns mirror the first two time_slots entries for clients that haven't updated.
  const rows = (days as DayInput[]).map((d) => {
    const slots = d.is_available ? (d.time_slots ?? []) : [];
    const slot1 = slots[0] ?? null;
    const slot2 = slots[1] ?? null;
    return {
      barber_id:    barberId,
      day_of_week:  d.day_of_week,
      is_available: d.is_available,
      time_slots:   slots,
      start_time_1: slot1 ? slot1.start : null,
      end_time_1:   slot1 ? slot1.end   : null,
      start_time_2: slot2 ? slot2.start : null,
      end_time_2:   slot2 ? slot2.end   : null,
    };
  });

  // Step 5: Upsert on (barber_id, day_of_week) unique constraint.
  const { data: upserted, error: upsertError } = await supabase
    .from('staff_availability')
    .upsert(rows, { onConflict: 'barber_id,day_of_week' })
    .select();

  if (upsertError) {
    console.error('[POST /api/staff-availability] upsert error:', upsertError.message);
    return Response.json({ error: 'Failed to save availability' }, { status: 500 });
  }

  return Response.json({ availability: upserted as StaffAvailability[] }, { status: 200 });
}
