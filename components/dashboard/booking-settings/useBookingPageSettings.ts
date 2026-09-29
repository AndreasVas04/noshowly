/**
 * components/dashboard/booking-settings/useBookingPageSettings.ts
 *
 * State and handlers of the "Booking page" section of the booking settings
 * page (BookingPageSection) and of its publish controls (PublishSection):
 *  - Create flow: choose the URL slug and create the page
 *    (POST /api/booking-page; a new page starts offline).
 *  - Edit flow: headline, description, link preview description and the
 *    required client contact fields, auto-saved with PUT /api/booking-page.
 *  - Go live / take offline (PUT /api/booking-page with is_active) and
 *    "Copy link".
 *
 * Auto-save runs 800 ms after the last change, one save at a time: a change
 * made while a save is in flight queues one more save with the latest values.
 * A finished save only applies server values to fields the owner has not
 * changed since the request was sent.
 */

'use client';

import { useState, useEffect, useRef, useCallback, FormEvent } from 'react';
import { applySavedText, type SaveStatus } from '@/components/dashboard/booking-settings/form-state';
import type { BookingPage } from '@/types';

/**
 * Owns the booking page settings: the saved booking page, the form fields,
 * their auto-save and the live toggle.
 *
 * @returns The state, setters and handlers used by BookingPageSection and
 *          PublishSection, plus initBookingPage for the initial load.
 */
