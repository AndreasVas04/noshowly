/**
 * app/api/appointments/route.ts
 *
 * GET  /api/appointments?date=YYYY-MM-DD
 *   Returns all appointments for the authenticated salon on the given date
 *   (a calendar day in the salon's timezone), ordered chronologically. Client
 *   and barber names are joined and flattened so the frontend never needs
 *   extra round-trips.
 *
 * GET  /api/appointments?start=YYYY-MM-DD&end=YYYY-MM-DD
 *   Returns all appointments for the authenticated salon within the salon
 *   date range [start, end] inclusive, ordered chronologically. Used by
 *   WeekView to fetch a full week in one call.
 *
 * POST /api/appointments
 *   Creates a new appointment for the authenticated salon.
 *   Client creation is handled separately via POST /api/clients.
 *   This route expects an existing client_id, or null for a walk-in.
 *   The duration is resolved server-side from the service and staff member.
 *
 * Security:
 *  - Authentication is verified on every request before anything else.
 *  - salon_id is always derived from the authenticated session — the caller
 *    never supplies it, preventing cross-salon data access.
 *  - RLS on the appointments table provides a second enforcement layer.
 *  - All inputs are validated before touching the database.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth';
import { createClient } from '@supabase/supabase-js';
import type {
  Appointment,
  AppointmentWithDetails,
  AppointmentStatus,
  Database,
} from '@/types';
import {
  appointmentsOverlap,
  findAppointmentService,
  findEligibleBarbers,
  resolveAppointmentDuration,
} from '@/lib/appointment-helpers';
import { isBarberEligibleForService, isValidDuration } from '@/lib/availability';
import { dayRangeUtc, isValidDateString, resolveTimeZone } from '@/lib/time';
import { planAllowsEmail } from '@/lib/plans';
import type { UserPlan } from '@/lib/plans';
import { sendEmail } from '@/lib/resend';
import { getEmailHTML, getEmailSubject } from '@/lib/reminder-templates';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/**
 * Raw row shape returned by Supabase when using the nested-select join syntax.
 * The `clients` and `barbers` keys hold the joined sub-rows (or null if the
 * related record was deleted / never set).
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
 * @returns Flattened AppointmentWithDetails with client_name, client_phone,
 *          and barber_name at the top level.
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

/** Matches a UUID, so malformed ids are rejected before reaching the database. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// GET — list appointments for a day or date range
// ---------------------------------------------------------------------------

/**
 * Returns all appointments for the authenticated salon within the requested
 * time window, sorted ascending by datetime. Client and barber display names
 * are included in each row.
 *
 * Accepts one of two mutually exclusive query-param forms:
 *  - ?date=YYYY-MM-DD          — single calendar day in the salon's timezone
 *  - ?start=YYYY-MM-DD&end=YYYY-MM-DD — inclusive salon date range (week view)
 *
 * @returns 200 { appointments: AppointmentWithDetails[] }
 * @returns 400 { error: string }               — missing or invalid params
 * @returns 401 { error: "Unauthorized" }       — no valid session
 * @returns 404 { error: "Salon not found" }    — user has no salon record
 * @returns 500 { error: string }               — unexpected DB error
 */
