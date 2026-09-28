/**
 * lib/reminders/store.ts
 *
 * Supabase queries for appointment emails: loading appointments with their
 * client, staff member and salon, reading and writing reminders rows, counting
 * recent sends for the sending limits, and the owner's monthly counter.
 *
 * Used by lib/reminders/gateway.ts and app/api/cron/send-reminders with the
 * service-role client, and by app/api/appointments/[id] (cancelReminderLinks)
 * with the signed-in owner's client.
 *
 * Every query selects explicit columns and is scoped by id or salon_id.
 * Database errors are thrown as Error (message only, never client data)
 * unless stated otherwise.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, ReminderType } from '@/types';
import type { ClaimRow, ClaimStore, InsertClaimResult } from '@/lib/reminders/claim';
import type { CounterSnapshot, CounterStore } from '@/lib/reminders/quota';
import type { EmailKind, ReminderRecord } from '@/lib/reminders/rules';

type Db = SupabaseClient<Database>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = '23505';

/** Ids per `in` filter, keeping request URLs short. */
const LOOKUP_CHUNK_SIZE = 50;

/** Most client rows read when matching a recipient address. */
const RECIPIENT_CLIENT_LIMIT = 100;

/** Every kind of email sent to clients; all of them count towards the sending limits. */
export const CLIENT_EMAIL_TYPES: readonly EmailKind[] = ['email', 'email_confirmation', 'email_test'];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Salon fields the emails need. */
export type SalonEmailSettings = {
  id: string;
  user_id: string;
  name: string;
  timezone: string;
  email_subject: string | null;
  email_greeting: string | null;
  email_body: string | null;
  email_closing: string | null;
  email_footer: string | null;
  email_confirmation_enabled: boolean | null;
};

/** Everything needed to address and render one appointment email. */
export type AppointmentEmailContext = {
  appointment: {
    id: string;
    salon_id: string;
    datetime: string;
    status: string;
    service_type: string | null;
  };
  client: { name: string | null; email: string | null } | null;
  staffName: string | null;
  salon: SalonEmailSettings;
};

/** Salon owner fields the gateway reads. */
export type OwnerRecord = {
  id: string;
  email: string;
  plan: string;
  email_reminders_used_this_month: number;
  reminders_reset_at: string;
};

/** Result of insertReminderRow(). */
export type InsertReminderResult = InsertClaimResult;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Splits a list into chunks of at most `size` items. */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/** Escapes LIKE wildcards so a value is matched literally by ilike. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

/**
 * PostgREST `or` filter for emails sent since `since`, plus emails being sent
 * right now (rows still 'pending' that were created since then).
 *
 * @param since - ISO timestamp.
 */
function sentOrSendingSince(since: string): string {
  return `sent_at.gte."${since}",and(status.eq.pending,created_at.gte."${since}")`;
}

// ---------------------------------------------------------------------------
// Appointments
// ---------------------------------------------------------------------------

/** Columns of an appointment with its client, staff member and salon. */
const APPOINTMENT_CONTEXT_COLUMNS = `
  id, salon_id, datetime, status, service_type,
  clients (name, email),
  barbers (name),
  salons (
    id, user_id, name, timezone,
    email_subject, email_greeting, email_body, email_closing, email_footer,
    email_confirmation_enabled
  )
`;

/** Row shape of APPOINTMENT_CONTEXT_COLUMNS. */
type AppointmentContextRow = AppointmentEmailContext['appointment'] & {
  clients: { name: string | null; email: string | null } | null;
  barbers: { name: string | null } | null;
  salons: SalonEmailSettings | null;
};

/** Converts a joined row; null when the salon could not be read. */
function toContext(row: AppointmentContextRow): AppointmentEmailContext | null {
  if (!row.salons) return null;
  return {
    appointment: {
      id:           row.id,
      salon_id:     row.salon_id,
      datetime:     row.datetime,
      status:       row.status,
      service_type: row.service_type,
    },
    client:    row.clients,
    staffName: row.barbers?.name ?? null,
    salon:     row.salons,
  };
}

