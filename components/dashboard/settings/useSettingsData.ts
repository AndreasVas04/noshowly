/**
 * components/dashboard/settings/useSettingsData.ts
 *
 * Data of the Settings page: the salon (GET /api/salon) and the billing
 * overview (GET /api/billing: plan, trial and subscription), fetched in
 * parallel once on mount, and the editable salon fields of every section,
 * grouped by section with their setters.
 *
 * Saving is not done here: each section auto-saves through its own hook in
 * useSectionSaves.ts.
 */

'use client';

import { useState, useEffect } from 'react';
import { normaliseTime } from '@/lib/time';
import type { BillingOverview, Salon } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LoadState = 'loading' | 'ready' | 'error';

/** State setter of a text field. */
type TextSetter = React.Dispatch<React.SetStateAction<string>>;

/** Section 1, Business info: name, timezone and currency. */
export type BusinessInfoFields = {
  salonName: string;
  setSalonName: TextSetter;
  timezone: string;
  setTimezone: TextSetter;
  currency: string;
  setCurrency: TextSetter;
};

/** Section 2, Business hours: opening and closing time (HH:MM or empty). */
export type BusinessHoursFields = {
  openingTime: string;
  setOpeningTime: TextSetter;
  closingTime: string;
  setClosingTime: TextSetter;
};

/** Section 3, Reminder settings: the email confirmation toggle. */
export type ConfirmationFields = {
  emailConfirmationEnabled: boolean;
  setEmailConfirmationEnabled: React.Dispatch<React.SetStateAction<boolean>>;
};

/** Section 4, Message templates: the email fields (blank → the default text). */
export type TemplateFields = {
  emailFooter: string;
  setEmailFooter: TextSetter;
  emailSubject: string;
  setEmailSubject: TextSetter;
  emailGreeting: string;
  setEmailGreeting: TextSetter;
  emailBody: string;
  setEmailBody: TextSetter;
  emailClosing: string;
  setEmailClosing: TextSetter;
};

/** What useSettingsData() returns. */
type SettingsData = {
  loadState: LoadState;
  /** From GET /api/billing; null until loaded or on error. */
  billing: BillingOverview | null;
  businessInfo: BusinessInfoFields;
  businessHours: BusinessHoursFields;
  confirmation: ConfirmationFields;
  templates: TemplateFields;
};

/**
 * Loads the salon and the billing overview once on mount and holds the
 * editable fields of every section.
 *
 * @returns The load state, the billing overview and each section's fields.
 */
export function useSettingsData(): SettingsData {
  // -------------------------------------------------------------------------
  // Global load state
  // -------------------------------------------------------------------------
  const [loadState, setLoadState] = useState<LoadState>('loading');

  // -------------------------------------------------------------------------
  // Plan, trial and subscription — GET /api/billing (null until loaded or on error)
  // -------------------------------------------------------------------------
  const [billing, setBilling] = useState<BillingOverview | null>(null);

  // -------------------------------------------------------------------------
  // Section 1: Business info
  // -------------------------------------------------------------------------
  const [salonName, setSalonName] = useState('');
  const [timezone, setTimezone]   = useState('UTC');
  const [currency, setCurrency]   = useState('USD');

  // -------------------------------------------------------------------------
  // Section 2: Business hours
  // -------------------------------------------------------------------------
  const [openingTime, setOpeningTime] = useState('09:00');
  const [closingTime, setClosingTime] = useState('20:00');

  // -------------------------------------------------------------------------
  // Section 3: Reminder confirmation toggles (plan-gated)
  // -------------------------------------------------------------------------
  const [emailConfirmationEnabled, setEmailConfirmationEnabled] = useState(true);

  // -------------------------------------------------------------------------
  // Section 4: Message templates
  // -------------------------------------------------------------------------
  const [emailFooter,    setEmailFooter]    = useState('');
  const [emailSubject,   setEmailSubject]   = useState('');
  const [emailGreeting,  setEmailGreeting]  = useState('');
  const [emailBody,      setEmailBody]      = useState('');
  const [emailClosing,   setEmailClosing]   = useState('');

  // -------------------------------------------------------------------------
  // Initial data load
  // -------------------------------------------------------------------------

  /**
   * Fetches the salon and the billing overview (plan, trial, subscription)
   * in parallel. The page still works when billing cannot be loaded.
   */
  useEffect(() => {
    async function loadData() {
      try {
        const [salonRes, billingRes] = await Promise.all([
          fetch('/api/salon'),
          fetch('/api/billing'),
        ]);

        if (!salonRes.ok) { setLoadState('error'); return; }

        const salonData = (await salonRes.json()) as { salon: Salon };
        const salon = salonData.salon;

        setSalonName(salon.name ?? '');
        setTimezone(salon.timezone ?? 'UTC');
        setCurrency(salon.currency ?? 'USD');
        setEmailConfirmationEnabled(salon.email_confirmation_enabled ?? true);
        setEmailFooter(salon.email_footer ?? '');
        setEmailSubject(salon.email_subject ?? '');
        setEmailGreeting(salon.email_greeting ?? '');
        setEmailBody(salon.email_body ?? '');
        setEmailClosing(salon.email_closing ?? '');
        setOpeningTime(normaliseTime(salon.opening_time) ?? '09:00');
        setClosingTime(normaliseTime(salon.closing_time) ?? '20:00');

        // Billing overview. On failure `billing` stays null: email settings
        // stay disabled (most restrictive) and the Billing section says so.
        if (billingRes.ok) {
          try {
            setBilling((await billingRes.json()) as BillingOverview);
          } catch {
            // Unreadable response — treated like a failed request.
          }
        }

        setLoadState('ready');
      } catch {
        setLoadState('error');
      }
    }

    void loadData();
  }, []);

  return {
    loadState,
    billing,
    businessInfo: { salonName, setSalonName, timezone, setTimezone, currency, setCurrency },
    businessHours: { openingTime, setOpeningTime, closingTime, setClosingTime },
    confirmation: { emailConfirmationEnabled, setEmailConfirmationEnabled },
    templates: {
      emailFooter,   setEmailFooter,
      emailSubject,  setEmailSubject,
      emailGreeting, setEmailGreeting,
      emailBody,     setEmailBody,
      emailClosing,  setEmailClosing,
    },
  };
}
