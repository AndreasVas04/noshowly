/**
 * lib/__tests__/availability.test.ts
 *
 * Unit tests for the shared booking rules in lib/availability.ts: eligibility,
 * durations, working intervals, slot generation, the booking window, the
 * "Any available staff" assignment and duration/price validation.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DURATION_MINUTES,
  MAX_ADVANCE_DAYS,
  checkBookingWindow,
  eligibleBarberIds,
  getAvailableSlots,
  getBookableIntervals,
  getEffectiveDuration,
  getEffectivePrice,
  getScheduledIntervals,
  isBarberEligibleForService,
  isCandidateAvailable,
  isDateWithinBookingWindow,
  isValidDuration,
  isValidPrice,
  pickAnyAvailableBarber,
  sanitiseIntervals,
  type AvailabilityRecord,
  type BusyInterval,
  type SlotCandidate,
} from '@/lib/availability';
import { addDaysToDate } from '@/lib/time';

const TZ = 'Europe/Nicosia';
/** Monday 15 June 2026 (UTC+3 in Nicosia). */
const DATE = '2026-06-15';
/** The day before, so minimum notice never interferes unless a test wants it to. */
const NOW = new Date('2026-06-14T09:00:00Z');

/** Builds a staff_availability row. */
function availability(
  barberId: string,
  dayOfWeek: number,
  timeSlots: Array<{ start: string; end: string }>,
  extra: Partial<AvailabilityRecord> = {},
): AvailabilityRecord {
  return {
    barber_id: barberId,
    day_of_week: dayOfWeek,
    is_available: true,
    time_slots: timeSlots,
    start_time_1: null,
    end_time_1: null,
    start_time_2: null,
    end_time_2: null,
    ...extra,
  };
}

/** Builds a busy appointment from a Nicosia wall-clock time on DATE (UTC+3). */
function busyAt(barberId: string, time: string, duration: number): BusyInterval {
  const [h, m] = time.split(':').map(Number);
  const utc = new Date(Date.UTC(2026, 5, 15, h - 3, m));
  return { barber_id: barberId, datetime: utc.toISOString(), duration_minutes: duration };
}

/** Returns just the offered times. */
function times(candidates: SlotCandidate[], busy: BusyInterval[] = [], now = NOW, date = DATE): string[] {
  return getAvailableSlots({ date, timeZone: TZ, candidates, busy, now }).map((s) => s.time);
}

describe('eligibility', () => {
  const active = ['anna', 'bob', 'chris'];

  it('lets every active staff member do a service with no assignments', () => {
    expect(eligibleBarberIds('cut', active, [])).toEqual(active);
    expect(eligibleBarberIds('cut', active, [{ barber_id: 'anna', service_id: 'colour' }])).toEqual(active);
  });

  it('limits a service with assignments to the assigned staff', () => {
    const assignments = [
      { barber_id: 'anna', service_id: 'colour' },
      { barber_id: 'chris', service_id: 'colour' },
    ];
    expect(eligibleBarberIds('colour', active, assignments)).toEqual(['anna', 'chris']);
    expect(isBarberEligibleForService('colour', 'bob', assignments)).toBe(false);
    expect(isBarberEligibleForService('colour', 'anna', assignments)).toBe(true);
  });

  it('counts assignments of inactive staff: nobody active can do the service', () => {
    const assignments = [{ barber_id: 'inactive-dana', service_id: 'colour' }];
    expect(eligibleBarberIds('colour', active, assignments)).toEqual([]);
  });

  it('treats "no service" as every active staff member', () => {
    expect(eligibleBarberIds(null, active, [{ barber_id: 'anna', service_id: 'x' }])).toEqual(active);
    expect(isBarberEligibleForService(null, 'bob', [])).toBe(true);
  });
});