/**
 * Loads one appointment with everything its emails need.
 *
 * @param db            - Service-role client.
 * @param appointmentId - Appointment id.
 * @returns             The context, or null when the appointment does not exist.
 */
export async function loadAppointmentEmailContext(
  db: Db,
  appointmentId: string,
): Promise<AppointmentEmailContext | null> {
  const { data, error } = await db
    .from('appointments')
    .select(APPOINTMENT_CONTEXT_COLUMNS)
    .eq('id', appointmentId)
    .maybeSingle();

  if (error) throw new Error(`Appointment lookup failed: ${error.message}`);
  if (!data) return null;
  // Cast via unknown: the Database type has no Relationships, so the Supabase
  // types cannot resolve the joins; the foreign keys exist in the database.
  return toContext(data as unknown as AppointmentContextRow);
}

/**
 * Loads the 'scheduled' appointments starting in (after, until], soonest
 * first, page by page.
 *
 * @param db               - Service-role client.
 * @param window.after     - Exclusive lower bound (ISO timestamp).
 * @param window.until     - Inclusive upper bound (ISO timestamp).
 * @param options.pageSize - Rows per request (below PostgREST's row limit).
 * @param options.maxPages - Most pages read in one run.
 */
export async function loadScheduledAppointmentsBetween(
  db: Db,
  window: { after: string; until: string },
  options: { pageSize: number; maxPages: number },
): Promise<AppointmentEmailContext[]> {
  const contexts: AppointmentEmailContext[] = [];

  for (let page = 0; page < options.maxPages; page++) {
    const from = page * options.pageSize;
    const { data, error } = await db
      .from('appointments')
      .select(APPOINTMENT_CONTEXT_COLUMNS)
      .eq('status', 'scheduled')
      .gt('datetime', window.after)
      .lte('datetime', window.until)
      .order('datetime', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + options.pageSize - 1);

    if (error) throw new Error(`Scheduled appointments query failed: ${error.message}`);

    const rows = (data ?? []) as unknown as AppointmentContextRow[];
    for (const row of rows) {
      const context = toContext(row);
      if (context) contexts.push(context);
    }
    if (rows.length < options.pageSize) break;
  }
  return contexts;
}

// ---------------------------------------------------------------------------
// Reminder rows
// ---------------------------------------------------------------------------

/**
 * Loads the 24-hour reminder and booking confirmation rows that matter for
 * the due rules ('pending', 'sent' or 'confirmed') of many appointments.
 *
 * @param db             - Service-role client.
 * @param appointmentIds - Appointment ids.
 */
export async function loadReminderRecords(
  db: Db,
  appointmentIds: readonly string[],
): Promise<ReminderRecord[]> {
  const records: ReminderRecord[] = [];
  for (const ids of chunk(appointmentIds, LOOKUP_CHUNK_SIZE)) {
    const { data, error } = await db
      .from('reminders')
      .select('id, appointment_id, type, status, token, created_at, sent_at')
      .in('appointment_id', ids)
      .in('type', ['email', 'email_confirmation'])
      .in('status', ['pending', 'sent', 'confirmed']);

    if (error) throw new Error(`Reminder lookup failed: ${error.message}`);
    records.push(...((data ?? []) as ReminderRecord[]));
  }
  return records;
}

/**
 * Inserts a 'pending' reminders row, recorded before the email is sent.
 * Does not throw: errors are returned, with duplicate = true for 23505.
 *
 * @param db    - Service-role client.
 * @param input - Appointment, email kind, link token and send time.
 */
export async function insertReminderRow(
  db: Db,
  input: { appointmentId: string; type: EmailKind; token: string; sendAt: string },
): Promise<InsertReminderResult> {
  const { data, error } = await db
    .from('reminders')
    .insert({
      appointment_id: input.appointmentId,
      type:           input.type,
      send_at:        input.sendAt,
      status:         'pending',
      token:          input.token,
    })
    .select('id, status, created_at')
    .single();

  if (error || !data) {
    return {
      ok: false,
      duplicate: error?.code === UNIQUE_VIOLATION,
      message: error?.message ?? 'Reminder insert returned no row',
    };
  }
  return { ok: true, row: data as ClaimRow };
}

