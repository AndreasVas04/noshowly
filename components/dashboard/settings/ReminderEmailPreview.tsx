/**
 * components/dashboard/settings/ReminderEmailPreview.tsx
 *
 * Live preview of the 24-hour reminder email in the Message templates
 * section. It matches the layout of the real email (lib/reminder-templates.ts)
 * and fills the templates with sample values; a blank field shows the default
 * text in italics. With email confirmation on (and allowed by the plan) the
 * YES/NO buttons are shown above the closing.
 */

'use client';

import { previewVariables } from '@/components/dashboard/settings/settings-helpers';
import {
  DEFAULT_EMAIL_BODY,
  DEFAULT_EMAIL_CLOSING,
  DEFAULT_EMAIL_FOOTER,
  DEFAULT_EMAIL_GREETING,
  applyTemplate,
} from '@/lib/reminder-templates';

type ReminderEmailPreviewProps = {
  /** Business name as typed in Business info. */
  salonName: string;
  emailGreeting: string;
  emailBody: string;
  emailClosing: string;
  emailFooter: string;
  /** The reminder asks for YES/NO confirmation (Reminder settings). */
  emailConfirmationEnabled: boolean;
  /** The plan can send email (from GET /api/billing). */
  emailAllowed: boolean;
};

/**
 * Renders the live reminder email preview.
 *
 * @param props - The template fields and the confirmation settings.
 * @returns The preview JSX.
 */
export default function ReminderEmailPreview({
  salonName,
  emailGreeting,
  emailBody,
  emailClosing,
  emailFooter,
  emailConfirmationEnabled,
  emailAllowed,
}: ReminderEmailPreviewProps) {
  // -------------------------------------------------------------------------
  // Derived values for the live preview (recomputed on every render)
  // -------------------------------------------------------------------------

  /** Sample values used in the reminder preview. */
  const PREVIEW_VARS = previewVariables(salonName);

  const previewBusiness = PREVIEW_VARS.business_name;

  // Email preview (live — updates as the owner types)
  const activeEmailGreeting = emailGreeting.trim() || DEFAULT_EMAIL_GREETING;
  const activeEmailBody     = emailBody.trim()     || DEFAULT_EMAIL_BODY;
  const activeEmailFooter   = emailFooter.trim()   || DEFAULT_EMAIL_FOOTER;
  const activeEmailClosing  = emailClosing.trim()  || DEFAULT_EMAIL_CLOSING;

  const previewEmailGreetingText = applyTemplate(activeEmailGreeting, PREVIEW_VARS);
  const previewEmailBodyText     = applyTemplate(activeEmailBody,     PREVIEW_VARS);
  const previewEmailFooterText   = applyTemplate(activeEmailFooter,   { business_name: previewBusiness });
  const previewEmailClosingText  = applyTemplate(activeEmailClosing,  PREVIEW_VARS);

  return (
    <div className="mb-6">
      <p className="text-sm text-[#6F6B65] mb-3 font-body">
        Preview (updates as you type)
      </p>

      <div>

        {/* Email preview — matches the actual reminder email layout */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-[#6F6B65] uppercase tracking-widest font-body">Email · 24h before</p>
          <div className="border border-[#E5E2DB] rounded-lg overflow-hidden">
            {/* Black header with salon name */}
            <div className="bg-[#1A1A1A] rounded-t-lg px-5 py-4">
              <p className="text-white font-semibold text-base">{previewBusiness}</p>
            </div>
            {/* White body */}
            <div className="bg-white px-5 py-5 space-y-4">
              {/* Greeting */}
              <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap break-words">
                {emailGreeting.trim() ? previewEmailGreetingText : <span className="italic text-[#6F6B65]">{applyTemplate(DEFAULT_EMAIL_GREETING, PREVIEW_VARS)}</span>}
              </p>
              {/* Body message */}
              <p className="text-sm text-[#6F6B65] leading-relaxed whitespace-pre-wrap break-words">
                {emailBody.trim() ? previewEmailBodyText : <span className="italic">{applyTemplate(DEFAULT_EMAIL_BODY, PREVIEW_VARS)}</span>}
              </p>
              {/* Appointment details card */}
              <div className="bg-[#F5F3EF] rounded-lg p-4 space-y-3">
                <div>
                  <p className="text-[10px] text-[#6F6B65] uppercase font-semibold tracking-wide">Service</p>
                  <p className="text-sm text-[#1A1A1A] font-semibold">Haircut</p>
                </div>
                <div>
                  <p className="text-[10px] text-[#6F6B65] uppercase font-semibold tracking-wide">Date &amp; Time</p>
                  <p className="text-sm text-[#1A1A1A] font-semibold">{PREVIEW_VARS.date} at {PREVIEW_VARS.time}</p>
                </div>
              </div>
              {/* Confirm prompt + buttons */}
              {emailConfirmationEnabled && emailAllowed ? (
                <>
                  <p className="text-sm text-[#6F6B65]">Please confirm or cancel your appointment below.</p>
                  <div className="flex gap-3">
                    <span className="inline-block bg-[#1B4332] text-white rounded-lg px-4 py-2.5 text-sm font-semibold">YES, I&apos;ll be there</span>
                    <span className="inline-block bg-[#DC2626] text-white rounded-lg px-4 py-2.5 text-sm font-semibold">NO, cancel it</span>
                  </div>
                </>
              ) : (
                <p className="text-sm text-[#6F6B65] whitespace-pre-wrap break-words">
                  {emailClosing.trim() ? previewEmailClosingText : <span className="italic">{applyTemplate(DEFAULT_EMAIL_CLOSING, PREVIEW_VARS)}</span>}
                </p>
              )}
              {/* Closing (shown when confirmation buttons are present) */}
              {emailConfirmationEnabled && emailAllowed && (
                <p className="text-sm text-[#6F6B65] whitespace-pre-wrap break-words">
                  {emailClosing.trim() ? previewEmailClosingText : <span className="italic">{applyTemplate(DEFAULT_EMAIL_CLOSING, PREVIEW_VARS)}</span>}
                </p>
              )}
              {/* Divider + footer */}
              <div className="border-t border-[#E5E2DB] pt-3">
                <p className="text-xs text-[#6F6B65] whitespace-pre-wrap break-words font-body">
                  {emailFooter.trim() ? previewEmailFooterText : <span className="italic">{applyTemplate(DEFAULT_EMAIL_FOOTER, { business_name: previewBusiness })}</span>}
                </p>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
