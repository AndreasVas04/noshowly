/**
 * components/dashboard/appointment-modal/payloads.ts
 *
 * Request bodies the appointment modal sends when it saves:
 *  - POST /api/clients: a new client from the form's client fields.
 *  - PATCH /api/clients/[id]: the linked client's details that changed.
 *  - PUT /api/appointments/[id]: the appointment fields that changed.
 *  - POST /api/appointments: a new appointment.
 *
 * Edits send only the fields that changed since the modal opened, so a value
 * changed elsewhere meanwhile (e.g. a status the client confirmed from the
 * reminder email) is never overwritten with a stale one.
 *
 * No React or browser dependencies, so this is unit tested in Node.
 */

import type { Service } from '@/types';
import type { FormState } from './form';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** What buildAppointmentUpdate() compares and sends. */
interface AppointmentUpdateInput {
  /** Current form values. */
  form: FormState;
  /** The form as it was when the modal opened. */
  initialForm: FormState;
  /** The form's start as an ISO string (UTC). */
  datetime: string;
  /** Whether the staff member differs from when the modal opened. */
  barberChanged: boolean;
  /** Whether the service name differs from when the modal opened. */
  serviceChanged: boolean;
  /** The selected salon service, when the form's service is one. */
  selectedService: Service | null;
  /** Service name to store, or null for none. */
  serviceName: string | null;
  /** Whether the owner picked a status. */
  statusTouched: boolean;
  /** Client created on save for an appointment that has none, else null. */
  newClientId: string | null;
}

/** What buildNewAppointmentBody() sends. */
interface NewAppointmentInput {
  /** Current form values. */
  form: FormState;
  /** The appointment's client (existing, or created on save). */
  clientId: string;
  /** The form's start as an ISO string (UTC). */
  datetime: string;
  /** The selected salon service, when the form's service is one. */
  selectedService: Service | null;
  /** Service name to store, or null for none. */
  serviceName: string | null;
  /** Whether the owner picked a status. */
  statusTouched: boolean;
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

/**
 * Body of POST /api/clients for the client entered in the form. The API
 * creates the client or reuses the one with the same phone and name.
 *
 * @param form - Current form values.
 */
export function buildNewClientBody(form: FormState): { name: string; phone: string; email: string | null } {
  return {
    name: form.clientQuery.trim(),
    phone: form.clientPhone.trim(),
    email: form.clientEmail.trim() || null,
  };
}

/**
 * Changed details of the linked client, for PATCH /api/clients/[id].
 * Only fields that differ from when the modal opened are included.
 *
 * @param form        - Current form values.
 * @param initialForm - The form as it was when the modal opened.
 * @returns The changes; empty when nothing changed.
 */
export function buildClientChanges(form: FormState, initialForm: FormState): Record<string, string | null> {
  const changes: Record<string, string | null> = {};
  if (form.clientQuery.trim() !== initialForm.clientQuery.trim()) changes.name = form.clientQuery.trim();
  if (form.clientPhone.trim() !== initialForm.clientPhone.trim()) changes.phone = form.clientPhone.trim() || null;
  if (form.clientEmail.trim() !== initialForm.clientEmail.trim()) changes.email = form.clientEmail.trim() || null;
  return changes;
}

// ---------------------------------------------------------------------------
// Appointments
// ---------------------------------------------------------------------------

/**
 * Body of PUT /api/appointments/[id]: only the fields that changed.
 *
 * @param input - The form, its state when the modal opened and the values to send.
 * @returns The changed fields; empty when nothing changed.
 */
export function buildAppointmentUpdate({
  form,
  initialForm,
  datetime,
  barberChanged,
  serviceChanged,
  selectedService,
  serviceName,
  statusTouched,
  newClientId,
}: AppointmentUpdateInput): Record<string, unknown> {
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
  return updateBody;
}

/**
 * Body of POST /api/appointments for a new appointment.
 *
 * @param input - The form and the values to send.
 */
export function buildNewAppointmentBody({
  form,
  clientId,
  datetime,
  selectedService,
  serviceName,
  statusTouched,
}: NewAppointmentInput) {
  return {
    client_id: clientId,
    barber_id: form.barberId || null,
    datetime,
    service_id: selectedService?.id ?? null,
    service_type: serviceName,
    notes: form.notes.trim() || null,
    // Without an explicit choice the server decides from the lead time.
    ...(statusTouched ? { status: form.appointmentStatus } : {}),
  };
}
