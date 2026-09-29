/**
 * components/dashboard/appointment-modal/__tests__/validation.test.ts
 *
 * Unit tests for the appointment modal's checks in
 * components/dashboard/appointment-modal/validation.ts: the per-field errors
 * that block saving (required fields, contact details re-checked only when
 * changed, a time the clocks skip, staff) and the soft warnings confirmed
 * before saving (past, far future, outside business hours).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSaveWarnings, validateForm } from '@/components/dashboard/appointment-modal/validation';
import type { FormState } from '@/components/dashboard/appointment-modal/form';
import type { AppointmentWithDetails, Barber, Client } from '@/types';

/** A complete, valid create-mode form for a new client. */
function formState(extra: Partial<FormState> = {}): FormState {
  return {
    clientQuery: 'Maria Georgiou',
    selectedClient: null,
    clientPhone: '+357 99 123 456',
    clientEmail: '',
    date: '2026-06-20',
    time: '10:00',
    serviceId: '',
    serviceType: '',
    barberId: 'barber-1',
    notes: '',
    appointmentStatus: 'scheduled',
    ...extra,
  };
}

/** Builds an existing client record. */
function client(extra: Partial<Client> = {}): Client {
  return {
    id: 'client-1',
    salon_id: 'salon-1',
    name: 'Maria Georgiou',
    phone: '+35799123456',
    email: 'maria@example.com',
    notes: null,
    created_at: '2026-06-01T10:00:00.000Z',
    ...extra,
  };
}

/** Builds a staff member. */
function barber(id: string): Barber {
  return {
    id,
    salon_id: 'salon-1',
    name: `Staff ${id}`,
    photo_url: null,
    bio: null,
    active: true,
    created_at: '2026-06-01T10:00:00.000Z',
  };
}

/** Builds an edited appointment. */
function appointment(extra: Partial<AppointmentWithDetails> = {}): AppointmentWithDetails {
  return {
    id: 'appt-1',
    salon_id: 'salon-1',
    client_id: 'client-1',
    barber_id: 'barber-1',
    datetime: '2026-06-20T07:00:00.000Z',
    service_type: null,
    duration_minutes: 30,
    notes: null,
    status: 'scheduled',
    created_at: '2026-06-01T10:00:00.000Z',
    client_name: 'Maria Georgiou',
    client_phone: '+35799123456',
    client_email: null,
    barber_name: 'Staff barber-1',
    ...extra,
  };
}

/** 10:00 on 20 June 2026 in Nicosia. */
const START = new Date('2026-06-20T07:00:00.000Z');
const STAFF = [barber('barber-1'), barber('barber-2')];

/** Validates a create-mode form (the form it started from is empty). */
function validateCreate(form: FormState, extra: { formStart?: Date | null; selectableBarbers?: Barber[] } = {}) {
  return validateForm({
    form,
    initialForm: formState({ clientQuery: '', clientPhone: '', barberId: '' }),
    isEditMode: false,
    formStart: extra.formStart === undefined ? START : extra.formStart,
    selectableBarbers: extra.selectableBarbers ?? STAFF,
  });
}

