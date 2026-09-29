/**
 * components/dashboard/settings/MessageTemplatesSection.tsx
 *
 * Settings section 4, Message templates: the live reminder email preview
 * (ReminderEmailPreview) and the email subject, greeting, body, closing and
 * footer fields. Blank fields use the default text. The variable chips insert
 * a template variable at the cursor in the email body. Auto-saves 800 ms after
 * any field change (useTemplatesSave in useSectionSaves.ts).
 */

'use client';

import ReminderEmailPreview from '@/components/dashboard/settings/ReminderEmailPreview';
import { FieldLabel, SaveIndicator } from '@/components/dashboard/settings/SettingsControls';
import {
  DEFAULT_EMAIL_BODY,
  DEFAULT_EMAIL_CLOSING,
  DEFAULT_EMAIL_FOOTER,
  DEFAULT_EMAIL_GREETING,
  DEFAULT_EMAIL_SUBJECT,
} from '@/lib/reminder-templates';
import type { TemplatesSave } from '@/components/dashboard/settings/useSectionSaves';
import type { TemplateFields } from '@/components/dashboard/settings/useSettingsData';
import type { TemplateTextareas } from '@/components/dashboard/settings/useTemplateTextareas';

/** Template variables supported in email fields. */
const TEMPLATE_VARIABLES = [
  '{client_name}',
  '{business_name}',
  '{service}',
  '{time}',
  '{date}',
] as const;

type MessageTemplatesSectionProps = {
  /** The email template fields, with their setters. */
  fields: TemplateFields;
  /** The section's auto-save. */
  save: TemplatesSave;
  /** Textarea refs and variable insertion (useTemplateTextareas). */
  textareas: TemplateTextareas;
  /** Business name as typed in Business info (for the preview). */
  salonName: string;
  /** The reminder asks for YES/NO confirmation (for the preview). */
  emailConfirmationEnabled: boolean;
  /** The plan can send email (for the preview). */
  emailAllowed: boolean;
};

/**
 * Renders the Message templates section.
 *
 * @param props - The section's fields, auto-save, textareas and preview settings.
 * @returns The section JSX.
 */