describe('durations and prices', () => {
  const service = { id: 'cut', duration_minutes: 45, price: 20 };
  const assignments = [
    { barber_id: 'anna', service_id: 'cut', duration_minutes_override: 60, price_override: 25 },
    { barber_id: 'bob', service_id: 'cut', duration_minutes_override: 0, price_override: null },
  ];

  it('uses the staff override, then the service, then the default', () => {
    expect(getEffectiveDuration(service, 'anna', assignments)).toBe(60);
    expect(getEffectiveDuration(service, 'bob', assignments)).toBe(45); // invalid override ignored
    expect(getEffectiveDuration(service, null, assignments)).toBe(45);
    expect(getEffectiveDuration({ id: 'x', duration_minutes: null }, 'anna', assignments)).toBe(
      DEFAULT_DURATION_MINUTES,
    );
    expect(getEffectiveDuration(null, 'anna', assignments)).toBe(DEFAULT_DURATION_MINUTES);
  });

  it('uses the staff price override when set', () => {
    expect(getEffectivePrice(service, 'anna', assignments)).toBe(25);
    expect(getEffectivePrice(service, 'bob', assignments)).toBe(20);
    expect(getEffectivePrice({ id: 'y', price: null }, null, assignments)).toBeNull();
  });
});

describe('working intervals', () => {
  it('returns null when the staff member has no schedule at all', () => {
    expect(getScheduledIntervals('anna', 1, [])).toBeNull();
  });

  it('returns [] on days off', () => {
    const rows = [availability('anna', 2, [{ start: '09:00', end: '17:00' }])];
    expect(getScheduledIntervals('anna', 1, rows)).toEqual([]);
    const off = [availability('anna', 1, [{ start: '09:00', end: '17:00' }], { is_available: false })];
    expect(getScheduledIntervals('anna', 1, off)).toEqual([]);
  });

  it('reads time_slots, sorting and cleaning them', () => {
    const rows = [
      availability('anna', 1, [
        { start: '14:00', end: '17:00' },
        { start: '9:00', end: '13:00' },
        { start: '18:00', end: '18:00' },
      ]),
    ];
    expect(getScheduledIntervals('anna', 1, rows)).toEqual([
      { start: '09:00', end: '13:00' },
      { start: '14:00', end: '17:00' },
    ]);
  });

  it('falls back to the legacy columns (Postgres TIME format)', () => {
    const rows = [
      availability('anna', 1, [], {
        start_time_1: '09:00:00',
        end_time_1: '12:00:00',
        start_time_2: '13:00:00',
        end_time_2: '18:00:00',
      }),
    ];
    expect(getScheduledIntervals('anna', 1, rows)).toEqual([
      { start: '09:00', end: '12:00' },
      { start: '13:00', end: '18:00' },
    ]);
  });

  it('clamps bookable intervals to salon hours and uses them as the fallback', () => {
    const rows = [availability('anna', 1, [{ start: '08:00', end: '21:00' }])];
    const hours = { opening_time: '09:00:00', closing_time: '20:00:00' };
    expect(getBookableIntervals('anna', 1, rows, hours)).toEqual([{ start: '09:00', end: '20:00' }]);
    expect(getBookableIntervals('bob', 1, rows, hours)).toEqual([{ start: '09:00', end: '20:00' }]);
    expect(getBookableIntervals('bob', 1, rows, { opening_time: null, closing_time: null })).toEqual([
      { start: '09:00', end: '20:00' },
    ]);
  });

  it('merges overlapping and touching intervals', () => {
    expect(
      sanitiseIntervals([
        { start: '09:00', end: '12:00' },
        { start: '11:00', end: '13:00' },
        { start: '13:00', end: '14:00' },
      ]),
    ).toEqual([{ start: '09:00', end: '14:00' }]);
  });
});

