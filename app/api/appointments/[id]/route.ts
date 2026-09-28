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
 *
 * Email links: when an appointment is moved to another time or client, or
 * cancelled, the YES/NO links of its 24-hour reminder and booking
 * confirmation are retired (lib/reminders/store.ts cancelReminderLinks),
 * including links the client already answered, so old emails cannot act on
 * it or show it as confirmed, and a new 24-hour reminder can go out. Owners
 * cannot write reminders rows themselves, so this uses the service-role key,
 * after the owner's own update of the appointment succeeded; PUT and DELETE
 * therefore authenticate with requireUser() (lib/auth.ts).
 *
 * PUT and DELETE need write access: an ended trial or an inactive
 * subscription is read-only (lib/access.ts). GET always works.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/auth';
import { requireWriteAccess } from '@/lib/access';
import {
  appointmentsOverlap,
  findAppointmentService,
  findEligibleBarbers,
  toAppointmentWithDetails,
  type AppointmentRowWithRelations,
  type ServiceLookupResult,
} from '@/lib/appointment-helpers';
import {
  getEffectiveDuration,
  isBarberEligibleForService,
  isValidDuration,
} from '@/lib/availability';
import { isUuid } from '@/lib/postgrest';
import { resolveTimeZone } from '@/lib/time';
import { cancelReminderLinks } from '@/lib/reminders/store';
import type { Appointment, AppointmentStatus } from '@/types';

/**
 * Retires an appointment's email links (cancelReminderLinks()) with the
 * service-role key: owners can read reminders rows but not change them
 * (supabase/migrations/20260929120000_read_only_accounts.sql). Only call it
 * with the id of an appointment the owner has just updated through their own
 * client, which Row Level Security only allows for their own appointments.
 *
 * @param appointmentId - Appointment id, as returned by the owner's update.
 * @returns             Error message, or null on success. Never throws.
 */
