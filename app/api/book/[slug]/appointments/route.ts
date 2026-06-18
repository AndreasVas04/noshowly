/**
 * app/api/book/[slug]/appointments/route.ts
 *
 * POST /api/book/[slug]/appointments — public endpoint; no authentication required.
 *
 * Creates a new appointment via the public booking page. Steps:
 *  1. Validate the slug and that the booking page is active.
 *  2. Validate all client-supplied fields.
 *  3. Find or create the client by phone number (deduplication).
 *  4. Check for scheduling conflicts using a ±30 min window.
 *  5. Create the appointment.
 *  6. Create pending email reminder record (24 h before).
 *  7. Send a booking confirmation email to the client (if email provided).
 *
 * Security:
 *  - No authentication — this is intentionally public.
 *  - The service role key is used server-side to write clients/appointments/reminders
 *    because the clients table has owner-only RLS; the booking flow needs to create
 *    records without the client being authenticated.
 *  - service role is NEVER exposed to the browser — only used in this API route.
 *  - All inputs are validated before touching the database.
 *  - Slug is looked up server-side; salon_id always comes from the DB, never the client.
 */

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types';
import { sendEmail } from '@/lib/resend';
import { findEligibleBarbers, appointmentsOverlap } from '@/lib/appointment-helpers';

// ---------------------------------------------------------------------------
// Service-role Supabase client (server-side only — bypasses RLS)
// ---------------------------------------------------------------------------

/**
 * Creates a Supabase client with the service role key.
 * Used only for the booking flow where the visitor is unauthenticated.
 * NEVER import this or use it in client components.
 */
function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing Supabase environment variables');
  }
  return createClient<Database>(url, key);
}

// ---------------------------------------------------------------------------
// Booking confirmation email template
// ---------------------------------------------------------------------------

/**
 * Builds the HTML body for the booking acknowledgement email sent to the client
 * immediately after they book via the public booking page.
 *
 * Design principles (same as reminder emails):
 *  - Noshowly is completely invisible — only the salon's name is shown.
 *  - No YES/NO buttons — this is a booking acknowledgement, not a reminder.
 *  - The appointment is still 'scheduled' (pending) at this point; the copy
 *    must NOT say "confirmed". Use "booked" instead.
 *  - Inline CSS only for broad email client compatibility.
 *
 * @param salonName   - The salon display name.
 * @param clientName  - The client's name.
 * @param serviceType - Service booked, or null.
 * @param staffName   - Staff member name, or null if no preference.
 * @param datetimeUTC - UTC ISO timestamp of the appointment.
 * @param timezone    - IANA timezone for date/time display.
 * @returns           Complete HTML document string.
 */
