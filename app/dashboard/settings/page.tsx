/**
 * app/dashboard/settings/page.tsx
 *
 * Dashboard Settings page.
 *
 * Sections (in order):
 *  1. Business info — name, phone, timezone, currency. Auto-saves with 800 ms debounce.
 *  2. Business hours — opening and closing time. Auto-saves (skipped on invalid range).
 *  3. Reminder settings — email confirmation toggle, plan-gated. Auto-saves.
 *  4. Message templates — full email template customisation. Auto-saves.
 *  5. Delete account — typed confirmation.
 *
 * Every section saves independently; there are no "Save changes" buttons.
 * A subtle "Saving…" → "Saved ✓" indicator appears in the top-right of each
 * section header while the request is in flight / just completed.
 *
 * The email confirmation toggle is plan-gated:
 *  - Email: disabled on trial (email reminders require a paid plan).
 *
 * Team, Services, and Online Booking are managed in /dashboard/booking.
 *
 * Security: all mutations go through API routes — never direct Supabase calls.
 * Plan data is fetched via the browser Supabase client with RLS (read-only).
 */

'use client';

import { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { planAllowsEmail } from '@/lib/plans';
import type { UserPlan } from '@/lib/plans';
import type { Salon } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LoadState = 'loading' | 'ready' | 'error';
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CURRENCY_OPTIONS = [
  { code: 'USD', label: '$ USD: US Dollar' },
  { code: 'EUR', label: '€ EUR: Euro' },
  { code: 'GBP', label: '£ GBP: British Pound' },
  { code: 'AUD', label: 'A$ AUD: Australian Dollar' },
  { code: 'CAD', label: 'C$ CAD: Canadian Dollar' },
  { code: 'CHF', label: 'Fr CHF: Swiss Franc' },
  { code: 'JPY', label: '¥ JPY: Japanese Yen' },
  { code: 'CNY', label: '¥ CNY: Chinese Yuan' },
  { code: 'INR', label: '₹ INR: Indian Rupee' },
  { code: 'BRL', label: 'R$ BRL: Brazilian Real' },
  { code: 'MXN', label: '$ MXN: Mexican Peso' },
  { code: 'SGD', label: 'S$ SGD: Singapore Dollar' },
  { code: 'HKD', label: 'HK$ HKD: Hong Kong Dollar' },
  { code: 'NOK', label: 'kr NOK: Norwegian Krone' },
  { code: 'SEK', label: 'kr SEK: Swedish Krona' },
  { code: 'DKK', label: 'kr DKK: Danish Krone' },
  { code: 'NZD', label: 'NZ$ NZD: New Zealand Dollar' },
  { code: 'ZAR', label: 'R ZAR: South African Rand' },
  { code: 'AED', label: 'AED: UAE Dirham' },
  { code: 'SAR', label: 'SAR: Saudi Riyal' },
  { code: 'QAR', label: 'QAR: Qatari Riyal' },
  { code: 'KWD', label: 'KD KWD: Kuwaiti Dinar' },
  { code: 'TRY', label: '₺ TRY: Turkish Lira' },
  { code: 'PLN', label: 'zł PLN: Polish Zloty' },
  { code: 'CZK', label: 'Kč CZK: Czech Koruna' },
  { code: 'HUF', label: 'Ft HUF: Hungarian Forint' },
  { code: 'RON', label: 'lei RON: Romanian Leu' },
  { code: 'BGN', label: 'лв BGN: Bulgarian Lev' },
  { code: 'ILS', label: '₪ ILS: Israeli Shekel' },
  { code: 'KRW', label: '₩ KRW: South Korean Won' },
  { code: 'THB', label: '฿ THB: Thai Baht' },
  { code: 'MYR', label: 'RM MYR: Malaysian Ringgit' },
  { code: 'IDR', label: 'Rp IDR: Indonesian Rupiah' },
  { code: 'PHP', label: '₱ PHP: Philippine Peso' },
] as const;

const COMMON_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Toronto',
  'America/Vancouver',
  'America/Halifax',
  'America/St_Johns',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Amsterdam',
  'Europe/Brussels',
  'Europe/Madrid',
  'Europe/Lisbon',
  'Europe/Rome',
  'Europe/Vienna',
  'Europe/Zurich',
  'Europe/Stockholm',
  'Europe/Oslo',
  'Europe/Copenhagen',
  'Europe/Helsinki',
  'Europe/Warsaw',
  'Europe/Prague',
  'Europe/Budapest',
  'Europe/Bucharest',
  'Europe/Sofia',
  'Europe/Athens',
  'Europe/Nicosia',
  'Europe/Riga',
  'Europe/Tallinn',
  'Europe/Vilnius',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Australia/Brisbane',
  'Australia/Perth',
  'Pacific/Auckland',
] as const;

