/**
 * app/api/appointments/[id]/test-reminder/route.ts
 *
 * POST /api/appointments/:id/test-reminder
 *
 * Owner-only endpoint that immediately sends the reminder email for an
 * appointment, bypassing the 23–25 hour cron window. Used to test and preview
 * the reminder email template without waiting for the cron job.
 *
 * Behaviour:
 *  - Sends the actual reminder email (same template as the real reminder).
 *  - Creates a real reminder row with status='sent' so YES/NO confirmation
 *    links in the email actually work when clicked.
 *  - Because status='sent' is set immediately, the cron's deduplication check
 *    will skip this appointment. Use this only for testing — the client will
 *    not receive a second reminder from the cron.
 *  - Returns 400 if the client has no email address.
 *
 * Security:
 *  - Requires authentication — only the salon owner can trigger this.
 *  - Appointment is scoped to the owner's salon (cross-salon access impossible).
 *  - Uses the same Resend integration as the real reminder dispatch.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/resend';
import { getEmailHTML, getEmailSubject } from '@/lib/reminder-templates';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Sends a test reminder email immediately for the given appointment.
 *
 * @param _request - Not used; id comes from route params.
 * @param context  - Next.js route context containing the appointment UUID.
 * @returns 200 { success: true, message: string }
 * @returns 400 { error: string }       — no client email, or validation failure
 * @returns 401 { error: "Unauthorized" }
 * @returns 404 { error: "Not found" }   — appointment not found or not owned
 * @returns 500 { error: string }
 */
export async function POST(_request: Request, context: RouteContext): Promise<Response> {
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
  // salon_id always comes from the session — never trusted from the client.
  const { data: salon, error: salonError } = await supabase
    .from('salons')
    .select(`
      id, name, timezone,
      email_subject, email_greeting, email_body, email_closing,
      email_footer, email_confirmation_enabled
    `)
    .eq('user_id', session.user.id)
    .single();

  if (salonError || !salon) {
    return Response.json({ error: 'Salon not found' }, { status: 404 });
  }

  // Step 3: Fetch the appointment with client details, scoped to this salon.
  const { data: row, error: apptError } = await supabase
    .from('appointments')
    .select(`
      id, datetime, service_type, status,
      clients (name, email)
    `)
    .eq('id', id)
    .eq('salon_id', salon.id)
    .single();

  if (apptError || !row) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  // Cast via unknown — Relationships: [] means TS doesn't know the join shape,
  // but the FK exists so the runtime value is correct.
  const appt = row as unknown as {
    id: string;
    datetime: string;
    service_type: string | null;
    status: string;
    clients: { name: string; email: string | null } | null;
  };

  // Step 4: Validate the client has an email address.
  const clientEmail = appt.clients?.email ?? null;
  if (!clientEmail) {
    return Response.json(
      { error: 'This client does not have an email address. Add one to send a test reminder.' },
      { status: 400 }
    );
  }

  const clientName = appt.clients?.name ?? 'Client';

  // Step 5: Generate a unique confirmation token.
  // A real reminder row is created so YES/NO links in the email are functional.
  const token = crypto.randomUUID();

  // Step 6: Insert a reminder row with status='sent' immediately.
  // Marking as 'sent' prevents the cron from sending a duplicate reminder for
  // this appointment (cron deduplicates on status='sent').
  const { error: reminderInsertError } = await supabase
    .from('reminders')
    .insert({
      appointment_id: appt.id,
      type: 'email',
      send_at: new Date().toISOString(),
      sent_at: new Date().toISOString(),
      status: 'sent',
      token,
    });

  if (reminderInsertError) {
    console.error('[POST /api/appointments/:id/test-reminder] Reminder insert error:', reminderInsertError.message);
    return Response.json({ error: 'Failed to prepare test reminder' }, { status: 500 });
  }

  // Step 7: Build YES/NO confirmation URLs (same pattern as the real cron reminder).
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
  const confirmUrl = `${appUrl}/api/confirm/${token}?response=yes`;
  const cancelUrl  = `${appUrl}/api/confirm/${token}?response=no`;

  // Step 8: Build and send the email.
  const subject = getEmailSubject(salon.name, salon.email_subject);
  const html = getEmailHTML(
    salon.name,
    clientName,
    appt.service_type,
    appt.datetime,
    salon.timezone,
    confirmUrl,
    cancelUrl,
    salon.email_footer,
    salon.email_confirmation_enabled ?? true,
    salon.email_greeting,
    salon.email_body,
    salon.email_closing,
  );

  const emailResult = await sendEmail(clientEmail, subject, html);

  if (!emailResult.success) {
    // Mark reminder as failed so it doesn't block real reminders from the cron.
    await supabase
      .from('reminders')
      .update({ status: 'failed', sent_at: null })
      .eq('token', token);

    console.error('[POST /api/appointments/:id/test-reminder] Email send error:', emailResult.error);
    return Response.json({ error: 'Failed to send test reminder email' }, { status: 500 });
  }

  return Response.json(
    {
      success: true,
      message: `Test reminder sent to ${clientEmail}. Note: the cron will not send an additional reminder for this appointment.`,
    },
    { status: 200 }
  );
}