function getConfirmationEmailHTML(
  salonName: string,
  clientName: string,
  serviceType: string | null,
  staffName: string | null,
  datetimeUTC: string,
  timezone: string,
): string {
  const service = serviceType?.trim() || 'appointment';

  // Format date and time in the salon's local timezone.
  const dateTimeStr = (() => {
    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }).format(new Date(datetimeUTC));
    } catch {
      return new Date(datetimeUTC).toUTCString();
    }
  })();

  // Escape HTML special characters to prevent injection via user-supplied strings.
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;')
     .replace(/</g, '&lt;')
     .replace(/>/g, '&gt;')
     .replace(/"/g, '&quot;')
     .replace(/'/g, '&#39;');

  const safeSalon   = escape(salonName);
  const safeClient  = escape(clientName);
  const safeService = escape(service);
  const safeStaff   = staffName ? escape(staffName) : null;
  const safeDate    = escape(dateTimeStr);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Appointment Booked — ${safeSalon}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="background:#18181b;padding:28px 32px;">
              <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">
                ${safeSalon}
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 8px;font-size:16px;color:#3f3f46;">Hi ${safeClient},</p>
              <p style="margin:0 0 24px;font-size:16px;color:#3f3f46;line-height:1.5;">
                Your appointment has been booked.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0"
                style="background:#f4f4f5;border-radius:6px;margin-bottom:28px;">
                <tr>
                  <td style="padding:20px 24px;">
                    <p style="margin:0 0 6px;font-size:13px;font-weight:600;color:#71717a;
                               text-transform:uppercase;letter-spacing:0.5px;">Service</p>
                    <p style="margin:0 0 ${safeStaff ? '16px' : '0'};font-size:16px;color:#18181b;font-weight:600;">
                      ${safeService}
                    </p>
                    ${safeStaff ? `<p style="margin:0 0 6px;font-size:13px;font-weight:600;color:#71717a;
                               text-transform:uppercase;letter-spacing:0.5px;">Staff</p>
                    <p style="margin:0 0 16px;font-size:16px;color:#18181b;font-weight:600;">${safeStaff}</p>` : ''}
                    <p style="margin:${safeStaff || service !== 'appointment' ? '0 0 6px' : '16px 0 6px'};font-size:13px;font-weight:600;color:#71717a;
                               text-transform:uppercase;letter-spacing:0.5px;">Date &amp; Time</p>
                    <p style="margin:0;font-size:16px;color:#18181b;font-weight:600;">${safeDate}</p>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:14px;color:#71717a;text-align:center;">See you soon!</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #f4f4f5;">
              <p style="margin:0;font-size:13px;color:#a1a1aa;text-align:center;">
                If you have questions, contact ${safeSalon} directly.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Timezone conversion helper
// ---------------------------------------------------------------------------

/**
 * Converts a local date + time in the given IANA timezone to a UTC ISO string.
 *
 * Strategy: treat the input as UTC to get a reference Date, then compare what
 * the timezone formatter says the local time is vs. what we want, derive the
 * offset, and shift accordingly.
 *
 * @param dateStr  - Date in YYYY-MM-DD format.
 * @param timeStr  - Time in HH:MM format (24-hour).
 * @param timezone - IANA timezone identifier, e.g. "Europe/Nicosia".
 * @returns        UTC ISO timestamp string.
 */
function localToUTC(dateStr: string, timeStr: string, timezone: string): string {
  // Treat the input as if it were UTC (we will correct for the offset below).
  const naiveUTC = new Date(`${dateStr}T${timeStr}:00Z`);

  // Ask Intl what the given timezone says for naiveUTC.
  const tzParts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year:   'numeric',
    month:  '2-digit',
    day:    '2-digit',
    hour:   '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(naiveUTC);

  const p: Record<string, string> = {};
  for (const part of tzParts) {
    if (part.type !== 'literal') p[part.type] = part.value;
  }

  // Reconstruct the timezone-local time as a UTC timestamp so we can measure the offset.
  const hour = p.hour === '24' ? '00' : p.hour;
  const tzAsUTC = new Date(`${p.year}-${p.month}-${p.day}T${hour}:${p.minute}:${p.second}Z`);

  // offsetMs = what the TZ showed for naiveUTC − naiveUTC itself
  const offsetMs = tzAsUTC.getTime() - naiveUTC.getTime();

  // Actual UTC = local time (naiveUTC) − offset
  return new Date(naiveUTC.getTime() - offsetMs).toISOString();
}

// ---------------------------------------------------------------------------
// POST — create appointment from booking page
// ---------------------------------------------------------------------------

/**
 * Creates a new appointment submitted via the public booking page.
 *
 * Request body:
 *  {
 *    service_id?:    string   — UUID of a service from GET /api/book/[slug]
 *    service_name?:  string   — free-text service name (used if service_id not given)
 *    barber_id?:     string   — UUID of a barber (optional)
 *    date:           string   — YYYY-MM-DD in the salon's timezone
 *    time:           string   — HH:MM 24-hour in the salon's timezone
 *    client_name:    string   — 1–100 chars
 *    client_phone:   string   — must start with + (country code required for international routing)
 *    client_email?:  string   — optional; used for email reminders
 *    notes?:         string   — optional client note to barber
 *  }
 *
 * @param request - Incoming request.
 * @param params  - Route params containing `slug`.
 *
 * @returns 201 { appointmentId: string }
 * @returns 400 { error: string }               — validation failure
 * @returns 404 { error: "Booking page not found" }
 * @returns 409 { error: string }               — scheduling conflict
 * @returns 500 { error: string }               — unexpected DB error
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  try {
    return await handleBookingPost(request, params);
  } catch (err) {
    console.error('[POST /api/book/[slug]/appointments] UNCAUGHT TOP-LEVEL ERROR:', err);
    return Response.json({ error: 'Unexpected server error' }, { status: 500 });
  }
}

/**
 * Inner handler so the exported POST function can wrap everything in a top-level
 * try-catch. This ensures uncaught exceptions always return JSON (not Next.js HTML).
 */
async function handleBookingPost(
  request: Request,
  params: Promise<{ slug: string }>
): Promise<Response> {
  const { slug } = await params;

  if (!slug) {
    return Response.json({ error: 'Booking page not found' }, { status: 404 });
  }

  // Step 1: Parse and validate request body.
  let body: unknown;
  try {
    body = await request.json();
  } catch (err) {
    console.error('[POST /api/book/[slug]/appointments] JSON parse error:', err);
    return Response.json({ error: 'Invalid JSON in request body' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null) {
    return Response.json({ error: 'Request body must be a JSON object' }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;

  // Validate date
  if (typeof raw.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date)) {
    return Response.json({ error: 'date must be in YYYY-MM-DD format' }, { status: 400 });
  }

  // Validate time
  if (typeof raw.time !== 'string' || !/^\d{2}:\d{2}$/.test(raw.time)) {
    return Response.json({ error: 'time must be in HH:MM format' }, { status: 400 });
  }

  // Validate client_name
  if (typeof raw.client_name !== 'string' || !raw.client_name.trim()) {
    return Response.json({ error: 'client_name is required' }, { status: 400 });
  }
  const clientName = raw.client_name.trim();
  if (clientName.length > 100) {
    return Response.json({ error: 'client_name must be 100 characters or fewer' }, { status: 400 });
  }

  // Validate client_phone — optional but must start with + if provided (for international routing).
  let clientPhone: string | null = null;
  if (raw.client_phone !== null && raw.client_phone !== undefined && raw.client_phone !== '') {
    if (typeof raw.client_phone !== 'string' || !raw.client_phone.trim().startsWith('+')) {
      return Response.json(
        { error: 'Phone must include country code (e.g. +357 99 123 456)' },
        { status: 400 }
      );
    }
    const trimmedPhone = raw.client_phone.trim();
    if (trimmedPhone.length > 20) {
      return Response.json({ error: 'Phone number must be 20 characters or fewer' }, { status: 400 });
    }
    clientPhone = trimmedPhone;
  }

  // Validate client_email — optional
  let clientEmail: string | null = null;
  if ('client_email' in raw && raw.client_email !== null && raw.client_email !== '') {
    if (typeof raw.client_email !== 'string') {
      return Response.json({ error: 'client_email must be a string' }, { status: 400 });
    }
    clientEmail = raw.client_email.trim() || null;
  }

  // Validate notes — optional
  let notes: string | null = null;
  if ('notes' in raw && raw.notes !== null && raw.notes !== '') {
    if (typeof raw.notes !== 'string') {
      return Response.json({ error: 'notes must be a string' }, { status: 400 });
    }
    notes = raw.notes.trim() || null;
  }

  // service_id and barber_id are optional UUIDs
  const serviceId = typeof raw.service_id === 'string' ? raw.service_id.trim() : null;
  const serviceName = typeof raw.service_name === 'string' ? raw.service_name.trim() : null;
  const barberId = typeof raw.barber_id === 'string' ? raw.barber_id.trim() : null;

  // Step 2: Look up the booking page and derive the salon's info.
  // Service role bypasses RLS — safe to use here since this is a server-side route.
  const supabase = createServiceRoleClient();

  const { data: bookingPage, error: bpError } = await supabase
    .from('booking_pages')
    .select('salon_id')
    .eq('slug', slug)
    .eq('is_active', true)
    .single();

  if (bpError || !bookingPage) {
    console.error('[POST /api/book/[slug]/appointments] booking page lookup error — slug:', slug, '| error:', JSON.stringify(bpError));
    return Response.json({ error: 'Booking page not found' }, { status: 404 });
  }

  const salonId = bookingPage.salon_id;

  // Fetch salon timezone for UTC conversion and reminder scheduling.
  const { data: salon, error: salonError } = await supabase
    .from('salons')
    .select('timezone, name')
    .eq('id', salonId)
    .single();

  if (salonError || !salon) {
    console.error('[POST /api/book/[slug]/appointments] salon lookup error — salonId:', salonId, '| error:', JSON.stringify(salonError));
    return Response.json({ error: 'Failed to load salon data' }, { status: 500 });
  }

  // Step 3: Convert local date+time to UTC.
  let datetimeUTC: string;
  try {
    datetimeUTC = localToUTC(raw.date as string, raw.time as string, salon.timezone);
    console.log('[POST /api/book/[slug]/appointments] UTC datetime:', datetimeUTC, '| local:', raw.date, raw.time, '| tz:', salon.timezone);
  } catch (err) {
    console.error('[POST /api/book/[slug]/appointments] localToUTC error:', err, '| date:', raw.date, '| time:', raw.time, '| tz:', salon.timezone);
    return Response.json({ error: 'Invalid date or time' }, { status: 400 });
  }

  // Reject past appointments — the booking UI should prevent this, but enforce server-side too.
  if (new Date(datetimeUTC) <= new Date()) {
    return Response.json({ error: 'Cannot book an appointment in the past' }, { status: 400 });
  }

  // Step 4: Resolve service name and duration from service_id if provided.
  // service_id comes from the global services table (salon-level).
  let resolvedServiceName: string | null = serviceName;
  let resolvedDurationMinutes = 30; // default when no service selected
  if (serviceId) {
    const { data: svc, error: svcError } = await supabase
      .from('services')
      .select('name, duration_minutes')
      .eq('id', serviceId)
      .eq('active', true)
      .single();
    if (svcError) {
      console.error('[POST /api/book/[slug]/appointments] services lookup error — serviceId:', serviceId, '| error:', JSON.stringify(svcError));
    }
    if (svc) {
      resolvedServiceName = svc.name;
      resolvedDurationMinutes = (svc.duration_minutes as number | null) ?? 30;
    }
  }

  // Check for barber-specific duration override (if a barber and service are selected).
  if (barberId && serviceId) {
    const { data: bsOverride } = await supabase
      .from('barber_services')
      .select('duration_minutes_override')
      .eq('barber_id', barberId)
      .eq('service_id', serviceId)
      .maybeSingle();
    if (bsOverride?.duration_minutes_override != null) {
      resolvedDurationMinutes = bsOverride.duration_minutes_override;
    }
  }

  // Step 5: Find or create client. Deduplicate by phone first, then by email.
  // Phone is the preferred identifier; fall back to email when phone is absent.
  // Name-mismatch rule: if phone/email matches but the name differs, create a new
  // client — the number may belong to a different person or a family member.
  let clientId = '';

  let existingClient: { id: string; name: string } | null = null;

  if (clientPhone) {
    // Primary dedup: match by phone within this salon.
    const { data, error: findError } = await supabase
      .from('clients')
      .select('id, name')
      .eq('salon_id', salonId)
      .eq('phone', clientPhone)
      .maybeSingle();
    if (findError) {
      console.error('[POST /api/book/[slug]/appointments] client phone lookup error:', JSON.stringify(findError));
    }
    existingClient = data as { id: string; name: string } | null;
  } else if (clientEmail) {
    // Fallback dedup: match by email when phone not provided.
    const { data, error: findError } = await supabase
      .from('clients')
      .select('id, name')
      .eq('salon_id', salonId)
      .eq('email', clientEmail)
      .maybeSingle();
    if (findError) {
      console.error('[POST /api/book/[slug]/appointments] client email lookup error:', JSON.stringify(findError));
    }
    existingClient = data as { id: string; name: string } | null;
  }

  if (existingClient) {
    // Only reuse the existing client when the name matches (case-insensitive, trimmed).
    // If names differ, fall through to create a new record — different person, same number.
    const existingNameNorm = existingClient.name.toLowerCase().trim();
    const requestedNameNorm = clientName.toLowerCase().trim();
    if (existingNameNorm === requestedNameNorm) {
      clientId = existingClient.id;
    } else {
      existingClient = null; // fall through to create
    }
  }

  if (!existingClient) {
    const { data: newClient, error: clientError } = await supabase
      .from('clients')
      .insert({
        salon_id: salonId,
        name:     clientName,
        phone:    clientPhone,
        email:    clientEmail,
        notes:    null,
      })
      .select('id')
      .single();

    if (clientError || !newClient) {
      console.error('[POST /api/book/[slug]/appointments] client insert error:', JSON.stringify(clientError), '| salonId:', salonId);
      return Response.json({ error: 'Failed to create client record' }, { status: 500 });
    }
    clientId = newClient.id;
  }

  // Step 6: Check for scheduling conflicts using duration-aware overlap.
  // Two appointments overlap when: existingStart < newEnd AND newStart < existingEnd.
  // Query a generous window to catch all possible overlaps.
  const newStartMs = new Date(datetimeUTC).getTime();
  const MAX_DURATION_MS = 480 * 60_000; // 8 h — matches validation max
  const queryStart = new Date(newStartMs - MAX_DURATION_MS).toISOString();
  const queryEnd   = new Date(newStartMs + resolvedDurationMinutes * 60_000).toISOString();

  if (barberId) {
    const { data: barberAppts } = await supabase
      .from('appointments')
      .select('id, datetime, duration_minutes')
      .eq('salon_id', salonId)
      .eq('barber_id', barberId)
      .neq('status', 'cancelled')
      .gte('datetime', queryStart)
      .lte('datetime', queryEnd);

    const hasBarberConflict = (barberAppts ?? []).some((a) => {
      const existStartMs  = new Date(a.datetime as string).getTime();
      const existDuration = (a.duration_minutes as number | null) ?? 30;
      return appointmentsOverlap(newStartMs, resolvedDurationMinutes, existStartMs, existDuration);
    });

    if (hasBarberConflict) {
      return Response.json(
        { error: 'This staff member is not available at that time.' },
        { status: 409 }
      );
    }
  }

  // Client conflict — does this client already have an overlapping appointment?
  const { data: clientAppts } = await supabase
    .from('appointments')
    .select('id, datetime, duration_minutes')
    .eq('client_id', clientId)
    .neq('status', 'cancelled')
    .gte('datetime', queryStart)
    .lte('datetime', queryEnd);

  const hasClientConflict = (clientAppts ?? []).some((a) => {
    const existStartMs  = new Date(a.datetime as string).getTime();
    const existDuration = (a.duration_minutes as number | null) ?? 30;
    return appointmentsOverlap(newStartMs, resolvedDurationMinutes, existStartMs, existDuration);
  });

  if (hasClientConflict) {
    return Response.json(
      { error: 'You already have an appointment at that time.' },
      { status: 409 }
    );
  }

  // Step 6b: Auto-assign staff when the client chose "no preference" (barberId is null)
  // and the salon has active barbers. We use findEligibleBarbers to apply availability
  // and conflict filters, then always assign to eligible[0] (alphabetical — deterministic).
  // Unlike the dashboard POST, we never force the client to choose — they already said
  // "no preference", so we pick the best available member on their behalf.
  let resolvedBarberId: string | null = barberId;
  if (!barberId) {
    // Fetch all active barbers for this salon.
    const { data: activeBarbers } = await supabase
      .from('barbers')
      .select('id')
      .eq('salon_id', salonId)
      .eq('active', true);

    if (activeBarbers && activeBarbers.length > 0) {
      const allBarberIds = activeBarbers.map((b) => b.id);

      // If a service was selected, narrow candidates to barbers who are assigned to it
      // via barber_services. If no assignments exist, all barbers are candidates (backwards compat).
      let candidateBarberIds: string[] | null = null;
      if (serviceId || resolvedServiceName) {
        // Look up the service record to get its ID (needed for barber_services join).
        let resolvedServiceId = serviceId;
        if (!resolvedServiceId && resolvedServiceName) {
          const { data: svcRecord } = await supabase
            .from('services')
            .select('id')
            .eq('salon_id', salonId)
            .ilike('name', resolvedServiceName)
            .maybeSingle();
          resolvedServiceId = svcRecord?.id ?? null;
        }

        if (resolvedServiceId) {
          const { data: svcRows } = await supabase
            .from('barber_services')
            .select('barber_id')
            .eq('service_id', resolvedServiceId)
            .in('barber_id', allBarberIds);

          if (svcRows && svcRows.length > 0) {
            candidateBarberIds = svcRows.map((r) => r.barber_id);
          }
          // svcRows empty → no restriction → candidateBarberIds stays null (all barbers)
        }
      }

      const eligible = await findEligibleBarbers({
        supabase,
        salonId,
        datetimeUTC,
        timezone: salon.timezone,
        // Service filter already applied via candidateBarberIds — skip built-in filter.
        serviceTypeName: null,
        candidateBarberIds,
        newDurationMinutes: resolvedDurationMinutes,
      });

      if (eligible.length === 0) {
        return Response.json(
          { error: 'No staff available at this time. Please select a different time.' },
          { status: 409 }
        );
      }

      // Assign to first eligible (sorted alphabetically — deterministic).
      resolvedBarberId = eligible[0].id;
    }
  }

  // Step 7: Create the appointment.
  // Auto-confirm when the appointment is less than 23 hours away — the cron job
  // will never send a YES/NO reminder, so there is no mechanism for the client to
  // confirm later. Setting 'confirmed' immediately avoids a permanently-pending state.
  const hoursUntilAppointment = (new Date(datetimeUTC).getTime() - Date.now()) / (1000 * 60 * 60);
  const appointmentStatus = hoursUntilAppointment < 23 ? 'confirmed' : 'scheduled';

  const { data: appointment, error: apptError } = await supabase
    .from('appointments')
    .insert({
      salon_id:         salonId,
      client_id:        clientId,
      barber_id:        resolvedBarberId,
      datetime:         datetimeUTC,
      service_type:     resolvedServiceName,
      duration_minutes: resolvedDurationMinutes,
      notes:            notes,
      status:           appointmentStatus,
    })
    .select('id')
    .single();

  if (apptError || !appointment) {
    console.error('[POST /api/book/[slug]/appointments] appointment insert error:', JSON.stringify(apptError), '| salonId:', salonId, '| clientId:', clientId, '| barberId:', barberId, '| datetimeUTC:', datetimeUTC);
    return Response.json({ error: 'Failed to create appointment' }, { status: 500 });
  }

  const appointmentId = appointment.id;
  const appointmentTime = new Date(datetimeUTC).getTime();

  // Step 8: Create pending email reminder record (24 h before appointment).
  // Only created if the client supplied an email address.
  const remindersToInsert: Array<{
    appointment_id: string;
    type: 'email';
    send_at: string;
    status: 'pending';
    token: string;
  }> = [];

  // Email: only if the client supplied an email address (per lib/plans.ts EMAIL_REMINDER_WINDOW).
  if (clientEmail) {
    const emailToken = crypto.randomUUID();
    remindersToInsert.push({
      appointment_id: appointmentId,
      type:           'email',
      send_at:        new Date(appointmentTime - 24 * 60 * 60 * 1000).toISOString(),
      status:         'pending',
      token:          emailToken,
    });
  }

  const { error: reminderError } = await supabase
    .from('reminders')
    .insert(remindersToInsert);

  if (reminderError) {
    // Log but do not fail the booking — the appointment is created; reminders can be
    // re-created manually or on the next cron pass if needed.
    console.error('[POST /api/book/[slug]/appointments] reminder insert error:', JSON.stringify(reminderError), '| appointmentId:', appointmentId);
  }

  // Step 9: Send a booking confirmation email to the client immediately (if email provided).
  // This is separate from the 24 h reminder — it confirms the booking was received.
  // A failed confirmation email must never block the booking response.
  if (clientEmail) {
    // Look up the staff member's name to include in the confirmation.
    let barberName: string | null = null;
    if (resolvedBarberId) {
      // Use resolvedBarberId — may differ from the request's barberId when auto-assigned.
      const { data: barberRow } = await supabase
        .from('barbers')
        .select('name')
        .eq('id', resolvedBarberId)
        .single();
      barberName = barberRow?.name ?? null;
    }

    const confirmHtml = getConfirmationEmailHTML(
      salon.name,
      clientName,
      resolvedServiceName,
      barberName,
      datetimeUTC,
      salon.timezone,
    );

    const emailResult = await sendEmail(
      clientEmail,
      `Appointment booked at ${salon.name}`,
      confirmHtml,
    );

    if (!emailResult.success) {
      // Log but do not fail — the appointment exists, only the confirmation email failed.
      console.error('[POST /api/book/[slug]/appointments] confirmation email failed:', emailResult.error);
    }
  }

  return Response.json({ appointmentId }, { status: 201 });
}
