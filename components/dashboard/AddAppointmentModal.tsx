/**
 * components/dashboard/AddAppointmentModal.tsx
 *
 * Modal for creating and editing appointments.
 *
 * Modes:
 *  - Create mode (no `appointment` prop): empty form pre-filled with initialDate.
 *    Client autocomplete — type to search existing clients, or enter a new name.
 *  - Edit mode (`appointment` prop): pre-filled with existing appointment data.
 *    Shows a "Cancel appointment" button. The client fields edit the linked
 *    client's details (saved with PATCH /api/clients/[id]); only fields that
 *    changed are sent, so a status the client set meanwhile (e.g. confirmed
 *    from the reminder email) is never overwritten with a stale value.
 *
 * Client flow (create mode):
 *  - Typing in the client name field triggers a debounced GET /api/clients search.
 *  - Selecting a client pre-fills phone and email.
 *  - Phone field also triggers a debounced client lookup on 6+ digits.
 *  - No existing client selected → client found or created via POST /api/clients on save.
 *
 * Dates and times are entered in the salon's timezone (not the browser's) and
 * converted to UTC on save. The appointment length is resolved by the server
 * from the service and staff member (their override); the modal shows it.
 *
 * Premium design: shadcn Dialog + Input + Label + Button components,
 * brand-dark palette, generous whitespace.
 */

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
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
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { isDemoAccount } from '@/lib/demo';
import { getEffectiveDuration, isBarberEligibleForService } from '@/lib/availability';
import { MAX_PHONE_INPUT_LENGTH, validateEmail, validatePhone } from '@/lib/contact';
import {
  minutesToTime,
  normaliseTime,
  resolveZonedTime,
  timeToMinutes,
  todayInZone,
  utcToZonedParts,
} from '@/lib/time';
import type { AppointmentStatus, AppointmentWithDetails, BarberService, Barber, Client, Service } from '@/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the next rounded 30-minute slot from now in the salon's timezone.
 * e.g. 14:10 → "14:30", 14:35 → "15:00". Late in the evening it stops at 23:30.
 *
 * @param timeZone - Salon timezone.
 * @returns Time string like "14:30".
 */
function getNextRounded30(timeZone: string): string {
  const minutes = timeToMinutes(utcToZonedParts(new Date(), timeZone).time);
  const next = (Math.floor(minutes / 30) + 1) * 30;
  return minutesToTime(Math.min(next, 23 * 60 + 30));
}

/**
 * Predicts the status the server gives a new appointment when none is chosen:
 * confirmed when it starts within 23 hours (no reminder will be sent), otherwise pending.
 *
 * @param start - Appointment start, or null when the date/time is incomplete.
 */
function predictStatus(start: Date | null): AppointmentStatus {
  if (!start) return 'scheduled';
  const hoursUntil = (start.getTime() - Date.now()) / (1000 * 60 * 60);
  return hoursUntil < 23 ? 'confirmed' : 'scheduled';
}

/** Case-insensitive, trimmed comparison of optional names. */
function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
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
  /** Salon timezone; dates and times in the form are in this timezone. */
  timezone: string;
  /** Salon date ('YYYY-MM-DD') to pre-fill when creating. Defaults to today in the salon. */
  initialDate?: string;
  /** Barber UUID to pre-select (create mode only). */
  initialBarberId?: string;
  /** If provided, opens in edit mode pre-filled with this appointment. */
  appointment?: AppointmentWithDetails;
}

// ---------------------------------------------------------------------------
// Internal form state
// ---------------------------------------------------------------------------

interface FormState {
  /** Client name (search text in create mode). */
  clientQuery: string;
  selectedClient: Client | null;
  clientPhone: string;
  clientEmail: string;
  /** 'YYYY-MM-DD' in the salon timezone. */
  date: string;
  /** 'HH:MM' in the salon timezone. */
  time: string;
  /** Selected service id; '' when none is selected or the service is free text. */
  serviceId: string;
  /** Service name (free text when the salon has no services). */
  serviceType: string;
  barberId: string;
  notes: string;
  /** Status chosen in the form. Only sent when the owner changed it. */
  appointmentStatus: AppointmentStatus;
}

/** Select value for an edited appointment's service that is not in the list. */
const CURRENT_SERVICE_OPTION = '__current__';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * AddAppointmentModal renders a shadcn Dialog with a form for creating or
 * editing an appointment.
 *
 * @param props.isOpen          - Whether the modal is visible.
 * @param props.onClose         - Dismiss without saving.
 * @param props.onSaved         - Called after a successful save.
 * @param props.timezone        - Salon timezone.
 * @param props.initialDate     - Salon date to pre-fill in create mode.
 * @param props.initialBarberId - Staff member to pre-select in create mode.
 * @param props.appointment     - If provided, opens in edit mode.
 */
