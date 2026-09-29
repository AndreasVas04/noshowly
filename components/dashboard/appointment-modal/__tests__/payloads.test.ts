/**
 * components/dashboard/appointment-modal/__tests__/payloads.test.ts
 *
 * Unit tests for the request bodies the appointment modal sends, built in
 * components/dashboard/appointment-modal/payloads.ts: a new client, the
 * changed details of a linked client, the changed fields of an edited
 * appointment and a new appointment. Bodies are compared as the JSON that is
 * sent, so the field order is checked too.
 */

import { describe, expect, it } from 'vitest';
import {
  buildAppointmentUpdate,
  buildClientChanges,
  buildNewAppointmentBody,
  buildNewClientBody,
} from '@/components/dashboard/appointment-modal/payloads';
import type { FormState } from '@/components/dashboard/appointment-modal/form';
import type { Service } from '@/types';

/** An edit-mode form as it was when the modal opened. */
function formState(extra: Partial<FormState> = {}): FormState {
  return {
    clientQuery: 'Maria Georgiou',
    selectedClient: null,
    clientPhone: '+35799123456',
    clientEmail: 'maria@example.com',
    date: '2026-06-20',
    time: '10:00',
    serviceId: '',
    serviceType: 'Haircut',
    barberId: 'barber-1',
    notes: 'Short on the sides',
    appointmentStatus: 'scheduled',
    ...extra,
  };
}

const HAIRCUT: Service = {
  id: 'service-1',
  salon_id: 'salon-1',
  name: 'Haircut',
  duration_minutes: 30,
  price: 20,
  active: true,
  created_at: '2026-06-01T10:00:00.000Z',
};

const DATETIME = '2026-06-20T07:00:00.000Z';

/** The edited appointment's form when the modal opened. */
const INITIAL = formState();

/** Builds the update body for a form edited from INITIAL, with nothing else changed. */
function update(form: FormState, extra: Partial<Parameters<typeof buildAppointmentUpdate>[0]> = {}) {
  return buildAppointmentUpdate({
    form,
    initialForm: INITIAL,
    datetime: DATETIME,
    barberChanged: false,
    serviceChanged: false,
    selectedService: HAIRCUT,
    serviceName: 'Haircut',
    statusTouched: false,
    newClientId: null,
    ...extra,
  });
}

describe('buildNewClientBody', () => {
  it('sends the trimmed name, phone and email', () => {
    const form = formState({ clientQuery: ' Maria ', clientPhone: ' +357 99 123 456 ', clientEmail: ' m@example.com ' });
    expect(JSON.stringify(buildNewClientBody(form))).toBe(
      '{"name":"Maria","phone":"+357 99 123 456","email":"m@example.com"}'
    );
  });

  it('sends no email when none is entered', () => {
    expect(buildNewClientBody(formState({ clientEmail: '  ' })).email).toBeNull();
  });
});

describe('buildClientChanges', () => {
  it('is empty when nothing changed, ignoring surrounding spaces', () => {
    const form = formState({ clientQuery: ' Maria Georgiou ', clientPhone: '+35799123456 ' });
    expect(buildClientChanges(form, INITIAL)).toEqual({});
  });

  it('sends only the fields that changed', () => {
    expect(JSON.stringify(buildClientChanges(formState({ clientEmail: 'new@example.com' }), INITIAL))).toBe(
      '{"email":"new@example.com"}'
    );
    expect(JSON.stringify(buildClientChanges(formState({ clientQuery: ' Maria G. ' }), INITIAL))).toBe(
      '{"name":"Maria G."}'
    );
  });

  it('sends null for a cleared phone or email', () => {
    const form = formState({ clientPhone: '', clientEmail: ' ' });
    expect(JSON.stringify(buildClientChanges(form, INITIAL))).toBe('{"phone":null,"email":null}');
  });

  it('lists name, phone and email in that order', () => {
    const form = formState({ clientEmail: 'new@example.com', clientPhone: '+35799000000', clientQuery: 'Maria G.' });
    expect(JSON.stringify(buildClientChanges(form, INITIAL))).toBe(
      '{"name":"Maria G.","phone":"+35799000000","email":"new@example.com"}'
    );
  });
});

