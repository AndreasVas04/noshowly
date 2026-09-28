/**
 * lib/clients.ts
 *
 * Client validation and de-duplication shared by POST /api/clients and
 * PATCH /api/clients/[id] (dashboard) and POST /api/book/[slug]/appointments
 * (public booking page).
 *
 * An existing client is reused only when the phone number (or, when no phone
 * is given, the email) matches AND the name matches, case-insensitively.
 * Different people can share a number (family members), so a matching number
 * with a different name creates a new client.
 *
 * Several clients can therefore share a phone number, so lookups fetch a
 * bounded, ordered list of candidates instead of using .maybeSingle(), which
 * fails as soon as two rows match.
 *
 * IMPORTANT: meant for API routes; the caller supplies the Supabase client and
 * the salon id it is allowed to act on.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Client, Database } from '@/types';
import { normalisePhone, phoneMatchPattern, validateEmail, validatePhone } from '@/lib/contact';

// ---------------------------------------------------------------------------
// Constants and types
// ---------------------------------------------------------------------------

/** Longest client name accepted. */
export const MAX_CLIENT_NAME_LENGTH = 100;

/** Longest client notes accepted. */
export const MAX_CLIENT_NOTES_LENGTH = 500;

/** Columns returned for client candidates. */
const CLIENT_COLUMNS = 'id, salon_id, name, phone, email, notes, created_at';

/** How many candidates to inspect per lookup (oldest first). */
const CANDIDATE_LIMIT = 50;

/** Validated client fields; a field is present only when it was supplied. */
export type ClientFields = {
  name?: string;
  /** Normalised phone number, or null to clear it. */
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
};

/** Result of parseClientFields(). */
export type ClientFieldsResult =
  | { ok: true; fields: ClientFields }
  | { ok: false; error: string };

/** Result of findReusableClient(). */
export type ClientLookupResult =
  | { ok: true; client: Client | null }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validates client fields from a request body.
 *
 *  - 'create': name and phone are required; email and notes are optional.
 *  - 'update': every field is optional but at least one must be supplied;
 *              phone, email and notes can be cleared with null or ''.
 *
 * Phone numbers are returned normalised (see validatePhone()).
 *
 * @param raw  - Parsed JSON body.
 * @param mode - 'create' or 'update'.
 * @returns    The validated fields, or a user-facing error.
 */
export function parseClientFields(
  raw: Record<string, unknown>,
  mode: 'create' | 'update',
): ClientFieldsResult {
  const fields: ClientFields = {};

  if ('name' in raw || mode === 'create') {
    if (typeof raw.name !== 'string' || !raw.name.trim()) {
      return { ok: false, error: 'Client name is required' };
    }
    const name = raw.name.trim();
    if (name.length > MAX_CLIENT_NAME_LENGTH) {
      return { ok: false, error: `Client name must be ${MAX_CLIENT_NAME_LENGTH} characters or fewer` };
    }
    fields.name = name;
  }

  if ('phone' in raw || mode === 'create') {
    if (raw.phone === null || raw.phone === undefined || raw.phone === '') {
      if (mode === 'create') return { ok: false, error: 'Client phone number is required' };
      fields.phone = null;
    } else if (typeof raw.phone !== 'string') {
      return { ok: false, error: 'phone must be a string' };
    } else {
      const phone = validatePhone(raw.phone);
      if (!phone.ok) return { ok: false, error: phone.error };
      fields.phone = phone.value;
    }
  }

  if ('email' in raw) {
    if (raw.email === null || raw.email === undefined || raw.email === '') {
      fields.email = null;
    } else if (typeof raw.email !== 'string') {
      return { ok: false, error: 'email must be a string' };
    } else {
      const email = validateEmail(raw.email);
      if (!email.ok) return { ok: false, error: email.error };
      fields.email = email.value;
    }
  }

  if ('notes' in raw) {
    if (raw.notes === null || raw.notes === undefined || raw.notes === '') {
      fields.notes = null;
    } else if (typeof raw.notes !== 'string') {
      return { ok: false, error: 'notes must be a string' };
    } else {
      const notes = raw.notes.trim();
      if (notes.length > MAX_CLIENT_NOTES_LENGTH) {
        return { ok: false, error: `Notes must be ${MAX_CLIENT_NOTES_LENGTH} characters or fewer` };
      }
      fields.notes = notes || null;
    }
  }

  if (mode === 'update' && Object.keys(fields).length === 0) {
    return { ok: false, error: 'At least one field (name, phone, email, notes) is required' };
  }
  return { ok: true, fields };
}