describe('slot generation', () => {
  const anna: SlotCandidate = {
    barberId: 'anna',
    intervals: [
      { start: '09:00', end: '13:00' },
      { start: '14:00', end: '17:00' },
    ],
    durationMinutes: 60,
  };

  it('offers a slot only when the whole appointment fits inside one interval', () => {
    expect(times([anna])).toEqual([
      '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00',
      '14:00', '14:30', '15:00', '15:30', '16:00',
    ]);
  });

  it('respects the closing time of the interval', () => {
    const closesAt16 = { ...anna, intervals: [{ start: '14:00', end: '16:00' }] };
    expect(times([closesAt16])).toEqual(['14:00', '14:30', '15:00']);
  });

  it('blocks overlapping appointments but allows touching ones', () => {
    const offered = times([anna], [busyAt('anna', '10:00', 60)]);
    expect(offered).toContain('09:00'); // ends 10:00, exactly when the booking starts
    expect(offered).not.toContain('09:30');
    expect(offered).not.toContain('10:00');
    expect(offered).not.toContain('10:30');
    expect(offered).toContain('11:00'); // starts when the booking ends
  });

  it("ignores other staff members' appointments", () => {
    expect(times([anna], [busyAt('bob', '10:00', 60)])).toContain('10:00');
  });

  it('applies the minimum notice', () => {
    const now = new Date('2026-06-15T06:40:00Z'); // 09:40 in Nicosia
    const offered = times([anna], [], now);
    expect(offered[0]).toBe('10:30');
  });

  it('offers nothing in the past or beyond the booking horizon', () => {
    expect(times([anna], [], NOW, '2026-06-13')).toEqual([]);
    const lastDay = addDaysToDate('2026-06-14', MAX_ADVANCE_DAYS);
    expect(times([{ ...anna, intervals: [{ start: '09:00', end: '10:00' }] }], [], NOW, lastDay)).toEqual([
      '09:00',
    ]);
    expect(times([anna], [], NOW, addDaysToDate(lastDay, 1))).toEqual([]);
  });

  it('lists every staff member free at a time (Any available staff)', () => {
    const bob: SlotCandidate = { barberId: 'bob', intervals: [{ start: '10:00', end: '12:00' }], durationMinutes: 30 };
    const slots = getAvailableSlots({ date: DATE, timeZone: TZ, candidates: [anna, bob], busy: [], now: NOW });
    expect(slots.find((s) => s.time === '09:00')?.barberIds).toEqual(['anna']);
    expect(slots.find((s) => s.time === '11:30')?.barberIds).toEqual(['anna', 'bob']);
  });

  it('uses each staff member’s own duration', () => {
    const shortBob: SlotCandidate = { barberId: 'bob', intervals: anna.intervals, durationMinutes: 30 };
    const slots = getAvailableSlots({ date: DATE, timeZone: TZ, candidates: [anna, shortBob], busy: [], now: NOW });
    expect(slots.find((s) => s.time === '12:30')?.barberIds).toEqual(['bob']);
  });

  it('never offers a time skipped by a clock change', () => {
    const ny: SlotCandidate = { barberId: 'anna', intervals: [{ start: '01:00', end: '05:00' }], durationMinutes: 30 };
    const slots = getAvailableSlots({
      date: '2026-03-08',
      timeZone: 'America/New_York',
      candidates: [ny],
      busy: [],
      now: new Date('2026-03-01T00:00:00Z'),
    }).map((s) => s.time);
    expect(slots).toEqual(['01:00', '01:30', '03:00', '03:30', '04:00', '04:30']);
  });
});

describe('booking window', () => {
  const now = new Date('2026-06-15T06:00:00Z'); // 09:00 in Nicosia

  it('rejects the past and bookings with less than the minimum notice', () => {
    expect(checkBookingWindow(new Date('2026-06-15T05:00:00Z'), DATE, TZ, now)).toEqual({ ok: false, reason: 'past' });
    expect(checkBookingWindow(new Date('2026-06-15T06:20:00Z'), DATE, TZ, now)).toEqual({ ok: false, reason: 'too_soon' });
    expect(checkBookingWindow(new Date('2026-06-15T06:30:00Z'), DATE, TZ, now)).toEqual({ ok: true });
  });

  it('rejects dates beyond the horizon', () => {
    const tooFar = addDaysToDate(DATE, MAX_ADVANCE_DAYS + 1);
    const start = new Date(`${tooFar}T07:00:00Z`);
    expect(checkBookingWindow(start, tooFar, TZ, now)).toEqual({ ok: false, reason: 'too_far' });
    expect(isDateWithinBookingWindow(addDaysToDate(DATE, MAX_ADVANCE_DAYS), TZ, now)).toBe(true);
    expect(isDateWithinBookingWindow(tooFar, TZ, now)).toBe(false);
    expect(isDateWithinBookingWindow('2026-06-14', TZ, now)).toBe(false);
  });
});

