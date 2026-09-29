/**
 * components/dashboard/appointment-modal/form.ts
 *
 * Form state of the appointment modal (AddAppointmentModal): its shape, the
 * state a form starts from each time the modal opens, and small helpers the
 * modal derives values with.
 *
 * Dates and times in the form are in the salon's timezone; the stored UTC
 * time of an edited appointment is converted when the form is built.
 *
 * No React or browser dependencies, so this is unit tested in Node.
 */

import { minutesToTime, timeToMinutes, todayInZone, utcToZonedParts } from '@/lib/time';
import type { AppointmentStatus, AppointmentWithDetails, Client } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The appointment modal's form fields. */
export interface FormState {
  /** Client name (search text in create mode). */
  clientQuery: string;
  selectedClient: Client | null;
  clientPhone: string;
  clientEmail: string;
  /** 'YYYY-MM-DD' in the salon timezone. */
  date: string;
  /** 'HH:MM' in the salon timezone. */
  time: string;
  /**
   * Service id picked in the form; '' when none is picked or the service is
   * free text. An edited appointment's service is matched by name instead.
   */
  serviceId: string;
  /** Service name (free text when the salon has no services). */
  serviceType: string;
  barberId: string;
  notes: string;
  /** Status chosen in the form. Only sent when the owner changed it. */
  appointmentStatus: AppointmentStatus;
}

/** Per-field validation messages, keyed by form field. */
export type FieldErrors = Partial<Record<keyof FormState, string>>;

/** Updates a single form field and clears its per-field error. */
export type SetField = <K extends keyof FormState>(key: K, value: FormState[K]) => void;

/** Salon opening hours as 'HH:MM'. */
export type BusinessHours = { opening: string; closing: string };

/** What a new form is built from: the modal's props. */
interface InitialFormOptions {
  /** If provided, the form edits this appointment. */
  appointment?: AppointmentWithDetails;
  /** Salon timezone; dates and times in the form are in this timezone. */
  timezone: string;
  /** Salon date ('YYYY-MM-DD') to pre-fill when creating. Defaults to today in the salon. */
  initialDate?: string;
  /** Barber UUID to pre-select (create mode only). */
  initialBarberId?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Select value for an edited appointment's service that is not in the list. */
export const CURRENT_SERVICE_OPTION = '__current__';

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
export function predictStatus(start: Date | null): AppointmentStatus {
  if (!start) return 'scheduled';
  const hoursUntil = (start.getTime() - Date.now()) / (1000 * 60 * 60);
  return hoursUntil < 23 ? 'confirmed' : 'scheduled';
}

/** Case-insensitive, trimmed comparison of optional names. */
export function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

/**
 * Builds the initial FormState from the appointment prop (edit mode) or defaults.
 * Edit mode converts the stored UTC time to the salon's timezone.
 *
 * @param options - The modal's props the form starts from.
 */
export function getInitialFormState({
  appointment,
  timezone,
  initialDate,
  initialBarberId,
}: InitialFormOptions): FormState {
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