describe('buildAppointmentUpdate', () => {
  it('is empty when nothing changed', () => {
    expect(update(formState({ notes: ' Short on the sides ' }))).toEqual({});
  });

  it('sends only the notes for a notes-only edit', () => {
    expect(JSON.stringify(update(formState({ notes: ' Fade ' })))).toBe('{"notes":"Fade"}');
    expect(JSON.stringify(update(formState({ notes: '' })))).toBe('{"notes":null}');
  });

  it('sends the start when the date or time changed', () => {
    const datetime = '2026-06-21T07:00:00.000Z';
    expect(update(formState({ date: '2026-06-21' }), { datetime })).toEqual({ datetime });
    expect(update(formState({ time: '10:30' }), { datetime })).toEqual({ datetime });
  });

  it('sends the staff member when it changed (none as null)', () => {
    expect(update(formState({ barberId: 'barber-2' }), { barberChanged: true })).toEqual({ barber_id: 'barber-2' });
    expect(update(formState({ barberId: '' }), { barberChanged: true })).toEqual({ barber_id: null });
  });

  it('sends the service id and name when the service changed', () => {
    expect(update(formState(), { serviceChanged: true })).toEqual({ service_id: 'service-1', service_type: 'Haircut' });
    expect(
      update(formState({ serviceType: 'Beard trim' }), { serviceChanged: true, selectedService: null, serviceName: 'Beard trim' })
    ).toEqual({ service_id: null, service_type: 'Beard trim' });
    expect(
      update(formState({ serviceType: '' }), { serviceChanged: true, selectedService: null, serviceName: null })
    ).toEqual({ service_id: null, service_type: null });
  });

  it('sends the status only when the owner changed it', () => {
    const confirmed = formState({ appointmentStatus: 'confirmed' });
    expect(update(confirmed)).toEqual({});
    expect(update(confirmed, { statusTouched: true })).toEqual({ status: 'confirmed' });
    expect(update(formState(), { statusTouched: true })).toEqual({});
  });

  it('links a client created on save', () => {
    expect(update(formState(), { newClientId: 'client-2' })).toEqual({ client_id: 'client-2' });
  });

  it('lists the changed fields in a fixed order', () => {
    const form = formState({
      date: '2026-06-21',
      barberId: 'barber-2',
      serviceType: 'Beard trim',
      notes: 'Fade',
      appointmentStatus: 'confirmed',
    });
    const body = update(form, {
      barberChanged: true,
      serviceChanged: true,
      selectedService: null,
      serviceName: 'Beard trim',
      statusTouched: true,
      newClientId: 'client-2',
    });
    expect(JSON.stringify(body)).toBe(
      `{"datetime":"${DATETIME}","barber_id":"barber-2","service_id":null,"service_type":"Beard trim",` +
        '"notes":"Fade","status":"confirmed","client_id":"client-2"}'
    );
  });
});

describe('buildNewAppointmentBody', () => {
  const base = { clientId: 'client-1', datetime: DATETIME, selectedService: HAIRCUT, serviceName: 'Haircut' };

  it('sends the appointment and lets the server pick the status', () => {
    const body = buildNewAppointmentBody({ ...base, form: formState({ notes: ' Fade ' }), statusTouched: false });
    expect(JSON.stringify(body)).toBe(
      `{"client_id":"client-1","barber_id":"barber-1","datetime":"${DATETIME}",` +
        '"service_id":"service-1","service_type":"Haircut","notes":"Fade"}'
    );
  });

  it('sends the status the owner picked', () => {
    const form = formState({ appointmentStatus: 'confirmed' });
    expect(buildNewAppointmentBody({ ...base, form, statusTouched: true })).toMatchObject({ status: 'confirmed' });
    expect(buildNewAppointmentBody({ ...base, form, statusTouched: false })).not.toHaveProperty('status');
  });

  it('sends null for no staff member, service or notes', () => {
    const form = formState({ barberId: '', serviceType: '', notes: '  ' });
    const body = buildNewAppointmentBody({ ...base, form, selectedService: null, serviceName: null, statusTouched: false });
    expect(body).toEqual({
      client_id: 'client-1',
      barber_id: null,
      datetime: DATETIME,
      service_id: null,
      service_type: null,
      notes: null,
    });
  });
});
