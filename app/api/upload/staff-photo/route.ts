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
 *  - Write access required — an ended trial or an inactive subscription is
 *    read-only (lib/access.ts).
 *  - File must be an image (image/jpeg, image/png, image/webp): the declared
 *    type is checked first, then the file's own signature (lib/image-type.ts),
 *    which decides the stored content type and extension.
 *  - Maximum file size: 5 MB.
 *
 * Files are stored under `<userId>/`; deleting the account removes that
 * folder (lib/account.ts removeStaffPhotos).
 *
 * Security:
 *  - Service role key is used server-side only to bypass RLS for storage uploads.
 *  - The content is validated before upload: a file that is not really a
 *    JPEG, PNG or WebP image (e.g. HTML or SVG renamed to .png) is rejected.
 *  - The user is verified with Supabase Auth (requireUser → getUser) before any
 *    processing, because the user ID becomes part of the storage path.
 */

import { requireUser } from '@/lib/auth';
import { requireWriteAccess } from '@/lib/access';
import { STAFF_PHOTO_BUCKET } from '@/lib/account';
import { detectImageType, IMAGE_EXTENSIONS } from '@/lib/image-type';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';

/** Allowed MIME types for staff photo uploads. */
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Maximum allowed file size in bytes (5 MB). */
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * Handles staff photo uploads. Validates, uploads, and returns the public URL.
 *
 * @param request - Incoming multipart/form-data request with a "file" field.
 * @returns 200 { url: string } — public URL of the uploaded photo.
 * @returns 400 { error: string } — validation failure (type, content or size).
 * @returns 401 { error: "Unauthorized" } — not authenticated.
 * @returns 403 { error: string, code: string } — read-only account (trial ended / inactive).
 * @returns 500 { error: string } — upload failure.
 */
export async function POST(request: Request): Promise<Response> {
  // Step 1: Verify the user with Supabase Auth.
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;

  // Step 1b: Plan check — an ended trial or an inactive subscription is read-only.
  const access = await requireWriteAccess(auth.supabase, userId);
  if (!access.ok) return access.response;

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

  // Step 5: Check the content itself: the declared type comes from the browser.
  const uint8 = new Uint8Array(await file.arrayBuffer());
  const imageType = detectImageType(uint8);
  if (!imageType) {
    return Response.json(
      { error: 'Only JPEG, PNG, and WebP images are allowed' },
      { status: 400 }
    );
  }

  // Step 6: Generate a unique file path under the user's ID to prevent collisions.
  const fileName = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${IMAGE_EXTENSIONS[imageType]}`;

  // Step 7: Upload to Supabase Storage using the service role key.
  const adminSupabase = createAdminSupabaseClient();

  const { error: uploadError } = await adminSupabase.storage
    .from(STAFF_PHOTO_BUCKET)
    .upload(fileName, uint8, {
      contentType: imageType,
      upsert: false,
    });

  if (uploadError) {
    console.error('[POST /api/upload/staff-photo] upload error:', uploadError.message);
    return Response.json({ error: 'Failed to upload photo' }, { status: 500 });
  }

  // Step 8: Retrieve the public URL.
  const { data: urlData } = adminSupabase.storage.from(STAFF_PHOTO_BUCKET).getPublicUrl(fileName);

  return Response.json({ url: urlData.publicUrl }, { status: 200 });
}
