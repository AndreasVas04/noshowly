/**
 * components/dashboard/booking-settings/PhotoCropModal.tsx
 *
 * Instagram-style crop modal for staff photos, open while a chosen photo is
 * being cropped. Full-screen dark overlay. User drags / scrolls / pinches to
 * reposition the image inside a fixed circular crop window. "Apply" crops via
 * Canvas and uploads the result; if that fails, the message is shown above
 * the buttons and Apply can be tried again. "Cancel" discards the selection.
 *
 * It is a modal dialog for the keyboard too: it takes the focus on its photo
 * area (arrow keys move, + / − zoom), keeps Tab inside, closes on Escape and
 * gives the focus back to where it was.
 *
 * State and handlers come from useStaffPhotos.
 */

'use client';

import { useEffect, useId, useRef } from 'react';
import { CIRCLE_RADIUS } from '@/components/dashboard/booking-settings/photo-crop';
import type { StaffPhotos } from '@/components/dashboard/booking-settings/useStaffPhotos';

/** Props accepted by PhotoCropModal. */
interface PhotoCropModalProps {
  /** Staff photo state and handlers (useStaffPhotos). */
  photos: StaffPhotos;
}

/**
 * PhotoCropModal renders the crop modal while a photo is being cropped, and
 * nothing otherwise.
 *
 * @param props.photos - Staff photo state and handlers.
 */
export default function PhotoCropModal({ photos }: PhotoCropModalProps) {
  const {
    cropModal,
    cropX,
    cropY,
    cropScale,
    cropUploading,
    cropError,
    isDragging,
    handleCropMouseDown,
    handleCropMouseMove,
    handleCropMouseUp,
    handleCropTouchStart,
    handleCropTouchMove,
    handleCropTouchEnd,
    handleCropKeyDown,
    handleCropCancel,
    handleCropApply,
  } = photos;

  const isOpen = cropModal !== null;
  const titleId = useId();
  const hintId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const photoAreaRef = useRef<HTMLDivElement>(null);

  // Take the focus on open; give it back (to "Change photo") on close.
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    photoAreaRef.current?.focus();
    return () => previous?.focus();
  }, [isOpen]);

  if (!cropModal) return null;

  /** Escape cancels; Tab and Shift+Tab stay inside the dialog. */
  function handleDialogKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Escape') {
      if (!cropUploading) {
        e.preventDefault();
        handleCropCancel();
      }
      return;
    }
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('[tabindex="0"], button:not([disabled])')];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 bg-black flex flex-col overflow-hidden"
      style={{ userSelect: 'none', touchAction: 'none' }}
      onMouseMove={handleCropMouseMove}
      onMouseUp={handleCropMouseUp}
      onMouseLeave={handleCropMouseUp}
      onKeyDown={handleDialogKeyDown}
    >
      <h2 id={titleId} className="sr-only">Crop photo</h2>

      {/* ── Image layer — the focusable photo area ──────────────────────── */}
      <div
        ref={photoAreaRef}
        tabIndex={0}
        role="group"
        aria-label="Photo position"
        aria-describedby={hintId}
        onKeyDown={handleCropKeyDown}
        className="peer absolute inset-0 flex items-center justify-center overflow-hidden outline-none"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- previews the chosen file from a local object URL */}
        <img
          src={cropModal.src}
          alt="Crop preview"
          draggable={false}
          onMouseDown={handleCropMouseDown}
          onTouchStart={handleCropTouchStart}
          onTouchMove={handleCropTouchMove}
          onTouchEnd={handleCropTouchEnd}
          style={{
            width: cropModal.naturalW,
            height: cropModal.naturalH,
            maxWidth: 'none',
            transform: `translate(${cropX}px, ${cropY}px) scale(${cropScale})`,
            transformOrigin: 'center',
            cursor: isDragging ? 'grabbing' : 'grab',
            touchAction: 'none',
          }}
        />
      </div>

      {/* ── Circle crop overlay ──────────────────────────────────────────
          A transparent circle sits in the center; box-shadow darkens the
          area outside it (classic Instagram technique).
      ───────────────────────────────────────────────────────────────── */}
      <div
        className="absolute pointer-events-none border-2 border-white/35 peer-focus-visible:border-white transition-colors"
        style={{
          width:  CIRCLE_RADIUS * 2,
          height: CIRCLE_RADIUS * 2,
          borderRadius: '50%',
          top:  '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.65)',
        }}
      />

      {/* ── Upload spinner — shown over everything while uploading ───────── */}
      {cropUploading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 pointer-events-none">
          <div
            className="rounded-full border-2 border-white border-t-transparent animate-spin"
            style={{ width: CIRCLE_RADIUS * 2, height: CIRCLE_RADIUS * 2 }}
          />
        </div>
      )}

      {/* ── Top hint ────────────────────────────────────────────────────── */}
      <div className="absolute top-6 left-0 right-0 flex justify-center pointer-events-none">
        <p id={hintId} className="font-body text-white/70 text-xs tracking-wide">
          Drag to reposition · scroll or pinch to zoom · arrow keys and + / − work too
        </p>
      </div>

      {/* ── Why the last Apply failed ─────────────────────────────────────── */}
      {cropError && (
        <div className="absolute bottom-24 left-0 right-0 flex justify-center px-8">
          <p role="alert" className="font-body max-w-sm rounded-lg bg-red-600/90 px-4 py-2 text-center text-sm text-white">
            {cropError}
          </p>
        </div>
      )}

      {/* ── Bottom action row ────────────────────────────────────────────── */}
      <div className="absolute bottom-8 left-0 right-0 flex items-center justify-between px-8">
        <button
          type="button"
          onClick={handleCropCancel}
          disabled={cropUploading}
          className="font-body text-white text-sm font-medium disabled:opacity-40 hover:text-white/70 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void handleCropApply()}
          disabled={cropUploading}
          className="font-body bg-white text-[#1A1A1A] text-sm font-semibold px-6 py-2.5 rounded-lg disabled:opacity-40 hover:bg-white/90 transition-colors"
        >
          {cropUploading ? 'Uploading…' : 'Apply'}
        </button>
      </div>
    </div>
  );
}
