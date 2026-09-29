/**
 * components/dashboard/booking-settings/useStaffPhotos.ts
 *
 * State and handlers for staff photos on the booking settings page (StaffCard,
 * PhotoCropModal):
 *  - Choosing a file opens the Instagram-style crop modal: drag to
 *    reposition, scroll or pinch to zoom; from the keyboard, the arrow keys
 *    move and + / − zoom.
 *  - "Apply" crops the circle to a square JPEG, uploads it
 *    (POST /api/upload/staff-photo) and saves the new photo URL straight away
 *    (PUT /api/barbers/[id]), outside the profile auto-save.
 *  - "Remove photo" clears the photo URL (PUT /api/barbers/[id]).
 * A file that cannot be read or a failed removal shows its message in the
 * staff member's card (photoErrors); a failed upload shows it in the crop
 * modal (cropError), which stays open so Apply can be tried again.
 */

'use client';

import { useState, useEffect, useRef, ChangeEvent } from 'react';
import {
  CIRCLE_RADIUS,
  clampCropPos,
  CROP_OUTPUT_SIZE,
  getCropMinScale,
  getTouchDist,
} from '@/components/dashboard/booking-settings/photo-crop';
import { responseError } from '@/lib/utils';

/** State for the Instagram-style photo crop modal. */
type CropModalState = {
  barberId: string;
  /** Object URL created from the selected File. Must be revoked on close. */
  src: string;
  naturalW: number;
  naturalH: number;
};

/**
 * Owns the staff photo file inputs, photo removal and the crop modal.
 *
 * @param updateBarberField - Updates a field of a staff member's form
 *   (useStaffEditor); shows the new or removed photo once it is saved.
 * @returns The state and handlers used by StaffCard and PhotoCropModal.
 */