/** Validates an edit-mode form against the form it started from. */
function validateEdit(form: FormState, initialForm: FormState, editedAppointment = appointment()) {
  return validateForm({
    form,
    initialForm,
    isEditMode: true,
    appointment: editedAppointment,
    formStart: START,
    selectableBarbers: STAFF,
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('validateForm (create mode)', () => {
  it('accepts a complete form', () => {
    expect(validateCreate(formState())).toEqual({});
  });

  it('requires the client name, phone, date and time', () => {
    const errors = validateCreate(
      formState({ clientQuery: '  ', clientPhone: ' ', date: '', time: '' }),
      { formStart: null }
    );
    expect(errors).toEqual({
      clientQuery: 'Client name is required',
      clientPhone: 'Phone number is required',
      date: 'Date is required',
      time: 'Time is required',
    });
  });

  it('checks the phone and email format', () => {
    expect(validateCreate(formState({ clientPhone: '99 123 456' })).clientPhone).toBe(
      'Phone must include country code (e.g. +357 99 123 456)'
    );
    expect(validateCreate(formState({ clientEmail: 'maria@' })).clientEmail).toBe(
      'Enter a valid email address'
    );
    expect(validateCreate(formState({ clientEmail: ' maria@example.com ' }))).toEqual({});
  });

  it('reports a time the clocks skip on that date', () => {
    // 03:30 on 29 March 2026 does not exist in Nicosia, so there is no start instant.
    const errors = validateCreate(formState({ date: '2026-03-29', time: '03:30' }), { formStart: null });
    expect(errors).toEqual({
      time: 'This time does not exist on that date (the clocks change). Choose another time.',
    });
  });

  it('requires a staff member only when the salon has staff to choose from', () => {
    expect(validateCreate(formState({ barberId: '' })).barberId).toBe('Please select a staff member.');
    expect(validateCreate(formState({ barberId: '' }), { selectableBarbers: [] })).toEqual({});
  });

  it('does not require a phone number for an existing client booked without one', () => {
    const selected = client({ phone: null });
    expect(validateCreate(formState({ selectedClient: selected, clientPhone: '' }))).toEqual({});
  });

  it('does not re-check the stored contact details of a selected client', () => {
    const selected = client({ phone: '99 123 456', email: 'old-format@' });
    const form = formState({ selectedClient: selected, clientPhone: ' 99 123 456 ', clientEmail: 'old-format@' });
    expect(validateCreate(form)).toEqual({});
  });

  it('checks the contact details of a selected client once they are changed', () => {
    const selected = client({ phone: '99 123 456', email: 'old-format@' });
    const form = formState({ selectedClient: selected, clientPhone: '99 123 457', clientEmail: 'new-format@' });
    expect(validateCreate(form)).toEqual({
      clientPhone: 'Phone must include country code (e.g. +357 99 123 456)',
      clientEmail: 'Enter a valid email address',
    });
  });
});

describe('validateForm (edit mode)', () => {
  it('does not re-check unchanged contact details', () => {
    const initial = formState({ clientPhone: '99 123 456', clientEmail: 'old-format@' });
    expect(validateEdit(initial, initial)).toEqual({});
  });

  it('checks contact details that changed', () => {
    const initial = formState({ clientPhone: '99 123 456', clientEmail: 'old-format@' });
    const form = { ...initial, clientPhone: '99 000 000', clientEmail: 'still-wrong@' };
    expect(validateEdit(form, initial)).toEqual({
      clientPhone: 'Phone must include country code (e.g. +357 99 123 456)',
      clientEmail: 'Enter a valid email address',
    });
  });

  it('does not let a stored phone number be removed', () => {
    const initial = formState();
    expect(validateEdit({ ...initial, clientPhone: '' }, initial).clientPhone).toBe('Phone number is required');
  });

  it('does not require a phone number for a client who has none', () => {
    const initial = formState({ clientPhone: '' });
    expect(validateEdit(initial, initial)).toEqual({});
  });

  it('requires a phone number when the appointment has no client record', () => {
    const initial = formState({ clientPhone: '' });
    expect(validateEdit(initial, initial, appointment({ client_id: null })).clientPhone).toBe(
      'Phone number is required'
    );
  });
});

describe('getSaveWarnings', () => {
  const HOURS = { opening: '09:00', closing: '18:00' };

  it('warns about a date that has already passed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-21T07:00:00.000Z'));
    expect(getSaveWarnings({ formStart: START, time: '10:00', salonHours: null, resolvedDuration: 30 })).toEqual([
      'This date has already passed. Are you sure?',
    ]);
  });

  it('warns about a date more than 6 months away', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-12-19T07:00:00.000Z'));
    expect(getSaveWarnings({ formStart: START, time: '10:00', salonHours: null, resolvedDuration: 30 })).toEqual([
      'This is more than 6 months away. Are you sure?',
    ]);

    vi.setSystemTime(new Date('2025-12-21T07:00:00.000Z'));
    expect(getSaveWarnings({ formStart: START, time: '10:00', salonHours: null, resolvedDuration: 30 })).toEqual([]);
  });

  it('warns when the appointment starts before opening or runs past closing', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-19T07:00:00.000Z'));
    expect(getSaveWarnings({ formStart: START, time: '08:30', salonHours: HOURS, resolvedDuration: 30 })).toEqual([
      'This appointment (08:30, 30 min) is outside your business hours (09:00 to 18:00).',
    ]);
    expect(getSaveWarnings({ formStart: START, time: '17:45', salonHours: HOURS, resolvedDuration: 30 })).toEqual([
      'This appointment (17:45, 30 min) is outside your business hours (09:00 to 18:00).',
    ]);
  });

  it('accepts an appointment that fits the business hours exactly', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-19T07:00:00.000Z'));
    expect(getSaveWarnings({ formStart: START, time: '09:00', salonHours: HOURS, resolvedDuration: 30 })).toEqual([]);
    expect(getSaveWarnings({ formStart: START, time: '17:30', salonHours: HOURS, resolvedDuration: 30 })).toEqual([]);
  });

  it('skips the business hours check when the hours or the time are not set', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-19T07:00:00.000Z'));
    expect(getSaveWarnings({ formStart: START, time: '23:00', salonHours: null, resolvedDuration: 30 })).toEqual([]);
    expect(getSaveWarnings({ formStart: START, time: '', salonHours: HOURS, resolvedDuration: 30 })).toEqual([]);
  });

  it('lists every warning that applies, date first', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-21T07:00:00.000Z'));
    expect(getSaveWarnings({ formStart: START, time: '20:00', salonHours: HOURS, resolvedDuration: 45 })).toEqual([
      'This date has already passed. Are you sure?',
      'This appointment (20:00, 45 min) is outside your business hours (09:00 to 18:00).',
    ]);
  });

  it('checks the business hours without a start instant', () => {
    expect(getSaveWarnings({ formStart: null, time: '07:00', salonHours: HOURS, resolvedDuration: 30 })).toEqual([
      'This appointment (07:00, 30 min) is outside your business hours (09:00 to 18:00).',
    ]);
  });
});
