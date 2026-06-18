/**
 * app/api/appointments/[id]/route.ts
 *
 * GET    /api/appointments/:id — fetch a single appointment with client/barber names.
 * PUT    /api/appointments/:id — update fields on an existing appointment.
 * DELETE /api/appointments/:id — mark an appointment as cancelled (soft delete).
 *
 * Security:
 *  - Authentication is verified on every request before anything else.
 *  - Every query scopes to the authenticated user's salon — the client never
 *    supplies salon_id, preventing cross-salon data access.
 *  - RLS on the appointments table provides a second enforcement layer.
 *  - All inputs are validated before touching the database.
 *  - Appointments are never hard-deleted; status is set to 'cancelled' instead.
 *    This preserves history and allows future reporting.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { findEligibleBarbers, appointmentsOverlap } from '@/lib/appointment-helpers';
import type {
  Appointment,
  AppointmentWithDetails,
  AppointmentStatus,
} from '@/types';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/**
 * Raw row shape returned by Supabase when using the nested-select join syntax.
 */
type RawAppointmentRow = Omit<Appointment, 'client_id' | 'barber_id'> & {
  client_id: string | null;
  barber_id: string | null;
  clients: { name: string; phone: string | null; email: string | null } | null;
  barbers: { name: string } | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Transforms a raw Supabase joined row into the flat AppointmentWithDetails
 * shape consumed by frontend components.
 *
 * @param row - Raw row from Supabase with nested clients/barbers objects.
 * @returns Flattened AppointmentWithDetails.
 */
function toAppointmentWithDetails(row: RawAppointmentRow): AppointmentWithDetails {
  const { clients, barbers, ...rest } = row;
  return {
    ...rest,
    client_name: clients?.name ?? null,
    client_phone: clients?.phone ?? null,
    client_email: clients?.email ?? null,
    barber_name: barbers?.name ?? null,
  };
}

// ---------------------------------------------------------------------------
// Route params type
// ---------------------------------------------------------------------------

interface RouteContext {
  params: Promise<{ id: string }>;
}

// ---------------------------------------------------------------------------
// GET — fetch single appointment
// ---------------------------------------------------------------------------

/**
 * Returns a single appointment belonging to the authenticated salon,
 * including flattened client and barber display names.
 *
 * @param _request - Not used; id comes from route params.
 * @param context  - Next.js route context containing the appointment UUID.
 * @returns 200 { appointment: AppointmentWithDetails }
 * @returns 401 { error: "Unauthorized" }
 * @returns 404 { error: "Not found" }   — appointment doesn't exist or belongs to another salon
 * @returns 500 { error: string }
 */
export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;

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

  // Step 3: Fetch the appointment, scoped to this salon.
  // Scoping to salon_id means even if the caller guesses a valid UUID that
  // belongs to another salon, they get a 404 — not a data leak.
  const { data: row, error: dbError } = await supabase
    .from('appointments')
    .select(`
      *,
      clients (name, phone, email),
      barbers (name)
    `)
    .eq('id', id)
    .eq('salon_id', salon.id)
    .single();

  if (dbError || !row) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  // Cast through unknown — same reason as route.ts: Relationships: [] means
  // the Supabase TS client returns a SelectQueryError for the joined columns,
  // but the actual runtime data is correct because the SQL FKs exist.
  const appointment = toAppointmentWithDetails(row as unknown as RawAppointmentRow);
  return Response.json({ appointment }, { status: 200 });
}

// ---------------------------------------------------------------------------
// PUT — update appointment
// ---------------------------------------------------------------------------

/**
 * Updates one or more fields on an existing appointment.
 *
 * All fields are optional — only the fields present in the request body are
 * updated. Partial updates are safe because Supabase's .update() only sets
 * the columns provided.
 *
 * Updatable fields:
 * {
 *   datetime?:         string,       // ISO timestamp
 *   client_id?:        string | null,
 *   barber_id?:        string | null,
 *   service_type?:     ServiceType,
 *   duration_minutes?: number,
 *   notes?:            string | null,
 *   status?:           AppointmentStatus,
 * }
 *
 * @returns 200 { appointment: Appointment }
 * @returns 400 { error: string }       — validation failure
 * @returns 401 { error: "Unauthorized" }
 * @returns 404 { error: "Not found" }
 * @returns 500 { error: string }
 */
