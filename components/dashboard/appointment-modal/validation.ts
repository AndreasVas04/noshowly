/**
 * components/dashboard/appointment-modal/validation.ts
 *
 * Checks the appointment modal runs when the owner saves:
 *  - validateForm(): per-field errors that block saving (required fields,
 *    phone and email format, a time the clocks skip, a missing staff member).
 *  - getSaveWarnings(): soft warnings the owner confirms before saving (a
 *    date that has passed, more than 6 months away, or outside business hours).
 *
 * No React or browser dependencies, so this is unit tested in Node.
 */

import { validateEmail, validatePhone } from '@/lib/contact';
import { normaliseTime, timeToMinutes } from '@/lib/time';
import type { AppointmentWithDetails, Barber } from '@/types';
import type { BusinessHours, FieldErrors, FormState } from './form';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** What validateForm() checks. */
interface FormValidationInput {
  /** Current form values. */
  form: FormState;
  /** The form as it was when the modal opened. */
  initialForm: FormState;
  /** Whether the modal edits an existing appointment. */
  isEditMode: boolean;
  /** The edited appointment (edit mode only). */
  appointment?: AppointmentWithDetails;
  /** Start instant of the form's date and time in the salon timezone, when valid. */
  formStart: Date | null;
  /** Active staff, plus the appointment's current staff member when editing. */
  selectableBarbers: Barber[];
}

/** What getSaveWarnings() checks. */
interface SaveWarningInput {
  /** Start instant of the form's date and time in the salon timezone, when valid. */
  formStart: Date | null;
  /** The form's time ('HH:MM', salon time). */
  time: string;
  /** Salon opening hours, or null when not configured. */
  salonHours: BusinessHours | null;
  /** Appointment length in minutes, as the server will resolve it. */
  resolvedDuration: number;
}

// ---------------------------------------------------------------------------
// Field validation
// ---------------------------------------------------------------------------

/**
 * Validates the form and returns the per-field errors.
 * Staff is required when barbers exist. Business hours constraints are soft warnings only.
 *
 * @param input - The form and what its rules depend on.
 * @returns The errors; empty when all required fields pass.
 */
export function validateForm({
  form,
  initialForm,
  isEditMode,
  appointment,
  formStart,
  selectableBarbers,
}: FormValidationInput): FieldErrors {
  const errors: FieldErrors = {};

  // Stored contact details (the edited appointment's client, or an existing
  // client picked in create mode) are only re-checked when changed, so an
  // older entry never blocks booking or editing.
  const storedPhone = isEditMode ? initialForm.clientPhone : form.selectedClient?.phone ?? null;
  const storedEmail = isEditMode ? initialForm.clientEmail : form.selectedClient?.email ?? null;
  const phoneChanged = storedPhone === null || form.clientPhone.trim() !== storedPhone.trim();
  const emailChanged = storedEmail === null || form.clientEmail.trim() !== storedEmail.trim();

  if (!form.clientQuery.trim()) errors.clientQuery = 'Client name is required';
  if (!form.clientPhone.trim()) {
    // A new client needs a phone number. Existing clients booked online may
    // have none; booking or editing them does not require one, but a stored
    // number cannot be removed here.
    const createsClient = isEditMode ? !appointment?.client_id : !form.selectedClient;
    const phoneRequired = createsClient || (isEditMode && Boolean(initialForm.clientPhone.trim()));
    if (phoneRequired) errors.clientPhone = 'Phone number is required';
  } else if (phoneChanged) {
    const phone = validatePhone(form.clientPhone);
    if (!phone.ok) errors.clientPhone = phone.error;
  }
  if (!form.date) errors.date = 'Date is required';
  if (!form.time) {
    errors.time = 'Time is required';
  } else if (form.date && !formStart) {
    errors.time = 'This time does not exist on that date (the clocks change). Choose another time.';
  }
  if (form.clientEmail.trim() && emailChanged) {
    const email = validateEmail(form.clientEmail);
    if (!email.ok) errors.clientEmail = email.error;
  }
  // Staff is required when the salon has staff to choose from.
  if (selectableBarbers.length > 0 && !form.barberId) {
    errors.barberId = 'Please select a staff member.';
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Soft warnings
// ---------------------------------------------------------------------------

/**
 * Collects the soft warnings (past date, far future, outside hours) the owner
 * confirms before the appointment is saved.
 *
 * @param input - The form's start and time, the business hours and the length.
 * @returns The warning messages in display order; empty when there are none.
 */
export function getSaveWarnings({
  formStart,
  time,
  salonHours,
  resolvedDuration,
}: SaveWarningInput): string[] {
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
  const startTime = normaliseTime(time);
  if (salonHours && startTime) {
    const startMinutes = timeToMinutes(startTime);
    const endMinutes = startMinutes + resolvedDuration;
    if (startMinutes < timeToMinutes(salonHours.opening) || endMinutes > timeToMinutes(salonHours.closing)) {
      warnings.push(
        `This appointment (${startTime}, ${resolvedDuration} min) is outside your business hours (${salonHours.opening} to ${salonHours.closing}).`
      );
    }
  }

  return warnings;
}
