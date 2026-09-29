/**
 * components/dashboard/booking-settings/StaffCard.tsx
 *
 * One staff member's card in the Staff section: the name with its save status
 * and "Remove", the photo (click to choose and crop a new one, or remove it),
 * the name and bio fields, the services they perform (StaffServices) and their
 * weekly availability (StaffAvailability). Profile changes are auto-saved;
 * a failed save or removal shows its message under the header, with
 * "Try again" for a save, and a photo problem shows under the photo.
 */

'use client';

import { Camera } from 'lucide-react';
import { SectionCard } from '@/components/dashboard/booking-settings/controls';
import type { BarberFormState } from '@/components/dashboard/booking-settings/form-state';
import StaffAvailability from '@/components/dashboard/booking-settings/StaffAvailability';
import StaffServices from '@/components/dashboard/booking-settings/StaffServices';
import type { ServiceAssignments } from '@/components/dashboard/booking-settings/useServiceAssignments';
import type { StaffEditor } from '@/components/dashboard/booking-settings/useStaffEditor';
import type { StaffPhotos } from '@/components/dashboard/booking-settings/useStaffPhotos';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getInitials } from '@/lib/utils';
import type { Barber, Service } from '@/types';

/** Props accepted by StaffCard. */
interface StaffCardProps {
  /** The staff member. */
  barber: Barber;
  /** The staff member's form: profile fields and weekly availability as edited. */
  form: BarberFormState;
  /** Staff list and form state and handlers (useStaffEditor). */
  staff: StaffEditor;
  /** Staff photo state and handlers (useStaffPhotos). */
  photos: StaffPhotos;
  /** Staff service assignments and their handlers (useServiceAssignments). */
  assignments: ServiceAssignments;
  /** All services of the salon, active and inactive. */
  salonServices: Service[];
  /** Display symbol of the salon's currency, e.g. "€". */
  currencySymbol: string;
}

/**
 * StaffCard renders one staff member's card.
 *
 * @param props.barber         - The staff member.
 * @param props.form           - The staff member's form state.
 * @param props.staff          - Staff list and form state and handlers.
 * @param props.photos         - Staff photo state and handlers.
 * @param props.assignments    - Staff service assignments and handlers.
 * @param props.salonServices  - All services of the salon.
 * @param props.currencySymbol - Currency symbol shown with prices.
 */
