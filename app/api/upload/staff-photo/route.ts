/**
 * app/api/upload/staff-photo/route.ts
 *
 * POST /api/upload/staff-photo
 *
 * Accepts a multipart/form-data upload with a single "file" field, validates it,
 * uploads it to the Supabase Storage "staff-photos" bucket using the service role
 * key, and returns the public URL.
 *
 * Validations:
 *  - Auth required — only authenticated salon owners can upload.
 *  - File must be an image (image/jpeg, image/png, image/webp).
 *  - Maximum file size: 5 MB.
 *
 * Security:
 *  - Service role key is used server-side only to bypass RLS for storage uploads.
 *  - File content-type is validated before upload.
 *  - Auth is verified via Supabase session before any processing.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

/** Allowed MIME types for staff photo uploads. */
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Maximum allowed file size in bytes (5 MB). */
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

/** Supabase Storage bucket name for staff photos. */
const BUCKET = 'staff-photos';

// Service role client for storage uploads — bypasses RLS.
// Only instantiated on the server; never exposed to the browser.
const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Handles staff photo uploads. Validates, uploads, and returns the public URL.
 *
 * @param request - Incoming multipart/form-data request with a "file" field.
 * @returns 200 { url: string } — public URL of the uploaded photo.
 * @returns 400 { error: string } — validation failure.
 * @returns 401 { error: "Unauthorized" } — not authenticated.
 * @returns 500 { error: string } — upload failure.
 */
export async function POST(request: Request): Promise<Response> {
  // Step 1: Verify authentication.
  const supabase = await createServerSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Step 2: Parse the multipart form data.
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: 'Request must be multipart/form-data' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!file || !(file instanceof File)) {
    return Response.json({ error: 'A "file" field is required' }, { status: 400 });
  }

  // Step 3: Validate file type.
  if (!ALLOWED_MIME_TYPES.includes(file.type as typeof ALLOWED_MIME_TYPES[number])) {
    return Response.json(
      { error: 'Only JPEG, PNG, and WebP images are allowed' },
      { status: 400 }
    );
  }

  // Step 4: Validate file size.
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return Response.json(
      { error: 'File size must be 5 MB or less' },
      { status: 400 }
    );
  }

  // Step 5: Generate a unique file path under the user's ID to prevent collisions.
  const extension = file.type === 'image/jpeg' ? 'jpg'
    : file.type === 'image/webp' ? 'webp'
    : 'png';
  const fileName = `${session.user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;

  // Step 6: Upload to Supabase Storage using the service role key.
  const arrayBuffer = await file.arrayBuffer();
  const uint8 = new Uint8Array(arrayBuffer);

  const { error: uploadError } = await adminSupabase.storage
    .from(BUCKET)
    .upload(fileName, uint8, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    console.error('[POST /api/upload/staff-photo] upload error:', uploadError.message);
    return Response.json({ error: 'Failed to upload photo' }, { status: 500 });
  }

  // Step 7: Retrieve the public URL.
  const { data: urlData } = adminSupabase.storage.from(BUCKET).getPublicUrl(fileName);

  return Response.json({ url: urlData.publicUrl }, { status: 200 });
}