describe('isCandidateAvailable', () => {
  it('checks the full duration against intervals and appointments', () => {
    const candidate: SlotCandidate = { barberId: 'anna', intervals: [{ start: '09:00', end: '13:00' }], durationMinutes: 45 };
    const check = (time: string, busy: BusyInterval[] = []) =>
      isCandidateAvailable({ date: DATE, time, timeZone: TZ, candidate, busy });
    expect(check('12:15')).toBe(true);
    expect(check('12:20')).toBe(false); // would end 13:05
    expect(check('08:45')).toBe(false); // starts before work
    expect(check('10:00', [busyAt('anna', '10:30', 30)])).toBe(false);
    expect(check('09:45', [busyAt('anna', '10:30', 30)])).toBe(true); // ends 10:30
  });
});

describe('pickAnyAvailableBarber', () => {
  const intervals = [{ start: '09:00', end: '17:00' }];
  const candidates = [
    { barberId: 'id-c', name: 'Chris', intervals, durationMinutes: 30 },
    { barberId: 'id-a', name: 'Anna', intervals, durationMinutes: 30 },
    { barberId: 'id-b', name: 'Bob', intervals, durationMinutes: 30 },
  ];

  it('picks the free staff member with the fewest appointments that day', () => {
    const busy = [busyAt('id-a', '09:00', 30), busyAt('id-a', '11:00', 30), busyAt('id-b', '15:00', 30)];
    expect(pickAnyAvailableBarber({ date: DATE, time: '12:00', timeZone: TZ, candidates, busy })).toBe('id-c');
  });

  it('breaks ties by name', () => {
    expect(pickAnyAvailableBarber({ date: DATE, time: '12:00', timeZone: TZ, candidates, busy: [] })).toBe('id-a');
  });

  it('skips staff who are busy or not working at that time', () => {
    const busy = [busyAt('id-a', '12:00', 60)];
    expect(pickAnyAvailableBarber({ date: DATE, time: '12:00', timeZone: TZ, candidates, busy })).toBe('id-b');
    const shortDay = [{ barberId: 'id-a', name: 'Anna', intervals: [{ start: '09:00', end: '12:00' }], durationMinutes: 30 }];
    expect(pickAnyAvailableBarber({ date: DATE, time: '12:00', timeZone: TZ, candidates: shortDay, busy: [] })).toBeNull();
  });

  it('uses each staff member’s own duration', () => {
    const withOverride = [
      { barberId: 'id-a', name: 'Anna', intervals: [{ start: '09:00', end: '12:30' }], durationMinutes: 60 },
      { barberId: 'id-b', name: 'Bob', intervals: [{ start: '09:00', end: '12:30' }], durationMinutes: 30 },
    ];
    expect(pickAnyAvailableBarber({ date: DATE, time: '12:00', timeZone: TZ, candidates: withOverride, busy: [] })).toBe(
      'id-b',
    );
  });
});

describe('duration and price validation', () => {
  it('accepts whole minutes from 1 to 480', () => {
    expect(isValidDuration(1)).toBe(true);
    expect(isValidDuration(480)).toBe(true);
    expect(isValidDuration(0)).toBe(false);
    expect(isValidDuration(481)).toBe(false);
    expect(isValidDuration(30.5)).toBe(false);
    expect(isValidDuration('30')).toBe(false);
    expect(isValidDuration(null)).toBe(false);
  });

  it('accepts prices of 0 or more', () => {
    expect(isValidPrice(0)).toBe(true);
    expect(isValidPrice(12.5)).toBe(true);
    expect(isValidPrice(-0.01)).toBe(false);
    expect(isValidPrice(Number.NaN)).toBe(false);
    expect(isValidPrice(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidPrice(1e12)).toBe(false);
    expect(isValidPrice('10')).toBe(false);
  });
});
