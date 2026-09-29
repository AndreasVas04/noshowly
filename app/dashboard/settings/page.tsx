/**
 * app/dashboard/settings/page.tsx
 *
 * Dashboard Settings page.
 *
 * Sections (in order):
 *  1. Business info — name, timezone, currency. Auto-saves with 800 ms debounce.
 *  2. Business hours — opening and closing time. Auto-saves (skipped on invalid range).
 *  3. Reminder settings — email confirmation toggle, plan-gated. Auto-saves.
 *  4. Message templates — full email template customisation. Auto-saves.
 *  5. Billing — plan, trial end or renewal date, Upgrade / Manage billing
 *     (components/dashboard/BillingSection.tsx).
 *  6. Delete account — typed confirmation.
 *
 * Every section saves independently; there are no "Save changes" buttons.
 * A subtle "Saving…" → "Saved ✓" indicator appears in the top-right of each
 * section header while the request is in flight / just completed.
 *
 * The email confirmation toggle is plan-gated: it is disabled when the
 * account cannot send email (an ended trial or an inactive subscription).
 * Business settings (PUT /api/salon) can always be saved, even on a
 * read-only account.
 *
 * Structure: this page is the composition root. It calls the hooks, so all
 * the state lives here for as long as the page is mounted, and renders one
 * component per section. Both come from components/dashboard/settings/:
 *  - useSettingsData.ts — loads the salon and the billing overview; holds the fields.
 *  - useSectionSaves.ts — the debounced auto-save of sections 1–4.
 *  - useTemplateTextareas.ts — template textarea refs, auto-resize, variable insertion.
 *  - useDeleteAccount.ts — the typed confirmation and DELETE /api/account.
 *  - BusinessInfoSection, BusinessHoursSection, ReminderSettingsSection,
 *    MessageTemplatesSection (with ReminderEmailPreview) and DeleteAccountSection.
 *  - SettingsControls.tsx (FieldLabel, SaveIndicator) and settings-helpers.ts
 *    (pure helpers, unit tested).
 *
 * Team, Services, and Online Booking are managed in /dashboard/booking.
 *
 * Security: all mutations go through API routes — never direct Supabase calls.
 * Plan and billing data come from GET /api/billing.
 */

'use client';

import BillingSection from '@/components/dashboard/BillingSection';
import BusinessHoursSection from '@/components/dashboard/settings/BusinessHoursSection';
import BusinessInfoSection from '@/components/dashboard/settings/BusinessInfoSection';
import DeleteAccountSection from '@/components/dashboard/settings/DeleteAccountSection';
import MessageTemplatesSection from '@/components/dashboard/settings/MessageTemplatesSection';
import ReminderSettingsSection from '@/components/dashboard/settings/ReminderSettingsSection';
import { useDeleteAccount } from '@/components/dashboard/settings/useDeleteAccount';
import {
  useBusinessHoursSave,
  useBusinessInfoSave,
  useConfirmationSave,
  useTemplatesSave,
} from '@/components/dashboard/settings/useSectionSaves';
import { useSettingsData } from '@/components/dashboard/settings/useSettingsData';
import { useTemplateTextareas } from '@/components/dashboard/settings/useTemplateTextareas';

// ---------------------------------------------------------------------------
// Settings page
// ---------------------------------------------------------------------------

/**
 * SettingsPage renders salon configuration with fully auto-saving sections.
 * Each section debounces field changes by 800 ms before calling PUT /api/salon.
 *
 * @returns The settings page JSX.
 */
export default function SettingsPage() {
  // -------------------------------------------------------------------------
  // State: the loaded data and fields, each section's auto-save, the template
  // textareas and the delete account dialog. The sections only render it.
  // -------------------------------------------------------------------------
  const { loadState, billing, businessInfo, businessHours, confirmation, templates } = useSettingsData();
  const businessInfoSave  = useBusinessInfoSave();
  const businessHoursSave = useBusinessHoursSave();
  const confirmationSave  = useConfirmationSave();
  const templatesSave     = useTemplatesSave();
  const textareas         = useTemplateTextareas(templates);
  const deletion          = useDeleteAccount();

  // -------------------------------------------------------------------------
  // Loading / error states
  // -------------------------------------------------------------------------

  if (loadState === 'loading') {
    return (
      <div className="p-8 lg:p-12 flex items-center justify-center min-h-64">
        <p className="text-sm text-[#6F6B65] font-body">Loading settings…</p>
      </div>
    );
  }

  if (loadState === 'error') {
    return (
      <div className="p-8 lg:p-12">
        <div className="max-w-2xl bg-red-50 border border-red-100 rounded-2xl p-6">
          <p className="text-sm text-red-700 font-medium">Failed to load settings.</p>
          <p className="text-sm text-red-600 mt-1">
            Please refresh the page. If the problem persists, contact support.
          </p>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Derived values (recomputed on every render)
  // -------------------------------------------------------------------------

  // Plan-gated feature availability (an ended trial or an inactive subscription sends no email).
  const emailAllowed = billing?.canSendEmail ?? false;
  /** The public demo account cannot be deleted (the API also refuses it). */
  const isDemo = billing?.isDemo ?? false;

  // -------------------------------------------------------------------------
  // Main render
  // -------------------------------------------------------------------------

  return (
    <div className="p-8 lg:p-12">
      <div className="max-w-2xl space-y-12">

        {/* Page heading */}
        <div>
          <h1 className="font-heading text-3xl font-semibold text-[#1A1A1A]">Settings</h1>
          <p className="text-sm text-[#6F6B65] mt-1.5 font-body">
            Manage your business info, reminder templates and hours.
          </p>
        </div>

        {/* ================================================================
            SECTION 1: Business info
            Auto-saves 800 ms after any field change.
        ================================================================ */}
        <BusinessInfoSection fields={businessInfo} save={businessInfoSave} />

        {/* ================================================================
            SECTION 2: Business hours
            Auto-saves 800 ms after any field change (skipped on invalid range).
        ================================================================ */}
        <BusinessHoursSection fields={businessHours} save={businessHoursSave} />

        {/* ================================================================
            SECTION 3: Reminder settings
            Plan-gated: email disabled on trial.
            Auto-saves 800 ms after any toggle change.
        ================================================================ */}
        <ReminderSettingsSection
          fields={confirmation}
          save={confirmationSave}
          emailAllowed={emailAllowed}
        />

        {/* ================================================================
            SECTION 4: Message templates
            Includes live email preview and full email customisation.
            Auto-saves 800 ms after any field change.
        ================================================================ */}
        <MessageTemplatesSection
          fields={templates}
          save={templatesSave}
          textareas={textareas}
          salonName={businessInfo.salonName}
          emailConfirmationEnabled={confirmation.emailConfirmationEnabled}
          emailAllowed={emailAllowed}
        />

        {/* ================================================================
            SECTION 5: Billing
        ================================================================ */}
        <BillingSection billing={billing} />

        {/* ================================================================
            SECTION 6: Delete account
        ================================================================ */}
        <DeleteAccountSection isDemo={isDemo} deletion={deletion} />

      </div>
    </div>
  );
}
