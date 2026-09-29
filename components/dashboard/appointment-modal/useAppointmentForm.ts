/**
 * components/dashboard/appointment-modal/useAppointmentForm.ts
 *
 * State and logic behind the appointment modal (AddAppointmentModal).
 *
 * Owns the form state, starts a fresh form each time the modal opens and
 * derives what the fields show: the selected service, the appointment length
 * as the server will resolve it, the start instant in the salon timezone and
 * the status shown before the owner picks one. Composes the modal's other
 * hooks, in this order:
 *  - useModalData: staff, services, business hours and staff/service
 *    assignments, loaded each time the modal opens.
 *  - useClientLookup: client name search and phone lookup (create mode).
 *  - useAppointmentSave: submit, save, cancel and test reminder.
 */

'use client';

import { useState } from 'react';
import { getEffectiveDuration, isBarberEligibleForService } from '@/lib/availability';
import { normaliseTime, resolveZonedTime } from '@/lib/time';
import type { AppointmentStatus, AppointmentWithDetails, Barber, Service } from '@/types';
import {
  CURRENT_SERVICE_OPTION,
  getInitialFormState,
  predictStatus,
  sameName,
  type FieldErrors,
  type FormState,
} from './form';
import useAppointmentSave from './useAppointmentSave';
import useClientLookup from './useClientLookup';
import useModalData from './useModalData';

/** The modal's props the form depends on. */
interface AppointmentFormOptions {
  /** Whether the modal is visible. */
  isOpen: boolean;
  /** Called after a successful save. */
  onSaved: () => void;
  /** Salon timezone; dates and times in the form are in this timezone. */
  timezone: string;
  /** Salon date ('YYYY-MM-DD') to pre-fill when creating. Defaults to today in the salon. */
  initialDate?: string;
  /** Barber UUID to pre-select (create mode only). */
  initialBarberId?: string;
  /** If provided, the form edits this appointment. */
  appointment?: AppointmentWithDetails;
}

/**
 * Form state, derived values and handlers of the appointment modal.
 *
 * @param options - The modal's props the form depends on.
 * @returns The form, the loaded data (`data`), the client lookups (`lookup`),
 *          the request state and handlers (`save`) and the derived values.
 */
export default function useAppointmentForm({
  isOpen,
  onSaved,
  timezone,
  initialDate,
  initialBarberId,
  appointment,
}: AppointmentFormOptions) {
  const isEditMode = Boolean(appointment);

  // ---------------------------------------------------------------------------
  // Form state
  // ---------------------------------------------------------------------------

  /**
   * Builds the initial FormState from the appointment prop (edit mode) or defaults.
   * Edit mode converts the stored UTC time to the salon's timezone.
   */
  function getInitialState(): FormState {
    return getInitialFormState({ appointment, timezone, initialDate, initialBarberId });
  }

  const [form, setForm] = useState<FormState>(getInitialState);
  /** The form as it was when the modal opened — used to send only changed fields. */
  const [initialForm, setInitialForm] = useState<FormState>(form);
  /** True once the owner picks a status; otherwise the server decides (create mode). */
  const [statusTouched, setStatusTouched] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

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

  // ---------------------------------------------------------------------------
  // Staff + services + hours, client lookups
  // ---------------------------------------------------------------------------

  // Called in this order so their effects run in this order: loading the
  // data, the demo account check, then the debounced client lookups.
  const data = useModalData(isOpen);
  const { barbers, isLoadingBarbers, services, barberServices, salonHours } = data;
  const lookup = useClientLookup({ isEditMode, form, setForm, setField, setFieldErrors });

  /** Active staff, plus the appointment's current staff member when editing. */
  const selectableBarbers = barbers.filter(
    (b) => b.active || (isEditMode && b.id === appointment?.barber_id)
  );

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  /** The selected salon service, when the form's service is one (matched by name when editing). */
  const selectedService: Service | null =
    services.find((s) => s.id === form.serviceId) ??
    (form.serviceType ? services.find((s) => sameName(s.name, form.serviceType)) : undefined) ??
    null;

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

  // ---------------------------------------------------------------------------
  // Submit, save, cancel, test reminder
  // ---------------------------------------------------------------------------

  const save = useAppointmentSave({
    appointment,
    isEditMode,
    onSaved,
    form,
    initialForm,
    statusTouched,
    selectableBarbers,
    selectedService,
    serviceChanged,
    barberChanged,
    resolvedDuration,
    formStart,
    salonHours,
    setFieldErrors,
  });

  // ---------------------------------------------------------------------------
  // State adjusted while rendering
  // ---------------------------------------------------------------------------

  const [wasOpen, setWasOpen] = useState(isOpen);
  /** The staff list the create-mode default below was last checked against. */
  const [checkedBarbers, setCheckedBarbers] = useState<Barber[] | null>(null);

  // The modal stays mounted while closed, so every opening starts a fresh form.
  // Resetting here, during render, means the previous form is never painted.
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      const state = getInitialState();
      setForm(state);
      setInitialForm(state);
      setStatusTouched(false);
      setShowNotes(Boolean(appointment?.notes));
      setFieldErrors({});
      lookup.reset();
      save.reset();
      data.reset();
      setCheckedBarbers(null);
    }
  }

  // In create mode, once the staff list loads, keep the pre-selected
  // (initialBarberId) or chosen staff member only when they are listed, and
  // default to the first listed one otherwise. An inactive staff member (e.g.
  // from the week view's filter) is not listed: keeping them would save them
  // while the dropdown shows someone else. Checked once per loaded list, so a
  // staff member cleared later (by picking another service) stays cleared.
  if (!isEditMode && !isLoadingBarbers && checkedBarbers !== barbers) {
    setCheckedBarbers(barbers);
    const listed = barbers.filter((b) => b.active);
    setForm((prev) => {
      if (listed.some((b) => b.id === prev.barberId)) return prev;
      const fallback = listed[0]?.id ?? '';
      return prev.barberId === fallback ? prev : { ...prev, barberId: fallback };
    });
  }

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

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

  return {
    isEditMode,
    form,
    setForm,
    setField,
    fieldErrors,
    setStatusTouched,
    showNotes,
    setShowNotes,
    data,
    lookup,
    save,
    selectableBarbers,
    selectedService,
    resolvedDuration,
    displayedStatus,
    handleServiceChange,
  };
}