export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;

  // Step 1: Verify authentication.
  const supabase = await createServerSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Step 2: Parse and validate request body.
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

  // Build the partial update object — only include fields that were supplied.
  const updates: Partial<Omit<Appointment, 'id' | 'salon_id' | 'created_at'>> = {};

  if ('datetime' in raw) {
    if (typeof raw.datetime !== 'string') {
      return Response.json({ error: 'datetime must be a string' }, { status: 400 });
    }
    const parsed = new Date(raw.datetime);
    if (isNaN(parsed.getTime())) {
      return Response.json({ error: 'datetime must be a valid ISO timestamp' }, { status: 400 });
    }
    updates.datetime = parsed.toISOString();
  }

  if ('client_id' in raw) {
    if (raw.client_id !== null && typeof raw.client_id !== 'string') {
      return Response.json({ error: 'client_id must be a string or null' }, { status: 400 });
    }
    updates.client_id = raw.client_id as string | null;
  }

  if ('barber_id' in raw) {
    if (raw.barber_id !== null && typeof raw.barber_id !== 'string') {
      return Response.json({ error: 'barber_id must be a string or null' }, { status: 400 });
    }
    updates.barber_id = raw.barber_id as string | null;
  }

  // service_type — any non-empty string accepted (services are custom per salon)
  if ('service_type' in raw) {
    if (
      raw.service_type !== null &&
      (typeof raw.service_type !== 'string' || raw.service_type.trim().length === 0 || raw.service_type.length > 100)
    ) {
      return Response.json(
        { error: 'service_type must be a non-empty string of 100 characters or fewer' },
        { status: 400 }
      );
    }
    updates.service_type = raw.service_type as string | null;
  }

  if ('duration_minutes' in raw) {
    if (
      typeof raw.duration_minutes !== 'number' ||
      !Number.isInteger(raw.duration_minutes) ||
      raw.duration_minutes < 1 ||
      raw.duration_minutes > 480
    ) {
      return Response.json(
        { error: 'duration_minutes must be an integer between 1 and 480' },
        { status: 400 }
      );
    }
    updates.duration_minutes = raw.duration_minutes;
  }

  if ('notes' in raw) {
    if (raw.notes !== null && (typeof raw.notes !== 'string' || raw.notes.length > 1000)) {
      return Response.json(
        { error: 'notes must be a string of 1000 characters or fewer' },
        { status: 400 }
      );
    }
    updates.notes = raw.notes as string | null;
  }

  const VALID_STATUSES: AppointmentStatus[] = ['scheduled', 'confirmed', 'cancelled'];
  if ('status' in raw) {
    if (!VALID_STATUSES.includes(raw.status as AppointmentStatus)) {
      return Response.json(
        { error: `status must be one of: ${VALID_STATUSES.join(', ')}` },
        { status: 400 }
      );
    }
    updates.status = raw.status as AppointmentStatus;
  }

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: 'No valid fields provided to update' }, { status: 400 });
  }

  // Step 3: Resolve salon for this user. Include timezone for auto-assign availability checks.
  // Also fetch the current appointment to check if it is cancelled.
  const { data: salon, error: salonError } = await supabase
    .from('salons')
    .select('id, timezone')
    .eq('user_id', session.user.id)
    .single();

  if (salonError || !salon) {
    return Response.json({ error: 'Salon not found' }, { status: 404 });
  }

  // Step 3b: Block edits to cancelled appointments — cancelled is a terminal state.
  const { data: currentApptForStatus } = await supabase
    .from('appointments')
    .select('status')
    .eq('id', id)
    .eq('salon_id', salon.id)
    .single();

  if (!currentApptForStatus) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  if (currentApptForStatus.status === 'cancelled') {
    return Response.json({ error: 'Cannot edit a cancelled appointment' }, { status: 400 });
  }

  // Step 4: Double-booking checks — duration-aware overlap detection.
  // Only run when datetime, duration, or participants change.
  // The current appointment (id) is excluded from each conflict query so an
  // idempotent re-save of the same data does not flag itself as a conflict.
  if (updates.datetime || 'client_id' in updates || 'barber_id' in updates || 'duration_minutes' in updates) {
    // Fetch the current record to fill in any values not being updated.
    const { data: existing } = await supabase
      .from('appointments')
      .select('datetime, client_id, barber_id, duration_minutes')
      .eq('id', id)
      .eq('salon_id', salon.id)
      .single();

    const checkDatetime = updates.datetime ?? existing?.datetime;
    const checkClientId = 'client_id' in updates ? updates.client_id : existing?.client_id;
    const checkBarberId = 'barber_id' in updates ? updates.barber_id : existing?.barber_id;
    const checkDuration = updates.duration_minutes ?? existing?.duration_minutes ?? 30;

    if (checkDatetime) {
      const checkStartMs = new Date(checkDatetime).getTime();
      const MAX_DURATION_MS = 480 * 60_000;
      const queryStart = new Date(checkStartMs - MAX_DURATION_MS).toISOString();
      const queryEnd   = new Date(checkStartMs + checkDuration * 60_000).toISOString();

      // 4a: Check client double-booking, excluding this appointment.
      if (checkClientId) {
        const { data: clientAppts } = await supabase
          .from('appointments')
          .select('id, datetime, duration_minutes')
          .eq('salon_id', salon.id)
          .eq('client_id', checkClientId)
          .neq('status', 'cancelled')
          .neq('id', id)
          .gte('datetime', queryStart)
          .lte('datetime', queryEnd);

        const hasClientConflict = (clientAppts ?? []).some((a) => {
          const existStartMs  = new Date(a.datetime).getTime();
          const existDuration = a.duration_minutes ?? 30;
          return appointmentsOverlap(checkStartMs, checkDuration, existStartMs, existDuration);
        });

        if (hasClientConflict) {
          return Response.json(
            { error: 'This client already has an appointment at that time.' },
            { status: 409 }
          );
        }
      }

      // 4b: Check staff double-booking, excluding this appointment.
      // Skipped when no staff is assigned.
      if (checkBarberId) {
        const { data: staffAppts } = await supabase
          .from('appointments')
          .select('id, datetime, duration_minutes')
          .eq('salon_id', salon.id)
          .eq('barber_id', checkBarberId)
          .neq('status', 'cancelled')
          .neq('id', id)
          .gte('datetime', queryStart)
          .lte('datetime', queryEnd);

        const hasStaffConflict = (staffAppts ?? []).some((a) => {
          const existStartMs  = new Date(a.datetime).getTime();
          const existDuration = a.duration_minutes ?? 30;
          return appointmentsOverlap(checkStartMs, checkDuration, existStartMs, existDuration);
        });

        if (hasStaffConflict) {
          return Response.json(
            { error: 'This staff member already has an appointment at that time.' },
            { status: 409 }
          );
        }
      }
    }
  }

  // Step 5: Staff/service assignment check — mirrors the POST validation.
  // Only runs when either barber_id or service_type is being updated.
  if ('barber_id' in updates || 'service_type' in updates) {
    // Fetch the current record to fill in whichever field was not updated.
    const { data: currentAppt } = await supabase
      .from('appointments')
      .select('barber_id, service_type')
      .eq('id', id)
      .eq('salon_id', salon.id)
      .single();

    const checkBarberId = 'barber_id' in updates ? updates.barber_id : currentAppt?.barber_id;
    const checkServiceType = ('service_type' in updates
      ? updates.service_type
      : currentAppt?.service_type) as string | null | undefined;

    if (checkBarberId && checkServiceType) {
      const { data: serviceRecord } = await supabase
        .from('services')
        .select('id')
        .eq('salon_id', salon.id)
        .ilike('name', checkServiceType)
        .maybeSingle();

      if (serviceRecord) {
        const { count: totalAssignments } = await supabase
          .from('barber_services')
          .select('id', { count: 'exact', head: true })
          .eq('service_id', serviceRecord.id);

        if (totalAssignments && totalAssignments > 0) {
          const { data: barberAssignment } = await supabase
            .from('barber_services')
            .select('id')
            .eq('barber_id', checkBarberId)
            .eq('service_id', serviceRecord.id)
            .maybeSingle();

          if (!barberAssignment) {
            return Response.json(
              { error: 'This staff member does not offer the selected service.' },
              { status: 400 }
            );
          }
        }
      }
    }
  }

  // Step 5b: Auto-assign when rescheduling an appointment that has no barber.
  // Only runs when:
  //  - datetime is being updated (it's a reschedule — not a pure notes/status edit)
  //  - barber_id is NOT in the update body (owner left the staff field unchanged)
  //  - The existing appointment has barber_id = null
  //  - The salon has at least one active barber
  // findEligibleBarbers handles service restrictions, availability, and conflicts.
  if (updates.datetime && !('barber_id' in updates)) {
    const { data: existingForAssign } = await supabase
      .from('appointments')
      .select('barber_id, service_type')
      .eq('id', id)
      .eq('salon_id', salon.id)
      .single();

    if (existingForAssign?.barber_id === null) {
      const { count: activeBarberCount } = await supabase
        .from('barbers')
        .select('id', { count: 'exact', head: true })
        .eq('salon_id', salon.id)
        .eq('active', true);

      if (activeBarberCount && activeBarberCount > 0) {
        // Use the updated service_type if being changed, otherwise the current one.
        const serviceForCheck = ('service_type' in updates
          ? updates.service_type
          : existingForAssign.service_type) as string | null | undefined;

        // Resolve duration for the eligibility check (same logic as conflict block above).
        const assignDuration = updates.duration_minutes ?? 30;

        const eligible = await findEligibleBarbers({
          supabase,
          salonId: salon.id,
          datetimeUTC: updates.datetime,
          timezone: salon.timezone,
          serviceTypeName: serviceForCheck ?? null,
          excludeAppointmentId: id,
          newDurationMinutes: assignDuration,
        });

        if (eligible.length === 0) {
          return Response.json(
            { error: 'No available staff member can perform this service at this time.' },
            { status: 409 }
          );
        }

        if (eligible.length === 1) {
          // Exactly one eligible — auto-assign.
          updates.barber_id = eligible[0].id;
        } else {
          // Multiple eligible — require the owner to choose explicitly.
          return Response.json(
            { error: 'Multiple staff members are available. Please choose one.' },
            { status: 409 }
          );
        }
      }
    }
  }

  // Step 7: Update — scoped to this salon so cross-salon updates are impossible.
  const { data: appointment, error: updateError } = await supabase
    .from('appointments')
    .update(updates)
    .eq('id', id)
    .eq('salon_id', salon.id)
    .select()
    .single();

  if (updateError || !appointment) {
    if (updateError?.code === 'PGRST116') {
      // PostgREST code for "no rows returned" — appointment not found or not owned
      return Response.json({ error: 'Not found' }, { status: 404 });
    }
    console.error('[PUT /api/appointments/:id] DB error:', updateError?.message);
    return Response.json({ error: 'Failed to update appointment' }, { status: 500 });
  }

  return Response.json({ appointment: appointment as Appointment }, { status: 200 });
}

