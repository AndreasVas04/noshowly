/**
 * app/book/[slug]/_components/__tests__/selection.test.ts
 *
 * Unit tests for what a visitor can pick on the booking page, in
 * app/book/[slug]/_components/selection.ts: bookable staff, the services for
 * a staff choice, the slot candidates of a date, and the duration and price
 * labels (a range for "Any available staff").
 */

import { describe, expect, it } from 'vitest';
import {
  buildCandidates,
  getAvailableServices,
  getBookableBarbers,
  serviceDurationLabel,
  servicePriceLabel,
  type StaffScope,
} from '@/app/book/[slug]/_components/selection';
import { DEFAULT_DURATION_MINUTES, DEFAULT_OPENING_HOURS } from '@/lib/availability';
import type {
  PublicAvailability,
  PublicBarber,
  PublicService,
  PublicServiceAssignment,
} from '@/types';

/** Wednesday 15 April 2026. */
const WEDNESDAY = '2026-04-15';

const elena: PublicBarber = { id: 'elena', name: 'Elena', photo_url: null, bio: null };
const marios: PublicBarber = { id: 'marios', name: 'Marios', photo_url: null, bio: null };
const nikos: PublicBarber = { id: 'nikos', name: 'Nikos', photo_url: null, bio: null };
const barbers = [elena, marios, nikos];

/** No staff links: everyone can do it. */
const haircut: PublicService = { id: 'haircut', name: 'Haircut', duration_minutes: 30, price: 20 };
/** Elena and Marios only; Marios takes longer and charges more. */
const colour: PublicService = { id: 'colour', name: 'Colour', duration_minutes: 60, price: 50 };
/** Marios only; no duration or price anywhere. */
const beard: PublicService = { id: 'beard', name: 'Beard trim', duration_minutes: null, price: null };
/** Elena and Nikos only; no duration of its own, but Elena's override is 20 minutes. */
const kids: PublicService = { id: 'kids', name: "Kids' cut", duration_minutes: null, price: 15 };
const services = [beard, colour, haircut, kids];

/** Builds a staff/service link. */
function link(
  barberId: string,
  serviceId: string,
  overrides: { duration?: number; price?: number } = {},
): PublicServiceAssignment {
  return {
    barber_id: barberId,
    service_id: serviceId,
    duration_minutes_override: overrides.duration ?? null,
    price_override: overrides.price ?? null,
  };
}

const assignments = [
  link('elena', 'colour'),
  link('marios', 'colour', { duration: 90, price: 65 }),
  link('marios', 'beard'),
  link('elena', 'kids', { duration: 20 }),
  link('nikos', 'kids'),
];

/** Builds a staff_availability row. */
function availability(
  barberId: string,
  dayOfWeek: number,
  timeSlots: Array<{ start: string; end: string }>,
  isAvailable = true,
): PublicAvailability {
  return {
    barber_id: barberId,
    day_of_week: dayOfWeek,
    is_available: isAvailable,
    time_slots: timeSlots,
    start_time_1: null,
    end_time_1: null,
    start_time_2: null,
    end_time_2: null,
  };
}

/** Elena works Wednesday mornings, Marios Wednesday afternoons, Nikos not on Wednesdays. */
const staffAvailability = [
  availability('elena', 3, [{ start: '09:00', end: '13:00' }]),
  availability('elena', 4, [{ start: '14:00', end: '19:00' }]),
  availability('marios', 3, [{ start: '12:00', end: '18:00' }]),
  availability('nikos', 3, [], false),
];

/** A salon with all three bookable and no staff choice made yet ("any"). */
function scope(overrides: Partial<StaffScope> = {}): StaffScope {
  return {
    salonHasStaff: true,
    bookableBarberIds: ['elena', 'marios', 'nikos'],
    specificBarber: null,
    barberServiceAssignments: assignments,
    staffAvailability,
    salonHours: { opening_time: null, closing_time: null },
    ...overrides,
  };
}

/** A salon without staff. */
const noStaff = scope({ salonHasStaff: false, bookableBarberIds: [], staffAvailability: [] });

describe('getBookableBarbers', () => {
  it('books everyone when the salon has no services', () => {
    expect(getBookableBarbers(barbers, [], assignments)).toEqual(barbers);
  });

  it('books everyone who can perform at least one service', () => {
    expect(getBookableBarbers(barbers, services, assignments)).toEqual(barbers);
    expect(getBookableBarbers(barbers, [colour, beard], assignments)).toEqual([elena, marios]);
    expect(getBookableBarbers(barbers, [beard], assignments)).toEqual([marios]);
  });
});

describe('getAvailableServices', () => {
  it('offers every service in a salon without staff', () => {
    expect(getAvailableServices(noStaff, services)).toEqual(services);
  });

  it('offers a specific staff member the services they can perform', () => {
    expect(getAvailableServices(scope({ specificBarber: marios }), services)).toEqual([beard, colour, haircut]);
    expect(getAvailableServices(scope({ specificBarber: nikos }), services)).toEqual([haircut, kids]);
  });

  it('offers "any" the services at least one bookable staff member can perform', () => {
    expect(getAvailableServices(scope(), services)).toEqual(services);
    expect(getAvailableServices(scope({ bookableBarberIds: ['nikos'] }), services)).toEqual([haircut, kids]);
  });
});

