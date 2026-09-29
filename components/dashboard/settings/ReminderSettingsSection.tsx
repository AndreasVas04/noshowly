/**
 * components/dashboard/settings/ReminderSettingsSection.tsx
 *
 * Settings section 3, Reminder settings: the "Request email confirmation
 * (YES/NO)" switch. Plan-gated: it is disabled when the plan cannot send
 * email (an ended trial or an inactive subscription). Auto-saves 800 ms after
 * a change (useConfirmationSave in useSectionSaves.ts).
 */

'use client';

import { SaveIndicator } from '@/components/dashboard/settings/SettingsControls';
import type { ConfirmationSave } from '@/components/dashboard/settings/useSectionSaves';
import type { ConfirmationFields } from '@/components/dashboard/settings/useSettingsData';

type ReminderSettingsSectionProps = {
  /** The email confirmation toggle, with its setter. */
  fields: ConfirmationFields;
  /** The section's auto-save. */
  save: ConfirmationSave;
  /** The plan can send email (from GET /api/billing). */
  emailAllowed: boolean;
};

/**
 * Renders the Reminder settings section.
 *
 * @param props - The section's field, auto-save and plan gate.
 * @returns The section JSX.
 */
export default function ReminderSettingsSection({
  fields,
  save,
  emailAllowed,
}: ReminderSettingsSectionProps) {
  const { emailConfirmationEnabled, setEmailConfirmationEnabled } = fields;
  const { confirmSaveStatus, confirmError, scheduleConfirmationSave } = save;

  return (
    <section>
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-heading text-base font-semibold text-[#1A1A1A]">Reminder settings</h2>
        <SaveIndicator status={confirmSaveStatus} />
      </div>
      <p className="text-sm text-[#8A8680] mb-4 font-body">
        Control whether clients are asked to confirm or cancel their appointment.
      </p>

      <div className="bg-white rounded-2xl border border-[#E5E2DB] p-6 space-y-5">

        {/* Email confirmation toggle */}
        <div className="flex items-start gap-4">
          <label
            className={`relative inline-flex items-center mt-0.5 shrink-0 ${
              emailAllowed ? 'cursor-pointer' : 'opacity-40 cursor-not-allowed'
            }`}
          >
            <input
              type="checkbox"
              aria-labelledby="email-confirmation-label"
              checked={emailConfirmationEnabled}
              onChange={(e) => {
                if (!emailAllowed) return;
                const v = e.target.checked;
                setEmailConfirmationEnabled(v);
                scheduleConfirmationSave(v);
              }}
              disabled={!emailAllowed || confirmSaveStatus === 'saving'}
              className="sr-only peer"
            />
            <div className="w-10 h-6 bg-[#C8C8C8]/50 rounded-full peer peer-checked:bg-[#1B4332] after:content-[''] after:absolute after:top-[3px] after:start-[3px] after:bg-white after:rounded-full after:h-[18px] after:w-[18px] after:transition-all peer-checked:after:translate-x-4 peer-disabled:opacity-50" />
          </label>
          <div>
            <p id="email-confirmation-label" className="text-sm font-medium text-[#1A1A1A]">Request email confirmation (YES/NO)</p>
            {emailAllowed ? (
              <p className="text-xs text-[#8A8680] mt-0.5 font-body">
                When off, email reminders are sent without YES/NO buttons.
              </p>
            ) : (
              <p className="text-xs text-amber-600 mt-0.5">
                Upgrade to send email reminders.
              </p>
            )}
          </div>
        </div>

        {confirmError && (
          <div role="alert" className="rounded-lg bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700">
            {confirmError}
          </div>
        )}

      </div>
    </section>
  );
}
