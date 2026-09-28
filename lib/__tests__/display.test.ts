/**
 * lib/__tests__/display.test.ts
 *
 * Unit tests for the display helpers shared by the dashboard and the booking
 * page: appointment status labels and colours (lib/appointment-status.ts),
 * currency symbols (lib/currency.ts) and initials (lib/utils.ts).
 */

import { describe, expect, it } from 'vitest';
import {
  STATUS_BADGE_CLASSES,
  STATUS_LABELS,
  isPastAppointment,
  statusDotColor,
  weekCardClasses,
} from '@/lib/appointment-status';
import { getCurrencySymbol } from '@/lib/currency';
import { getInitials } from '@/lib/utils';

const NOW = new Date('2026-10-06T10:00:00Z');

describe('appointment status', () => {
  it('labels every status', () => {
    expect(STATUS_LABELS).toEqual({ scheduled: 'Pending', confirmed: 'Confirmed', cancelled: 'Cancelled' });
  });

  it('shows no badge for pending appointments', () => {
    expect(STATUS_BADGE_CLASSES.scheduled).toBeUndefined();
    expect(STATUS_BADGE_CLASSES.confirmed).toContain('emerald');
    expect(STATUS_BADGE_CLASSES.cancelled).toContain('red');
  });

  it('treats every non-cancelled appointment that has started as past', () => {
    const earlier = '2026-10-06T09:59:00Z';
    const later = '2026-10-06T10:01:00Z';
    expect(isPastAppointment({ status: 'scheduled', datetime: earlier }, NOW)).toBe(true);
    expect(isPastAppointment({ status: 'confirmed', datetime: earlier }, NOW)).toBe(true);
    expect(isPastAppointment({ status: 'cancelled', datetime: earlier }, NOW)).toBe(false);
    expect(isPastAppointment({ status: 'scheduled', datetime: later }, NOW)).toBe(false);
  });

  it('greys out past appointments whatever their status', () => {
    expect(statusDotColor('confirmed', true)).toBe(statusDotColor('scheduled', true));
    expect(weekCardClasses('confirmed', true)).toBe(weekCardClasses('scheduled', true));
    expect(new Set(['scheduled', 'confirmed', 'cancelled'].map((s) =>
      statusDotColor(s as 'scheduled' | 'confirmed' | 'cancelled', false),
    )).size).toBe(3);
  });
});

describe('getCurrencySymbol', () => {
  it('returns the symbol of a known currency', () => {
    expect(getCurrencySymbol('EUR')).toBe('€');
    expect(getCurrencySymbol('USD')).toBe('$');
    expect(getCurrencySymbol('KWD')).toBe('KD');
  });

  it('falls back to the code', () => {
    expect(getCurrencySymbol('XYZ')).toBe('XYZ');
    expect(getCurrencySymbol('toString')).toBe('toString');
  });
});

describe('getInitials', () => {
  it('uses the first and last words', () => {
    expect(getInitials('Elena Georgiou')).toBe('EG');
    expect(getInitials('anna maria  pappas')).toBe('AP');
  });

  it('uses the first two letters of a single word', () => {
    expect(getInitials('John')).toBe('JO');
    expect(getInitials('  j ')).toBe('J');
  });

  it('returns ? without a name', () => {
    expect(getInitials(null)).toBe('?');
    expect(getInitials('   ')).toBe('?');
  });
});
