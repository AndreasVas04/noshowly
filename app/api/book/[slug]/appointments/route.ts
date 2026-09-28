/**
 * app/api/book/[slug]/appointments/route.ts
 *
 * POST /api/book/[slug]/appointments — public endpoint; no authentication required.
 *
 * Creates a new appointment via the public booking page. Everything is
 * validated before anything is written:
 *  1. Parse the body and reject bot submissions (hidden honeypot field).
 *  2. Validate every field: real calendar date, HH:MM time, formats, lengths.
 *  3. Load the active booking page and enforce its required contact fields.
 *  4. Load the salon's staff, services and availability; convert to UTC.
 *  5. Enforce the booking window (minimum notice, maximum days ahead).
 *  6. Validate the service (required when the salon has active services).
 *  7. Validate the chosen staff member, or assign one for "Any available
 *     staff": eligible for the service and free for the whole appointment.
 *  8. Limit repeated bookings from the same email or phone number.
 *  9. Find an existing client (read-only) and check their own conflicts.
 * 10. Create the client when needed.
 * 11. Create the appointment.
 * 12. Create pending email reminder record (24 h before).
 * 13. Send a booking confirmation email to the client (if email provided).
 *
 * Scheduling rules come from lib/availability.ts, the same module the booking
 * page uses to offer times, so what is offered is what is accepted.
 *
 * Security:
 *  - No authentication — this is intentionally public.
 *  - The service role key is used server-side (lib/supabase/admin.ts) because
 *    visitors are anonymous and clients/appointments have owner-only RLS.
 *  - The service role is NEVER exposed to the browser — only used in server code.
 *  - Slug is looked up server-side; salon_id always comes from the DB, never the client.
 *  - Staff and service ids from the request must belong to the salon and be active.
 */

import { sendEmail } from '@/lib/resend';
import { createAdminSupabaseClient, type AdminSupabaseClient } from '@/lib/supabase/admin';
import {
  getBookingPageBySlug,
  loadBusyIntervals,
  loadPublicBookingData,
} from '@/lib/booking-data';
import {
  DEFAULT_OPENING_HOURS,
  MAX_ADVANCE_DAYS,
  MAX_DURATION_MINUTES,
  MIN_NOTICE_MINUTES,
  busyToRanges,
  checkBookingWindow,
  eligibleBarberIds,
  getBookableIntervals,
  getEffectiveDuration,
  getSalonHoursInterval,
  isCandidateAvailable,
  pickAnyAvailableBarber,
  rangesOverlap,
  type SlotCandidate,
} from '@/lib/availability';
import {
  countRecentBookingsForContact,
  fillMissingClientEmail,
  findReusableClient,
  MAX_CLIENT_NAME_LENGTH,
} from '@/lib/clients';
import { validateEmail, validatePhone } from '@/lib/contact';
import {
  dayOfWeekForDate,
  isValidDateString,
  isValidTimeString,
  resolveZonedTime,
} from '@/lib/time';
import type { PublicBarber, PublicService } from '@/types';

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/** Longest note a client can leave. */
const MAX_NOTES_LENGTH = 500;

/** Longest free-text service name (salons without a service list). */
const MAX_SERVICE_NAME_LENGTH = 100;

/** Bookings allowed per salon for the same email or phone within BOOKING_LIMIT_WINDOW_MS. */
const MAX_BOOKINGS_PER_CONTACT = 3;

/** Window for MAX_BOOKINGS_PER_CONTACT: one hour. */
const BOOKING_LIMIT_WINDOW_MS = 60 * 60 * 1000;

/** Postgres error code for an exclusion-constraint violation (overlapping bookings). */
const EXCLUSION_VIOLATION = '23P01';

/** Matches a UUID, so malformed ids are rejected before reaching the database. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
// Request parsing helpers
// ---------------------------------------------------------------------------

/** Result of reading an optional string field from the request body. */
type OptionalString = { ok: true; value: string | null } | { ok: false; error: string };

/**
 * Reads an optional string field: null, undefined and blank strings become null.
 *
 * @param raw   - Parsed request body.
 * @param field - Field name.
 */
