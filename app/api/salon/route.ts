/**
 * app/api/salon/route.ts
 *
 * GET /api/salon — fetch the authenticated user's salon details.
 * PUT /api/salon — update salon name, phone, timezone, sms_sender_name,
 *                  opening_time, and/or closing_time.
 *
 * One salon per user. The salon record is created on registration; this route
 * only reads and updates it — it never creates or deletes.
 *
 * Security:
 *  - Authentication checked first on every request.
 *  - salon_id is always derived from the session — never supplied by the client.
 *  - All inputs validated (length, format) before any DB write.
 *  - RLS on salons table provides a second enforcement layer.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { Salon } from '@/types';

// ---------------------------------------------------------------------------
// GET — read salon
// ---------------------------------------------------------------------------

/**
 * Returns the salon record for the authenticated user.
 *
 * @returns 200 { salon: Salon }               — salon data
 * @returns 401 { error: "Unauthorized" }      — no valid session
 * @returns 404 { error: "Salon not found" }   — no salon for this user yet
 * @returns 500 { error: string }              — unexpected DB error
 */
export async function GET(): Promise<Response> {
  // Step 1: Verify authentication.
  const supabase = await createServerSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Step 2: Fetch salon.
  const { data: salon, error } = await supabase
    .from('salons')
    .select('*')
    .eq('user_id', session.user.id)
    .single();

  if (error || !salon) {
    return Response.json({ error: 'Salon not found' }, { status: 404 });
  }

  return Response.json({ salon: salon as Salon }, { status: 200 });
}

// ---------------------------------------------------------------------------
// PUT — update salon
// ---------------------------------------------------------------------------

/**
 * Updates the salon's profile fields.
 *
 * Request body (all fields optional — only supplied fields are updated):
 *  {
 *    name?:            string   — salon display name, 1–100 chars
 *    phone?:           string   — salon contact number, max 20 chars, or null to clear
 *    timezone?:        string   — IANA timezone string, max 60 chars
 *    sms_sender_name?: string   — name shown in SMS messages, max 50 chars, or null to clear
 *    opening_time?:    string   — HH:MM 24-hour format, e.g. "09:00", or null to clear
 *    closing_time?:    string   — HH:MM 24-hour format, e.g. "20:00", or null to clear
 *  }
 *
 * At least one field must be provided.
 *
 * @returns 200 { salon: Salon }               — updated salon
 * @returns 400 { error: string }              — validation failure
 * @returns 401 { error: "Unauthorized" }      — no valid session
 * @returns 404 { error: "Salon not found" }   — user has no salon
 * @returns 500 { error: string }              — unexpected DB error
 */