// ---------------------------------------------------------------------------
// DELETE — cancel appointment (soft delete)
// ---------------------------------------------------------------------------

/**
 * Cancels an appointment by setting its status to 'cancelled'.
 *
 * Appointments are NEVER hard-deleted — setting status to 'cancelled' preserves
 * the record for history, reporting, and potential future undo functionality.
 * The slot visually disappears from the active calendar but the data is retained.
 *
 * @returns 200 { appointment: Appointment }   — the updated (cancelled) record
 * @returns 401 { error: "Unauthorized" }
 * @returns 404 { error: "Not found" }
 * @returns 500 { error: string }
 */
export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;

  // Step 1: Verify authentication.
  const supabase = await createServerSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Step 2: Resolve salon for this user.
  const { data: salon, error: salonError } = await supabase
    .from('salons')
    .select('id')
    .eq('user_id', session.user.id)
    .single();

  if (salonError || !salon) {
    return Response.json({ error: 'Salon not found' }, { status: 404 });
  }

  // Step 3: Set status to 'cancelled' — soft delete, never hard delete.
  // Scoped to salon_id to prevent cross-salon mutations.
  const { data: appointment, error: updateError } = await supabase
    .from('appointments')
    .update({ status: 'cancelled' as AppointmentStatus })
    .eq('id', id)
    .eq('salon_id', salon.id)
    .select()
    .single();

  if (updateError || !appointment) {
    if (updateError?.code === 'PGRST116') {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }
    console.error('[DELETE /api/appointments/:id] DB error:', updateError?.message);
    return Response.json({ error: 'Failed to cancel appointment' }, { status: 500 });
  }

  // Step 4: Cancel any pending reminders for this appointment.
  // Prevents the cron job from sending reminders for cancelled appointments.
  const { error: reminderError } = await supabase
    .from('reminders')
    .update({ status: 'cancelled' })
    .eq('appointment_id', id)
    .eq('status', 'pending');

  if (reminderError) {
    // Log but do not fail — the appointment is already cancelled.
    console.error('[DELETE /api/appointments/:id] Failed to cancel reminders:', reminderError.message);
  }

  return Response.json({ appointment: appointment as Appointment }, { status: 200 });
}