/** Default email footer — matches lib/reminder-templates.ts DEFAULT_EMAIL_FOOTER. */
const DEFAULT_EMAIL_FOOTER = 'If you have questions, contact {business_name} directly.';

/** Default email template field values (must match getEmailHTML fallbacks). */
const DEFAULT_EMAIL_SUBJECT  = 'Reminder: Your appointment at {business_name} tomorrow';
const DEFAULT_EMAIL_GREETING = 'Hi {client_name},';
const DEFAULT_EMAIL_BODY     = 'This is a reminder for your upcoming appointment.';
const DEFAULT_EMAIL_CLOSING  = 'We look forward to seeing you.';

/** Template variables supported in email fields. */
const TEMPLATE_VARIABLES = [
  '{client_name}',
  '{business_name}',
  '{service}',
  '{time}',
  '{date}',
] as const;

// ---------------------------------------------------------------------------
// Helper: preview substitution
// ---------------------------------------------------------------------------

/**
 * Substitutes {variable} placeholders with sample display values.
 * Only used for the live settings preview — not the actual send path.
 *
 * @param template - String with {variable} placeholders.
 * @param vars     - Map of variable name → display value.
 * @returns         Rendered string with known variables replaced.
 */
function renderPreview(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (t, [k, v]) => t.split(`{${k}}`).join(v),
    template
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Label above a form field. */
function FieldLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <Label htmlFor={htmlFor} className="text-sm font-medium text-[#1A1A1A]">
      {children}
    </Label>
  );
}

/**
 * Subtle save-state indicator shown in the top-right of each section header.
 * Renders nothing when idle, "Saving…" while in-flight, "Saved ✓" briefly after.
 */
