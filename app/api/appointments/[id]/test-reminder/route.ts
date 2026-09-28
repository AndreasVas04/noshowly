/**
 * app/api/appointments/[id]/test-reminder/route.ts
 *
 * POST /api/appointments/:id/test-reminder
 *
 * Owner-only endpoint that sends the 24-hour reminder email for an
 * appointment right away, as a test, so the owner can check the email their
 * clients receive without waiting for the reminder job.
 *
 * Behaviour:
 *  - Sends the reminder with the salon's template, clearly marked as a test
 *    ("[Test]" subject prefix and a notice at the top). Its YES/NO buttons
 *    only open a preview page and never change the appointment.
 *  - Only for upcoming appointments that are not cancelled, and only when the
 *    client has an email address.
 *  - Needs write access: an ended trial or an inactive subscription gets the
 *    same 403 as every other write route (lib/access.ts).
 *  - Goes through the email gateway (lib/reminders/gateway.ts): requires an
 *    account that can send email, counts towards the monthly cap (the
 *    trial's or the paid plan's), and is limited to MAX_TEST_EMAILS_PER_DAY
 *    test sends per salon per 24 hours (and MAX_EMAILS_PER_RECIPIENT_PER_DAY
 *    emails per client address).
 *  - Recorded as a reminders row of type 'email_test', so the real 24-hour
 *    reminder is still sent by the reminder job.
 *
 * Security:
 *  - Requires authentication, verified with requireUser() because the
 *    gateway uses the service-role key — only the salon owner can trigger this.
 *  - Appointment is scoped to the owner's salon (cross-salon access impossible).
 */

import { requireUser } from '@/lib/auth';
import { requireWriteAccess } from '@/lib/access';
import { MAX_TEST_EMAILS_PER_DAY } from '@/lib/plans';
import { isUuid } from '@/lib/postgrest';
import { sendAppointmentEmail, type SendResult } from '@/lib/reminders/gateway';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Sends a test reminder email immediately for the given appointment.
 *
 * @param _request - Not used; id comes from route params.
 * @param context  - Next.js route context containing the appointment UUID.
 * @returns 200 { success: true, message: string }
 * @returns 400 { error: string }       — past or cancelled appointment, or no client email
 * @returns 401 { error: "Unauthorized" }
 * @returns 403 { error: string }       — read-only account, or the account cannot send email
 * @returns 404 { error: "Not found" }   — appointment not found or not owned
 * @returns 422 { error: string }       — the email provider rejected the email (e.g. the address)
 * @returns 429 { error: string }       — a sending limit was reached
 * @returns 500 { error: string }
 */
export async function POST(_request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;

  // Step 1: Verify authentication.
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  // Step 1b: Plan check — an ended trial or an inactive subscription is read-only.
  const access = await requireWriteAccess(supabase, user.id);
  if (!access.ok) return access.response;

  if (!isUuid(id)) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  // Step 2: Resolve the salon for this user.
  // salon_id always comes from the session — never trusted from the client.
  const { data: salon, error: salonError } = await supabase
    .from('salons')
    .select('id')
    .eq('user_id', user.id)
    .single();

  if (salonError || !salon) {
    return Response.json({ error: 'Salon not found' }, { status: 404 });
  }

  // Step 3: Fetch the appointment with its client's email, scoped to this salon.
  const { data: row, error: apptError } = await supabase
    .from('appointments')
    .select('id, datetime, status, clients (email)')
    .eq('id', id)
    .eq('salon_id', salon.id)
    .maybeSingle();

  if (apptError || !row) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  // Cast via unknown — Relationships: [] means TS doesn't know the join shape,
  // but the FK exists so the runtime value is correct.
  const appt = row as unknown as {
    id: string;
    datetime: string;
    status: string;
    clients: { email: string | null } | null;
  };

  // Step 4: Only upcoming appointments that are not cancelled.
  if (appt.status === 'cancelled' || !(Date.parse(appt.datetime) > Date.now())) {
    return Response.json(
      { error: 'Test emails can only be sent for upcoming appointments that are not cancelled.' },
      { status: 400 }
    );
  }

  // Step 5: Validate the client has an email address.
  if (!appt.clients?.email) {
    return Response.json(
      { error: 'This client does not have an email address. Add one to send a test reminder.' },
      { status: 400 }
    );
  }

  // Step 6: Send through the email gateway as a test.
  const result = await sendAppointmentEmail({ kind: 'email_test', appointmentId: appt.id });
  return testSendResponse(result);
}

/**
 * Maps the gateway result to the JSON the appointment modal shows.
 * The monthly fair-use cap is internal: its number is never shown.
 *
 * @param result - Gateway result.
 */
function testSendResponse(result: SendResult): Response {
  if (result.status === 'sent') {
    const where = result.toOwner
      ? `${result.recipient} (demo mode: emails go to the demo account, not to clients)`
      : result.recipient;
    return Response.json(
      {
        success: true,
        message: `Test email sent to ${where}. It is marked as a test and its buttons do not change the appointment.`,
      },
      { status: 200 }
    );
  }

  if (result.status === 'skipped') {
    switch (result.reason) {
      case 'plan':
        return Response.json(
          { error: 'Your plan does not include emails right now. Upgrade to keep sending reminders.' },
          { status: 403 }
        );
      case 'trial_cap':
        return Response.json(
          { error: 'You have used the emails included in your free trial this month. Upgrade to keep sending reminders.' },
          { status: 429 }
        );
      case 'test_daily_limit':
        return Response.json(
          { error: `You can send up to ${MAX_TEST_EMAILS_PER_DAY} test emails per day. Please try again later.` },
          { status: 429 }
        );
      case 'recipient_limit':
        return Response.json(
          { error: 'This client has already received the maximum number of emails for today. Please try again tomorrow.' },
          { status: 429 }
        );
      case 'salon_hourly_limit':
        return Response.json(
          { error: 'Too many emails were sent from your account in the last hour. Please try again later.' },
          { status: 429 }
        );
      case 'monthly_cap':
        return Response.json(
          { error: 'Email sending is paused for your account right now. Please contact support.' },
          { status: 429 }
        );
      case 'no_email':
        return Response.json(
          { error: 'This client does not have an email address. Add one to send a test reminder.' },
          { status: 400 }
        );
      default:
        return Response.json(
          { error: 'Test emails can only be sent for upcoming appointments that are not cancelled.' },
          { status: 400 }
        );
    }
  }

  console.error('[POST /api/appointments/:id/test-reminder] Test email failed:', result.reason);
  if (result.reason === 'rejected') {
    return Response.json(
      { error: 'The email was rejected. Check the client\'s email address and try again.' },
      { status: 422 }
    );
  }
  if (result.reason === 'config') {
    return Response.json(
      { error: 'Email sending is not set up correctly. Please contact support.' },
      { status: 500 }
    );
  }
  return Response.json({ error: 'Failed to send test reminder email' }, { status: 500 });
}
