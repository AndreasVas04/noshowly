/**
 * components/dashboard/booking-settings/__tests__/form-state.test.ts
 *
 * Unit tests for the booking settings form helpers in
 * components/dashboard/booking-settings/form-state.ts: default days, building
 * a staff member's form from staff_availability rows (time_slots and the
 * legacy columns), the working hours and break checks, and applying saved
 * text to fields the owner may still be editing.
 */

import { describe, expect, it } from 'vitest';
import {
  applySavedText,
  buildBarberForm,
  getWorkingHoursError,
  isBreakIgnored,
  makeDefaultDayState,
  sameBreaks,
  WEEK_DAYS,
  type DayState,
} from '@/components/dashboard/booking-settings/form-state';
import type { Barber, StaffAvailability } from '@/types';

const BARBER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_BARBER_ID = '22222222-2222-4222-8222-222222222222';

/** A staff member row with the given overrides. */
function barber(overrides: Partial<Barber> = {}): Barber {
  return {
    id: BARBER_ID,
    salon_id: 'salon-1',
    name: 'Elena',
    photo_url: null,
    bio: null,
    active: true,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

/** A staff_availability row for a day, with no times unless overridden. */
function row(dayOfWeek: number, overrides: Partial<StaffAvailability> = {}): StaffAvailability {
  return {
    id: `row-${dayOfWeek}`,
    barber_id: BARBER_ID,
    day_of_week: dayOfWeek,
    is_available: true,
    time_slots: null,
    start_time_1: null,
    end_time_1: null,
    start_time_2: null,
    end_time_2: null,
    ...overrides,
  };
}

/** A working day with the given hours and breaks. */
function day(work_start: string, work_end: string, breaks: DayState['breaks'] = []): DayState {
  return { is_available: true, work_start, work_end, breaks };
}

describe('WEEK_DAYS', () => {
  it('lists the days Monday first', () => {
    expect(WEEK_DAYS.map((d) => d.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(WEEK_DAYS.map((d) => d.value)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });
});

describe('makeDefaultDayState', () => {
  it('makes Monday to Friday working days from 09:00 to 17:00', () => {
    for (const dow of [1, 2, 3, 4, 5]) {
      expect(makeDefaultDayState(dow)).toEqual({
        is_available: true,
        work_start: '09:00',
        work_end: '17:00',
        breaks: [],
      });
    }
  });

  it('makes Saturday and Sunday days off with the same default hours', () => {
    for (const dow of [0, 6]) {
      expect(makeDefaultDayState(dow)).toEqual({
        is_available: false,
        work_start: '09:00',
        work_end: '17:00',
        breaks: [],
      });
    }
  });
});

describe('buildBarberForm', () => {
  it('uses the defaults for every day without a row and empty strings for missing fields', () => {
    const form = buildBarberForm(barber(), []);
    expect(form.name).toBe('Elena');
    expect(form.bio).toBe('');
    expect(form.photo_url).toBe('');
    for (let dow = 0; dow <= 6; dow++) {
      expect(form.availability[dow]).toEqual(makeDefaultDayState(dow));
    }
  });

  it('copies the name, bio and photo URL', () => {
    const form = buildBarberForm(barber({ bio: 'Colour specialist', photo_url: 'https://example.com/elena.jpg' }), []);
    expect(form).toMatchObject({
      name: 'Elena',
      bio: 'Colour specialist',
      photo_url: 'https://example.com/elena.jpg',
    });
  });

  it('turns every gap between stored intervals into a break', () => {
    const form = buildBarberForm(barber(), [
      row(1, {
        time_slots: [
          { start: '09:00', end: '11:00' },
          { start: '11:30', end: '13:00' },
          { start: '14:00', end: '18:00' },
        ],
      }),
    ]);
    expect(form.availability[1]).toEqual(
      day('09:00', '18:00', [
        { start: '11:00', end: '11:30' },
        { start: '13:00', end: '14:00' },
      ]),
    );
  });

  it('falls back to the legacy start/end columns when time_slots has no intervals', () => {
    const legacy = {
      start_time_1: '09:00:00',
      end_time_1: '13:00:00',
      start_time_2: '14:00:00',
      end_time_2: '18:00:00',
    };
    const form = buildBarberForm(barber(), [
      row(2, { ...legacy, time_slots: null }),
      row(3, { ...legacy, time_slots: [] }),
    ]);
    const expected = day('09:00', '18:00', [{ start: '13:00', end: '14:00' }]);
    expect(form.availability[2]).toEqual(expected);
    expect(form.availability[3]).toEqual(expected);
  });

  it('gives an available day without any times the default hours, even at the weekend', () => {
    const form = buildBarberForm(barber(), [row(6)]);
    expect(form.availability[6]).toEqual(day('09:00', '17:00'));
  });

  it('keeps a day off that was stored without times off, with the default hours', () => {
    const form = buildBarberForm(barber(), [row(3, { is_available: false })]);
    expect(form.availability[3]).toEqual({ ...day('09:00', '17:00'), is_available: false });
  });

  it('keeps the stored hours of a day off', () => {
    const form = buildBarberForm(barber(), [
      row(4, { is_available: false, time_slots: [{ start: '10:00', end: '16:00' }] }),
    ]);
    expect(form.availability[4]).toEqual({ ...day('10:00', '16:00'), is_available: false });
  });

  it('ignores the rows of other staff members', () => {
    const form = buildBarberForm(barber(), [
      row(1, { barber_id: OTHER_BARBER_ID, time_slots: [{ start: '12:00', end: '20:00' }] }),
    ]);
    expect(form.availability[1]).toEqual(makeDefaultDayState(1));
  });
});

describe('getWorkingHoursError', () => {
  it('accepts a day off whatever its hours', () => {
    expect(getWorkingHoursError({ is_available: false, work_start: '', work_end: '', breaks: [] })).toBeNull();
  });

  it('accepts valid hours, with or without breaks, in any time format normaliseTime accepts', () => {
    expect(getWorkingHoursError(day('09:00', '17:00'))).toBeNull();
    expect(getWorkingHoursError(day('9:00', '17:00:00', [{ start: '13:00', end: '14:00' }]))).toBeNull();
  });

  it('asks for both times when one is missing or malformed', () => {
    expect(getWorkingHoursError(day('', '17:00'))).toBe('Enter a start and end time.');
    expect(getWorkingHoursError(day('09:00', '25:00'))).toBe('Enter a start and end time.');
  });

  it('rejects hours that do not end after they start', () => {
    expect(getWorkingHoursError(day('17:00', '17:00'))).toBe('Working hours must end after they start.');
    expect(getWorkingHoursError(day('18:00', '09:00'))).toBe('Working hours must end after they start.');
  });

  it('rejects breaks that cover the whole working day', () => {
    expect(getWorkingHoursError(day('09:00', '17:00', [{ start: '08:00', end: '18:00' }]))).toBe(
      'Breaks cover the whole working day. Mark the day as off instead.',
    );
  });
});

describe('isBreakIgnored', () => {
  const workingDay = day('09:00', '17:00');

  it('keeps a break inside the working hours', () => {
    expect(isBreakIgnored(workingDay, { start: '13:00', end: '14:00' })).toBe(false);
  });

  it('keeps a break that is only partly outside the working hours (it is clamped)', () => {
    expect(isBreakIgnored(workingDay, { start: '16:30', end: '18:00' })).toBe(false);
  });

  it('ignores empty, inverted and malformed breaks', () => {
    expect(isBreakIgnored(workingDay, { start: '13:00', end: '13:00' })).toBe(true);
    expect(isBreakIgnored(workingDay, { start: '14:00', end: '13:00' })).toBe(true);
    expect(isBreakIgnored(workingDay, { start: '', end: '14:00' })).toBe(true);
  });

  it('ignores a break outside the working hours', () => {
    expect(isBreakIgnored(workingDay, { start: '18:00', end: '19:00' })).toBe(true);
  });

  it('ignores every break of a day whose hours are invalid', () => {
    expect(isBreakIgnored(day('17:00', '09:00'), { start: '12:00', end: '13:00' })).toBe(true);
  });
});

describe('sameBreaks', () => {
  const lunch = { start: '13:00', end: '14:00' };
  const coffee = { start: '10:30', end: '10:45' };

  it('is true for identical lists, including two empty ones', () => {
    expect(sameBreaks([], [])).toBe(true);
    expect(sameBreaks([coffee, lunch], [{ ...coffee }, { ...lunch }])).toBe(true);
  });

  it('is false when the length, a time or the order differs', () => {
    expect(sameBreaks([lunch], [lunch, coffee])).toBe(false);
    expect(sameBreaks([lunch], [{ start: '13:00', end: '14:30' }])).toBe(false);
    expect(sameBreaks([coffee, lunch], [lunch, coffee])).toBe(false);
  });
});

describe('applySavedText', () => {
  it('keeps what the owner typed after the request was sent', () => {
    expect(applySavedText('Hello there', 'Hello', 'Hello')).toBe('Hello there');
  });

  it('applies the saved value when the field is unchanged since the request', () => {
    expect(applySavedText('hello', 'hello', 'Hello')).toBe('Hello');
    expect(applySavedText('old', 'old', '')).toBe('');
  });

  it('keeps surrounding whitespace the server trimmed, so typing is not disturbed', () => {
    expect(applySavedText('Hello ', 'Hello ', 'Hello')).toBe('Hello ');
    expect(applySavedText('  Hi', '  Hi', 'Hi')).toBe('  Hi');
  });
});