function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === 'idle')   return null;
  if (status === 'saving') return <span className="text-xs text-[#8A8680]">Saving…</span>;
  if (status === 'saved')  return <span className="text-xs text-emerald-600 font-medium">Saved ✓</span>;
  return null; // error shown inline in the section
}

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
  // Global load state
  // -------------------------------------------------------------------------
  const [loadState, setLoadState] = useState<LoadState>('loading');

  // -------------------------------------------------------------------------
  // Plan — fetched from users table via browser Supabase client (RLS, read-only)
  // -------------------------------------------------------------------------
  const [plan, setPlan] = useState<UserPlan>('trial');

  // -------------------------------------------------------------------------
  // Section 1: Business info
  // -------------------------------------------------------------------------
  const [salonName, setSalonName] = useState('');
  const [timezone, setTimezone]   = useState('UTC');
  const [currency, setCurrency]   = useState('USD');
  const [salonInfoSaveStatus, setSalonInfoSaveStatus] = useState<SaveStatus>('idle');
  const [salonInfoError, setSalonInfoError]           = useState('');
  /** Debounce timer for the business info section. */
  const salonInfoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // -------------------------------------------------------------------------
  // Section 3: Reminder confirmation toggles (plan-gated)
  // -------------------------------------------------------------------------
  const [emailConfirmationEnabled, setEmailConfirmationEnabled] = useState(true);
  const [confirmSaveStatus, setConfirmSaveStatus] = useState<SaveStatus>('idle');
  const [confirmError, setConfirmError]           = useState('');
  /** Debounce timer for the reminder settings section. */
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // -------------------------------------------------------------------------
  // Section 4: Message templates
  // -------------------------------------------------------------------------
  const [emailFooter,    setEmailFooter]    = useState('');
  const [emailSubject,   setEmailSubject]   = useState('');
  const [emailGreeting,  setEmailGreeting]  = useState('');
  const [emailBody,      setEmailBody]      = useState('');
  const [emailClosing,   setEmailClosing]   = useState('');
  const [templatesSaveStatus, setTemplatesSaveStatus] = useState<SaveStatus>('idle');
  const [templatesError, setTemplatesError]           = useState('');
  /** Debounce timer for the message templates section. */
  const templatesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Textarea refs — emailBodyTextareaRef also used for cursor-position variable insertion.
  const emailBodyTextareaRef    = useRef<HTMLTextAreaElement>(null);
  const emailSubjectTextareaRef  = useRef<HTMLTextAreaElement>(null);
  const emailGreetingTextareaRef = useRef<HTMLTextAreaElement>(null);
  const emailClosingTextareaRef  = useRef<HTMLTextAreaElement>(null);
  const emailFooterTextareaRef   = useRef<HTMLTextAreaElement>(null);

  // -------------------------------------------------------------------------
  // Section 2: Business hours
  // -------------------------------------------------------------------------
  const [openingTime, setOpeningTime] = useState('09:00');
  const [closingTime, setClosingTime] = useState('20:00');
  const [hoursSaveStatus, setHoursSaveStatus] = useState<SaveStatus>('idle');
  const [hoursError, setHoursError]           = useState('');
  /** Debounce timer for the business hours section. */
  const hoursTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // -------------------------------------------------------------------------
  // Section 5: Account deletion (section number unchanged for consistency)
  // -------------------------------------------------------------------------
  const [showDeleteDialog, setShowDeleteDialog]   = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState('');

  // -------------------------------------------------------------------------
  // Initial data load
  // -------------------------------------------------------------------------

  /**
   * Fetches salon data from the API and the user's plan via the browser
   * Supabase client with RLS-enforced read access.
   */
  useEffect(() => {
    async function loadData() {
      try {
        // Fetch salon info and plan in parallel.
        const [salonRes] = await Promise.all([
          fetch('/api/salon'),
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
        setOpeningTime(salon.opening_time ?? '09:00');
        setClosingTime(salon.closing_time ?? '20:00');

        // Fetch the user's plan from users table via browser Supabase client.
        // RLS ensures only the authenticated user's own row is accessible.
        try {
          const supabase = createBrowserSupabaseClient();
          const { data: { user: authUser } } = await supabase.auth.getUser();
          if (authUser) {
            const { data: userData } = await supabase
              .from('users')
              .select('plan')
              .eq('id', authUser.id)
              .single();
            if (userData?.plan) setPlan(userData.plan as UserPlan);
          }
        } catch {
          // Plan fetch failed — keep default 'trial' (most restrictive; safe fallback).
        }

        setLoadState('ready');
      } catch {
        setLoadState('error');
      }
    }

    void loadData();
  }, []);

  /**
   * Auto-resizes all email template textareas when their content changes
   * (e.g. initial data load or user edits). Runs after paint so scrollHeight is accurate.
   */
  useEffect(() => {
    for (const ref of [
      emailSubjectTextareaRef,
      emailGreetingTextareaRef,
      emailBodyTextareaRef,
      emailClosingTextareaRef,
      emailFooterTextareaRef,
    ]) {
      const el = ref.current;
      if (!el) continue;
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [emailSubject, emailGreeting, emailBody, emailClosing, emailFooter]);

  // -------------------------------------------------------------------------
  // Section 1 auto-save: business info
  // -------------------------------------------------------------------------

  /**
   * Executes the PUT /api/salon request for the business info section.
   * Captures field values from the closure at schedule time (no stale-closure
   * risk because `scheduleSalonInfoSave` is recreated on every render).
   *
   * @param name - Current business name value.
   * @param tz   - Current timezone value.
   * @param cur  - Current currency value.
   */
  async function doSalonInfoSave(
    name: string, tz: string, cur: string
  ): Promise<void> {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setSalonInfoError('Business name is required.');
      setSalonInfoSaveStatus('error');
      return;
    }
    if (trimmedName.length > 100) {
      setSalonInfoError('Business name must be 100 characters or fewer.');
      setSalonInfoSaveStatus('error');
      return;
    }

    setSalonInfoError('');
    setSalonInfoSaveStatus('saving');

    try {
      const res = await fetch('/api/salon', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          timezone: tz,
          currency: cur,
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setSalonInfoError(data.error ?? 'Failed to save. Please try again.');
        setSalonInfoSaveStatus('error');
        return;
      }

      setSalonInfoSaveStatus('saved');
      setTimeout(() => setSalonInfoSaveStatus('idle'), 2000);
    } catch {
      setSalonInfoError('Something went wrong. Please check your connection.');
      setSalonInfoSaveStatus('error');
    }
  }

  /**
   * Schedules a debounced save for the business info section.
   * Clears any pending timer before scheduling a new one.
   *
   * @param name - Latest business name value.
   * @param tz   - Latest timezone value.
   * @param cur  - Latest currency value.
   */
  function scheduleSalonInfoSave(
    name: string, tz: string, cur: string
  ): void {
    if (salonInfoTimerRef.current !== null) clearTimeout(salonInfoTimerRef.current);
    setSalonInfoSaveStatus('idle');
    salonInfoTimerRef.current = setTimeout(() => {
      void doSalonInfoSave(name, tz, cur);
    }, 800);
  }

  // -------------------------------------------------------------------------
  // Section 2 auto-save: reminder confirmation toggles
  // -------------------------------------------------------------------------

  /**
   * Executes the PUT /api/salon request for the confirmation toggle section.
   *
   * @param emailEnabled - Current email confirmation toggle value.
   */
  async function doConfirmationSave(
    emailEnabled: boolean
  ): Promise<void> {
    setConfirmError('');
    setConfirmSaveStatus('saving');

    try {
      const res = await fetch('/api/salon', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email_confirmation_enabled: emailEnabled,
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setConfirmError(data.error ?? 'Failed to save. Please try again.');
        setConfirmSaveStatus('error');
        return;
      }

      setConfirmSaveStatus('saved');
      setTimeout(() => setConfirmSaveStatus('idle'), 2000);
    } catch {
      setConfirmError('Something went wrong. Please check your connection.');
      setConfirmSaveStatus('error');
    }
  }

  /**
   * Schedules a debounced save for the confirmation toggles section.
   *
   * @param emailEnabled - Latest email confirmation toggle value.
   */
  function scheduleConfirmationSave(emailEnabled: boolean): void {
    if (confirmTimerRef.current !== null) clearTimeout(confirmTimerRef.current);
    setConfirmSaveStatus('idle');
    confirmTimerRef.current = setTimeout(() => {
      void doConfirmationSave(emailEnabled);
    }, 800);
  }

  // -------------------------------------------------------------------------
  // Section 3 auto-save: message templates
  // -------------------------------------------------------------------------

  /**
   * Executes the PUT /api/salon request for all email template fields.
   *
   * @param footer     - Current email footer value.
   * @param subject    - Current email subject value.
   * @param greeting   - Current email greeting value.
   * @param body       - Current email body value.
   * @param closing    - Current email closing value.
   */
  async function doTemplatesSave(
    footer: string,
    subject: string,
    greeting: string,
    body: string,
    closing: string,
  ): Promise<void> {
    setTemplatesError('');
    setTemplatesSaveStatus('saving');

    try {
      const res = await fetch('/api/salon', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email_footer:    footer.trim()    || null,
          email_subject:   subject.trim()   || null,
          email_greeting:  greeting.trim()  || null,
          email_body:      body.trim()      || null,
          email_closing:   closing.trim()   || null,
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setTemplatesError(data.error ?? 'Failed to save. Please try again.');
        setTemplatesSaveStatus('error');
        return;
      }

      setTemplatesSaveStatus('saved');
      setTimeout(() => setTemplatesSaveStatus('idle'), 2000);
    } catch {
      setTemplatesError('Something went wrong. Please check your connection.');
      setTemplatesSaveStatus('error');
    }
  }

  /**
   * Schedules a debounced save for the email templates section.
   */
  function scheduleTemplatesSave(
    footer: string,
    subject: string,
    greeting: string,
    body: string,
    closing: string,
  ): void {
    if (templatesTimerRef.current !== null) clearTimeout(templatesTimerRef.current);
    setTemplatesSaveStatus('idle');
    templatesTimerRef.current = setTimeout(() => {
      void doTemplatesSave(footer, subject, greeting, body, closing);
    }, 800);
  }

  // -------------------------------------------------------------------------
  // Section 4 auto-save: business hours
  // -------------------------------------------------------------------------

  /**
   * Executes the PUT /api/salon request for business hours.
   * Silently skips the save when the time range is invalid.
   *
   * @param open  - Current opening time value (HH:MM or empty).
   * @param close - Current closing time value (HH:MM or empty).
   */
  async function doHoursSave(open: string, close: string): Promise<void> {
    // Validate before saving — skip silently if the range is invalid.
    if (open && close && open >= close) {
      setHoursError('Closing time must be after opening time.');
      return;
    }

    setHoursError('');
    setHoursSaveStatus('saving');

    try {
      const res = await fetch('/api/salon', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          opening_time: open || null,
          closing_time: close || null,
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setHoursError(data.error ?? 'Failed to save. Please try again.');
        setHoursSaveStatus('error');
        return;
      }

      setHoursSaveStatus('saved');
      setTimeout(() => setHoursSaveStatus('idle'), 2000);
    } catch {
      setHoursError('Something went wrong. Please check your connection.');
      setHoursSaveStatus('error');
    }
  }

  /**
   * Schedules a debounced save for the business hours section.
   *
   * @param open  - Latest opening time value.
   * @param close - Latest closing time value.
   */
  function scheduleHoursSave(open: string, close: string): void {
    if (hoursTimerRef.current !== null) clearTimeout(hoursTimerRef.current);
    setHoursSaveStatus('idle');
    setHoursError('');
    hoursTimerRef.current = setTimeout(() => {
      void doHoursSave(open, close);
    }, 800);
  }

  // -------------------------------------------------------------------------
  // Account deletion
  // -------------------------------------------------------------------------

  /**
   * Permanently deletes the account via DELETE /api/account.
   * Only runs when the user has typed "DELETE" exactly.
   * Redirects to /register after success.
   */
  async function handleDeleteAccount(): Promise<void> {
    if (deleteConfirmText !== 'DELETE') return;

    setIsDeletingAccount(true);
    setDeleteAccountError('');

    try {
      const res = await fetch('/api/account', { method: 'DELETE' });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setDeleteAccountError(data.error ?? 'Failed to delete account. Please try again.');
        return;
      }

      window.location.href = '/register';
    } catch {
      setDeleteAccountError('Something went wrong. Please check your connection.');
    } finally {
      setIsDeletingAccount(false);
    }
  }

  // -------------------------------------------------------------------------
  // Variable insertion helpers
  // -------------------------------------------------------------------------

  /**
   * Inserts a template variable at the current cursor position in a textarea or
   * input element. Falls back to appending if the element has no selection.
   * Uses requestAnimationFrame to restore cursor position after React re-renders.
   *
   * @param elRef    - Ref to the target textarea or input.
   * @param variable - The variable string to insert, e.g. "{client_name}".
   * @param current  - Current field value (used as fallback for insertion position).
   * @param setter   - State setter for the field.
   */
  function insertAtCursor(
    elRef: { current: HTMLTextAreaElement | HTMLInputElement | null },
    variable: string,
    current: string,
    setter: (fn: (prev: string) => string) => void,
  ): void {
    const el    = elRef.current;
    const pos   = el?.selectionStart ?? current.length;
    const end   = el?.selectionEnd   ?? pos;
    setter((prev) => prev.slice(0, pos) + variable + prev.slice(end));
    requestAnimationFrame(() => {
      if (el) {
        el.focus();
        el.setSelectionRange(pos + variable.length, pos + variable.length);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Loading / error states
  // -------------------------------------------------------------------------

  if (loadState === 'loading') {
    return (
      <div className="p-8 lg:p-12 flex items-center justify-center min-h-64">
        <p className="text-sm text-[#8A8680] font-body">Loading settings…</p>
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
  // Derived values for the live preview (recomputed on every render)
  // -------------------------------------------------------------------------

  /** Sample values used in the reminder preview. */
  const PREVIEW_VARS = {
    client_name:   'John',
    business_name: salonName.trim() || 'Your Business',
    service:       'Haircut',
    time:          '10:30 AM',
    date:          'Tomorrow',
  };

  const previewBusiness = PREVIEW_VARS.business_name;

  // Email preview (live — updates as the owner types)
  const activeEmailSubject  = emailSubject.trim()  || DEFAULT_EMAIL_SUBJECT;
  const activeEmailGreeting = emailGreeting.trim() || DEFAULT_EMAIL_GREETING;
  const activeEmailBody     = emailBody.trim()     || DEFAULT_EMAIL_BODY;
  const activeEmailFooter   = emailFooter.trim()   || DEFAULT_EMAIL_FOOTER;
  const activeEmailClosing  = emailClosing.trim()  || DEFAULT_EMAIL_CLOSING;

  const previewEmailSubjectText  = renderPreview(activeEmailSubject,  PREVIEW_VARS);
  const previewEmailGreetingText = renderPreview(activeEmailGreeting, PREVIEW_VARS);
  const previewEmailBodyText     = renderPreview(activeEmailBody,     PREVIEW_VARS);
  const previewEmailFooterText   = renderPreview(activeEmailFooter,   { business_name: previewBusiness });
  const previewEmailClosingText  = renderPreview(activeEmailClosing,  PREVIEW_VARS);

  // Plan-gated feature availability.
  const emailAllowed = planAllowsEmail(plan);

  // -------------------------------------------------------------------------
  // Main render
  // -------------------------------------------------------------------------

  return (
    <div className="p-8 lg:p-12">
      <div className="max-w-2xl space-y-12">

        {/* Page heading */}
        <div>
          <h1 className="font-heading text-3xl font-semibold text-[#1A1A1A]">Settings</h1>
          <p className="text-sm text-[#8A8680] mt-1.5 font-body">
            Manage your business info, reminder templates and hours.
          </p>
        </div>

        {/* ================================================================
            SECTION 1: Business info
            Auto-saves 800 ms after any field change.
        ================================================================ */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-heading text-base font-semibold text-[#1A1A1A]">Business info</h2>
            <SaveIndicator status={salonInfoSaveStatus} />
          </div>

          <div className="bg-white rounded-2xl border border-[#E5E2DB] p-6 space-y-5">

            {/* Business name */}
            <div className="space-y-1.5">
              <FieldLabel htmlFor="salon-name">Business name</FieldLabel>
              <Input
                id="salon-name"
                type="text"
                value={salonName}
                onChange={(e) => {
                  const v = e.target.value;
                  setSalonName(v);
                  scheduleSalonInfoSave(v, timezone, currency);
                }}
                placeholder="e.g. City Dental Clinic"
                maxLength={100}
                className="border-[#E5E2DB] focus-visible:border-[#1B4332] focus-visible:ring-0 text-[#1A1A1A] placeholder:text-[#8A8680]"
              />
              <p className="text-xs text-[#8A8680] font-body">This is the name your clients see in reminder messages.</p>
            </div>

            {/* Timezone */}
            <div className="space-y-1.5">
              <FieldLabel htmlFor="salon-timezone">Timezone</FieldLabel>
              <select
                id="salon-timezone"
                value={timezone}
                onChange={(e) => {
                  const v = e.target.value;
                  setTimezone(v);
                  scheduleSalonInfoSave(salonName, v, currency);
                }}
                className="w-full h-10 rounded-lg border border-[#E5E2DB] px-3 text-sm text-[#1A1A1A] bg-white outline-none focus:border-[#1B4332] transition-colors"
              >
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>
                ))}
              </select>
              <p className="text-xs text-[#8A8680] font-body">All appointment times are shown in this timezone.</p>
            </div>

            {/* Currency */}
            <div className="space-y-1.5">
              <FieldLabel htmlFor="salon-currency">Price currency</FieldLabel>
              <select
                id="salon-currency"
                value={currency}
                onChange={(e) => {
                  const v = e.target.value;
                  setCurrency(v);
                  scheduleSalonInfoSave(salonName, timezone, v);
                }}
                className="w-full h-10 rounded-lg border border-[#E5E2DB] px-3 text-sm text-[#1A1A1A] bg-white outline-none focus:border-[#1B4332] transition-colors"
              >
                {CURRENCY_OPTIONS.map((opt) => (
                  <option key={opt.code} value={opt.code}>{opt.label}</option>
                ))}
              </select>
              <p className="text-xs text-[#8A8680] font-body">Used for displaying service prices on your booking page.</p>
            </div>

          </div>

          {salonInfoError && (
            <div role="alert" className="mt-3 rounded-lg bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700">
              {salonInfoError}
            </div>
          )}
        </section>

        {/* ================================================================
            SECTION 2: Business hours
            Auto-saves 800 ms after any field change (skipped on invalid range).
        ================================================================ */}
        <section>
          <div className="flex items-center justify-between mb-1">
            <h2 className="font-heading text-base font-semibold text-[#1A1A1A]">Business hours</h2>
            <SaveIndicator status={hoursSaveStatus} />
          </div>
          <p className="text-sm text-[#8A8680] mb-4 font-body">
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

        {/* ================================================================
            SECTION 3: Reminder settings
            Plan-gated: email disabled on trial.
            Auto-saves 800 ms after any toggle change.
        ================================================================ */}
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
                <p className="text-sm font-medium text-[#1A1A1A]">Request email confirmation (YES/NO)</p>
                {emailAllowed ? (
                  <p className="text-xs text-[#8A8680] mt-0.5 font-body">
                    When off, email reminders are sent without YES/NO buttons.
                  </p>
                ) : (
                  <p className="text-xs text-amber-600 mt-0.5">
                    Upgrade to any paid plan to enable email reminders.
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

        {/* ================================================================
            SECTION 4: Message templates
            Includes live email preview and full email customisation.
            Auto-saves 800 ms after any field change.
        ================================================================ */}
        <section>
          <div className="flex items-center justify-between mb-1">
            <h2 className="font-heading text-base font-semibold text-[#1A1A1A]">Message templates</h2>
            <SaveIndicator status={templatesSaveStatus} />
          </div>
          <p className="text-sm text-[#8A8680] mb-4 font-body">
            Customise the reminder email sent to your clients. Leave blank to use the default.
          </p>

          {/* ---- Live email preview ---- */}
          <div className="mb-6">
            <p className="text-sm text-[#8A8680] mb-3 font-body">
              Preview (updates as you type)
            </p>

            <div>

              {/* Email preview — matches the actual reminder email layout */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-[#8A8680] uppercase tracking-widest font-body">Email · 24h before</p>
                <div className="border border-[#E5E2DB] rounded-lg overflow-hidden">
                  {/* Black header with salon name */}
                  <div className="bg-[#1A1A1A] rounded-t-lg px-5 py-4">
                    <p className="text-white font-semibold text-base">{previewBusiness}</p>
                  </div>
                  {/* White body */}
                  <div className="bg-white px-5 py-5 space-y-4">
                    {/* Greeting */}
                    <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap break-words">
                      {emailGreeting.trim() ? previewEmailGreetingText : <span className="italic text-[#8A8680]">{renderPreview(DEFAULT_EMAIL_GREETING, PREVIEW_VARS)}</span>}
                    </p>
                    {/* Body message */}
                    <p className="text-sm text-[#8A8680] leading-relaxed whitespace-pre-wrap break-words">
                      {emailBody.trim() ? previewEmailBodyText : <span className="italic">{renderPreview(DEFAULT_EMAIL_BODY, PREVIEW_VARS)}</span>}
                    </p>
                    {/* Appointment details card */}
                    <div className="bg-[#F5F3EF] rounded-lg p-4 space-y-3">
                      <div>
                        <p className="text-[10px] text-[#8A8680] uppercase font-semibold tracking-wide">Service</p>
                        <p className="text-sm text-[#1A1A1A] font-semibold">Haircut</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-[#8A8680] uppercase font-semibold tracking-wide">Date &amp; Time</p>
                        <p className="text-sm text-[#1A1A1A] font-semibold">Monday, June 16 at 2:00 PM</p>
                      </div>
                    </div>
                    {/* Confirm prompt + buttons */}
                    {emailConfirmationEnabled && emailAllowed ? (
                      <>
                        <p className="text-sm text-[#8A8680]">Please confirm or cancel your appointment below.</p>
                        <div className="flex gap-3">
                          <span className="inline-block bg-[#1B4332] text-white rounded-lg px-4 py-2.5 text-sm font-semibold">YES, I&apos;ll be there</span>
                          <span className="inline-block bg-[#DC2626] text-white rounded-lg px-4 py-2.5 text-sm font-semibold">NO, cancel it</span>
                        </div>
                      </>
                    ) : (
                      <p className="text-sm text-[#8A8680] whitespace-pre-wrap break-words">
                        {emailClosing.trim() ? previewEmailClosingText : <span className="italic">{renderPreview(DEFAULT_EMAIL_CLOSING, PREVIEW_VARS)}</span>}
                      </p>
                    )}
                    {/* Closing (shown when confirmation buttons are present) */}
                    {emailConfirmationEnabled && emailAllowed && (
                      <p className="text-sm text-[#8A8680] whitespace-pre-wrap break-words">
                        {emailClosing.trim() ? previewEmailClosingText : <span className="italic">{renderPreview(DEFAULT_EMAIL_CLOSING, PREVIEW_VARS)}</span>}
                      </p>
                    )}
                    {/* Divider + footer */}
                    <div className="border-t border-[#E5E2DB] pt-3">
                      <p className="text-xs text-[#8A8680] whitespace-pre-wrap break-words font-body">
                        {emailFooter.trim() ? previewEmailFooterText : <span className="italic">{renderPreview(DEFAULT_EMAIL_FOOTER, { business_name: previewBusiness })}</span>}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

            </div>
          </div>

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

        {/* ================================================================
            SECTION 5: Delete account
        ================================================================ */}
        <section>
          <h2 className="text-base font-semibold text-red-600 mb-1">Delete account</h2>
          <p className="text-sm text-[#8A8680] mb-4 font-body">
            Permanently deletes your business data, all appointments, all clients, and all reminders.
            This cannot be undone.
          </p>

          <div className="bg-white rounded-2xl border border-red-100 p-6">

            {!showDeleteDialog ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowDeleteDialog(true);
                  setDeleteConfirmText('');
                  setDeleteAccountError('');
                }}
                className="border-red-300 text-red-600 hover:bg-red-50 hover:border-red-400 text-sm"
              >
                Delete my account
              </Button>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-[#1A1A1A]">
                  This will permanently delete your business data, all appointments, all clients, and all reminders.
                  This cannot be undone. Type <strong>DELETE</strong> to confirm.
                </p>

                <Input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => {
                    setDeleteConfirmText(e.target.value);
                    if (deleteAccountError) setDeleteAccountError('');
                  }}
                  placeholder="Type DELETE to confirm"
                  disabled={isDeletingAccount}
                  className="border-[#C8C8C8] focus-visible:border-red-400 focus-visible:ring-0 text-[#1A1A1A]"
                />

                {deleteAccountError && (
                  <div role="alert" className="rounded-lg bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700">
                    {deleteAccountError}
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    onClick={handleDeleteAccount}
                    disabled={deleteConfirmText !== 'DELETE' || isDeletingAccount}
                    className="bg-red-600 hover:bg-red-700 text-white text-sm disabled:opacity-40"
                  >
                    {isDeletingAccount ? 'Deleting…' : 'Yes, delete everything'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowDeleteDialog(false);
                      setDeleteConfirmText('');
                      setDeleteAccountError('');
                    }}
                    disabled={isDeletingAccount}
                    className="border-[#E5E2DB] text-[#1A1A1A] text-sm"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

          </div>
        </section>

      </div>
    </div>
  );
}