export default function MessageTemplatesSection({
  fields,
  save,
  textareas,
  salonName,
  emailConfirmationEnabled,
  emailAllowed,
}: MessageTemplatesSectionProps) {
  const {
    emailFooter,   setEmailFooter,
    emailSubject,  setEmailSubject,
    emailGreeting, setEmailGreeting,
    emailBody,     setEmailBody,
    emailClosing,  setEmailClosing,
  } = fields;
  const { templatesSaveStatus, templatesError, scheduleTemplatesSave } = save;
  const {
    emailBodyTextareaRef,
    emailSubjectTextareaRef,
    emailGreetingTextareaRef,
    emailClosingTextareaRef,
    emailFooterTextareaRef,
    insertAtCursor,
  } = textareas;

  return (
    <section>
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-heading text-base font-semibold text-[#1A1A1A]">Message templates</h2>
        <SaveIndicator status={templatesSaveStatus} />
      </div>
      <p className="text-sm text-[#8A8680] mb-4 font-body">
        Customise the reminder email sent to your clients. Leave blank to use the default.
      </p>

      {/* ---- Live email preview ---- */}
      <ReminderEmailPreview
        salonName={salonName}
        emailGreeting={emailGreeting}
        emailBody={emailBody}
        emailClosing={emailClosing}
        emailFooter={emailFooter}
        emailConfirmationEnabled={emailConfirmationEnabled}
        emailAllowed={emailAllowed}
      />

      {/* ---- Email template fields ---- */}
      <div className="bg-white rounded-2xl border border-[#E5E2DB] p-6 space-y-8">

        {/* Email template fields */}
        <div className="space-y-5">
          <p className="text-xs font-semibold text-[#8A8680] uppercase tracking-widest font-body">Email</p>

          {/* Email subject */}
          <div className="space-y-1.5">
            <FieldLabel htmlFor="email-subject">Email subject</FieldLabel>
            <textarea
              id="email-subject"
              ref={emailSubjectTextareaRef}
              value={emailSubject}
              onChange={(e) => {
                const v = e.target.value;
                setEmailSubject(v);
                scheduleTemplatesSave(emailFooter, v, emailGreeting, emailBody, emailClosing);
              }}
              onInput={(e: React.FormEvent<HTMLTextAreaElement>) => {
                const el = e.currentTarget;
                el.style.height = 'auto';
                el.style.height = `${el.scrollHeight}px`;
              }}
              placeholder={DEFAULT_EMAIL_SUBJECT}
              rows={2}
              maxLength={200}
              className="w-full rounded-lg border border-[#E5E2DB] px-3 py-2.5 text-sm text-[#1A1A1A] placeholder:text-[#8A8680]/70 outline-none focus:border-[#1B4332] resize-none overflow-hidden transition-colors"
            />
            <p className="text-xs text-[#8A8680] font-body">
              Use{' '}<span className="font-mono text-[#1A1A1A]/60">{'{business_name}'}</span>{' '}to insert your business name.
            </p>
          </div>

          {/* Email greeting */}
          <div className="space-y-1.5">
            <FieldLabel htmlFor="email-greeting">Email greeting</FieldLabel>
            <textarea
              id="email-greeting"
              ref={emailGreetingTextareaRef}
              value={emailGreeting}
              onChange={(e) => {
                const v = e.target.value;
                setEmailGreeting(v);
                scheduleTemplatesSave(emailFooter, emailSubject, v, emailBody, emailClosing);
              }}
              onInput={(e: React.FormEvent<HTMLTextAreaElement>) => {
                const el = e.currentTarget;
                el.style.height = 'auto';
                el.style.height = `${el.scrollHeight}px`;
              }}
              placeholder={DEFAULT_EMAIL_GREETING}
              rows={2}
              maxLength={200}
              className="w-full rounded-lg border border-[#E5E2DB] px-3 py-2.5 text-sm text-[#1A1A1A] placeholder:text-[#8A8680]/70 outline-none focus:border-[#1B4332] resize-none overflow-hidden transition-colors"
            />
            <p className="text-xs text-[#8A8680] font-body">
              Use{' '}<span className="font-mono text-[#1A1A1A]/60">{'{client_name}'}</span>{' '}to personalise the greeting.
            </p>
          </div>

          {/* Email body */}
          <div className="space-y-2">
            <FieldLabel htmlFor="email-body">Email body message</FieldLabel>
            <textarea
              id="email-body"
              ref={emailBodyTextareaRef}
              value={emailBody}
              onChange={(e) => {
                const v = e.target.value;
                setEmailBody(v);
                scheduleTemplatesSave(emailFooter, emailSubject, emailGreeting, v, emailClosing);
              }}
              onInput={(e: React.FormEvent<HTMLTextAreaElement>) => {
                const el = e.currentTarget;
                el.style.height = 'auto';
                el.style.height = `${el.scrollHeight}px`;
              }}
              placeholder={DEFAULT_EMAIL_BODY}
              rows={3}
              maxLength={500}
              className="w-full rounded-lg border border-[#E5E2DB] px-3 py-2.5 text-sm text-[#1A1A1A] placeholder:text-[#8A8680]/70 outline-none focus:border-[#1B4332] resize-none overflow-hidden transition-colors"
            />

            {/* Variable chips for email body */}
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATE_VARIABLES.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => {
                    insertAtCursor(emailBodyTextareaRef, v, emailBody, setEmailBody);
                    scheduleTemplatesSave(
                      emailFooter, emailSubject, emailGreeting,
                      emailBodyTextareaRef.current?.value ?? emailBody,
                      emailClosing
                    );
                  }}
                  className="inline-block font-mono text-[11px] bg-[#1A1A1A]/5 hover:bg-[#1A1A1A]/10 active:bg-[#1A1A1A]/15 text-[#1A1A1A] px-2 py-1 rounded-md transition-colors"
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Email closing */}
          <div className="space-y-1.5">
            <FieldLabel htmlFor="email-closing">Email closing message</FieldLabel>
            <textarea
              id="email-closing"
              ref={emailClosingTextareaRef}
              value={emailClosing}
              onChange={(e) => {
                const v = e.target.value;
                setEmailClosing(v);
                scheduleTemplatesSave(emailFooter, emailSubject, emailGreeting, emailBody, v);
              }}
              onInput={(e: React.FormEvent<HTMLTextAreaElement>) => {
                const el = e.currentTarget;
                el.style.height = 'auto';
                el.style.height = `${el.scrollHeight}px`;
              }}
              placeholder={DEFAULT_EMAIL_CLOSING}
              rows={2}
              maxLength={200}
              className="w-full rounded-lg border border-[#E5E2DB] px-3 py-2.5 text-sm text-[#1A1A1A] placeholder:text-[#8A8680]/70 outline-none focus:border-[#1B4332] resize-none overflow-hidden transition-colors"
            />
            <p className="text-xs text-[#8A8680] font-body">
              Shown at the bottom of the email when confirmation buttons are disabled.
            </p>
          </div>

          {/* Email footer */}
          <div className="space-y-1.5">
            <FieldLabel htmlFor="email-footer">Email footer</FieldLabel>
            <textarea
              id="email-footer"
              ref={emailFooterTextareaRef}
              value={emailFooter}
              onChange={(e) => {
                const v = e.target.value;
                setEmailFooter(v);
                scheduleTemplatesSave(v, emailSubject, emailGreeting, emailBody, emailClosing);
              }}
              onInput={(e: React.FormEvent<HTMLTextAreaElement>) => {
                const el = e.currentTarget;
                el.style.height = 'auto';
                el.style.height = `${el.scrollHeight}px`;
              }}
              placeholder={DEFAULT_EMAIL_FOOTER}
              rows={2}
              maxLength={300}
              className="w-full rounded-lg border border-[#E5E2DB] px-3 py-2.5 text-sm text-[#1A1A1A] placeholder:text-[#8A8680]/70 outline-none focus:border-[#1B4332] resize-none overflow-hidden transition-colors"
            />
            <p className="text-xs text-[#8A8680] font-body">
              Small text at the very bottom of reminder emails. Use{' '}
              <span className="font-mono text-[#1A1A1A]/60">{'{business_name}'}</span>{' '}
              to insert your business name.
            </p>
          </div>

        </div>

      </div>

      {templatesError && (
        <div role="alert" className="mt-3 rounded-lg bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700">
          {templatesError}
        </div>
      )}
    </section>
  );
}
