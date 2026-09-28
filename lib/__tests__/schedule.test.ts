/**
 * lib/__tests__/schedule.test.ts
 *
 * Unit tests for the weekly schedule helpers in lib/schedule.ts: converting
 * between the editor model and stored time_slots, cleaning breaks, and the
 * server-side time_slots validation.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_TIME_SLOTS_PER_DAY,
  normaliseBreaks,
  timeSlotsToWorkingDay,
  validateTimeSlots,
  workingDayToTimeSlots,
} from '@/lib/schedule';

describe('timeSlotsToWorkingDay', () => {
  it('turns every gap into a break', () => {
    expect(
      timeSlotsToWorkingDay([
        { start: '09:00', end: '11:00' },
        { start: '11:30', end: '13:00' },
        { start: '14:00', end: '18:00' },
      ]),
    ).toEqual({
      work_start: '09:00',
      work_end: '18:00',
      breaks: [
        { start: '11:00', end: '11:30' },
        { start: '13:00', end: '14:00' },
      ],
    });
  });

  it('handles a single interval and empty input', () => {
    expect(timeSlotsToWorkingDay([{ start: '09:00:00', end: '17:00:00' }])).toEqual({
      work_start: '09:00',
      work_end: '17:00',
      breaks: [],
    });
    expect(timeSlotsToWorkingDay([])).toBeNull();
    expect(timeSlotsToWorkingDay(null)).toBeNull();
  });

  it('round-trips with workingDayToTimeSlots', () => {
    const slots = [
      { start: '08:00', end: '10:00' },
      { start: '10:15', end: '12:00' },
      { start: '12:45', end: '16:00' },
    ];
    const day = timeSlotsToWorkingDay(slots);
    expect(day).not.toBeNull();
    expect(workingDayToTimeSlots(day!)).toEqual(slots);
  });
});

describe('workingDayToTimeSlots', () => {
  it('subtracts breaks from the working window', () => {
    expect(
      workingDayToTimeSlots({
        work_start: '09:00',
        work_end: '17:00',
        breaks: [{ start: '13:00', end: '14:00' }],
      }),
    ).toEqual([
      { start: '09:00', end: '13:00' },
      { start: '14:00', end: '17:00' },
    ]);
  });

  it('clamps breaks to working hours and drops empty or inverted ones', () => {
    expect(
      workingDayToTimeSlots({
        work_start: '09:00',
        work_end: '17:00',
        breaks: [
          { start: '16:30', end: '18:00' }, // clamped to 16:30–17:00
          { start: '12:00', end: '12:00' }, // empty
          { start: '15:00', end: '14:00' }, // inverted
          { start: '07:00', end: '08:00' }, // outside hours
          { start: '', end: '10:00' },      // malformed
        ],
      }),
    ).toEqual([{ start: '09:00', end: '16:30' }]);
  });

  it('merges overlapping breaks', () => {
    expect(
      workingDayToTimeSlots({
        work_start: '09:00',
        work_end: '17:00',
        breaks: [
          { start: '12:00', end: '13:00' },
          { start: '12:30', end: '13:30' },
        ],
      }),
    ).toEqual([
      { start: '09:00', end: '12:00' },
      { start: '13:30', end: '17:00' },
    ]);
  });

  it('returns nothing for an invalid working window', () => {
    expect(workingDayToTimeSlots({ work_start: '17:00', work_end: '09:00', breaks: [] })).toEqual([]);
  });

  it('returns nothing when breaks cover the whole working day', () => {
    expect(
      workingDayToTimeSlots({
        work_start: '09:00',
        work_end: '17:00',
        breaks: [
          { start: '08:00', end: '13:00' },
          { start: '13:00', end: '18:00' },
        ],
      }),
    ).toEqual([]);
  });
});

describe('normaliseBreaks (Apply to all days)', () => {
  it("fits copied breaks to each day's hours", () => {
    const breaks = [
      { start: '13:00', end: '15:00' },
      { start: '16:00', end: '17:00' },
    ];
    expect(normaliseBreaks('10:00', '14:00', breaks)).toEqual([{ start: '13:00', end: '14:00' }]);
    expect(normaliseBreaks('09:00', '18:00', breaks)).toEqual(breaks);
  });
});

describe('validateTimeSlots', () => {
  it('normalises, sorts and accepts touching intervals', () => {
    expect(
      validateTimeSlots([
        { start: '14:00', end: '18:00:00' },
        { start: '9:00', end: '14:00' },
      ]),
    ).toEqual({
      ok: true,
      slots: [
        { start: '09:00', end: '14:00' },
        { start: '14:00', end: '18:00' },
      ],
    });
  });

  it('treats null or undefined as no intervals', () => {
    expect(validateTimeSlots(undefined)).toEqual({ ok: true, slots: [] });
    expect(validateTimeSlots(null)).toEqual({ ok: true, slots: [] });
  });

  it('rejects intervals that do not end after they start', () => {
    expect(validateTimeSlots([{ start: '10:00', end: '10:00' }]).ok).toBe(false);
    expect(validateTimeSlots([{ start: '12:00', end: '09:00' }]).ok).toBe(false);
  });

  it('rejects overlapping intervals', () => {
    const result = validateTimeSlots([
      { start: '09:00', end: '13:00' },
      { start: '12:00', end: '17:00' },
    ]);
    expect(result.ok).toBe(false);
  });

  it('rejects malformed input', () => {
    expect(validateTimeSlots('09:00-17:00').ok).toBe(false);
    expect(validateTimeSlots([['09:00', '17:00']]).ok).toBe(false);
    expect(validateTimeSlots([{ start: '24:00', end: '25:00' }]).ok).toBe(false);
    expect(validateTimeSlots([{ start: 900, end: 1700 }]).ok).toBe(false);
    const tooMany = Array.from({ length: MAX_TIME_SLOTS_PER_DAY + 1 }, (_, i) => ({
      start: `${String(i).padStart(2, '0')}:00`,
      end: `${String(i).padStart(2, '0')}:30`,
    }));
    expect(validateTimeSlots(tooMany).ok).toBe(false);
  });
});
