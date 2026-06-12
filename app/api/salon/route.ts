/**
 * app/api/salon/route.ts
 *
 * GET /api/salon — fetch the authenticated user's salon details.
 * PUT /api/salon — update salon name, phone, timezone,
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
 *    name?:             string  — salon display name, 1–100 chars
 *    phone?:            string  — salon contact number, max 20 chars, or null to clear
 *    timezone?:         string  — IANA timezone string, max 60 chars
 *    opening_time?:     string  — HH:MM 24-hour format, e.g. "09:00", or null to clear
 *    closing_time?:     string  — HH:MM 24-hour format, e.g. "20:00", or null to clear
 *    email_footer?:     string  — custom email footer text, max 300 chars, or null to reset to default
 *    email_subject?:    string  — custom email subject line, max 200 chars, or null to reset to default
 *    email_greeting?:   string  — custom email greeting line, max 200 chars, or null to reset to default
 *    email_body?:       string  — custom email body paragraph, max 500 chars, or null to reset to default
 *    email_closing?:    string  — custom email closing message, max 200 chars, or null to reset to default
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

  // Allowed ISO 4217 currency codes (must stay in sync with the settings UI dropdown).
  const ALLOWED_CURRENCIES = new Set([
    'USD','EUR','GBP','AUD','CAD','CHF','JPY','CNY','INR','BRL','MXN',
    'SGD','HKD','NOK','SEK','DKK','NZD','ZAR','AED','SAR','QAR','KWD',
    'TRY','PLN','CZK','HUF','RON','BGN','HRK','RSD','CYP',
  ]);

  // Build the update payload — only include fields that were actually supplied.
  const updates: {
    name?: string;
    phone?: string | null;
    timezone?: string;
    opening_time?: string | null;
    closing_time?: string | null;
    email_footer?: string | null;
    email_subject?: string | null;
    email_greeting?: string | null;
    email_body?: string | null;
    email_closing?: string | null;
    currency?: string;
    email_confirmation_enabled?: boolean;
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

  // Validate email_footer (if provided — null resets to application default)
  if ('email_footer' in raw) {
    if (raw.email_footer !== null && typeof raw.email_footer !== 'string') {
      return Response.json({ error: 'email_footer must be a string or null' }, { status: 400 });
    }
    if (typeof raw.email_footer === 'string') {
      const footer = raw.email_footer.trim();
      if (footer.length > 300) {
        return Response.json(
          { error: 'Email footer must be 300 characters or fewer' },
          { status: 400 }
        );
      }
      updates.email_footer = footer || null; // empty string → null (use default)
    } else {
      updates.email_footer = null;
    }
  }

  // Validate email_subject (if provided — null resets to application default)
  if ('email_subject' in raw) {
    if (raw.email_subject !== null && typeof raw.email_subject !== 'string') {
      return Response.json({ error: 'email_subject must be a string or null' }, { status: 400 });
    }
    if (typeof raw.email_subject === 'string') {
      const subject = raw.email_subject.trim();
      if (subject.length > 200) {
        return Response.json(
          { error: 'Email subject must be 200 characters or fewer' },
          { status: 400 }
        );
      }
      updates.email_subject = subject || null;
    } else {
      updates.email_subject = null;
    }
  }

  // Validate email_greeting (if provided — null resets to application default)
  if ('email_greeting' in raw) {
    if (raw.email_greeting !== null && typeof raw.email_greeting !== 'string') {
      return Response.json({ error: 'email_greeting must be a string or null' }, { status: 400 });
    }
    if (typeof raw.email_greeting === 'string') {
      const greeting = raw.email_greeting.trim();
      if (greeting.length > 200) {
        return Response.json(
          { error: 'Email greeting must be 200 characters or fewer' },
          { status: 400 }
        );
      }
      updates.email_greeting = greeting || null;
    } else {
      updates.email_greeting = null;
    }
  }

  // Validate email_body (if provided — null resets to application default)
  if ('email_body' in raw) {
    if (raw.email_body !== null && typeof raw.email_body !== 'string') {
      return Response.json({ error: 'email_body must be a string or null' }, { status: 400 });
    }
    if (typeof raw.email_body === 'string') {
      const body = raw.email_body.trim();
      if (body.length > 500) {
        return Response.json(
          { error: 'Email body must be 500 characters or fewer' },
          { status: 400 }
        );
      }
      updates.email_body = body || null;
    } else {
      updates.email_body = null;
    }
  }

  // Validate email_closing (if provided — null resets to application default)
  if ('email_closing' in raw) {
    if (raw.email_closing !== null && typeof raw.email_closing !== 'string') {
      return Response.json({ error: 'email_closing must be a string or null' }, { status: 400 });
    }
    if (typeof raw.email_closing === 'string') {
      const closing = raw.email_closing.trim();
      if (closing.length > 200) {
        return Response.json(
          { error: 'Email closing must be 200 characters or fewer' },
          { status: 400 }
        );
      }
      updates.email_closing = closing || null;
    } else {
      updates.email_closing = null;
    }
  }

  // Validate currency (if provided — must be a recognised ISO 4217 code).
  if ('currency' in raw) {
    if (typeof raw.currency !== 'string') {
      return Response.json({ error: 'currency must be a string' }, { status: 400 });
    }
    const currency = raw.currency.trim().toUpperCase();
    if (!ALLOWED_CURRENCIES.has(currency)) {
      return Response.json({ error: 'Unsupported currency code' }, { status: 400 });
    }
    updates.currency = currency;
  }

  // Validate email_confirmation_enabled (if provided — must be a boolean).
  if ('email_confirmation_enabled' in raw) {
    if (typeof raw.email_confirmation_enabled !== 'boolean') {
      return Response.json({ error: 'email_confirmation_enabled must be a boolean' }, { status: 400 });
    }
    updates.email_confirmation_enabled = raw.email_confirmation_enabled;
  }

  // Reject requests that supply no valid fields.
  if (Object.keys(updates).length === 0) {
    return Response.json(
      { error: 'At least one updatable field must be provided' },
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