export function useStaffPhotos(
  updateBarberField: (barberId: string, field: 'name' | 'photo_url' | 'bio', value: string) => void,
) {
  /** Photo remove state: barberId whose photo is being removed, or null. */
  const [removingPhotoForId, setRemovingPhotoForId] = useState<string | null>(null);
  /** Per staff member: why the chosen file could not be used or the photo not removed. */
  const [photoErrors, setPhotoErrors] = useState<Record<string, string>>({});
  const photoInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // ── Crop modal ──────────────────────────────────────────────────────────────
  /** Non-null when the crop modal is open. */
  const [cropModal, setCropModal] = useState<CropModalState | null>(null);
  /** Image offset from the crop circle center (px, in rendered/screen space). */
  const [cropX, setCropX] = useState(0);
  const [cropY, setCropY] = useState(0);
  /** Current zoom scale multiplier. */
  const [cropScale, setCropScale] = useState(1);
  /** True while the cropped image is being uploaded. */
  const [cropUploading, setCropUploading] = useState(false);
  /** Why the last Apply failed; shown in the crop modal. */
  const [cropError, setCropError] = useState('');
  /** True while the user is actively dragging the image. */
  const [isDragging, setIsDragging] = useState(false);

  /**
   * Ref mirror of crop position/scale — kept in sync with state so the
   * non-passive wheel handler and the canvas export can read latest values
   * without stale closures.
   */
  const cropXRef = useRef(0);
  const cropYRef = useRef(0);
  const cropScaleRef = useRef(1);

  /** Active mouse/touch drag start snapshot. */
  const dragRef = useRef<{
    startMouseX: number; startMouseY: number;
    startCropX: number;  startCropY: number;
  } | null>(null);

  /** Active pinch-zoom start snapshot. */
  const pinchRef = useRef<{
    startDist: number; startScale: number;
    startCropX: number; startCropY: number;
  } | null>(null);

  /**
   * Stores the hidden photo file input of a staff member, or clears it with
   * null. Used as the input's ref callback.
   *
   * @param barberId - UUID of the barber.
   * @param el       - The file input, or null.
   */
  function registerPhotoInput(barberId: string, el: HTMLInputElement | null): void {
    photoInputRefs.current[barberId] = el;
  }

  /**
   * Shows a photo message in a staff member's card, or clears it with null.
   *
   * @param barberId - UUID of the barber.
   * @param message  - What went wrong, or null.
   */
  function setPhotoError(barberId: string, message: string | null): void {
    setPhotoErrors((prev) => {
      if (message === null) {
        if (!(barberId in prev)) return prev;
        const next = { ...prev };
        delete next[barberId];
        return next;
      }
      return { ...prev, [barberId]: message };
    });
  }

  /**
   * Opens the file picker of a staff member's photo input.
   *
   * @param barberId - UUID of the barber.
   */
  function openPhotoPicker(barberId: string): void {
    photoInputRefs.current[barberId]?.click();
  }

  /**
   * Handles photo file selection — loads the file into the crop modal instead
   * of uploading directly. The actual upload happens in handleCropApply.
   *
   * @param barberId - UUID of the barber whose photo is being uploaded.
   * @param e        - File input change event.
   */
  async function handlePhotoUpload(barberId: string, e: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    if (!file) return;

    // Always reset the input immediately so the same file can be re-selected.
    const input = photoInputRefs.current[barberId];
    if (input) input.value = '';
    setPhotoError(barberId, null);

    // Create an object URL and load the image to obtain natural dimensions.
    const src = URL.createObjectURL(file);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = src;
      });

      const nW = img.naturalWidth;
      const nH = img.naturalHeight;
      // Initial scale: smallest value that makes the image fully cover the circle.
      const minS = Math.max((CIRCLE_RADIUS * 2) / nW, (CIRCLE_RADIUS * 2) / nH);

      // Sync refs before opening modal so wheel/canvas handlers read fresh values.
      cropXRef.current = 0;
      cropYRef.current = 0;
      cropScaleRef.current = minS;

      setCropX(0);
      setCropY(0);
      setCropScale(minS);
      setCropError('');
      setCropModal({ barberId, src, naturalW: nW, naturalH: nH });
    } catch {
      URL.revokeObjectURL(src);
      setPhotoError(barberId, 'Could not read the selected image. Please choose a JPEG, PNG or WebP photo.');
    }
  }

  /**
   * Removes the photo for a staff member via PUT /api/barbers/[id] with photo_url: null.
   * Updates the avatar in the form state immediately on success.
   *
   * @param barberId - UUID of the barber whose photo should be removed.
   */
  async function handleRemovePhoto(barberId: string): Promise<void> {
    setPhotoError(barberId, null);
    setRemovingPhotoForId(barberId);
    try {
      const res = await fetch(`/api/barbers/${barberId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photo_url: null }),
      });

      if (!res.ok) {
        setPhotoError(barberId, await responseError(res, 'Failed to remove photo. Please try again.'));
        return;
      }

      // Clear photo from form state so the avatar reverts to initials immediately.
      updateBarberField(barberId, 'photo_url', '');
    } catch {
      setPhotoError(barberId, 'Something went wrong. Please check your connection and try again.');
    } finally {
      setRemovingPhotoForId(null);
    }
  }

  // ── Crop modal helpers ─────────────────────────────────────────────────────

  /** Mouse down on the image — begin drag. */
  function handleCropMouseDown(e: React.MouseEvent): void {
    e.preventDefault();
    dragRef.current = {
      startMouseX: e.clientX, startMouseY: e.clientY,
      startCropX: cropXRef.current, startCropY: cropYRef.current,
    };
    setIsDragging(true);
  }

  /** Mouse move on the modal backdrop — update drag position. */
  function handleCropMouseMove(e: React.MouseEvent): void {
    if (!dragRef.current || !cropModal) return;
    const dx = e.clientX - dragRef.current.startMouseX;
    const dy = e.clientY - dragRef.current.startMouseY;
    const clamped = clampCropPos(
      dragRef.current.startCropX + dx,
      dragRef.current.startCropY + dy,
      cropScaleRef.current,
      cropModal.naturalW,
      cropModal.naturalH,
    );
    cropXRef.current = clamped.x;
    cropYRef.current = clamped.y;
    setCropX(clamped.x);
    setCropY(clamped.y);
  }

  /** Mouse up / leave — end drag. */
  function handleCropMouseUp(): void {
    dragRef.current = null;
    setIsDragging(false);
  }

  /** Touch start — begin single-finger drag or two-finger pinch. */
  function handleCropTouchStart(e: React.TouchEvent): void {
    e.preventDefault();
    if (e.touches.length === 1) {
      dragRef.current = {
        startMouseX: e.touches[0].clientX, startMouseY: e.touches[0].clientY,
        startCropX: cropXRef.current, startCropY: cropYRef.current,
      };
      setIsDragging(true);
    } else if (e.touches.length === 2) {
      // Switch from drag to pinch.
      dragRef.current = null;
      setIsDragging(false);
      pinchRef.current = {
        startDist: getTouchDist(e.touches),
        startScale: cropScaleRef.current,
        startCropX: cropXRef.current,
        startCropY: cropYRef.current,
      };
    }
  }

  /** Touch move — update drag or pinch. */
  function handleCropTouchMove(e: React.TouchEvent): void {
    e.preventDefault();
    if (!cropModal) return;
    const { naturalW, naturalH } = cropModal;

    if (e.touches.length === 1 && dragRef.current) {
      const dx = e.touches[0].clientX - dragRef.current.startMouseX;
      const dy = e.touches[0].clientY - dragRef.current.startMouseY;
      const clamped = clampCropPos(
        dragRef.current.startCropX + dx,
        dragRef.current.startCropY + dy,
        cropScaleRef.current,
        naturalW,
        naturalH,
      );
      cropXRef.current = clamped.x;
      cropYRef.current = clamped.y;
      setCropX(clamped.x);
      setCropY(clamped.y);
    } else if (e.touches.length === 2 && pinchRef.current) {
      const { startDist, startScale, startCropX, startCropY } = pinchRef.current;
      const minS = getCropMinScale(naturalW, naturalH);
      const newScale = Math.max(minS, Math.min(4, startScale * (getTouchDist(e.touches) / startDist)));
      const clamped = clampCropPos(startCropX, startCropY, newScale, naturalW, naturalH);
      cropScaleRef.current = newScale;
      cropXRef.current = clamped.x;
      cropYRef.current = clamped.y;
      setCropScale(newScale);
      setCropX(clamped.x);
      setCropY(clamped.y);
    }
  }

  /**
   * Keyboard control of the crop, on the focusable photo area: the arrow keys
   * move the photo 10 px (50 px with Shift), + and − zoom in and out. The
   * photo always keeps covering the circle.
   */
  function handleCropKeyDown(e: React.KeyboardEvent): void {
    if (!cropModal || cropUploading) return;
    const step = e.shiftKey ? 50 : 10;
    let x = cropXRef.current;
    let y = cropYRef.current;
    let scale = cropScaleRef.current;
    switch (e.key) {
      case 'ArrowLeft':  x -= step; break;
      case 'ArrowRight': x += step; break;
      case 'ArrowUp':    y -= step; break;
      case 'ArrowDown':  y += step; break;
      case '+': case '=': scale *= 1.08; break;
      case '-': case '_': scale *= 0.92; break;
      default: return;
    }
    e.preventDefault();
    const { naturalW, naturalH } = cropModal;
    scale = Math.max(getCropMinScale(naturalW, naturalH), Math.min(4, scale));
    const clamped = clampCropPos(x, y, scale, naturalW, naturalH);
    cropScaleRef.current = scale;
    cropXRef.current = clamped.x;
    cropYRef.current = clamped.y;
    setCropScale(scale);
    setCropX(clamped.x);
    setCropY(clamped.y);
  }

  /** Touch end — stop drag / pinch. */
  function handleCropTouchEnd(): void {
    dragRef.current = null;
    pinchRef.current = null;
    setIsDragging(false);
  }

  /** Cancel: revoke the object URL and close the modal. */
  function handleCropCancel(): void {
    if (cropModal) URL.revokeObjectURL(cropModal.src);
    setCropModal(null);
    setCropError('');
    setIsDragging(false);
    dragRef.current = null;
    pinchRef.current = null;
  }

  /**
   * Apply: uses Canvas API to crop the image to the visible circle area,
   * converts to JPEG blob (quality 0.9), and uploads via POST /api/upload/staff-photo.
   * Uses ref values for position/scale to guarantee latest values at call time.
   */
  async function handleCropApply(): Promise<void> {
    if (!cropModal) return;
    setCropUploading(true);
    setCropError('');

    try {
      const { src, naturalW, naturalH, barberId } = cropModal;

      // Create output canvas and clip to circle.
      const canvas = document.createElement('canvas');
      canvas.width = CROP_OUTPUT_SIZE;
      canvas.height = CROP_OUTPUT_SIZE;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D context unavailable');

      ctx.beginPath();
      ctx.arc(CROP_OUTPUT_SIZE / 2, CROP_OUTPUT_SIZE / 2, CROP_OUTPUT_SIZE / 2, 0, Math.PI * 2);
      ctx.clip();

      // Load the source image (same object URL — already decoded in browser).
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Image re-load failed'));
        img.src = src;
      });

      // Compute which rectangle in original image pixels the circle shows.
      // The circle center sits at viewport center = (0, 0) in our coord system.
      // Image center is offset by (cropX, cropY) from viewport center.
      // In original image pixels: circle center is at
      //   (naturalW/2 - posX/scale,  naturalH/2 - posY/scale)
      // and circle radius is CIRCLE_RADIUS/scale original pixels.
      const scale = cropScaleRef.current;
      const posX  = cropXRef.current;
      const posY  = cropYRef.current;
      const srcRadius  = CIRCLE_RADIUS / scale;
      const srcCenterX = naturalW / 2 - posX / scale;
      const srcCenterY = naturalH / 2 - posY / scale;

      ctx.drawImage(
        img,
        srcCenterX - srcRadius, srcCenterY - srcRadius, // source x, y
        srcRadius * 2,          srcRadius * 2,           // source w, h
        0, 0,                                            // dest x, y
        CROP_OUTPUT_SIZE,       CROP_OUTPUT_SIZE,        // dest w, h
      );

      // Export as JPEG blob at 90 % quality.
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))),
          'image/jpeg',
          0.9,
        );
      });

      // Upload.
      const formData = new FormData();
      formData.append('file', blob, 'photo.jpg');

      const res = await fetch('/api/upload/staff-photo', { method: 'POST', body: formData });
      if (!res.ok) {
        setCropError(await responseError(res, 'Failed to upload photo. Please try again.'));
        return;
      }

      const { url } = (await res.json()) as { url: string };

      // Persist the new photo_url to the database immediately via PUT /api/barbers/[id].
      // This is done here directly rather than via the debounce scheduler because
      // photo_url changes come from a discrete action (crop + upload), not continuous
      // text edits. The debounce scheduler skips photo_url for this reason.
      const saveRes = await fetch(`/api/barbers/${barberId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photo_url: url }),
      });

      if (!saveRes.ok) {
        setCropError(await responseError(saveRes, 'Photo uploaded but failed to save. Please try again.'));
        return;
      }

      // Update local state only after DB confirm — keeps UI in sync with reality.
      updateBarberField(barberId, 'photo_url', url);
      setPhotoError(barberId, null);
      URL.revokeObjectURL(src);
      setCropModal(null);
    } catch (err) {
      console.error('[CropModal] handleCropApply error:', err);
      setCropError('Something went wrong while cropping. Please check your connection and try again.');
    } finally {
      setCropUploading(false);
    }
  }

  /**
   * Non-passive wheel listener — attached when the crop modal is open.
   * React's synthetic onWheel is passive and cannot call preventDefault,
   * so we use a native listener here.
   */
  useEffect(() => {
    if (!cropModal) return;

    function onWheel(e: WheelEvent): void {
      e.preventDefault();
      const { naturalW, naturalH } = cropModal!;
      const minS = Math.max((CIRCLE_RADIUS * 2) / naturalW, (CIRCLE_RADIUS * 2) / naturalH);
      // Scroll down = zoom out, scroll up = zoom in, ~8 % per tick.
      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      const newScale = Math.max(minS, Math.min(4, cropScaleRef.current * factor));
      const clamped = {
        x: Math.max(
          -(Math.max(0, (naturalW * newScale) / 2 - CIRCLE_RADIUS)),
          Math.min(Math.max(0, (naturalW * newScale) / 2 - CIRCLE_RADIUS), cropXRef.current),
        ),
        y: Math.max(
          -(Math.max(0, (naturalH * newScale) / 2 - CIRCLE_RADIUS)),
          Math.min(Math.max(0, (naturalH * newScale) / 2 - CIRCLE_RADIUS), cropYRef.current),
        ),
      };
      cropScaleRef.current = newScale;
      cropXRef.current = clamped.x;
      cropYRef.current = clamped.y;
      setCropScale(newScale);
      setCropX(clamped.x);
      setCropY(clamped.y);
    }

    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, [cropModal]);

  // Keep refs in sync with state so handlers always read the latest values.
  useEffect(() => { cropXRef.current = cropX; },     [cropX]);
  useEffect(() => { cropYRef.current = cropY; },     [cropY]);
  useEffect(() => { cropScaleRef.current = cropScale; }, [cropScale]);

  return {
    removingPhotoForId,
    photoErrors,
    registerPhotoInput,
    openPhotoPicker,
    cropModal,
    cropX,
    cropY,
    cropScale,
    cropUploading,
    cropError,
    isDragging,
    handlePhotoUpload,
    handleRemovePhoto,
    handleCropMouseDown,
    handleCropMouseMove,
    handleCropMouseUp,
    handleCropTouchStart,
    handleCropTouchMove,
    handleCropTouchEnd,
    handleCropKeyDown,
    handleCropCancel,
    handleCropApply,
  };
}

/** State and handlers returned by useStaffPhotos. */
export type StaffPhotos = ReturnType<typeof useStaffPhotos>;