// ---------------------------------------------------------------------------
// De-duplication
// ---------------------------------------------------------------------------

/**
 * Returns true when two client names are the same, ignoring case and
 * surrounding whitespace.
 */
export function namesMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Escapes LIKE wildcards so a value is matched literally by ilike. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

/**
 * Finds the salon's clients with a phone number, however the number was
 * formatted when it was saved. Oldest first.
 *
 * @param supabase - Supabase client allowed to read the salon's clients.
 * @param salonId  - Salon to search in.
 * @param phone    - Normalised phone number (see validatePhone()).
 */
async function findClientsByPhone(
  supabase: SupabaseClient<Database>,
  salonId: string,
  phone: string,
): Promise<{ clients: Client[]; error: string | null }> {
  const { data, error } = await supabase
    .from('clients')
    .select(CLIENT_COLUMNS)
    .eq('salon_id', salonId)
    .regexMatch('phone', phoneMatchPattern(phone, { exact: true }))
    .order('created_at', { ascending: true })
    .limit(CANDIDATE_LIMIT);

  if (error) return { clients: [], error: error.message };
  const clients = ((data ?? []) as Client[]).filter(
    (c) => c.phone !== null && normalisePhone(c.phone) === phone,
  );
  return { clients, error: null };
}

/**
 * Finds the salon's clients with an email address (case-insensitive). Oldest first.
 *
 * @param supabase - Supabase client allowed to read the salon's clients.
 * @param salonId  - Salon to search in.
 * @param email    - Email address.
 */
async function findClientsByEmail(
  supabase: SupabaseClient<Database>,
  salonId: string,
  email: string,
): Promise<{ clients: Client[]; error: string | null }> {
  const { data, error } = await supabase
    .from('clients')
    .select(CLIENT_COLUMNS)
    .eq('salon_id', salonId)
    .ilike('email', escapeLike(email))
    .order('created_at', { ascending: true })
    .limit(CANDIDATE_LIMIT);

  if (error) return { clients: [], error: error.message };
  const wanted = email.toLowerCase();
  const clients = ((data ?? []) as Client[]).filter((c) => c.email?.toLowerCase() === wanted);
  return { clients, error: null };
}

/**
 * Finds an existing client to reuse: same phone number (or same email when no
 * phone is given) and same name. Read-only.
 *
 * @param supabase     - Supabase client allowed to read the salon's clients.
 * @param salonId      - Salon to search in.
 * @param input.name   - Client name as entered.
 * @param input.phone  - Normalised phone number, or null.
 * @param input.email  - Email address, or null.
 * @returns            The oldest matching client, null when none matches, or an error.
 */
export async function findReusableClient(
  supabase: SupabaseClient<Database>,
  salonId: string,
  input: { name: string; phone: string | null; email: string | null },
): Promise<ClientLookupResult> {
  let lookup: { clients: Client[]; error: string | null };
  if (input.phone) {
    lookup = await findClientsByPhone(supabase, salonId, input.phone);
  } else if (input.email) {
    lookup = await findClientsByEmail(supabase, salonId, input.email);
  } else {
    return { ok: true, client: null };
  }

  if (lookup.error) return { ok: false, error: lookup.error };
  return { ok: true, client: lookup.clients.find((c) => namesMatch(c.name, input.name)) ?? null };
}

/**
 * Saves an email on a reused client that does not have one yet, so reminders
 * reach them. Never overwrites an existing email. Failures are logged only.
 *
 * @param supabase - Supabase client allowed to update the salon's clients.
 * @param client   - The reused client.
 * @param email    - Email supplied with this booking, or null.
 * @returns        The client with the email filled in when it was saved.
 */
export async function fillMissingClientEmail(
  supabase: SupabaseClient<Database>,
  client: Client,
  email: string | null,
): Promise<Client> {
  if (!email || client.email) return client;

  const { error } = await supabase
    .from('clients')
    .update({ email })
    .eq('id', client.id)
    .eq('salon_id', client.salon_id)
    .is('email', null);

  if (error) {
    console.error('[lib/clients] Failed to fill in client email:', error.message);
    return client;
  }
  return { ...client, email };
}
