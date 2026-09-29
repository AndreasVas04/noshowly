/**
 * lib/staff-photos.ts
 *
 * Which URLs a staff member's photo may have. Photos are uploaded by
 * POST /api/upload/staff-photo to the public Storage bucket STAFF_PHOTO_BUCKET,
 * under the owner's user id, and the photo is then saved with the URL Supabase
 * returns:
 *
 *   <Supabase URL>/storage/v1/object/public/staff-photos/<userId>/<file>
 *
 * PUT /api/barbers/[id] accepts a new photo URL only when it has this form for
 * the signed-in owner, so a booking page cannot show an image from another
 * site or another salon's folder.
 *
 * No imports from Next.js or Supabase, so this is safe to use anywhere.
 */

import { STAFF_PHOTO_BUCKET } from '@/lib/account';

/** A file name as the upload route writes it: letters, digits, '.', '_' and '-'. */
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Returns true when the URL is a photo in the owner's own folder of the
 * staff photo bucket, on this Supabase project.
 *
 * @param url         - The photo URL to check.
 * @param supabaseUrl - The project URL (NEXT_PUBLIC_SUPABASE_URL).
 * @param userId      - The owner's user id.
 */
export function isOwnStaffPhotoUrl(url: string, supabaseUrl: string, userId: string): boolean {
  let photo: URL;
  let project: URL;
  try {
    photo = new URL(url);
    project = new URL(supabaseUrl);
  } catch {
    return false;
  }
  if (photo.origin !== project.origin) return false;
  if (photo.username || photo.password || photo.search || photo.hash) return false;

  const folder = `/storage/v1/object/public/${STAFF_PHOTO_BUCKET}/${userId}/`;
  if (!userId || !photo.pathname.startsWith(folder)) return false;
  return FILE_NAME.test(photo.pathname.slice(folder.length));
}