export async function GET(request: Request): Promise<Response> {
  // Step 1: Verify authentication — always first.
  const supabase = await createServerSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Step 2: Parse query params.
  const { searchParams } = new URL(request.url);
  const dateParam  = searchParams.get('date');
  const startParam = searchParams.get('start');
  const endParam   = searchParams.get('end');

  let firstDate: string;
  let lastDate: string;

  if (dateParam) {
    // ---- Single-day mode: ?date=YYYY-MM-DD --------------------------------
    if (!isValidDateString(dateParam)) {
      return Response.json(
        { error: 'Invalid date format. Expected YYYY-MM-DD.' },
        { status: 400 }
      );
    }
    firstDate = dateParam;
    lastDate  = dateParam;

  } else if (startParam && endParam) {
    // ---- Date-range mode: ?start=YYYY-MM-DD&end=YYYY-MM-DD ---------------
    if (!isValidDateString(startParam) || !isValidDateString(endParam)) {
      return Response.json(
        { error: 'Invalid date format. Expected YYYY-MM-DD for both start and end.' },
        { status: 400 }
      );
    }

    if (endParam < startParam) {
      return Response.json(
        { error: 'end date must be on or after start date.' },
        { status: 400 }
      );
    }
    firstDate = startParam;
    lastDate  = endParam;

  } else {
    // Neither form was supplied — return a helpful 400.
    return Response.json(
      { error: 'Provide either ?date=YYYY-MM-DD or ?start=YYYY-MM-DD&end=YYYY-MM-DD' },
      { status: 400 }
    );
  }

  // Step 3: Resolve the salon for this user, with its timezone.
  // salon_id is derived from the session — never trusted from the client.
  const { data: salon, error: salonError } = await supabase
    .from('salons')
    .select('id, timezone')
    .eq('user_id', session.user.id)
    .single();

  if (salonError || !salon) {
    return Response.json({ error: 'Salon not found' }, { status: 404 });
  }

  // Dates are calendar days in the salon's timezone, not in UTC (the server's
  // timezone) or the browser's. The window is [first day 00:00, day after last 00:00).
  const timeZone   = resolveTimeZone(salon.timezone);
  const rangeStart = dayRangeUtc(firstDate, timeZone).start.toISOString();
  const rangeEnd   = dayRangeUtc(lastDate, timeZone).end.toISOString();

  // Step 4: Fetch appointments for the time window with joined client and
  // barber names. The nested select syntax performs LEFT JOINs via the
  // foreign keys defined in the database schema.
  const { data: rows, error: dbError } = await supabase
    .from('appointments')
    .select(`
      *,
      clients (name, phone, email),
      barbers (name)
    `)
    .eq('salon_id', salon.id)
    .gte('datetime', rangeStart)
    .lt('datetime', rangeEnd)
    .order('datetime', { ascending: true });

  if (dbError) {
    console.error('[GET /api/appointments] DB error:', dbError.message);
    return Response.json({ error: 'Failed to load appointments' }, { status: 500 });
  }

  // Cast through unknown because our Database type has Relationships: [] —
  // the Supabase TS client can't infer the join shape, but the SQL foreign
  // keys are defined so the data is correct at runtime.
  const appointments: AppointmentWithDetails[] = (rows as unknown as RawAppointmentRow[]).map(
    toAppointmentWithDetails
  );

  return Response.json({ appointments }, { status: 200 });
}

// ---------------------------------------------------------------------------
// POST — create appointment
// ---------------------------------------------------------------------------

/**
 * Creates a new appointment for the authenticated salon.
 *
 * Request body:
 * {
 *   datetime:          string,          // ISO timestamp, required
 *   client_id?:        string | null,   // existing client UUID, optional
 *   barber_id?:        string | null,   // existing barber UUID, optional
 *   service_id?:       string | null,   // a service of this salon, optional
 *   service_type?:     string | null,   // service name (free text when no service_id)
 *   duration_minutes?: number,          // 1–480; resolved server-side when omitted
 *   notes?:            string | null,
 *   status?:           AppointmentStatus // omitted = decided from the lead time
 * }
 *
 * Duration, when not given explicitly: the service's duration with the staff
 * member's barber_services override, else the duration of a salon service
 * with the same name as service_type, else 30 minutes.
 *
 * Note: client creation (new clients) is handled by POST /api/clients.
 * This route only attaches an already-existing client record.
 *
 * @returns 201 { appointment: Appointment }
 * @returns 400 { error: string }               — validation failure
 * @returns 401 { error: "Unauthorized" }       — no valid session
 * @returns 404 { error: "Salon not found" }    — user has no salon record
 * @returns 500 { error: string }               — unexpected DB error
 */
