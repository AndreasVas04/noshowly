/**
 * components/dashboard/booking-settings/PhotoCropModal.tsx
 *
 * Instagram-style crop modal for staff photos, open while a chosen photo is
 * being cropped. Full-screen dark overlay. User drags / scrolls / pinches to
 * reposition the image inside a fixed circular crop window. "Apply" crops via
 * Canvas and uploads the result. "Cancel" discards the selection.
 *
 * State and handlers come from useStaffPhotos.
 */

'use client';

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
    isDragging,
    handleCropMouseDown,
    handleCropMouseMove,
    handleCropMouseUp,
    handleCropTouchStart,
    handleCropTouchMove,
    handleCropTouchEnd,
    handleCropCancel,
    handleCropApply,
  } = photos;

  if (!cropModal) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black flex flex-col overflow-hidden"
      style={{ userSelect: 'none', touchAction: 'none' }}
      onMouseMove={handleCropMouseMove}
      onMouseUp={handleCropMouseUp}
      onMouseLeave={handleCropMouseUp}
    >
      {/* ── Image layer ─────────────────────────────────────────────────── */}
      <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
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
        className="absolute pointer-events-none"
        style={{
          width:  CIRCLE_RADIUS * 2,
          height: CIRCLE_RADIUS * 2,
          borderRadius: '50%',
          top:  '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.65)',
          border: '2px solid rgba(255,255,255,0.35)',
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
        <p className="font-body text-white/50 text-xs tracking-wide">
          Drag to reposition · scroll or pinch to zoom
        </p>
      </div>

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