export function useBookingPageSettings() {
  // -------------------------------------------------------------------------
  // Section 1: Booking page settings
  // -------------------------------------------------------------------------
  const [bookingPage, setBookingPage] = useState<BookingPage | null>(null);
  const [bookingSlug, setBookingSlug] = useState('');
  const [bookingDescription, setBookingDescription] = useState('');
  const [customPageTitle, setCustomPageTitle] = useState('');
  const [customIntro, setCustomIntro] = useState('');
  const [requirePhone, setRequirePhone] = useState(true);
  const [requireEmail, setRequireEmail] = useState(true);
  const [requireFieldsError, setRequireFieldsError] = useState('');
  const [bookingSaveStatus, setBookingSaveStatus] = useState<SaveStatus>('idle');
  const [bookingError, setBookingError] = useState('');
  const [copied, setCopied] = useState(false);

  /** Refs to the booking page description/intro textareas — used for auto-resize. */
  const customIntroRef = useRef<HTMLTextAreaElement | null>(null);
  const bookingDescRef = useRef<HTMLTextAreaElement | null>(null);

  /** Debounce timer for booking page settings auto-save. */
  const bookingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Ref that always holds the latest doSaveBookingPage closure.
   * The debounce timer reads from this ref so it always calls the freshest version
   * of the function (avoids stale-closure issues with toggled boolean state).
   */
  const doSaveBookingPageRef = useRef<() => Promise<void>>(async () => {});
  /** True while a booking page settings save is in flight; another change queues one more save. */
  const bookingSaveInFlightRef = useRef(false);
  const bookingSaveQueuedRef = useRef(false);

  /**
   * Auto-resizes the booking page description and intro textareas whenever
   * their content changes (e.g. initial data load or user edits).
   */
  useEffect(() => {
    for (const el of [customIntroRef.current, bookingDescRef.current]) {
      if (!el) continue;
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    }
  }, [customIntro, bookingDescription]);

  /**
   * Applies the booking page loaded on mount: stores it and, when the salon
   * has one, starts the form from its saved settings.
   *
   * @param bp - The salon's booking page, or null when it has none yet.
   */
  const initBookingPage = useCallback((bp: BookingPage | null): void => {
    setBookingPage(bp);
    if (bp) {
      setBookingSlug(bp.slug);
      setBookingDescription(bp.description ?? '');
      setCustomPageTitle(bp.custom_title ?? '');
      setCustomIntro(bp.custom_intro ?? '');
      setRequirePhone(bp.require_phone ?? true);
      setRequireEmail(bp.require_email ?? true);
    }
  }, []);

  // -------------------------------------------------------------------------
  // Section 1 handlers: Booking page settings
  // -------------------------------------------------------------------------

  /**
   * Creates or updates the booking page via POST or PUT /api/booking-page.
   *
   * @param e - Form submit event.
   */
  async function handleBookingSave(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setBookingError('');
    setRequireFieldsError('');

    const slug = bookingSlug.trim().toLowerCase();
    if (!slug) { setBookingError('URL slug is required.'); return; }
    if (slug.length < 3 || slug.length > 50) { setBookingError('Slug must be between 3 and 50 characters.'); return; }
    if (!/^[a-z0-9-]+$/.test(slug)) { setBookingError('Slug may only contain lowercase letters, digits, and hyphens.'); return; }
    if (!requirePhone && !requireEmail) {
      setRequireFieldsError('At least one contact field (phone or email) must be required.');
      return;
    }

    setBookingSaveStatus('saving');

    try {
      const method = bookingPage ? 'PUT' : 'POST';
      const res = await fetch('/api/booking-page', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          description: bookingDescription.trim() || null,
          custom_title: customPageTitle.trim() || null,
          custom_intro: customIntro.trim() || null,
          require_phone: requirePhone,
          require_email: requireEmail,
          ...(bookingPage ? {} : { is_active: false }),
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setBookingError(data.error ?? 'Failed to save. Please try again.');
        setBookingSaveStatus('error');
        return;
      }

      const data = (await res.json()) as { bookingPage: BookingPage };
      setBookingPage(data.bookingPage);
      setBookingSlug(data.bookingPage.slug);
      setBookingDescription(data.bookingPage.description ?? '');
      setCustomPageTitle(data.bookingPage.custom_title ?? '');
      setCustomIntro(data.bookingPage.custom_intro ?? '');
      setRequirePhone(data.bookingPage.require_phone ?? true);
      setRequireEmail(data.bookingPage.require_email ?? true);
      setBookingSaveStatus('saved');
      setTimeout(() => setBookingSaveStatus('idle'), 2000);
    } catch {
      setBookingError('Something went wrong. Please check your connection and try again.');
      setBookingSaveStatus('error');
    }
  }

  /**
   * Toggles the booking page's is_active flag via PUT /api/booking-page.
   *
   * @param active - New desired active state.
   */
  async function handleBookingToggle(active: boolean): Promise<void> {
    if (!bookingPage) return;

    try {
      const res = await fetch('/api/booking-page', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: active }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        alert(data.error ?? 'Failed to update. Please try again.');
        return;
      }

      const data = (await res.json()) as { bookingPage: BookingPage };
      setBookingPage(data.bookingPage);
    } catch {
      alert('Something went wrong. Please check your connection and try again.');
    }
  }

  /** Copies the booking page URL to the clipboard. */
  async function handleCopyLink(): Promise<void> {
    if (!bookingPage) return;
    const url = `${window.location.origin}/book/${bookingPage.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert(`Your booking link: ${url}`);
    }
  }

  // -------------------------------------------------------------------------
  // Auto-save helpers
  // -------------------------------------------------------------------------

  /**
   * Saves booking page settings via PUT /api/booking-page.
   * Called by the debounce timer — only runs when a booking page already exists.
   * Does not take a form event; reads state directly from closure.
   */
  async function doSaveBookingPage(): Promise<void> {
    if (!bookingPage) return;
    setBookingError('');
    setRequireFieldsError('');

    // Validate that at least one contact method is required.
    if (!requirePhone && !requireEmail) {
      setRequireFieldsError('At least one contact field (phone or email) must be required.');
      return;
    }

    setBookingSaveStatus('saving');

    // Values as sent — fields changed after this point keep the newer input.
    const sent = {
      description:   bookingDescription,
      custom_title:  customPageTitle,
      custom_intro:  customIntro,
      require_phone: requirePhone,
      require_email: requireEmail,
    };

    try {
      const res = await fetch('/api/booking-page', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description:                sent.description.trim() || null,
          custom_title:               sent.custom_title.trim() || null,
          custom_intro:               sent.custom_intro.trim() || null,
          require_phone:              sent.require_phone,
          require_email:              sent.require_email,
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setBookingError(data.error ?? 'Failed to save. Please try again.');
        setBookingSaveStatus('error');
        return;
      }

      const data = (await res.json()) as { bookingPage: BookingPage };
      const saved = data.bookingPage;
      setBookingPage(saved);
      setBookingDescription((current) => applySavedText(current, sent.description, saved.description ?? ''));
      setCustomPageTitle((current) => applySavedText(current, sent.custom_title, saved.custom_title ?? ''));
      setCustomIntro((current) => applySavedText(current, sent.custom_intro, saved.custom_intro ?? ''));
      setRequirePhone((current) => (current === sent.require_phone ? (saved.require_phone ?? true) : current));
      setRequireEmail((current) => (current === sent.require_email ? (saved.require_email ?? true) : current));
      setBookingSaveStatus('saved');
      setTimeout(() => setBookingSaveStatus('idle'), 2000);
    } catch {
      setBookingError('Something went wrong. Please check your connection and try again.');
      setBookingSaveStatus('error');
    }
  }

  /**
   * Schedules an auto-save of booking page settings after 800 ms of inactivity.
   * Clears any previously pending save before scheduling a new one.
   * Uses doSaveBookingPageRef to avoid stale-closure issues.
   */
  function scheduleBookingSave(): void {
    if (bookingDebounceRef.current) clearTimeout(bookingDebounceRef.current);
    bookingDebounceRef.current = setTimeout(() => {
      void runBookingSave();
    }, 800);
  }

  /**
   * Runs one booking page save at a time. A change made while a save is in
   * flight queues one more save with the latest values, so an older request
   * can never finish after (and overwrite) a newer one.
   */
  async function runBookingSave(): Promise<void> {
    if (bookingSaveInFlightRef.current) {
      bookingSaveQueuedRef.current = true;
      return;
    }
    bookingSaveInFlightRef.current = true;
    try {
      await doSaveBookingPageRef.current();
    } finally {
      bookingSaveInFlightRef.current = false;
      if (bookingSaveQueuedRef.current) {
        bookingSaveQueuedRef.current = false;
        void runBookingSave();
      }
    }
  }

  // Keep the latest save function in a ref for the debounce timer. This
  // prevents stale-closure bugs when boolean state (toggles) changes and the
  // timeout fires after a single-event onChange.
  useEffect(() => {
    doSaveBookingPageRef.current = doSaveBookingPage;
  });

  return {
    bookingPage,
    bookingSlug,
    setBookingSlug,
    bookingDescription,
    setBookingDescription,
    customPageTitle,
    setCustomPageTitle,
    customIntro,
    setCustomIntro,
    requirePhone,
    setRequirePhone,
    requireEmail,
    setRequireEmail,
    requireFieldsError,
    setRequireFieldsError,
    bookingSaveStatus,
    bookingError,
    setBookingError,
    copied,
    customIntroRef,
    bookingDescRef,
    initBookingPage,
    handleBookingSave,
    handleBookingToggle,
    handleCopyLink,
    scheduleBookingSave,
  };
}

/** State and handlers returned by useBookingPageSettings. */
export type BookingPageSettings = ReturnType<typeof useBookingPageSettings>;