function readOptionalString(raw: Record<string, unknown>, field: string): OptionalString {
  const value = raw[field];
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, error: `${field} must be a string` };
  return { ok: true, value: value.trim() || null };
}

/**
 * Reads an optional UUID field: null, undefined and '' become null.
 *
 * @param raw   - Parsed request body.
 * @param field - Field name.
 */
function readOptionalId(raw: Record<string, unknown>, field: string): OptionalString {
  const result = readOptionalString(raw, field);
  if (!result.ok || result.value === null) return result;
  if (!UUID_PATTERN.test(result.value)) return { ok: false, error: `${field} is not a valid id` };
  return result;
}

/**
 * Returns true when the client already has a non-cancelled appointment that
 * overlaps the new one.
 *
 * @param supabase        - Service-role client.
 * @param salonId         - Salon of the booking page.
 * @param clientId        - Existing client.
 * @param start           - New appointment start.
 * @param durationMinutes - New appointment length.
 * @throws Error on a database error.
 */
async function clientHasOverlap(
  supabase: AdminSupabaseClient,
  salonId: string,
  clientId: string,
  start: Date,
  durationMinutes: number,
): Promise<boolean> {
  const newRange = { start: start.getTime(), end: start.getTime() + durationMinutes * 60_000 };
  const { data, error } = await supabase
    .from('appointments')
    .select('barber_id, datetime, duration_minutes')
    .eq('salon_id', salonId)
    .eq('client_id', clientId)
    .neq('status', 'cancelled')
    .gte('datetime', new Date(newRange.start - MAX_DURATION_MINUTES * 60_000).toISOString())
    .lt('datetime', new Date(newRange.end).toISOString());

  if (error) throw new Error(`Client conflict check failed: ${error.message}`);
  return busyToRanges(data ?? []).some((range) => rangesOverlap(range, newRange));
}

// ---------------------------------------------------------------------------
// POST — create appointment from booking page
// ---------------------------------------------------------------------------

