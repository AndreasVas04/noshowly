/**
 * components/dashboard/booking-settings/StaffAvailability.tsx
 *
 * "Weekly availability" in a staff card: a row per day (Mon–Sun) with an
 * on/off switch, the working hours and any number of breaks ("+ Add break",
 * "× Remove break", "Apply to all days"). A break that would have no effect
 * is flagged, and a day with impossible hours holds back the auto-save with a
 * message.
 *
 * State and handlers come from useStaffEditor.
 */

'use client';

import { SmallToggle } from '@/components/dashboard/booking-settings/controls';
import {
  isBreakIgnored,
  makeDefaultDayState,
  WEEK_DAYS,
  type BarberFormState,
} from '@/components/dashboard/booking-settings/form-state';
import type { StaffEditor } from '@/components/dashboard/booking-settings/useStaffEditor';
import type { Barber } from '@/types';

/** Props accepted by StaffAvailability. */
interface StaffAvailabilityProps {
  /** The staff member. */
  barber: Barber;
  /** The staff member's form: profile fields and weekly availability as edited. */
  form: BarberFormState;
  /** Staff list and form state and handlers (useStaffEditor). */
  staff: StaffEditor;
}

/**
 * StaffAvailability renders the weekly availability editor of one staff member.
 *
 * @param props.barber - The staff member.
 * @param props.form   - The staff member's form state.
 * @param props.staff  - Staff list and form state and handlers.
 */
export default function StaffAvailability({ barber, form, staff }: StaffAvailabilityProps) {
  const {
    availabilityErrors,
    setDayAvailable,
    setWorkTime,
    setBreakTime,
    addBreak,
    removeBreak,
    copyBreakToAllDays,
  } = staff;

  return (
    <div>
      <p className="text-xs font-medium text-[#6F6B65] uppercase tracking-widest mb-3">
        Weekly availability
      </p>
      {availabilityErrors[barber.id] && (
        <p role="alert" className="text-xs text-red-600 mb-3">
          {availabilityErrors[barber.id]} Changes are saved once this is fixed.
        </p>
      )}
      <div className="space-y-2">
        {WEEK_DAYS.map(({ label, value: dow }) => {
          const day = form.availability[dow] ?? makeDefaultDayState(dow);
          return (
            <div
              key={dow}
              className={`rounded-xl border px-4 py-3 transition-colors ${
                day.is_available ? 'border-[#E5E2DB]/40 bg-white' : 'border-[#E5E2DB]/20 bg-[#F9F9F9]'
              }`}
            >
              <div className="flex flex-col gap-2">
                {/* Day label + toggle — own row */}
                <div className="flex items-center gap-2">
                  <SmallToggle
                    checked={day.is_available}
                    onChange={(v) => setDayAvailable(barber.id, dow, v)}
                    label={`${label} availability`}
                  />
                  <span className={`text-xs font-medium ${day.is_available ? 'text-[#1A1A1A]' : 'text-[#6F6B65]'}`}>
                    {label}
                  </span>
                  {!day.is_available && (
                    <span className="text-xs text-[#6F6B65] ml-1">Not available</span>
                  )}
                </div>

                {day.is_available && (
                  <div className="pl-2 space-y-2">
                    {/* Working hours section */}
                    <div>
                      <p className="text-xs text-[#6F6B65] font-medium mb-1">Working hours</p>
                      <div className="flex flex-row items-center gap-1.5">
                        <input
                          type="time"
                          aria-label={`${label} start time`}
                          value={day.work_start}
                          onChange={(e) => setWorkTime(barber.id, dow, 'work_start', e.target.value)}
                          style={{ width: '110px' }}
                          className="h-8 rounded-lg border border-[#E5E2DB] px-2 text-xs text-[#1A1A1A] outline-none focus:border-[#1B4332] disabled:opacity-50 transition-colors"
                        />
                        <span className="text-xs text-[#6F6B65] shrink-0">to</span>
                        <input
                          type="time"
                          aria-label={`${label} end time`}
                          value={day.work_end}
                          onChange={(e) => setWorkTime(barber.id, dow, 'work_end', e.target.value)}
                          style={{ width: '110px' }}
                          className="h-8 rounded-lg border border-[#E5E2DB] px-2 text-xs text-[#1A1A1A] outline-none focus:border-[#1B4332] disabled:opacity-50 transition-colors"
                        />
                      </div>
                    </div>

                    {/* Break section — supports multiple breaks */}
                    <div className="space-y-2 mt-1">
                      {day.breaks.map((brk, i) => (
                        <div key={i} className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 space-y-1.5">
                          <p className="text-xs text-amber-700 font-medium">Break {day.breaks.length > 1 ? i + 1 : ''}</p>
                          <div className="flex flex-row items-center gap-1.5">
                            <input
                              type="time"
                              aria-label={`${label} break ${i + 1} start time`}
                              value={brk.start}
                              onChange={(e) => setBreakTime(barber.id, dow, i, 'start', e.target.value)}
                              style={{ width: '110px' }}
                              className="h-8 rounded-lg border border-[#E5E2DB] px-2 text-xs text-[#1A1A1A] outline-none focus:border-[#1B4332] disabled:opacity-50 transition-colors"
                            />
                            <span className="text-xs text-[#6F6B65] shrink-0">to</span>
                            <input
                              type="time"
                              aria-label={`${label} break ${i + 1} end time`}
                              value={brk.end}
                              onChange={(e) => setBreakTime(barber.id, dow, i, 'end', e.target.value)}
                              style={{ width: '110px' }}
                              className="h-8 rounded-lg border border-[#E5E2DB] px-2 text-xs text-[#1A1A1A] outline-none focus:border-[#1B4332] disabled:opacity-50 transition-colors"
                            />
                          </div>
                          {isBreakIgnored(day, brk) && (
                            <p className="text-xs text-amber-700">
                              Not saved: a break must end after it starts and fall within working hours.
                            </p>
                          )}
                          <div className="flex items-center gap-3 pt-0.5">
                            <button
                              type="button"
                              onClick={() => removeBreak(barber.id, dow, i)}
                              className="text-xs text-amber-700 hover:text-amber-900 transition-colors"
                            >
                              × Remove break
                            </button>
                            {i === day.breaks.length - 1 && (
                              <button
                                type="button"
                                onClick={() => copyBreakToAllDays(barber.id, dow)}
                                className="text-xs text-[#6F6B65] hover:text-[#1A1A1A] transition-colors"
                              >
                                Apply to all days
                              </button>
                            )}
                          </div>
                        </div>
                      ))}

                      {/* "+ Add break" is always visible when the day is available */}
                      <button
                        type="button"
                        onClick={() => addBreak(barber.id, dow)}
                        className="text-xs text-[#6F6B65] hover:text-[#1A1A1A] transition-colors"
                      >
                        + Add break
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
