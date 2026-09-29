/**
 * components/dashboard/booking-settings/photo-crop.ts
 *
 * Geometry of the staff photo crop modal (PhotoCropModal, useStaffPhotos):
 * the size of the circular crop window and of the exported image, the
 * smallest zoom at which the image still covers the circle, keeping the image
 * over the whole circle while it is moved, and the finger distance used for
 * pinch-zoom.
 *
 * No imports from Next.js or Supabase, so this is safe to use anywhere.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Radius of the circular crop overlay in CSS pixels. */
export const CIRCLE_RADIUS = 140;

/** Output canvas size (square, in pixels) for the cropped JPEG. */
export const CROP_OUTPUT_SIZE = 400;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the minimum crop scale at which the image fully covers the circle.
 * Both axes must cover CIRCLE_RADIUS * 2.
 */
export function getCropMinScale(nW: number, nH: number): number {
  return Math.max((CIRCLE_RADIUS * 2) / nW, (CIRCLE_RADIUS * 2) / nH);
}

/**
 * Clamps (x, y) so the rendered image always fully covers the crop circle.
 * The image must not expose background outside its edges inside the circle.
 */
export function clampCropPos(x: number, y: number, scale: number, nW: number, nH: number) {
  const maxX = Math.max(0, (nW * scale) / 2 - CIRCLE_RADIUS);
  const maxY = Math.max(0, (nH * scale) / 2 - CIRCLE_RADIUS);
  return {
    x: Math.max(-maxX, Math.min(maxX, x)),
    y: Math.max(-maxY, Math.min(maxY, y)),
  };
}

/** Returns Euclidean distance between two touch points. */
export function getTouchDist(touches: React.TouchList): number {
  return Math.hypot(
    touches[0].clientX - touches[1].clientX,
    touches[0].clientY - touches[1].clientY,
  );
}
