/**
 * components/dashboard/booking-settings/StaffServices.tsx
 *
 * "Services this staff member can perform" in a staff card: a checkbox per
 * salon service and, for each ticked service, optional price and duration
 * overrides for this staff member. Ticking saves at once; an override is
 * saved when its field loses focus.
 *
 * State and handlers come from useServiceAssignments.
 */

'use client';

import type { ServiceAssignments } from '@/components/dashboard/booking-settings/useServiceAssignments';
import { MAX_DURATION_MINUTES, MIN_DURATION_MINUTES } from '@/lib/availability';
import type { Barber, Service } from '@/types';

/** Props accepted by StaffServices. */
interface StaffServicesProps {
  /** The staff member. */
  barber: Barber;
  /** All services of the salon, active and inactive. */
  salonServices: Service[];
  /** Staff service assignments and their handlers (useServiceAssignments). */
  assignments: ServiceAssignments;
  /** Display symbol of the salon's currency, e.g. "€". */
  currencySymbol: string;
}

/**
 * StaffServices renders the service checkboxes and override fields of one
 * staff member.
 *
 * @param props.barber         - The staff member.
 * @param props.salonServices  - All services of the salon.
 * @param props.assignments    - Staff service assignments and handlers.
 * @param props.currencySymbol - Currency symbol shown with prices.
 */
export default function StaffServices({ barber, salonServices, assignments, currencySymbol }: StaffServicesProps) {
  const {
    barberServiceAssignments,
    savingAssignmentsFor,
    handleToggleBarberService,
    updateBarberServiceOverride,
    runAssignmentSave,
  } = assignments;

  return (
    <div>
      <p className="text-xs font-medium text-[#8A8680] uppercase tracking-widest mb-1">
        Services this staff member can perform
      </p>
      <p className="text-xs text-[#8A8680] mb-3">
        When checked, this staff member will be available for these services.
        Optionally override the price or duration per staff member.
      </p>
      <div className="space-y-3">
        {salonServices.map((svc) => {
          const assignment = barberServiceAssignments.find(
            (ba) => ba.barber_id === barber.id && ba.service_id === svc.id
          );
          const isAssigned = !!assignment;
          return (
            <div key={svc.id} className="space-y-2">
              <label className="flex items-center gap-2.5 cursor-pointer select-none group">
                <input
                  type="checkbox"
                  checked={isAssigned}
                  onChange={(e) =>
                    handleToggleBarberService(barber.id, svc.id, e.target.checked)
                  }
                  className="h-4 w-4 rounded border-[#E5E2DB] accent-[#1B4332] cursor-pointer disabled:opacity-50"
                />
                <span className="text-sm text-[#1A1A1A] group-hover:text-[#1B4332] transition-colors">
                  {svc.name}
                </span>
              </label>

              {/* Override fields — shown only when this service is assigned to this barber */}
              {isAssigned && assignment && (
                <div className="ml-6 mt-1.5 grid grid-cols-2 gap-2 max-w-xs">
                  <div className="rounded-lg border border-[#E5E2DB] px-3 py-2 space-y-0.5 bg-[#FAFAF8]">
                    <label
                      htmlFor={`staff-${barber.id}-service-${svc.id}-price`}
                      className="block text-[10px] font-medium text-[#8A8680] uppercase tracking-wider"
                    >
                      Price
                    </label>
                    <div className="flex items-baseline gap-1">
                      <span className="text-xs text-[#8A8680]">{currencySymbol}</span>
                      <input
                        id={`staff-${barber.id}-service-${svc.id}-price`}
                        type="number"
                        min={0}
                        step={0.01}
                        value={assignment.price_override ?? ''}
                        onChange={(e) =>
                          updateBarberServiceOverride(barber.id, svc.id, 'price_override', e.target.value)
                        }
                        onBlur={() => void runAssignmentSave(barber.id)}
                        placeholder={svc.price != null ? String(svc.price) : 'Same as service'}
                        className="w-full text-sm text-[#1A1A1A] bg-transparent outline-none placeholder:text-[#C8C8C8] disabled:opacity-50"
                      />
                    </div>
                    {svc.price != null && (
                      <p className="text-[10px] text-[#C8C8C8]">Default: {currencySymbol}{svc.price}</p>
                    )}
                  </div>

                  <div className="rounded-lg border border-[#E5E2DB] px-3 py-2 space-y-0.5 bg-[#FAFAF8]">
                    <label
                      htmlFor={`staff-${barber.id}-service-${svc.id}-duration`}
                      className="block text-[10px] font-medium text-[#8A8680] uppercase tracking-wider"
                    >
                      Duration (min)
                    </label>
                    <input
                      id={`staff-${barber.id}-service-${svc.id}-duration`}
                      type="number"
                      min={MIN_DURATION_MINUTES}
                      max={MAX_DURATION_MINUTES}
                      step={1}
                      value={assignment.duration_minutes_override ?? ''}
                      onChange={(e) =>
                        updateBarberServiceOverride(barber.id, svc.id, 'duration_minutes_override', e.target.value)
                      }
                      onBlur={() => void runAssignmentSave(barber.id)}
                      placeholder={svc.duration_minutes != null ? String(svc.duration_minutes) : 'Same as service'}
                      className="w-16 text-sm text-[#1A1A1A] bg-transparent outline-none placeholder:text-[#C8C8C8] disabled:opacity-50"
                    />
                    {svc.duration_minutes != null && (
                      <p className="text-[10px] text-[#C8C8C8]">Default: {svc.duration_minutes} min</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {savingAssignmentsFor[barber.id] && (
        <p className="text-xs text-[#8A8680] mt-2">Saving…</p>
      )}
    </div>
  );
}
