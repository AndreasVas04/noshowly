/**
 * components/dashboard/AddAppointmentModal.tsx
 *
 * Slide-in modal panel for creating and editing appointments.
 *
 * Modes:
 *  - Create mode (no `appointment` prop): empty form pre-filled with initialDate.
 *    Supports client autocomplete — type to search existing clients, or enter a
 *    new name to create a new client record on save.
 *  - Edit mode (`appointment` prop provided): form pre-filled with all existing
 *    appointment data. Shows a red "Cancel appointment" button in addition to Save.
 *
 * Client flow:
 *  - As the user types in the client name field, a debounced GET /api/clients
 *    request fires and shows a dropdown of matching existing clients.
 *  - Selecting a client from the dropdown pre-fills the phone and email fields.
 *  - If no existing client is selected, a new client is created via POST /api/clients
 *    before the appointment is saved.
 *
 * This is a Client Component because it owns form state and fires fetch requests.
 */

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { format } from 'date-fns';
import type { AppointmentWithDetails, Barber, Client, Service } from '@/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts a YYYY-MM-DD date string from a Date object using local time.
 *
 * @param date - The date to format.
 * @returns ISO date string, e.g. "2026-04-01".
 */
function toLocalDateString(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

/**
 * Extracts an exact HH:MM time string from a Date using local time.
 * Used in edit mode so the stored time is preserved without rounding.
 *
 * @param date - The date to extract time from.
 * @returns Time string like "09:15".
 */
function toLocalTime(date: Date): string {
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Returns the next rounded 30-minute slot from the current time.
 * Used as the default time when creating a new appointment.
 * e.g. 14:10 → "14:30", 14:35 → "15:00".
 *
 * @returns Time string like "14:30".
 */
function getNextRounded30(): string {
  const now = new Date();
  let h = now.getHours();
  const m = now.getMinutes();

  let targetM: number;
  if (m < 30) {
    targetM = 30;
  } else {
    h += 1;
    targetM = 0;
  }

  // Wrap at midnight — keep within a valid 24-hour clock.
  if (h >= 24) {
    h = 0;
    targetM = 0;
  }

  return `${h.toString().padStart(2, '0')}:${targetM.toString().padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AddAppointmentModalProps {
  /** Whether the modal is currently visible. */
  isOpen: boolean;
  /** Called when the user dismisses the modal without saving. */
  onClose: () => void;
  /**
   * Called after a successful save (create or update).
   * The parent should use this to re-fetch its appointment list and then
   * call onClose — or handle both together.
   */
  onSaved: () => void;
  /**
   * Date to pre-fill in the date field when creating a new appointment.
   * Ignored in edit mode (appointment.datetime is used instead).
   * Defaults to today if omitted.
   */
  initialDate?: Date;
  /**
   * Barber UUID to pre-select in the staff dropdown when creating a new
   * appointment. Ignored in edit mode. Used by the staff-column week view
   * so clicking a staff column pre-fills that staff member.
   */
  initialBarberId?: string;
  /**
   * When provided, the modal opens in edit mode and pre-fills all fields
   * from this appointment record.
   */
  appointment?: AppointmentWithDetails;
}

// ---------------------------------------------------------------------------
// Internal form state shape
// ---------------------------------------------------------------------------

interface FormState {
  /** Raw text in the client name input (used for autocomplete query). */
  clientQuery: string;
  /**
   * The client record selected from the autocomplete dropdown.
   * null means the owner is creating a new client.
   */
  selectedClient: Client | null;
  /** Phone number field — pre-filled when a client is selected. */
  clientPhone: string;
  /** Optional email field — pre-filled when a client is selected. */
  clientEmail: string;
  /** Appointment date in YYYY-MM-DD format (local time). */
  date: string;
  /** Appointment time in HH:MM format (24-hour, local time). */
  time: string;
  /** Selected service type. Empty string means not yet chosen. */
  serviceType: string;
  /** Selected staff (barber) UUID. Empty string means no staff assigned. */
  barberId: string;
  /** Free-text notes. */
  notes: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * AddAppointmentModal renders an overlay modal with a form for creating or
 * editing an appointment.
 *
 * @param props.isOpen        - Whether the modal is visible.
 * @param props.onClose       - Callback to dismiss the modal without saving.
 * @param props.onSaved       - Callback fired after a successful save.
 * @param props.initialDate   - Date to pre-fill when creating. Defaults to today.
 * @param props.appointment   - If provided, opens in edit mode pre-filled with data.
 */
export default function AddAppointmentModal({
  isOpen,
  onClose,
  onSaved,
  initialDate,
  initialBarberId,
  appointment,
}: AddAppointmentModalProps) {
  const isEditMode = Boolean(appointment);

  // ---------------------------------------------------------------------------
  // Form state
  // ---------------------------------------------------------------------------

  const defaultDate = initialDate ?? new Date();

  /**
   * Builds the initial FormState, deriving values from the appointment prop
   * in edit mode or from defaults in create mode.
   */
  function getInitialState(): FormState {
    if (appointment) {
      // Edit mode: extract local date and exact time from the stored UTC ISO string.
      const dt = new Date(appointment.datetime);
      return {
        clientQuery: appointment.client_name ?? '',
        selectedClient: appointment.client_id
          ? {
              id: appointment.client_id,
              salon_id: appointment.salon_id,
              name: appointment.client_name ?? '',
              phone: appointment.client_phone,
              email: appointment.client_email,
              notes: null,
              created_at: '',
            }
          : null,
        clientPhone: appointment.client_phone ?? '',
        clientEmail: appointment.client_email ?? '',
        date: toLocalDateString(dt),
        time: toLocalTime(dt),
        serviceType: appointment.service_type ?? '',
        barberId: appointment.barber_id ?? '',
        notes: appointment.notes ?? '',
      };
    }

    // Create mode defaults.
    return {
      clientQuery: '',
      selectedClient: null,
      clientPhone: '',
      clientEmail: '',
      date: toLocalDateString(defaultDate),
      time: getNextRounded30(),
      serviceType: '',
      // Pre-select the staff column the user clicked, if provided.
      barberId: initialBarberId ?? '',
      notes: '',
    };
  }

  const [form, setForm] = useState<FormState>(getInitialState);

  // Whether the notes textarea is expanded (collapsed by default to save space).
  const [showNotes, setShowNotes] = useState(false);

  // ---------------------------------------------------------------------------
  // Staff (barbers)
  // ---------------------------------------------------------------------------

  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [isLoadingBarbers, setIsLoadingBarbers] = useState(false);

  // ---------------------------------------------------------------------------
  // Services
  // ---------------------------------------------------------------------------

  const [services, setServices] = useState<Service[]>([]);
  const [isLoadingServices, setIsLoadingServices] = useState(false);

  // ---------------------------------------------------------------------------
  // Salon business hours — used to detect outside-hours appointments.
  // salonHasCustomHours is false until the salon data confirms explicit hours.
  // ---------------------------------------------------------------------------

  const [salonOpeningTime, setSalonOpeningTime] = useState<string>('06:00');
  const [salonClosingTime, setSalonClosingTime] = useState<string>('23:00');
  /** True only when the salon has explicitly set opening and closing times. */
  const [salonHasCustomHours, setSalonHasCustomHours] = useState<boolean>(false);

  // ---------------------------------------------------------------------------
  // Generic soft-warning confirmation dialog state
  // ---------------------------------------------------------------------------

  /**
   * When non-null, a confirmation dialog is shown over the form with this
   * message. Set by handleSubmit when the appointment triggers any soft
   * warning (past date, far future, or outside business hours). The user
   * can confirm to proceed with doSave, or dismiss to return to the form.
   */
  const [warningDialog, setWarningDialog] = useState<string | null>(null);

  /**
   * Fetches the salon's staff list for the staff dropdown.
   * Runs once when the modal first opens.
   */
  const fetchBarbers = useCallback(async (): Promise<void> => {
    setIsLoadingBarbers(true);
    try {
      const res = await fetch('/api/barbers', { cache: 'no-store' });
      if (res.ok) {
        const payload = (await res.json()) as { barbers: Barber[] };
        setBarbers(payload.barbers);
      }
    } catch (err) {
      // Non-critical — the modal still works without the staff list.
      console.error('[AddAppointmentModal] Failed to load staff:', err);
    } finally {
      setIsLoadingBarbers(false);
    }
  }, []);

  /**
   * Fetches the salon's business hours.
   * Only sets salonHasCustomHours when both opening and closing times are
   * explicitly configured — avoids showing the outside-hours dialog when
   * the salon has not set any hours.
   */
  const fetchSalonHours = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/salon', { cache: 'no-store' });
      if (res.ok) {
        const payload = (await res.json()) as { salon: { opening_time: string | null; closing_time: string | null } };
        const opening = payload.salon.opening_time;
        const closing = payload.salon.closing_time;
        if (opening && closing) {
          setSalonOpeningTime(opening);
          setSalonClosingTime(closing);
          setSalonHasCustomHours(true);
        }
      }
    } catch (err) {
      // Non-critical — the modal still works without business hours.
      console.error('[AddAppointmentModal] Failed to load salon hours:', err);
    }
  }, []);

  /**
   * Fetches the salon's custom service list for the service dropdown.
   * Runs once when the modal first opens.
   * If no services are configured, the field falls back to a free-text input.
   */
  const fetchServices = useCallback(async (): Promise<void> => {
    setIsLoadingServices(true);
    try {
      const res = await fetch('/api/services', { cache: 'no-store' });
      if (res.ok) {
        const payload = (await res.json()) as { services: Service[] };
        setServices(payload.services);
      }
    } catch (err) {
      // Non-critical — the modal falls back to free-text input.
      console.error('[AddAppointmentModal] Failed to load services:', err);
    } finally {
      setIsLoadingServices(false);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Client autocomplete
  // ---------------------------------------------------------------------------

  const [suggestions, setSuggestions] = useState<Client[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Phone-based client lookup state.
  // clientFoundByPhone: true when a client record was matched via phone number.
  // nameReadOnly: true when the name was auto-filled from a phone match — the
  //   owner can click the name field to unlock it for manual editing.
  const [isPhoneSearching, setIsPhoneSearching] = useState(false);
  const [clientFoundByPhone, setClientFoundByPhone] = useState(false);
  const [nameReadOnly, setNameReadOnly] = useState(false);
  const phoneSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Searches existing clients by the current clientQuery value.
   * Debounced by 300 ms to avoid firing on every keystroke.
   *
   * @param query - The search term to send to GET /api/clients.
   */
  const searchClients = useCallback(async (query: string): Promise<void> => {
    if (!query.trim()) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    setIsSearching(true);
    try {
      const res = await fetch(
        `/api/clients?search=${encodeURIComponent(query)}`,
        { cache: 'no-store' }
      );
      if (res.ok) {
        const payload = (await res.json()) as { clients: Client[] };
        setSuggestions(payload.clients);
        setShowSuggestions(true);
      }
    } catch (err) {
      console.error('[AddAppointmentModal] Client search error:', err);
    } finally {
      setIsSearching(false);
    }
  }, []);

  /**
   * Looks up an existing client by phone number via GET /api/clients.
   * Called by the debounced phone-field effect once 6+ digits are present.
   *
   * On match: auto-fills the client name and email fields, locks the name
   * field as read-only, and shows a green "Existing client" indicator.
   *
   * On no match: clears the match state so the name field stays editable.
   *
   * @param phone - The current value of the phone input.
   */
  const searchByPhone = useCallback(async (phone: string): Promise<void> => {
    // Require at least 6 digits before firing a search — avoids noise from
    // country codes and partial input like "+1 ".
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 6) {
      return;
    }
    setIsPhoneSearching(true);
    try {
      const res = await fetch(
        `/api/clients?search=${encodeURIComponent(phone)}`,
        { cache: 'no-store' }
      );
      if (!res.ok) return;
      const payload = (await res.json()) as { clients: Client[] };
      // Take the first result — the API returns phone matches before name matches.
      const match = payload.clients[0] ?? null;
      if (match) {
        setForm((prev) => ({
          ...prev,
          clientQuery: match.name,
          selectedClient: match,
          clientEmail: match.email ?? prev.clientEmail,
        }));
        setClientFoundByPhone(true);
        setNameReadOnly(true);
        // Clear any stale name/phone field errors from the previous state.
        setFieldErrors((prev) => {
          const next = { ...prev };
          delete next.clientQuery;
          delete next.clientPhone;
          return next;
        });
      } else {
        // No client found for this phone — ensure match state is cleared.
        setClientFoundByPhone(false);
        setNameReadOnly(false);
      }
    } catch (err) {
      console.error('[AddAppointmentModal] Phone search error:', err);
    } finally {
      setIsPhoneSearching(false);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Submit / error state
  // ---------------------------------------------------------------------------

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Per-field validation errors shown inline. */
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------

  // Re-initialize form and fetch staff whenever the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    const state = getInitialState();
    setForm(state);
    // Auto-expand notes if the appointment already has notes (edit mode).
    setShowNotes(Boolean(appointment?.notes));
    setSuggestions([]);
    setShowSuggestions(false);
    setError(null);
    setFieldErrors({});
    setIsPhoneSearching(false);
    setClientFoundByPhone(false);
    setNameReadOnly(false);
    setWarningDialog(null);
    setSalonHasCustomHours(false);
    fetchBarbers();
    fetchServices();
    fetchSalonHours();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, appointment, fetchBarbers, fetchServices, fetchSalonHours]);

  // Debounced client search — fires 300 ms after the user stops typing.
  useEffect(() => {
    // Don't search if a client is already selected (they haven't cleared it).
    if (form.selectedClient) return;

    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      searchClients(form.clientQuery);
    }, 300);

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [form.clientQuery, form.selectedClient, searchClients]);

  // Debounced phone-based client lookup — fires 400 ms after the user stops typing.
  // Checks for 6+ digits inside searchByPhone before actually hitting the API.
  useEffect(() => {
    if (phoneSearchTimerRef.current) clearTimeout(phoneSearchTimerRef.current);
    phoneSearchTimerRef.current = setTimeout(() => {
      searchByPhone(form.clientPhone);
    }, 400);

    return () => {
      if (phoneSearchTimerRef.current) clearTimeout(phoneSearchTimerRef.current);
    };
  }, [form.clientPhone, searchByPhone]);

  // Close modal on Escape key.
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Prevent background scroll while the modal is open.
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  /**
   * Updates a single form field by key.
   *
   * @param key   - The FormState key to update.
   * @param value - The new value.
   */
  function setField<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
    // Clear the per-field error when the user edits the field.
    if (fieldErrors[key]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }

  /**
   * Handles the client name input change.
   * Clears the selectedClient so a new search fires.
   *
   * @param value - The new text typed in the client name field.
   */
  function handleClientQueryChange(value: string): void {
    setField('clientQuery', value);
    // Clear selected client — user is typing a new name.
    if (form.selectedClient) {
      setForm((prev) => ({
        ...prev,
        clientQuery: value,
        selectedClient: null,
      }));
    }
  }

  /**
   * Handles changes to the phone number field.
   * If a client was previously auto-filled via phone lookup, clears the match
   * state and the auto-filled name so the new number can be looked up fresh.
   *
   * @param value - The new value from the phone input.
   */
  function handlePhoneChange(value: string): void {
    if (clientFoundByPhone) {
      // Phone is changing after a successful match — wipe the auto-filled data
      // so the user starts fresh for the updated number.
      setClientFoundByPhone(false);
      setNameReadOnly(false);
      setForm((prev) => ({
        ...prev,
        clientPhone: value,
        clientQuery: '',
        selectedClient: null,
      }));
    } else {
      setField('clientPhone', value);
    }
  }

  /**
   * Unlocks the client name field when the user clicks it while read-only.
   * Clears the selectedClient so the name field supports manual entry or
   * re-selection via the autocomplete dropdown.
   */
  function handleNameUnlock(): void {
    setNameReadOnly(false);
    setClientFoundByPhone(false);
    setForm((prev) => ({
      ...prev,
      selectedClient: null,
    }));
  }

  /**
   * Selects a client from the autocomplete dropdown.
   * Pre-fills phone and email from the selected client record.
   *
   * @param client - The client record the user clicked in the dropdown.
   */
  function handleSelectClient(client: Client): void {
    setForm((prev) => ({
      ...prev,
      clientQuery: client.name,
      selectedClient: client,
      clientPhone: client.phone ?? prev.clientPhone,
      clientEmail: client.email ?? prev.clientEmail,
    }));
    setShowSuggestions(false);
    setSuggestions([]);
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next.clientQuery;
      delete next.clientPhone;
      return next;
    });
  }

  /**
   * Validates the form before submission.
   * Sets per-field errors and returns false if validation fails.
   * Staff is always optional regardless of how many staff members exist.
   * Business hours constraints are soft warnings only — not blocking.
   *
   * @returns true if all required fields pass validation.
   */
  function validate(): boolean {
    const errors: Partial<Record<keyof FormState, string>> = {};

    if (!form.clientQuery.trim()) {
      errors.clientQuery = 'Client name is required';
    }
    if (!form.clientPhone.trim()) {
      errors.clientPhone = 'Phone number is required';
    } else if (!form.clientPhone.trim().startsWith('+')) {
      // Country code required — needed so Twilio can route the SMS internationally.
      errors.clientPhone = 'Phone must include country code (e.g. +357 99 123 456)';
    }
    if (!form.date) {
      errors.date = 'Date is required';
    }
    if (!form.time) {
      errors.time = 'Time is required';
    }
    if (form.clientEmail && !form.clientEmail.includes('@')) {
      errors.clientEmail = 'Enter a valid email address';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  /**
   * Executes the API save after all validations have passed.
   * Extracted so it can be called both from handleSubmit (direct save) and
   * from the outside-hours confirmation dialog ("Yes, save" button).
   *
   * Create flow:
   *  1. If no selectedClient, POST /api/clients to create a new client record.
   *  2. POST /api/appointments with the client_id, date/time, and other fields.
   *
   * Edit flow:
   *  1. PUT /api/appointments/[id] with all updated fields.
   */
  async function doSave(): Promise<void> {
    setIsSubmitting(true);
    setWarningDialog(null);
    setError(null);

    try {
      let clientId: string | null = form.selectedClient?.id ?? appointment?.client_id ?? null;

      // ---- Create a new client record if none is selected ------------------
      if (!form.selectedClient && !isEditMode) {
        const clientRes = await fetch('/api/clients', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: form.clientQuery.trim(),
            phone: form.clientPhone.trim(),
            email: form.clientEmail.trim() || null,
          }),
        });

        if (!clientRes.ok) {
          const payload = (await clientRes.json()) as { error?: string };
          throw new Error(payload.error ?? 'Failed to create client');
        }

        const clientPayload = (await clientRes.json()) as { client: Client };
        clientId = clientPayload.client.id;
      }

      // ---- Build the ISO datetime from local date + time -------------------
      // new Date('YYYY-MM-DDTHH:MM:00') parses as local time;
      // .toISOString() converts to UTC for storage.
      const datetime = new Date(`${form.date}T${form.time}:00`).toISOString();

      // ---- Create or update the appointment --------------------------------
      if (isEditMode && appointment) {
        const updateBody: Record<string, unknown> = {
          datetime,
          barber_id: form.barberId || null,
          service_type: form.serviceType || null,
          notes: form.notes.trim() || null,
        };

        // Only send client_id if it changed (avoid unnecessary FK updates).
        if (clientId !== appointment.client_id) {
          updateBody.client_id = clientId;
        }

        const res = await fetch(`/api/appointments/${appointment.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updateBody),
        });

        if (!res.ok) {
          const payload = (await res.json()) as { error?: string };
          // 409 Conflict: double-booking — show error under the time field so
          // the owner can see exactly what time is conflicting.
          if (res.status === 409) {
            setFieldErrors((prev) => ({ ...prev, time: payload.error ?? 'Booking conflict' }));
            return;
          }
          throw new Error(payload.error ?? 'Failed to update appointment');
        }
      } else {
        const res = await fetch('/api/appointments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: clientId,
            barber_id: form.barberId || null,
            datetime,
            service_type: form.serviceType || null,
            notes: form.notes.trim() || null,
          }),
        });

        if (!res.ok) {
          const payload = (await res.json()) as { error?: string };
          // 409 Conflict: double-booking — show error under the time field.
          if (res.status === 409) {
            setFieldErrors((prev) => ({ ...prev, time: payload.error ?? 'Booking conflict' }));
            return;
          }
          throw new Error(payload.error ?? 'Failed to create appointment');
        }
      }

      onSaved();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      setError(message);
      console.error('[AddAppointmentModal] submit error:', err);
    } finally {
      setIsSubmitting(false);
    }
  }

  /**
   * Handles the form submit button. Validates fields, then collects any soft
   * warnings (past date, far-future date, outside business hours) and shows a
   * single confirmation dialog. If there are no warnings, proceeds to doSave.
   *
   * A re-entry guard (isSubmitting) prevents double-submits from rapid clicking.
   *
   * @param e - The React form submit event.
   */
  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    // Guard against double-submits — once saving has started, ignore clicks.
    if (isSubmitting) return;
    if (!validate()) return;

    // Collect soft warnings that require user confirmation before saving.
    const warnings: string[] = [];

    if (form.date && form.time) {
      const apptDatetime = new Date(`${form.date}T${form.time}:00`);
      const now = new Date();

      // Warn if the appointment is in the past.
      if (apptDatetime < now) {
        warnings.push('This date has already passed — are you sure?');
      } else {
        // Warn if the appointment is more than 6 months in the future.
        const sixMonthsFromNow = new Date(now);
        sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);
        if (apptDatetime > sixMonthsFromNow) {
          warnings.push('This is more than 6 months away — are you sure?');
        }
      }
    }

    // Warn if the time falls outside the salon's configured business hours.
    // Only applies when the salon has explicitly set hours.
    if (
      salonHasCustomHours &&
      form.time &&
      (form.time < salonOpeningTime || form.time > salonClosingTime)
    ) {
      warnings.push(
        `This appointment is at ${form.time}, outside your business hours (${salonOpeningTime} to ${salonClosingTime}).`
      );
    }

    if (warnings.length > 0) {
      setWarningDialog(warnings.join('\n'));
      return;
    }

    await doSave();
  }

  /**
   * Cancels the appointment by setting its status to 'cancelled'.
   * Only available in edit mode. Uses DELETE (soft delete) on the appointment.
   */
  async function handleCancelAppointment(): Promise<void> {
    if (!appointment) return;
    setIsCancelling(true);
    setError(null);

    try {
      const res = await fetch(`/api/appointments/${appointment.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const payload = (await res.json()) as { error?: string };
        throw new Error(payload.error ?? 'Failed to cancel appointment');
      }

      onSaved();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      setError(message);
      console.error('[AddAppointmentModal] cancel error:', err);
    } finally {
      setIsCancelling(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Don't render anything when closed
  // ---------------------------------------------------------------------------

  if (!isOpen) return null;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const title = isEditMode ? 'Edit appointment' : 'Add appointment';

  return (
    /* Fixed overlay — covers the full viewport */
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* Semi-transparent backdrop — clicking it dismisses the modal */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal panel — flex-col so the footer is always visible (sticky) */}
      <div className="
        relative w-full sm:max-w-lg bg-white
        rounded-t-2xl sm:rounded-2xl
        shadow-xl max-h-[90dvh]
        flex flex-col
      ">

        {/* ================================================================
            Header
        ================================================================ */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="
              p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100
              transition-colors focus-visible:outline-none focus-visible:ring-2
              focus-visible:ring-gray-400
            "
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ================================================================
            Form — flex-col with scrollable body and sticky footer
        ================================================================ */}
        <form onSubmit={handleSubmit} noValidate className="flex-1 flex flex-col min-h-0">

          {/* Scrollable fields area */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">

            {/* ---- Global error ------------------------------------------ */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {/* ---- Client phone (primary identifier) ---------------------- */}
            {/* Phone is searched first — typing 6+ digits triggers a client  */}
            {/* lookup and auto-fills the name field if a match is found.     */}
            <div>
              <label
                htmlFor="modal-client-phone"
                className="block text-xs font-medium text-gray-600 mb-1"
              >
                Phone <span className="text-red-500">*</span>
              </label>
              <input
                id="modal-client-phone"
                type="tel"
                autoFocus
                value={form.clientPhone}
                onChange={(e) => handlePhoneChange(e.target.value)}
                placeholder="+357 99 123 456"
                className={`
                  w-full px-3 py-2 rounded-lg border text-sm
                  focus:outline-none focus:ring-2 focus:ring-indigo-400
                  ${fieldErrors.clientPhone
                    ? 'border-red-400 bg-red-50'
                    : 'border-gray-200 bg-white'
                  }
                `}
              />
              {isPhoneSearching && (
                <p className="mt-0.5 text-xs text-gray-400">Searching...</p>
              )}
              {!isPhoneSearching && clientFoundByPhone && form.selectedClient && (
                <p className="mt-0.5 text-xs text-green-600">
                  Existing client: {form.selectedClient.name}
                </p>
              )}
              {fieldErrors.clientPhone && (
                <p className="mt-0.5 text-xs text-red-600">{fieldErrors.clientPhone}</p>
              )}
            </div>

            {/* ---- Client name with autocomplete (secondary) -------------- */}
            {/* Auto-filled and read-only when a phone match is found.       */}
            {/* The owner can click the field to unlock it for manual entry. */}
            <div>
              <label
                htmlFor="modal-client-name"
                className="block text-xs font-medium text-gray-600 mb-1"
              >
                Client name <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  id="modal-client-name"
                  type="text"
                  autoComplete="off"
                  readOnly={nameReadOnly}
                  value={form.clientQuery}
                  onChange={(e) => handleClientQueryChange(e.target.value)}
                  onClick={() => { if (nameReadOnly) handleNameUnlock(); }}
                  onFocus={() => {
                    if (suggestions.length > 0 && !nameReadOnly) setShowSuggestions(true);
                  }}
                  onBlur={() => {
                    // Delay so a click on a suggestion registers first.
                    setTimeout(() => setShowSuggestions(false), 150);
                  }}
                  placeholder="Search or enter new name"
                  className={`
                    w-full px-3 py-2 rounded-lg border text-sm
                    focus:outline-none focus:ring-2 focus:ring-indigo-400
                    ${nameReadOnly
                      ? 'border-gray-200 bg-gray-50 cursor-pointer'
                      : fieldErrors.clientQuery
                        ? 'border-red-400 bg-red-50'
                        : 'border-gray-200 bg-white'
                    }
                  `}
                />

                {/* Autocomplete dropdown — hidden while name is read-only */}
                {showSuggestions && !nameReadOnly && (
                  <div className="
                    absolute z-10 left-0 right-0 top-full mt-1
                    bg-white border border-gray-200 rounded-lg shadow-lg
                    max-h-40 overflow-y-auto
                  ">
                    {isSearching && (
                      <p className="px-3 py-2 text-sm text-gray-400">Searching...</p>
                    )}
                    {!isSearching && suggestions.length === 0 && (
                      <p className="px-3 py-2 text-sm text-gray-400">
                        No match — a new client will be created on save.
                      </p>
                    )}
                    {!isSearching && suggestions.map((client) => (
                      <button
                        key={client.id}
                        type="button"
                        onMouseDown={() => handleSelectClient(client)}
                        className="
                          w-full text-left px-3 py-2
                          hover:bg-indigo-50 transition-colors
                          border-b border-gray-50 last:border-0
                        "
                      >
                        <p className="text-sm font-medium text-gray-900">{client.name}</p>
                        {client.phone && (
                          <p className="text-xs text-gray-500 mt-0.5">{client.phone}</p>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {nameReadOnly && (
                <p className="mt-0.5 text-xs text-gray-400">Click to edit</p>
              )}
              {!nameReadOnly && form.selectedClient && !clientFoundByPhone && (
                <p className="mt-0.5 text-xs text-indigo-600">Existing client selected</p>
              )}
              {!nameReadOnly && !form.selectedClient && form.clientQuery && !isSearching && (
                <p className="mt-0.5 text-xs text-gray-400">New client — will be created on save</p>
              )}
              {fieldErrors.clientQuery && (
                <p className="mt-0.5 text-xs text-red-600">{fieldErrors.clientQuery}</p>
              )}
            </div>

            {/* ---- Client email (optional) -------------------------------- */}
            <div>
              <label
                htmlFor="modal-client-email"
                className="block text-xs font-medium text-gray-600 mb-1"
              >
                Email <span className="text-xs font-normal text-gray-400">(optional)</span>
              </label>
              <input
                id="modal-client-email"
                type="email"
                value={form.clientEmail}
                onChange={(e) => setField('clientEmail', e.target.value)}
                placeholder="client@example.com"
                className={`
                  w-full px-3 py-2 rounded-lg border text-sm
                  focus:outline-none focus:ring-2 focus:ring-indigo-400
                  ${fieldErrors.clientEmail
                    ? 'border-red-400 bg-red-50'
                    : 'border-gray-200 bg-white'
                  }
                `}
              />
              {fieldErrors.clientEmail && (
                <p className="mt-0.5 text-xs text-red-600">{fieldErrors.clientEmail}</p>
              )}
            </div>

            {/* ---- Date + Time on same row -------------------------------- */}
            <div className="grid grid-cols-2 gap-3">
              {/* Date */}
              <div>
                <label
                  htmlFor="modal-date"
                  className="block text-xs font-medium text-gray-600 mb-1"
                >
                  Date <span className="text-red-500">*</span>
                </label>
                <input
                  id="modal-date"
                  type="date"
                  value={form.date}
                  onChange={(e) => setField('date', e.target.value)}
                  className={`
                    w-full px-3 py-2 rounded-lg border text-sm
                    focus:outline-none focus:ring-2 focus:ring-indigo-400
                    ${fieldErrors.date
                      ? 'border-red-400 bg-red-50'
                      : 'border-gray-200 bg-white'
                    }
                  `}
                />
                {fieldErrors.date && (
                  <p className="mt-0.5 text-xs text-red-600">{fieldErrors.date}</p>
                )}
              </div>

              {/* Time — native time input.
                  The HTML time input always stores values in HH:MM 24-hour format
                  regardless of how the browser displays it (some locales show AM/PM).
                  The 24h value is shown as text below the input so the owner always
                  knows what time will be saved. min/max are set from the salon's
                  business hours (soft guidance only — not enforced server-side). */}
              <div>
                <label
                  htmlFor="modal-time"
                  className="block text-xs font-medium text-gray-600 mb-1"
                >
                  Time <span className="text-red-500">*</span>
                </label>
                <input
                  id="modal-time"
                  type="time"
                  value={form.time}
                  onChange={(e) => setField('time', e.target.value)}
                  min={salonOpeningTime}
                  max={salonClosingTime}
                  className={`
                    w-full px-3 py-2 rounded-lg border text-sm
                    focus:outline-none focus:ring-2 focus:ring-indigo-400
                    ${fieldErrors.time
                      ? 'border-red-400 bg-red-50'
                      : 'border-gray-200 bg-white'
                    }
                  `}
                />
                {/* Always show the 24h value — reassures owners using AM/PM browsers */}
                {form.time && (
                  <p className="mt-0.5 text-xs text-gray-400">{form.time}</p>
                )}
                {fieldErrors.time && (
                  <p className="mt-0.5 text-xs text-red-600">{fieldErrors.time}</p>
                )}
              </div>
            </div>

            {/* ---- Service + Staff on same row ---------------------------- */}
            <div className="grid grid-cols-2 gap-3">
              {/* Service — dropdown if services exist, free-text input if none configured */}
              <div>
                <label
                  htmlFor="modal-service"
                  className="block text-xs font-medium text-gray-600 mb-1"
                >
                  Service
                </label>
                {isLoadingServices ? (
                  <div className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-400">
                    Loading…
                  </div>
                ) : services.length > 0 ? (
                  <select
                    id="modal-service"
                    value={form.serviceType}
                    onChange={(e) => setField('serviceType', e.target.value)}
                    className="
                      w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm
                      focus:outline-none focus:ring-2 focus:ring-indigo-400
                    "
                  >
                    <option value="">Select (optional)</option>
                    {services.map((s) => (
                      <option key={s.id} value={s.name}>{s.name}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    id="modal-service"
                    type="text"
                    value={form.serviceType}
                    onChange={(e) => setField('serviceType', e.target.value)}
                    placeholder="e.g. Haircut (optional)"
                    className="
                      w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm
                      focus:outline-none focus:ring-2 focus:ring-indigo-400
                    "
                  />
                )}
              </div>

              {/* Staff (UI label) — stored as barber_id in the database.
                  Always optional — unassigned appointments are valid in all cases. */}
              <div>
                <label
                  htmlFor="modal-staff"
                  className="block text-xs font-medium text-gray-600 mb-1"
                >
                  Staff <span className="text-xs font-normal text-gray-400">(optional)</span>
                </label>
                <select
                  id="modal-staff"
                  value={form.barberId}
                  onChange={(e) => setField('barberId', e.target.value)}
                  disabled={isLoadingBarbers}
                  className="
                    w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm
                    focus:outline-none focus:ring-2 focus:ring-indigo-400
                    disabled:opacity-60
                  "
                >
                  <option value="">No staff assigned</option>
                  {barbers.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* ---- Notes — collapsed by default, expand with "+ Add note" --- */}
            {!showNotes ? (
              <button
                type="button"
                onClick={() => setShowNotes(true)}
                className="
                  text-xs text-indigo-600 hover:text-indigo-700
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400
                  rounded
                "
              >
                + Add note
              </button>
            ) : (
              <div>
                <label
                  htmlFor="modal-notes"
                  className="block text-xs font-medium text-gray-600 mb-1"
                >
                  Notes
                </label>
                <textarea
                  id="modal-notes"
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setField('notes', e.target.value)}
                  placeholder="Any notes..."
                  maxLength={1000}
                  className="
                    w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm
                    resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400
                  "
                />
              </div>
            )}

          </div>

          {/* ================================================================
              Sticky footer — always visible, never scrolls away
          ================================================================ */}
          <div className="
            shrink-0 px-4 py-3 border-t border-gray-100
            flex items-center gap-2
          ">

            {/* Cancel appointment (edit mode only — pushed to the left) */}
            {isEditMode && appointment?.status !== 'cancelled' && (
              <button
                type="button"
                onClick={handleCancelAppointment}
                disabled={isCancelling || isSubmitting}
                className="
                  mr-auto px-3 py-2 rounded-lg text-xs font-medium
                  text-red-600 border border-red-200 hover:bg-red-50
                  disabled:opacity-50 disabled:cursor-not-allowed
                  transition-colors focus-visible:outline-none focus-visible:ring-2
                  focus-visible:ring-red-400
                "
              >
                {isCancelling ? 'Cancelling...' : 'Cancel appointment'}
              </button>
            )}

            {/* Spacer when no cancel button — keeps save/close right-aligned */}
            {(!isEditMode || appointment?.status === 'cancelled') && (
              <div className="mr-auto" />
            )}

            {/* Dismiss without saving */}
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting || isCancelling}
              className="
                px-4 py-2 rounded-lg text-sm font-medium text-gray-600
                border border-gray-200 hover:bg-gray-50
                disabled:opacity-50 disabled:cursor-not-allowed
                transition-colors focus-visible:outline-none focus-visible:ring-2
                focus-visible:ring-gray-400
              "
            >
              Close
            </button>

            {/* Save */}
            <button
              type="submit"
              disabled={isSubmitting || isCancelling}
              className="
                px-5 py-2 rounded-lg text-sm font-semibold
                bg-indigo-600 text-white hover:bg-indigo-700
                disabled:opacity-50 disabled:cursor-not-allowed
                transition-colors focus-visible:outline-none focus-visible:ring-2
                focus-visible:ring-indigo-500
              "
            >
              {isSubmitting ? 'Saving...' : 'Save'}
            </button>

          </div>
        </form>

        {/* ================================================================
            Soft-warning confirmation dialog
            Shown as an overlay when the appointment triggers any soft
            warning (past date, far-future date, or outside business hours).
            The form remains visible beneath for context.
        ================================================================ */}
        {warningDialog !== null && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center bg-black/30 rounded-t-2xl sm:rounded-2xl"
            role="dialog"
            aria-modal="true"
            aria-label="Appointment warning"
          >
            <div className="mx-4 bg-white rounded-xl shadow-xl p-5 max-w-sm w-full">
              <p className="text-sm font-semibold text-gray-900 mb-1">Check before saving</p>
              {/* Render each warning on its own line */}
              {warningDialog.split('\n').map((line, i) => (
                <p key={i} className="text-sm text-gray-600 mb-2">{line}</p>
              ))}
              <div className="flex gap-2 justify-end mt-2">
                {/* Go back — closes dialog, returns user to the form */}
                <button
                  type="button"
                  onClick={() => setWarningDialog(null)}
                  className="
                    px-4 py-2 rounded-lg text-sm font-medium text-gray-600
                    border border-gray-200 hover:bg-gray-50
                    transition-colors focus-visible:outline-none focus-visible:ring-2
                    focus-visible:ring-gray-400
                  "
                >
                  Go back
                </button>
                {/* Yes, save — proceeds with saving despite the warnings */}
                <button
                  type="button"
                  onClick={() => { void doSave(); }}
                  className="
                    px-4 py-2 rounded-lg text-sm font-semibold
                    bg-indigo-600 text-white hover:bg-indigo-700
                    transition-colors focus-visible:outline-none focus-visible:ring-2
                    focus-visible:ring-indigo-500
                  "
                >
                  Yes, save
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
