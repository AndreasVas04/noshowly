/**
 * components/dashboard/appointment-modal/__tests__/form.test.ts
 *
 * Unit tests for the appointment modal's form state helpers in
 * components/dashboard/appointment-modal/form.ts: the initial form for create
 * and edit mode (salon-timezone date and time), the predicted status and the
 * service name comparison.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getInitialFormState,
  predictStatus,
  sameName,
} from '@/components/dashboard/appointment-modal/form';
import type { AppointmentWithDetails } from '@/types';

const TZ = 'Europe/Nicosia';

/** Builds an appointment as GET /api/appointments returns it. */
function appointment(extra: Partial<AppointmentWithDetails> = {}): AppointmentWithDetails {
  return {
    id: 'appt-1',
    salon_id: 'salon-1',
    client_id: 'client-1',
    barber_id: 'barber-1',
    // 09:30 in Nicosia (UTC+3 in summer).
    datetime: '2026-06-15T06:30:00.000Z',
    service_type: 'Haircut',
    duration_minutes: 45,
    notes: 'Short on the sides',
    status: 'confirmed',
    created_at: '2026-06-01T10:00:00.000Z',
    client_name: 'Maria Georgiou',
    client_phone: '+35799123456',
    client_email: 'maria@example.com',
    barber_name: 'Andreas',
    ...extra,
  };
}

/** Freezes the clock at an instant. */
function setNow(iso: string): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('getInitialFormState (edit mode)', () => {
  it('pre-fills the appointment with its time in the salon timezone', () => {
    expect(getInitialFormState({ appointment: appointment(), timezone: TZ })).toEqual({
      clientQuery: 'Maria Georgiou',
      selectedClient: {
        id: 'client-1',
        salon_id: 'salon-1',
        name: 'Maria Georgiou',
        phone: '+35799123456',
        email: 'maria@example.com',
        notes: null,
        created_at: '',
      },
      clientPhone: '+35799123456',
      clientEmail: 'maria@example.com',
      date: '2026-06-15',
      time: '09:30',
      serviceId: '',
      serviceType: 'Haircut',
      barberId: 'barber-1',
      notes: 'Short on the sides',
      appointmentStatus: 'confirmed',
    });
  });

  it('uses the salon date, not the UTC date', () => {
    // 22:30 UTC is 01:30 the next day in Nicosia.
    const form = getInitialFormState({
      appointment: appointment({ datetime: '2026-06-15T22:30:00.000Z' }),
      timezone: TZ,
    });
    expect(form.date).toBe('2026-06-16');
    expect(form.time).toBe('01:30');
  });

  it('has no selected client when the client record is gone, and empty strings for missing values', () => {
    const form = getInitialFormState({
      appointment: appointment({
        client_id: null,
        client_name: null,
        client_phone: null,
        client_email: null,
        barber_id: null,
        service_type: null,
        notes: null,
      }),
      timezone: TZ,
    });
    expect(form.selectedClient).toBeNull();
    expect(form.clientQuery).toBe('');
    expect(form.clientPhone).toBe('');
    expect(form.clientEmail).toBe('');
    expect(form.barberId).toBe('');
    expect(form.serviceType).toBe('');
    expect(form.notes).toBe('');
  });

  it('keeps a missing phone or email as null on the selected client', () => {
    const form = getInitialFormState({
      appointment: appointment({ client_phone: null, client_email: null }),
      timezone: TZ,
    });
    expect(form.selectedClient?.phone).toBeNull();
    expect(form.selectedClient?.email).toBeNull();
  });

  it('ignores the create-mode defaults', () => {
    const form = getInitialFormState({
      appointment: appointment(),
      timezone: TZ,
      initialDate: '2026-07-01',
      initialBarberId: 'barber-2',
    });
    expect(form.date).toBe('2026-06-15');
    expect(form.barberId).toBe('barber-1');
  });
});

describe('getInitialFormState (create mode)', () => {
  it('starts empty with the given date and staff member', () => {
    setNow('2026-06-15T11:10:00Z'); // 14:10 in Nicosia
    expect(
      getInitialFormState({ timezone: TZ, initialDate: '2026-06-20', initialBarberId: 'barber-2' })
    ).toEqual({
      clientQuery: '',
      selectedClient: null,
      clientPhone: '',
      clientEmail: '',
      date: '2026-06-20',
      time: '14:30',
      serviceId: '',
      serviceType: '',
      barberId: 'barber-2',
      notes: '',
      appointmentStatus: 'scheduled',
    });
  });

  it('defaults to today in the salon and no staff member', () => {
    setNow('2026-06-15T22:30:00Z'); // 01:30 on 16 June in Nicosia
    const form = getInitialFormState({ timezone: TZ });
    expect(form.date).toBe('2026-06-16');
    expect(form.barberId).toBe('');
  });

  it('pre-fills the next rounded 30-minute slot in the salon timezone', () => {
    setNow('2026-06-15T11:35:00Z'); // 14:35 in Nicosia
    expect(getInitialFormState({ timezone: TZ }).time).toBe('15:00');

    setNow('2026-06-15T11:00:00Z'); // 14:00 on the dot moves on to the next slot
    expect(getInitialFormState({ timezone: TZ }).time).toBe('14:30');

    setNow('2026-06-15T11:10:00Z');
    expect(getInitialFormState({ timezone: 'UTC' }).time).toBe('11:30');
  });

  it('stops at 23:30 late in the evening', () => {
    setNow('2026-06-15T20:40:00Z'); // 23:40 in Nicosia
    expect(getInitialFormState({ timezone: TZ }).time).toBe('23:30');
  });
});

describe('predictStatus', () => {
  it('is pending while the date or time is incomplete', () => {
    expect(predictStatus(null)).toBe('scheduled');
  });

  it('is confirmed when the appointment starts within 23 hours', () => {
    setNow('2026-06-15T10:00:00Z');
    expect(predictStatus(new Date('2026-06-15T12:00:00Z'))).toBe('confirmed');
    expect(predictStatus(new Date('2026-06-16T08:59:00Z'))).toBe('confirmed');
    expect(predictStatus(new Date('2026-06-15T09:00:00Z'))).toBe('confirmed');
  });

  it('is pending from 23 hours ahead', () => {
    setNow('2026-06-15T10:00:00Z');
    expect(predictStatus(new Date('2026-06-16T09:00:00Z'))).toBe('scheduled');
    expect(predictStatus(new Date('2026-06-20T10:00:00Z'))).toBe('scheduled');
  });
});

describe('sameName', () => {
  it('ignores case and surrounding spaces', () => {
    expect(sameName('Haircut', ' haircut ')).toBe(true);
    expect(sameName('Haircut', 'Beard trim')).toBe(false);
  });

  it('treats null and undefined as an empty name', () => {
    expect(sameName(null, '')).toBe(true);
    expect(sameName(undefined, '  ')).toBe(true);
    expect(sameName(null, 'Haircut')).toBe(false);
  });
});
