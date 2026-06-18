/**
 * components/dashboard/AddAppointmentModal.tsx
 *
 * Modal for creating and editing appointments.
 *
 * Modes:
 *  - Create mode (no `appointment` prop): empty form pre-filled with initialDate.
 *    Client autocomplete — type to search existing clients, or enter a new name.
 *  - Edit mode (`appointment` prop): pre-filled with existing appointment data.
 *    Shows a "Cancel appointment" button.
 *
 * Client flow:
 *  - Typing in the client name field triggers a debounced GET /api/clients search.
 *  - Selecting a client pre-fills phone and email.
 *  - Phone field also triggers a debounced client lookup on 6+ digits.
 *  - No existing client selected → new client created via POST /api/clients on save.
 *
 * Premium design: shadcn Dialog + Input + Label + Button components,
 * brand-dark palette, generous whitespace.
 */

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { format } from 'date-fns';
import { X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { AppointmentStatus, AppointmentWithDetails, BarberService, Barber, Client, Service } from '@/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Formats a Date as YYYY-MM-DD using local time.
 *
 * @param date - The date to format.
 * @returns ISO date string like "2026-04-01".
 */
function toLocalDateString(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

/**
 * Extracts HH:MM from a Date using local time.
 * Used in edit mode to preserve exact stored time.
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
 * Returns the next rounded 30-minute slot from now.
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

  if (h >= 24) { h = 0; targetM = 0; }

  return `${h.toString().padStart(2, '0')}:${targetM.toString().padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AddAppointmentModalProps {
  /** Whether the modal is visible. */
  isOpen: boolean;
  /** Called when dismissed without saving. */
  onClose: () => void;
  /** Called after a successful save. */
  onSaved: () => void;
  /** Date to pre-fill when creating. Defaults to today. */
  initialDate?: Date;
  /** Barber UUID to pre-select (create mode only). */
  initialBarberId?: string;
  /** If provided, opens in edit mode pre-filled with this appointment. */
  appointment?: AppointmentWithDetails;
}

// ---------------------------------------------------------------------------
// Internal form state
// ---------------------------------------------------------------------------

interface FormState {
  clientQuery: string;
  selectedClient: Client | null;
  clientPhone: string;
  clientEmail: string;
  date: string;
  time: string;
  serviceType: string;
  barberId: string;
  notes: string;
  /** Initial status for a new appointment. Only used in create mode. */
  appointmentStatus: AppointmentStatus;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * AddAppointmentModal renders a shadcn Dialog with a form for creating or
 * editing an appointment.
 *
 * @param props.isOpen        - Whether the modal is visible.
 * @param props.onClose       - Dismiss without saving.
 * @param props.onSaved       - Called after a successful save.
 * @param props.initialDate   - Date to pre-fill in create mode.
 * @param props.appointment   - If provided, opens in edit mode.
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
  const defaultDate = initialDate ?? new Date();

  // ---------------------------------------------------------------------------
  // Form state
  // ---------------------------------------------------------------------------

  /**
   * Builds the initial FormState from the appointment prop (edit mode) or defaults.
   * In create mode, appointmentStatus defaults to 'confirmed' when the appointment
   * is within the next 24 hours (likely phone-confirmed on the spot) and 'scheduled'
   * otherwise.
   */
  function getInitialState(): FormState {
    if (appointment) {
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
        appointmentStatus: appointment.status,
      };
    }

    // Create mode: smart default for appointmentStatus.
    // If the appointment is in the next 24 hours → default to 'confirmed'
    // (the owner is likely booking someone who confirmed in person or by phone).
    const defaultTime = getNextRounded30();
    const defaultDatetimeStr = `${toLocalDateString(defaultDate)}T${defaultTime}:00`;
    const hoursUntil = (new Date(defaultDatetimeStr).getTime() - Date.now()) / (1000 * 60 * 60);
    const defaultStatus: AppointmentStatus =
      hoursUntil >= 0 && hoursUntil <= 24 ? 'confirmed' : 'scheduled';

    return {
      clientQuery: '',
      selectedClient: null,
      clientPhone: '',
      clientEmail: '',
      date: toLocalDateString(defaultDate),
      time: defaultTime,
      serviceType: '',
      barberId: initialBarberId ?? '',
      notes: '',
      appointmentStatus: defaultStatus,
    };
  }

  const [form, setForm] = useState<FormState>(getInitialState);
  const [showNotes, setShowNotes] = useState(false);

  // ---------------------------------------------------------------------------
  // Staff + services + hours
  // ---------------------------------------------------------------------------

  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [isLoadingBarbers, setIsLoadingBarbers] = useState(false);
  const [services, setServices] = useState<Service[]>([]);
  const [isLoadingServices, setIsLoadingServices] = useState(false);
  /** Barber/service assignments — used to filter the staff dropdown. */
  const [barberServices, setBarberServices] = useState<BarberService[]>([]);
  const [salonOpeningTime, setSalonOpeningTime] = useState<string>('06:00');
  const [salonClosingTime, setSalonClosingTime] = useState<string>('23:00');
  /** True only when the salon has explicitly set opening and closing times. */
  const [salonHasCustomHours, setSalonHasCustomHours] = useState<boolean>(false);

  // ---------------------------------------------------------------------------
  // Test reminder state
  // ---------------------------------------------------------------------------

  const [isSendingTestReminder, setIsSendingTestReminder] = useState(false);
  const [testReminderResult, setTestReminderResult] = useState<{ success: boolean; message: string } | null>(null);

  // ---------------------------------------------------------------------------
  // Warning dialog state
  // ---------------------------------------------------------------------------

  /**
   * When non-null, a confirmation overlay is shown with this message.
   * Triggered by soft warnings (past date, far future, outside hours).
   */
  const [warningDialog, setWarningDialog] = useState<string | null>(null);

  /**
   * Fetches the salon's staff list for the staff dropdown.
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
      console.error('[AddAppointmentModal] Failed to load staff:', err);
    } finally {
      setIsLoadingBarbers(false);
    }
  }, []);

  /**
   * Fetches the salon's business hours.
   * Only sets salonHasCustomHours when both times are explicitly configured.
   */
  const fetchSalonHours = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/salon', { cache: 'no-store' });
      if (res.ok) {
        const payload = (await res.json()) as {
          salon: { opening_time: string | null; closing_time: string | null };
        };
        const opening = payload.salon.opening_time;
        const closing = payload.salon.closing_time;
        if (opening && closing) {
          setSalonOpeningTime(opening);
          setSalonClosingTime(closing);
          setSalonHasCustomHours(true);
        }
      }
    } catch (err) {
      console.error('[AddAppointmentModal] Failed to load salon hours:', err);
    }
  }, []);

  /**
   * Fetches the salon's custom service list.
   * Falls back to free-text input if no services are configured.
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
      console.error('[AddAppointmentModal] Failed to load services:', err);
    } finally {
      setIsLoadingServices(false);
    }
  }, []);

  /**
   * Fetches barber/service assignments used to filter the staff dropdown
   * when a service is selected.
   */
  const fetchBarberServices = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/barber-services', { cache: 'no-store' });
      if (res.ok) {
        const payload = (await res.json()) as { barberServices: BarberService[] };
        setBarberServices(payload.barberServices);
      }
    } catch (err) {
      console.error('[AddAppointmentModal] Failed to load barber service assignments:', err);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Client autocomplete
  // ---------------------------------------------------------------------------

  const [suggestions, setSuggestions] = useState<Client[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isPhoneSearching, setIsPhoneSearching] = useState(false);
  const [clientFoundByPhone, setClientFoundByPhone] = useState(false);
  const [nameReadOnly, setNameReadOnly] = useState(false);
  const phoneSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Debounced client name search — fires 300 ms after the user stops typing.
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
      const res = await fetch(`/api/clients?search=${encodeURIComponent(query)}`, { cache: 'no-store' });
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
   * Phone-based client lookup — fires after 6+ digits are present.
   * Auto-fills name + email on match and locks the name field.
   *
   * @param phone - Current value of the phone input.
   */
  const searchByPhone = useCallback(async (phone: string): Promise<void> => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 6) return;
    setIsPhoneSearching(true);
    try {
      const res = await fetch(`/api/clients?search=${encodeURIComponent(phone)}`, { cache: 'no-store' });
      if (!res.ok) return;
      const payload = (await res.json()) as { clients: Client[] };
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
        setFieldErrors((prev) => {
          const next = { ...prev };
          delete next.clientQuery;
          delete next.clientPhone;
          return next;
        });
      } else {
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
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------

  // Re-initialize form when modal opens.
  useEffect(() => {
    if (!isOpen) return;
    const state = getInitialState();
    setForm(state);
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
    setTestReminderResult(null);
    fetchBarbers();
    fetchServices();
    fetchSalonHours();
    fetchBarberServices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, appointment, fetchBarbers, fetchServices, fetchSalonHours, fetchBarberServices]);

  // Debounced client name search.
  useEffect(() => {
    if (form.selectedClient) return;
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => { searchClients(form.clientQuery); }, 300);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [form.clientQuery, form.selectedClient, searchClients]);

  // Debounced phone lookup.
  useEffect(() => {
    if (phoneSearchTimerRef.current) clearTimeout(phoneSearchTimerRef.current);
    phoneSearchTimerRef.current = setTimeout(() => { searchByPhone(form.clientPhone); }, 400);
    return () => { if (phoneSearchTimerRef.current) clearTimeout(phoneSearchTimerRef.current); };
  }, [form.clientPhone, searchByPhone]);

  // In create mode, default barberId to the first barber once the list loads.
  // Uses the functional form of setForm so barbers[0].id can be read without
  // listing form.barberId as a dependency (avoids overwriting a user's selection).
  useEffect(() => {
    if (isEditMode || barbers.length === 0) return;
    setForm((prev) => {
      if (prev.barberId) return prev; // Keep initialBarberId or user's own selection.
      return { ...prev, barberId: barbers[0].id };
    });
  }, [barbers, isEditMode]);

  // Clear staff selection when the selected service changes and the current barber
  // is no longer in the filtered list for that service.
  useEffect(() => {
    if (!form.barberId || !form.serviceType) return;
    const service = services.find((s) => s.name === form.serviceType);
    if (!service) return;
    const assignedIds = new Set(
      barberServices.filter((bs) => bs.service_id === service.id).map((bs) => bs.barber_id)
    );
    if (assignedIds.size === 0) return; // No restrictions — all barbers allowed.
    if (!assignedIds.has(form.barberId)) {
      setForm((prev) => ({ ...prev, barberId: '' }));
    }
  // form.barberId intentionally excluded — only re-run when service changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.serviceType, barberServices, services]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  /**
   * Updates a single form field and clears its per-field error.
   *
   * @param key   - The FormState key to update.
   * @param value - The new value.
   */
  function setField<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (fieldErrors[key]) {
      setFieldErrors((prev) => { const next = { ...prev }; delete next[key]; return next; });
    }
  }

  /**
   * Handles client name input — clears selectedClient to trigger a new search.
   *
   * @param value - New text in the client name field.
   */
  function handleClientQueryChange(value: string): void {
    setField('clientQuery', value);
    if (form.selectedClient) {
      setForm((prev) => ({ ...prev, clientQuery: value, selectedClient: null }));
    }
  }

  /**
   * Handles phone field changes. Clears auto-filled data if phone changes after a match.
   *
   * @param value - New phone input value.
   */
  function handlePhoneChange(value: string): void {
    if (clientFoundByPhone) {
      setClientFoundByPhone(false);
      setNameReadOnly(false);
      setForm((prev) => ({ ...prev, clientPhone: value, clientQuery: '', selectedClient: null }));
    } else {
      setField('clientPhone', value);
    }
  }

  /** Unlocks the client name field when clicked while read-only. */
  function handleNameUnlock(): void {
    setNameReadOnly(false);
    setClientFoundByPhone(false);
    setForm((prev) => ({ ...prev, selectedClient: null }));
  }

  /**
   * Selects a client from the autocomplete dropdown — pre-fills phone + email.
   *
   * @param client - The selected client record.
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
   * Validates the form. Sets per-field errors and returns false on failure.
   * Staff is required when barbers exist. Business hours constraints are soft warnings only.
   *
   * @returns true if all required fields pass.
   */
  function validate(): boolean {
    const errors: Partial<Record<keyof FormState, string>> = {};

    if (!form.clientQuery.trim()) errors.clientQuery = 'Client name is required';
    if (!form.clientPhone.trim()) {
      errors.clientPhone = 'Phone number is required';
    } else if (!form.clientPhone.trim().startsWith('+')) {
      // Country code required for international routing.
      errors.clientPhone = 'Phone must include country code (e.g. +357 99 123 456)';
    }
    if (!form.date) errors.date = 'Date is required';
    if (!form.time) errors.time = 'Time is required';
    if (form.clientEmail && !form.clientEmail.includes('@')) {
      errors.clientEmail = 'Enter a valid email address';
    }
    // Staff is required when the salon has barbers configured.
    if (barbers.length > 0 && !form.barberId) {
      errors.barberId = 'Please select a staff member.';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  /**
   * Routes a 409 conflict error message to the appropriate field.
   *
   * Auto-assign errors ("No available staff", "Multiple staff") are shown
   * under the staff dropdown so the owner can act on them directly.
   * All other 409s (booking time conflicts) go under the time field.
   *
   * @param message - Error string from the API response.
   */
  function route409Error(message: string): void {
    const isStaffAutoAssign =
      message.startsWith('No available staff') ||
      message.startsWith('Multiple staff');
    if (isStaffAutoAssign) {
      setFieldErrors((prev) => ({ ...prev, barberId: message }));
    } else {
      setFieldErrors((prev) => ({ ...prev, time: message }));
    }
  }

  /**
   * Executes the API save after all validations pass.
   * Shared by handleSubmit (direct) and the warning dialog ("Yes, save").
   */
  async function doSave(): Promise<void> {
    setIsSubmitting(true);
    setWarningDialog(null);
    setError(null);

    try {
      let clientId: string | null = form.selectedClient?.id ?? appointment?.client_id ?? null;

      // Create a new client if none is selected (create mode only).
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

      // Build ISO datetime from local date + time.
      const datetime = new Date(`${form.date}T${form.time}:00`).toISOString();

      if (isEditMode && appointment) {
        const updateBody: Record<string, unknown> = {
          datetime,
          barber_id: form.barberId || null,
          service_type: form.serviceType || null,
          notes: form.notes.trim() || null,
          status: form.appointmentStatus,
        };

        if (clientId !== appointment.client_id) updateBody.client_id = clientId;

        const res = await fetch(`/api/appointments/${appointment.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updateBody),
        });

        if (!res.ok) {
          const payload = (await res.json()) as { error?: string };
          if (res.status === 409) {
            route409Error(payload.error ?? 'Booking conflict');
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
            status: form.appointmentStatus,
          }),
        });

        if (!res.ok) {
          const payload = (await res.json()) as { error?: string };
          if (res.status === 409) {
            route409Error(payload.error ?? 'Booking conflict');
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
   * Handles the form submit button. Validates fields, collects soft warnings,
   * shows a confirmation dialog if needed, otherwise calls doSave directly.
   *
   * @param e - The React form submit event.
   */
  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (isSubmitting) return; // Guard against double-submits.
    if (!validate()) return;

    const warnings: string[] = [];

    if (form.date && form.time) {
      const apptDatetime = new Date(`${form.date}T${form.time}:00`);
      const now = new Date();

      if (apptDatetime < now) {
        warnings.push('This date has already passed. Are you sure?');
      } else {
        const sixMonthsFromNow = new Date(now);
        sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);
        if (apptDatetime > sixMonthsFromNow) {
          warnings.push('This is more than 6 months away. Are you sure?');
        }
      }
    }

    // Soft warning for outside salon business hours.
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
   * Cancels the appointment (sets status to 'cancelled'). Edit mode only.
   */
  async function handleCancelAppointment(): Promise<void> {
    if (!appointment) return;
    setIsCancelling(true);
    setError(null);

    try {
      const res = await fetch(`/api/appointments/${appointment.id}`, { method: 'DELETE' });
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

  /**
   * Sends a test reminder email immediately for this appointment.
   * Only available in edit mode when the client has an email address.
   */
  async function handleTestReminder(): Promise<void> {
    if (!appointment) return;
    setIsSendingTestReminder(true);
    setTestReminderResult(null);

    try {
      const res = await fetch(`/api/appointments/${appointment.id}/test-reminder`, {
        method: 'POST',
      });
      const payload = (await res.json()) as { success?: boolean; message?: string; error?: string };

      if (res.ok) {
        setTestReminderResult({ success: true, message: payload.message ?? 'Test reminder sent.' });
      } else {
        setTestReminderResult({ success: false, message: payload.error ?? 'Failed to send test reminder.' });
      }
    } catch (err) {
      setTestReminderResult({ success: false, message: 'Something went wrong. Please try again.' });
      console.error('[AddAppointmentModal] Test reminder error:', err);
    } finally {
      setIsSendingTestReminder(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const title = isEditMode ? 'Edit appointment' : 'New appointment';
  /** True when viewing a cancelled appointment — all fields disabled, save hidden. */
  const isCancelledView = isEditMode && appointment?.status === 'cancelled';

  // Compute filtered barber list for the staff dropdown.
  // When a service is selected and barber_services assignments exist for it,
  // only show barbers assigned to that service. If no assignments exist for the
  // service (not yet configured), show all barbers (backwards compatible).
  const filteredBarbers = (() => {
    if (!form.serviceType) return barbers;
    const service = services.find((s) => s.name === form.serviceType);
    if (!service) return barbers;
    const assignedIds = new Set(
      barberServices.filter((bs) => bs.service_id === service.id).map((bs) => bs.barber_id)
    );
    if (assignedIds.size === 0) return barbers;
    return barbers.filter((b) => assignedIds.has(b.id));
  })();

  // Whether the staff dropdown is filtered to a subset of barbers.
  const staffFiltered = filteredBarbers.length < barbers.length && barbers.length > 0;

  // Shared input class helpers
  const inputClass = (hasError?: boolean) =>
    `h-10 text-sm text-[#1A1A1A] placeholder:text-[#C8C8C8] ${
      hasError
        ? 'border-red-400 focus-visible:border-red-400'
        : 'border-[#C8C8C8] focus-visible:border-[#1A1A1A]'
    } focus-visible:ring-0`;

  const labelClass = 'text-xs font-medium text-[#1A1A1A]';

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => { if (!open && !isSubmitting && !isCancelling) onClose(); }}
    >
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-lg max-h-[90dvh] flex flex-col p-0 gap-0 rounded-2xl border-[#C8C8C8]/40"
      >
        {/* ================================================================
            Header
        ================================================================ */}
        <DialogHeader className="flex-row items-center justify-between px-6 py-4 border-b border-[#C8C8C8]/30 shrink-0 gap-0">
          <DialogTitle className="font-heading text-lg font-semibold text-[#1A1A1A]">
            {title}
          </DialogTitle>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 rounded-lg text-[#C8C8C8] hover:text-[#1A1A1A] hover:bg-[#1A1A1A]/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </DialogHeader>

        {/* ================================================================
            Form — scrollable body + sticky footer
        ================================================================ */}
        <form onSubmit={handleSubmit} noValidate className="flex-1 flex flex-col min-h-0">

          {/* Scrollable fields */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

            {/* Global error */}
            {error && (
              <div className="bg-red-50 border border-red-100 rounded-lg px-4 py-3">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {/* ---- Read-only cancelled badge (edit mode, cancelled only) --- */}
            {isCancelledView && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-[#8A8680]">Status:</span>
                <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-red-50 text-red-600 border border-red-100">
                  Cancelled
                </span>
              </div>
            )}

            {/* ---- Phone (primary identifier) --------------------------- */}
            {/* Typing 6+ digits triggers a client lookup */}
            <div className="space-y-1.5">
              <Label htmlFor="modal-client-phone" className={labelClass}>
                Phone <span className="text-red-400">*</span>
              </Label>
              <Input
                id="modal-client-phone"
                type="tel"
                autoFocus
                disabled={isCancelledView}
                value={form.clientPhone}
                onChange={(e) => handlePhoneChange(e.target.value)}
                placeholder="+357 99 123 456"
                className={inputClass(Boolean(fieldErrors.clientPhone))}
              />
              {isPhoneSearching && (
                <p className="text-xs text-[#C8C8C8]">Searching...</p>
              )}
              {!isPhoneSearching && clientFoundByPhone && form.selectedClient && (
                <p className="text-xs text-emerald-600">Existing client: {form.selectedClient.name}</p>
              )}
              {fieldErrors.clientPhone && (
                <p className="text-xs text-red-600">{fieldErrors.clientPhone}</p>
              )}
            </div>

            {/* ---- Client name with autocomplete ------------------------ */}
            <div className="space-y-1.5">
              <Label htmlFor="modal-client-name" className={labelClass}>
                Client name <span className="text-red-400">*</span>
              </Label>
              <div className="relative">
                <Input
                  id="modal-client-name"
                  type="text"
                  autoComplete="off"
                  readOnly={nameReadOnly}
                  disabled={isCancelledView}
                  value={form.clientQuery}
                  onChange={(e) => handleClientQueryChange(e.target.value)}
                  onClick={() => { if (nameReadOnly) handleNameUnlock(); }}
                  onFocus={() => {
                    if (suggestions.length > 0 && !nameReadOnly) setShowSuggestions(true);
                  }}
                  onBlur={() => {
                    setTimeout(() => setShowSuggestions(false), 150);
                  }}
                  placeholder="Search or enter new name"
                  className={inputClass(Boolean(fieldErrors.clientQuery))}
                  style={{ cursor: nameReadOnly ? 'pointer' : 'text', background: nameReadOnly ? '#F9F9F9' : undefined }}
                />

                {/* Autocomplete dropdown */}
                {showSuggestions && !nameReadOnly && (
                  <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-white border border-[#C8C8C8]/40 rounded-xl shadow-lg max-h-40 overflow-y-auto">
                    {isSearching && <p className="px-3 py-2 text-sm text-[#C8C8C8]">Searching...</p>}
                    {!isSearching && suggestions.length === 0 && (
                      <p className="px-3 py-2 text-sm text-[#C8C8C8]">No match. A new client will be created on save.</p>
                    )}
                    {!isSearching && suggestions.map((client) => (
                      <button
                        key={client.id}
                        type="button"
                        onMouseDown={() => handleSelectClient(client)}
                        className="w-full text-left px-3 py-2 hover:bg-[#1A1A1A]/5 transition-colors border-b border-[#C8C8C8]/20 last:border-0"
                      >
                        <p className="text-sm font-medium text-[#1A1A1A]">{client.name}</p>
                        {client.phone && <p className="text-xs text-[#C8C8C8] mt-0.5">{client.phone}</p>}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {nameReadOnly && <p className="text-xs text-[#C8C8C8]">Click to edit</p>}
              {!nameReadOnly && form.selectedClient && !clientFoundByPhone && (
                <p className="text-xs text-[#C8C8C8]">Existing client selected</p>
              )}
              {!nameReadOnly && !form.selectedClient && form.clientQuery && !isSearching && (
                <p className="text-xs text-[#C8C8C8]">New client (will be created on save)</p>
              )}
              {fieldErrors.clientQuery && (
                <p className="text-xs text-red-600">{fieldErrors.clientQuery}</p>
              )}
            </div>

            {/* ---- Email (optional) -------------------------------------- */}
            <div className="space-y-1.5">
              <Label htmlFor="modal-client-email" className={labelClass}>
                Email <span className="text-xs font-normal text-[#C8C8C8]">(optional)</span>
              </Label>
              <Input
                id="modal-client-email"
                type="email"
                disabled={isCancelledView}
                value={form.clientEmail}
                onChange={(e) => setField('clientEmail', e.target.value)}
                placeholder="client@example.com"
                className={inputClass(Boolean(fieldErrors.clientEmail))}
              />
              {fieldErrors.clientEmail && (
                <p className="text-xs text-red-600">{fieldErrors.clientEmail}</p>
              )}
            </div>

            {/* ---- Date + Time ------------------------------------------ */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="modal-date" className={labelClass}>
                  Date <span className="text-red-400">*</span>
                </Label>
                <div className={`rounded-lg border overflow-hidden transition-colors ${
                  fieldErrors.date ? 'border-red-400' : 'border-[#C8C8C8] focus-within:border-[#1A1A1A]'
                }`}>
                  <input
                    id="modal-date"
                    type="date"
                    disabled={isCancelledView}
                    value={form.date}
                    onChange={(e) => setField('date', e.target.value)}
                    className="w-full h-11 px-3 text-sm text-[#1A1A1A] outline-none border-none bg-transparent"
                  />
                </div>
                {fieldErrors.date && <p className="text-xs text-red-600">{fieldErrors.date}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="modal-time" className={labelClass}>
                  Time <span className="text-red-400">*</span>
                </Label>
                <div className={`rounded-lg border overflow-hidden transition-colors ${
                  fieldErrors.time ? 'border-red-400' : 'border-[#C8C8C8] focus-within:border-[#1A1A1A]'
                }`}>
                  <input
                    id="modal-time"
                    type="time"
                    disabled={isCancelledView}
                    value={form.time}
                    onChange={(e) => setField('time', e.target.value)}
                    min={salonOpeningTime}
                    max={salonClosingTime}
                    className="w-full h-11 px-3 text-sm text-[#1A1A1A] outline-none border-none bg-transparent"
                  />
                </div>
                {fieldErrors.time && <p className="text-xs text-red-600">{fieldErrors.time}</p>}
              </div>
            </div>

            {/* ---- Service + Staff -------------------------------------- */}
            <div className="grid grid-cols-2 gap-3">
              {/* Service */}
              <div className="space-y-1.5">
                <Label htmlFor="modal-service" className={labelClass}>Service</Label>
                {isLoadingServices ? (
                  <div className="w-full h-10 px-3 rounded-lg border border-[#C8C8C8] bg-[#F9F9F9] text-sm text-[#C8C8C8] flex items-center">
                    Loading…
                  </div>
                ) : services.length > 0 ? (
                  <select
                    id="modal-service"
                    value={form.serviceType}
                    disabled={isCancelledView}
                    onChange={(e) => setField('serviceType', e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-[#C8C8C8] bg-white text-sm text-[#1A1A1A] outline-none focus:border-[#1A1A1A] transition-colors"
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
                    className="w-full h-10 px-3 rounded-lg border border-[#C8C8C8] bg-white text-sm text-[#1A1A1A] outline-none focus:border-[#1A1A1A] transition-colors"
                  />
                )}
              </div>

              {/* Staff — required when barbers exist; filtered by service assignment */}
              <div className="space-y-1.5">
                <Label htmlFor="modal-staff" className={labelClass}>
                  {barbers.length > 0
                    ? 'Staff'
                    : <span>Staff <span className="text-xs font-normal text-[#C8C8C8]">(optional)</span></span>
                  }
                </Label>
                <select
                  id="modal-staff"
                  value={form.barberId}
                  onChange={(e) => setField('barberId', e.target.value)}
                  disabled={isLoadingBarbers || isCancelledView}
                  className="w-full h-10 px-3 rounded-lg border border-[#C8C8C8] bg-white text-sm text-[#1A1A1A] outline-none focus:border-[#1A1A1A] disabled:opacity-60 transition-colors"
                >
                  {/* Placeholder option only shown when no barbers are configured. */}
                  {barbers.length === 0 && <option value="">No staff assigned</option>}
                  {filteredBarbers.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
                {staffFiltered && (
                  <p className="text-xs text-[#8A8680]">
                    Showing {filteredBarbers.length} of {barbers.length} staff for this service.
                  </p>
                )}
                {fieldErrors.barberId && (
                  <p className="text-xs text-red-600">{fieldErrors.barberId}</p>
                )}
              </div>
            </div>

            {/* ---- Status ------------------------------------------------ */}
            {!isCancelledView && (
              <div className="space-y-1.5">
                <Label htmlFor="modal-status" className={labelClass}>Status</Label>
                <select
                  id="modal-status"
                  value={form.appointmentStatus}
                  onChange={(e) => setField('appointmentStatus', e.target.value as AppointmentStatus)}
                  className="w-full h-10 px-3 rounded-lg border border-[#C8C8C8] bg-white text-sm text-[#1A1A1A] outline-none focus:border-[#1A1A1A] transition-colors"
                >
                  <option value="scheduled">Pending (awaiting confirmation)</option>
                  <option value="confirmed">Confirmed</option>
                </select>
              </div>
            )}

            {/* ---- Notes ------------------------------------------------- */}
            {!showNotes ? (
              <button
                type="button"
                onClick={() => setShowNotes(true)}
                className="text-xs text-[#C8C8C8] hover:text-[#1A1A1A] transition-colors rounded"
              >
                + Add note
              </button>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="modal-notes" className={labelClass}>Notes</Label>
                <textarea
                  id="modal-notes"
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setField('notes', e.target.value)}
                  placeholder="Any notes..."
                  maxLength={1000}
                  className="w-full px-3 py-2.5 rounded-lg border border-[#C8C8C8] bg-white text-sm text-[#1A1A1A] placeholder:text-[#C8C8C8] resize-none outline-none focus:border-[#1A1A1A] transition-colors"
                />
              </div>
            )}

          </div>

          {/* ================================================================
              Sticky footer
          ================================================================ */}
          <div className="shrink-0 px-6 py-4 border-t border-[#C8C8C8]/30 space-y-2">

            {/* Test reminder result banner */}
            {testReminderResult && (
              <div className={`text-xs px-3 py-2 rounded-lg ${
                testReminderResult.success
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                  : 'bg-red-50 text-red-700 border border-red-100'
              }`}>
                {testReminderResult.message}
              </div>
            )}

            {/* flex-wrap keeps all buttons inside the modal on small screens.
                ml-auto on the Close/Save group pushes them right on wider screens;
                on narrow screens they wrap to their own row, right-aligned. */}
            <div className="flex flex-wrap items-center gap-2">

            {/* Cancel appointment (edit mode, not already cancelled) */}
            {isEditMode && appointment?.status !== 'cancelled' && (
              <button
                type="button"
                onClick={handleCancelAppointment}
                disabled={isCancelling || isSubmitting}
                className="
                  px-3 py-2 rounded-lg text-xs font-medium
                  text-red-600 border border-red-200 hover:bg-red-50
                  disabled:opacity-50 disabled:cursor-not-allowed
                  transition-colors shrink-0
                "
              >
                {isCancelling ? 'Cancelling...' : 'Cancel appointment'}
              </button>
            )}

            {/* Send test reminder (edit mode, not cancelled, client has email) */}
            {isEditMode && appointment?.status !== 'cancelled' && appointment?.client_email && (
              <button
                type="button"
                onClick={() => { void handleTestReminder(); }}
                disabled={isSendingTestReminder || isSubmitting || isCancelling}
                className="
                  px-3 py-2 rounded-lg text-xs font-medium
                  text-[#1B4332] border border-[#1B4332]/30 hover:bg-[#E8F2EC]
                  disabled:opacity-50 disabled:cursor-not-allowed
                  transition-colors shrink-0
                "
              >
                {isSendingTestReminder ? 'Sending...' : 'Send reminder'}
              </button>
            )}

            {isEditMode && appointment?.status !== 'cancelled' && appointment?.client_email && (
              <p className="text-[10px] text-[#8A8680] italic mt-1">Demo mode: reminder emails are sent only to the demo account owner, not to clients.</p>
            )}

            {/* ml-auto pushes Close + Save to the right; wraps to its own row on small screens */}
            <div className="flex items-center gap-2 ml-auto">

            {/* Close */}
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting || isCancelling}
              className="border-[#C8C8C8] text-[#1A1A1A] hover:bg-[#1A1A1A]/5 hover:border-[#1A1A1A]/40 text-sm px-4 py-2 h-9"
            >
              Close
            </Button>

            {/* Save — hidden for cancelled appointments (read-only view) */}
            {!isCancelledView && (
              <Button
                type="submit"
                disabled={isSubmitting || isCancelling}
                className="bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white text-sm px-5 py-2 h-9"
              >
                {isSubmitting ? 'Saving...' : 'Save'}
              </Button>
            )}

            </div>{/* end Close+Save group */}
            </div>{/* end flex-wrap row */}
          </div>
        </form>

        {/* ================================================================
            Soft-warning confirmation dialog
            Overlaid inside the modal when appointment has soft warnings.
        ================================================================ */}
        {warningDialog !== null && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center bg-black/20 rounded-2xl"
            role="dialog"
            aria-modal="true"
            aria-label="Appointment warning"
          >
            <div className="mx-4 bg-white rounded-xl shadow-xl p-6 max-w-sm w-full border border-[#C8C8C8]/40">
              <p className="font-heading text-base font-semibold text-[#1A1A1A] mb-3">
                Check before saving
              </p>
              {warningDialog.split('\n').map((line, i) => (
                <p key={i} className="text-sm text-[#2D2D2D] mb-2">{line}</p>
              ))}
              <div className="flex gap-2 justify-end mt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setWarningDialog(null)}
                  className="border-[#C8C8C8] text-[#1A1A1A] hover:border-[#1A1A1A]/40 text-sm"
                >
                  Go back
                </Button>
                <Button
                  type="button"
                  onClick={() => { void doSave(); }}
                  className="bg-[#1A1A1A] hover:bg-[#2D2D2D] text-white text-sm"
                >
                  Yes, save
                </Button>
              </div>
            </div>
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
}
