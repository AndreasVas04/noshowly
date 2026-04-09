/**
 * app/dashboard/settings/page.tsx
 *
 * Dashboard Settings page.
 *
 * Three sections:
 *  1. Salon info — name, phone, timezone, SMS sender name.
 *  2. Business hours — opening and closing time.
 *  3. Team (Barbers) — list existing barbers, add new ones, delete them.
 *
 * This is a Client Component because it manages local form state and makes
 * fetch() calls to the API routes on change. All data mutations go through
 * API routes — never direct Supabase calls from here (CLAUDE.md rule §11).
 *
 * Data flow:
 *  - On mount: GET /api/salon, GET /api/barbers, GET /api/services populate the form.
 *  - Salon save: PUT /api/salon with the salon info values.
 *  - Hours save: PUT /api/salon with opening_time and closing_time.
 *  - Add barber: POST /api/barbers → prepend to local list.
 *  - Delete barber: DELETE /api/barbers/[id] → remove from local list.
 *
 * Security:
 *  - All mutations are authenticated server-side in the API routes.
 *  - This page never constructs or sends salon_id — the server derives it from the session.
 */

'use client';

import { useState, useEffect, FormEvent } from 'react';
import type { Salon, Barber, Service } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Loading state for the initial data fetch. */
type LoadState = 'loading' | 'ready' | 'error';

/** Status of an async form submission. */
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

// ---------------------------------------------------------------------------
// Common UI helpers (inline to avoid creating a separate file for one page)
// ---------------------------------------------------------------------------

/** Thin label above a form field. */
function FieldLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-700 mb-1">
      {children}
    </label>
  );
}

/** Standard text input styled to match the rest of the app. */
function TextInput({
  id,
  value,
  onChange,
  placeholder,
  disabled,
  maxLength,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
}) {
  return (
    <input
      id={id}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      maxLength={maxLength}
      className="
        w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900
        placeholder:text-gray-400
        focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent
        disabled:bg-gray-50 disabled:text-gray-400
        transition
      "
    />
  );
}

// ---------------------------------------------------------------------------
// Common timezones for the dropdown
// A complete list would be very long; this covers >95% of NoShowly's target markets.
// ---------------------------------------------------------------------------

const COMMON_TIMEZONES = [
  // North America
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
  // UK & Ireland
  'Europe/London',
  'Europe/Dublin',
  // Western Europe
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
  // Eastern Europe
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
  // Asia-Pacific
  'Asia/Tokyo',
  'Asia/Singapore',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Australia/Brisbane',
  'Australia/Perth',
  'Pacific/Auckland',
] as const;

// ---------------------------------------------------------------------------
// Settings page
// ---------------------------------------------------------------------------

/**
 * SettingsPage — main export.
 *
 * Manages two independent sections: salon info and barber list.
 * Each section has its own loading/save state to keep them independent.
 *
 * @returns The settings page JSX.
 */
