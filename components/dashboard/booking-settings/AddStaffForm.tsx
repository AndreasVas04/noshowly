/**
 * components/dashboard/booking-settings/AddStaffForm.tsx
 *
 * The "Add staff member" form at the end of the Staff section: a name field
 * and "Add", which creates the staff member (POST /api/barbers).
 *
 * State and handlers come from useStaffEditor.
 */

'use client';

import { SectionCard } from '@/components/dashboard/booking-settings/controls';
import type { StaffEditor } from '@/components/dashboard/booking-settings/useStaffEditor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** Props accepted by AddStaffForm. */
interface AddStaffFormProps {
  /** Staff list and form state and handlers (useStaffEditor). */
  staff: StaffEditor;
}

/**
 * AddStaffForm renders the form that adds a staff member.
 *
 * @param props.staff - Staff list and form state and handlers.
 */
export default function AddStaffForm({ staff }: AddStaffFormProps) {
  const { addBarberName, setAddBarberName, addingBarber, addBarberError, setAddBarberError, handleAddBarber } = staff;

  return (
    <SectionCard>
      <form onSubmit={(e) => void handleAddBarber(e)} noValidate className="px-6 py-5">
        <label
          htmlFor="new-staff-name"
          className="block text-xs font-medium text-[#6F6B65] uppercase tracking-widest mb-3"
        >
          Add staff member
        </label>
        <div className="flex gap-3">
          <Input
            id="new-staff-name"
            type="text"
            value={addBarberName}
            onChange={(e) => { setAddBarberName(e.target.value); if (addBarberError) setAddBarberError(''); }}
            placeholder="First name, e.g. John"
            maxLength={50}
            disabled={addingBarber}
            className="flex-1 border-[#E5E2DB] focus-visible:border-[#1B4332] focus-visible:ring-0 text-[#1A1A1A] placeholder:text-[#6F6B65]"
          />
          <Button
            type="submit"
            disabled={addingBarber}
            className="bg-[#1B4332] hover:bg-[#16392A] text-white text-sm font-medium px-4 shrink-0"
          >
            {addingBarber ? 'Adding…' : 'Add'}
          </Button>
        </div>
        {addBarberError && (
          <p className="mt-2 text-sm text-red-600">{addBarberError}</p>
        )}
      </form>
    </SectionCard>
  );
}
