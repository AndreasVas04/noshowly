/**
 * components/dashboard/appointment-modal/ServiceStaffFields.tsx
 *
 * Service and staff fields of the appointment modal, and the appointment
 * length they resolve to:
 *  - Service: the salon's active services (plus an edited appointment's
 *    current service), or free text when the salon has none.
 *  - Staff: required when the salon has staff. With a service selected, only
 *    staff who can perform it are listed (the current selection stays).
 *  - "Duration: N min": the length the server will store.
 */

'use client';

import type { Dispatch, SetStateAction } from 'react';
import { Label } from '@/components/ui/label';
import { isBarberEligibleForService } from '@/lib/availability';
import type { Barber, BarberService, Service } from '@/types';
import { CURRENT_SERVICE_OPTION, type FieldErrors, type FormState, type SetField } from './form';
import { labelClass } from './styles';

/** Props accepted by ServiceStaffFields. */
interface ServiceStaffFieldsProps {
  /** Current form values. */
  form: FormState;
  /** Per-field validation messages. */
  fieldErrors: FieldErrors;
  /** True when viewing a cancelled appointment; the fields are disabled. */
  isCancelledView: boolean;
  /** Whether the salon's services are still loading. */
  isLoadingServices: boolean;
  /** The salon's services (active and inactive). */
  services: Service[];
  /** The selected salon service, when the form's service is one. */
  selectedService: Service | null;
  /** Whether the staff list is still loading. */
  isLoadingBarbers: boolean;
  /** Active staff, plus the appointment's current staff member when editing. */
  selectableBarbers: Barber[];
  /** Staff/service assignments, for the staff members eligible for a service. */
  barberServices: BarberService[];
  /** Appointment length in minutes, as the server will resolve it. */
  resolvedDuration: number;
  /** Handles a service selection from the dropdown. */
  handleServiceChange: (value: string) => void;
  /** Sets the form state (free-text service). */
  setForm: Dispatch<SetStateAction<FormState>>;
  /** Updates a form field and clears its error. */
  setField: SetField;
}

/**
 * ServiceStaffFields renders the service and staff fields and the duration.
 *
 * @param props.form                - Current form values.
 * @param props.fieldErrors         - Per-field validation messages.
 * @param props.isCancelledView     - Disables the fields for a cancelled appointment.
 * @param props.isLoadingServices   - Shows a placeholder while services load.
 * @param props.services            - The salon's services.
 * @param props.selectedService     - The selected salon service, if any.
 * @param props.isLoadingBarbers    - Disables the staff select while staff load.
 * @param props.selectableBarbers   - Staff the owner can pick from.
 * @param props.barberServices      - Staff/service assignments.
 * @param props.resolvedDuration    - Appointment length in minutes.
 * @param props.handleServiceChange - Handles a service selection.
 * @param props.setForm             - Sets the form state.
 * @param props.setField            - Updates a form field.
 */
export default function ServiceStaffFields({
  form,
  fieldErrors,
  isCancelledView,
  isLoadingServices,
  services,
  selectedService,
  isLoadingBarbers,
  selectableBarbers,
  barberServices,
  resolvedDuration,
  handleServiceChange,
  setForm,
  setField,
}: ServiceStaffFieldsProps) {
  /** Active services, plus the edited appointment's service when it is inactive. */
  const selectableServices = services.filter((s) => s.active || s.id === selectedService?.id);

  // Staff dropdown: when a service is selected, only staff eligible for it
  // (if the service has barber_services rows, only those staff members). The
  // current selection always stays listed so the select never shows another name.
  const filteredBarbers = selectedService
    ? selectableBarbers.filter(
        (b) => b.id === form.barberId || isBarberEligibleForService(selectedService.id, b.id, barberServices)
      )
    : selectableBarbers;

  // Whether the staff dropdown is filtered to a subset of barbers.
  const staffFiltered = filteredBarbers.length < selectableBarbers.length && selectableBarbers.length > 0;

  /**
   * Value of the service select: the selected service (in edit mode, the one
   * matching the stored name), the stored free-text name, or none.
   */
  const serviceSelectValue = selectedService?.id ?? (form.serviceType ? CURRENT_SERVICE_OPTION : '');

  return (
    <>
      {/* ---- Service + Staff -------------------------------------- */}
      <div className="grid grid-cols-2 gap-3">
        {/* Service */}
        <div className="space-y-1.5">
          <Label htmlFor="modal-service" className={labelClass}>Service</Label>
          {isLoadingServices ? (
            <div className="w-full h-10 px-3 rounded-lg border border-[#C8C8C8] bg-[#F9F9F9] text-sm text-[#C8C8C8] flex items-center">
              Loading…
            </div>
          ) : services.length > 0 ? (
            <select
              id="modal-service"
              value={serviceSelectValue}
              disabled={isCancelledView}
              onChange={(e) => handleServiceChange(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-[#C8C8C8] bg-white text-sm text-[#1A1A1A] outline-none focus:border-[#1A1A1A] transition-colors"
            >
              <option value="">Select (optional)</option>
              {serviceSelectValue === CURRENT_SERVICE_OPTION && (
                <option value={CURRENT_SERVICE_OPTION}>{form.serviceType}</option>
              )}
              {selectableServices.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          ) : (
            <input
              id="modal-service"
              type="text"
              value={form.serviceType}
              disabled={isCancelledView}
              onChange={(e) => setForm((prev) => ({ ...prev, serviceId: '', serviceType: e.target.value }))}
              placeholder="e.g. Haircut (optional)"
              maxLength={100}
              className="w-full h-10 px-3 rounded-lg border border-[#C8C8C8] bg-white text-sm text-[#1A1A1A] outline-none focus:border-[#1A1A1A] transition-colors"
            />
          )}
        </div>

        {/* Staff — required when barbers exist; filtered by service assignment */}
        <div className="space-y-1.5">
          <Label htmlFor="modal-staff" className={labelClass}>
            {selectableBarbers.length > 0
              ? 'Staff'
              : <span>Staff <span className="text-xs font-normal text-[#C8C8C8]">(optional)</span></span>
            }
          </Label>
          <select
            id="modal-staff"
            value={form.barberId}
            onChange={(e) => setField('barberId', e.target.value)}
            disabled={isLoadingBarbers || isCancelledView}
            className="w-full h-10 px-3 rounded-lg border border-[#C8C8C8] bg-white text-sm text-[#1A1A1A] outline-none focus:border-[#1A1A1A] disabled:opacity-60 transition-colors"
          >
            {/* Placeholder keeps the select honest while no staff member is chosen. */}
            {selectableBarbers.length === 0
              ? <option value="">No staff assigned</option>
              : <option value="" disabled>Select staff…</option>}
            {filteredBarbers.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          {staffFiltered && (
            <p className="text-xs text-[#8A8680]">
              Showing {filteredBarbers.length} of {selectableBarbers.length} staff for this service.
            </p>
          )}
          {fieldErrors.barberId && (
            <p className="text-xs text-red-600">{fieldErrors.barberId}</p>
          )}
        </div>
      </div>
      <p className="text-xs text-[#8A8680] -mt-2">Duration: {resolvedDuration} min</p>
    </>
  );
}
