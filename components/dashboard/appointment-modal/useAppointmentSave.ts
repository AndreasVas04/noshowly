/**
 * components/dashboard/appointment-modal/useAppointmentSave.ts
 *
 * Saving the appointment modal, and its other requests:
 *  - Submit validates the form and collects soft warnings (past date, far
 *    future, outside business hours). With warnings, a confirmation overlay
 *    is shown first; its "Yes, save" saves anyway.
 *  - Save creates the appointment (and the client, via POST /api/clients,
 *    when no existing client is selected), or updates the edited appointment
 *    and its linked client, sending only the fields that changed.
 *  - A 409 from the API is shown under the staff or the time field.
 *  - "Cancel appointment" (DELETE) and "Send reminder" (a test reminder email).
 */

'use client';

import { useState, type Dispatch, type SetStateAction } from 'react';
import type { AppointmentWithDetails, Barber, Client, Service } from '@/types';
import type { BusinessHours, FieldErrors, FormState } from './form';
import {
  buildAppointmentUpdate,
  buildClientChanges,
  buildNewAppointmentBody,
  buildNewClientBody,
} from './payloads';
import { getSaveWarnings, validateForm } from './validation';

/** What useAppointmentSave() reads and updates. */
interface AppointmentSaveOptions {
  /** The edited appointment (edit mode only). */
  appointment?: AppointmentWithDetails;
  /** Whether the modal edits an existing appointment. */
  isEditMode: boolean;
  /** Called after a successful save or cancellation. */
  onSaved: () => void;
  /** Current form values. */
  form: FormState;
  /** The form as it was when the modal opened. */
  initialForm: FormState;
  /** Whether the owner picked a status. */
  statusTouched: boolean;
  /** Active staff, plus the appointment's current staff member when editing. */
  selectableBarbers: Barber[];
  /** The selected salon service, when the form's service is one. */
  selectedService: Service | null;
  /** Whether the service name differs from when the modal opened. */
  serviceChanged: boolean;
  /** Whether the staff member differs from when the modal opened. */
  barberChanged: boolean;
  /** Appointment length in minutes, as the server will resolve it. */
  resolvedDuration: number;
  /** Start instant of the form's date and time in the salon timezone, when valid. */
  formStart: Date | null;
  /** Salon opening hours, or null when not configured. */
  salonHours: BusinessHours | null;
  /** Sets the per-field validation messages. */
  setFieldErrors: Dispatch<SetStateAction<FieldErrors>>;
}

/**
 * Submit, save, cancel and test reminder state and handlers of the
 * appointment modal.
 *
 * @param options - The form, the values derived from it and the modal's callbacks.
 * @returns The request state, the handlers, and reset() for a new opening.
 */
export default function useAppointmentSave({
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
}: AppointmentSaveOptions) {
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

  // ---------------------------------------------------------------------------
  // Submit / error state
  // ---------------------------------------------------------------------------

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  /**
   * Validates the form. Sets per-field errors and returns false on failure.
   * Staff is required when barbers exist. Business hours constraints are soft warnings only.
   *
   * @returns true if all required fields pass.
   */
  function validate(): boolean {
    const errors = validateForm({ form, initialForm, isEditMode, appointment, formStart, selectableBarbers });
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
      body: JSON.stringify(buildNewClientBody(form)),
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
    const changes = buildClientChanges(form, initialForm);
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
        const updateBody = buildAppointmentUpdate({
          form,
          initialForm,
          datetime,
          barberChanged,
          serviceChanged,
          selectedService,
          serviceName,
          statusTouched,
          newClientId,
        });

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
          body: JSON.stringify(
            buildNewAppointmentBody({ form, clientId, datetime, selectedService, serviceName, statusTouched })
          ),
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

    const warnings = getSaveWarnings({ formStart, time: form.time, salonHours, resolvedDuration });

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

  /**
   * Clears the error, the warning overlay and the test reminder result.
   * Called while rendering when the modal opens.
   */
  function reset(): void {
    setError(null);
    setWarningDialog(null);
    setTestReminderResult(null);
  }

  return {
    isSendingTestReminder,
    testReminderResult,
    warningDialog,
    setWarningDialog,
    isSubmitting,
    isCancelling,
    error,
    doSave,
    handleSubmit,
    handleCancelAppointment,
    handleTestReminder,
    reset,
  };
}