async function retireEmailLinks(appointmentId: string): Promise<string | null> {
  try {
    return await cancelReminderLinks(createAdminSupabaseClient(), appointmentId);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
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
  const appointment = toAppointmentWithDetails(row as unknown as AppointmentRowWithRelations);
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
 *   datetime?:         string,              // ISO timestamp
 *   client_id?:        string | null,
 *   barber_id?:        string | null,
 *   service_id?:       string | null,       // a service of this salon; its name is stored
 *   service_type?:     string | null,       // service name (free text when no service_id)
 *   duration_minutes?: number,              // 1–480
 *   notes?:            string | null,
 *   status?:           AppointmentStatus,
 * }
 *
 * Duration: an explicit duration_minutes wins. Otherwise, when the service or
 * the staff member changes, it is recomputed (service duration with the staff
 * member's override, else a service with the same name, else 30 minutes). A
 * staff change on a free-text service keeps the stored duration. Conflict
 * checks and auto-assignment use the stored duration when it does not change.
 *
 * @returns 200 { appointment: Appointment }
 * @returns 400 { error: string }       — validation failure
 * @returns 401 { error: "Unauthorized" }
 * @returns 403 { error: string, code: string } — read-only account (trial ended / inactive)
 * @returns 404 { error: "Not found" }
 * @returns 409 { error: string }       — double booking / no staff available
 * @returns 500 { error: string }
 */
export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;

  // Step 1: Verify authentication. requireUser(), because Step 9 uses the
  // service-role key.
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  // Step 1b: Plan check — an ended trial or an inactive subscription is read-only.
  const access = await requireWriteAccess(supabase, user.id);
  if (!access.ok) return access.response;

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
    updates.client_id = (raw.client_id as string | null) || null;
  }

  if ('barber_id' in raw) {
    if (raw.barber_id !== null && typeof raw.barber_id !== 'string') {
      return Response.json({ error: 'barber_id must be a string or null' }, { status: 400 });
    }
    if (typeof raw.barber_id === 'string' && raw.barber_id !== '' && !isUuid(raw.barber_id)) {
      return Response.json({ error: 'barber_id is not a valid id' }, { status: 400 });
    }
    updates.barber_id = (raw.barber_id as string | null) || null;
  }

  // service_id — a service of this salon (checked below); its name is stored as service_type.
  let requestedServiceId: string | null = null;
  if ('service_id' in raw) {
    if (raw.service_id !== null && typeof raw.service_id !== 'string') {
      return Response.json({ error: 'service_id must be a string or null' }, { status: 400 });
    }
    if (typeof raw.service_id === 'string' && raw.service_id !== '' && !isUuid(raw.service_id)) {
      return Response.json({ error: 'Service not found' }, { status: 400 });
    }
    requestedServiceId = (raw.service_id as string | null) || null;
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
    updates.service_type = (raw.service_type as string | null)?.trim() ?? null;
  } else if ('service_id' in raw && !requestedServiceId) {
    // service_id: null without a name clears the service.
    updates.service_type = null;
  }

  if ('duration_minutes' in raw) {
    if (!isValidDuration(raw.duration_minutes)) {
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

  if (Object.keys(updates).length === 0 && !('service_id' in raw)) {
    return Response.json({ error: 'No valid fields provided to update' }, { status: 400 });
  }

  // Step 3: Resolve salon for this user. Include timezone for auto-assign availability checks.
  const { data: salon, error: salonError } = await supabase
    .from('salons')
    .select('id, timezone')
    .eq('user_id', user.id)
    .single();

  if (salonError || !salon) {
    return Response.json({ error: 'Salon not found' }, { status: 404 });
  }

  // Step 4: Load the current appointment. Cancelled is a terminal state.
  const { data: current } = await supabase
    .from('appointments')
    .select('datetime, client_id, barber_id, service_type, duration_minutes, status')
    .eq('id', id)
    .eq('salon_id', salon.id)
    .maybeSingle();

  if (!current) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  if (current.status === 'cancelled') {
    return Response.json({ error: 'Cannot edit a cancelled appointment' }, { status: 400 });
  }

  // Step 5: Service, staff and duration.
  const serviceSent      = 'service_id' in raw || 'service_type' in raw;
  const barberChanged    = 'barber_id' in updates && updates.barber_id !== current.barber_id;
  const newBarberId      = 'barber_id' in updates ? (updates.barber_id ?? null) : current.barber_id;
  const explicitDuration = 'duration_minutes' in raw ? updates.duration_minutes : undefined;

  // The appointment's service after this update: by id when one was sent,
  // otherwise the salon service matching the (new or stored) name, if any.
  let serviceLookup: ServiceLookupResult | null = null;
  async function lookUpService(): Promise<ServiceLookupResult> {
    if (!serviceLookup) {
      serviceLookup = await findAppointmentService({
        supabase,
        salonId: salon!.id,
        serviceId: requestedServiceId,
        serviceName: 'service_type' in updates ? updates.service_type : current!.service_type,
      });
    }
    return serviceLookup;
  }

  if (serviceSent || barberChanged) {
    const lookup = await lookUpService();
    if (!lookup.ok) {
      return Response.json({ error: lookup.error }, { status: 400 });
    }
    const { service, assignments } = lookup;

    // Store the canonical name of a service picked by id.
    if (service && requestedServiceId) updates.service_type = service.name;

    // Re-sending the stored service is not a change.
    const serviceChanged =
      serviceSent &&
      (updates.service_type ?? '').trim().toLowerCase() !== (current.service_type ?? '').trim().toLowerCase();

    if (barberChanged && newBarberId) {
      const { data: barberRow } = await supabase
        .from('barbers')
        .select('id')
        .eq('id', newBarberId)
        .eq('salon_id', salon.id)
        .maybeSingle();

      if (!barberRow) {
        return Response.json({ error: 'Staff member not found' }, { status: 400 });
      }
    }

    // Staff/service assignment check — the same rule as the booking page.
    if (newBarberId && service && !isBarberEligibleForService(service.id, newBarberId, assignments)) {
      return Response.json(
        { error: 'This staff member does not offer the selected service.' },
        { status: 400 }
      );
    }

    // Recompute the duration unless one was given explicitly: when the
    // service changes, or when the staff member changes on a known service
    // (their override may differ). A staff change on a free-text service has
    // nothing to recompute from, so it keeps the stored duration.
    if (explicitDuration === undefined && (serviceChanged || (barberChanged && service))) {
      updates.duration_minutes = getEffectiveDuration(service, newBarberId, assignments);
    }
  }

  // Step 6: Auto-assign when rescheduling an appointment that has no barber.
  // Only runs when:
  //  - datetime is being updated (it's a reschedule — not a pure notes/status edit)
  //  - barber_id is NOT in the update body (owner left the staff field unchanged)
  //  - The existing appointment has barber_id = null
  //  - The salon has at least one active barber
  // findEligibleBarbers handles service restrictions, availability, and conflicts.
  let autoAssigned = false;
  if (updates.datetime && !('barber_id' in updates) && current.barber_id === null) {
    const { count: activeBarberCount } = await supabase
      .from('barbers')
      .select('id', { count: 'exact', head: true })
      .eq('salon_id', salon.id)
      .eq('active', true);

    if (activeBarberCount && activeBarberCount > 0) {
      const lookup = await lookUpService();
      if (!lookup.ok) {
        return Response.json({ error: lookup.error }, { status: 400 });
      }

      // An explicit duration applies to everyone. Otherwise each staff member
      // gets their own length for a known service, and a free-text service
      // keeps its (stored or just recomputed) duration.
      const assignDuration =
        explicitDuration ??
        (lookup.service ? undefined : updates.duration_minutes ?? current.duration_minutes ?? 30);

      const eligible = await findEligibleBarbers({
        supabase,
        salonId: salon.id,
        datetimeUTC: updates.datetime,
        timezone: resolveTimeZone(salon.timezone),
        service: lookup.service,
        assignments: lookup.assignments,
        excludeAppointmentId: id,
        explicitDurationMinutes: assignDuration,
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
        if (explicitDuration === undefined && lookup.service) {
          updates.duration_minutes = eligible[0].durationMinutes;
        }
        autoAssigned = true;
      } else {
        // Multiple eligible — require the owner to choose explicitly.
        return Response.json(
          { error: 'Multiple staff members are available. Please choose one.' },
          { status: 409 }
        );
      }
    }
  }

  // Step 7: Double-booking checks — duration-aware overlap detection.
  // Only run when datetime, duration, or participants change. The stored
  // duration is used when it does not change. The current appointment (id) is
  // excluded from each conflict query so re-saving the same data never
  // flags itself as a conflict.
  const durationChanged = updates.duration_minutes !== undefined && updates.duration_minutes !== current.duration_minutes;
  if (updates.datetime || 'client_id' in updates || barberChanged || durationChanged) {
    const checkDatetime = updates.datetime ?? current.datetime;
    const checkClientId = 'client_id' in updates ? updates.client_id : current.client_id;
    const checkBarberId = 'barber_id' in updates ? updates.barber_id : current.barber_id;
    const checkDuration = updates.duration_minutes ?? current.duration_minutes ?? 30;

    const checkStartMs = new Date(checkDatetime).getTime();
    const MAX_DURATION_MS = 480 * 60_000;
    const queryStart = new Date(checkStartMs - MAX_DURATION_MS).toISOString();
    const queryEnd   = new Date(checkStartMs + checkDuration * 60_000).toISOString();

    // 7a: Check client double-booking, excluding this appointment.
    if (checkClientId) {
      const { data: clientAppts } = await supabase
        .from('appointments')
        .select('id, datetime, duration_minutes')
        .eq('salon_id', salon.id)
        .eq('client_id', checkClientId)
        .neq('status', 'cancelled')
        .neq('id', id)
        .gte('datetime', queryStart)
        .lt('datetime', queryEnd);

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

    // 7b: Check staff double-booking, excluding this appointment.
    // Skipped when no staff is assigned, or when the staff member was just
    // auto-assigned (findEligibleBarbers already checked their appointments).
    if (checkBarberId && !autoAssigned) {
      const { data: staffAppts } = await supabase
        .from('appointments')
        .select('id, datetime, duration_minutes')
        .eq('salon_id', salon.id)
        .eq('barber_id', checkBarberId)
        .neq('status', 'cancelled')
        .neq('id', id)
        .gte('datetime', queryStart)
        .lt('datetime', queryEnd);

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

  if (Object.keys(updates).length === 0) {
    // e.g. service_id re-sent unchanged for a free-text service: nothing to write.
    return Response.json({ error: 'No valid fields provided to update' }, { status: 400 });
  }

  // Step 8: Update — scoped to this salon so cross-salon updates are impossible.
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
    if (updateError?.code === '23P01') {
      // An exclusion constraint caught an overlapping booking made at the same moment.
      return Response.json(
        { error: 'This staff member already has an appointment at that time.' },
        { status: 409 }
      );
    }
    console.error('[PUT /api/appointments/:id] DB error:', updateError?.message);
    return Response.json({ error: 'Failed to update appointment' }, { status: 500 });
  }

  // Step 9: Retire the email links when the time or the client changes, or
  // the appointment is cancelled: old YES/NO buttons stop working, and the
  // reminder job can claim a new 24-hour reminder for the new time.
  const datetimeChanged =
    updates.datetime !== undefined &&
    new Date(updates.datetime).getTime() !== new Date(current.datetime).getTime();
  const clientChanged = 'client_id' in updates && updates.client_id !== current.client_id;
  if (datetimeChanged || clientChanged || updates.status === 'cancelled') {
    const reminderError = await retireEmailLinks(appointment.id);
    if (reminderError) {
      // Log but do not fail — the appointment is already updated.
      console.error('[PUT /api/appointments/:id] Failed to retire reminder links:', reminderError);
    }
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
 * @returns 403 { error: string, code: string } — read-only account (trial ended / inactive)
 * @returns 404 { error: "Not found" }
 * @returns 500 { error: string }
 */
export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;

  // Step 1: Verify authentication. requireUser(), because Step 4 uses the
  // service-role key.
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  // Step 1b: Plan check — an ended trial or an inactive subscription is read-only.
  const access = await requireWriteAccess(supabase, user.id);
  if (!access.ok) return access.response;

  // Step 2: Resolve salon for this user.
  const { data: salon, error: salonError } = await supabase
    .from('salons')
    .select('id')
    .eq('user_id', user.id)
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

  // Step 4: Retire the appointment's email links (pending, sent and already
  // answered 24-hour reminders and booking confirmations), so old YES/NO
  // buttons stop working. The reminder job never emails cancelled appointments.
  const reminderError = await retireEmailLinks(appointment.id);

  if (reminderError) {
    // Log but do not fail — the appointment is already cancelled.
    console.error('[DELETE /api/appointments/:id] Failed to cancel reminders:', reminderError);
  }

  return Response.json({ appointment: appointment as Appointment }, { status: 200 });
}
