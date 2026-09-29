/**
 * components/dashboard/appointment-modal/StatusAndNotes.tsx
 *
 * Status select and notes of the appointment modal. The status select is
 * hidden for a cancelled appointment. Notes stay behind a "+ Add note" button
 * until it is clicked (they start open when the appointment has notes).
 */

'use client';

import type { Dispatch, SetStateAction } from 'react';
import { Label } from '@/components/ui/label';
import type { AppointmentStatus } from '@/types';
import type { FormState, SetField } from './form';
import { labelClass } from './styles';

/** Props accepted by StatusAndNotes. */
interface StatusAndNotesProps {
  /** Current form values. */
  form: FormState;
  /** True when viewing a cancelled appointment; the status select is hidden. */
  isCancelledView: boolean;
  /** Status shown in the select (in create mode, predicted until the owner picks one). */
  displayedStatus: AppointmentStatus;
  /** Marks the status as picked by the owner. */
  setStatusTouched: Dispatch<SetStateAction<boolean>>;
  /** Whether the notes field is shown. */
  showNotes: boolean;
  /** Shows or hides the notes field. */
  setShowNotes: Dispatch<SetStateAction<boolean>>;
  /** Updates a form field and clears its error. */
  setField: SetField;
}

/**
 * StatusAndNotes renders the status select and the notes field (or its "+ Add note" button).
 *
 * @param props.form             - Current form values.
 * @param props.isCancelledView  - Hides the status select for a cancelled appointment.
 * @param props.displayedStatus  - Status shown in the select.
 * @param props.setStatusTouched - Marks the status as picked.
 * @param props.showNotes        - Whether the notes field is shown.
 * @param props.setShowNotes     - Shows the notes field.
 * @param props.setField         - Updates a form field.
 */
export default function StatusAndNotes({
  form,
  isCancelledView,
  displayedStatus,
  setStatusTouched,
  showNotes,
  setShowNotes,
  setField,
}: StatusAndNotesProps) {
  return (
    <>
      {/* ---- Status ------------------------------------------------ */}
      {!isCancelledView && (
        <div className="space-y-1.5">
          <Label htmlFor="modal-status" className={labelClass}>Status</Label>
          <select
            id="modal-status"
            value={displayedStatus}
            onChange={(e) => {
              setStatusTouched(true);
              setField('appointmentStatus', e.target.value as AppointmentStatus);
            }}
            className="w-full h-10 px-3 rounded-lg border border-[#C8C8C8] bg-white text-sm text-[#1A1A1A] outline-none focus:border-[#1A1A1A] transition-colors"
          >
            <option value="scheduled">Pending (awaiting confirmation)</option>
            <option value="confirmed">Confirmed</option>
          </select>
        </div>
      )}

      {/* ---- Notes ------------------------------------------------- */}
      {!showNotes ? (
        <button
          type="button"
          onClick={() => setShowNotes(true)}
          className="text-xs text-[#C8C8C8] hover:text-[#1A1A1A] transition-colors rounded"
        >
          + Add note
        </button>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="modal-notes" className={labelClass}>Notes</Label>
          <textarea
            id="modal-notes"
            rows={2}
            value={form.notes}
            onChange={(e) => setField('notes', e.target.value)}
            placeholder="Any notes..."
            maxLength={1000}
            className="w-full px-3 py-2.5 rounded-lg border border-[#C8C8C8] bg-white text-sm text-[#1A1A1A] placeholder:text-[#C8C8C8] resize-none outline-none focus:border-[#1A1A1A] transition-colors"
          />
        </div>
      )}
    </>
  );
}
