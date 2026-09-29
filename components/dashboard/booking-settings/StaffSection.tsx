/**
 * components/dashboard/booking-settings/StaffSection.tsx
 *
 * Section 3 of the booking settings page: the team. One StaffCard per staff
 * member (photo, profile, services, weekly availability), then the form to
 * add a staff member (AddStaffForm).
 *
 * State and handlers come from useStaffEditor, useStaffPhotos and
 * useServiceAssignments.
 */

'use client';

import AddStaffForm from '@/components/dashboard/booking-settings/AddStaffForm';
import { SectionCard } from '@/components/dashboard/booking-settings/controls';
import StaffCard from '@/components/dashboard/booking-settings/StaffCard';
import type { ServiceAssignments } from '@/components/dashboard/booking-settings/useServiceAssignments';
import type { StaffEditor } from '@/components/dashboard/booking-settings/useStaffEditor';
import type { StaffPhotos } from '@/components/dashboard/booking-settings/useStaffPhotos';
import type { Service } from '@/types';

/** Props accepted by StaffSection. */
interface StaffSectionProps {
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
 * StaffSection renders the "Staff" section: a card per staff member whose
 * form is loaded, then the add form.
 *
 * @param props.staff          - Staff list and form state and handlers.
 * @param props.photos         - Staff photo state and handlers.
 * @param props.assignments    - Staff service assignments and handlers.
 * @param props.salonServices  - All services of the salon.
 * @param props.currencySymbol - Currency symbol shown with prices.
 */
export default function StaffSection({
  staff,
  photos,
  assignments,
  salonServices,
  currencySymbol,
}: StaffSectionProps) {
  const { barbers, barberForms } = staff;

  return (
    <section>
      <h2 className="font-heading text-base font-semibold text-[#1A1A1A] mb-1">Staff</h2>
      <p className="text-sm text-[#8A8680] mb-4">
        Add your team members. For each person, set the services they offer and
        their working hours so clients only see available slots.
      </p>

      <div className="space-y-4">

        {barbers.length === 0 && (
          <SectionCard>
            <div className="px-6 py-10 text-center">
              <p className="text-sm text-[#8A8680]">No staff members yet. Add your first staff member below.</p>
            </div>
          </SectionCard>
        )}

        {barbers.map((barber) => {
          const form = barberForms[barber.id];
          if (!form) return null;

          return (
            <StaffCard
              key={barber.id}
              barber={barber}
              form={form}
              staff={staff}
              photos={photos}
              assignments={assignments}
              salonServices={salonServices}
              currencySymbol={currencySymbol}
            />
          );
        })}

        {/* Add staff member form */}
        <AddStaffForm staff={staff} />

      </div>
    </section>
  );
}