export async function PUT(request: Request): Promise<Response> {
  // Step 1: Verify authentication.
  const supabase = await createServerSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Step 2: Parse and validate the request body.
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

  // Build the update payload — only include fields that were actually supplied.
  const updates: {
    name?: string;
    phone?: string | null;
    timezone?: string;
    sms_sender_name?: string | null;
    opening_time?: string | null;
    closing_time?: string | null;
  } = {};

  // Validate name (if provided)
  if ('name' in raw) {
    if (typeof raw.name !== 'string') {
      return Response.json({ error: 'name must be a string' }, { status: 400 });
    }
    const name = raw.name.trim();
    if (!name) {
      return Response.json({ error: 'Salon name cannot be empty' }, { status: 400 });
    }
    if (name.length > 100) {
      return Response.json(
        { error: 'Salon name must be 100 characters or fewer' },
        { status: 400 }
      );
    }
    updates.name = name;
  }

  // Validate phone (if provided — null clears the field)
  if ('phone' in raw) {
    if (raw.phone !== null && typeof raw.phone !== 'string') {
      return Response.json({ error: 'phone must be a string or null' }, { status: 400 });
    }
    if (typeof raw.phone === 'string') {
      const phone = raw.phone.trim();
      if (phone.length > 20) {
        return Response.json(
          { error: 'Phone number must be 20 characters or fewer' },
          { status: 400 }
        );
      }
      updates.phone = phone || null; // empty string → null
    } else {
      updates.phone = null; // explicit null clears the field
    }
  }

  // Validate timezone (if provided)
  if ('timezone' in raw) {
    if (typeof raw.timezone !== 'string') {
      return Response.json({ error: 'timezone must be a string' }, { status: 400 });
    }
    const timezone = raw.timezone.trim();
    if (!timezone) {
      return Response.json({ error: 'Timezone cannot be empty' }, { status: 400 });
    }
    if (timezone.length > 60) {
      return Response.json(
        { error: 'Timezone string must be 60 characters or fewer' },
        { status: 400 }
      );
    }
    updates.timezone = timezone;
  }

  // Validate sms_sender_name (if provided — null clears the field)
  if ('sms_sender_name' in raw) {
    if (raw.sms_sender_name !== null && typeof raw.sms_sender_name !== 'string') {
      return Response.json(
        { error: 'sms_sender_name must be a string or null' },
        { status: 400 }
      );
    }
    if (typeof raw.sms_sender_name === 'string') {
      const smsName = raw.sms_sender_name.trim();
      if (smsName.length > 50) {
        return Response.json(
          { error: 'SMS sender name must be 50 characters or fewer' },
          { status: 400 }
        );
      }
      updates.sms_sender_name = smsName || null;
    } else {
      updates.sms_sender_name = null;
    }
  }

  // Validate opening_time (if provided — null clears the field)
  if ('opening_time' in raw) {
    if (raw.opening_time !== null && typeof raw.opening_time !== 'string') {
      return Response.json({ error: 'opening_time must be a string or null' }, { status: 400 });
    }
    if (typeof raw.opening_time === 'string') {
      if (!/^\d{2}:\d{2}$/.test(raw.opening_time)) {
        return Response.json({ error: 'opening_time must be in HH:MM format' }, { status: 400 });
      }
      updates.opening_time = raw.opening_time;
    } else {
      updates.opening_time = null;
    }
  }

  // Validate closing_time (if provided — null clears the field)
  if ('closing_time' in raw) {
    if (raw.closing_time !== null && typeof raw.closing_time !== 'string') {
      return Response.json({ error: 'closing_time must be a string or null' }, { status: 400 });
    }
    if (typeof raw.closing_time === 'string') {
      if (!/^\d{2}:\d{2}$/.test(raw.closing_time)) {
        return Response.json({ error: 'closing_time must be in HH:MM format' }, { status: 400 });
      }
      updates.closing_time = raw.closing_time;
    } else {
      updates.closing_time = null;
    }
  }

  // Reject requests that supply no valid fields.
  if (Object.keys(updates).length === 0) {
    return Response.json(
      { error: 'At least one field (name, phone, timezone, sms_sender_name, opening_time, closing_time) is required' },
      { status: 400 }
    );
  }

  // Step 3: Update the salon for this user.
  // The .eq('user_id', session.user.id) clause is the ownership guard —
  // users can only update their own salon even if they knew another salon's id.
  const { data: salon, error: updateError } = await supabase
    .from('salons')
    .update(updates)
    .eq('user_id', session.user.id)
    .select()
    .single();

  if (updateError) {
    // updateError.code === 'PGRST116' means no rows matched the WHERE clause —
    // i.e. the user has no salon record yet.
    if (updateError.code === 'PGRST116') {
      return Response.json({ error: 'Salon not found' }, { status: 404 });
    }
    console.error('[PUT /api/salon] DB error:', updateError.message);
    return Response.json({ error: 'Failed to update salon' }, { status: 500 });
  }

  if (!salon) {
    // Should not be reachable after the error check above, but keeps TS happy.
    return Response.json({ error: 'Salon not found' }, { status: 404 });
  }

  return Response.json({ salon: salon as Salon }, { status: 200 });
}
