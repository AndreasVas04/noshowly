/**
 * app/api/booking-page/route.ts
 *
 * GET  /api/booking-page — fetch the authenticated salon's booking page settings.
 * POST /api/booking-page — create a booking page for the authenticated salon.
 * PUT  /api/booking-page — update booking page settings.
 *
 * One booking page per salon. GET returns null (not 404) when none exists yet so
 * the settings UI can render a "create" form instead of treating it as an error.
 *
 * Security:
 *  - Authentication checked first on every request.
 *  - salon_id is always derived from the session — never supplied by the client.
 *  - Slug uniqueness enforced by DB unique constraint (PGRST is caught and mapped).
 *  - RLS provides a second enforcement layer.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { BookingPage } from '@/types';

// ---------------------------------------------------------------------------
// GET — fetch booking page
// ---------------------------------------------------------------------------

/**
 * Returns the booking page for the authenticated user's salon, or null if none
 * has been created yet.
 *
 * @returns 200 { bookingPage: BookingPage | null }
 * @returns 401 { error: "Unauthorized" }
 * @returns 404 { error: "Salon not found" }
 * @returns 500 { error: string }
 */
export async function GET(): Promise<Response> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Derive salon_id from session — never trust the client to supply it.
  const { data: salon, error: salonError } = await supabase
    .from('salons')
    .select('id')
    .eq('user_id', session.user.id)
    .single();

  if (salonError || !salon) {
    return Response.json({ error: 'Salon not found' }, { status: 404 });
  }

  const { data: bookingPage, error } = await supabase
    .from('booking_pages')
    .select('*')
    .eq('salon_id', salon.id)
    .maybeSingle(); // returns null instead of error when no row found

  if (error) {
    console.error('[GET /api/booking-page] DB error:', error.message);
    return Response.json({ error: 'Failed to load booking page' }, { status: 500 });
  }

  return Response.json({ bookingPage: (bookingPage as BookingPage | null) ?? null }, { status: 200 });
}

// ---------------------------------------------------------------------------
// POST — create booking page
// ---------------------------------------------------------------------------

/**
 * Creates a booking page for the authenticated user's salon.
 *
 * Request body:
 *  {
 *    slug:         string   — URL-friendly identifier (lowercase letters, digits,
 *                             hyphens only; 3–60 chars); must be globally unique
 *    description?: string   — optional text shown at the top of the public page
 *    is_active?:   boolean  — whether the page is publicly live; defaults to false
 *  }
 *
 * @returns 201 { bookingPage: BookingPage }
 * @returns 400 { error: string }
 * @returns 401 { error: "Unauthorized" }
 * @returns 404 { error: "Salon not found" }
 * @returns 409 { error: "This URL is already taken" }
 * @returns 500 { error: string }
 */