/**
 * Marks a 'pending' row as sent. Rows changed meanwhile (e.g. retired by a
 * reschedule) are left alone.
 *
 * @param db     - Service-role client.
 * @param id     - Reminder row id.
 * @param sentAt - ISO timestamp of the send.
 */
export async function markReminderSent(db: Db, id: string, sentAt: string): Promise<void> {
  const { error } = await db
    .from('reminders')
    .update({ status: 'sent', sent_at: sentAt })
    .eq('id', id)
    .eq('status', 'pending');

  if (error) throw new Error(`Failed to mark reminder ${id} as sent: ${error.message}`);
}

/**
 * Marks a 'pending' row as failed or skipped.
 *
 * @param db     - Service-role client.
 * @param id     - Reminder row id.
 * @param status - New status.
 */
export async function markReminderUnsent(
  db: Db,
  id: string,
  status: 'failed' | 'skipped',
): Promise<void> {
  const { error } = await db
    .from('reminders')
    .update({ status })
    .eq('id', id)
    .eq('status', 'pending');

  if (error) throw new Error(`Failed to mark reminder ${id} as ${status}: ${error.message}`);
}

/**
 * Retires an appointment's email links: its 'pending' and 'sent' 24-hour
 * reminder and booking confirmation rows become 'cancelled'. Their YES/NO
 * links stop working, and a new 24-hour reminder can be claimed for the
 * appointment's new time. Test sends never change anything and are left alone.
 *
 * Works with the service-role client and with the signed-in owner's client
 * (RLS lets owners update the reminders of their own appointments).
 *
 * @param db            - Supabase client allowed to update the appointment's reminders.
 * @param appointmentId - Appointment id.
 * @returns             Error message, or null on success. Never throws.
 */
export async function cancelReminderLinks(db: Db, appointmentId: string): Promise<string | null> {
  const types: ReminderType[] = ['email', 'email_confirmation'];
  const { error } = await db
    .from('reminders')
    .update({ status: 'cancelled' })
    .eq('appointment_id', appointmentId)
    .in('type', types)
    .in('status', ['pending', 'sent']);

  return error ? error.message : null;
}

/**
 * ClaimStore (lib/reminders/claim.ts) backed by Supabase.
 *
 * @param db - Service-role client.
 */
export function createClaimStore(db: Db): ClaimStore {
  return {
    async retirePendingClaims(ids) {
      const { data, error } = await db
        .from('reminders')
        .update({ status: 'failed' })
        .in('id', [...ids])
        .eq('type', 'email')
        .eq('status', 'pending')
        .select('id');

      if (error) throw new Error(`Failed to retire stale reminder claims: ${error.message}`);
      return (data ?? []).length;
    },

    insertClaim(input) {
      return insertReminderRow(db, { ...input, type: 'email' });
    },

    async loadLiveClaims(appointmentId) {
      const { data, error } = await db
        .from('reminders')
        .select('id, status, created_at')
        .eq('appointment_id', appointmentId)
        .eq('type', 'email')
        .in('status', ['pending', 'sent'])
        .not('token', 'is', null);

      if (error) throw new Error(`Reminder claim lookup failed: ${error.message}`);
      return (data ?? []) as ClaimRow[];
    },

    markSkipped(id) {
      return markReminderUnsent(db, id, 'skipped');
    },
  };
}

// ---------------------------------------------------------------------------
// Recent sends (sending limits)
// ---------------------------------------------------------------------------

/**
 * Counts a salon's emails sent (or being sent) since an instant.
 *
 * @param db      - Service-role client.
 * @param salonId - Salon.
 * @param since   - Start of the window.
 * @param types   - Email kinds to count (default: all).
 */
export async function countSalonEmailsSince(
  db: Db,
  salonId: string,
  since: Date,
  types: readonly EmailKind[] = CLIENT_EMAIL_TYPES,
): Promise<number> {
  // reminders has no salon_id: filter through the appointment (inner join).
  const { count, error } = await db
    .from('reminders')
    .select('id, appointments!inner(salon_id)', { count: 'exact', head: true })
    .eq('appointments.salon_id', salonId)
    .in('type', [...types])
    .or(sentOrSendingSince(since.toISOString()));

  if (error) throw new Error(`Salon email count failed: ${error.message}`);
  return count ?? 0;
}