export async function POST(request: Request): Promise<Response> {
  // Step 1: Verify the user with Supabase Auth. The email step below uses the
  // service-role key, so the user ID must come from a verified token.
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user: authUser, supabase } = auth;

  // Step 2: Plan check — trial and cancelled users cannot create appointments.
  const { data: userData } = await supabase.from('users').select('plan, email_reminders_used_this_month').eq('id', authUser.id).single();
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

  // Validate required: datetime
  if (typeof raw.datetime !== 'string' || !raw.datetime.trim()) {
    return Response.json({ error: 'datetime is required and must be a string' }, { status: 400 });
  }

  const datetimeParsed = new Date(raw.datetime);
  if (isNaN(datetimeParsed.getTime())) {
    return Response.json({ error: 'datetime must be a valid ISO timestamp' }, { status: 400 });
  }

  // Validate optional: client_id
  if (raw.client_id !== undefined && raw.client_id !== null && typeof raw.client_id !== 'string') {
    return Response.json({ error: 'client_id must be a string or null' }, { status: 400 });
  }

  // Validate optional: barber_id
  if (raw.barber_id !== undefined && raw.barber_id !== null && typeof raw.barber_id !== 'string') {
    return Response.json({ error: 'barber_id must be a string or null' }, { status: 400 });
  }
  if (typeof raw.barber_id === 'string' && raw.barber_id !== '' && !UUID_PATTERN.test(raw.barber_id)) {
    return Response.json({ error: 'barber_id is not a valid id' }, { status: 400 });
  }

  // Validate optional: service_id (a service of this salon — checked below)
  if (raw.service_id !== undefined && raw.service_id !== null && typeof raw.service_id !== 'string') {
    return Response.json({ error: 'service_id must be a string or null' }, { status: 400 });
  }
  if (typeof raw.service_id === 'string' && raw.service_id !== '' && !UUID_PATTERN.test(raw.service_id)) {
    return Response.json({ error: 'Service not found' }, { status: 400 });
  }

  // Validate optional: service_type — any non-empty string is accepted (services are custom per salon)
  if (
    raw.service_type !== undefined &&
    raw.service_type !== null &&
    (typeof raw.service_type !== 'string' || raw.service_type.trim().length === 0 || raw.service_type.length > 100)
  ) {
    return Response.json(
      { error: 'service_type must be a non-empty string of 100 characters or fewer' },
      { status: 400 }
    );
  }

  // Validate optional: duration_minutes (integer 1–480)
  if (raw.duration_minutes !== undefined && !isValidDuration(raw.duration_minutes)) {
    return Response.json(
      { error: 'duration_minutes must be an integer between 1 and 480' },
      { status: 400 }
    );
  }
  const explicitDuration = raw.duration_minutes as number | undefined;

  // Validate optional: notes
  if (
    raw.notes !== undefined &&
    raw.notes !== null &&
    (typeof raw.notes !== 'string' || raw.notes.length > 1000)
  ) {
    return Response.json(
      { error: 'notes must be a string of 1000 characters or fewer' },
      { status: 400 }
    );
  }

  // Validate optional: status — allows the owner to create an already-confirmed
  // appointment (e.g. phone-confirmed on the spot). Defaults to 'scheduled'.
  const VALID_POST_STATUSES: AppointmentStatus[] = ['scheduled', 'confirmed', 'cancelled'];
  if (raw.status !== undefined && !VALID_POST_STATUSES.includes(raw.status as AppointmentStatus)) {
    return Response.json(
      { error: `status must be one of: ${VALID_POST_STATUSES.join(', ')}` },
      { status: 400 }
    );
  }
  // Default to 'scheduled', but auto-confirm when no explicit status is given and
  // the appointment is less than 23 hours away — the cron job will never send a
  // YES/NO reminder in that window, so there is no mechanism for the client to confirm.
  let requestedStatus: AppointmentStatus =
    (raw.status as AppointmentStatus | undefined) ?? 'scheduled';
  if (raw.status === undefined) {
    const hoursUntil = (datetimeParsed.getTime() - Date.now()) / (1000 * 60 * 60);
    if (hoursUntil < 23) {
      requestedStatus = 'confirmed';
    }
  }

  // Step 3: Resolve salon for this user. Include timezone for availability checks.
  const { data: salon, error: salonError } = await supabase
    .from('salons')
    .select('id, timezone')
    .eq('user_id', authUser.id)
    .single();

  if (salonError || !salon) {
    return Response.json({ error: 'Salon not found' }, { status: 404 });
  }

  const clientId = (raw.client_id as string | null | undefined) || null;
  const barberId = (raw.barber_id as string | null | undefined) || null;

  // Step 4: Resolve the service — by id (must belong to this salon), or by
  // name for free-text service types. The name is stored as service_type.
  const serviceLookup = await findAppointmentService({
    supabase,
    salonId: salon.id,
    serviceId: (raw.service_id as string | null | undefined) || null,
    serviceName: (raw.service_type as string | null | undefined) ?? null,
  });
  if (!serviceLookup.ok) {
    return Response.json({ error: serviceLookup.error }, { status: 400 });
  }
  const { service, assignments } = serviceLookup;
  const serviceTypeName: string | null =
    service?.name ?? ((raw.service_type as string | null | undefined)?.trim() || null);

  // Step 5: Staff/service assignment check — the selected staff member must
  // belong to this salon and, when the service has barber_services rows, be
  // one of them (the same rule the booking page uses).
  if (barberId) {
    const { data: barberRow } = await supabase
      .from('barbers')
      .select('id')
      .eq('id', barberId)
      .eq('salon_id', salon.id)
      .maybeSingle();

    if (!barberRow) {
      return Response.json({ error: 'Staff member not found' }, { status: 400 });
    }

    if (service && !isBarberEligibleForService(service.id, barberId, assignments)) {
      return Response.json(
        { error: 'This staff member does not offer the selected service.' },
        { status: 400 }
      );
    }
  }

  // Step 5b: Auto-assign or block when no staff selected and the salon has
  // active barbers. findEligibleBarbers applies service + availability +
  // conflict filters in one call, each staff member with their own duration.
  // If the salon has no barbers, skip entirely — unassigned appointments allowed.
  let resolvedBarberId: string | null = barberId;
  let newDuration = resolveAppointmentDuration(explicitDuration, service, barberId, assignments);
  if (!barberId) {
    const { count: activeBarberCount } = await supabase
      .from('barbers')
      .select('id', { count: 'exact', head: true })
      .eq('salon_id', salon.id)
      .eq('active', true);

    if (activeBarberCount && activeBarberCount > 0) {
      const eligible = await findEligibleBarbers({
        supabase,
        salonId: salon.id,
        datetimeUTC: datetimeParsed.toISOString(),
        timezone: resolveTimeZone(salon.timezone),
        service,
        assignments,
        explicitDurationMinutes: explicitDuration,
      });

      if (eligible.length === 0) {
        return Response.json(
          { error: 'No available staff member can perform this service at this time.' },
          { status: 409 }
        );
      }

      if (eligible.length === 1) {
        // Exactly one eligible — auto-assign, with their own duration.
        resolvedBarberId = eligible[0].id;
        newDuration = eligible[0].durationMinutes;
      } else {
        // Multiple eligible — owner must choose to avoid silent bias.
        return Response.json(
          { error: 'Multiple staff members are available. Please choose one.' },
          { status: 409 }
        );
      }
    }
  }

  // Step 5c: Double-booking checks — duration-aware overlap detection.
  // Two appointments overlap when: existingStart < newEnd AND newStart < existingEnd.
  const newStartMs  = datetimeParsed.getTime();
  const MAX_DURATION_MS = 480 * 60_000; // 8 h — matches validation max
  const queryStart  = new Date(newStartMs - MAX_DURATION_MS).toISOString();
  const queryEnd    = new Date(newStartMs + newDuration * 60_000).toISOString();

  // Check if the client already has an overlapping appointment.
  // Protects against accidentally booking the same person twice at the same time.
  if (clientId) {
    const { data: clientAppts } = await supabase
      .from('appointments')
      .select('id, datetime, duration_minutes')
      .eq('salon_id', salon.id)
      .eq('client_id', clientId)
      .neq('status', 'cancelled')
      .gte('datetime', queryStart)
      .lt('datetime', queryEnd);

    const hasClientConflict = (clientAppts ?? []).some((a) => {
      const existStartMs  = new Date(a.datetime).getTime();
      const existDuration = a.duration_minutes ?? 30;
      return appointmentsOverlap(newStartMs, newDuration, existStartMs, existDuration);
    });

    if (hasClientConflict) {
      return Response.json(
        { error: 'This client already has an appointment at that time.' },
        { status: 409 }
      );
    }
  }

  // Check if the selected staff member already has an overlapping appointment.
  // Skipped when no staff is assigned (walk-in appointments); an auto-assigned
  // staff member was already checked by findEligibleBarbers.
  if (barberId) {
    const { data: staffAppts } = await supabase
      .from('appointments')
      .select('id, datetime, duration_minutes')
      .eq('salon_id', salon.id)
      .eq('barber_id', barberId)
      .neq('status', 'cancelled')
      .gte('datetime', queryStart)
      .lt('datetime', queryEnd);

    const hasStaffConflict = (staffAppts ?? []).some((a) => {
      const existStartMs  = new Date(a.datetime).getTime();
      const existDuration = a.duration_minutes ?? 30;
      return appointmentsOverlap(newStartMs, newDuration, existStartMs, existDuration);
    });

    if (hasStaffConflict) {
      return Response.json(
        { error: 'This staff member already has an appointment at that time.' },
        { status: 409 }
      );
    }
  }

  // Step 6: Insert the appointment.
  // salon_id is derived from session — never accepted from client request body.
  const { data: appointment, error: insertError } = await supabase
    .from('appointments')
    .insert({
      salon_id: salon.id,
      client_id: clientId,
      barber_id: resolvedBarberId,
      datetime: datetimeParsed.toISOString(),
      service_type: serviceTypeName,
      duration_minutes: newDuration,
      notes: (raw.notes as string | null | undefined) ?? null,
      status: requestedStatus,
    })
    .select()
    .single();

  if (insertError || !appointment) {
    if (insertError?.code === '23P01') {
      // An exclusion constraint caught an overlapping booking made at the same moment.
      return Response.json(
        { error: 'This staff member already has an appointment at that time.' },
        { status: 409 }
      );
    }
    console.error('[POST /api/appointments] DB error:', insertError?.message);
    return Response.json({ error: 'Failed to create appointment' }, { status: 500 });
  }

  // Step 7: Send immediate YES/NO confirmation email for 'scheduled' appointments.
  // Same email the cron sends ~24h before, but triggered immediately so the client
  // can confirm right away. Skipped for 'confirmed' (auto-confirmed <23h bookings),
  // plans that don't allow email, or clients without an email address.
  // This is fire-and-forget — failures are logged but never block the 201 response.
  if (requestedStatus === 'scheduled' && clientId && planAllowsEmail(userData.plan as UserPlan)) {
    try {
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

      if (serviceRoleKey && supabaseUrl) {
        const adminSupabase = createClient<Database>(supabaseUrl, serviceRoleKey);

        // Fetch client email — only proceed if the client has one.
        // Scoped to this salon: the service-role client bypasses RLS, and the
        // client_id comes from the request body.
        const { data: clientData } = await adminSupabase
          .from('clients')
          .select('name, email')
          .eq('id', clientId)
          .eq('salon_id', salon.id)
          .single();

        if (clientData?.email) {
          // Fetch full salon data for email template fields.
          const { data: salonData } = await adminSupabase
            .from('salons')
            .select('name, timezone, email_footer, email_subject, email_greeting, email_body, email_closing, email_confirmation_enabled')
            .eq('id', salon.id)
            .single();

          const salonDisplayName = salonData?.name ?? 'Your salon';
          const clientName = clientData.name ?? 'there';
          const timezone = salonData?.timezone ?? 'UTC';
          const token = crypto.randomUUID();
          const sendAt = new Date().toISOString();

          // Create a 'pending' reminder record with a unique token for YES/NO links.
          const { data: reminder, error: reminderInsertError } = await adminSupabase
            .from('reminders')
            .insert({
              appointment_id: (appointment as Appointment).id,
              type: 'email' as const,
              send_at: sendAt,
              status: 'pending' as const,
              token,
            })
            .select()
            .single();

          if (reminder && !reminderInsertError) {
            const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
            const confirmUrl = `${appUrl}/api/confirm/${token}?response=yes`;
            const cancelUrl = `${appUrl}/api/confirm/${token}?response=no`;

            const subject = getEmailSubject(salonDisplayName, salonData?.email_subject);
            const html = getEmailHTML(
              salonDisplayName,
              clientName,
              serviceTypeName,
              datetimeParsed.toISOString(),
              timezone,
              confirmUrl,
              cancelUrl,
              salonData?.email_footer,
              salonData?.email_confirmation_enabled ?? true,
              salonData?.email_greeting,
              salonData?.email_body,
              salonData?.email_closing,
            );

            const result = await sendEmail(clientData.email, subject, html);

            if (result.success) {
              // Mark reminder as sent and record the timestamp.
              await adminSupabase
                .from('reminders')
                .update({ status: 'sent' as const, sent_at: new Date().toISOString() })
                .eq('id', reminder.id);

              // Increment the monthly email usage counter.
              await adminSupabase
                .from('users')
                .update({
                  email_reminders_used_this_month: (userData.email_reminders_used_this_month ?? 0) + 1,
                })
                .eq('id', authUser.id);

              console.log(`[POST /api/appointments] Immediate reminder sent for appt=${(appointment as Appointment).id}`);
            } else {
              // Email failed — mark reminder as failed. Cron will NOT retry because
              // the reminder record exists (though with 'failed' status, not 'sent').
              console.error(`[POST /api/appointments] Immediate reminder failed for appt=${(appointment as Appointment).id}:`, result.error);
              await adminSupabase
                .from('reminders')
                .update({ status: 'failed' as const })
                .eq('id', reminder.id);
            }
          } else {
            console.error('[POST /api/appointments] Failed to insert reminder record:', reminderInsertError?.message);
          }
        }
      }
    } catch (err) {
      // Fire-and-forget — log but never fail the appointment creation response.
      console.error('[POST /api/appointments] Immediate reminder error (non-fatal):', err);
    }
  }

  return Response.json({ appointment: appointment as Appointment }, { status: 201 });
}