export async function POST(request: Request): Promise<Response> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Plan check — trial and cancelled users cannot create booking pages.
  const { data: userData } = await supabase.from('users').select('plan').eq('id', session.user.id).single();
  if (!userData || userData.plan === 'trial' || userData.plan === 'cancelled') {
    return Response.json({ error: 'Please upgrade to a paid plan to use this feature.' }, { status: 403 });
  }

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

  // Validate slug — required, URL-friendly format.
  if (!('slug' in raw) || typeof raw.slug !== 'string') {
    return Response.json({ error: 'slug is required' }, { status: 400 });
  }
  const slug = raw.slug.trim().toLowerCase();
  if (slug.length < 3 || slug.length > 60) {
    return Response.json({ error: 'Slug must be between 3 and 60 characters' }, { status: 400 });
  }
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return Response.json(
      { error: 'Slug may only contain lowercase letters, digits, and hyphens' },
      { status: 400 }
    );
  }

  // Validate description — optional.
  let description: string | null = null;
  if ('description' in raw) {
    if (raw.description !== null && typeof raw.description !== 'string') {
      return Response.json({ error: 'description must be a string or null' }, { status: 400 });
    }
    if (typeof raw.description === 'string') {
      const desc = raw.description.trim();
      if (desc.length > 500) {
        return Response.json({ error: 'Description must be 500 characters or fewer' }, { status: 400 });
      }
      description = desc || null;
    }
  }

  // Validate is_active — optional boolean.
  let is_active = false;
  if ('is_active' in raw) {
    if (typeof raw.is_active !== 'boolean') {
      return Response.json({ error: 'is_active must be a boolean' }, { status: 400 });
    }
    is_active = raw.is_active;
  }

  // Validate custom_title — optional, max 150 chars.
  let custom_title: string | null = null;
  if ('custom_title' in raw) {
    if (raw.custom_title !== null && typeof raw.custom_title !== 'string') {
      return Response.json({ error: 'custom_title must be a string or null' }, { status: 400 });
    }
    if (typeof raw.custom_title === 'string') {
      const t = raw.custom_title.trim();
      if (t.length > 150) {
        return Response.json({ error: 'Page title must be 150 characters or fewer' }, { status: 400 });
      }
      custom_title = t || null;
    }
  }

  // Validate custom_intro — optional, max 800 chars.
  let custom_intro: string | null = null;
  if ('custom_intro' in raw) {
    if (raw.custom_intro !== null && typeof raw.custom_intro !== 'string') {
      return Response.json({ error: 'custom_intro must be a string or null' }, { status: 400 });
    }
    if (typeof raw.custom_intro === 'string') {
      const t = raw.custom_intro.trim();
      if (t.length > 800) {
        return Response.json({ error: 'Welcome message must be 800 characters or fewer' }, { status: 400 });
      }
      custom_intro = t || null;
    }
  }

  // Validate require_phone — optional boolean, defaults to true.
  let require_phone = true;
  if ('require_phone' in raw) {
    if (typeof raw.require_phone !== 'boolean') {
      return Response.json({ error: 'require_phone must be a boolean' }, { status: 400 });
    }
    require_phone = raw.require_phone;
  }

  // Validate require_email — optional boolean, defaults to true.
  let require_email = true;
  if ('require_email' in raw) {
    if (typeof raw.require_email !== 'boolean') {
      return Response.json({ error: 'require_email must be a boolean' }, { status: 400 });
    }
    require_email = raw.require_email;
  }

  // At least one contact field must be required — protect against turning both off.
  if (!require_phone && !require_email) {
    return Response.json({ error: 'At least one contact field (phone or email) must be required' }, { status: 400 });
  }

  // Derive salon_id from session.
  const { data: salon, error: salonError } = await supabase
    .from('salons')
    .select('id')
    .eq('user_id', session.user.id)
    .single();

  if (salonError || !salon) {
    return Response.json({ error: 'Salon not found' }, { status: 404 });
  }

  const { data: bookingPage, error: insertError } = await supabase
    .from('booking_pages')
    .insert({ salon_id: salon.id, slug, description, is_active, custom_title, custom_intro, require_phone, require_email })
    .select()
    .single();

  if (insertError) {
    // Unique constraint violation on slug (code 23505) or salon_id (one per salon).
    if (insertError.code === '23505') {
      if (insertError.message.includes('slug')) {
        return Response.json({ error: 'This URL is already taken' }, { status: 409 });
      }
      return Response.json({ error: 'Your salon already has a booking page' }, { status: 409 });
    }
    console.error('[POST /api/booking-page] DB error:', insertError.message);
    return Response.json({ error: 'Failed to create booking page' }, { status: 500 });
  }

  return Response.json({ bookingPage: bookingPage as BookingPage }, { status: 201 });
}

// ---------------------------------------------------------------------------
// PUT — update booking page
// ---------------------------------------------------------------------------

/**
 * Updates the authenticated salon's booking page.
 *
 * Request body (all fields optional — at least one required):
 *  {
 *    slug?:        string          — new URL slug (same validation as POST)
 *    description?: string | null   — updated description, or null to clear
 *    is_active?:   boolean         — toggle public visibility
 *  }
 *
 * @returns 200 { bookingPage: BookingPage }
 * @returns 400 { error: string }
 * @returns 401 { error: "Unauthorized" }
 * @returns 404 { error: "Booking page not found" } — or salon not found
 * @returns 409 { error: "This URL is already taken" }
 * @returns 500 { error: string }
 */