/**
 * Counts the emails a salon sent (or is sending) to an address since an
 * instant: emails for any of the salon's clients with that address,
 * ignoring case.
 *
 * @param db      - Service-role client.
 * @param salonId - Salon.
 * @param email   - Recipient address.
 * @param since   - Start of the window.
 */
export async function countEmailsToAddressSince(
  db: Db,
  salonId: string,
  email: string,
  since: Date,
): Promise<number> {
  const { data: clients, error: clientError } = await db
    .from('clients')
    .select('id')
    .eq('salon_id', salonId)
    .ilike('email', escapeLike(email.trim()))
    .limit(RECIPIENT_CLIENT_LIMIT);

  if (clientError) throw new Error(`Recipient lookup failed: ${clientError.message}`);
  const clientIds = (clients ?? []).map((c) => c.id);
  if (clientIds.length === 0) return 0;

  const { count, error } = await db
    .from('reminders')
    .select('id, appointments!inner(client_id)', { count: 'exact', head: true })
    .in('appointments.client_id', clientIds)
    .in('type', [...CLIENT_EMAIL_TYPES])
    .or(sentOrSendingSince(since.toISOString()));

  if (error) throw new Error(`Recipient email count failed: ${error.message}`);
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Salon owners and the monthly counter
// ---------------------------------------------------------------------------

/** Columns of OwnerRecord. */
const OWNER_COLUMNS = 'id, email, plan, email_reminders_used_this_month, reminders_reset_at';

/**
 * Loads salon owners by id.
 *
 * @param db      - Service-role client.
 * @param userIds - users.id values.
 * @returns       Owners by id (missing ids are absent).
 */
export async function loadOwners(db: Db, userIds: readonly string[]): Promise<Map<string, OwnerRecord>> {
  const owners = new Map<string, OwnerRecord>();
  for (const ids of chunk([...new Set(userIds)], LOOKUP_CHUNK_SIZE)) {
    const { data, error } = await db.from('users').select(OWNER_COLUMNS).in('id', ids);
    if (error) throw new Error(`Owner lookup failed: ${error.message}`);
    for (const row of (data ?? []) as OwnerRecord[]) owners.set(row.id, row);
  }
  return owners;
}

/** Converts users columns to a CounterSnapshot. */
function toSnapshot(row: { email_reminders_used_this_month: number | null; reminders_reset_at: string }): CounterSnapshot {
  return { used: row.email_reminders_used_this_month ?? 0, resetAt: row.reminders_reset_at };
}

/**
 * CounterStore (lib/reminders/quota.ts) backed by Supabase.
 *
 * @param db - Service-role client (owners cannot write to public.users).
 */
export function createCounterStore(db: Db): CounterStore {
  return {
    async read(userId) {
      const { data, error } = await db
        .from('users')
        .select('email_reminders_used_this_month, reminders_reset_at')
        .eq('id', userId)
        .maybeSingle();

      if (error) throw new Error(`Counter read failed: ${error.message}`);
      return data ? toSnapshot(data) : null;
    },

    async resetIfDue(userId, now, nextResetAt) {
      const { data, error } = await db
        .from('users')
        .update({
          reminders_used_this_month:       0,
          email_reminders_used_this_month: 0,
          reminders_reset_at:              nextResetAt,
        })
        .eq('id', userId)
        .lte('reminders_reset_at', now.toISOString())
        .select('email_reminders_used_this_month, reminders_reset_at');

      if (error) throw new Error(`Monthly counter reset failed: ${error.message}`);
      const row = (data ?? [])[0];
      return row ? toSnapshot(row) : null;
    },

    async compareAndSet(userId, expected, next) {
      const { data, error } = await db
        .from('users')
        .update({ email_reminders_used_this_month: next })
        .eq('id', userId)
        .eq('email_reminders_used_this_month', expected)
        .select('id');

      if (error) throw new Error(`Counter update failed: ${error.message}`);
      return (data ?? []).length === 1;
    },
  };
}