export default function AddAppointmentModal({
  isOpen,
  onClose,
  onSaved,
  timezone,
  initialDate,
  initialBarberId,
  appointment,
}: AddAppointmentModalProps) {
  const isEditMode = Boolean(appointment);

  // ---------------------------------------------------------------------------
  // Form state
  // ---------------------------------------------------------------------------

  /**
   * Builds the initial FormState from the appointment prop (edit mode) or defaults.
   * Edit mode converts the stored UTC time to the salon's timezone.
   */
  function getInitialState(): FormState {
    if (appointment) {
      const local = utcToZonedParts(appointment.datetime, timezone);
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
        date: local.date,
        time: local.time,
        serviceId: '',
        serviceType: appointment.service_type ?? '',
        barberId: appointment.barber_id ?? '',
        notes: appointment.notes ?? '',
        appointmentStatus: appointment.status,
      };
    }

    return {
      clientQuery: '',
      selectedClient: null,
      clientPhone: '',
      clientEmail: '',
      date: initialDate ?? todayInZone(timezone),
      time: getNextRounded30(timezone),
      serviceId: '',
      serviceType: '',
      barberId: initialBarberId ?? '',
      notes: '',
      appointmentStatus: 'scheduled',
    };
  }

  const [form, setForm] = useState<FormState>(getInitialState);
  /** The form as it was when the modal opened — used to send only changed fields. */
  const initialFormRef = useRef<FormState>(form);
  /** True once the owner picks a status; otherwise the server decides (create mode). */
  const [statusTouched, setStatusTouched] = useState(false);
  const [showNotes, setShowNotes] = useState(false);

  // ---------------------------------------------------------------------------
  // Staff + services + hours
  // ---------------------------------------------------------------------------

  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [isLoadingBarbers, setIsLoadingBarbers] = useState(false);
  const [services, setServices] = useState<Service[]>([]);
  const [isLoadingServices, setIsLoadingServices] = useState(false);
  /** Barber/service assignments — used to filter the staff dropdown and show durations. */
  const [barberServices, setBarberServices] = useState<BarberService[]>([]);
  /** Salon opening hours as 'HH:MM', or null when not configured. */
  const [salonHours, setSalonHours] = useState<{ opening: string; closing: string } | null>(null);

  /** Whether the signed-in account is the public demo account. */
  const [isDemo, setIsDemo] = useState(false);

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
   * Fetches the salon's business hours (normalised to 'HH:MM' by the API).
   * Only set when both times are configured and form a valid range.
   */
  const fetchSalonHours = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/salon', { cache: 'no-store' });
      if (res.ok) {
        const payload = (await res.json()) as {
          salon: { opening_time: string | null; closing_time: string | null };
        };
        const opening = normaliseTime(payload.salon.opening_time);
        const closing = normaliseTime(payload.salon.closing_time);
        setSalonHours(opening && closing && opening < closing ? { opening, closing } : null);
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
   * when a service is selected, and to show per-staff durations.
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
  // Client autocomplete (create mode only)
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
    initialFormRef.current = state;
    setStatusTouched(false);
    setShowNotes(Boolean(appointment?.notes));
    setSuggestions([]);
    setShowSuggestions(false);
    setError(null);
    setFieldErrors({});
    setIsPhoneSearching(false);
    setClientFoundByPhone(false);
    setNameReadOnly(false);
    setWarningDialog(null);
    setSalonHours(null);
    setTestReminderResult(null);
    fetchBarbers();
    fetchServices();
    fetchSalonHours();
    fetchBarberServices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, appointment, fetchBarbers, fetchServices, fetchSalonHours, fetchBarberServices]);

  // Look up whether this is the public demo account (for the demo-only note).
  useEffect(() => {
    let cancelled = false;
    createBrowserSupabaseClient()
      .auth.getUser()
      .then(({ data }) => { if (!cancelled) setIsDemo(isDemoAccount(data.user?.email)); })
      .catch(() => { /* Non-critical: the note simply stays hidden. */ });
    return () => { cancelled = true; };
  }, []);

  // Edit mode: once services load, select the one matching the stored name.
  useEffect(() => {
    if (!isEditMode || services.length === 0) return;
    setForm((prev) => {
      if (prev.serviceId || !prev.serviceType) return prev;
      const match = services.find((s) => sameName(s.name, prev.serviceType));
      return match ? { ...prev, serviceId: match.id } : prev;
    });
  }, [isEditMode, services]);

  // Debounced client name search (create mode only).
  useEffect(() => {
    if (isEditMode || form.selectedClient) return;
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => { searchClients(form.clientQuery); }, 300);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [isEditMode, form.clientQuery, form.selectedClient, searchClients]);

  // Debounced phone lookup (create mode only — in edit mode it could switch the client).
  useEffect(() => {
    if (isEditMode) return;
    if (phoneSearchTimerRef.current) clearTimeout(phoneSearchTimerRef.current);
    phoneSearchTimerRef.current = setTimeout(() => { searchByPhone(form.clientPhone); }, 400);
    return () => { if (phoneSearchTimerRef.current) clearTimeout(phoneSearchTimerRef.current); };
  }, [isEditMode, form.clientPhone, searchByPhone]);

  /** Active staff, plus the appointment's current staff member when editing. */
  const selectableBarbers = barbers.filter(
    (b) => b.active || (isEditMode && b.id === appointment?.barber_id)
  );

  // In create mode, default barberId to the first staff member once the list loads.
  // Uses the functional form of setForm so the list can be read without
  // listing form.barberId as a dependency (avoids overwriting a user's selection).
  useEffect(() => {
    if (isEditMode) return;
    const firstActive = barbers.find((b) => b.active);
    if (!firstActive) return;
    setForm((prev) => {
      if (prev.barberId) return prev; // Keep initialBarberId or user's own selection.
      return { ...prev, barberId: firstActive.id };
    });
  }, [barbers, isEditMode]);

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
   * Handles client name input. In create mode it clears selectedClient to
   * trigger a new search; in edit mode it edits the linked client's name.
   *
   * @param value - New text in the client name field.
   */
  function handleClientQueryChange(value: string): void {
    setField('clientQuery', value);
    if (!isEditMode && form.selectedClient) {
      setForm((prev) => ({ ...prev, clientQuery: value, selectedClient: null }));
    }
  }

  /**
   * Handles phone field changes. Clears auto-filled data if phone changes after a match.
   *
   * @param value - New phone input value.
   */
  function handlePhoneChange(value: string): void {
    if (!isEditMode && clientFoundByPhone) {
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
   * Handles a service selection from the dropdown.
   *
   * @param value - Service id, '' for none, or CURRENT_SERVICE_OPTION.
   */
  function handleServiceChange(value: string): void {
    if (value === CURRENT_SERVICE_OPTION) return;
    const service = services.find((s) => s.id === value);
    setForm((prev) => ({
      ...prev,
      serviceId: service?.id ?? '',
      serviceType: service?.name ?? '',
      // Clear a staff member who cannot perform the new service (same rule as
      // the booking page), so the owner picks one who can.
      barberId:
        service && prev.barberId && !isBarberEligibleForService(service.id, prev.barberId, barberServices)
          ? ''
          : prev.barberId,
    }));
  }

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  /** The selected salon service, when the form's service is one. */
  const selectedService: Service | null =
    services.find((s) => s.id === form.serviceId) ??
    (form.serviceType ? services.find((s) => sameName(s.name, form.serviceType)) : undefined) ??
    null;

  const initialForm = initialFormRef.current;
  const serviceChanged = !sameName(form.serviceType, initialForm.serviceType);
  const barberChanged  = form.barberId !== initialForm.barberId;

  /**
   * Appointment length as the server will resolve it: the stored length when
   * editing without changing service or staff, otherwise the service duration
   * with the staff member's override (else 30 minutes).
   */
  const resolvedDuration: number =
    isEditMode && appointment && !serviceChanged && !barberChanged
      ? appointment.duration_minutes
      : isEditMode && appointment && !serviceChanged && !selectedService
        ? appointment.duration_minutes // staff change on a free-text service keeps its length
        : getEffectiveDuration(selectedService, form.barberId || null, barberServices);

  /** Start instant of the form's date and time in the salon timezone, when valid. */
  const formStart = (() => {
    const time = normaliseTime(form.time);
    if (!form.date || !time) return null;
    const result = resolveZonedTime(form.date, time, timezone);
    return result.ok ? result.date : null;
  })();

  /** Status shown in create mode until the owner picks one. */
  const displayedStatus: AppointmentStatus =
    isEditMode || statusTouched ? form.appointmentStatus : predictStatus(formStart);

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
      // Clients booked online may have no phone; editing them does not require one.
      if (!isEditMode || initialForm.clientPhone.trim()) errors.clientPhone = 'Phone number is required';
    } else {
      const phone = validatePhone(form.clientPhone);
      if (!phone.ok) errors.clientPhone = phone.error;
    }
    if (!form.date) errors.date = 'Date is required';
    if (!form.time) {
      errors.time = 'Time is required';
    } else if (form.date && !formStart) {
      errors.time = 'This time does not exist on that date (the clocks change). Choose another time.';
    }
    if (form.clientEmail.trim()) {
      const email = validateEmail(form.clientEmail);
      if (!email.ok) errors.clientEmail = email.error;
    }
    // Staff is required when the salon has staff to choose from.
    if (selectableBarbers.length > 0 && !form.barberId) {
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
   * Creates a client (or reuses the one with the same phone and name) via
   * POST /api/clients and returns its id.
   */
  async function createClient(): Promise<string> {
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
    return clientPayload.client.id;
  }

  /**
   * Saves changed client details of the linked client via PATCH /api/clients/[id].
   * Only fields that differ from when the modal opened are sent.
   *
   * @param clientId - The appointment's client.
   */
  async function saveClientDetails(clientId: string): Promise<void> {
    const changes: Record<string, string | null> = {};
    if (form.clientQuery.trim() !== initialForm.clientQuery.trim()) changes.name = form.clientQuery.trim();
    if (form.clientPhone.trim() !== initialForm.clientPhone.trim()) changes.phone = form.clientPhone.trim() || null;
    if (form.clientEmail.trim() !== initialForm.clientEmail.trim()) changes.email = form.clientEmail.trim() || null;
    if (Object.keys(changes).length === 0) return;

    const res = await fetch(`/api/clients/${clientId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error ?? 'Failed to update client details');
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
      if (!formStart) throw new Error('Choose a valid date and time.');
      // The form's date and time are in the salon's timezone.
      const datetime = formStart.toISOString();
      const serviceName = (selectedService?.name ?? form.serviceType).trim() || null;

      if (isEditMode && appointment) {
        // 1. Client details: update the linked client, or link a new one when
        //    the appointment has none (e.g. the client record was deleted).
        let newClientId: string | null = null;
        if (appointment.client_id) {
          await saveClientDetails(appointment.client_id);
        } else if (form.clientQuery.trim()) {
          newClientId = await createClient();
        }

        // 2. Appointment: send only the fields that changed.
        const updateBody: Record<string, unknown> = {};
        if (form.date !== initialForm.date || form.time !== initialForm.time) updateBody.datetime = datetime;
        if (barberChanged) updateBody.barber_id = form.barberId || null;
        if (serviceChanged) {
          updateBody.service_id = selectedService?.id ?? null;
          updateBody.service_type = serviceName;
        }
        if (form.notes.trim() !== initialForm.notes.trim()) updateBody.notes = form.notes.trim() || null;
        if (statusTouched && form.appointmentStatus !== initialForm.appointmentStatus) {
          updateBody.status = form.appointmentStatus;
        }
        if (newClientId) updateBody.client_id = newClientId;

        if (Object.keys(updateBody).length > 0) {
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
        }
      } else {
        const clientId = form.selectedClient?.id ?? (await createClient());

        const res = await fetch('/api/appointments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: clientId,
            barber_id: form.barberId || null,
            datetime,
            service_id: selectedService?.id ?? null,
            service_type: serviceName,
            notes: form.notes.trim() || null,
            // Without an explicit choice the server decides from the lead time.
            ...(statusTouched ? { status: form.appointmentStatus } : {}),
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

    if (formStart) {
      const now = new Date();

      if (formStart < now) {
        warnings.push('This date has already passed. Are you sure?');
      } else {
        const sixMonthsFromNow = new Date(now);
        sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);
        if (formStart > sixMonthsFromNow) {
          warnings.push('This is more than 6 months away. Are you sure?');
        }
      }
    }

    // Soft warning when the appointment starts before opening or runs past
    // closing time (both in salon time).
    const startTime = normaliseTime(form.time);
    if (salonHours && startTime) {
      const startMinutes = timeToMinutes(startTime);
      const endMinutes = startMinutes + resolvedDuration;
      if (startMinutes < timeToMinutes(salonHours.opening) || endMinutes > timeToMinutes(salonHours.closing)) {
        warnings.push(
          `This appointment (${startTime}, ${resolvedDuration} min) is outside your business hours (${salonHours.opening} to ${salonHours.closing}).`
        );
      }
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

  /** Active services, plus the edited appointment's service when it is inactive. */
  const selectableServices = services.filter((s) => s.active || s.id === selectedService?.id);

  // Staff dropdown: when a service is selected, only staff eligible for it
  // (if the service has barber_services rows, only those staff members). The
  // current selection always stays listed so the select never shows another name.
  const filteredBarbers = form.serviceId
    ? selectableBarbers.filter(
        (b) => b.id === form.barberId || isBarberEligibleForService(form.serviceId, b.id, barberServices)
      )
    : selectableBarbers;

  // Whether the staff dropdown is filtered to a subset of barbers.
  const staffFiltered = filteredBarbers.length < selectableBarbers.length && selectableBarbers.length > 0;

  /** Value of the service select: the service id, the stored free-text name, or none. */
  const serviceSelectValue = form.serviceId || (form.serviceType ? CURRENT_SERVICE_OPTION : '');

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
            {/* Typing 6+ digits triggers a client lookup (create mode) */}
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
                maxLength={MAX_PHONE_INPUT_LENGTH}
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
                  placeholder={isEditMode ? 'Client name' : 'Search or enter new name'}
                  maxLength={100}
                  className={inputClass(Boolean(fieldErrors.clientQuery))}
                  style={{ cursor: nameReadOnly ? 'pointer' : 'text', background: nameReadOnly ? '#F9F9F9' : undefined }}
                />

                {/* Autocomplete dropdown (create mode) */}
                {!isEditMode && showSuggestions && !nameReadOnly && (
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
              {!isEditMode && !nameReadOnly && form.selectedClient && !clientFoundByPhone && (
                <p className="text-xs text-[#C8C8C8]">Existing client selected</p>
              )}
              {!isEditMode && !nameReadOnly && !form.selectedClient && form.clientQuery && !isSearching && (
                <p className="text-xs text-[#C8C8C8]">New client (will be created on save)</p>
              )}
              {isEditMode && appointment?.client_id && (
                <p className="text-xs text-[#C8C8C8]">Changes to the client&apos;s details are saved to their client record.</p>
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
                maxLength={254}
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
                    min={salonHours?.opening}
                    max={salonHours?.closing}
                    className="w-full h-11 px-3 text-sm text-[#1A1A1A] outline-none border-none bg-transparent"
                  />
                </div>
                {fieldErrors.time && <p className="text-xs text-red-600">{fieldErrors.time}</p>}
              </div>
            </div>
            <p className="text-xs text-[#8A8680] -mt-2">Times are in {timezone.replace(/_/g, ' ')} time.</p>

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
                    value={serviceSelectValue}
                    disabled={isCancelledView}
                    onChange={(e) => handleServiceChange(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-[#C8C8C8] bg-white text-sm text-[#1A1A1A] outline-none focus:border-[#1A1A1A] transition-colors"
                  >
                    <option value="">Select (optional)</option>
                    {serviceSelectValue === CURRENT_SERVICE_OPTION && (
                      <option value={CURRENT_SERVICE_OPTION}>{form.serviceType}</option>
                    )}
                    {selectableServices.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    id="modal-service"
                    type="text"
                    value={form.serviceType}
                    disabled={isCancelledView}
                    onChange={(e) => setForm((prev) => ({ ...prev, serviceId: '', serviceType: e.target.value }))}
                    placeholder="e.g. Haircut (optional)"
                    maxLength={100}
                    className="w-full h-10 px-3 rounded-lg border border-[#C8C8C8] bg-white text-sm text-[#1A1A1A] outline-none focus:border-[#1A1A1A] transition-colors"
                  />
                )}
              </div>

              {/* Staff — required when barbers exist; filtered by service assignment */}
              <div className="space-y-1.5">
                <Label htmlFor="modal-staff" className={labelClass}>
                  {selectableBarbers.length > 0
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
                  {/* Placeholder keeps the select honest while no staff member is chosen. */}
                  {selectableBarbers.length === 0
                    ? <option value="">No staff assigned</option>
                    : <option value="" disabled>Select staff…</option>}
                  {filteredBarbers.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
                {staffFiltered && (
                  <p className="text-xs text-[#8A8680]">
                    Showing {filteredBarbers.length} of {selectableBarbers.length} staff for this service.
                  </p>
                )}
                {fieldErrors.barberId && (
                  <p className="text-xs text-red-600">{fieldErrors.barberId}</p>
                )}
              </div>
            </div>
            <p className="text-xs text-[#8A8680] -mt-2">Duration: {resolvedDuration} min</p>

            {/* ---- Status ------------------------------------------------ */}
            {!isCancelledView && (
              <div className="space-y-1.5">
                <Label htmlFor="modal-status" className={labelClass}>Status</Label>
                <select
                  id="modal-status"
                  value={displayedStatus}
                  onChange={(e) => {
                    setStatusTouched(true);
                    setField('appointmentStatus', e.target.value as AppointmentStatus);
                  }}
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

            {isDemo && isEditMode && appointment?.status !== 'cancelled' && appointment?.client_email && (
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
