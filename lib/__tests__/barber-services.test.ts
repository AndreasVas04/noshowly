import { describe, expect, it } from 'vitest';
import { mergeSavedAssignments, toAssignmentValues } from '@/lib/barber-services';
import type { BarberService } from '@/types';

const BARBER = 'barber-1';

/** Builds an assignment row; ids starting with "tmp-" are not saved yet. */
function row(
  serviceId: string,
  overrides: Partial<BarberService> = {},
): BarberService {
  return {
    id: `row-${serviceId}`,
    salon_id: 'salon-1',
    barber_id: BARBER,
    service_id: serviceId,
    price_override: null,
    duration_minutes_override: null,
    created_at: '2026-09-28T10:00:00Z',
    ...overrides,
  };
}

describe('toAssignmentValues', () => {
  it('keeps only the fields the API saves', () => {
    expect(toAssignmentValues([row('cut', { price_override: 20 })])).toEqual([
      { service_id: 'cut', price_override: 20, duration_minutes_override: null },
    ]);
  });
});

describe('mergeSavedAssignments', () => {
  it('takes the saved rows when nothing changed while the request was in flight', () => {
    const current = [row('cut', { id: 'tmp-cut', price_override: 55.555 })];
    const sent = toAssignmentValues(current);
    const saved = [row('cut', { id: 'real-id', price_override: 55.56 })];

    expect(mergeSavedAssignments(current, sent, saved)).toEqual(saved);
  });

  it('keeps a service ticked while the request was in flight', () => {
    const sent = toAssignmentValues([row('cut')]);
    const current = [row('cut'), row('colour', { id: 'tmp-colour' })];
    const saved = [row('cut')];

    expect(mergeSavedAssignments(current, sent, saved).map((r) => r.id)).toEqual([
      'row-cut',
      'tmp-colour',
    ]);
  });

  it('does not bring back a service unticked while the request was in flight', () => {
    const sent = toAssignmentValues([row('cut'), row('colour')]);
    const current = [row('cut')];
    const saved = [row('cut'), row('colour')];

    expect(mergeSavedAssignments(current, sent, saved).map((r) => r.service_id)).toEqual(['cut']);
  });

  it('keeps an override edited while the request was in flight', () => {
    const sent = toAssignmentValues([row('cut', { price_override: 50, duration_minutes_override: 40 })]);
    const current = [row('cut', { id: 'tmp-cut', price_override: 55, duration_minutes_override: 40 })];
    const saved = [row('cut', { id: 'real-id', price_override: 50, duration_minutes_override: 40 })];

    expect(mergeSavedAssignments(current, sent, saved)).toEqual([
      row('cut', { id: 'real-id', price_override: 55, duration_minutes_override: 40 }),
    ]);
  });

  it('undoes a rejected save when merged with the stored rows', () => {
    // The request ticked "colour" and set a price; the server kept neither.
    const current = [row('cut', { price_override: -5 }), row('colour', { id: 'tmp-colour' })];
    const sent = toAssignmentValues(current);
    const stored = [row('cut')];

    expect(mergeSavedAssignments(current, sent, stored)).toEqual([row('cut')]);
  });

  it('shows stored rows the owner never had', () => {
    const current = [row('cut')];
    const sent = toAssignmentValues(current);
    const stored = [row('cut'), row('beard')];

    expect(mergeSavedAssignments(current, sent, stored).map((r) => r.service_id)).toEqual([
      'cut',
      'beard',
    ]);
  });
});
