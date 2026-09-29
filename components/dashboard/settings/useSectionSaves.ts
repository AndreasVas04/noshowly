/**
 * components/dashboard/settings/useSectionSaves.ts
 *
 * Auto-save of the Settings page sections. Each section saves on its own
 * with PUT /api/salon, 800 ms after its last change, and reports its state
 * for the SaveIndicator in its header: 'saving' while the request is in
 * flight, then 'saved' for 2 s, or 'error' with a message shown in the
 * section.
 *
 *  - useBusinessInfoSave:  name, timezone and currency (the name is checked first).
 *  - useBusinessHoursSave: opening and closing time (nothing is sent for an invalid range).
 *  - useConfirmationSave:  the email confirmation toggle.
 *  - useTemplatesSave:     the email template fields (blank fields are sent as null).
 *
 * Each change passes the values to save to the section's schedule function;
 * a newer change replaces the pending save.
 */

'use client';

import { useState, useRef } from 'react';
import {
  businessHoursError,
  salonNameError,
  type SaveStatus,
} from '@/components/dashboard/settings/settings-helpers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Section 1 auto-save: state and scheduler. */
export type BusinessInfoSave = {
  salonInfoSaveStatus: SaveStatus;
  /** Error shown below the section; empty when there is none. */
  salonInfoError: string;
  scheduleSalonInfoSave: (name: string, tz: string, cur: string) => void;
};

/** Section 2 auto-save: state and scheduler. */
export type BusinessHoursSave = {
  hoursSaveStatus: SaveStatus;
  /** Error shown in the section; empty when there is none. */
  hoursError: string;
  scheduleHoursSave: (open: string, close: string) => void;
};

/** Section 3 auto-save: state and scheduler. */
export type ConfirmationSave = {
  confirmSaveStatus: SaveStatus;
  /** Error shown in the section; empty when there is none. */
  confirmError: string;
  scheduleConfirmationSave: (emailEnabled: boolean) => void;
};

/** Section 4 auto-save: state and scheduler. */
export type TemplatesSave = {
  templatesSaveStatus: SaveStatus;
  /** Error shown below the section; empty when there is none. */
  templatesError: string;
  scheduleTemplatesSave: (
    footer: string,
    subject: string,
    greeting: string,
    body: string,
    closing: string,
  ) => void;
};

// ---------------------------------------------------------------------------
// Section 1 auto-save: business info
// ---------------------------------------------------------------------------

/**
 * Auto-save of the business info section (name, timezone, currency).
 *
 * @returns The save state, the error and the scheduler.
 */
export function useBusinessInfoSave(): BusinessInfoSave {
  const [salonInfoSaveStatus, setSalonInfoSaveStatus] = useState<SaveStatus>('idle');
  const [salonInfoError, setSalonInfoError]           = useState('');
  /** Debounce timer for the business info section. */
  const salonInfoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    const nameError = salonNameError(trimmedName);
    if (nameError) {
      setSalonInfoError(nameError);
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

  return { salonInfoSaveStatus, salonInfoError, scheduleSalonInfoSave };
}

// ---------------------------------------------------------------------------
// Section 2 auto-save: business hours
// ---------------------------------------------------------------------------

/**
 * Auto-save of the business hours section (opening and closing time).
 *
 * @returns The save state, the error and the scheduler.
 */
export function useBusinessHoursSave(): BusinessHoursSave {
  const [hoursSaveStatus, setHoursSaveStatus] = useState<SaveStatus>('idle');
  const [hoursError, setHoursError]           = useState('');
  /** Debounce timer for the business hours section. */
  const hoursTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Executes the PUT /api/salon request for business hours.
   * Silently skips the save when the time range is invalid.
   *
   * @param open  - Current opening time value (HH:MM or empty).
   * @param close - Current closing time value (HH:MM or empty).
   */
  async function doHoursSave(open: string, close: string): Promise<void> {
    // Validate before saving — skip silently if the range is invalid.
    const rangeError = businessHoursError(open, close);
    if (rangeError) {
      setHoursError(rangeError);
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

  return { hoursSaveStatus, hoursError, scheduleHoursSave };
}

// ---------------------------------------------------------------------------
// Section 3 auto-save: reminder confirmation toggles
// ---------------------------------------------------------------------------

/**
 * Auto-save of the reminder settings section (the email confirmation toggle).
 *
 * @returns The save state, the error and the scheduler.
 */
export function useConfirmationSave(): ConfirmationSave {
  const [confirmSaveStatus, setConfirmSaveStatus] = useState<SaveStatus>('idle');
  const [confirmError, setConfirmError]           = useState('');
  /** Debounce timer for the reminder settings section. */
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  return { confirmSaveStatus, confirmError, scheduleConfirmationSave };
}

// ---------------------------------------------------------------------------
// Section 4 auto-save: message templates
// ---------------------------------------------------------------------------

/**
 * Auto-save of the message templates section (the email template fields).
 *
 * @returns The save state, the error and the scheduler.
 */
export function useTemplatesSave(): TemplatesSave {
  const [templatesSaveStatus, setTemplatesSaveStatus] = useState<SaveStatus>('idle');
  const [templatesError, setTemplatesError]           = useState('');
  /** Debounce timer for the message templates section. */
  const templatesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  return { templatesSaveStatus, templatesError, scheduleTemplatesSave };
}
