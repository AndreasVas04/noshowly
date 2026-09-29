/**
 * components/dashboard/appointment-modal/DateTimeFields.tsx
 *
 * Date and time fields of the appointment modal, entered in the salon's
 * timezone (named under the fields). The time input's min and max are the
 * salon's business hours when they are set.
 */

'use client';

import { Label } from '@/components/ui/label';
import { formatTimeZoneLabel } from '@/lib/time';
import type { BusinessHours, FieldErrors, FormState, SetField } from './form';
import { labelClass } from './styles';

/** Props accepted by DateTimeFields. */
interface DateTimeFieldsProps {
  /** Current form values. */
  form: FormState;
  /** Per-field validation messages. */
  fieldErrors: FieldErrors;
  /** True when viewing a cancelled appointment; the fields are disabled. */
  isCancelledView: boolean;
  /** Salon opening hours, or null when not configured. */
  salonHours: BusinessHours | null;
  /** Salon timezone. */
  timezone: string;
  /** Updates a form field and clears its error. */
  setField: SetField;
}

/**
 * DateTimeFields renders the date and time inputs and the timezone note.
 *
 * @param props.form            - Current form values.
 * @param props.fieldErrors     - Per-field validation messages.
 * @param props.isCancelledView - Disables the fields for a cancelled appointment.
 * @param props.salonHours      - Business hours for the time input's range.
 * @param props.timezone        - Salon timezone, named under the fields.
 * @param props.setField        - Updates a form field.
 */
export default function DateTimeFields({
  form,
  fieldErrors,
  isCancelledView,
  salonHours,
  timezone,
  setField,
}: DateTimeFieldsProps) {
  return (
    <>
      {/* ---- Date + Time ------------------------------------------ */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="modal-date" className={labelClass}>
            Date <span className="text-red-400">*</span>
          </Label>
          <div className={`rounded-lg border overflow-hidden transition-colors ${
            fieldErrors.date ? 'border-red-400' : 'border-[#C8C8C8] focus-within:border-[#1A1A1A]'
          }`}>
            <input
              id="modal-date"
              type="date"
              disabled={isCancelledView}
              value={form.date}
              onChange={(e) => setField('date', e.target.value)}
              className="w-full h-11 px-3 text-sm text-[#1A1A1A] outline-none border-none bg-transparent"
            />
          </div>
          {fieldErrors.date && <p className="text-xs text-red-600">{fieldErrors.date}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="modal-time" className={labelClass}>
            Time <span className="text-red-400">*</span>
          </Label>
          <div className={`rounded-lg border overflow-hidden transition-colors ${
            fieldErrors.time ? 'border-red-400' : 'border-[#C8C8C8] focus-within:border-[#1A1A1A]'
          }`}>
            <input
              id="modal-time"
              type="time"
              disabled={isCancelledView}
              value={form.time}
              onChange={(e) => setField('time', e.target.value)}
              min={salonHours?.opening}
              max={salonHours?.closing}
              className="w-full h-11 px-3 text-sm text-[#1A1A1A] outline-none border-none bg-transparent"
            />
          </div>
          {fieldErrors.time && <p className="text-xs text-red-600">{fieldErrors.time}</p>}
        </div>
      </div>
      <p className="text-xs text-[#6F6B65] -mt-2">Times are in {formatTimeZoneLabel(timezone)} time.</p>
    </>
  );
}
