/**
 * components/dashboard/settings/BusinessHoursSection.tsx
 *
 * Settings section 2, Business hours: the opening and closing time, used as
 * the default time range of the booking page and the appointment modal.
 * Auto-saves 800 ms after any change; an invalid range ("Closing time must be
 * after opening time.") is shown and not saved (useBusinessHoursSave in
 * useSectionSaves.ts).
 */

'use client';

import { FieldLabel, SaveIndicator } from '@/components/dashboard/settings/SettingsControls';
import type { BusinessHoursSave } from '@/components/dashboard/settings/useSectionSaves';
import type { BusinessHoursFields } from '@/components/dashboard/settings/useSettingsData';

type BusinessHoursSectionProps = {
  /** Opening and closing time, with their setters. */
  fields: BusinessHoursFields;
  /** The section's auto-save. */
  save: BusinessHoursSave;
};

/**
 * Renders the Business hours section.
 *
 * @param props - The section's fields and auto-save.
 * @returns The section JSX.
 */
export default function BusinessHoursSection({ fields, save }: BusinessHoursSectionProps) {
  const { openingTime, setOpeningTime, closingTime, setClosingTime } = fields;
  const { hoursSaveStatus, hoursError, scheduleHoursSave } = save;

  return (
    <section>
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-heading text-base font-semibold text-[#1A1A1A]">Business hours</h2>
        <SaveIndicator status={hoursSaveStatus} />
      </div>
      <p className="text-sm text-[#6F6B65] mb-4 font-body">
        Used as the default time range for the booking page and appointment modal.
      </p>

      <div className="bg-white rounded-2xl border border-[#E5E2DB] p-6 space-y-5">

        <div className="flex flex-row flex-wrap gap-6">
          <div className="flex flex-col gap-2">
            <FieldLabel htmlFor="opening-time">Opening time</FieldLabel>
            <input
              id="opening-time"
              type="time"
              value={openingTime}
              onChange={(e) => {
                const v = e.target.value;
                setOpeningTime(v);
                scheduleHoursSave(v, closingTime);
              }}
              style={{ paddingLeft: '12px', paddingRight: '12px' }}
              className="w-[140px] h-9 rounded-lg border border-[#C8C8C8] text-sm text-[#1A1A1A] outline-none focus:border-[#1A1A1A] transition-colors"
            />
          </div>
          <div className="flex flex-col gap-2">
            <FieldLabel htmlFor="closing-time">Closing time</FieldLabel>
            <input
              id="closing-time"
              type="time"
              value={closingTime}
              onChange={(e) => {
                const v = e.target.value;
                setClosingTime(v);
                scheduleHoursSave(openingTime, v);
              }}
              style={{ paddingLeft: '12px', paddingRight: '12px' }}
              className="w-[140px] h-9 rounded-lg border border-[#C8C8C8] text-sm text-[#1A1A1A] outline-none focus:border-[#1A1A1A] transition-colors"
            />
          </div>
        </div>

        {hoursError && (
          <div role="alert" className="rounded-lg bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700">
            {hoursError}
          </div>
        )}

      </div>
    </section>
  );
}