export default function SettingsPage() {
  // -------------------------------------------------------------------------
  // Salon form state
  // -------------------------------------------------------------------------
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [salonName, setSalonName] = useState('');
  const [phone, setPhone] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [smsSenderName, setSmsSenderName] = useState('');
  const [salonSaveStatus, setSalonSaveStatus] = useState<SaveStatus>('idle');
  const [salonError, setSalonError] = useState('');

  // -------------------------------------------------------------------------
  // Business hours state
  // -------------------------------------------------------------------------
  const [openingTime, setOpeningTime] = useState('09:00');
  const [closingTime, setClosingTime] = useState('20:00');
  const [hoursSaveStatus, setHoursSaveStatus] = useState<SaveStatus>('idle');
  const [hoursError, setHoursError] = useState('');

  // -------------------------------------------------------------------------
  // Barbers state
  // -------------------------------------------------------------------------
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [newBarberName, setNewBarberName] = useState('');
  const [addingBarber, setAddingBarber] = useState(false);
  const [addBarberError, setAddBarberError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Services state
  // -------------------------------------------------------------------------
  const [services, setServices] = useState<Service[]>([]);
  const [newServiceName, setNewServiceName] = useState('');
  const [addingService, setAddingService] = useState(false);
  const [addServiceError, setAddServiceError] = useState('');
  const [deletingServiceId, setDeletingServiceId] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Account deletion state
  // -------------------------------------------------------------------------
  /** Whether the delete confirmation dialog is open. */
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  /** The typed confirmation word — must equal "DELETE" to enable the button. */
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  /** True while the deletion API call is in flight. */
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  /** Error message from the deletion attempt. */
  const [deleteAccountError, setDeleteAccountError] = useState('');

  // -------------------------------------------------------------------------
  // Initial data load — runs once on mount
  // -------------------------------------------------------------------------

  /**
   * Fetches salon info and barbers in parallel on component mount.
   * Populates the form fields with the current saved values.
   */
  useEffect(() => {
    async function loadData() {
      try {
        const [salonRes, barbersRes, servicesRes] = await Promise.all([
          fetch('/api/salon'),
          fetch('/api/barbers'),
          fetch('/api/services'),
        ]);

        if (!salonRes.ok) {
          setLoadState('error');
          return;
        }

        const salonData = (await salonRes.json()) as { salon: Salon };
        const salon = salonData.salon;

        setSalonName(salon.name ?? '');
        setPhone(salon.phone ?? '');
        setTimezone(salon.timezone ?? 'UTC');
        setSmsSenderName(salon.sms_sender_name ?? '');
        setOpeningTime(salon.opening_time ?? '09:00');
        setClosingTime(salon.closing_time ?? '20:00');

        if (barbersRes.ok) {
          const barbersData = (await barbersRes.json()) as { barbers: Barber[] };
          setBarbers(barbersData.barbers ?? []);
        }

        if (servicesRes.ok) {
          const servicesData = (await servicesRes.json()) as { services: Service[] };
          setServices(servicesData.services ?? []);
        }

        setLoadState('ready');
      } catch {
        setLoadState('error');
      }
    }

    void loadData();
  }, []);

  // -------------------------------------------------------------------------
  // Salon save handler
  // -------------------------------------------------------------------------

  /**
   * Submits the salon info form via PUT /api/salon.
   * Shows a brief "Saved!" confirmation before resetting to idle.
   *
   * @param e - Form submit event.
   */
  async function handleSalonSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSalonError('');

    // Client-side validation before hitting the API
    const trimmedName = salonName.trim();
    if (!trimmedName) {
      setSalonError('Salon name is required.');
      return;
    }
    if (trimmedName.length > 100) {
      setSalonError('Salon name must be 100 characters or fewer.');
      return;
    }

    setSalonSaveStatus('saving');

    try {
      const res = await fetch('/api/salon', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          phone: phone.trim() || null,
          timezone,
          sms_sender_name: smsSenderName.trim() || null,
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setSalonError(data.error ?? 'Failed to save. Please try again.');
        setSalonSaveStatus('error');
        return;
      }

      // Update local form state with the saved values from the server response
      const { salon } = (await res.json()) as { salon: Salon };
      setSalonName(salon.name ?? '');
      setPhone(salon.phone ?? '');
      setTimezone(salon.timezone ?? 'UTC');
      setSmsSenderName(salon.sms_sender_name ?? '');
      setOpeningTime(salon.opening_time ?? '09:00');
      setClosingTime(salon.closing_time ?? '20:00');

      setSalonSaveStatus('saved');
      // Reset the "Saved!" indicator after 2 seconds
      setTimeout(() => setSalonSaveStatus('idle'), 2000);
    } catch {
      setSalonError('Something went wrong. Please check your connection and try again.');
      setSalonSaveStatus('error');
    }
  }

  // -------------------------------------------------------------------------
  // Business hours save handler
  // -------------------------------------------------------------------------

  /**
   * Submits the business hours form via PUT /api/salon.
   * Validates that closing time is after opening time before saving.
   *
   * @param e - Form submit event.
   */
  async function handleHoursSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setHoursError('');

    // Client-side validation: closing time must be after opening time.
    if (openingTime && closingTime && openingTime >= closingTime) {
      setHoursError('Closing time must be after opening time.');
      return;
    }

    setHoursSaveStatus('saving');

    try {
      const res = await fetch('/api/salon', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          opening_time: openingTime || null,
          closing_time: closingTime || null,
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setHoursError(data.error ?? 'Failed to save. Please try again.');
        setHoursSaveStatus('error');
        return;
      }

      const { salon } = (await res.json()) as { salon: Salon };
      setOpeningTime(salon.opening_time ?? '09:00');
      setClosingTime(salon.closing_time ?? '20:00');

      setHoursSaveStatus('saved');
      setTimeout(() => setHoursSaveStatus('idle'), 2000);
    } catch {
      setHoursError('Something went wrong. Please check your connection and try again.');
      setHoursSaveStatus('error');
    }
  }

  // -------------------------------------------------------------------------
  // Add barber handler
  // -------------------------------------------------------------------------

  /**
   * Adds a new barber via POST /api/barbers.
   * Prepends the new barber to the local list on success.
   *
   * @param e - Form submit event.
   */
  async function handleAddBarber(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAddBarberError('');

    const trimmedName = newBarberName.trim();
    if (!trimmedName) {
      setAddBarberError('Name is required.');
      return;
    }
    if (trimmedName.length > 50) {
      setAddBarberError('Name must be 50 characters or fewer.');
      return;
    }

    setAddingBarber(true);

    try {
      const res = await fetch('/api/barbers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setAddBarberError(data.error ?? 'Failed to add staff. Please try again.');
        return;
      }

      const { barber } = (await res.json()) as { barber: Barber };
      // Append then re-sort alphabetically to match server order
      setBarbers((prev) =>
        [...prev, barber].sort((a, b) => a.name.localeCompare(b.name))
      );
      setNewBarberName(''); // Clear input on success
    } catch {
      setAddBarberError('Something went wrong. Please try again.');
    } finally {
      setAddingBarber(false);
    }
  }

  // -------------------------------------------------------------------------
  // Delete barber handler
  // -------------------------------------------------------------------------

  /**
   * Deletes a barber via DELETE /api/barbers/[id].
   * Removes the barber from the local list optimistically on success.
   *
   * @param barberId - The UUID of the barber to delete.
   * @param barberName - Used in the confirmation prompt.
   */
  async function handleDeleteBarber(barberId: string, barberName: string) {
    // Confirm before deleting — destructive action
    if (!window.confirm(`Remove "${barberName}" from your team? This cannot be undone.`)) {
      return;
    }

    setDeletingId(barberId);

    try {
      const res = await fetch(`/api/barbers/${barberId}`, { method: 'DELETE' });

      if (!res.ok) {
        // If delete failed, leave the list unchanged — don't optimistically remove
        const data = (await res.json()) as { error?: string };
        alert(data.error ?? 'Failed to remove staff. Please try again.');
        return;
      }

      // Remove from local list
      setBarbers((prev) => prev.filter((b) => b.id !== barberId));
    } catch {
      alert('Something went wrong. Please check your connection and try again.');
    } finally {
      setDeletingId(null);
    }
  }

  // -------------------------------------------------------------------------
  // Add service handler
  // -------------------------------------------------------------------------

  /**
   * Adds a new service via POST /api/services.
   * Appends the new service to the local list on success.
   *
   * @param e - Form submit event.
   */
  async function handleAddService(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAddServiceError('');

    const trimmedName = newServiceName.trim();
    if (!trimmedName) {
      setAddServiceError('Name is required.');
      return;
    }
    if (trimmedName.length > 50) {
      setAddServiceError('Name must be 50 characters or fewer.');
      return;
    }

    setAddingService(true);

    try {
      const res = await fetch('/api/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setAddServiceError(data.error ?? 'Failed to add service. Please try again.');
        return;
      }

      const { service } = (await res.json()) as { service: Service };
      setServices((prev) =>
        [...prev, service].sort((a, b) => a.name.localeCompare(b.name))
      );
      setNewServiceName('');
    } catch {
      setAddServiceError('Something went wrong. Please try again.');
    } finally {
      setAddingService(false);
    }
  }

  // -------------------------------------------------------------------------
  // Delete service handler
  // -------------------------------------------------------------------------

  /**
   * Deletes a service via DELETE /api/services/[id].
   * Removes the service from the local list on success.
   *
   * @param serviceId   - The UUID of the service to delete.
   * @param serviceName - Used in the confirmation prompt.
   */
  async function handleDeleteService(serviceId: string, serviceName: string) {
    if (!window.confirm(`Remove "${serviceName}"? This cannot be undone.`)) {
      return;
    }

    setDeletingServiceId(serviceId);

    try {
      const res = await fetch(`/api/services/${serviceId}`, { method: 'DELETE' });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        alert(data.error ?? 'Failed to remove service. Please try again.');
        return;
      }

      setServices((prev) => prev.filter((s) => s.id !== serviceId));
    } catch {
      alert('Something went wrong. Please check your connection and try again.');
    } finally {
      setDeletingServiceId(null);
    }
  }

  // -------------------------------------------------------------------------
  // Account deletion handler
  // -------------------------------------------------------------------------

  /**
   * Calls DELETE /api/account to permanently remove the account and all data.
   * Only runs when the user has typed "DELETE" exactly to confirm.
   * Redirects to /register after successful deletion.
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

      // Redirect to registration page — session is now invalid.
      window.location.href = '/register';
    } catch {
      setDeleteAccountError('Something went wrong. Please check your connection and try again.');
    } finally {
      setIsDeletingAccount(false);
    }
  }

  // -------------------------------------------------------------------------
  // Render — loading / error states
  // -------------------------------------------------------------------------

  if (loadState === 'loading') {
    return (
      <div className="p-6 lg:p-10 flex items-center justify-center min-h-64">
        <p className="text-sm text-gray-400">Loading settings…</p>
      </div>
    );
  }

  if (loadState === 'error') {
    return (
      <div className="p-6 lg:p-10">
        <div className="max-w-2xl bg-red-50 border border-red-200 rounded-2xl p-6">
          <p className="text-sm text-red-700 font-medium">Failed to load settings.</p>
          <p className="text-sm text-red-600 mt-1">
            Please refresh the page. If the problem persists, contact support.
          </p>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render — main settings UI
  // -------------------------------------------------------------------------

  const isSalonSaving = salonSaveStatus === 'saving';

  return (
    <div className="p-6 lg:p-10">
      <div className="max-w-2xl space-y-10">

        {/* Page heading */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="text-sm text-gray-500 mt-1">Manage your salon info, hours, and team.</p>
        </div>

        {/* ==================================================================
            SECTION 1: Salon Info
        ================================================================== */}
        <section>
          <h2 className="text-base font-semibold text-gray-900 mb-4">Salon info</h2>

          <form onSubmit={handleSalonSave} noValidate className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5">

            {/* Salon name */}
            <div>
              <FieldLabel htmlFor="salon-name">Salon name</FieldLabel>
              <TextInput
                id="salon-name"
                value={salonName}
                onChange={setSalonName}
                placeholder="e.g. Salon Elena"
                disabled={isSalonSaving}
                maxLength={100}
              />
              <p className="mt-1 text-xs text-gray-400">
                This is the name your clients see in reminder messages.
              </p>
            </div>

            {/* Phone */}
            <div>
              <FieldLabel htmlFor="salon-phone">Salon phone (optional)</FieldLabel>
              <TextInput
                id="salon-phone"
                value={phone}
                onChange={setPhone}
                placeholder="e.g. +1 555 000 0000"
                disabled={isSalonSaving}
                maxLength={20}
              />
              <p className="mt-1 text-xs text-gray-400">
                Your salon&apos;s contact number — not used for sending reminders.
              </p>
            </div>

            {/* Timezone */}
            <div>
              <FieldLabel htmlFor="salon-timezone">Timezone</FieldLabel>
              <select
                id="salon-timezone"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                disabled={isSalonSaving}
                className="
                  w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900
                  focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent
                  disabled:bg-gray-50 disabled:text-gray-400
                  transition bg-white
                "
              >
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-400">
                All appointment times are shown in this timezone.
              </p>
            </div>

            {/* SMS sender name */}
            <div>
              <FieldLabel htmlFor="sms-sender-name">SMS sender name (optional)</FieldLabel>
              <TextInput
                id="sms-sender-name"
                value={smsSenderName}
                onChange={setSmsSenderName}
                placeholder="e.g. Salon Elena"
                disabled={isSalonSaving}
                maxLength={50}
              />
              <p className="mt-1 text-xs text-gray-400">
                Shown in SMS messages: &quot;Hi, reminder from [name]…&quot;
                Defaults to your salon name if left blank.
              </p>
            </div>

            {/* Error */}
            {salonError && (
              <div
                role="alert"
                className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
              >
                {salonError}
              </div>
            )}

            {/* Save button */}
            <div className="flex items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={isSalonSaving}
                className="
                  rounded-lg bg-black text-white text-sm font-medium
                  px-5 py-2.5
                  hover:bg-gray-800
                  focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2
                  disabled:opacity-50 disabled:cursor-not-allowed
                  transition
                "
              >
                {isSalonSaving ? 'Saving…' : 'Save changes'}
              </button>

              {/* Inline "Saved!" confirmation — appears briefly after a successful save */}
              {salonSaveStatus === 'saved' && (
                <span className="text-sm text-green-600 font-medium">Saved!</span>
              )}
            </div>

          </form>
        </section>

        {/* ==================================================================
            SECTION 2: Business hours
        ================================================================== */}
        <section>
          <h2 className="text-base font-semibold text-gray-900 mb-1">Business hours</h2>
          <p className="text-sm text-gray-500 mb-4">
            Used as the suggested time range when booking appointments.
          </p>

          <form onSubmit={handleHoursSave} noValidate className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5">

            <div className="grid grid-cols-2 gap-5">
              {/* Opening time */}
              <div>
                <FieldLabel htmlFor="opening-time">Opening time</FieldLabel>
                <input
                  id="opening-time"
                  type="time"
                  value={openingTime}
                  onChange={(e) => {
                    setOpeningTime(e.target.value);
                    if (hoursError) setHoursError('');
                  }}
                  disabled={hoursSaveStatus === 'saving'}
                  className="
                    w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900
                    focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent
                    disabled:bg-gray-50 disabled:text-gray-400
                    transition
                  "
                />
              </div>

              {/* Closing time */}
              <div>
                <FieldLabel htmlFor="closing-time">Closing time</FieldLabel>
                <input
                  id="closing-time"
                  type="time"
                  value={closingTime}
                  onChange={(e) => {
                    setClosingTime(e.target.value);
                    if (hoursError) setHoursError('');
                  }}
                  disabled={hoursSaveStatus === 'saving'}
                  className="
                    w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900
                    focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent
                    disabled:bg-gray-50 disabled:text-gray-400
                    transition
                  "
                />
              </div>
            </div>

            {/* Error */}
            {hoursError && (
              <div
                role="alert"
                className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
              >
                {hoursError}
              </div>
            )}

            {/* Save button */}
            <div className="flex items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={hoursSaveStatus === 'saving'}
                className="
                  rounded-lg bg-black text-white text-sm font-medium
                  px-5 py-2.5
                  hover:bg-gray-800
                  focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2
                  disabled:opacity-50 disabled:cursor-not-allowed
                  transition
                "
              >
                {hoursSaveStatus === 'saving' ? 'Saving…' : 'Save changes'}
              </button>

              {hoursSaveStatus === 'saved' && (
                <span className="text-sm text-green-600 font-medium">Saved!</span>
              )}
            </div>

          </form>
        </section>

        {/* ==================================================================
            SECTION 3: Team (Barbers)
        ================================================================== */}
        <section>
          <h2 className="text-base font-semibold text-gray-900 mb-1">Team</h2>
          <p className="text-sm text-gray-500 mb-4">
            Staff appear as a dropdown when you add an appointment.
            They do not have login access.
          </p>

          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">

            {/* Barber list */}
            {barbers.length === 0 ? (
              <div className="px-6 py-8 text-center">
                <p className="text-sm text-gray-400">No staff added yet.</p>
                <p className="text-xs text-gray-400 mt-1">
                  Add your first staff member below.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {barbers.map((barber) => (
                  <li
                    key={barber.id}
                    className="flex items-center justify-between px-6 py-4"
                  >
                    {/* Barber name + initials avatar */}
                    <div className="flex items-center gap-3">
                      {/* Initials circle */}
                      <div className="
                        w-8 h-8 rounded-full bg-gray-100
                        flex items-center justify-center
                        text-xs font-semibold text-gray-600 shrink-0
                      ">
                        {barber.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-sm font-medium text-gray-900">
                        {barber.name}
                      </span>
                    </div>

                    {/* Delete button */}
                    <button
                      onClick={() => handleDeleteBarber(barber.id, barber.name)}
                      disabled={deletingId === barber.id}
                      aria-label={`Remove ${barber.name}`}
                      className="
                        text-sm text-gray-400 hover:text-red-600
                        disabled:opacity-40 disabled:cursor-not-allowed
                        transition-colors
                      "
                    >
                      {deletingId === barber.id ? 'Removing…' : 'Remove'}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* Divider */}
            <div className="border-t border-gray-100" />

            {/* Add barber form */}
            <form onSubmit={handleAddBarber} noValidate className="px-6 py-4">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">
                Add staff
              </p>

              <div className="flex gap-3">
                <input
                  type="text"
                  value={newBarberName}
                  onChange={(e) => {
                    setNewBarberName(e.target.value);
                    if (addBarberError) setAddBarberError('');
                  }}
                  placeholder="First name, e.g. John"
                  maxLength={50}
                  disabled={addingBarber}
                  className="
                    flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900
                    placeholder:text-gray-400
                    focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent
                    disabled:bg-gray-50 disabled:text-gray-400
                    transition
                  "
                />
                <button
                  type="submit"
                  disabled={addingBarber}
                  className="
                    rounded-lg bg-black text-white text-sm font-medium
                    px-4 py-2.5 shrink-0
                    hover:bg-gray-800
                    focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2
                    disabled:opacity-50 disabled:cursor-not-allowed
                    transition
                  "
                >
                  {addingBarber ? 'Adding…' : 'Add'}
                </button>
              </div>

              {/* Add barber error */}
              {addBarberError && (
                <p className="mt-2 text-sm text-red-600">{addBarberError}</p>
              )}
            </form>

          </div>
        </section>

        {/* ==================================================================
            SECTION 4: Services
        ================================================================== */}
        <section>
          <h2 className="text-base font-semibold text-gray-900 mb-1">Services</h2>
          <p className="text-sm text-gray-500 mb-4">
            Services appear as a dropdown when you add an appointment.
            If none are added, you can type the service name freely.
          </p>

          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">

            {/* Service list */}
            {services.length === 0 ? (
              <div className="px-6 py-8 text-center">
                <p className="text-sm text-gray-400">No services added yet.</p>
                <p className="text-xs text-gray-400 mt-1">
                  Add your first service below.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {services.map((service) => (
                  <li
                    key={service.id}
                    className="flex items-center justify-between px-6 py-4"
                  >
                    <span className="text-sm font-medium text-gray-900">
                      {service.name}
                    </span>

                    <button
                      onClick={() => handleDeleteService(service.id, service.name)}
                      disabled={deletingServiceId === service.id}
                      aria-label={`Remove ${service.name}`}
                      className="
                        text-sm text-gray-400 hover:text-red-600
                        disabled:opacity-40 disabled:cursor-not-allowed
                        transition-colors
                      "
                    >
                      {deletingServiceId === service.id ? 'Removing…' : 'Remove'}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* Divider */}
            <div className="border-t border-gray-100" />

            {/* Add service form */}
            <form onSubmit={handleAddService} noValidate className="px-6 py-4">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">
                Add service
              </p>

              <div className="flex gap-3">
                <input
                  type="text"
                  value={newServiceName}
                  onChange={(e) => {
                    setNewServiceName(e.target.value);
                    if (addServiceError) setAddServiceError('');
                  }}
                  placeholder="e.g. Haircut, Beard trim"
                  maxLength={50}
                  disabled={addingService}
                  className="
                    flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900
                    placeholder:text-gray-400
                    focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent
                    disabled:bg-gray-50 disabled:text-gray-400
                    transition
                  "
                />
                <button
                  type="submit"
                  disabled={addingService}
                  className="
                    rounded-lg bg-black text-white text-sm font-medium
                    px-4 py-2.5 shrink-0
                    hover:bg-gray-800
                    focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2
                    disabled:opacity-50 disabled:cursor-not-allowed
                    transition
                  "
                >
                  {addingService ? 'Adding…' : 'Add'}
                </button>
              </div>

              {addServiceError && (
                <p className="mt-2 text-sm text-red-600">{addServiceError}</p>
              )}
            </form>

          </div>
        </section>

        {/* ==================================================================
            SECTION 5: Delete account
        ================================================================== */}
        <section>
          <h2 className="text-base font-semibold text-red-700 mb-1">Delete account</h2>
          <p className="text-sm text-gray-500 mb-4">
            Permanently deletes your salon, all appointments, all clients, and all reminders.
            This cannot be undone.
          </p>

          <div className="bg-white rounded-2xl border border-red-200 p-6">

            {!showDeleteDialog ? (
              <button
                type="button"
                onClick={() => {
                  setShowDeleteDialog(true);
                  setDeleteConfirmText('');
                  setDeleteAccountError('');
                }}
                className="
                  rounded-lg bg-white border border-red-500 text-red-600 text-sm font-medium
                  px-5 py-2.5
                  hover:bg-red-50
                  focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2
                  transition
                "
              >
                Delete my account
              </button>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-gray-700">
                  This will permanently delete your salon, all appointments, all clients, and all reminders.
                  This cannot be undone. Type <strong>DELETE</strong> to confirm.
                </p>

                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => {
                    setDeleteConfirmText(e.target.value);
                    if (deleteAccountError) setDeleteAccountError('');
                  }}
                  placeholder="Type DELETE to confirm"
                  disabled={isDeletingAccount}
                  className="
                    w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900
                    placeholder:text-gray-400
                    focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent
                    disabled:bg-gray-50 disabled:text-gray-400
                    transition
                  "
                />

                {deleteAccountError && (
                  <div
                    role="alert"
                    className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
                  >
                    {deleteAccountError}
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleDeleteAccount}
                    disabled={deleteConfirmText !== 'DELETE' || isDeletingAccount}
                    className="
                      rounded-lg bg-red-600 text-white text-sm font-medium
                      px-5 py-2.5
                      hover:bg-red-700
                      focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2
                      disabled:opacity-40 disabled:cursor-not-allowed
                      transition
                    "
                  >
                    {isDeletingAccount ? 'Deleting…' : 'Yes, delete everything'}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowDeleteDialog(false);
                      setDeleteConfirmText('');
                      setDeleteAccountError('');
                    }}
                    disabled={isDeletingAccount}
                    className="
                      rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700
                      px-5 py-2.5
                      hover:bg-gray-50
                      focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2
                      disabled:opacity-40 disabled:cursor-not-allowed
                      transition
                    "
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

          </div>
        </section>

      </div>
    </div>
  );
}