export async function PUT(request: Request): Promise<Response> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Plan check — trial and cancelled users cannot update booking pages.
  const { data: userDataPut } = await supabase.from('users').select('plan').eq('id', session.user.id).single();
  if (!userDataPut || userDataPut.plan === 'trial' || userDataPut.plan === 'cancelled') {
    return Response.json({ error: 'Please upgrade to a paid plan to use this feature.' }, { status: 403 });
  }

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
  const updates: {
    slug?: string;
    description?: string | null;
    is_active?: boolean;
    custom_title?: string | null;
    custom_intro?: string | null;
    require_phone?: boolean;
    require_email?: boolean;
  } = {};

  if ('slug' in raw) {
    if (typeof raw.slug !== 'string') {
      return Response.json({ error: 'slug must be a string' }, { status: 400 });
    }
    const slug = raw.slug.trim().toLowerCase();
    if (slug.length < 3 || slug.length > 60) {
      return Response.json({ error: 'Slug must be between 3 and 60 characters' }, { status: 400 });
    }
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return Response.json(
        { error: 'Slug may only contain lowercase letters, digits, and hyphens' },
        { status: 400 }
      );
    }
    updates.slug = slug;
  }

  if ('description' in raw) {
    if (raw.description === null) {
      updates.description = null;
    } else if (typeof raw.description !== 'string') {
      return Response.json({ error: 'description must be a string or null' }, { status: 400 });
    } else {
      const desc = raw.description.trim();
      if (desc.length > 500) {
        return Response.json({ error: 'Description must be 500 characters or fewer' }, { status: 400 });
      }
      updates.description = desc || null;
    }
  }

  if ('is_active' in raw) {
    if (typeof raw.is_active !== 'boolean') {
      return Response.json({ error: 'is_active must be a boolean' }, { status: 400 });
    }
    updates.is_active = raw.is_active;
  }

  if ('custom_title' in raw) {
    if (raw.custom_title !== null && typeof raw.custom_title !== 'string') {
      return Response.json({ error: 'custom_title must be a string or null' }, { status: 400 });
    }
    if (typeof raw.custom_title === 'string') {
      const t = raw.custom_title.trim();
      if (t.length > 150) {
        return Response.json({ error: 'Page title must be 150 characters or fewer' }, { status: 400 });
      }
      updates.custom_title = t || null;
    } else {
      updates.custom_title = null;
    }
  }

  if ('custom_intro' in raw) {
    if (raw.custom_intro !== null && typeof raw.custom_intro !== 'string') {
      return Response.json({ error: 'custom_intro must be a string or null' }, { status: 400 });
    }
    if (typeof raw.custom_intro === 'string') {
      const t = raw.custom_intro.trim();
      if (t.length > 800) {
        return Response.json({ error: 'Welcome message must be 800 characters or fewer' }, { status: 400 });
      }
      updates.custom_intro = t || null;
    } else {
      updates.custom_intro = null;
    }
  }

  if ('require_phone' in raw) {
    if (typeof raw.require_phone !== 'boolean') {
      return Response.json({ error: 'require_phone must be a boolean' }, { status: 400 });
    }
    updates.require_phone = raw.require_phone;
  }

  if ('require_email' in raw) {
    if (typeof raw.require_email !== 'boolean') {
      return Response.json({ error: 'require_email must be a boolean' }, { status: 400 });
    }
    updates.require_email = raw.require_email;
  }

  // Validate that at least one contact field remains required if both are being updated.
  const newPhone = 'require_phone' in updates ? updates.require_phone : undefined;
  const newEmail = 'require_email' in updates ? updates.require_email : undefined;
  if (newPhone === false && newEmail === false) {
    return Response.json({ error: 'At least one contact field (phone or email) must be required' }, { status: 400 });
  }

  if (Object.keys(updates).length === 0) {
    return Response.json(
      { error: 'At least one field (slug, description, is_active, custom_title, custom_intro, require_phone, require_email) is required' },
      { status: 400 }
    );
  }

  // Derive salon_id from session.
  const { data: salon, error: salonError } = await supabase
    .from('salons')
    .select('id')
    .eq('user_id', session.user.id)
    .single();

  if (salonError || !salon) {
    return Response.json({ error: 'Salon not found' }, { status: 404 });
  }

  const { data: bookingPage, error: updateError } = await supabase
    .from('booking_pages')
    .update(updates)
    .eq('salon_id', salon.id) // ownership check
    .select()
    .single();

  if (updateError) {
    if (updateError.code === 'PGRST116') {
      return Response.json({ error: 'Booking page not found' }, { status: 404 });
    }
    if (updateError.code === '23505') {
      return Response.json({ error: 'This URL is already taken' }, { status: 409 });
    }
    console.error('[PUT /api/booking-page] DB error:', updateError.message);
    return Response.json({ error: 'Failed to update booking page' }, { status: 500 });
  }

  if (!bookingPage) {
    return Response.json({ error: 'Booking page not found' }, { status: 404 });
  }

  return Response.json({ bookingPage: bookingPage as BookingPage }, { status: 200 });
}