/**
 * Creates a new appointment submitted via the public booking page.
 *
 * Request body:
 *  {
 *    service_id?:    string   — UUID of an active service (required when the salon has any)
 *    service_name?:  string   — free-text service name, only for salons without services (≤ 100)
 *    barber_id?:     string   — UUID of an active staff member; null/absent = any available
 *    date:           string   — YYYY-MM-DD in the salon's timezone (a real calendar date)
 *    time:           string   — HH:MM 24-hour in the salon's timezone (00:00–23:59)
 *    client_name:    string   — 1–100 chars
 *    client_phone?:  string   — with country code (+…), ≤ 30 chars; required when the page requires it
 *    client_email?:  string   — valid address, ≤ 254 chars; required when the page requires it
 *    notes?:         string   — optional client note to barber, ≤ 500 chars
 *    company?:       string   — hidden honeypot field; must be empty
 *  }
 *
 * @param request - Incoming request.
 * @param params  - Route params containing `slug`.
 *
 * @returns 201 { appointmentId: string, barberName: string | null, durationMinutes: number }
 * @returns 400 { error: string }               — validation failure
 * @returns 404 { error: "Booking page not found" }
 * @returns 409 { error: string }               — the time is no longer available
 * @returns 429 { error: string }               — too many bookings for this email/phone
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

  // Step 1: Parse the request body and reject bot submissions.
  let body: unknown;
  try {
    body = await request.json();
  } catch (err) {
    console.error('[POST /api/book/[slug]/appointments] JSON parse error:', err);
    return Response.json({ error: 'Invalid JSON in request body' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return Response.json({ error: 'Request body must be a JSON object' }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;

  // The honeypot field is hidden from people; anything in it means a bot filled the form.
  if (raw.company !== undefined && raw.company !== null && raw.company !== '') {
    return Response.json({ error: 'Invalid submission' }, { status: 400 });
  }

  // Step 2: Validate every field before touching the database.
  if (!isValidDateString(raw.date)) {
    return Response.json({ error: 'date must be a valid date in YYYY-MM-DD format' }, { status: 400 });
  }
  const date = raw.date;

  if (!isValidTimeString(raw.time)) {
    return Response.json({ error: 'time must be in HH:MM format (00:00 to 23:59)' }, { status: 400 });
  }
  const time = raw.time;

  if (typeof raw.client_name !== 'string' || !raw.client_name.trim()) {
    return Response.json({ error: 'client_name is required' }, { status: 400 });
  }
  const clientName = raw.client_name.trim();
  if (clientName.length > MAX_CLIENT_NAME_LENGTH) {
    return Response.json(
      { error: `client_name must be ${MAX_CLIENT_NAME_LENGTH} characters or fewer` },
      { status: 400 }
    );
  }

  const phoneField = readOptionalString(raw, 'client_phone');
  if (!phoneField.ok) return Response.json({ error: phoneField.error }, { status: 400 });
  let clientPhone: string | null = null;
  if (phoneField.value) {
    const phone = validatePhone(phoneField.value);
    if (!phone.ok) return Response.json({ error: phone.error }, { status: 400 });
    clientPhone = phone.value;
  }

  const emailField = readOptionalString(raw, 'client_email');
  if (!emailField.ok) return Response.json({ error: emailField.error }, { status: 400 });
  let clientEmail: string | null = null;
  if (emailField.value) {
    const email = validateEmail(emailField.value);
    if (!email.ok) return Response.json({ error: email.error }, { status: 400 });
    clientEmail = email.value;
  }

  const notesField = readOptionalString(raw, 'notes');
  if (!notesField.ok) return Response.json({ error: notesField.error }, { status: 400 });
  const notes = notesField.value;
  if (notes && notes.length > MAX_NOTES_LENGTH) {
    return Response.json({ error: `notes must be ${MAX_NOTES_LENGTH} characters or fewer` }, { status: 400 });
  }

  const serviceNameField = readOptionalString(raw, 'service_name');
  if (!serviceNameField.ok) return Response.json({ error: serviceNameField.error }, { status: 400 });
  if (serviceNameField.value && serviceNameField.value.length > MAX_SERVICE_NAME_LENGTH) {
    return Response.json(
      { error: `service_name must be ${MAX_SERVICE_NAME_LENGTH} characters or fewer` },
      { status: 400 }
    );
  }

  const serviceIdField = readOptionalId(raw, 'service_id');
  if (!serviceIdField.ok) return Response.json({ error: serviceIdField.error }, { status: 400 });
  const serviceId = serviceIdField.value;

  const barberIdField = readOptionalId(raw, 'barber_id');
  if (!barberIdField.ok) return Response.json({ error: barberIdField.error }, { status: 400 });
  const barberId = barberIdField.value;

  // Step 3: Look up the booking page (must be active) and enforce its required fields.
  const supabase = createAdminSupabaseClient();

  const bookingPage = await getBookingPageBySlug(supabase, slug);
  if (!bookingPage || !bookingPage.is_active) {
    return Response.json({ error: 'Booking page not found' }, { status: 404 });
  }
  const salonId = bookingPage.salon_id;

  if (bookingPage.require_phone && !clientPhone) {
    return Response.json({ error: 'Phone number is required' }, { status: 400 });
  }
  if (bookingPage.require_email && !clientEmail) {
    return Response.json({ error: 'Email is required' }, { status: 400 });
  }

  // Step 4: Load the salon's staff, services and availability; convert to UTC.
  const data = await loadPublicBookingData(supabase, salonId);
  if (!data) {
    console.error('[POST /api/book/[slug]/appointments] salon missing — salonId:', salonId);
    return Response.json({ error: 'Failed to load salon data' }, { status: 500 });
  }
  const salon = data.salon;

  const start = resolveZonedTime(date, time, salon.timezone);
  if (!start.ok) {
    return Response.json(
      {
        error: start.reason === 'nonexistent_time'
          ? 'That time does not exist on this date because of a clock change. Please choose another time.'
          : 'Invalid date or time',
      },
      { status: 400 }
    );
  }
  const datetimeUTC = start.date.toISOString();

  // Step 5: Booking window — not in the past, enough notice, not too far ahead.
  const now = new Date();
  const bookingWindow = checkBookingWindow(start.date, date, salon.timezone, now);
  if (!bookingWindow.ok) {
    const message =
      bookingWindow.reason === 'past'       ? 'Cannot book an appointment in the past'
      : bookingWindow.reason === 'too_soon' ? `Appointments must be booked at least ${MIN_NOTICE_MINUTES} minutes in advance`
      : `Appointments can be booked at most ${MAX_ADVANCE_DAYS} days in advance`;
    return Response.json({ error: message }, { status: 400 });
  }

  // Step 6: Service — required when the salon has active services, and it must
  // be one of them. Salons without a service list may pass a free-text name.
  let service: PublicService | null = null;
  let resolvedServiceName: string | null = null;
  if (data.services.length > 0) {
    if (!serviceId) {
      return Response.json({ error: 'Please choose a service' }, { status: 400 });
    }
    service = data.services.find((s) => s.id === serviceId) ?? null;
    if (!service) {
      return Response.json({ error: 'The selected service is not available' }, { status: 400 });
    }
    resolvedServiceName = service.name;
  } else {
    if (serviceId) {
      return Response.json({ error: 'The selected service is not available' }, { status: 400 });
    }
    resolvedServiceName = serviceNameField.value;
  }

  // Step 7: Staff — validate the chosen staff member, or assign one for
  // "Any available staff". Either way the staff member must be eligible for
  // the service and free for the whole appointment (with their own duration).
  const salonHours = { opening_time: salon.opening_time, closing_time: salon.closing_time };
  const dayOfWeek = dayOfWeekForDate(date);
  let assignedBarber: PublicBarber | null = null;
  let durationMinutes: number;

  if (data.barbers.length > 0) {
    const eligibleIds = eligibleBarberIds(
      service?.id ?? null,
      data.barbers.map((b) => b.id),
      data.assignments,
    );
    const busy = await loadBusyIntervals(supabase, salonId, date, salon.timezone);
    const candidateFor = (barber: PublicBarber): SlotCandidate & { barberId: string; name: string } => ({
      barberId: barber.id,
      name: barber.name,
      intervals: getBookableIntervals(barber.id, dayOfWeek, data.availability, salonHours),
      durationMinutes: getEffectiveDuration(service, barber.id, data.assignments),
    });

    if (barberId) {
      const barber = data.barbers.find((b) => b.id === barberId);
      if (!barber) {
        return Response.json(
          { error: 'The selected staff member is not available for online booking' },
          { status: 400 }
        );
      }
      if (!eligibleIds.includes(barber.id)) {
        return Response.json(
          { error: 'This staff member does not offer the selected service.' },
          { status: 400 }
        );
      }
      const candidate = candidateFor(barber);
      if (!isCandidateAvailable({ date, time, timeZone: salon.timezone, candidate, busy })) {
        return Response.json(
          { error: 'This staff member is not available at that time.' },
          { status: 409 }
        );
      }
      assignedBarber = barber;
      durationMinutes = candidate.durationMinutes;
    } else {
      if (eligibleIds.length === 0) {
        return Response.json(
          { error: 'No staff member offers the selected service.' },
          { status: 400 }
        );
      }
      const candidates = data.barbers.filter((b) => eligibleIds.includes(b.id)).map(candidateFor);
      const pickedId = pickAnyAvailableBarber({
        date,
        time,
        timeZone: salon.timezone,
        candidates,
        busy,
      });
      const picked = candidates.find((c) => c.barberId === pickedId);
      if (!picked) {
        return Response.json(
          { error: 'No staff available at this time. Please select a different time.' },
          { status: 409 }
        );
      }
      assignedBarber = data.barbers.find((b) => b.id === picked.barberId) ?? null;
      durationMinutes = picked.durationMinutes;
    }
  } else {
    // Salon without staff: appointments are unassigned and only need to fit
    // inside the opening hours.
    if (barberId) {
      return Response.json(
        { error: 'The selected staff member is not available for online booking' },
        { status: 400 }
      );
    }
    durationMinutes = getEffectiveDuration(service, null, data.assignments);
    const candidate: SlotCandidate = {
      barberId: null,
      intervals: [getSalonHoursInterval(salonHours) ?? DEFAULT_OPENING_HOURS],
      durationMinutes,
    };
    if (!isCandidateAvailable({ date, time, timeZone: salon.timezone, candidate, busy: [] })) {
      return Response.json({ error: 'That time is outside our opening hours.' }, { status: 400 });
    }
  }
  const resolvedBarberId = assignedBarber?.id ?? null;

  // Step 8: Limit repeated bookings — at most MAX_BOOKINGS_PER_CONTACT per
  // salon for the same email or phone number within the last hour.
  const recent = await countRecentBookingsForContact(
    supabase,
    salonId,
    { phone: clientPhone, email: clientEmail },
    new Date(now.getTime() - BOOKING_LIMIT_WINDOW_MS),
  );
  if (!recent.ok) {
    console.error('[POST /api/book/[slug]/appointments] booking limit lookup error:', recent.error);
    return Response.json({ error: 'Failed to create appointment' }, { status: 500 });
  }
  if (recent.count >= MAX_BOOKINGS_PER_CONTACT) {
    return Response.json(
      { error: 'Too many bookings with these contact details. Please try again later or contact us directly.' },
      { status: 429 }
    );
  }

  // Step 9: Find an existing client (same phone, or same email without a phone,
  // and same name). Read-only: nothing is written until every check has passed.
  const lookup = await findReusableClient(supabase, salonId, {
    name: clientName,
    phone: clientPhone,
    email: clientEmail,
  });
  if (!lookup.ok) {
    console.error('[POST /api/book/[slug]/appointments] client lookup error:', lookup.error);
    return Response.json({ error: 'Failed to create client record' }, { status: 500 });
  }

  // Client conflict — does this client already have an overlapping appointment?
  if (lookup.client && await clientHasOverlap(supabase, salonId, lookup.client.id, start.date, durationMinutes)) {
    return Response.json(
      { error: 'You already have an appointment at that time.' },
      { status: 409 }
    );
  }

  // Step 10: Create the client when needed (or fill in a missing email).
  let clientId: string;
  if (lookup.client) {
    await fillMissingClientEmail(supabase, lookup.client, clientEmail);
    clientId = lookup.client.id;
  } else {
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

  // Step 11: Create the appointment.
  // Auto-confirm when the appointment is less than 23 hours away — the cron job
  // will never send a YES/NO reminder, so there is no mechanism for the client to
  // confirm later. Setting 'confirmed' immediately avoids a permanently-pending state.
  const hoursUntilAppointment = (start.date.getTime() - Date.now()) / (1000 * 60 * 60);
  const appointmentStatus = hoursUntilAppointment < 23 ? 'confirmed' : 'scheduled';

  const { data: appointment, error: apptError } = await supabase
    .from('appointments')
    .insert({
      salon_id:         salonId,
      client_id:        clientId,
      barber_id:        resolvedBarberId,
      datetime:         datetimeUTC,
      service_type:     resolvedServiceName,
      duration_minutes: durationMinutes,
      notes:            notes,
      status:           appointmentStatus,
    })
    .select('id')
    .single();

  if (apptError || !appointment) {
    if (apptError?.code === EXCLUSION_VIOLATION) {
      // A database constraint caught an overlapping booking made at the same moment.
      return Response.json(
        { error: 'That time was just booked. Please choose another time.' },
        { status: 409 }
      );
    }
    console.error('[POST /api/book/[slug]/appointments] appointment insert error:', JSON.stringify(apptError), '| salonId:', salonId, '| clientId:', clientId, '| barberId:', resolvedBarberId, '| datetimeUTC:', datetimeUTC);
    return Response.json({ error: 'Failed to create appointment' }, { status: 500 });
  }

  const appointmentId = appointment.id;
  const appointmentTime = new Date(datetimeUTC).getTime();

  // Step 12: Create pending email reminder record (24 h before appointment).
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

  // Step 13: Send a booking confirmation email to the client immediately (if email provided).
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

  return Response.json(
    { appointmentId, barberName: assignedBarber?.name ?? null, durationMinutes },
    { status: 201 }
  );
}