export default function StaffCard({
  barber,
  form,
  staff,
  photos,
  assignments,
  salonServices,
  currencySymbol,
}: StaffCardProps) {
  const {
    barberSaveStatuses,
    deletingBarberId,
    staffErrors,
    retryBarberSave,
    registerBioTextarea,
    updateBarberField,
    handleDeleteBarber,
  } = staff;
  const {
    removingPhotoForId,
    photoErrors,
    registerPhotoInput,
    openPhotoPicker,
    handlePhotoUpload,
    handleRemovePhoto,
  } = photos;
  const isSaving = barberSaveStatuses[barber.id] === 'saving';
  const barberSaveStatus = barberSaveStatuses[barber.id] ?? 'idle';
  const isDeleting = deletingBarberId === barber.id;
  const isRemovingPhoto = removingPhotoForId === barber.id;
  const staffError = staffErrors[barber.id];
  const photoError = photoErrors[barber.id];
  const initials = getInitials(barber.name);

  return (
    <SectionCard>
      <div className="p-6 space-y-6">

        {/* Header: name + save status + remove */}
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-semibold text-[#1A1A1A] truncate">{barber.name}</p>
          <div className="flex items-center gap-3 shrink-0">
            <span className={`text-xs font-medium transition-colors ${
              barberSaveStatus === 'saving' ? 'text-[#8A8680]' :
              barberSaveStatus === 'saved'  ? 'text-emerald-600' :
              barberSaveStatus === 'error'  ? 'text-red-600' : 'invisible'
            }`}>
              {barberSaveStatus === 'saving' ? 'Saving…' : barberSaveStatus === 'error' ? 'Not saved' : 'Saved'}
            </span>
            <button
              type="button"
              onClick={() => void handleDeleteBarber(barber.id, barber.name)}
              disabled={isDeleting}
              className="text-xs text-[#8A8680] hover:text-red-600 disabled:opacity-40 transition-colors"
            >
              {isDeleting ? 'Removing…' : 'Remove'}
            </button>
          </div>
        </div>

        {staffError && (
          <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-700">
            <span>{staffError}</span>
            {barberSaveStatus === 'error' && (
              <button
                type="button"
                onClick={() => retryBarberSave(barber.id)}
                className="font-medium underline underline-offset-2 hover:text-red-900"
              >
                Try again
              </button>
            )}
          </div>
        )}

        {/* Photo upload section — clicking the circle/link opens the crop modal */}
        <div className="flex flex-col items-start gap-2">
          {/* Clickable 80px circle with camera overlay on hover */}
          <button
            type="button"
            onClick={() => openPhotoPicker(barber.id)}
            disabled={isRemovingPhoto || isSaving}
            className="group relative w-20 h-20 rounded-full overflow-hidden shrink-0 border border-[#E5E2DB]/30 bg-[#F5F3EF] flex items-center justify-center disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1A1A] focus-visible:ring-offset-2"
            aria-label="Upload photo"
          >
            {/* Photo or initials */}
            {form.photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- photos saved before uploads were required can be on any host, which next/image would have to allow-list
              <img
                src={form.photo_url}
                alt={barber.name}
                className="w-full h-full object-cover object-center"
              />
            ) : (
              <span className="text-lg font-semibold text-[#1A1A1A] select-none">
                {initials}
              </span>
            )}
            {/* Camera icon overlay — appears on hover */}
            <span className="absolute bottom-0 right-0 w-6 h-6 bg-[#1A1A1A] rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none">
              <Camera size={12} className="text-white" />
            </span>
          </button>

          {/* Text links below circle */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => openPhotoPicker(barber.id)}
              disabled={isRemovingPhoto || isSaving}
              className="text-xs text-[#1A1A1A] underline underline-offset-2 hover:text-[#2D2D2D] disabled:opacity-40 transition-colors"
            >
              Change photo
            </button>
            {form.photo_url && (
              <>
                <span className="text-[#8A8680] text-xs">·</span>
                <button
                  type="button"
                  onClick={() => void handleRemovePhoto(barber.id)}
                  disabled={isRemovingPhoto || isSaving}
                  className="text-xs text-[#8A8680] hover:text-red-600 disabled:opacity-40 transition-colors"
                >
                  {isRemovingPhoto ? 'Removing…' : 'Remove photo'}
                </button>
              </>
            )}
          </div>

          {photoError && (
            <p role="alert" className="text-xs text-red-600">{photoError}</p>
          )}

          {/* Hidden file input */}
          <input
            ref={(el) => { registerPhotoInput(barber.id, el); }}
            type="file"
            aria-label={`Photo of ${barber.name}`}
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(e) => void handlePhotoUpload(barber.id, e)}
          />
        </div>

        {/* Profile fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor={`staff-${barber.id}-name`} className="text-xs font-medium text-[#8A8680] uppercase tracking-widest">Name</Label>
            <Input
              id={`staff-${barber.id}-name`}
              value={form.name}
              onChange={(e) => updateBarberField(barber.id, 'name', e.target.value)}
              maxLength={50}
              className="border-[#E5E2DB] focus-visible:border-[#1B4332] focus-visible:ring-0 text-sm text-[#1A1A1A]"
            />
          </div>
          <div className="sm:col-span-2 space-y-1.5">
            <Label htmlFor={`staff-${barber.id}-bio`} className="text-xs font-medium text-[#8A8680] uppercase tracking-widest">Bio (optional)</Label>
            <textarea
              id={`staff-${barber.id}-bio`}
              ref={(el) => { registerBioTextarea(barber.id, el); }}
              value={form.bio}
              onChange={(e) => updateBarberField(barber.id, 'bio', e.target.value)}
              onInput={(e) => {
                e.currentTarget.style.height = 'auto';
                e.currentTarget.style.height = e.currentTarget.scrollHeight + 'px';
              }}
              placeholder="Short description shown on the booking page"
              maxLength={300}
              rows={2}
              className="w-full rounded-lg border border-[#E5E2DB] px-3 py-2 text-sm text-[#1A1A1A] placeholder:text-[#8A8680] outline-none focus:border-[#1B4332] disabled:opacity-50 resize-none overflow-hidden transition-colors"
            />
          </div>
        </div>

        {/* Services this staff member can perform */}
        {salonServices.length > 0 && (
          <StaffServices
            barber={barber}
            salonServices={salonServices}
            assignments={assignments}
            currencySymbol={currencySymbol}
          />
        )}

        {/* Weekly availability */}
        <StaffAvailability barber={barber} form={form} staff={staff} />

      </div>
    </SectionCard>
  );
}
