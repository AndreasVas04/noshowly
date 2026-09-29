/**
 * app/book/[slug]/_components/useBookingForm.ts
 *
 * The client details form of the public booking page and the booking request.
 *
 *  - Fields: name, phone, email, notes and the honeypot (hp_field), plus the
 *    validation message shown in the form.
 *  - Submit: checks the name, the phone and email when the booking page
 *    requires them (and their format whenever given) and that a date and
 *    time are picked, then calls POST /api/book/[slug]/appointments. The
 *    confirmed booking is kept for the success screen. A 409 means the time
 *    was taken in the meantime; the caller then reloads the busy times.
 *
 * BookingFlow calls this hook, so the details survive going back to change
 * the date or time.
 */

'use client';

import { useState, FormEvent } from 'react';
import { getEffectiveDuration } from '@/lib/availability';
import { validateEmail, validatePhone } from '@/lib/contact';
import type { PublicBarber, PublicService, PublicServiceAssignment } from '@/types';
import type { ConfirmedBooking } from './types';

type BookingFormOptions = {
  /** Booking page slug. */
  slug: string;
  /** Whether clients must supply a phone number. Controlled by booking page settings. */
  requirePhone: boolean;
  /** Whether clients must supply an email address. Controlled by booking page settings. */
  requireEmail: boolean;
  /** The chosen service; null for salons without services. */
  selectedService: PublicService | null;
  /** The chosen staff member; null for "Any available staff" and salons without staff. */
  specificBarber: PublicBarber | null;
  /** Chosen date, 'YYYY-MM-DD' in the salon timezone. */
  selectedDate: string | null;
  /** Chosen start time, 'HH:MM' in the salon timezone. */
  selectedTime: string | null;
  /** All staff/service links of the salon, for the booked duration. */
  barberServiceAssignments: PublicServiceAssignment[];
  /** Called once the appointment exists. */
  onBooked: () => void;
  /** Called on 409: the time was taken in the meantime. */
  onTimeTaken: () => void;
};

/**
 * Holds the client details and submits the booking.
 *
 * @param options - Booking page settings, the visitor's selections and the callbacks.
 * @returns The field values and setters, the validation and booking error
 *          messages, whether the request is in flight, the confirmed booking
 *          and the form's submit handler.
 */
export function useBookingForm({
  slug,
  requirePhone,
  requireEmail,
  selectedService,
  specificBarber,
  selectedDate,
  selectedTime,
  barberServiceAssignments,
  onBooked,
  onTimeTaken,
}: BookingFormOptions) {
  // -------------------------------------------------------------------------
  // Client details
  // -------------------------------------------------------------------------

  const [clientName,   setClientName]   = useState('');
  const [clientPhone,  setClientPhone]  = useState('');
  const [clientEmail,  setClientEmail]  = useState('');
  const [clientNotes,  setClientNotes]  = useState('');
  /**
   * Honeypot: hidden from people, so it must stay empty. Bots tend to fill it in.
   * Its name means nothing to browser autofill, which could fill a field such
   * as "company" even though it is hidden.
   */
  const [honeypot,     setHoneypot]     = useState('');
  const [detailsError, setDetailsError] = useState('');

  // -------------------------------------------------------------------------
  // Submit state
  // -------------------------------------------------------------------------

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [confirmed, setConfirmed] = useState<ConfirmedBooking | null>(null);

  // -------------------------------------------------------------------------
  // Submit handler
  // -------------------------------------------------------------------------

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setDetailsError('');
    setSubmitError('');

    const name  = clientName.trim();
    const phone = clientPhone.trim();
    const email = clientEmail.trim();
    const notes = clientNotes.trim();

    if (!name) { setDetailsError('Your name is required.'); return; }

    if (requirePhone && !phone) {
      setDetailsError('Your phone number is required.');
      return;
    }
    if (phone) {
      const phoneCheck = validatePhone(phone);
      if (!phoneCheck.ok) { setDetailsError(`${phoneCheck.error}.`); return; }
    }
    if (requireEmail && !email) {
      setDetailsError('Your email is required to receive email reminders.');
      return;
    }
    if (email) {
      const emailCheck = validateEmail(email);
      if (!emailCheck.ok) { setDetailsError(`${emailCheck.error}.`); return; }
    }
    if (!selectedDate || !selectedTime) {
      setDetailsError('Please select a date and time.');
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch(`/api/book/${encodeURIComponent(slug)}/appointments`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id:   selectedService?.id ?? null,
          // null = "Any available staff" (or no staff): the server assigns.
          barber_id:    specificBarber?.id ?? null,
          date:         selectedDate,
          time:         selectedTime,
          client_name:  name,
          client_phone: phone || null,
          client_email: email || null,
          notes:        notes || null,
          hp_field:     honeypot,
        }),
      });

      if (!res.ok) {
        let errMsg = 'Something went wrong. Please try again.';
        try {
          const data = (await res.json()) as { error?: string };
          if (data.error) errMsg = data.error;
        } catch {
          // Server returned non-JSON (e.g. Next.js HTML error page) — log status for debugging.
          console.error('[BookingFlow] server returned non-JSON error — status:', res.status, res.statusText);
          errMsg = `Server error (${res.status}). Please try again.`;
        }
        setSubmitError(errMsg);
        // The time was taken in the meantime: refresh so it disappears from the list.
        if (res.status === 409) onTimeTaken();
        return;
      }

      const data = (await res.json()) as {
        appointmentId: string;
        barberName?: string | null;
        durationMinutes?: number;
      };
      setConfirmed({
        appointmentId:   data.appointmentId,
        barberName:      data.barberName ?? specificBarber?.name ?? null,
        durationMinutes: data.durationMinutes ?? getEffectiveDuration(selectedService, specificBarber?.id, barberServiceAssignments),
      });
      onBooked();
    } catch (err) {
      console.error('[BookingFlow] fetch error:', err);
      setSubmitError('Something went wrong. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return {
    clientName,   setClientName,
    clientPhone,  setClientPhone,
    clientEmail,  setClientEmail,
    clientNotes,  setClientNotes,
    honeypot,     setHoneypot,
    detailsError, setDetailsError,
    submitError,  setSubmitError,
    submitting,
    confirmed,
    handleSubmit,
  };
}

/** The client details form: what useBookingForm() returns. */
export type BookingForm = ReturnType<typeof useBookingForm>;