describe('buildCandidates', () => {
  it('uses the salon hours for a salon without staff', () => {
    const open = scope({ ...noStaff, salonHours: { opening_time: '10:00', closing_time: '19:00' } });
    expect(buildCandidates(open, WEDNESDAY, haircut)).toEqual([
      { barberId: null, intervals: [{ start: '10:00', end: '19:00' }], durationMinutes: 30 },
    ]);
  });

  it('falls back to the default hours and duration for a salon without staff', () => {
    expect(buildCandidates(noStaff, WEDNESDAY, null)).toEqual([
      { barberId: null, intervals: [DEFAULT_OPENING_HOURS], durationMinutes: DEFAULT_DURATION_MINUTES },
    ]);
  });

  it('considers only the chosen staff member, with their own duration', () => {
    expect(buildCandidates(scope({ specificBarber: marios }), WEDNESDAY, colour)).toEqual([
      { barberId: 'marios', intervals: [{ start: '12:00', end: '18:00' }], durationMinutes: 90 },
    ]);
  });

  it('considers everyone who can perform the service for "any"', () => {
    expect(buildCandidates(scope(), WEDNESDAY, colour)).toEqual([
      { barberId: 'elena', intervals: [{ start: '09:00', end: '13:00' }], durationMinutes: 60 },
      { barberId: 'marios', intervals: [{ start: '12:00', end: '18:00' }], durationMinutes: 90 },
    ]);
  });

  it('considers every bookable staff member when no service is chosen', () => {
    expect(buildCandidates(scope(), WEDNESDAY, null)).toEqual([
      { barberId: 'elena', intervals: [{ start: '09:00', end: '13:00' }], durationMinutes: 30 },
      { barberId: 'marios', intervals: [{ start: '12:00', end: '18:00' }], durationMinutes: 30 },
      { barberId: 'nikos', intervals: [], durationMinutes: 30 },
    ]);
  });

  it("uses the date's weekday and clamps to the salon hours", () => {
    const open = scope({ salonHours: { opening_time: '10:00', closing_time: '17:00' } });
    expect(buildCandidates(open, '2026-04-16', haircut)).toEqual([
      { barberId: 'elena', intervals: [{ start: '14:00', end: '17:00' }], durationMinutes: 30 },
      { barberId: 'marios', intervals: [], durationMinutes: 30 },
      { barberId: 'nikos', intervals: [], durationMinutes: 30 },
    ]);
  });
});

describe('serviceDurationLabel', () => {
  it("shows a specific staff member's own duration", () => {
    expect(serviceDurationLabel(scope({ specificBarber: marios }), colour)).toBe('90');
    expect(serviceDurationLabel(scope({ specificBarber: elena }), colour)).toBe('60');
    expect(serviceDurationLabel(scope({ specificBarber: elena }), kids)).toBe('20');
  });

  it('shows the range over everyone who can perform the service for "any"', () => {
    expect(serviceDurationLabel(scope(), colour)).toBe('60–90');
    expect(serviceDurationLabel(scope(), haircut)).toBe('30');
    // Defined by Elena's override; Nikos gets the default duration.
    expect(serviceDurationLabel(scope(), kids)).toBe(`20–${DEFAULT_DURATION_MINUTES}`);
  });

  it('shows nothing when neither the service nor an override defines a duration', () => {
    expect(serviceDurationLabel(scope(), beard)).toBeNull();
    // Only another staff member's override defines one.
    expect(serviceDurationLabel(scope({ specificBarber: nikos }), kids)).toBeNull();
  });

  it("uses the service's duration in a salon without staff", () => {
    expect(serviceDurationLabel(noStaff, haircut)).toBe('30');
    expect(serviceDurationLabel(noStaff, beard)).toBeNull();
  });
});

describe('servicePriceLabel', () => {
  it("shows a specific staff member's own price", () => {
    expect(servicePriceLabel(scope({ specificBarber: marios }), colour, '€')).toBe('€65.00');
    expect(servicePriceLabel(scope({ specificBarber: elena }), colour, '€')).toBe('€50.00');
  });

  it('shows the range over everyone who can perform the service for "any"', () => {
    expect(servicePriceLabel(scope(), colour, '€')).toBe('€50.00–€65.00');
    expect(servicePriceLabel(scope(), kids, '€')).toBe('€15.00');
  });

  it('shows nothing when no price is set', () => {
    expect(servicePriceLabel(scope(), beard, '€')).toBeNull();
  });

  it("uses the service's price and the salon's currency in a salon without staff", () => {
    expect(servicePriceLabel(noStaff, haircut, '$')).toBe('$20.00');
  });
});
